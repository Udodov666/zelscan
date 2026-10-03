"""
QueueWorker — единственный daemon-поток, обрабатывающий заказы из OrderStore.

Правила:
  • 1 заказ за раз (MAX_CONCURRENT=1).
  • 3 Lolz-токена работают параллельно ВНУТРИ одного заказа (ThreadPoolExecutor в LolzAnalyzer).
  • AI вызывается только для report_type='full', внутри той же задачи.
  • Progress пишется в БД не чаще раза в ~0.8 с (throttle).
  • При старте: running → paid (восстановление после краша).
  • Фоновый тик раз в час: чистит старые заказы и их файлы.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import config
from store import OrderStore, Status

logger = logging.getLogger("zelscan.worker")

_PROGRESS_THROTTLE = 0.8  # сек между записями progress в БД


class ProgressTracker:
    """Normalize concurrent analyzer callbacks into one monotonic stage stream."""

    STAGES = ("profile", "collecting", "metrics", "ai", "saving", "done", "error")
    _RANK = {stage: index for index, stage in enumerate(STAGES)}

    def __init__(self, full_report: bool):
        self.full_report = full_report
        self.stage = "profile"
        self.current = 0
        self.completed_stages = set()

    def normalize(self, stage, current, total, message):
        raw_stage = str(stage or "profile")
        raw_message = str(message or "")
        # Финальные callbacks источников приходят независимо из параллельных потоков.
        if raw_stage == "profile" and int(current or 0) >= 1 and int(total or 0) == 1:
            self.completed_stages.add("profile")
        if raw_stage in ("fetch_posts", "fetch_threads", "fetch_wall") and "готов" in raw_message.lower():
            self.completed_stages.add(raw_stage)
        if raw_stage in ("fetch_posts", "fetch_threads", "fetch_wall"):
            stage = "collecting"
            # These APIs do not expose a trustworthy report-wide total, and the
            # raw per-source counts (posts / pages) are not comparable, so we
            # never surface them as progress numbers or technical labels — the
            # modal would otherwise show jumping counters and >100% values.
            current = 0
            total = 0
            message = "Собираем публичные данные"
        elif raw_stage == "done":
            stage, current, total, message = "metrics", 0, 0, "Рассчитываем метрики"
        elif raw_stage == "metrics":
            # Drop the internal "Готово: N постов, N тем, N стены" summary — it is
            # noise for the user during collection.
            stage, current, total, message = "metrics", 0, 0, "Рассчитываем метрики"
        else:
            stage = raw_stage

        if stage not in self._RANK:
            stage = self.stage
        if self._RANK[stage] < self._RANK[self.stage]:
            return None
        if stage == "done" and self.full_report and self._RANK[self.stage] < self._RANK["saving"]:
            return None

        value = max(0, int(current or 0))
        if stage == self.stage:
            value = max(self.current, value)
        else:
            self.stage, self.current = stage, 0
        self.current = value
        known_total = max(0, int(total or 0))
        return stage, value, known_total, str(message or "")


class QueueWorker:

    def __init__(self, store: OrderStore):
        self._store  = store
        self._lock   = threading.Lock()
        self._active: Optional[str] = None  # order_id или None

    @property
    def active_order_id(self) -> Optional[str]:
        return self._active

    def start(self) -> "QueueWorker":
        recovered = self._store.recover_running()
        if recovered:
            logger.info("Восстановлено %d прерванных заказов → paid", recovered)
        threading.Thread(target=self._loop,         daemon=True, name="zs-worker").start()
        threading.Thread(target=self._cleanup_loop, daemon=True, name="zs-cleanup").start()
        return self

    # ── main loop ─────────────────────────────────────────────────────────────

    def _loop(self):
        while True:
            try:
                order = self._store.get_next_queued()
                if not order:
                    time.sleep(0.5)
                    continue
                with self._lock:
                    self._active = order["id"]
                self._process(order)
            except Exception:
                logger.exception("Worker loop: необработанная ошибка")
                time.sleep(2)
            finally:
                with self._lock:
                    self._active = None

    def _process(self, order: dict):
        order_id    = order["id"]
        user_id     = int(order["user_id"])
        report_type = order.get("report_type", "basic")
        params      = order.get("params") or {}
        logger.info("Обработка заказа %s  user=%s  type=%s", order_id, user_id, report_type)
        self._store.mark_running(order_id)

        # ── throttled, monotonic progress callback ────────────────────────
        _last = [0.0]
        tracker = ProgressTracker(full_report=True)  # ai_all_tiers_v1: ИИ у всех тарифов

        def on_progress(stage, current, total, message):
            normalized = tracker.normalize(stage, current, total, message)
            if normalized is None:
                return
            stage, current, total, message = normalized
            now = time.monotonic()
            stage_changed = stage != getattr(on_progress, "last_stage", None)
            completed = tuple(sorted(tracker.completed_stages))
            completed_changed = completed != getattr(on_progress, "last_completed", ())
            if now - _last[0] >= _PROGRESS_THROTTLE or stage_changed or completed_changed or stage == "error":
                self._store.update_progress(order_id, stage, current, total, message,
                                            completed_stages=completed)
                on_progress.last_stage = stage
                on_progress.last_completed = completed
                _last[0] = now

        try:
            # импорт внутри функции — чтобы ошибка в скриптах не роняла старт сервера
            from lolz_analyzer import LolzAnalyzer
            from ai_interpreter import analyze_with_ai, get_auth_key, get_deepseek_key, get_fireworks_keys
            from admin_service import resolve_ai_runtime, record_ai_usage, sanitize_ai_snapshot
            from private_raw_messages import persist_raw_messages

            # message-пул: 3 токена для СБОРА СООБЩЕНИЙ (ротация)
            tokens = _load_tokens()
            if not tokens:
                raise RuntimeError("Lolz-токены не настроены (secrets/messages/ или .lolz_token*)")
            # profile-пул: отдельный токен для профиля / тем / стены (НЕ сообщения).
            # Если папка secrets/profile/ пуста — фолбэк на message-пул внутри анализатора.
            profile_tokens = config.load_lolz_tokens("profile")

            analyzer = LolzAnalyzer(tokens=tokens, on_progress=on_progress,
                                    profile_tokens=profile_tokens or None)

            # Paid orders always perform a real generation. Completed dossier
            # cache reads are intentionally forbidden in the paid lifecycle.
            dossier = None
            # ai_all_tiers_v1: ИИ нужен и базовому тарифу — на обзоре сидят
            # тёмная триада, Big Five и теги (это ИИ-поля). Полный тариф
            # отличается страницами психологии/анализа, а не наличием ИИ.
            need_ai = True

            if not dossier:
                collection_started_at = datetime.now(timezone.utc)
                on_progress("profile", 0, 1, "Загружаем профиль...")
                for attempt in range(3):
                    try:
                        dossier = analyzer.analyze(
                            user_id=user_id,
                            max_timeline_pages=params.get("timeline_pages", config.DEFAULT_TIMELINE_PAGES),
                            max_thread_pages=params.get("thread_pages",   config.DEFAULT_THREAD_PAGES),
                            max_wall_pages=params.get("wall_pages",       config.DEFAULT_WALL_PAGES),
                        )
                        break
                    except Exception as exc:
                        if attempt >= 2 or not _is_transient_tls_error(exc):
                            raise
                        delay = 0.5 * (2 ** attempt)
                        logger.warning("Transient TLS profile fetch failure for %s; retry %d/2 in %.1fs",
                                       order_id, attempt + 1, delay)
                        time.sleep(delay)

                dossier["report_type"] = report_type

                # Persist the complete successful timeline collection before AI or
                # later processing can release/replace analyzer memory. The path is
                # deliberately never stored in the dossier, DB, or client response.
                raw_messages = getattr(analyzer, "_last_posts", None)
                if raw_messages is None:
                    raise RuntimeError("Analyzer did not retain collected timeline messages")
                collection_finished_at = datetime.now(timezone.utc)
                timeline_meta = dict(getattr(analyzer, "timeline_fetch_meta", {}) or {})
                post_requests = sum(
                    int(value or 0)
                    for value in (timeline_meta.get("post_requests_by_token") or {}).values()
                )
                observations = timeline_meta.get("rate_limit_observations") or []
                get_requests = sum(
                    1 for item in observations
                    if isinstance(item, dict) and item.get("method") == "GET"
                )
                persist_raw_messages(
                    config.RAW_MESSAGES_DIR,
                    order_id,
                    user_id,
                    raw_messages,
                    provenance={
                        "source": "fresh_api_fetch",
                        "started_at": collection_started_at.isoformat(),
                        "finished_at": collection_finished_at.isoformat(),
                        "windows": int(timeline_meta.get("windows_scanned", 0) or 0),
                        "pages": int(timeline_meta.get("result_pages_fetched", 0) or 0),
                        "request_counts": {
                            "POST": post_requests,
                            "GET": get_requests,
                            "total": post_requests + get_requests,
                        },
                        "cache_read": False,
                    },
                )

                # ── AI (только для full) ──────────────────────────────────
                if need_ai:
                    on_progress("ai", 0, 0, "Ожидаем завершения AI-анализа...")
                    giga_key     = get_auth_key()     or _load_key(".gigachat_key")
                    deepseek_key = get_deepseek_key() or _load_key(".deepseek_key")
                    fireworks_keys = get_fireworks_keys()
                    # Prefer the current field, but safely accept legacy queued orders.
                    snapshot = sanitize_ai_snapshot(
                        params.get("ai_config_snapshot") or params.get("ai_snapshot") or {}
                    )
                    has_admin_runtime = bool(snapshot.get("slots"))
                    # без ключей ИИ — фиксируем ошибку, а не пропускаем молча
                    if not giga_key and not deepseek_key and not fireworks_keys and not has_admin_runtime:
                        raise RuntimeError("Нет AI-ключей (Fireworks/DeepSeek/GigaChat не настроены)")
                    posts = getattr(analyzer, "_last_posts", [])
                    runtime = resolve_ai_runtime(self._store, snapshot) if has_admin_runtime else None
                    ai_result = analyze_with_ai(dossier, posts, runtime_config=runtime)
                    from lolz_analyzer import sanitize_dossier
                    dossier["ai_analysis"] = sanitize_dossier(ai_result)
                    record_ai_usage(self._store, order, ai_result, snapshot)
                    if not _has_complete_psychological_analysis(dossier):
                        raise RuntimeError("AI-анализ не вернул обязательный итоговый результат")
                    on_progress("ai", 1, 0, "AI-анализ завершён")

                _dossier_cache_put(user_id, report_type, dossier)

            # Готовность наступает только после записи итогового JSON.
            on_progress("saving", 0, 0, "Сохраняем итоговый результат...")
            result_path = config.RESULTS_DIR / f"{order_id}.json"
            result_path.write_text(
                json.dumps(dossier, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self._store.mark_done(
                order_id,
                str(result_path),
                collected_message_counts=getattr(analyzer, "collected_message_counts", None),
            )
            logger.info("Заказ %s выполнен (%s)", order_id, report_type)

            try:
                self._store.create_terminal_notification(order, Status.DONE)
            except Exception:
                logger.exception("Не удалось создать terminal-уведомление для %s", order_id)

        except Exception as e:
            logger.exception("Заказ %s — ошибка", order_id)
            self._store.mark_error(order_id, str(e))
            try:
                self._store.refund_failed_order(order_id)
            except Exception:
                logger.exception("Не удалось вернуть оплату за %s", order_id)

            try:
                self._store.create_terminal_notification(order, Status.ERROR, str(e))
            except Exception:
                logger.exception("Не удалось создать terminal-уведомление для %s", order_id)

    # ── cleanup ───────────────────────────────────────────────────────────────

    def _cleanup_loop(self):
        while True:
            time.sleep(3600)
            try:
                removed = self._store.cleanup_old()
                if removed:
                    logger.info("Cleanup: удалено %d старых заказов", removed)
            except Exception:
                logger.exception("Cleanup ошибка")


# ── helpers ───────────────────────────────────────────────────────────────────

def _is_transient_tls_error(exc: Exception) -> bool:
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(marker in text for marker in (
        "ssleoferror", "eof occurred in violation of protocol",
        "tls", "ssl: unexpected_eof", "connection reset",
    ))


def _load_tokens() -> list[str]:
    # Роль "messages": токены для анализа/парсинга сообщений (secrets/messages/*).
    return config.load_lolz_tokens("messages")


def _load_key(filename: str) -> str:
    p = config.TOKEN_DIR / filename
    return p.read_text().strip() if p.exists() else ""


def _has_complete_psychological_analysis(dossier: dict) -> bool:
    """True only when psychologist output and computed age are both usable."""
    ai_analysis = dossier.get("ai_analysis")
    if not isinstance(ai_analysis, dict):
        return False
    psychologist = ai_analysis.get("psychologist")
    if not isinstance(psychologist, dict):
        return False
    parsed = psychologist.get("parsed")
    if not isinstance(parsed, dict) or not parsed:
        return False

    portrait = dossier.get("portrait")
    if not isinstance(portrait, dict):
        return False
    psychological_age = portrait.get("psychological_age")
    if not isinstance(psychological_age, dict) or psychological_age.get("available") is not True:
        return False
    try:
        age = int(psychological_age.get("age"))
    except (TypeError, ValueError):
        return False
    return 14 <= age <= 60


def _dossier_cache_path(user_id: int, report_type: str) -> Path:
    # кеш-ключ включает тип отчёта — basic и full хранятся раздельно.
    # v2: пороги токсичности пересмотрены (мат-сленг ≠ токсик) — старые
    # досье с завышенным toxic_pct не должны отдаваться из кэша
    return config.dossier_cache_path(user_id, report_type)


def _dossier_cache_get(user_id: int, report_type: str) -> Optional[dict]:
    p = _dossier_cache_path(user_id, report_type)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > config.DOSSIER_CACHE_TTL:
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _dossier_cache_put(user_id: int, report_type: str, dossier: dict) -> None:
    p = _dossier_cache_path(user_id, report_type)
    p.write_text(json.dumps(dossier, ensure_ascii=False, indent=2), encoding="utf-8")
