"""
Lolzteam / Zelenka Guru — dossier analyzer v2.

Что нового по сравнению с v1:
  • ТАЙМЛАЙН: тянем посты пользователя через /users/{id}/timeline
    (раньше был только first_post из тем + стена профиля)
  • ЖИВОЙ СЛОВАРЬ: абстрактные ярлыки заменены прямыми современными описаниями.
  • НОВАЯ СТАТИСТИКА:
      - Эмоциональный профиль (позитив/негатив/нейтрально)
      - Эго-индекс (насколько зациклен на себе)
      - Индекс уверенности (насколько категоричен)
      - Карта настроения по годам
      - Топ тем по просмотрам/ответам
      - Самые залайканные посты
      - Реакции (лайки на постах)
  • ГЛУБЖЕ ВЕРДИКТ: профиль личности + рекомендации "кому полезен / кому опасен"
  • АРХЕТИПЫ ЖИВЕЕ: "свой", "токсик", "душный", "по_делу", "завсегдатай
    курилки", "помогает", "трэш-мейкер" и т.д.

Endpoints:
  - GET /users/{id}                      профиль
  - GET /users/{id}/timeline             посты пользователя (NEW!)
  - GET /threads?creator_user_id={id}    созданные темы
  - GET /users/{id}/profile-posts        стена профиля
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from html import unescape
from typing import Any, Optional

import requests


API_BASE = "https://api.lolz.team"  # Zelscan official API base v6
DEFAULT_TIMEOUT = 30
RATE_LIMIT_DELAY = 0.35


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class LolzClient:
    """Клиент с одним токеном (для обратной совместимости)."""
    def __init__(self, token: str, base: str = API_BASE):
        self.base = base.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "lolz-dossier/2.0",
        })

    def get(self, path: str, params: Optional[dict] = None) -> dict:
        url = f"{self.base}{path}" if path.startswith("/") else f"{self.base}/{path}"
        for attempt in range(3):
            try:
                r = self.session.get(url, params=params, timeout=DEFAULT_TIMEOUT)
                if r.status_code == 429:
                    time.sleep(2 + attempt)
                    continue
                data = r.json()
                if "errors" in data:
                    return {"_errors": data["errors"]}
                return data
            except requests.RequestException as e:
                if attempt == 2:
                    return {"_errors": [f"network: {e}"]}
                time.sleep(1 + attempt)
        return {"_errors": ["unknown"]}

    def post(self, path: str, json_body: Optional[dict] = None) -> dict:
        url = f"{self.base}{path}" if path.startswith("/") else f"{self.base}/{path}"
        for attempt in range(3):
            try:
                r = self.session.post(url, json=json_body or {}, timeout=DEFAULT_TIMEOUT,
                                      headers={"Content-Type": "application/json"})
                if r.status_code == 429:
                    time.sleep(2 + attempt)
                    continue
                data = r.json()
                if "errors" in data:
                    return {"_errors": data["errors"]}
                return data
            except requests.RequestException as e:
                if attempt == 2:
                    return {"_errors": [f"network: {e}"]}
                time.sleep(1 + attempt)
        return {"_errors": ["unknown"]}


class LolzTokenPool:
    """
    Пул из N токенов Лолза с round-robin + fallback при 429.
    Каждый токен используется только одним типом запроса — это даёт
    3x скорости и avoids rate-limiting.
    """

    def __init__(self, tokens: list[str], base: str = API_BASE):
        if not tokens:
            raise ValueError("Need at least 1 token")
        self.base = base.rstrip("/")
        self.clients = [self._make_client(t, base) for t in tokens]
        self._next = 0
        self._lock = threading.Lock()

    def _make_client(self, token: str, base: str):
        s = requests.Session()
        s.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "lolz-dossier/3.0",
        })
        return s

    def get(self, path: str, params: Optional[dict] = None,
            client_idx: Optional[int] = None) -> dict:
        """GET с указанным токеном. Если client_idx=None — round-robin."""
        idx = client_idx if client_idx is not None else self._next_idx()
        return self._request("GET", idx, path, params=params)

    def post(self, path: str, json_body: Optional[dict] = None,
             client_idx: Optional[int] = None) -> dict:
        """POST с указанным токеном."""
        idx = client_idx if client_idx is not None else self._next_idx()
        return self._request("POST", idx, path, json_body=json_body)

    def _next_idx(self) -> int:
        with self._lock:
            idx = self._next
            self._next = (self._next + 1) % len(self.clients)
            return idx

    def _request(self, method: str, idx: int, path: str,
                 params: Optional[dict] = None,
                 json_body: Optional[dict] = None) -> dict:
        url = f"{self.base}{path}" if path.startswith("/") else f"{self.base}/{path}"
        client = self.clients[idx % len(self.clients)]

        for attempt in range(3):
            try:
                if method == "GET":
                    r = client.get(url, params=params, timeout=DEFAULT_TIMEOUT)
                else:
                    r = client.post(url, json=json_body or {}, timeout=DEFAULT_TIMEOUT,
                                    headers={"Content-Type": "application/json"})

                if r.status_code == 429:
                    # Пробуем другой токен
                    other_idx = (idx + 1 + attempt) % len(self.clients)
                    if other_idx != idx:
                        client = self.clients[other_idx]
                    time.sleep(1 + attempt)
                    continue

                data = r.json()
                if "errors" in data:
                    return {"_errors": data["errors"]}
                return data
            except requests.RequestException as e:
                if attempt == 2:
                    return {"_errors": [f"network: {e}"]}
                time.sleep(1 + attempt)
        return {"_errors": ["unknown"]}

    @classmethod
    def from_files(cls, paths: list[str], base: str = API_BASE) -> "LolzTokenPool":
        """Создаёт пул из списка путей к файлам с токенами."""
        tokens = []
        for p in paths:
            if os.path.exists(p):
                t = open(p).read().strip()
                if t:
                    tokens.append(t)
        if not tokens:
            raise ValueError(f"No tokens found in {paths}")
        return cls(tokens, base)


import threading  # needed for LolzTokenPool._lock


# ---------------------------------------------------------------------------
# Text cleanup
# ---------------------------------------------------------------------------

_HTML_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_URL = re.compile(r"https?://\S+")
_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001F6FF\U0001F900-\U0001F9FF\U0001FA70-\U0001FAFF"
    "\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]+", flags=re.UNICODE
)


def strip_bbcode(text: str) -> str:
    if not text:
        return ""
    try:
        decoded = urllib.parse.unquote(text)
        if len(decoded) <= len(text) * 2:
            text = decoded
    except Exception:
        pass
    text = _URL.sub(" ", text)
    text = re.sub(r"\[/?[A-Za-z0-9*]+[^\]]*\]", " ", text)
    text = _HTML_TAG.sub(" ", text)
    text = unescape(text)
    text = re.sub(r"\[[A-Za-z0-9*]+=[^\]]*\]", " ", text)
    text = _WS.sub(" ", text)
    return text.strip()


def detect_caps_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    upper = sum(1 for c in letters if c.isupper())
    return upper / len(letters)


def detect_emoji_count(text: str) -> int:
    return len(_EMOJI_RE.findall(text))


# ---------------------------------------------------------------------------
# Lexicons — разговорный русский
# ---------------------------------------------------------------------------

# АДРЕСНЫЕ оскорбления — слова, называющие человека плохим. Практически
# всегда направлены на конкретного человека, даже без «ты» рядом
# («этот лох опять пишет», «автор темы — дебил»).
INSULT_WORDS = {
    "лох", "лохов", "идиот", "идиотка", "дебил", "дебилка", "тупой", "тупая",
    "тупые", "дурак", "мудак", "мудила", "мудень", "урод", "уродина",
    "сволочь", "сволота", "мразь", "тварь", "тварина", "гандон", "гондон",
    "пидор", "пидар", "пидорас", "пидрас", "пидр", "даун", "аутист", "шизик",
    "кретин", "имбецил", "долбоёб", "долбоеб", "разъёбок", "разъеб",
    "уёбок", "уебок", "уёбища", "ебанько", "хуйло", "хуйла", "мудозвон",
    "говнюк", "дрищ", "засранец", "очкоголик", "алкаш", "наркоша",
    "педик", "педрила", "сучка", "сучара", "мудень",
}

# Мат-ИНТЕНСИФИКАТОРЫ — ругань без адресата. На форумном сленге это часть
# речи («пиздец как удобно», «хуй знает», «работает заебись»), а не агрессия.
# Само по себе НЕ делает юзера токсиком.
SWEAR_WORDS = {
    "хуй", "хуя", "хуёв", "хулю", "хуёво", "пизда", "пиздец", "пиздить",
    "пиздёж", "ебать", "ебаный", "ёбаный", "ёбнул", "ёбарь", "блять",
    "блядь", "сука", "сцуко", "сукабля", "залупа", "залупаться",
    "ахуеть", "охуеть", "охуенно", "охуительно", "охуевший", "пиздато",
    "пиздатый", "заебись", "заебато", "заебал", "заебали", "говно",
    "говнецо", "дерьмо", "нахуй", "хуйня",
}

# Легаси-словарь: всё вместе. Остаётся для конфликтного скоринга и поиска
# «показательных» постов — там важна грубость языка, а не адресность.
TOXIC_WORDS = INSULT_WORDS | SWEAR_WORDS

# Маркеры адресата: оскорбление адресовано человеку, если рядом стоит
# 2-е лицо, указательное местоимение или глагол-команда.
_DIRECTED_MARKERS_RE = re.compile(
    r"\b(ты|тебе|тебя|тобой|твой|твоя|твоё|твои|вы|вам|вас|вами|ваш|ваша"
    r"|сам|сама|сами|этот|эта|эти|этот|он|она|они|им|ей|их)"
    r"\b", re.IGNORECASE,
)
_DIRECTED_COMMAND_RE = re.compile(
    r"(заткни(?:сь|тесь)|завали(?:сь|тесь)|пош[её]л\b.{0,10}(нахуй|на хуй)"
    r"|иди\b.{0,15}(нахуй|на хуй|в жопу|лесом)|соси\b|отсоси\b"
    r"|багром\b.{0,10}из|вали\b.{0,10}отсюда)",
    re.IGNORECASE,
)


def classify_toxicity(text: str) -> dict:
    """Адресность токсичности в одном посте.

    Возвращает:
      insults_directed — оскорбления, адресованные человеку («ты лох»,
        «этот дебил», «заткнись»);
      insults_any — все оскорбительные слова в тексте;
      swears — мат-интенсификаторы без адресата.
    """
    if not text:
        return {"insults_directed": 0, "insults_any": 0, "swears": 0}
    ins, _ = count_lexicon_hits(text, INSULT_WORDS)
    sw, _ = count_lexicon_hits(text, SWEAR_WORDS)
    directed = 0
    if ins:
        # оскорбление в одном предложении с маркером адресата → адресное
        for sentence in re.split(r"[.!?;\n…]", text):
            if not sentence.strip():
                continue
            sent_ins, _ = count_lexicon_hits(sentence, INSULT_WORDS)
            if not sent_ins:
                continue
            if _DIRECTED_MARKERS_RE.search(sentence) or _DIRECTED_COMMAND_RE.search(sentence):
                directed += sent_ins
            elif _DIRECTED_COMMAND_RE.search(text):
                directed += sent_ins
    elif _DIRECTED_COMMAND_RE.search(text):
        # «заткнись», «иди нахуй» без оскорбительных существительных — тоже агрессия
        directed = 1
    return {"insults_directed": directed, "insults_any": ins, "swears": sw}

# Позитивные слова
POSITIVE_WORDS = {
    "спасибо", "благодарю", "круто", "класс", "супер", "отлично", "молодец",
    "красава", "красавчик", "огонь", "имба", "имбовый", "топ", "топчик",
    "годнота", "годный", "��одно", "нравится", "обожаю", "люблю", "обожаю",
    "шикарно", "пушка", "офигенно", "офигенный", "чётко", "четко", "чётко",
    "вау", "огонь", "роскошно", "шик", "бомба", "бомбически", "неплохо",
    "хорошо", "хороший", "хорошая", "добро", "добрый", "мир", "дружба",
    "уважение", "уважаю", "респект", "респектую", "зачёт", "зачот",
    "красавелла", "крос", "кросава", "гуд", "гууд", "молодчик", "брат",
    "братишка", "свой", "братишь", "кабан", "кабанчик", "крош",
    "лапочка", "солнышко", "милашка", "позитив", "позитивный",
}

# Негативные слова (помимо токсичных)
NEGATIVE_WORDS = {
    "плохо", "плохой", "ужас", "ужасно", "дерьмово", "отстой", "отстойно",
    "хрень", "хрень", "фигня", "фуйня", "бред", "бредятина", "чушь",
    "глупость", "тупость", "бесит", "бесит", "бесило", "раздражает",
    "ненавижу", "презираю", "мерзко", "тошно", "противно", "гадко",
    "тоскливо", "грустно", "печально", "жаль", "жалко", "обидно",
    "злюсь", "злой", "разъярен", "раздражён", "недоволен", "разочарован",
    "провал", "фейл", "кринж", "кринжово", "позор", "позорно", "стыд",
    "стыдно", "лол кек", " Facepalm", "фейспалм", "мрак", "мутно",
    "мутный", "помойка", "дно", "днище", "херь", "херня", "бесполезно",
}

# Маркеры свободного неформального стиля
BRO_WORDS = {
    "свой", "братишка", "братишь", "брат", "кабан", "кабанчик", "крош",
    "чел", "челик", "парни", "пацаны", "мужики", "братья", "братва",
    "земеля", "земеля", "кент", "кореш", "бро", "бро", "дружище", "друг",
    "сюк", "сяб", "сябки", "спс", "спасиб", "пасиб", "пасибки",
    "кек", "лол", "лолл", "кекк", "ржака", "ржач", "угар", "угараю",
    "крос", "кросс", "кросавчик", "имба", "имбовый", "годнота", "годно",
    "чек", "чекай", "чекни", "чекну", "чекай", "чекай",
    "хайп", "хайпанул", "вайб", "вайбов", "краш", "топ", "топч",
    "кайф", "кайфово", "кайф", "огонёк", "огонек",
}

# Маркеры конкретного делового стиля
BUSINESS_WORDS = {
    "итак", "следовательно", "таким образом", "поэтому", "во-первых",
    "во-вторых", "итог", "резюме", "по сути", "фактически", "соответственно",
    "согласно", "исходя из", "так как", "поскольку", "ввиду", "вследствие",
    "однако", "тем не менее", "при этом", "кроме того", "более того",
    "в целом", "в общем", "в принципе", "как правило", "обычно",
    "необходимо", "следует", "требуется", "важно отметить", "стоит учесть",
}

# Маркеры неуверенности
HEDGING_WORDS = {
    "наверное", "кажется", "возможно", "может быть", "вероятно", "пожалуй",
    "вроде", "вроде бы", "типа", "как бы", "по-моему", "по моему",
    "я думаю", "я считаю", "мне кажется", "если не ошибаюсь", "если я не ошибаюсь",
    "скорее всего", "навряд ли", "едва ли", "вряд ли", "не уверен",
    "сомневаюсь", "не знаю", "без понятия", "хз", "не в курсе",
}

# Маркеры категоричности/уверенности
CERTAINTY_WORDS = {
    "точно", "100%", "сто проц", "сто процентов", "точно так", "именно так",
    "именно", "безусловно", "конечно", "разумеется", "понятно", "естественно",
    "обязательно", "непременно", "точно", "точно", " сто пудов ", "пудов",
    "всамделишный", "железно", "железобетонно", "на 100", "наверняка",
    "бесспорно", "очевидно", "ясно", "ясное дело", "факт", "фактически",
    " сто проц ", "точно говорю", "поверь", "точно тебе говорю",
}

# Эго-маркеры (зацикленность на себе)
EGO_WORDS = {
    "я", "меня", "мне", "мной", "моё", "моя", "мой", "мои", "моих", "моему",
    "моим", "моими", "моем", "моём", "я сам", "я лично", "по-моему",
    "по моему", "имхо", "как я считаю", "я думаю", "я уверен", "я знаю",
    "у меня", "для меня", "мне лично", "я бы", "я сделал", "я бы сделал",
}

# Маркеры помощи другим
HELP_WORDS = {
    "помогу", "помочь", "помощь", "объясню", "объясняю", "подскажу",
    "подсказка", "гайд", "инструкция", "туториал", "разберёмся",
    "разберемся", "вот решение", "держи", "на вот", "лови", "держите",
    "вот держи", "вот лови", "попробуй так", "сделай так", "вот так",
    "щас покажу", "сейчас покажу", "смотри", "внимательно", "читай",
    "читайте", "обрати внимание", "обратите внимание", "запомни", "запомните",
}

# Технические/специфичные маркеры
TECH_WORDS = {
    "python", "py", "js", "javascript", "node", "nodejs", "react", "vue",
    "angular", "typescript", "ts", "linux", "ubuntu", "debian", "windows",
    "macos", "android", "ios", "сервер", "vps", "vds", "dedic", "proxy",
    "vpn", "токен", "api", "код", "скрипт", "regex", "регуля", "регулярка",
    "база данных", "бд", "sql", "mysql", "postgres", "redis", "mongo",
    "html", "css", "scss", "less", "webpack", "vite", "docker", "kubernetes",
    "k8s", "обход", "антидетект", "капча", "прокси", "фингерпринт",
    "биткоин", "btc", "крипта", "ethereum", "eth", "usdt", "ton",
    "кошель", "wallet", "metamask", "p2p", "обменник", "терп", "холодильник",
    "онлифанс", "онлифан", "of", "тг", "тмп", "telegram", "дискорд",
    "discord", "ютуб", "youtube", "twit", "твиттер", "x.com", "инстаграм",
    "instagram", "tiktok", "тикток", "твич", "twitch", "авито", "wmr",
    "qliwi", "киви", "yoomoney", "юmoney", "сбер", "сбербанк", "т inaugural",
    "sda", "sa", "mcd", "g2a", "epicgames", "epic", "steam", "origin",
    "uplay", "battlenet", "gog", "valorant", "csgo", "cs2", "dota",
    "genshin", "honkai", "wow", "fortnite", "roblox", "minecraft", "танки",
    "wot", "wot blitz", "warface", "тэрки", "турки", "ткрки", "аксакс",
    "трэш", "трэшак", "мамонт", "мамонты", "куки", "кукисы", "кукиз",
    "слот", "слотик", "аккаунт", "акк", "акки", "прокачка", "фарма",
    "фарм", "бот", "боты", "бота", "автокликер", "макрос", "чит", "читы",
}

# Стоп-слова для keyword extraction
STOPWORDS = {
    "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как",
    "а", "то", "все", "она", "так", "его", "но", "да", "ты", "к",
    "у", "же", "вы", "за", "бы", "по", "только", "ее", "мне", "было",
    "вот", "от", "меня", "о", "из", "ему", "теперь", "когда", "даже",
    "ну", "вдруг", "ли", "если", "или", "быть", "был", "него", "до",
    "вас", "нибудь", "опять", "уж", "вам", "ведь", "там", "потом",
    "себя", "ничего", "ей", "может", "они", "тут", "где", "есть", "надо",
    "ней", "для", "мы", "тебя", "их", "чем", "была", "сам", "чтоб",
    "без", "будто", "чего", "раз", "тоже", "себе", "под", "будет", "ж",
    "тогда", "кто", "этот", "того", "потому", "этого", "какой", "совсем",
    "тут", "этом", "один", "почти", "мой", "тем", "чтобы", "нее",
    "сейчас", "были", "куда", "зачем", "всех", "никогда", "можно",
    "при", "наконец", "два", "об", "другой", "хоть", "после", "над",
    "больше", "тот", "через", "эти", "нас", "про", "всего", "них", "какая",
    "много", "разве", "три", "эту", "моя", "впрочем", "хорошо", "свою",
    "этой", "перед", "иногда", "лучше", "чуть", "том", "нельзя", "такой",
    "им", "более", "всегда", "конечно", "всю", "между",
    "spoiler", "img", "url", "user", "media", "code", "quote", "color",
    "size", "font", "center", "left", "right", "list", "table", "attach",
    "video", "audio", "youtube", "soundcloud", "instagram", "telegram",
    "discord", "twitter", "facebook", "twitch", "plain", "html", "alt",
    "align", "http", "https", "www", "com", "ru", "net", "org", "php",
    "это", "эта", "этих", "этим", "этими", "этого", "��том", "этому",
    "все", "всё", "всех", "всем", "также", "тоже", "лишь", "ведь", "вот",
    "там", "тут", "тогда", "туда", "сюда", "оттуда", "поэтому", "потому",
    "зачем", "почему", "как", "что", "кто", "где", "куда", "когда",
    "какой", "какая", "какие", "мне", "тебе", "ему", "ей", "нам", "вам", "им",
    "если", "чтобы", "так как", "как бы", "типа", "вроде", "наверное",
    "просто", "ещё", "еще", "уже", "только", "ещё бы", "еще бы", "тоже",
    "также", "таки", "всё-таки", "все-таки", "лишь", "ток", "токмо",
}


def count_lexicon_hits(text: str, lexicon: set) -> tuple[int, list[str]]:
    """Сколько слов из лексикона встречается в тексте. Возвращает (count, matched)."""
    if not text:
        return 0, []
    low = text.lower()
    # Расширенное слово
    tokens = re.findall(r"[a-zа-яё0-9+\-_]{2,}", low)
    matched = []
    for t in tokens:
        if t in lexicon:
            matched.append(t)
    # Дополнительно — многословные фразы
    for phrase in lexicon:
        if " " in phrase and phrase in low:
            matched.append(phrase)
    return len(matched), list(set(matched))


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def humanize_age(seconds: int) -> str:
    days = seconds // 86400
    years = days // 365
    months = (days % 365) // 30
    if years >= 1:
        rest = months
        return f"{years} {plural_ru(years, 'год', 'года', 'лет')}" + (
            f" {rest} {plural_ru(rest, 'месяц', 'месяца', 'месяцев')}" if rest else "")
    if months >= 1:
        return f"{months} {plural_ru(months, 'месяц', 'месяца', 'месяцев')}"
    return f"{days} {plural_ru(days, 'день', 'дня', 'дней')}"


def humanize_last_seen(seconds: int) -> str:
    if seconds < 60:
        return "Сейчас онлайн (или был только что)"
    if seconds < 3600:
        m = seconds // 60
        return f"Был {m} {plural_ru(m, 'минуту', 'минуты', 'минут')} назад"
    if seconds < 86400:
        h = seconds // 3600
        return f"Был {h} {plural_ru(h, 'час', 'часа', 'часов')} назад"
    d = seconds // 86400
    if d == 1:
        return "Был вчера"
    if d < 7:
        return f"Был {d} {plural_ru(d, 'день', 'дня', 'дней')} назад"
    if d < 30:
        w = d // 7
        return f"Был {w} {plural_ru(w, 'неделю', 'недели', 'недель')} назад"
    if d < 365:
        mo = d // 30
        return f"Был {mo} {plural_ru(mo, 'месяц', 'месяца', 'месяцев')} назад"
    y = d // 365
    return f"Заброшен ({y} {plural_ru(y, 'год', 'года', 'лет')} без активности)"


def plural_ru(n: int, one: str, few: str, many: str) -> str:
    n10 = n % 10
    n100 = n % 100
    if 10 <= n100 <= 20:
        return many
    if n10 == 1:
        return one
    if 2 <= n10 <= 4:
        return few
    return many


def analyze_activity_hours(timestamps: list[int]) -> dict:
    if not timestamps:
        return {"verdict": "нет данных", "hours": {}, "peak_hour": None,
                "night_ratio": 0, "day_ratio": 0, "evening_ratio": 0, "weekend_ratio": 0}

    hours = Counter()
    weekdays = Counter()
    for ts in timestamps:
        try:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        except (ValueError, OSError):
            continue
        hours[dt.hour] += 1
        weekdays[dt.weekday()] += 1

    if not hours:
        return {"verdict": "нет данных", "hours": {}, "peak_hour": None,
                "night_ratio": 0, "day_ratio": 0, "evening_ratio": 0, "weekend_ratio": 0}

    peak = hours.most_common(1)[0][0]
    night = sum(hours[h] for h in [0, 1, 2, 3, 4, 5])
    morning = sum(hours[h] for h in [6, 7, 8, 9, 10, 11])
    day = sum(hours[h] for h in [12, 13, 14, 15, 16, 17])
    evening = sum(hours[h] for h in [18, 19, 20, 21, 22, 23])
    total = sum(hours.values())

    weekend = sum(weekdays[h] for h in [5, 6])
    weekend_ratio = weekend / total if total else 0

    night_ratio = night / total
    day_ratio = day / total
    morning_ratio = morning / total
    evening_ratio = evening / total

    # Живые вердикты вместо канцелярита
    if night_ratio > 0.35:
        verdict = f"Сова — {round(night_ratio*100)}% постов ночью (0–6). Спит днём, тусит в 3 утра"
    elif day_ratio > 0.5 and weekend_ratio < 0.2:
        verdict = f"Офисный — будни 12–18 ({round(day_ratio*100)}%). Форум как перекур"
    elif weekend_ratio > 0.45:
        verdict = f"Выходной сёрфер — {round(weekend_ratio*100)}% постов в сб/вс. Будни пропускает"
    elif morning_ratio > 0.35:
        verdict = f"Жаворонок — {round(morning_ratio*100)}% постов до полудня"
    elif evening_ratio > 0.4:
        verdict = f"Вечерний — {round(evening_ratio*100)}% после 18:00. Днём занят, вечером тусит"
    elif total > 30 and day_ratio > 0.25 and night_ratio > 0.2:
        verdict = "Круглосуточный — пишет и днём, и ночью, без режима"
    else:
        verdict = "Без явного паттерна — пишет когда придётся"

    return {
        "verdict": verdict,
        "hours": dict(sorted(hours.items())),
        "peak_hour": peak,
        "night_ratio": round(night_ratio, 2),
        "day_ratio": round(day_ratio, 2),
        "morning_ratio": round(morning_ratio, 2),
        "evening_ratio": round(evening_ratio, 2),
        "weekend_ratio": round(weekend_ratio, 2),
        "total_datapoints": total,
    }


def analyze_yearly_dynamics(timestamps: list[int]) -> dict:
    """Динамика активности по годам — растёт/падает/стабильно."""
    if not timestamps:
        return {"verdict": "нет данных", "by_year": {}, "trend": "—"}

    by_year = Counter()
    by_month = Counter()
    for ts in timestamps:
        try:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        except (ValueError, OSError):
            continue
        by_year[dt.year] += 1
        by_month[f"{dt.year}-{dt.month:02d}"] += 1

    years_sorted = sorted(by_year.keys())
    if len(years_sorted) < 2:
        return {
            "verdict": "Слишком мало данных для тренда",
            "by_year": dict(by_year),
            "by_year_sorted": [(y, by_year[y]) for y in years_sorted],
            "trend": "—",
        }

    first_year_count = by_year[years_sorted[0]]
    last_year_count = by_year[years_sorted[-1]]
    peak_year = max(by_year.items(), key=lambda x: x[1])

    # Считаем тренд за последние 3 года
    recent = years_sorted[-3:]
    recent_counts = [by_year[y] for y in recent]
    if len(recent_counts) >= 2:
        if recent_counts[-1] > recent_counts[0] * 1.3:
            trend = "растёт"
        elif recent_counts[-1] < recent_counts[0] * 0.7:
            trend = "падает"
        else:
            trend = "стабильно"
    else:
        trend = "—"

    if trend == "растёт":
        verdict = f"Активность растёт — пик в {peak_year[0]} ({peak_year[1]} постов). Разгоняется"
    elif trend == "падает":
        verdict = f"Активность падает — был пик в {peak_year[0]} ({peak_year[1]}), сейчас затухает"
    else:
        verdict = f"Стабильно активен — пик в {peak_year[0]} ({peak_year[1]} постов). Без пе��екосов"

    return {
        "verdict": verdict,
        "by_year": dict(by_year),
        "by_year_sorted": [(y, by_year[y]) for y in years_sorted],
        "peak_year": peak_year[0],
        "peak_year_count": peak_year[1],
        "trend": trend,
    }


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class Profile:
    user_id: int = 0
    username: str = ""
    avatar: str = ""
    user_title: str = ""
    custom_title: str = ""
    is_banned: bool = False
    register_date: int = 0
    last_seen_date: int = 0
    message_count: int = 0
    like_count: int = 0
    like2_count: int = 0
    trophy_count: int = 0
    warning_points: int = 0
    groups: list[dict] = field(default_factory=list)
    primary_group: str = ""
    fields: dict = field(default_factory=dict)
    banned_text: str = ""
    following_count: int = 0
    followers_count: int = 0

    @classmethod
    def from_api(cls, data: dict) -> "Profile":
        u = data.get("user", data)
        groups = u.get("user_groups", []) or []
        primary = next(
            (g for g in groups if g.get("is_primary_group")),
            groups[0] if groups else {},
        )
        links = u.get("links") or {}
        return cls(
            user_id=int(u.get("user_id", 0) or 0),
            username=u.get("username", ""),
            avatar=links.get("avatar") or u.get("user_avatar") or "",
            user_title=u.get("user_title", "") or "",
            custom_title=u.get("custom_title", "") or "",
            is_banned=bool(u.get("is_banned", 0)),
            register_date=int(u.get("user_register_date", 0) or 0),
            last_seen_date=int(u.get("user_last_seen_date", 0) or 0),
            message_count=int(u.get("user_message_count", 0) or 0),
            like_count=int(u.get("user_like_count", 0) or 0),
            like2_count=int(u.get("user_like2_count", 0) or 0),
            trophy_count=int(u.get("trophy_count", 0) or 0),
            warning_points=int(u.get("warning_points", 0) or 0),
            groups=groups,
            primary_group=primary.get("user_group_title", "") if primary else "",
            fields=u.get("fields", {}) or {},
            banned_text=u.get("banner", "") or "",
            following_count=len((u.get("user_following") or {}).get("users", []) or []),
            followers_count=len((u.get("user_followers") or {}).get("users", []) or []),
        )


@dataclass
class UserPost:
    """Пост из /users/{id}/timeline — основной источник текстов."""
    post_id: int
    body: str
    body_raw: str
    create_date: int
    thread_id: int
    thread_title: str
    like_count: int
    comment_count: int
    is_first_post: bool
    forum_title: str

    @classmethod
    def from_api(cls, p: dict) -> "UserPost":
        thread = p.get("thread", {}) or {}
        forum = thread.get("forum", {}) or {}
        # ВАЖНО: в POST /search/posts НЕТ forum_title, но есть node_title.
        # Используем node_title как приоритет если forum_title пустой.
        forum_title = forum.get("forum_title", "") or thread.get("node_title", "") or ""
        return cls(
            post_id=int(p.get("post_id", 0) or 0),
            body=strip_bbcode(p.get("post_body", "") or ""),
            body_raw=p.get("post_body", "") or "",
            create_date=int(p.get("post_create_date", 0) or 0),
            thread_id=int(p.get("thread_id", 0) or 0),
            thread_title=strip_bbcode(thread.get("thread_title", "") or ""),
            like_count=int(p.get("post_like_count", 0) or 0),
            comment_count=int(p.get("post_comment_count", 0) or 0),
            is_first_post=bool(p.get("post_is_first_post", False)),
            forum_title=forum_title,
        )


@dataclass
class Thread:
    thread_id: int
    title: str
    body: str
    body_raw: str
    forum_id: int
    forum_title: str
    create_date: int
    view_count: int
    reply_count: int
    like_count: int = 0
    is_sticky: bool = False
    is_closed: bool = False

    @classmethod
    def from_api(cls, t: dict) -> "Thread":
        first = t.get("first_post", {}) or {}
        forum = t.get("forum", {}) or {}
        return cls(
            thread_id=int(t.get("thread_id", 0) or 0),
            title=strip_bbcode(t.get("thread_title", "") or ""),
            body=strip_bbcode(first.get("post_body", "") or ""),
            body_raw=first.get("post_body", "") or "",
            forum_id=int(forum.get("forum_id", 0) or 0),
            forum_title=forum.get("forum_title", "") or
                        t.get("node_title", "") or "",
            create_date=int(t.get("thread_create_date", 0) or 0),
            view_count=int(t.get("thread_view_count", 0) or 0),
            reply_count=int(t.get("thread_post_count", 0) or 0),
            like_count=int(first.get("post_like_count", 0) or 0),
            is_sticky=bool(t.get("thread_is_sticky", False)),
            is_closed=bool(t.get("thread_is_closed", False)),
        )


@dataclass
class WallPost:
    post_id: int
    poster_id: int
    poster_name: str
    body: str
    body_raw: str
    create_date: int

    @classmethod
    def from_api(cls, p: dict) -> "WallPost":
        return cls(
            post_id=int(p.get("profile_post_id", 0) or 0),
            poster_id=int(p.get("poster_user_id", 0) or 0),
            poster_name=p.get("poster_username", "") or "",
            body=strip_bbcode(p.get("post_body", "") or ""),
            body_raw=p.get("post_body", "") or "",
            create_date=int(p.get("post_create_date", 0) or 0),
        )


# ---------------------------------------------------------------------------
# Personality analysis — глубокий портрет
# ---------------------------------------------------------------------------

def analyze_emotional_profile(texts: list[str]) -> dict:
    """Эмоциональный разрез: позитиф/негатив/нейтрально.

    «Токсично» = пост с АДРЕСНЫМИ оскорблениями или откровенным разгоном
    (3+ единиц мата). Одиночный мат-интенсификатор («пиздец удобно»)
    токсичностью не считается — это сленг, а не агрессия.
    """
    pos_count = 0
    neg_count = 0
    toxic_count = 0
    neutral = 0

    for t in texts:
        if not t:
            continue
        cls = classify_toxicity(t)
        pos, _ = count_lexicon_hits(t, POSITIVE_WORDS)
        neg, _ = count_lexicon_hits(t, NEGATIVE_WORDS)
        if cls["insults_directed"] >= 1 or cls["swears"] >= 3:
            toxic_count += 1
        elif neg > pos:
            neg_count += 1
        elif pos > neg:
            pos_count += 1
        else:
            neutral += 1

    total = max(1, pos_count + neg_count + neutral + toxic_count)
    return {
        "positive_pct": round(pos_count / total * 100),
        "negative_pct": round(neg_count / total * 100),
        "toxic_pct": round(toxic_count / total * 100),
        "neutral_pct": round(neutral / total * 100),
        "verdict": _emotion_verdict(pos_count, neg_count, toxic_count, neutral),
    }


def _emotion_verdict(pos, neg, tox, neu) -> str:
    total = max(1, pos + neg + tox + neu)
    if tox / total > 0.25:
        return f"Токсик — {round(tox/total*100)}% постов с оскорблениями собеседников"
    if pos / total > 0.45:
        return f"Позитивный — {round(pos/total*100)}% постов с плюсовыми эмоциями"
    if neg / total > 0.4:
        return f"Негативный — {round(neg/total*100)}% постов с минусом. Вечно недоволен"
    if neu / total > 0.6:
        return f"Пишет по делу — {round(neu/total*100)}% сообщений выдержаны в нейтральном тоне"
    return f"Сбалансированный — позитиф {round(pos/total*100)}% / негатив {round(neg/total*100)}% / нейтрально {round(neu/total*100)}%"



_PUBLIC_TEXT_REPLACEMENTS = (
    # «Миролюбивый токсик» и прочие противоречивые склейки из старых кэшей/AI
    (r"миролюбив[оы][маюх]*\s+токсик\w*", "прямой, но без агрессии"),
    (r"токсик[,\s]+но\s+миролюбив\w*", "матерится, но без агрессии к людям"),
    (r"\u0441\u0443\u0445\u0430\u0440\w*", "пишет по делу"),
    (r"\u0442\u0435\u0445\u043d\u0430\u0440\w*", "разбирается в теме"),
    (r"\u0444\u0438\u043a\u0441[\u0435\u0451]\u0440\w*", "Решала"),
    (r"\u043f\u043b\u043e\u0434\u043e\u0432\u0438\u0442\w*", "активный"),
    (r"\u0431\u0440\u0430\u0442\u0430\u043d[- ](?:\u0431\u0440\u0430\u0442\u0443\u0448\u043d\u0438\u043a|\u043a\u0430\u0431\u0430\u043d)\w*", "свой в общении"),
)

def sanitize_dossier(value):
    """Не выпускает устаревшие ярлыки ни из ядра, ни из моделей, ни из кэша."""
    if isinstance(value, str):
        for pattern, replacement in _PUBLIC_TEXT_REPLACEMENTS:
            value = re.sub(pattern, replacement, value, flags=re.IGNORECASE)
        return value
    if isinstance(value, list):
        return [sanitize_dossier(item) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_dossier(item) for item in value)
    if isinstance(value, dict):
        return {key: sanitize_dossier(item) for key, item in value.items()}
    return value


def analyze_ego_index(texts: list[str]) -> dict:
    """Эго-индекс: насколько зациклен на себе."""
    ego_hits = 0
    total_words = 0
    for t in texts:
        if not t:
            continue
        words = t.split()
        total_words += len(words)
        cnt, _ = count_lexicon_hits(t, EGO_WORDS)
        ego_hits += cnt
    # Эго-индекс: эго-слова на 100 слов
    if total_words == 0:
        return {"score": 0, "verdict": "нет данных", "hits": 0, "per_100": 0}
    per_100 = round(ego_hits / total_words * 100, 2)
    if per_100 > 4:
        verdict = f"Эгоцентрик — «я/мой/мне» на каждом шагу ({per_100} эго-маркеров на 100 слов)"
    elif per_100 > 2:
        verdict = f"Эго есть, но в меру ({per_100} на 100 слов)"
    elif per_100 > 0.5:
        verdict = f"Сдержанный в «я-высказываниях» ({per_100} на 100 слов)"
    else:
        verdict = "Почти без «я» — пишет о вещах, а не о себе"
    return {
        "score": per_100,
        "hits": ego_hits,
        "per_100": per_100,
        "verdict": verdict,
    }


def analyze_psychological_age(profile, all_texts, manner, emotion, ego,
                              confidence, literacy) -> dict:
    """Оценка психологического возраста по наблюдаемому стилю общения.

    Гибридная модель: здесь считается АЛГОРИТМИЧЕСКАЯ БАЗА (14..60) на основе
    реальных сигналов из анализа. AI-слой (ai_interpreter) может позже слегка
    скорректировать это число, оставаясь в тех же границах.

    Сигналы (каждый двигает базу от нейтральных ~26 лет):
      • грамотность / длина сообщений — развёрнутая грамотная речь → старше
      • токсичность / негатив — импульсивность и агрессия → моложе
      • эго-индекс — высокая зацикленность на себе → моложе
      • уверенность — взвешенная уверенность → старше; крайности → моложе
      • манера — категоричность/подколы → моложе; деловая → старше
      • CAPS / эмодзи — экспрессивная подача → моложе
      • стаж аккаунта — слабый корректор

    Возвращает dict; при малой выборке — {"available": False}, чтобы фронт
    не рисовал фейковую цифру.
    """
    AGE_MIN, AGE_MAX = 14, 60

    def _clamp(v, lo, hi):
        return lo if v < lo else hi if v > hi else v

    texts = [t for t in (all_texts or []) if t]
    msg_count = int(getattr(profile, "message_count", 0) or 0)

    if len(texts) < 15 and msg_count < 60:
        return {"available": False, "verdict": "недостаточно данных"}

    base = 26.0
    factors = []

    def _push(label, delta):
        if abs(delta) >= 0.4:
            factors.append({"label": label, "delta": round(delta, 1)})

    # 1) Грамотность и длина сообщений
    lit_score = float(literacy.get("score", 0) or 0)
    avg_words = float(literacy.get("avg_words_per_post", 0) or 0)
    d = (lit_score - 50) / 50 * 7 + _clamp((avg_words - 12) / 12, -1, 1.5) * 5
    base += d
    _push("грамотность и развёрнутость речи", d)

    # 2) Эмоциональный профиль (токсичность/негатив = импульсивность)
    toxic = float(emotion.get("toxic_pct", 0) or 0)
    neg = float(emotion.get("negative_pct", 0) or 0)
    neutral = float(emotion.get("neutral_pct", 0) or 0)
    d = -(_clamp(toxic / 15, 0, 1.5) * 6) - (_clamp(neg / 30, 0, 1) * 3) \
        + (_clamp((neutral - 60) / 40, 0, 1) * 3)
    base += d
    _push("эмоциональная сдержанность", d)

    # 3) Эго-индекс (зацикленность на себе → моложе)
    ego_per100 = float(ego.get("per_100", 0) or 0)
    d = -_clamp((ego_per100 - 3) / 4, -0.6, 1.5) * 5
    base += d
    _push("низкий эгоцентризм", d)

    # 4) Уверенность (взвешенная → старше; крайности → моложе)
    conf = float(confidence.get("score", 50) or 50)
    d = -abs(conf - 62) / 38 * 5 + 2
    base += d
    _push("взвешенность высказываний", d)

    # 5) Манера общения
    scores = manner.get("scores", {}) if isinstance(manner, dict) else {}
    business = float(scores.get("деловой", 0) or scores.get("по_делу", 0) or 0)
    categoric = float(scores.get("категоричный", 0) or 0)
    # возраст_манера_ключи_v2: реальный ключ стёба — «стёбщик» (см.
    # analyze_manner); «шутник»/«подкол» в scores не существуют, из-за чего
    # подколы никогда не молодили оценку.
    joky = float(scores.get("шутник", 0) or scores.get("подкол", 0)
                 or scores.get("стёбщик", 0) or 0)
    d = _clamp(business / 5, 0, 1) * 4 - _clamp(categoric / 5, 0, 1) * 3 \
        - _clamp(joky / 5, 0, 1) * 3
    base += d
    _push("деловой стиль", d)

    # 6) CAPS / эмодзи (экспрессия → моложе)
    caps = sum(detect_caps_ratio(t) for t in texts) / max(1, len(texts))
    # возраст_смайлы_v2: форумные смайлы-коды (:beer:, :pog:, :pepe…)
    # считаем наравне с Unicode-эмодзи — раньше они не учитывались вовсе.
    def _emoji_units(t: str) -> int:
        codes = len(re.findall(r"(?<![\w:])[:;][a-zA-Z0-9_]{2,24}:(?![\w:])", t or ""))
        return detect_emoji_count(t) + codes
    emoji = sum(_emoji_units(t) for t in texts) / max(1, len(texts))
    d = -_clamp(caps / 0.3, 0, 1) * 3 - _clamp(emoji / 2, 0, 1) * 2
    base += d
    _push("спокойная подача", d)

    # 7) Стаж аккаунта — слабый корректор
    reg = int(getattr(profile, "register_date", 0) or 0)
    if reg:
        acc_years = max(0.0, (int(time.time()) - reg) / (365 * 86400))
        d = _clamp((acc_years - 2) / 3, -0.8, 1) * 2.5
        base += d
        _push("стаж на форуме", d)

    age = int(round(_clamp(base, AGE_MIN, AGE_MAX)))

    if age < 18:
        verdict = "подростковая манера"
    elif age < 24:
        verdict = "молодой стиль"
    elif age < 33:
        verdict = "зрелый стиль"
    elif age < 45:
        verdict = "взрослая манера"
    else:
        verdict = "умудрённая манера"

    sample = max(len(texts), msg_count)
    reliability = int(round(_clamp(40 + sample / 8, 40, 92)))
    factors.sort(key=lambda f: abs(f["delta"]), reverse=True)

    return {
        "available": True,
        "age": age,
        "verdict": verdict,
        "reliability": reliability,
        "range": [AGE_MIN, AGE_MAX],
        "factors": factors[:5],
        "source": "algorithmic",
    }


def analyze_confidence(texts: list[str]) -> dict:
    """Баланс уверенных формулировок и оговорок с реальными маркерами."""
    certain = 0
    hedging = 0
    certain_found = []
    hedging_found = []
    for text in texts:
        if not text:
            continue
        c, cm = count_lexicon_hits(text, CERTAINTY_WORDS)
        h, hm = count_lexicon_hits(text, HEDGING_WORDS)
        certain += c
        hedging += h
        certain_found.extend(cm)
        hedging_found.extend(hm)
    total = certain + hedging
    score = 50 if total == 0 else round(certain / total * 100)
    if total == 0:
        verdict = "Характерных маркеров мало — формулирует мысли нейтрально"
    elif score > 80:
        verdict = f"Очень уверенная подача — {score}% характерных формулировок звучат категорично"
    elif score > 60:
        verdict = f"Уверенная подача — {score}% характерных формулировок звучат твёрдо"
    elif score >= 40:
        verdict = f"Балансирует между уверенностью и осторожностью — {score}% уверенных формулировок"
    else:
        verdict = f"Формулирует осторожно — только {score}% характерных фраз звучат уверенно"
    def uniq(items):
        return list(dict.fromkeys(x.strip() for x in items if x.strip()))[:6]
    return {
        "score": score, "verdict": verdict, "certain": certain, "hedging": hedging,
        "certain_markers": uniq(certain_found), "hedging_markers": uniq(hedging_found),
        "evidence_total": total,
        "reliability": "высокая" if total >= 20 else "средняя" if total >= 8 else "низкая",
    }


def analyze_manner(texts: list[str]) -> dict:
    """Манера общения — живой словарь вместо «панибратский»."""
    scores = {
        "свой": 0,
        "токсик": 0,
        "стёбщик": 0,
        "по_делу": 0,
        "помогает": 0,
        "разбирается": 0,
        "категоричный": 0,
        "сомневающийся": 0,
    }
    for t in texts:
        if not t:
            continue
        bro, _ = count_lexicon_hits(t, BRO_WORDS)
        biz, _ = count_lexicon_hits(t, BUSINESS_WORDS)
        help_, _ = count_lexicon_hits(t, HELP_WORDS)
        tech, _ = count_lexicon_hits(t, TECH_WORDS)
        cert, _ = count_lexicon_hits(t, CERTAINTY_WORDS)
        hedg, _ = count_lexicon_hits(t, HEDGING_WORDS)

        # Сарказм: ")))", "лол", "кек", "офф"
        low = t.lower()
        sarc = 0
        if ")))" in t: sarc += 1
        if "лол" in low or "кек" in low or "орнул" in low or "рфл" in low: sarc += 1
        if " типа " in low or " как бы " in low: sarc += 1

        # Токсичность = адресная агрессия, а не «матерится как все»
        cls = classify_toxicity(t)
        tox_score = cls["insults_directed"] * 2
        if cls["insults_directed"] == 0 and cls["swears"] >= 3:
            tox_score = 1  # разгон без адресата — слабый сигнал

        scores["свой"] += bro
        scores["токсик"] += tox_score
        scores["стёбщик"] += sarc
        scores["по_делу"] += biz
        scores["помогает"] += help_
        scores["разбирается"] += tech
        scores["категоричный"] += cert
        scores["сомневающийся"] += hedg

    # Топ-2 манеры
    sorted_scores = sorted(scores.items(), key=lambda x: -x[1])
    top1 = sorted_scores[0]
    top2 = sorted_scores[1] if len(sorted_scores) > 1 else ("", 0)

    # Если всё по нулям — нейтральный
    if top1[1] == 0:
        primary = "нейтральный"
        secondary = ""
    else:
        primary = top1[0]
        secondary = top2[0] if top2[1] > 0 else ""

    # Описание для каждой манеры — простым языком, без клише
    MANNER_DESC = {
        "свой": "общается свободно, на понятном форумном языке",
        "токсик": "переходит на личности — оскорбляет собеседников, а не просто ругается",
        "стёбщик": "вечный сарказм, «)))» и «лол», иронизирует над всем",
        "по_делу": "пишет конкретно, без лишних отступлений",
        "помогает": "часто предлагает конкретную помощь и объясняет решения",
        "разбирается": "уверенно использует технические термины и контекст",
        "категоричный": "уверен в себе, «точно/именно/сто проц»",
        "сомневающийся": "часто сомневается — «вроде/наверное/если не ошибаюсь»",
        "нейтральный": "без явных перекосов в стиле",
    }

    desc = MANNER_DESC.get(primary, "")
    if secondary and secondary != primary:
        desc += f" + {MANNER_DESC.get(secondary, '')}"

    return {
        "primary": primary,
        "secondary": secondary,
        "description": desc,
        "scores": scores,
    }


def detect_archetypes(profile: Profile, posts: list[UserPost],
                      threads: list[Thread], wall: list[WallPost],
                      manner: dict, emotion: dict, ego: dict,
                      confidence: dict) -> list[str]:
    """
    Предварительные типажи от ядра (AI потом уточнит).
    Используем список типажей, согласованный с пользователем.
    """
    types = []
    all_text = " ".join(p.body for p in posts if p.body).lower() + " " + \
               " ".join(t.body for t in threads if t.body).lower()

    age_years = (int(time.time()) - profile.register_date) / (365 * 86400) if profile.register_date else 0

    # Минимальная выборка: на 10 постах ярлыки «токсик/мудак» не раздают —
    # там статистика шумит и один сорванный пост ломает весь портрет
    sample_size = len([p for p in posts if p.body]) + len([t for t in threads if t.body])

    # ТОКСИК — адресные оскорбления в заметной доле постов, не «матерится как все».
    # Мат без адресата (сленг) токсиком не делает.
    if sample_size >= 15:
        if emotion["toxic_pct"] >= 25 or manner["scores"].get("токсик", 0) >= 8:
            types.append("Токсик")

    # ШАРИТ — много технических маркеров
    if manner["scores"].get("разбирается", 0) >= 5:
        types.append("Шарит")

    # ЗАДРОТ — длинные развёрнутые посты + технические
    avg_words = sum(len(p.body.split()) for p in posts if p.body) / max(1, len(posts))
    if manner["scores"].get("разбирается", 0) >= 3 and avg_words > 30:
        types.append("Задрот")

    # ТРОЛЛЬ — сарказм + адресная агрессия (не просто стёб)
    if manner["scores"].get("стёбщик", 0) >= 4 and manner["scores"].get("токсик", 0) >= 4:
        types.append("Тролль")

    # ТИХИЙ — мало постов, короткие
    if profile.message_count < 200 and avg_words < 15:
        types.append("Тихий")

    # ОЛД — стаж 5+ лет
    if age_years >= 5:
        types.append("Олд")

    # ДУШНИЛА — категоричный + спорит до последнего
    if manner["scores"].get("категоричный", 0) >= 4 and confidence["score"] > 70:
        types.append("Душнила")

    # ПО ДЕЛУ — деловой стиль, мало эмоций
    if manner["scores"].get("по_делу", 0) >= 3 and emotion["neutral_pct"] >= 70:
        types.append("По делу")

    # ЧЁТКИЙ ЧЕЛ — адекватный, без крайностей (если не подошёл ни один токсичный)
    if not any(t in types for t in ["Токсик", "Тролль", "Душница", "Мудак"]):
        if manner["scores"].get("свой", 0) >= 3 and manner["scores"].get("токсик", 0) <= 2:
            types.append("Чёткий чел")

    # ПОМОГАТОР → Брат по разуму
    if manner["scores"].get("помогает", 0) >= 3:
        types.append("Брат по разуму")

    # ДУША — стена активная
    if len(wall) >= 10:
        unique_posters = len({w.poster_id for w in wall if w.poster_id != profile.user_id})
        if unique_posters >= 5:
            types.append("Душа")

    # СПАМЕР — много коротких постов
    if len(posts) >= 100 and avg_words < 8:
        types.append("Спамер")

    # НОВОРЕГ — рега < 6 мес
    if age_years < 0.5 and profile.message_count < 200:
        types.append("Новорег")

    # СКАМ-ТРЕВОГА — много претензий в темах
    claims_count = sum(1 for t in threads if t.forum_title and
                       ("претенз" in t.forum_title.lower() or
                        "скам" in t.forum_title.lower()))
    if claims_count >= 5:
        types.append("Скам-тревога")

    # БАЙТЕР — много тем про продажу
    sell_count = sum(1 for t in threads if t.forum_title and
                     ("прода" in t.forum_title.lower() or
                      "скупк" in t.forum_title.lower() or
                      "обмен" in t.forum_title.lower()))
    if sell_count >= 5:
        types.append("Байтер")

    # РЕШАЛА — много постов в «решенных претензиях»
    fixed_count = sum(1 for t in threads if t.forum_title and
                      "решен" in t.forum_title.lower())
    if fixed_count >= 5 and manner["scores"].get("помогает", 0) >= 2:
        types.append("Решала")

    # КРИПТАН — крипта/P2P
    crypto_words = ["btc", "bitcoin", "крипта", "p2p", "usdt", "терп",
                    "обменник", "metamask", "ton", "eth", "кошель"]
    if sum(1 for w in crypto_words if w in all_text) >= 3:
        types.append("Криптан")

    # МАМОНТ — если часто пишет про то, что его кинули
    if sum(1 for w in ["кинули", "обманули", "пролетел", "лоханулся"] if w in all_text) >= 2:
        types.append("Мамонт")

    # МУДАК — систематическая адресная агрессия при полном ноле помощи
    if (sample_size >= 15 and
        emotion["toxic_pct"] >= 40 and
        manner["scores"].get("помогает", 0) == 0 and
        manner["scores"].get("токсик", 0) >= 12):
        types.append("Мудак")

    if not types:
        types.append("Чёткий чел")

    return types[:4]


def analyze_conflict_score(posts: list[UserPost], threads: list[Thread],
                           wall: list[WallPost]) -> dict:
    """Конфликтность — улучшенный скоринг."""
    all_texts = [p.body for p in posts if p.body] + \
                [t.body for t in threads if t.body] + \
                [w.body for w in wall if w.body]

    if not all_texts:
        return {"score": 0, "verdict": "нет данных", "examples": []}

    tox_scores = []
    toxic_examples = []
    for t in all_texts:
        # Адресные оскорбления — в 4 раза весомее мата-сленга:
        # «пиздец удобно» и «ты лох» — не одинаковая конфликтность
        cls = classify_toxicity(t)
        score = min(10, cls["insults_directed"] * 4 + min(cls["swears"], 4))
        # Капс-эскалация
        if detect_caps_ratio(t) > 0.35 and len(t) > 30:
            score = min(10, score + 2)
        # !!! эскалация
        if "!!!" in t or "?!!" in t:
            score = min(10, score + 1)
        tox_scores.append(score)
        if score >= 5 and len(t) < 250:
            toxic_examples.append(t)

    avg_tox = sum(tox_scores) / len(tox_scores)
    max_tox = max(tox_scores)
    high_tox_count = sum(1 for s in tox_scores if s >= 5)

    # Финальная оценка — учитываем и среднее, и пик, и частоту
    frequency = high_tox_count / len(tox_scores)
    final_score = round(min(10, (avg_tox + max_tox) / 2 + frequency * 3))

    if final_score >= 8:
        verdict = "токсик — мат и оскорбления чуть ли не в каждом посту. Лучше не спорить"
    elif final_score >= 6:
        verdict = "конфликтный — регулярно срывается, любит подколоть и уесть"
    elif final_score >= 4:
        verdict = "бывает резок — может огрызнуться, но не всегда"
    elif final_score >= 2:
        verdict = "ровный в среднем — но если задеть, может зацепить"
    else:
        verdict = "мирный — почти не матерится, в конфликты не лезет"

    return {
        "score": final_score,
        "verdict": verdict,
        "avg_tox": round(avg_tox, 2),
        "max_tox": max_tox,
        "high_tox_count": high_tox_count,
        "toxic_pct": round(frequency * 100),
        "examples": toxic_examples[:5],
    }


def analyze_interests(all_texts: list[str]) -> list[dict]:
    """Извлекаем ключевые слова + технические маркеры как интересы."""
    # Технические маркеры с частотой
    tech_hits = Counter()
    for t in all_texts:
        low = t.lower()
        for word in TECH_WORDS:
            if " " in word:
                if word in low:
                    tech_hits[word] += 1
            else:
                # Целое слово
                if re.search(rf"\b{re.escape(word)}\b", low):
                    tech_hits[word] += 1

    # Общие ключевые слова
    general = extract_keywords(all_texts)

    # Объединяем
    top_tech = tech_hits.most_common(15)
    top_general = general.most_common(15)

    return {
        "tech_keywords": [{"word": w, "count": c} for w, c in top_tech],
        "general_keywords": [{"word": w, "count": c} for w, c in top_general],
    }


def extract_keywords(texts: list[str]) -> Counter:
    words = []
    for text in texts:
        for w in re.findall(r"[a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ0-9\-]{2,}", text.lower()):
            if w not in STOPWORDS and len(w) >= 3:
                words.append(w)
    return Counter(words)


def analyze_literacy(texts: list[str]) -> dict:
    """Грамотность — улучшенная эвристика."""
    if not texts:
        return {"verdict": "нет данных", "score": 0}

    total_words = 0
    total_chars = 0
    has_comma_count = 0
    has_dot_count = 0
    has_paragraph_count = 0
    long_word_count = 0
    avg_len_per_post = []

    for t in texts:
        if not t:
            continue
        words = t.split()
        if not words:
            continue
        total_words += len(words)
        total_chars += len(t)
        if "," in t: has_comma_count += 1
        if "." in t or "!" in t or "?" in t: has_dot_count += 1
        if "\n" in t: has_paragraph_count += 1
        long_word_count += sum(1 for w in words if len(w) > 8)
        avg_len_per_post.append(len(words))

    if total_words == 0:
        return {"verdict": "нет данных", "score": 0}

    avg_words = total_words / len(texts)
    comma_ratio = has_comma_count / len(texts)
    dot_ratio = has_dot_count / len(texts)
    long_ratio = long_word_count / total_words

    # Оценка 0-10
    score = 0
    if avg_words >= 15: score += 2
    if comma_ratio > 0.3: score += 2
    if dot_ratio > 0.6: score += 2
    if long_ratio > 0.15: score += 2
    if has_paragraph_count / len(texts) > 0.2: score += 2
    score = min(10, score)

    if score >= 8:
        verdict = "Высокая — пишет развёрнуто, с пунктуацией и абзацами"
    elif score >= 5:
        verdict = "Средняя — следы грамотности есть, но не заморачивается"
    elif score >= 3:
        verdict = "Ниже среднего — короткие посты, без пунктуации"
    else:
        verdict = "«как в школе не учился» — коротышки без запятых"

    return {
        "verdict": verdict,
        "score": score,
        "avg_words_per_post": round(avg_words, 1),
        "comma_ratio": round(comma_ratio, 2),
        "dot_ratio": round(dot_ratio, 2),
        "long_word_ratio": round(long_ratio, 2),
    }


def top_threads_by_views(threads: list[Thread], limit: int = 5) -> list[dict]:
    """Самые популярные темы по просмотрам."""
    sorted_t = sorted(threads, key=lambda t: t.view_count, reverse=True)[:limit]
    return [{
        "title": t.title,
        "forum": t.forum_title,
        "views": t.view_count,
        "replies": t.reply_count,
        "likes": t.like_count,
        "date": datetime.fromtimestamp(t.create_date, tz=timezone.utc).strftime("%Y-%m-%d"),
        "thread_id": t.thread_id,
        "url": f"https://lolz.team/threads/{t.thread_id}/" if t.thread_id else "",
    } for t in sorted_t]


def top_posts_by_likes(posts: list[UserPost], limit: int = 5) -> list[dict]:
    """Самые залайканные посты."""
    sorted_p = sorted(posts, key=lambda p: p.like_count, reverse=True)[:limit]
    return [{
        "body": p.body[:280],
        "thread_title": p.thread_title,
        "forum": p.forum_title,
        "likes": p.like_count,
        "comments": p.comment_count,
        "date": datetime.fromtimestamp(p.create_date, tz=timezone.utc).strftime("%Y-%m-%d") if p.create_date else "",
    } for p in sorted_p if p.like_count > 0]


def reaction_stats(posts: list[UserPost]) -> dict:
    """Статистика реакций на посты пользователя."""
    if not posts:
        return {"total_likes": 0, "avg_likes": 0, "max_likes": 0, "zero_like_pct": 0}
    total_likes = sum(p.like_count for p in posts)
    max_likes = max(p.like_count for p in posts)
    avg = total_likes / len(posts)
    zero = sum(1 for p in posts if p.like_count == 0) / len(posts)
    return {
        "total_likes": total_likes,
        "avg_likes": round(avg, 2),
        "max_likes": max_likes,
        "zero_like_pct": round(zero * 100),
        "verdict": _reaction_verdict(avg, zero),
    }


def _reaction_verdict(avg: float, zero_pct: float) -> str:
    if avg >= 5:
        return f"Любимец публики — в среднем {avg:.1f} лайков на пост"
    if avg >= 2:
        return f"Активно реагируют — в среднем {avg:.1f} лайков на пост"
    if avg >= 0.5:
        return f"Реакции есть, но мало — в среднем {avg:.1f} лайков"
    if zero_pct > 80:
        return f"Игнор — {round(zero_pct)}% постов без единого лайка"
    return "Реакций почти нет"


# ---------------------------------------------------------------------------
# НОВЫЕ МЕТРИКИ v7 — карта тем/экспертизы + базовая репутация
# ---------------------------------------------------------------------------

TOPIC_CATEGORY_MAP = {
    "Конфликт": [
        "скам", "кидал", "кинул", "жалоб", "претенз", "обман", "развод",
        "чёрный список", "черный список", "блек", "мошен", "арбитраж", "спор",
        "гарант",
    ],
    "Торговля": [
        "прод", "куп", "скуп", "обмен", "продаж", "маркет", "market",
        "магазин", "услуг", "куплю", "продам", "сдам", "аренда",
    ],
    "Крипта": [
        "крипт", "crypto", "кошел", "wallet", "btc", "бтк", "usdt", "eth",
        "токен", "nft", "блокчейн", "coin", "бирж", "p2p", "трейд",
    ],
    "Гейминг": [
        "игр", "гейм", "game", "чит", "cheat", "стим", "steam", "дота",
        "dota", "варз", "warzone", "танк", "roblox", "майнкрафт",
        "minecraft", "fortnite", "фортнайт", "valorant", "валор",
    ],
    "Тех": [
        "софт", "soft", "код", "code", "скрипт", "script", "python", "api",
        "бот", "автомат", "программ", "сервер", "vpn", "прокси", "proxy",
        "настрой", "парсер", "рассыл",
    ],
    "Оффтоп": [
        "оффтоп", "флуд", "общени", "болтал", "курилк", "разговор", "обсужд",
        "новост", "вайб", "оффтопик", "юмор", "мем",
    ],
}

TOPIC_CATEGORY_PRIORITY = ["Конфликт", "Крипта", "Торговля", "Гейминг", "Тех", "Оффтоп"]

TOPIC_CATEGORY_COLORS = {
    "Конфликт": "#EF4444",
    "Торговля": "#34D399",
    "Крипта": "#F5C542",
    "Гейминг": "#A78BFA",
    "Тех": "#58A6DE",
    "Оффтоп": "#9AA0A6",
    "Разное": "#7C8694",
}


def _categorize_topic(text: str) -> str:
    """Определяем категорию темы по ключевым словам в названии форума/тем."""
    low = (text or "").lower()
    scores = {}
    for cat, kws in TOPIC_CATEGORY_MAP.items():
        hits = sum(1 for kw in kws if kw in low)
        if hits:
            scores[cat] = hits
    if not scores:
        return "Разное"
    best = max(scores.values())
    for cat in TOPIC_CATEGORY_PRIORITY:
        if scores.get(cat, 0) == best:
            return cat
    return "Разное"


def analyze_topic_expertise(posts: list, threads: list, limit: int = 7) -> dict:
    """Карта тем и экспертизы. Строится только на реально выкачанных постах/темах."""
    groups = defaultdict(lambda: {"posts": [], "threads": [], "titles": []})
    for p in posts:
        name = (p.forum_title or "").strip()
        if not name:
            continue
        groups[name]["posts"].append(p)
        if p.thread_title:
            groups[name]["titles"].append(p.thread_title)
    for t in threads:
        name = (t.forum_title or f"forum#{t.forum_id}").strip()
        groups[name]["threads"].append(t)
        if t.title:
            groups[name]["titles"].append(t.title)

    all_likes = [p.like_count for p in posts]
    global_avg_like = (sum(all_likes) / len(all_likes)) if all_likes else 0.0

    rows = []
    for name, g in groups.items():
        gp = g["posts"]
        gt = g["threads"]
        mentions = len(gp) + len(gt)
        if mentions == 0:
            continue

        tox = pos = neg = 0
        for p in gp:
            tc, _ = count_lexicon_hits(p.body, TOXIC_WORDS)
            pc, _ = count_lexicon_hits(p.body, POSITIVE_WORDS)
            nc, _ = count_lexicon_hits(p.body, NEGATIVE_WORDS)
            tox += tc; pos += pc; neg += nc
        if tox > pos and tox > 0:
            tone = "−"
        elif pos > (tox + neg) and pos > 0:
            tone = "+"
        else:
            tone = "~"

        post_likes = [p.like_count for p in gp]
        avg_like = (sum(post_likes) / len(post_likes)) if post_likes else 0.0
        base = max(global_avg_like, 0.5)
        eng = avg_like / (base * 2)
        if gt:
            avg_views = sum(t.view_count for t in gt) / len(gt)
            eng += min(avg_views / 3000.0, 0.35)
        engagement = round(min(max(eng, 0.0), 1.0), 2)

        help_hits = 0
        long_posts = 0
        for p in gp:
            hc, _ = count_lexicon_hits(p.body, HELP_WORDS)
            help_hits += hc
            if len(p.body.split()) >= 25:
                long_posts += 1
        help_ratio = help_hits / mentions
        starter_ratio = (len(gt) / mentions) if mentions else 0
        long_ratio = (long_posts / len(gp)) if gp else 0
        expertise = round(min(help_ratio * 0.5 + starter_ratio * 0.3 + long_ratio * 0.2, 1.0), 2)

        category = _categorize_topic(name + " " + " ".join(g["titles"][:10]))
        examples = []
        seen = set()
        for ttl in g["titles"]:
            ttl = (ttl or "").strip()
            if ttl and ttl.lower() not in seen:
                seen.add(ttl.lower())
                examples.append(ttl[:60])
            if len(examples) >= 2:
                break

        rows.append({
            "topic": name[:48],
            "category": category,
            "color": TOPIC_CATEGORY_COLORS.get(category, "#7C8694"),
            "mentions": mentions,
            "engagement": engagement,
            "expertise": expertise,
            "tone": tone,
            "examples": examples,
        })

    rows.sort(key=lambda r: r["mentions"], reverse=True)
    rows = rows[:limit]

    if not rows:
        verdict = "Мало данных — активность по темам не выделяется."
    else:
        top = rows[0]
        strong = [r for r in rows if r["expertise"] >= 0.6]
        if strong:
            verdict = (f"Сильнее всего в «{strong[0]['topic']}» "
                       f"({strong[0]['category'].lower()}) — тут и вовлечённость, и экспертиза. "
                       f"Основная площадка — «{top['topic']}».")
        else:
            verdict = (f"Основная тема — «{top['topic']}» "
                       f"({top['category'].lower()}), выраженной экспертизы ни в одном разделе нет.")

    return {"rows": rows, "verdict": verdict}


def analyze_reputation_basic(profile, archetypes, title_analysis, safety) -> dict:
    """Репутация и споры — только реально доступные через Forum API сигналы."""
    warnings = int(profile.warning_points or 0)
    types = (title_analysis or {}).get("types", {}) or {}
    complaints = int(types.get("Жалоба", 0) or 0)
    claims = int(types.get("Претензия", 0) or 0)
    scam_alert = "Скам-тревога" in (archetypes or [])
    risk_tags = [t for t in (archetypes or [])
                 if t in ("Скам-тревога", "Мамонт", "Мудак", "Байтер", "Токсик")]
    is_banned = bool(profile.is_banned)
    in_blacklist = bool((safety or {}).get("in_blacklist"))

    score = 0.0
    score += min(warnings, 3) / 3 * 40
    score += min(claims, 5) / 5 * 25
    score += min(complaints, 5) / 5 * 10
    if scam_alert:
        score += 20
    if is_banned or in_blacklist:
        score = 100
    score = round(min(100, score))

    if is_banned or in_blacklist:
        level, level_color = "Заблокирован", "#EF4444"
    elif score >= 60:
        level, level_color = "Высокий риск", "#EF4444"
    elif score >= 30:
        level, level_color = "Есть вопросы", "#F59E0B"
    else:
        level, level_color = "Чисто", "#34D399"

    def _tone(bad, warn=False):
        return "red" if bad else ("amber" if warn else "green")

    signals = [
        {"key": "warnings", "label": "Баллы предупреждений", "value": f"{warnings}/3",
         "tone": _tone(warnings >= 3, warnings > 0),
         "note": (safety or {}).get("ban_reason", "") if (is_banned or warnings >= 3) else ""},
        {"key": "status", "label": "Статус на форуме", "value": (safety or {}).get("verdict", ""),
         "tone": _tone(is_banned or in_blacklist)},
        {"key": "claims", "label": "Темы-претензии (скам/кидок)", "value": claims,
         "tone": _tone(claims > 0)},
        {"key": "complaints", "label": "Темы-жалобы", "value": complaints,
         "tone": _tone(False, complaints > 0)},
        {"key": "scam_alert", "label": "Скам-тревога (эвристика по постам)",
         "value": "да" if scam_alert else "нет", "tone": _tone(scam_alert)},
    ]

    if is_banned or in_blacklist:
        verdict = "Аккаунт заблокирован/в блеклисте — иметь дело опасно."
    elif scam_alert or claims > 0:
        verdict = ("Есть тревожные сигналы: претензии/скам-паттерн в темах. "
                   "Точную историю споров API не отдаёт — проверяйте вручную перед сделкой.")
    elif warnings > 0 or complaints > 0:
        verdict = ("Мелкие тёрки с модерацией есть, но серьёзных сигналов скама нет. "
                   "Историю блокировок API не отдаёт — перед сделкой проверьте профиль на форуме вручную.")
    else:
        verdict = ("Явных проблем с репутацией не видно — текущих баллов и претензий нет. "
                   "Но API не отдаёт историю блокировок и истёкшие баллы: проверьте профиль на форуме вручную.")

    return {
        "score": score, "level": level, "level_color": level_color,
        "warning_points": warnings, "warnings_scale": f"{warnings}/3",
        "is_banned": is_banned, "in_blacklist": in_blacklist,
        "ban_reason": (safety or {}).get("ban_reason", ""),
        "scam_alert": scam_alert, "risk_tags": risk_tags,
        "complaints": complaints, "claims": claims,
        "signals": signals, "verdict": verdict,
        "data_note": "Детальный лог предупреждений по причинам недоступен через публичный API.",
    }

# ---------------------------------------------------------------------------
# НОВЫЕ МЕТРИКИ v3 — триггеры, ошибки, эмпатия, новички
# ---------------------------------------------------------------------------

# Паттерны признания ошибок
ADMIT_MISTAKE_PATTERNS = [    r"\bбыл неправ\b", r"\bбыл не прав\b", r"\bсогласен,? ошибся\b",
    r"\bне подумал\b", r"\bмой косяк\b", r"\bперепутал\b",
    r"\bошибся,? сорян\b", r"\bсорян,? ошибся\b", r"\bсорри,? ошибся\b",
    r"\bда,? вы правы\b", r"\bпризнаю\b", r"\bда,? был не прав\b",
    r"\bнакосячил\b", r"\bпроебал\b", r"\bпрофакапил\b",
    r"\bспутал\b", r"\bнапутал\b", r"\bобознался\b",
    r"\bда,? ты прав\b", r"\bсогласен,? ты прав\b",
    r"\bладно,? слил\b", r"\bладно,? проиграл спор\b",
    r"\bок,? был неправ\b", r"\bокей,? был неправ\b",
    r"\bда,? загнул\b", r"\bда,? перегнул\b", r"\bпогорячился\b",
]

# Контекст правоты/ошибки: посты, где тема «кто прав / кто ошибся / спор»
# вообще поднимается. Только среди них имеет смысл считать «признал /
# настоял на своём» — счётчик против всех постов даёт ложные «700 раз
# не признал вину» на сообщениях про раздачи и оффтопик.
MISTAKE_CONTEXT_PATTERNS = [
    r"ошиб", r"\bнеправ\w*", r"\bне прав\w*", r"косяк", r"накосяч",
    r"профакап", r"\bфакап", r"проебал", r"сорян", r"сорри", r"извин",
    r"\bспор(ить|ится|ил|или|ишь|ите|ят|а|е|у|ы)?\b", r"спор[нщ]\w*",
    r"сам виноват", r"сам дурак", r"сам такой", r"заблужда",
    r"\bпруф", r"докаж", r"подтверди", r"сам проверь",
    r"ты уверен", r"вы уверен", r"вводишь в заблуждение",
]

# Эмпатические реакции
EMPATHY_PATTERNS = [
    r"\bсочувствую\b", r"\bбывает\b", r"\bпонимаю тебя\b",
    r"\bпонимаю,? как\b", r"\bдержись\b", r"\bне сдавайся\b",
    r"\bвсё наладится\b", r"\bбрат,? держись\b", r"\bбратишка,? держись\b",
    r"\bсоболезную\b", r"\bскорблю\b", r"\bжаль\b", r"\bочень жаль\b",
    r"\bмне жаль\b", r"\bжалка\b", r"\bбедняга\b", r"\bбедный\b",
    r"\bнесчастный\b", r"\bкакой ужас\b", r"\bжесть\b", r"\bтяжело\b",
    r"\bтяжело тебе\b", r"\bне отчаивайся\b", r"\bне кати\b",
    r"\bболячка\b", r"\bболезнь\b", r"\bпоправляйся\b",
    r"\bвыздоравливай\b", r"\bне болей\b", r"\bбережёного бог бережёт\b",
    r"\bвсё пройдёт\b", r"\bвремя лечит\b", r"\bзаживёт\b",
    r"\bне переживай\b", r"\bне парься\b", r"\bне накручивай\b",
]

# Маркеры «обращения за помощью» в чужих постах (для эмпатии)
HELP_REQUEST_MARKERS = [
    r"\bпомогите\b", r"\bхелп\b", r"\bспасайте\b", r"\bне работает\b",
    r"\bвылетает\b", r"\bошибка\b", r"\bпроблема\b", r"\bкак быть\b",
    r"\bчто делать\b", r"\bкак сделать\b", r"\bне могу\b", r"\bне получается\b",
    r"\bсрочно\b", r"\bвыручайте\b", r"\bподскажите\b",
    r"\bкто знает\b", r"\bкто поможет\b", r"\bнужна помощь\b",
]

# Контекст эмпатии: посты, где кто-то делится проблемой или просит помощи.
# Только среди них имеет смысл считать реакции поддержки — мерить «эмпатию»
# против всех постов нельзя: большинство сообщений к чужим проблемам
# отношения не имеют.
EMPATHY_CONTEXT_PATTERNS = HELP_REQUEST_MARKERS + [
    r"\bбеда\b", r"устал\b", r"выгор", r"депресс", r"жалуюсь",
    r"болею", r"пропал\b", r"кинул меня", r"меня кинули", r"меня обманули",
]
# «не могу» вынесен из контекста: слишком частая бытовая фраза, к просьбам
# о помощи относится в меньшинстве случаев.
EMPATHY_CONTEXT_PATTERNS = [p for p in EMPATHY_CONTEXT_PATTERNS
                            if p != r"\bне могу\b"]


def analyze_triggers(posts: list[UserPost], threads: list[Thread]) -> dict:
    """
    Анализ триггеров: в каких темах/разделах юзер матерится или капсит.
    
    Возвращает:
      - top_topic_triggers: топ тем с матом
      - top_forum_triggers: топ разделов с матом
      - trigger_words: какие токсичные слова чаще всего
      - sample_trigger_posts: 2-3 примера постов с матом (для AI)
    """
    topic_triggers: dict[str, dict] = defaultdict(lambda: {"toxic": 0, "caps": 0, "posts": []})
    forum_triggers: dict[str, int] = defaultdict(int)
    trigger_words_counter = Counter()
    toxic_by_hour = [0] * 24
    sample_posts = []
    
    for p in posts:
        if not p.body or len(p.body) < 5:
            continue
        
        tox_score, matched = count_lexicon_hits(p.body, TOXIC_WORDS)
        caps_ratio = detect_caps_ratio(p.body)
        is_caps = caps_ratio > 0.4 and len(p.body) > 30
        
        if tox_score > 0 or is_caps:
            # Время суток
            if p.create_date:
                h = datetime.fromtimestamp(p.create_date, tz=timezone.utc).hour
                toxic_by_hour[h] += 1
            # Тема
            topic = p.thread_title or "(без темы)"
            if len(topic) > 60:
                topic = topic[:60] + "..."
            topic_triggers[topic]["toxic"] += tox_score
            if is_caps:
                topic_triggers[topic]["caps"] += 1
            topic_triggers[topic]["posts"].append(p.body[:150])
            
            # Раздел
            if p.forum_title:
                forum_triggers[p.forum_title] += tox_score + (1 if is_caps else 0)
            
            # Слова
            for w in matched:
                trigger_words_counter[w] += 1
            
            # Примеры
            if len(sample_posts) < 5 and tox_score >= 2:
                sample_posts.append({
                    "body": p.body[:200],
                    "topic": topic[:60],
                    "toxic_words": matched[:3],
                })
    
    # Сортируем
    top_topics = sorted(
        [(t, v) for t, v in topic_triggers.items()],
        key=lambda x: x[1]["toxic"] + x[1]["caps"],
        reverse=True
    )[:5]
    
    top_forums_list = sorted(forum_triggers.items(), key=lambda x: -x[1])[:5]
    
    # Вердикт
    total_trigger_posts = sum(1 for p in posts if count_lexicon_hits(p.body, TOXIC_WORDS)[0] > 0 or
                              (detect_caps_ratio(p.body) > 0.4 and len(p.body) > 30))
    
    if not top_topics:
        verdict = "Чисто — не матерится, не капсит. Триггеров не найдено"
    elif total_trigger_posts > 20:
        verdict = f"Лютый триггерщик — {total_trigger_posts} постов с матом/капсом. Срывается часто"
    elif total_trigger_posts > 5:
        verdict = f"Бывает срывается — {total_trigger_posts} постов с матом. Триггеры есть, но не системно"
    else:
        verdict = f"В целом ровный — всего {total_trigger_posts} постов с матом за всё время"
    
    return {
        "top_topic_triggers": [
            {
                "topic": t,
                "toxic_count": v["toxic"],
                "caps_count": v["caps"],
                "sample": v["posts"][0][:100] if v["posts"] else "",
            }
            for t, v in top_topics
        ],
        "top_forum_triggers": [
            {"forum": f, "count": c} for f, c in top_forums_list
        ],
        "trigger_words": [
            {"word": w, "count": c} for w, c in trigger_words_counter.most_common(10)
        ],
        "sample_trigger_posts": sample_posts,
        "total_trigger_posts": total_trigger_posts,
        "toxic_by_hour": toxic_by_hour,
        "verdict": verdict,
    }


def analyze_admit_mistakes(posts: list[UserPost]) -> dict:
    """
    Анализ признания ошибок: сколько раз юзер признал, что был неправ.

    Знаменатель — не все посты, а «профильные»: сообщения, в которых
    вообще поднимается тема правоты/ошибки/спора (MISTAKE_CONTEXT_PATTERNS).
    Считать «не признал» против всех постов нельзя — большинство сообщений
    к вопросу правоты отношения не имеют.
    """
    if not posts:
        return {"count": 0, "verdict": "нет данных", "examples": []}

    admit_count = 0
    context_count = 0
    examples = []

    for p in posts:
        if not p.body:
            continue
        is_admit = False
        for pattern in ADMIT_MISTAKE_PATTERNS:
            if re.search(pattern, p.body, re.IGNORECASE):
                admit_count += 1
                is_admit = True
                if len(examples) < 3:
                    examples.append({
                        "body": p.body[:200],
                        "matched_pattern": pattern.replace(r"\b", "").replace(",", ""),
                    })
                break
        # контекст = посты о правоте/споре + сами признания,
        # чтобы числитель всегда входил в знаменатель
        if is_admit or any(re.search(pat, p.body, re.IGNORECASE)
                           for pat in MISTAKE_CONTEXT_PATTERNS):
            context_count += 1

    if context_count == 0:
        verdict = "Тема ошибок и споров в постах не поднималась — оценивать готовность не на чем"
    elif admit_count == 0:
        verdict = f"Ни разу не признал ошибку в {context_count} сообщениях, где тема правоты поднималась"
    else:
        share = admit_count / context_count
        if share >= 0.5:
            verdict = f"Часто признаёт ({admit_count} из {context_count} профильных сообщений) — гибкий, не упёртый"
        elif share >= 0.25:
            verdict = f"Иногда признаёт ({admit_count} из {context_count}) — бывает гибким"
        else:
            verdict = f"Редко признаёт ({admit_count} из {context_count} профильных сообщений) — скорее упрямый"

    return {
        "count": admit_count,
        "context_posts": context_count,
        "total_posts": len(posts),
        "ratio": round(admit_count / max(1, context_count) * 100, 2),
        "examples": examples,
        "verdict": verdict,
    }


def analyze_empathy(posts: list[UserPost]) -> dict:
    """
    Эмпатия: откликается ли на чужие проблемы (фразы поддержки в постах).

    Знаменатель — «профильные» посты: сообщения, где кто-то делится
    проблемой или просит помощи (EMPATHY_CONTEXT_PATTERNS). Считать
    поддержку против всех постов нельзя — большинство сообщений к чужим
    проблемам отношения не имеют.
    """
    if not posts:
        return {"count": 0, "verdict": "нет данных", "examples": []}

    empathy_count = 0
    context_count = 0
    examples = []

    for p in posts:
        if not p.body:
            continue
        is_support = False
        for pattern in EMPATHY_PATTERNS:
            if re.search(pattern, p.body, re.IGNORECASE):
                empathy_count += 1
                is_support = True
                if len(examples) < 3:
                    examples.append(p.body[:200])
                break
        # контекст = посты с чужими проблемами + сами реакции поддержки,
        # чтобы числитель всегда входил в знаменатель
        if is_support or any(re.search(pat, p.body, re.IGNORECASE)
                             for pat in EMPATHY_CONTEXT_PATTERNS):
            context_count += 1

    if context_count == 0:
        verdict = "В постах не было чужих проблем или просьб о помощи — оценивать эмпатию не на чем"
    elif empathy_count == 0:
        verdict = f"Ни разу не поддержал в {context_count} сообщениях с чужими проблемами"
    else:
        share = empathy_count / context_count
        if share >= 0.5:
            verdict = f"Часто поддерживает ({empathy_count} из {context_count} профильных сообщений) — эмпатичный чел"
        elif share >= 0.25:
            verdict = f"Бывает поддержит ({empathy_count} из {context_count}) — эмпатия в меру"
        else:
            verdict = f"Редко поддерживает ({empathy_count} из {context_count} профильных сообщений) — эмпатии мало"

    return {
        "count": empathy_count,
        "context_posts": context_count,
        "total_posts": len(posts),
        "ratio": round(empathy_count / max(1, context_count) * 100, 2),
        "examples": examples,
        "verdict": verdict,
    }


def analyze_attitude_to_newbies(posts: list[UserPost], threads: list[Thread]) -> dict:
    """
    Отношение к новичкам: эвристика по постам в темах, где автор — типичный нуб.
    Мы не можем напрямую узнать авторов тем, но можем:
    - Искать посты с упоминанием слов «новичок», «нуб», «первый раз»
    - Анализировать токсичность в таких постах
    """
    if not posts:
        return {"verdict": "нет данных", "toxic_to_newbies": 0, "helpful_to_newbies": 0}
    
    newbie_keywords = [
        "новичок", "новичка", "нуб", "нуба", "нубас", "первый раз",
        "впервые", "только зарегался", "новенький", "новенького",
        "не разбираюсь", "первый день", "только пришёл", "только пришел",
        "я новичок", "я нуб", "совет новичку", "вопрос новичка",
    ]
    
    newbie_related_posts = []
    for p in posts:
        if not p.body:
            continue
        low = p.body.lower()
        if any(kw in low for kw in newbie_keywords):
            newbie_related_posts.append(p)
    
    if not newbie_related_posts:
        return {
            "verdict": "Не упоминает новичков — либо не общается с ними, либо всем пофиг",
            "toxic_to_newbies": 0,
            "helpful_to_newbies": 0,
            "total_newbie_mentions": 0,
        }
    
    toxic_to_newbies = 0
    helpful_to_newbies = 0
    
    for p in newbie_related_posts:
        tox_score, _ = count_lexicon_hits(p.body, TOXIC_WORDS)
        help_count, _ = count_lexicon_hits(p.body, HELP_WORDS)
        if tox_score >= 2:
            toxic_to_newbies += 1
        if help_count >= 1:
            helpful_to_newbies += 1
    
    total = len(newbie_related_posts)
    if toxic_to_newbies > helpful_to_newbies and toxic_to_newbies > 0:
        verdict = f"Гнобит новичков ({toxic_to_newbies} токсичных из {total}) — сноб"
    elif helpful_to_newbies > toxic_to_newbies and helpful_to_newbies > 0:
        verdict = f"Помогает новичкам ({helpful_to_newbies} из {total}) — норм чел"
    elif toxic_to_newbies > 0:
        verdict = f"Бывает подкалывает новичков ({toxic_to_newbies} из {total}), но не гнобит"
    else:
        verdict = f"Упоминает новичков нейтрально ({total} постов) — без снобизма"
    
    return {
        "total_newbie_mentions": total,
        "toxic_to_newbies": toxic_to_newbies,
        "helpful_to_newbies": helpful_to_newbies,
        "verdict": verdict,
    }


# ---------------------------------------------------------------------------
# AI-подготовка: компактные промпты
# ---------------------------------------------------------------------------

def build_facts_for_ai(dossier: dict) -> dict:
    """
    Собирае�� компактный пакет фактов для AI-промпта.
    JSON-формат, минимум слов, максимум смысла.
    """
    return {
        "user": {
            "username": dossier["card"]["username"],
            "user_id": dossier["card"]["user_id"],
            "tenure": dossier["card"]["tenure"],
            "status": dossier["card"]["status"],
            "warnings": dossier["card"]["warning_points"],
            "is_banned": dossier["card"]["is_banned"],
        },
        "stats": dossier["raw_stats"],
        "emotion": {
            "positive_pct": dossier["portrait"]["emotion"]["positive_pct"],
            "negative_pct": dossier["portrait"]["emotion"]["negative_pct"],
            "toxic_pct": dossier["portrait"]["emotion"]["toxic_pct"],
            "neutral_pct": dossier["portrait"]["emotion"]["neutral_pct"],
            "verdict": dossier["portrait"]["emotion"]["verdict"],
        },
        "manner": {
            "primary": dossier["portrait"]["manner"]["primary"],
            "secondary": dossier["portrait"]["manner"]["secondary"],
            "description": dossier["portrait"]["manner"]["description"],
        },
        "archetypes": dossier["portrait"]["archetypes"],
        "ego": {
            "per_100": dossier["portrait"]["ego"]["per_100"],
            "verdict": dossier["portrait"]["ego"]["verdict"],
        },
        "confidence": {
            "score": dossier["portrait"]["confidence"]["score"],
            "verdict": dossier["portrait"]["confidence"]["verdict"],
        },
        "conflict": {
            "score": dossier["portrait"]["conflict"]["score"],
            "verdict": dossier["portrait"]["conflict"]["verdict"],
            "examples": dossier["portrait"]["conflict"].get("examples", [])[:3],
        },
        "triggers": dossier.get("triggers", {}).get("top_topic_triggers", [])[:3],
        "admit_mistakes": dossier.get("admit_mistakes", {}).get("verdict", ""),
        "empathy": dossier.get("empathy", {}).get("verdict", ""),
        "newbies": dossier.get("newbies", {}).get("verdict", ""),
        "top_forums": [f["forum"] for f in dossier["activity"]["top_forums"][:3]],
        "time_verdict": dossier["activity"]["time_profile"]["verdict"],
        "yearly_verdict": dossier["activity"]["yearly_dynamics"]["verdict"],
        "reactions_verdict": dossier["activity"]["reactions"]["verdict"],
    }


def select_posts_for_lite_ai(posts: list[UserPost], limit: int = 6) -> list[dict]:
    """
    Выбирает 6 постов для Lite-промпта:
    - 2 самых залайканных (как человек на пике)
    - 1 самый токсичный (в конфликте)
    - 2 самых длинных развёрнутых (когда вовлечён)
    - 1 с признанием ошибки (если есть)
    """
    if not posts:
        return []
    
    valid = [p for p in posts if p.body and len(p.body) > 20]
    if not valid:
        return []
    
    selected = []
    seen_ids = set()
    
    def add_post(p):
        if p.post_id not in seen_ids and len(selected) < limit:
            selected.append({
                "body": p.body[:500],
                "likes": p.like_count,
                "topic": (p.thread_title or "")[:60],
                "date": datetime.fromtimestamp(p.create_date, tz=timezone.utc).strftime("%Y-%m-%d") if p.create_date else "",
            })
            seen_ids.add(p.post_id)
    
    # 1-2. Самые залайканные
    by_likes = sorted(valid, key=lambda p: p.like_count, reverse=True)
    for p in by_likes[:2]:
        if p.like_count > 0:
            add_post(p)
    
    # 3. Самый токсичный
    by_tox = sorted(valid, key=lambda p: count_lexicon_hits(p.body, TOXIC_WORDS)[0], reverse=True)
    for p in by_tox[:1]:
        if count_lexicon_hits(p.body, TOXIC_WORDS)[0] > 0:
            add_post(p)
    
    # 4-5. Самые длинные развёрнутые
    by_len = sorted(valid, key=lambda p: len(p.body.split()), reverse=True)
    for p in by_len[:2]:
        if len(p.body.split()) > 15:
            add_post(p)
    
    # 6. С признанием ошибки
    for p in valid:
        if any(re.search(pattern, p.body, re.IGNORECASE) for pattern in ADMIT_MISTAKE_PATTERNS):
            add_post(p)
            break
    
    # Добиваем до limit случайными
    while len(selected) < limit and len(selected) < len(valid):
        for p in valid:
            if p.post_id not in seen_ids:
                add_post(p)
                break
        else:
            break
    
    return selected[:limit]


def select_posts_for_max_ai(posts: list[UserPost], limit: int = 3) -> list[dict]:
    """
    Выбирает 3 поста для Max-промпта — самые показательные.
    """
    if not posts:
        return []
    
    valid = [p for p in posts if p.body and len(p.body) > 20]
    if not valid:
        return []
    
    selected = []
    seen_ids = set()
    
    def add_post(p, label):
        if p.post_id not in seen_ids and len(selected) < limit:
            selected.append({
                "body": p.body[:250],
                "label": label,
                "likes": p.like_count,
            })
            seen_ids.add(p.post_id)
    
    # 1. Самый залайканный
    by_likes = sorted(valid, key=lambda p: p.like_count, reverse=True)
    if by_likes and by_likes[0].like_count > 0:
        add_post(by_likes[0], "пик-пост")
    
    # 2. Самый токсичный
    by_tox = sorted(valid, key=lambda p: count_lexicon_hits(p.body, TOXIC_WORDS)[0], reverse=True)
    if by_tox and count_lexicon_hits(by_tox[0].body, TOXIC_WORDS)[0] > 0:
        add_post(by_tox[0], "конфликт")
    
    # 3. Признание ошибки (если есть) или самый длинный
    for p in valid:
        if any(re.search(pattern, p.body, re.IGNORECASE) for pattern in ADMIT_MISTAKE_PATTERNS):
            add_post(p, "признание ошибки")
            break
    else:
        by_len = sorted(valid, key=lambda p: len(p.body.split()), reverse=True)
        if by_len:
            add_post(by_len[0], "развёрнутый")
    
    return selected[:limit]


# ---------------------------------------------------------------------------
# Verdict builder — глубокий финальный вердикт
# ---------------------------------------------------------------------------

def build_final_verdict(profile: Profile, posts: list[UserPost],
                        threads: list[Thread], wall: list[WallPost],
                        manner: dict, emotion: dict, ego: dict,
                        confidence: dict, conflict: dict, archetypes: list[str],
                        safety: dict, literacy: dict) -> dict:
    """Глубокий вердикт: резюме + профиль личности + рекомендации."""

    # ---- 1. Резюме (одно ёмкое предложение) ----
    summary_parts = []

    if safety["in_blacklist"]:
        summary_parts.append("Забанен — было видно до блокировки:")
    else:
        age_years = (int(time.time()) - profile.register_date) / (365 * 86400) if profile.register_date else 0
        if age_years >= 5:
            summary_parts.append("старожил")
        elif age_years >= 2:
            summary_parts.append("обкатанный юзер")
        else:
            summary_parts.append("относительно новый")

    if archetypes:
        summary_parts.append(archetypes[0].lower())

    if manner["primary"] and manner["primary"] != "нейтральный":
        summary_parts.append(f"по стилю — {manner['primary']}")

    # «Миролюбивый токсик» — запрещённая комбинация. Миролюбивость ставим
    # только если нет ни архетипа-агрессора, ни адресной агрессии в постах
    peaceable = (conflict["score"] <= 2
                 and not any(a in archetypes for a in ("Токсик", "Тролль", "Мудак"))
                 and emotion["toxic_pct"] < 25)
    if conflict["score"] >= 7:
        summary_parts.append("с повышенной конфликтностью")
    elif peaceable:
        summary_parts.append("миролюбив")

    if len(threads) >= 50:
        summary_parts.append(f"активный автор ({len(threads)}+ тем)")
    elif len(posts) >= 100:
        summary_parts.append(f"активный ({len(posts)}+ постов)")

    summary = ", ".join(summary_parts[:3])
    if summary:
        summary = summary[0].upper() + summary[1:]
    if len(summary_parts) > 3:
        summary += ". " + ", ".join(summary_parts[3:])
        summary = summary[0].upper() + summary[1:] if summary else summary
    summary += "."

    # ---- 2. Профиль личности ----
    personality = {
        "тип_общения": manner["primary"],
        "доп_тип": manner["secondary"] or "—",
        "эмоциональный_фон": emotion["verdict"],
        "эго_индекс": ego["verdict"],
        "уверенность": confidence["verdict"],
        "конфликтность": f"{conflict['score']}/10 — {conflict['verdict']}",
        "грамотность": literacy["verdict"],
        "архетипы": archetypes,
    }

    # ---- 3. Кому полезен ----
    useful_for = []
    if "Помогатор" in archetypes or manner["scores"].get("помогает", 0) >= 3:
        useful_for.append("новичкам — реально помогает, а не отмахивается")
    if "Шарит" in archetypes or manner["scores"].get("разбирается", 0) >= 5:
        useful_for.append("тем, кто ищет технические ответы — шарит в теме")
    if "Старожил" in archetypes:
        useful_for.append("хочешь узнать историю форума — спроси его")
    if "Криптан-P2P-шник" in archetypes:
        useful_for.append("по крипте и P2P — подскажет куда копать")
    if "Графист" in archetypes:
        useful_for.append("по оформлению тем и графике — есть что показать")
    if not useful_for:
        useful_for.append("нейтрально — конкретной пользы не несёт, но и не мешает")

    # ---- 4. Кому опасен ----
    dangerous_for = []
    if conflict["score"] >= 7:
        dangerous_for.append("новичкам с тонкой душевной организацией — может сожрать")
    if "Токсик" in archetypes:
        dangerous_for.append("в спорах — переходит на личности и мат")
    if "Душнила-категоричец" in archetypes:
        dangerous_for.append("тем, кто любит дискутировать — спор бесполезен, он «точно знает»")
    if safety["in_blacklist"]:
        dangerous_for.append("ВСЕМ — аккаунт в бане, иметь дело опасно")
    if not dangerous_for:
        dangerous_for.append("никому конкретно — мирный жител�� форума")

    # ---- 5. Если ты новичок ----
    if profile.message_count < 100 and len(threads) < 10:
        newbies_note = "И сам пока новичок — учится, набивает шишки"
    elif conflict["score"] >= 7:
        newbies_note = "Если ты новичок — держи дистанцию. Лучше не попадаться под горячую руку"
    elif "Помогатор" in archetypes:
        newbies_note = "Если ты новичок — смело спрашивай, поможет и не унизит"
    elif "Старожил" in archetypes and conflict["score"] <= 4:
        newbies_note = "Если ты новичок — уважительно спросишь, ответит по делу"
    else:
        newbies_note = "Если ты новичок — общайся ровно, без панибратства. Реакция адекватная"

    return {
        "summary": summary,
        "personality": personality,
        "useful_for": useful_for,
        "dangerous_for": dangerous_for,
        "newbies_note": newbies_note,
    }


# ---------------------------------------------------------------------------
# Main analyzer
# ---------------------------------------------------------------------------

class LolzAnalyzer:
    """
    Анализатор с пулом токенов Лолза + параллельным fetch + прогресс-колбэками.

    Архитектура v7:
      • 3 токена распределяются по типам запросов:
        - Токен 0 → POST /search/posts (сообщения)
        - Токен 1 → GET /threads (созданные темы)
        - Токен 2 → GET /users/{id}/profile-posts (стена) + GET /users/{id} (профиль)
      • fetch_timeline + fetch_threads + fetch_wall запускаются ПАРАЛЛЕЛЬНО через ThreadPoolExecutor
      • Прогресс через callback on_progress(stage, current, total, message)
    """

    def __init__(self, tokens: list[str] | str, base: str = API_BASE,
                 on_progress: Optional[callable] = None,
                 profile_tokens: list[str] | str | None = None):
        if isinstance(tokens, str):
            tokens = [tokens]
        if not tokens:
            raise ValueError("Need at least 1 token")
        self.tokens = tokens
        self.base = base.rstrip("/")
        # ── message pool ──────────────────────────────────────────────────
        # self.sessions = токены для СБОРА СООБЩЕНИЙ (fetch_timeline, ротация).
        # Эта логика (round-robin / бюджеты) опирается на len(self.sessions),
        # поэтому здесь лежат ТОЛЬКО message-токены и ничего больше.
        self.sessions = [self._make_session(t) for t in tokens]
        # ── profile pool ──────────────────────────────────────────────────
        # Отдельный пул для парсинга самого досье: профиль, темы, стена
        # (НЕ сообщения). Если profile_tokens не передан — фолбэк на message-
        # пул, чтобы старые вызовы не ломались.
        if isinstance(profile_tokens, str):
            profile_tokens = [profile_tokens]
        self.profile_tokens = profile_tokens or list(tokens)
        self.profile_sessions = [self._make_session(t) for t in self.profile_tokens]
        self.on_progress = on_progress or (lambda *a, **kw: None)
        self.timeline_fetch_meta: dict = {}  # Zelscan reliable timeline metadata v1
        # Exact count of unique raw records collected for the current analysis.
        # Threads and wall posts are separate sources and are never folded into
        # the timeline count, preventing duplicate/aggregate/AI output counting.
        self.collected_message_counts: dict = {
            "total": 0, "timeline_posts": 0, "threads": 0, "wall_posts": 0,
        }

    def _get_profile(self, path: str, params: Optional[dict] = None,
                     headers: Optional[dict] = None) -> dict:
        """GET через ОТДЕЛЬНЫЙ profile-пул (профиль / темы / стена).

        Не трогает message-пул (self.sessions), чтобы парсинг досье не съедал
        лимиты у сбора сообщений. Ретраи ротируются внутри profile-пула.
        """
        url = f"{self.base}{path}" if path.startswith("/") else f"{self.base}/{path}"
        pool = self.profile_sessions or self.sessions
        for attempt in range(5):
            session = pool[attempt % len(pool)]
            try:
                r = session.get(url, params=params, headers=headers, timeout=8)
                if r.status_code == 429:
                    time.sleep(1 + attempt)
                    continue
                data = r.json()
                if "errors" in data:
                    return {"_errors": data["errors"]}
                return data
            except (requests.RequestException, requests.Timeout) as e:
                if attempt == 4:
                    return {"_errors": [f"network: {e}"]}
                print(f"  retry {attempt+1}/5 for {path}: {type(e).__name__}", file=sys.stderr)
                time.sleep(2 + attempt)
        return {"_errors": ["unknown"]}

    def _make_session(self, token: str):
        s = requests.Session()
        s.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "lolz-dossier/3.0",
        })
        return s

    def _get(self, path: str, params: Optional[dict] = None,
             token_idx: int = 0, headers: Optional[dict] = None) -> dict:
        url = f"{self.base}{path}" if path.startswith("/") else f"{self.base}/{path}"
        for attempt in range(5):
            session = self.sessions[(token_idx + attempt) % len(self.sessions)]
            try:
                r = session.get(url, params=params, headers=headers, timeout=8)
                if r.status_code == 429:
                    time.sleep(1 + attempt)
                    continue
                data = r.json()
                if "errors" in data:
                    return {"_errors": data["errors"]}
                return data
            except (requests.RequestException, requests.Timeout) as e:
                if attempt == 4:
                    return {"_errors": [f"network: {e}"]}
                print(f"  retry {attempt+1}/5 for {path}: {type(e).__name__}", file=sys.stderr)
                time.sleep(2 + attempt)
        return {"_errors": ["unknown"]}

    def _post(self, path: str, json_body: Optional[dict] = None,
              token_idx: int = 0) -> dict:
        url = f"{self.base}{path}" if path.startswith("/") else f"{self.base}/{path}"
        for attempt in range(5):  # больше попыток
            session = self.sessions[(token_idx + attempt) % len(self.sessions)]
            try:
                r = session.post(url, json=json_body or {}, timeout=8,  # увеличенный timeout
                                 headers={"Content-Type": "application/json"})
                if r.status_code == 429:
                    time.sleep(1 + attempt)
                    continue
                data = r.json()
                if "errors" in data:
                    return {"_errors": data["errors"]}
                return data
            except (requests.RequestException, requests.Timeout) as e:
                if attempt == 4:
                    return {"_errors": [f"network: {e}"]}
                print(f"  retry {attempt+1}/5 for {path}: {type(e).__name__}", file=sys.stderr)
                time.sleep(2 + attempt)
        return {"_errors": ["unknown"]}

    # --- fetchers ---
    def fetch_profile(self, user_id: int) -> Profile:
        # Профиль — через ОТДЕЛЬНЫЙ profile-пул (не message-токены).
        data = self._get_profile(f"/users/{user_id}")
        if "_errors" in data:
            raise RuntimeError(f"Профиль недоступен: {data['_errors']}")
        return Profile.from_api(data)

    def fetch_exact_post_total(self, username: str) -> Optional[int]:
        """Return a username-search aggregate only when the forum exposes one.

        The API ``POST /search/posts`` ``data_total`` is not the forum-wide
        message total and must not be presented as exact.  Until the
        authenticated HTML search response is available to this client, fail
        closed so callers retain the profile/scanned-count fallback.
        """
        if not username or not username.strip():
            return None
        return None

    def fetch_timeline(self, user_id: int, max_pages: int = 60,
                       per_page: int = 20, *, accelerated: bool = False,
                       target_posts: int = 700,
                       rate_limit_reserve: int = 2,
                       max_elapsed_seconds: Optional[float] = None,
                       deadline: Optional[float] = None,
                       progress_callback: Optional[callable] = None) -> list[UserPost]:
        """Собирает до 500 уникальных публичных сообщений из полной API-истории.

        `POST /search/posts` создаёт *временное окно* результатов.  Сначала
        проходятся все страницы этого окна по `links.next`, затем новый запрос
        создаётся с ``before=<самый_старый_timestamp - 1>``.  Так сборщик
        последовательно уходит в старую историю, включая оффтоп-разделы, а не
        останавливается на первой недавней подвыборке.
        """
        target_posts = max(1, int(target_posts))
        rate_limit_reserve = max(1, int(rate_limit_reserve))
        all_posts: list[UserPost] = []
        seen_ids: set[int] = set()
        before: Optional[int] = None
        windows_scanned = 0
        result_pages_fetched = 0
        source_exhausted = False
        error_reason: Optional[str] = None
        last_window_total: Optional[int] = None
        active_token_idx = 0
        token_post_budgets: dict[int, int] = {}
        token_post_used: dict[int, int] = defaultdict(int)
        rate_limit_observations: list[dict] = []
        started_at = time.monotonic()
        effective_deadline = deadline
        if max_elapsed_seconds is not None:
            elapsed_deadline = started_at + max(0.0, float(max_elapsed_seconds))
            effective_deadline = min(effective_deadline, elapsed_deadline) if effective_deadline is not None else elapsed_deadline
        instrumentation_enabled = accelerated and (
            max_elapsed_seconds is not None or deadline is not None or progress_callback is not None
        )
        request_counts = {"POST": defaultdict(int), "GET": defaultdict(int)}
        rate_limit_429 = 0
        retries = 0
        errors = 0
        stop_reason: Optional[str] = None
        current_window = 0
        current_page = 0
        current_token = 0

        def deadline_reached() -> bool:
            return effective_deadline is not None and time.monotonic() >= effective_deadline

        def refresh_meta() -> None:
            if not instrumentation_enabled:
                return
            elapsed = max(0.0, time.monotonic() - started_at)
            self.timeline_fetch_meta.update({
                "accelerated": accelerated,
                "elapsed": elapsed,
                "elapsed_seconds": elapsed,
                "current_token": current_token,
                "current_window": current_window,
                "current_page": current_page,
                "post_requests_by_token": dict(request_counts["POST"]),
                "get_requests_by_token": dict(request_counts["GET"]),
                "requests_by_token": {
                    "POST": dict(request_counts["POST"]),
                    "GET": dict(request_counts["GET"]),
                },
                "rate_limit_429": rate_limit_429,
                "retries": retries,
                "errors": errors,
                "collected": len(all_posts),
                "unique": len(seen_ids),
                "windows_scanned": windows_scanned,
                "result_pages_fetched": result_pages_fetched,
                "stop_reason": stop_reason,
            })
            if progress_callback is not None:
                progress_callback(dict(self.timeline_fetch_meta))

        def header_int(headers: object, name: str) -> Optional[int]:
            try:
                value = headers.get(name)  # type: ignore[union-attr]
                return int(value) if value is not None else None
            except (AttributeError, TypeError, ValueError):
                return None

        def retry_delay(response: object) -> float:
            headers = getattr(response, "headers", {})
            retry_after = header_int(headers, "Retry-After")
            if retry_after is not None:
                return max(0.0, float(retry_after)) + 1.0
            reset = header_int(headers, "X-RateLimit-Reset")
            if reset is not None:
                return max(0.0, float(reset) - time.time()) + 1.0
            return 2.0

        def observe_limit(response: object, method: str, token_idx: int) -> None:
            headers = getattr(response, "headers", {})
            limit = header_int(headers, "X-RateLimit-Limit")
            remaining = header_int(headers, "X-RateLimit-Remaining")
            reset = header_int(headers, "X-RateLimit-Reset")
            retry_after = header_int(headers, "Retry-After")
            rate_limit_observations.append({
                "method": method,
                "token_index": token_idx,
                "limit": limit,
                "remaining": remaining,
                "reset": reset,
                "retry_after": retry_after,
            })
            if method == "POST" and remaining is not None:
                token_post_budgets[token_idx] = max(0, remaining - rate_limit_reserve)

        self.timeline_fetch_meta = {
            "source": "search_posts_deep_history",
            "target_posts": target_posts,
            "windows_scanned": 0,
            "result_pages_fetched": 0,
            "source_exhausted": False,
            "target_reached": False,
            "error": None,
        }

        def add_posts(batch: object) -> None:
            if not isinstance(batch, list):
                return
            for item in batch:
                if not isinstance(item, dict) or str(item.get("content_type", "")).lower() != "post":
                    continue
                # Lolzteam /search/posts возвращает поле `user_id` (не
                # `poster_user_id` как раньше). Проверяем оба варианта, чтобы
                # не отбрасывать чужие посты из смешанных лент и одновременно
                # не терять ВСЕ посты, если поле называется иначе.
                poster_id = item.get("poster_user_id")
                if poster_id is None:
                    poster_id = item.get("user_id")
                try:
                    if int(poster_id) != int(user_id):
                        continue
                except (TypeError, ValueError):
                    continue
                post = UserPost.from_api(item)
                if post.post_id in seen_ids:
                    continue
                seen_ids.add(post.post_id)
                all_posts.append(post)
                if len(all_posts) >= target_posts:
                    return

        def item_timestamp(item: object) -> Optional[int]:
            if not isinstance(item, dict):
                return None
            for field in (
                "post_create_date", "thread_create_date", "content_create_date",
                "profile_post_date", "create_date",
            ):
                try:
                    value = int(item.get(field) or 0)
                    if value > 0:
                        return value
                except (TypeError, ValueError):
                    continue
            return None

        def normalize_result_url(url: object) -> Optional[str]:
            if not isinstance(url, str) or not url:
                return None
            # Search IDs are local to the API gateway which created them. Some
            # responses expose a legacy api.lolz.live link even when the search
            # was created via api.lolz.team; keep path and query, pin the host.
            return re.sub(r"^https?://[^/]+", self.base, url, count=1)

        def get_result_page(url: str, token_idx: int) -> Optional[dict]:
            nonlocal error_reason, rate_limit_429, retries, errors, stop_reason, current_token
            session = self.sessions[token_idx]
            current_token = token_idx
            for attempt in range(8):
                if deadline_reached():
                    stop_reason = "deadline"
                    refresh_meta()
                    return None
                request_counts["GET"][token_idx] += 1
                try:
                    response = session.get(url, timeout=30)
                    observe_limit(response, "GET", token_idx)
                    if response.status_code == 429:
                        rate_limit_429 += 1
                        retries += 1
                        refresh_meta()
                        if deadline_reached():
                            stop_reason = "deadline"
                            return None
                        time.sleep(retry_delay(response))
                        continue
                    data = response.json()
                    if "errors" in data:
                        errors += 1
                        error_reason = "; ".join(str(x) for x in data["errors"])
                        refresh_meta()
                        return None
                    refresh_meta()
                    return data
                except (requests.RequestException, requests.Timeout, ValueError) as exc:
                    errors += 1
                    if attempt == 7:
                        error_reason = f"network: {type(exc).__name__}"
                    else:
                        retries += 1
                        refresh_meta()
                        time.sleep(2 + attempt)
            refresh_meta()
            return None

        def create_search_window(payload: dict, token_idx: int) -> Optional[dict]:
            """Create one search window; never move its cursor to another token."""
            nonlocal error_reason, rate_limit_429, retries, errors, stop_reason, current_token
            url = f"{self.base}/search/posts"
            session = self.sessions[token_idx]
            current_token = token_idx
            for attempt in range(8):
                if deadline_reached():
                    stop_reason = "deadline"
                    refresh_meta()
                    return None
                request_counts["POST"][token_idx] += 1
                try:
                    response = session.post(
                        url, json=payload, timeout=30,
                        headers={"Content-Type": "application/json"},
                    )
                    observe_limit(response, "POST", token_idx)
                    if response.status_code == 429:
                        rate_limit_429 += 1
                        retries += 1
                        refresh_meta()
                        if deadline_reached():
                            stop_reason = "deadline"
                            return None
                        time.sleep(retry_delay(response))
                        continue
                    data = response.json()
                    if "errors" in data:
                        errors += 1
                        error_reason = "; ".join(str(x) for x in data["errors"])
                        refresh_meta()
                        return None
                    token_post_used[token_idx] += 1
                    refresh_meta()
                    return data
                except (requests.RequestException, requests.Timeout, ValueError) as exc:
                    errors += 1
                    if attempt == 7:
                        error_reason = f"network: {type(exc).__name__}"
                    else:
                        retries += 1
                        refresh_meta()
                        time.sleep(2 + attempt)
            refresh_meta()
            return None

        # max_pages is deliberately treated as the maximum number of *successful*
        # history windows, not one result page. A transient expired search ID
        # must not consume this budget, so each true window gets up to four
        # search-window creations before the next historical cursor is used.
        successful_windows = 0
        for request_attempt in range(1, max_pages * 4 + 1):
            if deadline_reached():
                stop_reason = "deadline"
                refresh_meta()
                break
            restart_window = False
            window_no = successful_windows + 1
            current_window = window_no
            current_page = 0
            refresh_meta()
            payload = {"user_id": user_id, "limit": per_page, "data_limit": per_page}
            if before is not None:
                payload["before"] = before
            if accelerated:
                # Round-robin every new search window across all tokens so the
                # POST load (30/min per token) is spread instead of pinning one
                # token. The whole links.next chain of this window stays on the
                # same token (cursor affinity). If a token has spent its safe
                # observed Remaining budget, skip it; only if ALL tokens are
                # currently throttled do we wait for the earliest reset.
                token_count = len(self.sessions)
                start_idx = successful_windows % token_count
                chosen = None
                for offset in range(token_count):
                    idx = (start_idx + offset) % token_count
                    budget = token_post_budgets.get(idx)
                    if budget is None or token_post_used[idx] < budget:
                        chosen = idx
                        break
                if chosen is None:
                    # Every token is at its safe POST budget for this window;
                    # wait until the nearest rate-limit reset rather than error.
                    if deadline_reached():
                        stop_reason = "deadline"
                        refresh_meta()
                        break
                    wait_for = 2.0
                    resets = [
                        obs.get("reset") for obs in rate_limit_observations
                        if obs.get("method") == "POST" and obs.get("reset")
                    ]
                    if resets:
                        wait_for = max(0.0, float(min(resets)) - time.time()) + 1.0
                    time.sleep(min(wait_for, 5.0))
                    token_post_used.clear()
                    chosen = start_idx
                active_token_idx = chosen
            else:
                active_token_idx = 0
            data = create_search_window(payload, active_token_idx)
            if data is None:
                break

            windows_scanned = window_no
            raw_total = data.get("data_total")
            if isinstance(raw_total, int):
                last_window_total = raw_total
            window_oldest: Optional[int] = None

            while True:
                if deadline_reached():
                    stop_reason = "deadline"
                    refresh_meta()
                    break
                current_page += 1
                batch = data.get("data", []) or []
                add_posts(batch)
                for item in batch if isinstance(batch, list) else []:
                    ts = item_timestamp(item)
                    if ts is not None and (window_oldest is None or ts < window_oldest):
                        window_oldest = ts
                result_pages_fetched += 1
                refresh_meta()

                self.on_progress(
                    "fetch_posts", len(all_posts), 0,
                    f"Собрано сообщений: {len(all_posts)}",
                )
                if len(all_posts) >= target_posts:
                    break

                next_url = normalize_result_url((data.get("links") or {}).get("next"))
                if not next_url:
                    break
                if accelerated:
                    # No blind pacing: GET budget is 300/min per token, so only
                    # pause if THIS token's observed Remaining is running low.
                    get_remaining = None
                    for obs in reversed(rate_limit_observations):
                        if obs.get("method") == "GET" and obs.get("token_index") == active_token_idx:
                            get_remaining = obs.get("remaining")
                            break
                    if get_remaining is not None and get_remaining <= rate_limit_reserve:
                        reset = None
                        for obs in reversed(rate_limit_observations):
                            if obs.get("method") == "GET" and obs.get("token_index") == active_token_idx:
                                reset = obs.get("reset")
                                break
                        wait_for = 1.0
                        if reset:
                            wait_for = max(0.0, float(reset) - time.time()) + 1.0
                        time.sleep(min(wait_for, 5.0))
                else:
                    time.sleep(RATE_LIMIT_DELAY)
                next_data = get_result_page(next_url, active_token_idx)
                if next_data is None:
                    # Search-result IDs can disappear transiently on the API.
                    # Re-create the same time window once through the outer loop
                    # instead of treating a recoverable 404 as end of history.
                    if error_reason and ("поисков" in error_reason.lower() or "search" in error_reason.lower()):
                        error_reason = None
                        restart_window = True
                    break
                data = next_data

            if restart_window:
                if not accelerated:
                    time.sleep(2.1)
                continue
            successful_windows += 1
            windows_scanned = successful_windows
            refresh_meta()
            if stop_reason == "deadline":
                break
            if error_reason or len(all_posts) >= target_posts:
                break
            if window_oldest is None:
                source_exhausted = True
                break

            next_before = window_oldest - 1
            if before is not None and next_before >= before:
                source_exhausted = True
                break
            before = next_before
            if successful_windows >= max_pages:
                break
            # Default behavior remains conservatively paced. The opt-in mode
            # instead consumes each token's observed Remaining budget in order.
            if not accelerated:
                time.sleep(2.1)
        else:
            # The retry budget was exhausted before completing all requested
            # windows; preserve the actual sample and report it transparently.
            source_exhausted = False

        if stop_reason is None:
            if len(all_posts) >= target_posts:
                stop_reason = "target_reached"
            elif source_exhausted:
                stop_reason = "source_exhausted"
            elif error_reason:
                stop_reason = "error"
            else:
                stop_reason = "max_pages"
        self.timeline_fetch_meta = {
            "source": "search_posts_deep_history",
            "target_posts": target_posts,
            "last_window_total": last_window_total,
            "windows_scanned": windows_scanned,
            "result_pages_fetched": result_pages_fetched,
            "source_exhausted": source_exhausted,
            "target_reached": len(all_posts) >= target_posts,
            "accelerated": accelerated,
            "cursor_token_affinity": "preserved",
            "post_requests_by_token": dict(token_post_used),
            "post_budgets_by_token": dict(token_post_budgets),
            "rate_limit_observations": rate_limit_observations,
            "error": error_reason,
        }
        refresh_meta()
        all_posts.sort(key=lambda p: p.create_date, reverse=True)
        self.on_progress("fetch_posts", 1, 1,
                         f"Сообщения готовы: {len(all_posts)}")
        return all_posts

    def fetch_threads(self, user_id: int, max_pages: int = 15,
                      per_page: int = 20) -> list[Thread]:
        """
        Созданные темы. Токен 1.
        """
        all_threads: list[Thread] = []
        for page in range(1, max_pages + 1):
            # Темы — через ОТДЕЛЬНЫЙ profile-пул (не message-токены).
            data = self._get_profile("/threads", params={
                "creator_user_id": user_id,
                "limit": per_page,
                "page": page,
            })
            if "_errors" in data:
                break
            batch = data.get("threads", []) or []
            if not batch:
                break
            for t in batch:
                all_threads.append(Thread.from_api(t))
            links = data.get("links", {}) or {}
            if page >= int(links.get("pages", 1) or 1):
                break
            self.on_progress("fetch_threads", page, max_pages,
                             f"Темы: {len(all_threads)} загружено")
            time.sleep(RATE_LIMIT_DELAY * 0.5)
        self.on_progress("fetch_threads", 1, 1,
                         f"Темы готовы: {len(all_threads)}")
        return all_threads

    def fetch_wall(self, user_id: int, max_pages: int = 5,
                   per_page: int = 20) -> list[WallPost]:
        """
        Стена профиля. Токен 2.
        """
        all_posts: list[WallPost] = []
        for page in range(1, max_pages + 1):
            # Стена — через ОТДЕЛЬНЫЙ profile-пул (не message-токены).
            data = self._get_profile(f"/users/{user_id}/profile-posts", params={
                "limit": per_page,
                "page": page,
            })
            if "_errors" in data:
                break
            batch = data.get("profile_posts", []) or []
            if not batch:
                break
            for p in batch:
                all_posts.append(WallPost.from_api(p))
            links = data.get("links", {}) or {}
            if page >= int(links.get("pages", 1) or 1):
                break
            self.on_progress("fetch_wall", page, max_pages,
                             f"Стена: {len(all_posts)} постов")
            time.sleep(RATE_LIMIT_DELAY * 0.5)
        self.on_progress("fetch_wall", 1, 1,
                         f"Стена готова: {len(all_posts)}")
        return all_posts

    # --- search ---
    def search_users(self, q: str) -> list[dict]:
        """
        Найти юзеров по нику / ID / ссылке.
        Возвращает [{user_id, username, avatar, message_count, is_banned}].
        """
        import re
        q = q.strip()

        # ссылка вида https://lolz.live/members/root_duck.5254256/
        # или https://zelenka.guru/members/5254256/
        m = re.search(r'/members/(?:[^./]+\.)?(\d+)', q)
        if m:
            q = m.group(1)

        # числовой ID — напрямую
        if q.isdigit():
            try:
                p = self.fetch_profile(int(q))
                return [{
                    "user_id":       p.user_id,
                    "username":      p.username,
                    "avatar":        p.avatar,
                    "message_count": p.message_count,
                    "sympathy_count": p.like2_count,
                    "is_banned":     p.is_banned,
                }]
            except Exception:
                return []

        # поиск по имени через /users/find (XenForo autocomplete)
        data = self._get("/users/find", params={"username": q, "limit": 10}, token_idx=0, headers={"Api-Username-Inline-Style": "1"})
        raw  = data.get("users", [])
        if not isinstance(raw, list):
            single = data.get("user")
            raw = [single] if single else []

        result = []
        for u in raw:
            if not u:
                continue
            links = u.get("links") or {}
            result.append({
                "user_id":       int(u.get("user_id", 0) or 0),
                "username":      u.get("username", ""),
                "username_html": u.get("username_html", ""),
                "avatar":        links.get("avatar") or u.get("user_avatar") or "",
                "message_count": int(u.get("user_message_count", 0) or 0),
                "sympathy_count": int(u.get("user_like2_count", 0) or 0),
                "is_banned":     bool(u.get("is_banned", 0)),
            })
        return result

    def _resolve_avatars(self, names: list[str]) -> dict:
        """Аватарки по никам через /users/find (XenForo autocomplete).
        Возвращает {username: avatar_url} для точных совпадений."""
        avatars = {}
        for name in names:
            try:
                resp = self._get("/users/find",
                                 params={"username": name, "limit": 5}, token_idx=0)
                for u in (resp.get("users") or []):
                    if not u:
                        continue
                    uname = str(u.get("username", ""))
                    if uname.lower() != name.lower():
                        continue
                    links = u.get("links") or {}
                    av = links.get("avatar") or u.get("user_avatar") or ""
                    if av:
                        avatars[uname] = av
                    break
            except Exception:
                pass
            time.sleep(RATE_LIMIT_DELAY * 0.5)
        return avatars

    # --- high-level ---
    def analyze(self, user_id: int,
                max_timeline_pages: int = 20,
                max_thread_pages: int = 15,
                max_wall_pages: int = 5) -> dict:
        """
        Параллельный fetch постов + тем + стены через 3 токена.
        """
        
        self.on_progress("profile", 0, 1, "Загружаем профиль...")
        profile = self.fetch_profile(user_id)
        self.on_progress("profile", 1, 1, "Профиль готов")

        # Источники собираются параллельно; их лимиты страниц не являются totals.
        self.on_progress("fetch_posts", 0, 0, "Начинаем сбор публичных данных...")

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_exact_total = executor.submit(self.fetch_exact_post_total, profile.username)
            future_posts = executor.submit(
                self.fetch_timeline,
                user_id,
                max_timeline_pages,
                accelerated=True,
                max_elapsed_seconds=300,
                progress_callback=lambda meta: self.on_progress(
                    "fetch_posts",
                    int(meta.get("collected", 0) or 0),
                    0,
                    "Собираем сообщения: " + str(int(meta.get("collected", 0) or 0)),
                ),
            )
            future_threads = executor.submit(self.fetch_threads, user_id, max_thread_pages)
            future_wall = executor.submit(self.fetch_wall, user_id, max_wall_pages)

            exact_post_total = future_exact_total.result()
            posts = future_posts.result()
            threads = future_threads.result()
            wall = future_wall.result()

        self._last_posts = posts  # воркер использует для AI (full-отчёт)
        self.collected_message_counts = {
            "total": len(posts) + len(threads) + len(wall),
            "timeline_posts": len(posts),
            "threads": len(threads),
            "wall_posts": len(wall),
        }
        self.on_progress("metrics", 0, 1, f"Готово: {len(posts)} постов, {len(threads)} тем, {len(wall)} стены")
        result = self._build_dossier(profile, posts, threads, wall, exact_post_total)
        self.on_progress("done", 1, 1, "Досье готово")
        return result

    # --- dossier assembly ---
    def _build_dossier(self, profile: Profile, posts: list[UserPost],
                       threads: list[Thread], wall: list[WallPost],
                       exact_post_total: Optional[int] = None) -> dict:
        now = int(time.time())
        card = self._build_card(profile, now, exact_post_total)

        # Все тексты в одном пуле
        all_texts = [p.body for p in posts if p.body] + \
                    [t.body for t in threads if t.body] + \
                    [w.body for w in wall if w.body]

        # Метрики
        print(f"  → Метрики...", file=sys.stderr)
        manner = analyze_manner(all_texts)
        emotion = analyze_emotional_profile(all_texts)
        ego = analyze_ego_index(all_texts)
        confidence = analyze_confidence(all_texts)
        conflict = analyze_conflict_score(posts, threads, wall)
        literacy = analyze_literacy(all_texts)
        interests = analyze_interests(all_texts)

        # НОВЫЕ МЕТРИКИ v3
        print(f"  → Триггеры, ошибки, эмпатия, ��овички...", file=sys.stderr)
        triggers = analyze_triggers(posts, threads)
        admit_mistakes = analyze_admit_mistakes(posts)
        empathy = analyze_empathy(posts)
        newbies = analyze_attitude_to_newbies(posts, threads)

        # Архетипы
        archetypes = detect_archetypes(profile, posts, threads, wall,
                                       manner, emotion, ego, confidence)

        # Активность
        all_timestamps = [p.create_date for p in posts if p.create_date] + \
                         [t.create_date for t in threads if t.create_date] + \
                         [w.create_date for w in wall if w.create_date]
        time_profile = analyze_activity_hours(all_timestamps)
        yearly_dynamics = analyze_yearly_dynamics(all_timestamps)

        # Топ контент
        top_threads = top_threads_by_views(threads)
        top_posts = top_posts_by_likes(posts)
        reactions = reaction_stats(posts)

        # Разделы
        forum_counter = Counter()
        for t in threads:
            name = t.forum_title or f"forum#{t.forum_id}"
            forum_counter[name] += 1
        for p in posts:
            if p.forum_title:
                forum_counter[p.forum_title] += 1
        top_forums = forum_counter.most_common(5)

        # Стена
        wall_posters = Counter()
        for w in wall:
            if w.poster_id != profile.user_id:
                wall_posters[w.poster_name] += 1
        top_wall_posters = wall_posters.most_common(5)

        # Аватарки топ-писателей стены (для «Круга общения»)
        poster_avatars = {}
        if top_wall_posters:
            try:
                poster_avatars = self._resolve_avatars([n for n, _ in top_wall_posters])
            except Exception:
                pass

        # Safety
        safety = self._build_safety(profile)

        # v7: карта тем/экспертизы + базовая репутация
        title_analysis = self._analyze_thread_titles(threads)
        topic_expertise = analyze_topic_expertise(posts, threads)
        reputation_disputes = analyze_reputation_basic(profile, archetypes, title_analysis, safety)

        # Психологический возраст (алгоритмическая база; AI корректирует позже)
        psychological_age = analyze_psychological_age(
            profile, all_texts, manner, emotion, ego, confidence, literacy)

        # Финальный вердикт
        verdict = build_final_verdict(profile, posts, threads, wall,
                                       manner, emotion, ego, confidence,
                                       conflict, archetypes, safety, literacy)

        dossier = {
            "generated_at": now,
            "user_id": profile.user_id,
            "card": card,
            "activity": {
                "top_forums": [{"forum": f, "count": c} for f, c in top_forums],
                "time_profile": time_profile,
                "yearly_dynamics": yearly_dynamics,
                "top_threads_by_views": top_threads,
                "top_posts_by_likes": top_posts,
                "reactions": reactions,
                "wall_atmosphere": self._wall_atmosphere(wall, top_wall_posters),
                "wall_posters": [{"name": n, "count": c, "avatar": poster_avatars.get(n, "")} for n, c in top_wall_posters],
                "wall_posts_total": len(wall),
                "topic_expertise": topic_expertise,
            },
            "title_analysis": title_analysis,
            "portrait": {
                "manner": manner,
                "archetypes": archetypes,
                "emotion": emotion,
                "ego": ego,
                "confidence": confidence,
                "conflict": conflict,
                "literacy": literacy,
                "psychological_age": psychological_age,
                "interests": interests,
                "sample_phrases": [t for t in all_texts if 20 <= len(t) <= 200][:6],
                "stats": {
                    "avg_words_per_post": literacy.get("avg_words_per_post", 0),
                    "caps_avg": round(sum(detect_caps_ratio(t) for t in all_texts) / max(1, len(all_texts)), 2),
                    "emoji_avg": round(sum(detect_emoji_count(t) for t in all_texts) / max(1, len(all_texts)), 2),
                },
            },
            "triggers": triggers,
            "admit_mistakes": admit_mistakes,
            "empathy": empathy,
            "newbies": newbies,
            "safety": safety,
            "reputation_disputes": reputation_disputes,
            "verdict": verdict,
            "collection_metadata": {
                "collected_message_count": self.collected_message_counts["total"],
                "collected_message_counts": dict(self.collected_message_counts),
                "semantics": "Unique raw records collected from timeline, created threads, and profile wall; AI output and derived aggregates excluded.",
            },
            "raw_stats": {
                "posts_fetched": len(posts),
                "timeline_fetch": dict(self.timeline_fetch_meta),
                "exact_post_total": exact_post_total,
                "threads_fetched": len(threads),
                "wall_posts_fetched": len(wall),
                "message_count": profile.message_count,
                "like_count": profile.like_count,
                "trophy_count": profile.trophy_count,
                "following": profile.following_count,
                "followers": profile.followers_count,
            },
        }
        return sanitize_dossier(dossier)

    def _build_card(self, p: Profile, now: int, exact_post_total: Optional[int] = None) -> dict:
        if p.register_date:
            age_s = max(0, now - p.register_date)
            tenure = humanize_age(age_s)
        else:
            tenure = "—"
        if p.last_seen_date:
            last_s = max(0, now - p.last_seen_date)
            activity = humanize_last_seen(last_s)
        else:
            activity = "Нет данных"
        warnings = p.warning_points
        if p.is_banned:
            warn_text = f"{warnings}/3 — Заблокирован"
        elif warnings >= 3:
            warn_text = f"{warnings}/3 — ходит по лезвию бана"
        elif warnings > 0:
            warn_text = f"{warnings}/3 — есть проблемы с модерацией"
        else:
            warn_text = "0/3 — чисто"
        status = p.custom_title or p.user_title or p.primary_group or "Участник"
        return {
            "username": p.username,
            "status": status,
            "is_banned": p.is_banned,
            "last_activity": activity,
            "tenure": tenure,
            "register_date": p.register_date,
            "warnings": warn_text,
            "warning_points": warnings,
            "user_id": p.user_id,
            "groups": [g.get("user_group_title", "") for g in p.groups],
            "trophy_count": p.trophy_count,
            "message_count": exact_post_total if exact_post_total is not None else p.message_count,
            "profile_message_count": p.message_count,
            "exact_post_total": exact_post_total,
            "following": p.following_count,
            "followers": p.followers_count,
            "likes_received": p.like_count,
            "avatar":         p.avatar,
        }

    def _wall_atmosphere(self, wall: list[WallPost], top_posters) -> str:
        if not wall:
            return "Стена пуста — либо никому не интересен, либо чистит сообщения"
        wall_texts = [w.body for w in wall if w.body]
        toxic_count = sum(1 for t in wall_texts if count_lexicon_hits(t, TOXIC_WORDS)[0] >= 1)
        if toxic_count > len(wall_texts) * 0.3:
            return f"Токсичная — {toxic_count} из {len(wall_texts)} постов с матом. На стене бранятся"
        if top_posters:
            return f"Активная — пишут {len({w.poster_name for w in wall if w.poster_id != wall[0].poster_id})} разных юзеров. Топ: {', '.join(n for n,_ in top_posters[:3])}"
        return "Тихая — постит в основном сам пользователь"

    def _analyze_thread_titles(self, threads: list[Thread]) -> dict:
        if not threads:
            return {
                "total": 0,
                "verdict": "Темы не найдены — либо читатель, либо темы удалены.",
                "types": {}, "style": {}, "evolution": {}, "examples": [],
                "dominant_type": "—", "needs_verdict": "Недостаточно данных",
            }
        titles = [t.title for t in threads]
        sorted_threads = sorted(threads, key=lambda t: t.create_date)

        types = Counter()
        for title in titles:
            t = title.lower()
            if any(q in t for q in ["?", "как ", "почему", "зачем", "что делать"]):
                types["Вопрос"] += 1
            elif any(k in t for k in ["гайд", "как я", "инструкция", "туториал"]):
                types["Гайд"] += 1
            elif any(k in t for k in ["жалоба", "накажите", "нарушение"]):
                types["Жалоба"] += 1
            elif any(k in t for k in ["новость", "анонс", "обновление", "патч"]):
                types["Новость"] += 1
            elif any(k in t for k in ["помогите", "хелп", "срочно", "не работает", "проблема"]):
                types["Просьба о помощи"] += 1
            elif any(k in t for k in ["оффтоп", "флуд", "обсуждаем", "обсуждение"]):
                types["Оффтоп"] += 1
            elif any(k in t for k in ["обзор", "отзыв", "распаковка"]):
                types["Обзор"] += 1
            elif any(k in t for k in ["оформление", "работа", "графика"]):
                types["Творчество"] += 1
            elif any(k in t for k in ["претензия", "скам", "кинули"]):
                types["Претензия"] += 1
            else:
                types["Разное"] += 1

        avg_len = sum(len(t) for t in titles) / len(titles)
        caps_count = sum(1 for t in titles if detect_caps_ratio(t) > 0.4 and len(t) > 8)
        clickbait_count = sum(1 for t in titles if any(k in t.lower() for k in [
            "вы не поверите", "шок", "срочно", "вау", "наконец-то", "!!",
            "что будет если", "посмотрите", "вот это"
        ]))
        empty_count = sum(1 for t in titles if len(t.split()) <= 1)

        if avg_len > 50 and caps_count == 0 and clickbait_count == 0:
            style_verdict = "Информативные и сдержанные — умеет формулировать мысль"
        elif clickbait_count > len(titles) * 0.3:
            style_verdict = "Кликбейтные — гонится за вниманием"
        elif caps_count > 2:
            style_verdict = "Любит КАПС — истеричный или эмоциональный"
        elif empty_count > len(titles) * 0.3:
            style_verdict = "Пустые заголовки («Хелп», «Срочно») — не умеет ставить вопрос"
        else:
            style_verdict = "Разные — от нормальных до ленивых"

        n = len(sorted_threads)
        if n >= 10:
            first_5 = sorted_threads[:5]
            last_5 = sorted_threads[-5:]
            first_kw = extract_keywords([t.title for t in first_5])
            last_kw = extract_keywords([t.title for t in last_5])
            evolution = {
                "first_period": {
                    "sample": first_5[0].title,
                    "year": datetime.fromtimestamp(first_5[0].create_date, tz=timezone.utc).year,
                    "top_words": first_kw.most_common(5),
                },
                "last_period": {
                    "sample": last_5[-1].title,
                    "year": datetime.fromtimestamp(last_5[-1].create_date, tz=timezone.utc).year,
                    "top_words": last_kw.most_common(5),
                },
            }
            intersection = set(w for w,_ in first_kw.most_common(20)) & \
                           set(w for w,_ in last_kw.most_common(20))
            if intersection:
                evolution["verdict"] = (
                    f"Тематика стабильна — слова «{', '.join(list(intersection)[:5])}» "
                    f"и в старых, и в новых темах"
                )
            else:
                evolution["verdict"] = "Тематика поменялась — старые и новые темы о разном"
        else:
            evolution = {"verdict": "Слишком мало тем для анализа эволюции"}

        examples = [{
            "title": t.title, "forum": t.forum_title,
            "date": datetime.fromtimestamp(t.create_date, tz=timezone.utc).strftime("%Y-%m-%d"),
            "views": t.view_count, "replies": t.reply_count,
        } for t in sorted_threads[:8]]

        dominant_type = types.most_common(1)[0][0] if types else "—"
        needs_map = {
            "Вопрос": "Любопытство — задаёт вопросы, ищет ответы у комьюнити",
            "Просьба о помощи": "Потребность в поддержке — что-то ломается, ищет спасения",
            "Гайд": "Потребность делиться знаниями — наставник",
            "Жалоба": "��онфликтность — регулярно жалуется, ищет справедливости через модераторов",
            "Оффтоп": "Социальная потребность — форум как курилка",
            "Новость": "Информационная — ретранслятор новостей",
            "Творчество": "Творческая потребность — показывает работы, ищет оценку",
            "Претензия": "Претензионная — регулярно вступает в конфликты по сделкам",
            "Разное": "Разносторонние интересы — доминанты нет",
        }

        return {
            "total": len(threads),
            "types": dict(types),
            "style": {
                "avg_length": round(avg_len, 1),
                "caps_count": caps_count,
                "clickbait_count": clickbait_count,
                "empty_count": empty_count,
                "verdict": style_verdict,
            },
            "evolution": evolution,
            "examples": examples,
            "dominant_type": dominant_type,
            "needs_verdict": needs_map.get(dominant_type, "Разносторонние интересы"),
        }

    def _build_safety(self, p: Profile) -> dict:
        if p.is_banned:
            return {
                "in_blacklist": True,
                "verdict": "🚫 ЗАБАНЕН на форуме. Аккаунт находится в блокировке.",
                "ban_reason": p.banned_text or "Причина не указана в API",
            }
        for g in p.groups:
            title = (g.get("user_group_title") or "").lower()
            if "заблок" in title or "бан" in title:
                return {
                    "in_blacklist": True,
                    "verdict": f"🚫 В группе «{g.get('user_group_title')}» — фактически заблокирован",
                    "ban_reason": p.banned_text,
                }
        return {
            "in_blacklist": False,
            "verdict": "✅ Чист — не в блеклисте форума, не забанен",
            "ban_reason": "",
        }


# ---------------------------------------------------------------------------
# CLI / rendering
# ---------------------------------------------------------------------------

def render_text_dossier(d: dict) -> str:
    """Plain-text dossier for CLI / debugging."""
    card = d["card"]
    out = []
    out.append("=" * 72)
    out.append(f"  ДОСЬЕ: {card['username']}  (id: {card['user_id']})")
    out.append("=" * 72)

    out.append("\n1. КАРТОЧКА")
    out.append(f"   Ник: {card['username']}  ·  Статус: {card['status']}")
    out.append(f"   Стаж: {card['tenure']}  ·  А��тивность: {card['last_activity']}")
    out.append(f"   Ворнинги: {card['warnings']}")
    out.append(f"   Посты: {card['message_count']}  ·  Лайки: {card['likes_received']}  ·  Трофеи: {card['trophy_count']}")

    out.append("\n2. АКТИВНОСТЬ")
    a = d["activity"]
    out.append(f"   Когда: {a['time_profile']['verdict']}")
    out.append(f"   Динамика: {a['yearly_dynamics']['verdict']}")
    out.append(f"   Реакции: {a['reactions']['verdict']}")
    if a["top_forums"]:
        out.append("   Где обитает:")
        for f in a["top_forums"][:3]:
            out.append(f"     • {f['forum']} — {f['count']}")

    out.append("\n3. ТЕМЫ")
    t = d["title_analysis"]
    out.append(f"   Всего: {t['total']}  ·  Доминантный тип: {t.get('dominant_type','—')}")
    out.append(f"   Стиль: {t['style']['verdict']}")
    out.append(f"   Потребности: {t['needs_verdict']}")

    out.append("\n4. ПОРТРЕТ")
    p = d["portrait"]
    out.append(f"   Манера: {p['manner']['primary']}" + (f" + {p['manner']['secondary']}" if p['manner']['secondary'] else ""))
    out.append(f"   Архетипы: {', '.join(p['archetypes'])}")
    out.append(f"   Эмоции: {p['emotion']['verdict']}")
    out.append(f"   Эго: {p['ego']['verdict']}")
    out.append(f"   Уверенность: {p['confidence']['verdict']}")
    out.append(f"   Конфликтность: {p['conflict']['score']}/10 — {p['conflict']['verdict']}")
    out.append(f"   Грамотность: {p['literacy']['verdict']}")

    out.append("\n5. БЕЗОПАСНОСТЬ")
    out.append(f"   {d['safety']['verdict']}")

    out.append("\n6. ВЕРДИКТ")
    v = d["verdict"]
    out.append(f"   Резюме: {v['summary']}")
    out.append(f"   Кому полезен: {'; '.join(v['useful_for'])}")
    out.append(f"   Кому опасен: {'; '.join(v['dangerous_for'])}")
    out.append(f"   Новичкам: {v['newbies_note']}")

    out.append("=" * 72)
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description="Lolz dossier v2")
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--token", default=os.environ.get("LOLZ_TOKEN", ""))
    parser.add_argument("--token-file", default="")
    parser.add_argument("--max-timeline-pages", type=int, default=20)
    parser.add_argument("--max-thread-pages", type=int, default=15)
    parser.add_argument("--max-wall-pages", type=int, default=5)
    parser.add_argument("--output", default="")
    parser.add_argument("--text", action="store_true")
    args = parser.parse_args()

    token = args.token
    if not token and args.token_file:
        with open(args.token_file) as f:
            token = f.read().strip()
    if not token:
        sys.exit("❌ Токен не найден.")

    analyzer = LolzAnalyzer(token)
    print(f"⏳ Анализирую пользователя {args.user_id}...", file=sys.stderr)
    dossier = analyzer.analyze(
        user_id=args.user_id,
        max_timeline_pages=args.max_timeline_pages,
        max_thread_pages=args.max_thread_pages,
        max_wall_pages=args.max_wall_pages,
    )

    if args.text:
        print(render_text_dossier(dossier))
    else:
        out = json.dumps(dossier, ensure_ascii=False, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(out)
            print(f"✅ Сохранено: {args.output}", file=sys.stderr)
        else:
            print(out)


if __name__ == "__main__":
    main()
