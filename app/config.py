"""
Zelscan — конфигурация из env / дефолтов.
Все параметры читаются один раз при импорте.
"""
from __future__ import annotations
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default


def _env_bool(key: str, default: bool = False) -> bool:
    v = os.environ.get(key, "").strip().lower()
    return (v in ("1", "true", "yes", "on")) if v else default


# ── server ──────────────────────────────────────────────────────────────────
HOST            = _env("HOST", "0.0.0.0")
PORT            = _env_int("PORT", 5050)
DEBUG           = _env_bool("DEBUG", False)
def _env_csv(key: str, default: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(
        item.strip().rstrip("/")
        for item in os.environ.get(key, default).split(",")
        if item.strip()
    ))


# Exact origins only. Local development remains available on the current ports.
ALLOWED_ORIGINS = _env_csv(
    "ALLOWED_ORIGINS",
    "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5050,http://127.0.0.1:5050",
)
# Explicit override. Production and real HTTPS are additionally enforced per request
# by app/security.py; localhost HTTP remains usable outside production.
SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", False)

# ── Lolzteam OAuth2 (вход через форум) ──────────────────────────────────────
# client_id OAuth-приложения: env LOLZ_OAUTH_CLIENT_ID или файл
# .lolz_oauth_client_id в корне проекта. Пусто → вход через форум отключён,
# фронт показывает фолбэк (ручной ввод токена).
LOLZ_OAUTH_CLIENT_ID = _env("LOLZ_OAUTH_CLIENT_ID", "")
_oauth_id_file = PROJECT_ROOT / ".lolz_oauth_client_id"
if not LOLZ_OAUTH_CLIENT_ID and _oauth_id_file.is_file():
    LOLZ_OAUTH_CLIENT_ID = _oauth_id_file.read_text(encoding="utf-8").strip()
LOLZ_OAUTH_AUTHORIZE_URL = _env("LOLZ_OAUTH_AUTHORIZE_URL", "https://lolz.team/account/authorize/")
LOLZ_OAUTH_SCOPE          = _env("LOLZ_OAUTH_SCOPE", "basic")
# redirect_uri is server-configured only; never derive it from request headers.
LOLZ_OAUTH_REDIRECT_URI = _env("LOLZ_OAUTH_REDIRECT_URI", "")
_redirect_uri_file = PROJECT_ROOT / ".lolz_oauth_redirect_uri"
if not LOLZ_OAUTH_REDIRECT_URI and _redirect_uri_file.is_file():
    LOLZ_OAUTH_REDIRECT_URI = _redirect_uri_file.read_text(encoding="utf-8").strip()
LOLZ_OAUTH_REDIRECT_URIS = _env_csv(
    "LOLZ_OAUTH_REDIRECT_URIS",
    "http://localhost:8080/oauth_callback.html,http://127.0.0.1:8080/oauth_callback.html",
)
if LOLZ_OAUTH_REDIRECT_URI:
    LOLZ_OAUTH_REDIRECT_URIS = tuple(dict.fromkeys(
        (LOLZ_OAUTH_REDIRECT_URI,) + LOLZ_OAUTH_REDIRECT_URIS
    ))
LOLZ_OAUTH_REDIRECT_URI = LOLZ_OAUTH_REDIRECT_URIS[0]

# ── Lolz Market merchant (пополнение через инвойсы) ─────────────────────────
# Токен из lolz.live/account/api со скоупами market+invoice, merchant_id —
# из lolz.team/pages/merchant. env или файлы в корне проекта.
LOLZ_MARKET_TOKEN = _env("LOLZ_MARKET_TOKEN", "")
_mt_file = PROJECT_ROOT / ".lolz_market_token"
if not LOLZ_MARKET_TOKEN and _mt_file.is_file():
    LOLZ_MARKET_TOKEN = _mt_file.read_text(encoding="utf-8").strip()
LOLZ_MERCHANT_ID = _env_int("LOLZ_MERCHANT_ID", 0)
_mi_file = PROJECT_ROOT / ".lolz_merchant_id"
if not LOLZ_MERCHANT_ID and _mi_file.is_file():
    try:
        LOLZ_MERCHANT_ID = int(_mi_file.read_text(encoding="utf-8").strip())
    except ValueError:
        LOLZ_MERCHANT_ID = 0

# url_success инвойса: должен быть публичный https-URL (localhost API не примет).
# env LOLZ_TOPUP_SUCCESS_URL или файл .lolz_topup_success_url.
LOLZ_TOPUP_SUCCESS_URL = _env("LOLZ_TOPUP_SUCCESS_URL", "https://lolz.team/")
_su_file = PROJECT_ROOT / ".lolz_topup_success_url"
if _su_file.is_file():
    v = _su_file.read_text(encoding="utf-8").strip()
    if v:
        LOLZ_TOPUP_SUCCESS_URL = v

# ── paths ────────────────────────────────────────────────────────────────────
DB_PATH     = Path(_env("DB_PATH",    str(PROJECT_ROOT / "zelscan.db"))).resolve()
CACHE_DIR   = Path(_env("CACHE_DIR",  str(PROJECT_ROOT / "cache"))).resolve()
RESULTS_DIR = CACHE_DIR / "results"
# Complete source messages live outside every web/static/cache tree.
RAW_MESSAGES_DIR = Path(_env(
    "RAW_MESSAGES_DIR", str(PROJECT_ROOT / "data" / "private" / "raw_messages")
)).resolve()
LOG_DIR     = Path(_env("LOG_DIR",    str(PROJECT_ROOT / "logs"))).resolve()
TOKEN_DIR   = PROJECT_ROOT

# ── lolz tokens, split by role ───────────────────────────────────────────────
# Токены разведены по назначению, чтобы тяжёлый парсинг сообщений не съедал
# лимиты у лёгких запросов (поиск / профиль / аватары).
#   secrets/messages/*  → анализ сообщений (сбор досье, ротация 3 токенов)
#   secrets/search/*    → поиск, топ, аватары, forum-status, health
# Добавить токен = просто положить новый файл в нужную папку (код читает всю папку).
SECRETS_DIR = Path(_env("SECRETS_DIR", str(PROJECT_ROOT / "secrets"))).resolve()

# Легаси-файлы в корне (фолбэк, если папки ролей ещё не заполнены).
_LEGACY_TOKEN_FILES = (".lolz_token", ".lolz_token_2", ".lolz_token_3")


def load_lolz_tokens(role: str) -> list[str]:
    """Вернуть список токенов для роли ('messages' | 'search').

    Читает ВСЕ непустые файлы из secrets/<role>/ (в отсортированном порядке).
    Если папка роли пуста/отсутствует — фолбэк на легаси .lolz_token* в корне,
    чтобы ничего не сломалось до раскладки новых токенов.
    """
    tokens: list[str] = []
    seen: set[str] = set()
    role_dir = SECRETS_DIR / role
    if role_dir.is_dir():
        for p in sorted(role_dir.iterdir()):
            if not p.is_file() or p.name.startswith("."):
                continue
            t = p.read_text(encoding="utf-8").strip()
            if t and t not in seen:
                seen.add(t)
                tokens.append(t)
    if tokens:
        return tokens
    # ── фолбэк на легаси-файлы ──
    for name in _LEGACY_TOKEN_FILES:
        p = TOKEN_DIR / name
        if p.exists():
            t = p.read_text(encoding="utf-8").strip()
            if t and t not in seen:
                seen.add(t)
                tokens.append(t)
    return tokens

# Destructive maintenance is fail-closed. Production data may only be physically
# removed by a separately reviewed, explicitly scoped legal-erasure workflow.
ALLOW_PHYSICAL_DATA_DELETION = _env_bool("ALLOW_PHYSICAL_DATA_DELETION", False)
PRODUCTION_DB_PATH = (PROJECT_ROOT / "zelscan.db").resolve()
PRODUCTION_CACHE_DIR = (PROJECT_ROOT / "cache").resolve()


def assert_non_production_storage(db_path: Path, cache_dir: Path | None = None) -> None:
    """Reject tests/maintenance that accidentally target live DB or cache paths."""
    db = Path(db_path).resolve()
    cache = Path(cache_dir).resolve() if cache_dir is not None else None
    if db == PRODUCTION_DB_PATH or (cache is not None and cache == PRODUCTION_CACHE_DIR):
        raise RuntimeError("Refusing destructive/test operation against production storage")

# ── queue ────────────────────────────────────────────────────────────────────
MAX_CONCURRENT    = _env_int("MAX_CONCURRENT",    1)    # 1 отчёт за раз
RESULT_TTL_DAYS   = _env_int("RESULT_TTL_DAYS",   7)    # хранить файлы N дней
# Локальная/открытая версия: любой авторизованный юзер — полный админ, пароля нет
LOCAL_OPEN_ADMIN = os.environ.get("LOCAL_OPEN_ADMIN", "1") == "1"

DOSSIER_CACHE_TTL = _env_int("DOSSIER_CACHE_TTL", 3600) # 1 ч кеш досье


def dossier_cache_path(user_id, report_type):
    """Единый путь к файлу кэша досье (+ фолбэк на имя до инвалидаv2)."""
    base = f"dossier_{user_id}_{report_type or 'basic'}"
    return CACHE_DIR / f"{base}_v2.json"


def dossier_cache_candidates(user_id, report_type):
    base = f"dossier_{user_id}_{report_type or 'basic'}"
    return (CACHE_DIR / f"{base}_v2.json", CACHE_DIR / f"{base}.json")
AI_CACHE_TTL      = _env_int("AI_CACHE_TTL",      21600)# 6 ч кеш AI

# ── analyzer defaults ────────────────────────────────────────────────────────
DEFAULT_TIMELINE_PAGES = _env_int("DEFAULT_TIMELINE_PAGES", 60)  # Zelscan full API pagination v3
DEFAULT_THREAD_PAGES   = _env_int("DEFAULT_THREAD_PAGES",   15)
DEFAULT_WALL_PAGES     = _env_int("DEFAULT_WALL_PAGES",      5)
MAX_TIMELINE_PAGES     = _env_int("MAX_TIMELINE_PAGES",     60)
MAX_THREAD_PAGES       = _env_int("MAX_THREAD_PAGES",       50)

# ── pricing display ──────────────────────────────────────────────────────────
PRICE_BASIC = _env("PRICE_BASIC", "9 ₽")
PRICE_FULL  = _env("PRICE_FULL",  "19 ₽")

# ── credit pricing (1 ₽ = 1 кредит) ─────────────────────────────────────────
# Стоимость отчёта в кредитах при покупке с баланса (тестовые значения).
CREDIT_COST_BASIC = _env_int("CREDIT_COST_BASIC", 0)
CREDIT_COST_FULL  = _env_int("CREDIT_COST_FULL",  0)

# ── Cloudflare Turnstile (капча на платёжных действиях) ─────────────────────
# Файлы в корне: .turnstile_sitekey / .turnstile_secret (или env). Если нет —
# капча выключена и эндпоинты работают как раньше.
TURNSTILE_SITEKEY = _env("TURNSTILE_SITEKEY", (TOKEN_DIR / ".turnstile_sitekey").read_text(encoding="utf-8").strip() if (TOKEN_DIR / ".turnstile_sitekey").exists() else "")
TURNSTILE_SECRET  = _env("TURNSTILE_SECRET",  (TOKEN_DIR / ".turnstile_secret").read_text(encoding="utf-8").strip() if (TOKEN_DIR / ".turnstile_secret").exists() else "")
TURNSTILE_ENABLED = bool(TURNSTILE_SITEKEY and TURNSTILE_SECRET)

# ── ensure dirs ──────────────────────────────────────────────────────────────
CACHE_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)
