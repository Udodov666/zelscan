"""
AI-интерпретатор досье через GigaChat.

Гибридная схема:
  • GigaChat (Lite) — базовый портрет + сценарии (больше токенов, но дёшево)
  • GigaChat-Max — тонкие инсайты + однострочник (мало токенов, но качественно)

Запросы идут параллельно через потоки (не asyncio, чтобы не тащить зависимость).

Auth flow:
  1. POST /api/v2/oauth → access_token (живёт 30 мин)
  2. POST /api/v1/chat/completions с Bearer access_token
  3. Кешируем токен, обновляем за 5 мин до истечения
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from string import Template
from pathlib import Path
from typing import Optional

import requests


# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------

GIGA_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
GIGA_API_URL = "https://gigachat.devices.sberbank.ru/api/v1"
GIGA_SCOPE = "GIGACHAT_API_PERS"

# DeepSeek (OpenAI-compatible)
DEEPSEEK_API_URL = "https://api.deepseek.com/v1"
DEEPSEEK_FLASH = "deepseek-v4-flash"  # дёшево, быстро — для базового портрета
DEEPSEEK_PRO = "deepseek-v4-pro"      # умнее — для психолога

# Fireworks AI (OpenAI-compatible, основной провайдер)
FIREWORKS_API_URL = "https://api.fireworks.ai/inference/v1"
# Модели Fireworks по назначению (дефолты, переопределяются из admin_config)
FIREWORKS_LITE = "accounts/fireworks/models/qwen3p7-plus"          # быстро, дёшево — lite
FIREWORKS_MAX = "accounts/fireworks/models/deepseek-v4-flash"      # качество — max
FIREWORKS_PSYCHOLOGIST = "accounts/fireworks/models/deepseek-v4-pro"  # reasoning — психолог

# Модели GigaChat
LITE_MODEL = "GigaChat"          # ~475K токенов на балансе, дёшево
MAX_MODEL = "GigaChat-Max"       # ~50K токенов, дорого но умно (Russian-tuned)

# Таймауты
HTTP_TIMEOUT = 300
TOKEN_REFRESH_BEFORE = 300  # 5 минут до истечения

# Путь к промпту психолога
PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def _load_psychologist_prompt() -> str:
    """Загружает системный промпт психолога из файла."""
    p = PROMPTS_DIR / "personality_analyst.md"
    if p.exists():
        return p.read_text(encoding="utf-8")
    # Fallback если файла нет
    return """Ты — психолог-аналитик. Сделай портрет личности на основе фактов и постов. Пиши живо, на современном русском."""


# ---------------------------------------------------------------------------
# System prompts — калибровка под живой разговорный русский 2026
# ---------------------------------------------------------------------------

LITE_SYSTEM_PROMPT = """Ты — нейтральный аналитик форумной активности. Тебе дали пакет фактов о пользователе и несколько его постов. Составь краткий, доказательный портрет наблюдаемого поведения.

ПРАВИЛА:
- Пиши на нейтральном современном русском, без сленга, мата, оскорблений и ярлыков.
- Отделяй факт от гипотезы: факты пересказывай как факты; выводы маркируй «может указывать», «по этим примерам», «вероятно».
- Не ставь диагнозов, не приписывай мотивы, намерения, скрытые качества или устойчивые черты без прямых данных.
- Не повторяй одну мысль разными словами. Пиши коротко и конкретно.
- Если постов или фактов мало, прямо укажи, что вывод предварительный и ограничен выборкой.

ЧТО СДЕЛАТЬ:
1. psychological_portrait — 2–3 коротких абзаца о наблюдаемом стиле общения и активности.
2. behavior_scenarios — осторожные сценарии для вопроса по делу, несогласия и обращения новичка; не утверждай реакцию как факт.
3. key_traits — 3–5 кратких наблюдаемых характеристик или осторожных гипотез.

ВЕРНИ СТРОГО JSON:
{
  "psychological_portrait": "...",
  "behavior_scenarios": {
    "спросить_по_делу": "...",
    "спорить": "...",
    "новичок_обратится": "..."
  },
  "key_traits": ["...", "...", "..."]
}

Не выдумывай фактов. При малой выборке обязательно добавь оговорку о её ограниченности.

КОМПАКТНЫЙ ФОРМАТ ZELSCAN V1:
- Пиши простым человеческим русским: без канцелярита, псевдопсихологических диагнозов, «мета-» формулировок и объяснения хода рассуждений модели.
- Краткие поля не должны содержать проценты, номера постов, прямые цитаты, количество тем/сообщений или несколько примеров подряд.
- Не повторяй одну мысль в заголовке и описании. Не пиши «пользователь проявляет тенденцию к» — говори прямо и осторожно.
- psychological_portrait: максимум 2 коротких предложения, до 280 символов.
- hidden_signals: максимум 2 коротких предложения, до 220 символов.
- verdict_one_line: одно законченное предложение, до 78 символов (hero максимум три строки).
- key_traits: максимум три тега; каждый тег — 1–3 простых слова, не предложение.
- Каждый элемент списков predicted_triggers / behavior_scenarios: одно короткое практическое предложение, до 100 символов.
- Если уверенность низкая, скажи это одной короткой оговоркой, не расписывай методику.
"""

MAX_SYSTEM_PROMPT = """Ты — нейтральный аналитик. Найди только те неочевидные закономерности, которые можно обосновать фактами и примерами постов.

ПРАВИЛА:
- Нейтральный, доказательный русский без сленга, мата, оскорблений и ярлыков.
- Явно различай факт и гипотезу: используй «может указывать», «по доступным примерам», «вероятно».
- Не утверждай мотивы, намерения, диагнозы или будущую реакцию человека как установленный факт.
- Не повторяйся; пиши кратко.
- При малом числе постов или фактов укажи, что выводы предварительны и ограничены выборкой.

ЧТО СДЕЛАТЬ:
1. hidden_signals — осторожные наблюдения о расхождениях и закономерностях, 2–4 предложения.
2. predicted_triggers — только темы, по которым есть наблюдаемые признаки; формулируй как возможную чувствительность, не как гарантированную реакцию.
3. verdict_one_line — одно нейтральное, доказательное предложение, сформулированное своими словами: не пересказывай и не перефразируй готовое краткое описание из данных (поле verdict.summary / summary), иначе блок ИИ продублирует шапку отчёта.

ВЕРНИ СТРОГО JSON:
{
  "hidden_signals": "...",
  "predicted_triggers": ["...", "..."],
  "verdict_one_line": "..."
}

Не выдумывай фактов и не выдавай гипотезы за факты.

КОМПАКТНЫЙ ФОРМАТ ZELSCAN V1:
- Пиши простым человеческим русским: без канцелярита, псевдопсихологических диагнозов, «мета-» формулировок и объяснения хода рассуждений модели.
- Краткие поля не должны содержать проценты, номера постов, прямые цитаты, количество тем/сообщений или несколько примеров подряд.
- Не повторяй одну мысль в заголовке и описании. Не пиши «пользователь проявляет тенденцию к» — говори прямо и осторожно.
- psychological_portrait: максимум 2 коротких предложения, до 280 символов.
- hidden_signals: максимум 2 коротких предложения, до 220 символов.
- verdict_one_line: одно законченное предложение, до 78 символов (hero максимум три строки).
- key_traits: максимум три тега; каждый тег — 1–3 простых слова, не предложение.
- Каждый элемент списков predicted_triggers / behavior_scenarios: одно короткое практическое предложение, до 100 символов.
- Если уверенность низкая, скажи это одной короткой оговоркой, не расписывай методику.
"""


# ---------------------------------------------------------------------------
# DeepSeek клиент (OpenAI-compatible, без авторизации по токену)
# ---------------------------------------------------------------------------

class DeepSeekClient:
    """Простой клиент для DeepSeek API (OpenAI-совместимый формат)."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
    
    def chat(self, model: str, system_prompt: str, user_prompt: str,
             temperature: float = 0.5, max_tokens: int = 1500,
             response_format_json: bool = False) -> dict:
        """Отправляет chat completion. Возвращает {content, usage}."""
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        # Для structured JSON
        if response_format_json:
            payload["response_format"] = {"type": "json_object"}
        
        try:
            r = requests.post(
                f"{DEEPSEEK_API_URL}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                json=payload,
                timeout=HTTP_TIMEOUT,
            )
            if r.status_code != 200:
                return {
                    "error": f"HTTP {r.status_code}: {r.text[:200]}",
                    "content": None,
                    "usage": None,
                }
            data = r.json()
            return {
                "content": data["choices"][0]["message"]["content"],
                "usage": data.get("usage", {}),
            }
        except Exception as e:
            return {
                "error": f"request failed: {e}",
                "content": None,
                "usage": None,
            }


# ---------------------------------------------------------------------------
# Fireworks AI клиент (OpenAI-compatible, с failover между ключами)
# ---------------------------------------------------------------------------

class FireworksClient:
    """
    Клиент для Fireworks AI с поддержкой failover между несколькими API-ключами.
    
    Если активный ключ возвращает ошибку 402/429 (нехватка баланса/rate-limit),
    автоматически переключается на следующий ключ из списка.
    """
    
    def __init__(self, api_keys: list[str]):
        """
        Args:
            api_keys: список API-ключей Fireworks (минимум 1)
        """
        if not api_keys:
            raise ValueError("FireworksClient требует хотя бы один API-ключ")
        self.api_keys = api_keys
        self.current_index = 0
        self._lock = threading.Lock()
    
    def _next_key(self):
        """Переключается на следующий ключ (циклично)."""
        with self._lock:
            self.current_index = (self.current_index + 1) % len(self.api_keys)
            return self.api_keys[self.current_index]
    
    def _current_key(self):
        """Возвращает текущий активный ключ."""
        with self._lock:
            return self.api_keys[self.current_index]
    
    def chat(self, model: str, system_prompt: str, user_prompt: str,
             temperature: float = 0.5, max_tokens: int = 1500,
             response_format_json: bool = False) -> dict:
        """
        Отправляет chat completion. Возвращает {content, usage, key_used}.
        
        При ошибке 402/429 пытается failover на другие ключи (до 3 попыток).
        """
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if response_format_json:
            payload["response_format"] = {"type": "json_object"}
        
        attempts = min(3, len(self.api_keys))  # пытаемся до 3 ключей
        last_error = None
        
        for attempt in range(attempts):
            key = self._current_key()
            try:
                r = requests.post(
                    f"{FIREWORKS_API_URL}/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {key}",
                    },
                    json=payload,
                    timeout=HTTP_TIMEOUT,
                )
                
                # Успех
                if r.status_code == 200:
                    data = r.json()
                    return {
                        "content": data["choices"][0]["message"]["content"],
                        "usage": data.get("usage", {}),
                        "key_used": key[:20] + "...",  # маскируем ключ
                    }
                
                # Failover при нехватке баланса или rate-limit
                if r.status_code in (402, 429) and attempt < attempts - 1:
                    next_key = self._next_key()
                    last_error = f"HTTP {r.status_code} (key ...{key[-8:]}), failover to ...{next_key[-8:]}"
                    time.sleep(0.5)  # небольшая пауза перед следующей попыткой
                    continue
                
                # Другая ошибка — возвращаем
                last_error = f"HTTP {r.status_code}: {r.text[:200]}"
                break
                
            except Exception as e:
                last_error = f"request failed: {e}"
                if attempt < attempts - 1:
                    self._next_key()
                    time.sleep(0.5)
                    continue
                break
        
        return {
            "error": last_error or "all keys exhausted",
            "content": None,
            "usage": None,
        }
    
    def get_balance(self, key_index: int = None) -> dict:
        """
        Получает баланс ключа через Fireworks API (если доступно).
        
        Args:
            key_index: индекс ключа в списке (None = текущий активный)
        
        Returns:
            {"balance": float, "currency": "USD", "error": str|None}
        
        Note: Fireworks не предоставляет публичный API для баланса,
        поэтому возвращаем заглушку. Баланс отслеживаем через usage.
        """
        # Fireworks не имеет публичного эндпоинта баланса — трекинг через usage
        return {"balance": None, "currency": "USD", "error": "Balance API not available (track via usage)"}


# ---------------------------------------------------------------------------
# GigaChat клиент с авторизацией
# ---------------------------------------------------------------------------

class GigaChatClient:
    """Авторизация + кеширование access_token."""
    
    def __init__(self, auth_key: str):
        self.auth_key = auth_key
        self.access_token: Optional[str] = None
        self.token_expires: float = 0
        self._lock = threading.Lock()
    
    def _get_access_token(self) -> str:
        """Получает свежий access_token, кеширует до истечения."""
        with self._lock:
            now = time.time()
            if self.access_token and now < self.token_expires - TOKEN_REFRESH_BEFORE:
                return self.access_token
            
            rquid = str(uuid.uuid4())
            try:
                r = requests.post(
                    GIGA_AUTH_URL,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                        "RqUID": rquid,
                        "Authorization": f"Basic {self.auth_key}",
                    },
                    data=f"scope={urllib.parse.quote(GIGA_SCOPE)}",
                    timeout=HTTP_TIMEOUT,
                    verify=False,  # SSL Сбера иногда капризничает
                )
                r.raise_for_status()
                data = r.json()
                token = data.get("access_token")
                expires_in = int(data.get("expires_in", 1800))
                if not token:
                    raise RuntimeError(f"no access_token in response: {data}")
                self.access_token = token
                self.token_expires = now + expires_in
                return token
            except Exception as e:
                raise RuntimeError(f"GigaChat auth failed: {e}")
    
    def chat(self, model: str, system_prompt: str, user_prompt: str,
             temperature: float = 0.5, max_tokens: int = 1500) -> dict:
        """Отправляет chat completion запрос. Возвращает {content, usage}."""
        token = self._get_access_token()
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        try:
            r = requests.post(
                f"{GIGA_API_URL}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                json=payload,
                timeout=HTTP_TIMEOUT,
                verify=False,
            )
            if r.status_code != 200:
                return {
                    "error": f"HTTP {r.status_code}: {r.text[:200]}",
                    "content": None,
                    "usage": None,
                }
            data = r.json()
            return {
                "content": data["choices"][0]["message"]["content"],
                "usage": data.get("usage", {}),
            }
        except Exception as e:
            return {
                "error": f"request failed: {e}",
                "content": None,
                "usage": None,
            }


# ---------------------------------------------------------------------------
# AI-интерпретатор
# ---------------------------------------------------------------------------

class AIInterpreter:
    """Гибридный AI-анализ: Fireworks (основной) + DeepSeek/GigaChat (fallback)."""
    
    def __init__(self, gigachat_auth_key: str = "", deepseek_api_key: str = "", 
                 fireworks_keys: list[str] = None):
        """
        Args:
            gigachat_auth_key: GigaChat auth key (fallback)
            deepseek_api_key: DeepSeek API key (fallback)
            fireworks_keys: список Fireworks API ключей (основной провайдер)
        """
        self.client = GigaChatClient(gigachat_auth_key) if gigachat_auth_key else None
        self.deepseek = DeepSeekClient(deepseek_api_key) if deepseek_api_key else None
        self.fireworks = FireworksClient(fireworks_keys) if fireworks_keys else None
        self._giga_available = bool(gigachat_auth_key)
    
    def analyze(self, dossier: dict, posts_for_lite: list[dict],
                posts_for_max: list[dict], posts_for_psych: list[dict] = None) -> dict:
        """
        Параллельно вызывает Lite + Max + Max(психолог), объединяет результаты.
        
        Returns:
            {
                "lite": {...},           # базовый портрет + сценарии
                "max": {...},            # hidden signals + триггеры + однострочник
                "psychologist": {...},   # Big Five + тёмная триада + типажи + манера
                "models_used": {lite, max, psychologist},
                "elapsed_seconds": float
            }
        """
        t0 = time.time()
        
        # Готовим промпты
        lite_prompt = self._build_lite_prompt(dossier, posts_for_lite)
        max_prompt = self._build_max_prompt(dossier, posts_for_max)
        
        # Промпт психолога
        if posts_for_psych is None:
            posts_for_psych = posts_for_max  # используем те же 3 поста
        psych_prompt = self._build_psychologist_prompt(dossier, posts_for_psych)
        psych_system = _load_psychologist_prompt()
        
        # Последовательные запросы (для устойчивости к rate-limit)
        # Стратегия v6 (Fireworks-first):
        #   - Базовый портрет (lite) → Fireworks lite (qwen3p7-plus) → fallback DeepSeek/GigaChat
        #   - Инсайты + one-liner → Fireworks max (deepseek-v4-flash) → fallback DeepSeek/GigaChat
        #   - Психолог → Fireworks psychologist (deepseek-v4-pro) → fallback DeepSeek/GigaChat
        results = {"lite": None, "max": None, "psychologist": None}

        # 1. Базовый портрет — Fireworks → fallback DeepSeek → fallback GigaChat
        if self.fireworks:
            results["lite"] = self.fireworks.chat(FIREWORKS_LITE, LITE_SYSTEM_PROMPT, lite_prompt, 0.5, 2000)
            results["lite"]["model"] = FIREWORKS_LITE
        elif self.deepseek:
            results["lite"] = self.deepseek.chat(DEEPSEEK_FLASH, LITE_SYSTEM_PROMPT, lite_prompt, 0.5, 2000)
            results["lite"]["model"] = DEEPSEEK_FLASH
        elif self._giga_available:
            results["lite"] = self.client.chat(LITE_MODEL, LITE_SYSTEM_PROMPT, lite_prompt, 0.5, 2000)
            results["lite"]["model"] = LITE_MODEL
        time.sleep(1)

        # 2. Инсайты + one-liner — Fireworks → fallback DeepSeek → fallback GigaChat
        if self.fireworks:
            results["max"] = self.fireworks.chat(FIREWORKS_MAX, MAX_SYSTEM_PROMPT, max_prompt, 0.4, 1000)
            results["max"]["model"] = FIREWORKS_MAX
        elif self.deepseek:
            results["max"] = self.deepseek.chat(DEEPSEEK_FLASH, MAX_SYSTEM_PROMPT, max_prompt, 0.4, 1000)
            results["max"]["model"] = DEEPSEEK_FLASH
        elif self._giga_available:
            results["max"] = self.client.chat(MAX_MODEL, MAX_SYSTEM_PROMPT, max_prompt, 0.4, 1000)
            results["max"]["model"] = MAX_MODEL
        time.sleep(1)

        # 3. Психолог — Fireworks (reasoning-capable) → fallback DeepSeek → fallback GigaChat
        psych_model_used = "none"  # по умолчанию fallback
        if self.fireworks:
            # Fireworks с reasoning-моделью (deepseek-v4-pro) — больше токенов для reasoning
            for max_tok in [12000, 16000]:
                results["psychologist"] = self.fireworks.chat(
                    FIREWORKS_PSYCHOLOGIST,
                    psych_system,
                    psych_prompt,
                    0.4,
                    max_tok,
                    response_format_json=True,
                )
                if results["psychologist"].get("content"):
                    results["psychologist"]["model"] = FIREWORKS_PSYCHOLOGIST
                    psych_model_used = FIREWORKS_PSYCHOLOGIST
                    print(f"  → Fireworks психолог OK (max_tokens={max_tok})", file=sys.stderr)
                    break
                print(f"  → Fireworks пустой content при max_tokens={max_tok}, retry...", file=sys.stderr)
        
        # Fallback на DeepSeek если Fireworks не сработал
        if not results["psychologist"] or not results["psychologist"].get("content"):
            if self.deepseek:
                for max_tok in [12000, 16000]:
                    results["psychologist"] = self.deepseek.chat(
                        DEEPSEEK_FLASH,
                        psych_system,
                        psych_prompt,
                        0.4,
                        max_tok,
                        response_format_json=True,
                    )
                    if results["psychologist"].get("content"):
                        results["psychologist"]["model"] = DEEPSEEK_FLASH
                        psych_model_used = DEEPSEEK_FLASH
                        print(f"  → DeepSeek психолог OK (fallback, max_tokens={max_tok})", file=sys.stderr)
                        break
                    print(f"  → DeepSeek пустой content при max_tokens={max_tok}, retry...", file=sys.stderr)
            
            # Последний fallback на GigaChat если ни Fireworks, ни DeepSeek не помогли
            if not results["psychologist"] or not results["psychologist"].get("content"):
                if self._giga_available:
                    print(f"  → Fallback на GigaChat Lite для психолога", file=sys.stderr)
                    results["psychologist"] = self.client.chat(LITE_MODEL, psych_system, psych_prompt, 0.4, 1500)
                    results["psychologist"]["model"] = LITE_MODEL
                    psych_model_used = LITE_MODEL
                else:
                    print(f"  → Все AI провайдеры недоступны для психолога", file=sys.stderr)
                    results["psychologist"] = {"error": "All AI providers failed", "content": None, "usage": None}
        
        elapsed = time.time() - t0
        
        # Парсим JSON-ответы
        lite_parsed = self._parse_json_response(results["lite"]["content"]) if results["lite"].get("content") else None
        max_parsed = self._parse_json_response(results["max"]["content"]) if results["max"].get("content") else None
        psych_parsed = self._parse_json_response(results["psychologist"]["content"]) if results["psychologist"].get("content") else None

        # Постобработка: LLM игнорирует запреты в промпте, поэтому кринж-фразы
        # и старые ярлыки (Технарь→Шарит, Фиксер→Решала) чистим жёстко на выходе
        lite_parsed = self._sanitize_ai_output(lite_parsed)
        max_parsed = self._sanitize_ai_output(max_parsed)
        psych_parsed = self._sanitize_ai_output(psych_parsed)

        # Zelscan psych quality gate v1: противоречивый результат психолога →
        # одна корректирующая попытка; при неудаче сохраняем первый ответ.
        if self._psych_uninformative(psych_parsed):
            retry = self._retry_psychologist_once(psych_system, psych_prompt)
            if retry:
                results["psychologist"] = retry
                psych_parsed = self._parse_json_response(retry.get("content")) if retry.get("content") else None
                psych_parsed = self._sanitize_ai_output(psych_parsed)

        status_relation = self._normalize_status_relation(psych_parsed)

        # Гибрид: AI слегка корректирует алгоритмический психологический возраст.
        # Обновляет dossier["portrait"]["psychological_age"] in-place (mutable).
        try:
            self._adjust_psychological_age(dossier, psych_parsed)
        except Exception:
            pass  # при любой ошибке остаётся алгоритмическая база

        return {
            "status_relation": status_relation,
            "lite": {
                "raw_response": results["lite"].get("content"),
                "parsed": lite_parsed,
                "usage": results["lite"].get("usage"),
                "error": results["lite"].get("error"),
                "model": results["lite"].get("model", "unknown"),
            },
            "max": {
                "raw_response": results["max"].get("content"),
                "parsed": max_parsed,
                "usage": results["max"].get("usage"),
                "error": results["max"].get("error"),
                "model": results["max"].get("model", "unknown"),
            },
            "psychologist": {
                "raw_response": results["psychologist"].get("content"),
                "parsed": psych_parsed,
                "usage": results["psychologist"].get("usage"),
                "error": results["psychologist"].get("error"),
                "model": psych_model_used,
            },
            "models_used": {
                "lite": results["lite"].get("model") if lite_parsed else None,
                "max": results["max"].get("model") if max_parsed else None,
                "psychologist": psych_model_used if psych_parsed else None,
            },
            "elapsed_seconds": round(elapsed, 2),
        }
    
    def _adjust_psychological_age(self, dossier: dict, psych_parsed: Optional[dict]) -> None:
        """Гибрид: AI корректирует алгоритмическую базу психологического возраста.

        Алгоритм (lolz_analyzer.analyze_psychological_age) уже посчитал число из
        реальных сигналов. Здесь AI смотрит на базу + факты + портрет и может
        сдвинуть её в узком коридоре (±5 лет), НЕ выдумывая с нуля. Итог
        записывается обратно в dossier["portrait"]["psychological_age"].
        """
        portrait = dossier.get("portrait") or {}
        pa = portrait.get("psychological_age") or {}
        if not pa.get("available") or "age" not in pa:
            return  # нет алгоритмической базы — нечего корректировать

        base_age = int(pa["age"])
        lo, hi = pa.get("range", [14, 60])
        # коридор коррекции: не более ±5 лет от базы, в пределах общего диапазона
        adj_lo = max(int(lo), base_age - 5)
        adj_hi = min(int(hi), base_age + 5)

        # выбираем доступный провайдер
        provider = self.fireworks or self.deepseek or self.client
        if provider is None:
            return

        emotion = portrait.get("emotion", {}) or {}
        ego = portrait.get("ego", {}) or {}
        confidence = portrait.get("confidence", {}) or {}
        literacy = portrait.get("literacy", {}) or {}
        manner = portrait.get("manner", {}) or {}
        portrait_text = ""
        if isinstance(psych_parsed, dict):
            portrait_text = str(psych_parsed.get("psychological_portrait") or "")[:500]

        facts = (
            f"Алгоритмическая база возраста: {base_age} лет "
            f"(допустимо скорректировать только в диапазоне {adj_lo}–{adj_hi}).\n"
            f"Грамотность: {literacy.get('score', 0)}/100, "
            f"слов/сообщение: {literacy.get('avg_words_per_post', 0)}\n"
            f"Эмоции: нейтрально {emotion.get('neutral_pct', 0)}%, "
            f"токсично {emotion.get('toxic_pct', 0)}%, "
            f"негатив {emotion.get('negative_pct', 0)}%\n"
            f"Эго-индекс: {ego.get('per_100', 0)} на 100 слов\n"
            f"Уверенность: {confidence.get('score', 0)}%\n"
            f"Манера: {manner.get('primary', '?')} + {manner.get('secondary', '?')}\n"
            f"Портрет: {portrait_text}\n"
        )

        system = (
            "Ты — аналитик, оцениваешь ПСИХОЛОГИЧЕСКИЙ возраст человека по манере "
            "общения на форуме (не паспортный). Тебе дают алгоритмическую оценку и "
            "факты. Твоя задача — при необходимости слегка скорректировать число, "
            "оставаясь СТРОГО в разрешённом диапазоне. Не выдумывай данные. "
            "Если факты согласуются с базой — верни базу без изменений. "
            "Верни СТРОГО JSON: "
            '{"psychological_age": <int>, "reason": "<до 90 символов>"}'
        )
        prompt = (
            f"{facts}\nВерни итоговый психологический возраст "
            f"(целое число {adj_lo}–{adj_hi}) и краткую причину."
        )

        try:
            if provider is self.client:
                resp = provider.chat(LITE_MODEL, system, prompt, 0.3, 200)
            elif provider is self.fireworks:
                resp = provider.chat(FIREWORKS_PSYCHOLOGIST, system, prompt, 0.3, 200,
                                     response_format_json=True)
            else:
                resp = provider.chat(DEEPSEEK_FLASH, system, prompt, 0.3, 200,
                                     response_format_json=True)
        except Exception:
            return

        parsed = self._parse_json_response(resp.get("content")) if resp.get("content") else None
        if not isinstance(parsed, dict):
            return

        try:
            ai_age = int(round(float(parsed.get("psychological_age"))))
        except (TypeError, ValueError):
            return

        # жёстко зажимаем в разрешённый коридор
        ai_age = max(adj_lo, min(adj_hi, ai_age))
        reason = str(parsed.get("reason") or "").strip()[:120]

        pa["age"] = ai_age
        pa["source"] = "ai_adjusted"
        pa["algorithmic_base"] = base_age
        if reason:
            pa["ai_reason"] = reason

        # обновляем вердикт под новое число
        if ai_age < 18:
            pa["verdict"] = "подростковая манера"
        elif ai_age < 24:
            pa["verdict"] = "молодой стиль"
        elif ai_age < 33:
            pa["verdict"] = "зрелый стиль"
        elif ai_age < 45:
            pa["verdict"] = "взрослая манера"
        else:
            pa["verdict"] = "умудрённая манера"

    def _build_lite_prompt(self, dossier: dict, posts: list[dict]) -> str:
        """Промпт для Lite — полный пакет фактов + 6 постов."""
        facts = self._facts_to_compact_str(dossier)
        posts_str = self._posts_to_str(posts)
        
        return f"""ПАКЕТ ФАКТОВ:
{facts}

ПРИМЕРЫ ПОСТОВ ({len(posts)} шт):
{posts_str}

Сделай живой портрет этого пользователя. Не выдумывай фактов."""
    
    def _build_max_prompt(self, dossier: dict, posts: list[dict]) -> str:
        """Промпт для Max — компактные факты + 3 поста + готовые триггеры."""
        # Только ключевые факты
        card = dossier.get("card", {})
        portrait = dossier.get("portrait", {})
        emotion = portrait.get("emotion", {})
        triggers = dossier.get("triggers", {})
        admit = dossier.get("admit_mistakes", {})
        empathy = dossier.get("empathy", {})
        
        compact = f"""Юзер: {card.get("username")} (стаж {card.get("tenure")}, статус {card.get("status")})
Постов: {dossier["raw_stats"]["posts_fetched"]} | Тем: {dossier["raw_stats"]["threads_fetched"]}
Эмоции: позитиф {emotion.get("positive_pct",0)}% | токсик {emotion.get("toxic_pct",0)}% (доля постов с адресными оскорблениями, мат-сленг не считается) | нейтрально {emotion.get("neutral_pct",0)}%
Конфликтность: {portrait.get("conflict",{}).get("score",0)}/10
Архетипы: {", ".join(portrait.get("archetypes",[]))}
Манера: {portrait.get("manner",{}).get("primary","?")} + {portrait.get("manner",{}).get("secondary","?")}
Эго: {portrait.get("ego",{}).get("per_100",0)} на 100 слов
Уверенность: {portrait.get("confidence",{}).get("score",0)}%
Признание ошибок: {admit.get("verdict","?")}
Эмпатия: {empathy.get("verdict","?")}
Триггеры от ядра: {", ".join([t["topic"][:40] for t in triggers.get("top_topic_triggers",[])[:3]]) or "нет"}
Динамика: {dossier.get("activity",{}).get("yearly_dynamics",{}).get("verdict","?")}

Правило: мат без адресата — сленг, а не токсичность. Не называй юзера токсиком/агрессором при конфликтности <= 4/10 и не склеивай противоречивые типажи типа «миролюбивый токсик»."""
        
        posts_str = self._posts_to_str(posts, with_labels=True)
        
        return f"""КОМПАКТНЫЕ ФАКТЫ:
{compact}

КЛЮЧЕВЫЕ ПОСТЫ ({len(posts)} шт):
{posts_str}

Найди скрытые сигналы, предскажи триггеры, дай однострочный вердикт."""
    
    def _build_psychologist_prompt(self, dossier: dict, posts: list[dict]) -> str:
        """Промпт для психолога — полные факты + 5-6 постов + просьба о психологическом портрете."""
        facts = self._facts_to_compact_str(dossier)
        posts_str = self._posts_to_str(posts, with_labels=True)

        # Используем string.Template вместо f-string, потому что в шаблоне ниже
        # есть JSON-схема с фигурными скобками {"summary_one_line": ...} —
        # f-string пытался бы их интерпретировать как format-выражения и падал
        # с KeyError/Invalid format specifier. Template подставляет только $name.
        template = Template("""ПАКЕТ ФАКТОВ О ПОЛЬЗОВАТЕЛЕ:
$facts

ПОКАЗАТЕЛЬНЫЕ ПОСТЫ ($n шт):
$posts_str

Сделай развёрнутый психологический портрет. Оцени Big Five, тёмную триаду,
эмоциональный интеллект, защиты, тип привязанности, когнитивные искажения.
Выбери 2-4 типажа из списка. Дай прогноз отношений с разными типами людей.

Правила ярлыков:
- Мат в постах ≠ токсичность. На форуме мат — часть сленга. Токсик = человек
  регулярно оскорбляет СОБЕСЕДНИКОВ (переходит на личности, унижает).
- Если конфликтность <= 4/10, НЕ используй типажи «токсик», «агрессор»,
  «тролль» и их вариации — даже если в постах есть мат.
- Не склеивай противоречивые типажи («миролюбивый токсик») — выбери то,
  что подтверждается конфликтностью и долей адресных оскорблений.

Шкалы (dark_triad, big_five, emotional_intelligence) — это ИЗМЕРЕНИЯ, а не
ярлыки: заполняй их честно по наблюдениям в постах, независимо от
конфликтности. Низкая конфликтность НЕ означает нули: даже у спокойного
юзера оцени манипулятивность, эгоцентризм, импульсивность по текстам.
Ноль ставь только когда сигналов действительно нет. Для красных флагов
(red_flags) используй конкретные наблюдения из постов, без страха перед
ярлыками — это диагноз поведения, а не оскорбление пользователя.
Все значения шкал — ЦЕЛЫЕ ЧИСЛА от 0 до 10 (НЕ проценты!). Запрещены
шаблонные крайности: нули или десятки по всем шкалам сразу — признак
ошибки, а не анализа. dark_triad: у активного автора форума обычно 1-5 по
нарциссизму и макиавеллизму (самопрезентация и торг — это уже они); нули
допустимы, только если ты можешь в note указать конкретные посты,
доказывающие отсутствие черты. big_five: выше 8 — только с прямыми
доказательствами в постах. В note каждого блока — 1-2 конкретных примера
из постов.

Верни СТРОГО JSON со всеми ключами:
{
  "summary_one_line": "...",
  "portrait_headline": "...",
  "personality_types": ["...", "..."],
  "psychological_portrait": "...",
  "big_five": {"openness": 0-10, "conscientiousness": 0-10, "extraversion": 0-10, "agreeableness": 0-10, "neuroticism": 0-10, "note": "..."},
  "dark_triad": {"narcissism": 0-10, "machiavellianism": 0-10, "psychopathy": 0-10, "red_flags": ["..."]},
  "emotional_intelligence": {"self_awareness": 0-10, "self_regulation": 0-10, "empathy": 0-10, "social_skills": 0-10},
  "defense_mechanisms": ["..."],
  "cognitive_distortions": ["..."],
  "attachment_style": "...",
  "manner_description": "как юзер пишет — стиль, тон, лексика (1-2 предложения)",
  "conflict_pattern": "как ведёт себя в спорах и конфликтах (1-2 предложения)",
  "status_relation": {{"peer": 0-100, "newbie": 0-100, "mod": 0-100, "weak": 0-100}},
  "relations_note": "..."
}

status_relation — как юзер обращается с каждой статусной группой на форуме:
0 — по-доброму/уважительно, 50 — нейтрально/игнорирует, 100 — троллит/агрессия.
peer — равные ему по статусу; newbie — новички; mod — модерация и «власть»;
weak — те, кто слабее него. Оцени строго по постам, где видно отношение.

Не выдумывай фактов. Если данных мало — скажи прямо.""")
        return template.substitute(facts=facts, posts_str=posts_str, n=len(posts))

    def _facts_to_compact_str(self, dossier: dict) -> str:
        """Компактное строковое представление фактов."""
        card = dossier.get("card", {})
        portrait = dossier.get("portrait", {})
        emotion = portrait.get("emotion", {})
        triggers = dossier.get("triggers", {})
        admit = dossier.get("admit_mistakes", {})
        empathy = dossier.get("empathy", {})
        newbies = dossier.get("newbies", {})
        activity = dossier.get("activity", {})
        
        lines = [
            f"Юзер: {card.get('username')} (ID {card.get('user_id')})",
            f"Стаж: {card.get('tenure')} | Статус: {card.get('status')} | Ворнинги: {card.get('warning_points')}/3 | Забанен: {card.get('is_banned')}",
            f"Сообщений просканировано: {dossier['raw_stats']['posts_fetched']} | Тем: {dossier['raw_stats']['threads_fetched']} | Стены: {dossier['raw_stats']['wall_posts_fetched']}",
            f"",
            f"ЭМОЦИИ: позитиф {emotion.get('positive_pct',0)}% | негатив {emotion.get('negative_pct',0)}% | токсик {emotion.get('toxic_pct',0)}% | нейтрально {emotion.get('neutral_pct',0)}%",
            f"  → {emotion.get('verdict','?')}",
            f"  (токсик = доля постов с АДРЕСНЫМИ оскорблениями; мат-сленг без адресата токсичностью не считается)",
            f"",
            f"КОНФЛИКТНОСТЬ: {portrait.get('conflict',{}).get('score',0)}/10",
            f"  → {portrait.get('conflict',{}).get('verdict','?')}",
            f"",
            f"МАНЕРА: {portrait.get('manner',{}).get('primary','?')} + {portrait.get('manner',{}).get('secondary','?')}",
            f"  → {portrait.get('manner',{}).get('description','?')}",
            f"",
            f"АРХЕТИПЫ: {', '.join(portrait.get('archetypes',[]))}",
            f"",
            f"ЭГО: {portrait.get('ego',{}).get('per_100',0)} на 100 слов",
            f"  → {portrait.get('ego',{}).get('verdict','?')}",
            f"",
            f"УВЕРЕННОСТЬ: {portrait.get('confidence',{}).get('score',0)}%",
            f"  → {portrait.get('confidence',{}).get('verdict','?')}",
            f"",
            f"ГРАМОТНОСТЬ: {portrait.get('literacy',{}).get('verdict','?')}",
            f"",
            f"ТРИГГЕРЫ (от ядра, темы где матерится):",
        ]
        for t in triggers.get("top_topic_triggers", [])[:3]:
            lines.append(f"  • {t.get('topic','')[:60]} — мат:{t.get('toxic_count',0)} капс:{t.get('caps_count',0)}")
        lines.append(f"  → {triggers.get('verdict','?')}")
        lines.append("")
        lines.append(f"ПРИЗНАНИЕ ОШИБОК: {admit.get('verdict','?')}")
        lines.append(f"ЭМПАТИЯ: {empathy.get('verdict','?')}")
        lines.append(f"ОТНОШЕНИЕ К НОВИЧКАМ: {newbies.get('verdict','?')}")
        lines.append("")
        lines.append(f"ТОП РАЗДЕЛОВ:")
        for f in dossier.get("activity", {}).get("top_forums", [])[:3]:
            lines.append(f"  • {f['forum']} — {f['count']}")
        lines.append("")
        lines.append(f"ВРЕМЯ: {activity.get('time_profile',{}).get('verdict','?')}")
        lines.append(f"ДИНАМИКА: {activity.get('yearly_dynamics',{}).get('verdict','?')}")
        lines.append(f"РЕАКЦИИ: {activity.get('reactions',{}).get('verdict','?')}")
        
        return "\n".join(lines).replace("{", "{{").replace("}", "}}")

    def _posts_to_str(self, posts: list[dict], with_labels: bool = False) -> str:
        """Превращает посты в строку для промпта."""
        if not posts:
            return "(нет постов)"
        lines = []
        for i, p in enumerate(posts, 1):
            label = p.get("label", "")
            likes = p.get("likes", 0)
            topic = p.get("topic", "")
            
            header = f"[{i}]"
            if with_labels and label:
                header += f" [{label}]"
            if likes:
                header += f" [❤️{likes}]"
            if topic:
                header += f" [тема: {topic}]"
            
            lines.append(f"{header}")
            lines.append(f"«{p.get('body','')}»")
            lines.append("")
        return "\n".join(lines).replace("{", "{{").replace("}", "}}")
    
    # Детерминированная постобработка текста: не меняет JSON-ключи и типы,
    # не делает дополнительных LLM-вызовов и применяется только к новым ответам.
    _TEXT_REPLACEMENTS = [
        (r"братан[- ]братушник", "свой в общении"),
        (r"братан[- ]кабан", "свой в общении"),
        (r"делов\w* сухар\w*", "по делу"),
        (r"плодовит\w* автор\w*", "активный автор"),
        (r"плодовит\w+", "активный"),
        (r"технар[ья][- ]братан\w*", "свой в общении"),
        (r"\bТехнарь\b", "Шарит"),
        (r"\bФиксер\b", "Решала"),
        (r"\b(мудак|идиот|дебил|психопат|нарцисс)\b", "некорректная характеристика"),
        (r"\b(он|пользователь)\s+(точно|явно|однозначно|безусловно)\s+(хочет|стремится|манипулирует|наживается|вр[её]т)\b", r"по доступным примерам это может указывать на"),
        (r"\b(точно|явно|однозначно|безусловно)\s+(хочет|стремится|манипулирует|наживается|вр[её]т)\b", r"может указывать на"),
    ]
    _SMALL_SAMPLE_RE = re.compile(r"\b(мало данных|недостаточно данных|мал[ао]я выборка|несколько постов)\b", re.IGNORECASE)
    _SMALL_SAMPLE_CAVEAT = " Вывод предварительный: он основан на ограниченной выборке."

    # Zelscan compact AI text policy v1
    _AI_TEXT_LIMITS = {
        "psychological_portrait": 280,
        "hidden_signals": 220,
        "manner_description": 280,
        "conflict_pattern": 160,
        "summary_one_line": 120,
        "verdict_one_line": 78,
    }

    @staticmethod
    def _clip_to_sentence(text: str, limit: int) -> str:
        """Cuts only at a finished sentence or word boundary; never adds an ellipsis."""
        text = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(text) <= limit:
            return text
        sentences = re.findall(r"[^.!?…]+[.!?…]+(?:\s+|$)|[^.!?…]+$", text)
        kept, size = [], 0
        for sentence in sentences:
            sentence = sentence.strip()
            candidate = len(sentence) if not kept else size + 1 + len(sentence)
            if candidate > limit:
                break
            kept.append(sentence)
            size = candidate
        if kept:
            return " ".join(kept)
        clipped = text[:limit].rsplit(" ", 1)[0].strip()
        return clipped or text[:limit].strip()

    def _sanitize_ai_text(self, text: str, field_name: str = "") -> str:
        """Normalizes tone and enforces display budgets without changing JSON types."""
        result = re.sub(r"\s+", " ", str(text or "")).strip()
        for pattern, replacement in self._TEXT_REPLACEMENTS:
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
        if self._SMALL_SAMPLE_RE.search(result) and "ограниченной выборке" not in result.lower():
            result = result.rstrip() + self._SMALL_SAMPLE_CAVEAT
        # Zelscan hero clip order v1
        # verdict_one_line is clipped later by _clip_hero_verdict, which needs the full sentence.
        if field_name == "verdict_one_line":
            return result
        limit = self._AI_TEXT_LIMITS.get(field_name)
        return self._clip_to_sentence(result, limit) if limit else result

    # Zelscan compact tags and hero v1
    _TAG_FIELD_NAMES = {"key_traits", "archetypes", "tags"}

    @staticmethod
    @staticmethod
    def _compact_tag(text: str) -> str:
        """Makes a neutral tag of 1–3 ordinary words, never a full sentence."""
        raw = re.sub(r"\s+", " ", str(text or "")).strip()
        low = raw.lower()
        rules = (
            (r"низк\w* степен\w* уверенност\w*.*", "Неуверенность"),
            (r".*(резк\w*|оскорбитель\w*).*(реплик\w*|высказ\w*).*", "Резкие реплики"),
            (r".*(личн\w*|я.?выраж\w*|самораскрыт\w*).*", "Сдержанность"),
            (r".*техническ\w* терминолог\w*.*", "Технический стиль"),
        )
        for pattern, label in rules:
            if re.fullmatch(pattern, low, flags=re.IGNORECASE):
                return label
        raw = re.sub(r"(?i)^(склонность к|ориентированность на|низкая степень|высокая степень|повышенная склонность к)\s+", "", raw)
        raw = re.sub(r"[,.!?:;]+$", "", raw).strip()
        words = raw.split()
        return " ".join(words[:3]).strip().capitalize()[:32]

    @staticmethod
    def _clip_hero_verdict(text: str, limit: int) -> str:
        """Keeps a readable, finished short sentence for the hero verdict."""
        text = re.sub(r"\s+", " ", str(text or "")).strip()
        if len(text) <= limit:
            return text
        fragment = text[:limit].rstrip()
        for delimiter in (",", ";", ":", " —", " –"):
            if delimiter in fragment:
                candidate = fragment.rsplit(delimiter, 1)[0].strip(" ,;:-–—")
                if len(candidate) >= 28:
                    return candidate + "."
        candidate = fragment.rsplit(" ", 1)[0].strip(" ,;:-–—")
        return (candidate or fragment).rstrip(".!?…") + "."

    def _sanitize_ai_output(self, obj, field_name: str = ""):
        """Sanitizes text, gives compact tags, and keeps every JSON type stable."""
        if obj is None:
            return None
        if isinstance(obj, str):
            text = self._sanitize_ai_text(obj, field_name)
            if field_name == "verdict_one_line":
                text = self._clip_hero_verdict(text, self._AI_TEXT_LIMITS["verdict_one_line"])
            return self._compact_tag(text) if field_name in self._TAG_FIELD_NAMES else text
        if isinstance(obj, list):
            # Zelscan preserve tag list structure v1
            # Prompt/UI control tag count; sanitizer must never change stored JSON array shape.
            return [self._sanitize_ai_output(item, field_name) for item in obj]
        if isinstance(obj, dict):
            return {key: self._sanitize_ai_output(value, key) for key, value in obj.items()}
        return obj

    # Zelscan psych quality gate v1: all-zero dark_triad вместе с непустым
    # red_flags — противоречивый ответ модели (случай заказа c318a12f9d,
    # gpt-oss-120b). Такой результат нельзя сохранять как есть.
    _PSYCH_REVISE_SUFFIX = (
        "\n\nЗАМЕЧАНИЕ К ПРЕДЫДУЩЕЙ ПОПЫТКЕ: в предыдущем ответе dark_triad содержал "
        "нули (narcissism=0, machiavellianism=0, psychopathy=0), но red_flags был непуст. "
        "Нулевые оценки противоречат наличию красных флагов. Пересмотри narcissism, "
        "machiavellianism и psychopathy по шкале 0–10 с опорой на факты и посты. "
        "Если конфликтных сигналов действительно нет — оставь оценки 0 и верни пустой "
        "red_flags. Верни полный JSON целиком в том же формате."
    )

    @staticmethod
    def _normalize_status_relation(parsed):
        """Zelscan status relation metric v1: числовые 0–100 по статусным группам."""
        raw = parsed.get("status_relation") if isinstance(parsed, dict) else None
        if not isinstance(raw, dict):
            return None
        out = {}
        for key in ("peer", "newbie", "mod", "weak"):
            v = raw.get(key)
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                return None
            out[key] = int(max(0, min(100, round(v))))
        return out

    @staticmethod
    def _psych_uninformative(parsed) -> bool:
        """True, когда dark_triad отсутствует/некорректен или противоречит red_flags."""
        if not isinstance(parsed, dict):
            return True
        triad = parsed.get("dark_triad")
        if not isinstance(triad, dict):
            return True
        values = [triad.get(k) for k in ("narcissism", "machiavellianism", "psychopathy")]
        if any(not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0 or v > 10 for v in values):
            return True
        return all(v == 0 for v in values) and bool(triad.get("red_flags"))

    def _retry_psychologist_once(self, psych_system: str, psych_prompt: str) -> Optional[dict]:
        """Одна корректирующая попытка психолога. Возвращает chat-результат
        с ключом 'content' или None, если повтор не удался/снова противоречив."""
        revised = psych_prompt + self._PSYCH_REVISE_SUFFIX
        print("  → Психолог: противоречивый результат (нули dark_triad при red_flags), повтор...", file=sys.stderr)
        try:
            if self.fireworks:
                retry = self.fireworks.chat(FIREWORKS_PSYCHOLOGIST, psych_system, revised, 0.4, 12000, response_format_json=True)
            elif self.deepseek:
                retry = self.deepseek.chat(DEEPSEEK_FLASH, psych_system, revised, 0.4, 12000, response_format_json=True)
            elif self._giga_available:
                retry = self.client.chat(LITE_MODEL, psych_system, revised, 0.4, 1500)
            else:
                return None
        except Exception as exc:
            print(f"  → Психолог: повтор не удался ({exc})", file=sys.stderr)
            return None
        if not retry or not retry.get("content"):
            return None
        parsed = self._parse_json_response(retry.get("content"))
        parsed = self._sanitize_ai_output(parsed)
        if parsed and not self._psych_uninformative(parsed):
            print("  → Психолог: повтор дал корректный dark_triad", file=sys.stderr)
            return retry
        print("  → Психолог: повтор снова противоречив, сохраняю первый результат", file=sys.stderr)
        return None

    @staticmethod
    def _sanitize_red_flag(flag: str) -> str:
        """
        Чистит один red_flag: вырезает цитаты, номера постов и тире-пояснения.

        Страховка на случай, если модель проигнорирует промпт и вернёт что-то
        вроде: «я понял что долбаеб…» (пост 4) — оскорбление и агрессивный тон.
        """
        if not isinstance(flag, str):
            return ""
        s = flag.strip()
        # 1. Убираем скобки с номерами постов: «(пост 4)», «(посты 4, 20)», «(4)»
        s = re.sub(r'\(\s*(?:пост[а-я]*|post[s]?)?\s*[\d,\s№]+\)', '', s, flags=re.IGNORECASE)
        # 2. Убираем цитаты в любых кавычках вместе с содержимым
        s = re.sub(r'[«»"“”\'`].*?[«»"“”\'`]', '', s)
        # Одиночная «висячая» кавычка, если пара не закрылась
        s = re.sub(r'[«»"“”\'`]', '', s)
        # 3. Убираем тире-пояснение: всё после длинного/короткого тире
        s = re.sub(r'\s*[—–-]\s+.*$', '', s)
        # 4. Схлопываем пробелы и чистим края от пунктуации
        s = re.sub(r'\s{2,}', ' ', s).strip(' \t\r\n.,;:—–-')
        return s

    @classmethod
    def _sanitize_red_flags(cls, parsed: Optional[dict]) -> Optional[dict]:
        """Постобработка распарсенного JSON: red_flags чистим, шкалы нормализуем."""
        if not isinstance(parsed, dict):
            return parsed

        def _norm10(v):
            # модели часто возвращают проценты 0-100 вместо 0-10
            try:
                v = float(v)
            except (TypeError, ValueError):
                return v
            if v > 10:
                v = round(v / 10.0, 1)
            return max(0, min(10, v))

        scales = (
            ("big_five", ("openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism")),
            ("dark_triad", ("narcissism", "machiavellianism", "psychopathy")),
            ("emotional_intelligence", ("self_awareness", "self_regulation", "empathy", "social_skills")),
        )
        for section, keys in scales:
            block = parsed.get(section)
            if not isinstance(block, dict):
                continue
            for k in keys:
                if k in block:
                    block[k] = _norm10(block[k])

        triad = parsed.get("dark_triad")
        if isinstance(triad, dict) and isinstance(triad.get("red_flags"), list):
            cleaned = []
            for f in triad["red_flags"]:
                c = cls._sanitize_red_flag(f)
                if c:
                    cleaned.append(c)
            triad["red_flags"] = cleaned
        return parsed

    def _parse_json_response(self, content: str) -> Optional[dict]:
        """Парсит JSON из ответа LLM (иногда обёрнут в ```json ... ```)."""
        if not content:
            return None
        
        # Убираем markdown-обёртку
        text = content.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            text = "\n".join(lines)
        
        # Пытаемся распарсить как есть
        try:
            return self._sanitize_red_flags(json.loads(text))
        except json.JSONDecodeError:
            pass
        
        # GigaChat иногда выдаёт невалидный JSON с пропущенными запятыми
        # между значениями. Чиним: заменяем }\n{ на },\n{ и т.п.
        fixed = text
        # } \n "  →  },\n"
        fixed = re.sub(r'(["\]}])\s*\n(\s*["\{])', r'\1,\n\2', fixed)
        try:
            return self._sanitize_red_flags(json.loads(fixed))
        except json.JSONDecodeError:
            pass
        
        # Ищем первый { и последний }
        start = fixed.find("{")
        end = fixed.rfind("}")
        if start >= 0 and end > start:
            try:
                return self._sanitize_red_flags(json.loads(fixed[start:end+1]))
            except json.JSONDecodeError:
                pass
        
        return None


# ---------------------------------------------------------------------------
# Точка входа для сервера
# ---------------------------------------------------------------------------

def get_auth_key() -> Optional[str]:
    """Берёт GigaChat ключ из env или файла."""
    key = os.environ.get("GIGACHAT_KEY", "").strip()
    if key:
        return key
    key_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".gigachat_key")
    if os.path.exists(key_file):
        with open(key_file) as f:
            return f.read().strip()
    return None


def get_deepseek_key() -> Optional[str]:
    """Берёт DeepSeek ключ из env или файла."""
    key = os.environ.get("DEEPSEEK_KEY", "").strip()
    if key:
        return key
    key_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".deepseek_key")
    if os.path.exists(key_file):
        with open(key_file) as f:
            return f.read().strip()
    return None


def get_fireworks_keys() -> list[str]:
    """
    Берёт Fireworks ключи из env или файла .fireworks_keys (по одному ключу в строке).
    Возвращает список ключей (может быть пустым).
    """
    # Приоритет 1: переменная окружения (один или несколько через запятую)
    env_keys = os.environ.get("FIREWORKS_KEYS", "").strip()
    if env_keys:
        return [k.strip() for k in env_keys.split(",") if k.strip()]
    
    # Приоритет 2: файл .fireworks_keys (по одному ключу на строку)
    key_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".fireworks_keys")
    if os.path.exists(key_file):
        with open(key_file) as f:
            keys = [line.strip() for line in f if line.strip() and not line.startswith("#")]
            return keys
    
    return []


def _runtime_chat(spec: dict, system_prompt: str, user_prompt: str,
                  temperature: float, max_tokens: int, json_mode: bool = False,
                  slot: str = "", key_resolver=None) -> dict:
    """Resolve a credential immediately before the outbound HTTP request."""
    model = spec.get("model")
    kind = spec.get("kind", "openai")
    api_key = key_resolver(spec.get("provider_id")) if key_resolver else spec.get("api_key", "")
    if kind == "gigachat":
        result = GigaChatClient(api_key).chat(
            model or "GigaChat", system_prompt, user_prompt, temperature, max_tokens,
        )
        if isinstance(result, dict):
            result.setdefault("model", model or "GigaChat")
            result.setdefault("finish_reason", None)
        return result

    base = (spec.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode in ("schema", "lite_schema"):
        if json_mode == "lite_schema":
            # Lite is rendered directly in the dossier.  A generic json_object
            # lets small reasoning models return a schema stub such as
            # {"type": "object"}; require the actual dossier contract instead.
            response_schema = {
                "type": "object",
                "properties": {
                    "psychological_portrait": {"type": "string", "minLength": 20},
                    "behavior_scenarios": {
                        "type": "object",
                        "properties": {
                            "спросить_по_делу": {"type": "string", "minLength": 8},
                            "спорить": {"type": "string", "minLength": 8},
                            "новичок_обратится": {"type": "string", "minLength": 8},
                        },
                        "required": ["спросить_по_делу", "спорить", "новичок_обратится"],
                        "additionalProperties": False,
                    },
                    "key_traits": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 2},
                        "minItems": 3,
                        "maxItems": 5,
                    },
                },
                "required": ["psychological_portrait", "behavior_scenarios", "key_traits"],
                "additionalProperties": False,
            }
            schema_name = "lite_analysis"
        else:
            response_schema = {"type": "object"}
            schema_name = "psychologist_analysis"
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "schema": response_schema,
            },
        }
    elif json_mode:
        # aki_json_mode_guard_v1: Aki's OpenAI-compat layer does not support
        # response_format for all models (e.g. DeepSeek V4 Flash returns HTTP 400).
        # Only apply json_object for models that are known to support it.
        _base_lower = base.lower()
        _model_lower = (model or "").lower()
        # aki_json_obj_exclude_v1: Aki does not support response_format for gpt-oss
        _is_aki = "aki.io" in _base_lower
        _supports_json_obj = (
            not _is_aki
            and (
                "fireworks" in _base_lower
                or "openai.com" in _base_lower
                or "gpt-oss" in _model_lower
                or "gpt-4" in _model_lower
                or "gpt-3" in _model_lower
            )
        )
        if _supports_json_obj:
            payload["response_format"] = {"type": "json_object"}

    model_name = str(model or "").lower()
    if "gpt-oss" in model_name and "fireworks" in base.lower():
        payload["reasoning_effort"] = "medium" if slot == "psychologist" else "low"

    # openrouter_reasoning_guard_v1: бесплатные reasoning-модели OpenRouter
    # (Nemotron и пр.) тратят бюджет токенов на размышления и упираются в
    # max_tokens, не отдав контент. Для коротких слотов reasoning выключаем.
    if "openrouter.ai" in base.lower() and max_tokens < 8000:
        payload["reasoning"] = {"enabled": False}

    try:
        response = requests.post(
            base + "/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
            json=payload,
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            return {
                "content": None,
                "usage": None,
                "model": model,
                "finish_reason": None,
                "error": f"HTTP {response.status_code}: {response.text[:300]}",
            }
        data = response.json()
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        return {
            "content": message.get("content"),
            "usage": data.get("usage", {}),
            "model": model,
            "finish_reason": choice.get("finish_reason"),
            "error": None,
        }
    except Exception as exc:
        return {
            "content": None,
            "usage": None,
            "model": model,
            "finish_reason": None,
            "error": f"request failed: {exc}",
        }


def _same_model(a: Optional[dict], b: Optional[dict]) -> bool:
    return ((a or {}).get("provider_id"), (a or {}).get("model")) == \
           ((b or {}).get("provider_id"), (b or {}).get("model"))


def _chat_with_retry(spec: dict, system_prompt: str, user_prompt: str,
                     temperature: float, max_tokens: int, json_mode,
                     slot: str = "", key_resolver=None) -> dict:
    """Вызов модели с retry на 429 (разделяемые очереди бесплатных моделей)."""
    result: dict = {}
    for attempt in range(3):
        result = _runtime_chat(spec, system_prompt, user_prompt,
                               temperature, max_tokens, json_mode, slot=slot,
                               key_resolver=key_resolver)
        err = str(result.get("error") or "")
        if not err:
            return result
        if "429" in err and attempt < 2:
            time.sleep(2 + attempt * 3)
            continue
        return result
    return result


def _analyze_with_runtime(dossier: dict, posts_lite: list, posts_max: list,
                          posts_psych: list, runtime_config: dict) -> dict:
    """Execute the immutable per-order AI snapshot selected in the admin panel.

    ai_fallback_chain_v1: если модель слота недоступна (HTTP-ошибка, пустой
    или некорректный JSON), заказ не падает — та же задача уходит следующим
    кандидатам из включённых провайдеров (runtime_config["fallbacks"])."""
    t0 = time.time(); slots = runtime_config.get("slots") or {}
    from admin_service import resolve_ai_api_key
    runtime_store = runtime_config.get("_store")
    key_resolver = (lambda provider_id: resolve_ai_api_key(runtime_store, provider_id)) if runtime_store else None
    helper = AIInterpreter.__new__(AIInterpreter)
    prompts = {
        # ai_token_headroom_v1: max 4000 (а не 1000) — thinking-модели (gpt-oss)
        # тратят бюджет на размышления; малый лимит давал
        # «finished before thinking was completed» и пустой слот.
        "lite": (LITE_SYSTEM_PROMPT, helper._build_lite_prompt(dossier, posts_lite), .5, 3000, "lite_schema"),
        "max": (MAX_SYSTEM_PROMPT, helper._build_max_prompt(dossier, posts_max), .4, 4000, True),
        "psychologist": (_load_psychologist_prompt(), helper._build_psychologist_prompt(dossier, posts_psych), .4, 16000, "schema"),
    }
    out = {}
    for slot, args in prompts.items():
        spec = slots.get(slot)
        if not spec:
            out[slot] = {"raw_response": None, "parsed": None, "usage": None,
                         "error": f"Модель для {slot} не назначена", "model": None}
            continue
        # Цепочка: модель слота → включённые модели других провайдеров.
        candidates = [spec] + [fb for fb in (runtime_config.get("fallbacks") or [])
                               if not _same_model(fb, spec)]
        system, base_prompt, temp, max_tok, json_mode = args
        result: dict = {}
        parsed = None
        used_spec = spec
        attempt_errors: list[str] = []
        for cand in candidates:
            cand_result = _chat_with_retry(cand, system, base_prompt, temp,
                                           max_tok, json_mode, slot=slot,
                                           key_resolver=key_resolver)
            cand_parsed = (helper._parse_json_response(cand_result.get("content"))
                           if cand_result.get("content") else None)
            cand_parsed = helper._sanitize_ai_output(cand_parsed)
            result, parsed = cand_result, cand_parsed
            if cand_parsed and not cand_result.get("error"):
                used_spec = cand
                break
            attempt_errors.append(
                f"{cand.get('model')}: {cand_result.get('error') or 'пустой/некорректный ответ'}")
        if len(candidates) > 1:
            if used_spec is not spec:
                print(f"  → {slot}: резерв сработал, использована модель "
                      f"{used_spec.get('model')} (провайдер {used_spec.get('provider_id')}); "
                      f"попытки: {'; '.join(attempt_errors)}", file=sys.stderr)
            elif attempt_errors:
                print(f"  → {slot}: все {len(candidates)} моделей недоступны: "
                      f"{'; '.join(attempt_errors)}", file=sys.stderr)
        # Zelscan psych quality gate v1: противоречивый результат психолога →
        # одна корректирующая попытка с тем же слотом модели.
        if slot == "psychologist" and helper._psych_uninformative(parsed):
            retry = _chat_with_retry(used_spec, system,
                                     base_prompt + helper._PSYCH_REVISE_SUFFIX, temp, max_tok, json_mode,
                                     slot=slot, key_resolver=key_resolver)
            retry_parsed = helper._parse_json_response(retry.get("content")) if retry.get("content") else None
            retry_parsed = helper._sanitize_ai_output(retry_parsed)
            if retry_parsed and not helper._psych_uninformative(retry_parsed):
                print(f"  → Психолог [{used_spec.get('model')}]: повтор дал корректный dark_triad", file=sys.stderr)
                result, parsed = retry, retry_parsed
            else:
                print(f"  → Психолог [{used_spec.get('model')}]: повтор снова противоречив, сохраняю первый результат", file=sys.stderr)
        out[slot] = {"raw_response": result.get("content"), "parsed": parsed,
                     "usage": result.get("usage"), "error": result.get("error"),
                     "model": used_spec.get("model"),
                     "provider_id": used_spec.get("provider_id"),
                     "fallback_used": used_spec is not spec,
                     "attempts": attempt_errors}
        time.sleep(1)
    out["models_used"] = {s: out[s].get("model") if out[s].get("parsed") else None
                           for s in ("lite", "max", "psychologist")}
    out["config_version"] = runtime_config.get("version")
    out["elapsed_seconds"] = round(time.time() - t0, 2)
    return out


def analyze_with_ai(dossier: dict, posts: list, runtime_config: Optional[dict] = None) -> dict:
    """
    Точка входа: принимает досье и список постов, возвращает AI-анализ.
    
    Args:
        dossier: полный досье от ядра
        posts: list[UserPost] — все посты пользователя
        
    Returns:
        AI-анализ или {error: ...}
    """
    # Ленивый импорт ядра (для избежания циклов)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
    from lolz_analyzer import select_posts_for_lite_ai, select_posts_for_max_ai
    
    # Выбираем посты
    posts_lite = select_posts_for_lite_ai(posts, limit=12)
    posts_max = select_posts_for_max_ai(posts, limit=8)
    # Психологу — максимум сырья: на токенах не экономим, качество в приоритете
    posts_psych = select_posts_for_lite_ai(posts, limit=30)

    # Полная конфигурация из админки. Она зафиксирована при оплате заказа.
    if runtime_config and runtime_config.get("slots"):
        return _analyze_with_runtime(dossier, posts_lite, posts_max, posts_psych, runtime_config)

    # Собираем все доступные ключи (приоритет: Fireworks → DeepSeek → GigaChat)
    fireworks_keys = get_fireworks_keys()
    deepseek_key = get_deepseek_key()
    auth_key = get_auth_key()
    
    if not fireworks_keys and not deepseek_key and not auth_key:
        return {"error": "Нет AI-ключей. Положи .fireworks_keys, .deepseek_key или .gigachat_key"}
    
    # Создаём AIInterpreter с доступными провайдерами (Fireworks как основной)
    interpreter = AIInterpreter(
        gigachat_auth_key=auth_key or "",
        deepseek_api_key=deepseek_key or "",
        fireworks_keys=fireworks_keys if fireworks_keys else None
    )
    return interpreter.analyze(dossier, posts_lite, posts_max, posts_psych)


# ---------------------------------------------------------------------------
# CLI для тестов
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(__file__))
    
    parser = argparse.ArgumentParser(description="AI-анализ досье через GigaChat")
    parser.add_argument("--dossier", required=True, help="JSON файл досье от ядра")
    parser.add_argument("--auth-key", default="", help="GigaChat auth key")
    parser.add_argument("--output", default="", help="Куда сохранить результат")
    args = parser.parse_args()
    
    # Загружаем досье
    with open(args.dossier, encoding="utf-8") as f:
        dossier = json.load(f)
    
    # Загружаем посты из кеша (если есть)
    # Для CLI теста — загружаем из основного скрипта
    from lolz_analyzer import LolzAnalyzer, select_posts_for_lite_ai, select_posts_for_max_ai
    
    # Загружаем все доступные токены Лолза (пул)
    lolz_tokens = []
    project_root = os.path.dirname(os.path.dirname(__file__))
    for token_file in ['.lolz_token', '.lolz_token_2', '.lolz_token_3']:
        p = os.path.join(project_root, token_file)
        if os.path.exists(p):
            t = open(p).read().strip()
            if t:
                lolz_tokens.append(t)
    if not lolz_tokens:
        _sys.exit("❌ Нет LOLZ токенов")
    
    analyzer = LolzAnalyzer(lolz_tokens)
    print("Fetching posts...", file=_sys.stderr)
    posts = analyzer.fetch_timeline(dossier["user_id"], max_pages=10)
    print(f"Got {len(posts)} posts", file=_sys.stderr)
    
    posts_lite = select_posts_for_lite_ai(posts, limit=6)
    posts_max = select_posts_for_max_ai(posts, limit=3)
    
    print(f"\nPosts for Lite: {len(posts_lite)}", file=_sys.stderr)
    print(f"Posts for Max: {len(posts_max)}", file=_sys.stderr)
    
    # AI анализ
    auth_key = args.auth_key or get_auth_key()
    if not auth_key:
        _sys.exit("❌ Нет GigaChat ключа")
    
    deepseek_key = get_deepseek_key()
    interpreter = AIInterpreter(auth_key, deepseek_api_key=deepseek_key or "")
    print("\n🤖 Запускаю AI-анализ (DeepSeek + GigaChat-Max)...", file=_sys.stderr)
    result = interpreter.analyze(dossier, posts_lite, posts_max, posts_psych=posts_lite)
    
    print(f"\n✅ Готово за {result['elapsed_seconds']}s", file=_sys.stderr)
    print(f"Models used: {result['models_used']}", file=_sys.stderr)
    
    if result["lite"]["usage"]:
        u = result["lite"]["usage"]
        print(f"Lite tokens: prompt={u.get('prompt_tokens')}, completion={u.get('completion_tokens')}, total={u.get('total_tokens')}", file=_sys.stderr)
    if result["max"]["usage"]:
        u = result["max"]["usage"]
        print(f"Max tokens: prompt={u.get('prompt_tokens')}, completion={u.get('completion_tokens')}, total={u.get('total_tokens')}", file=_sys.stderr)
    
    out = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"✅ Сохранено: {args.output}", file=_sys.stderr)
    else:
        print(out)
