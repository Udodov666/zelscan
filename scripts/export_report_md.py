# -*- coding: utf-8 -*-
"""Экспорт досье Zelscan → Markdown + HTML (вся инфа из JSON)."""
import json, sqlite3, sys, time, datetime, html

ORDER_DISPLAY = sys.argv[1] if len(sys.argv) > 1 else "ZS-5F879874"
con = sqlite3.connect("zelscan.db")
r = con.execute("SELECT id, username, result_path, report_type FROM orders WHERE display_id=?", (ORDER_DISPLAY,)).fetchone()
if not r:
    print("order not found"); sys.exit(1)
oid, username, rpath, rtype = r
d = json.load(open("cache/results/" + oid + ".json", encoding="utf-8"))

card = d.get("card", {})
act = d.get("activity", {})
por = d.get("portrait", {})
psy = ((d.get("ai_analysis") or {}).get("psychologist") or {}).get("parsed") or {}
ai_max = ((d.get("ai_analysis") or {}).get("max") or {})
lite = ((d.get("ai_analysis") or {}).get("lite") or {})
vd = d.get("verdict", {})
rs = d.get("reputation_disputes", {})
safety = d.get("safety", {})
trig = d.get("triggers", {})
admit = d.get("admit_mistakes", {})
emp = d.get("empathy", {})
raw = d.get("raw_stats", {})

def ts(v):
    if not v: return "—"
    return datetime.datetime.fromtimestamp(int(v)).strftime("%d.%m.%Y %H:%M")

def s(v, default="—"):
    return html.escape(str(v)) if v not in (None, "", []) else default

L = []
A = L.append
A("# Zelscan — досье @" + str(card.get("username", username)))
A("")
A("**ID:** " + str(card.get("user_id", "?")) + " · **Досье:** " + ORDER_DISPLAY +
  " · **Тариф:** " + ("Полный (AI)" if rtype == "full" else "Базовый") +
  " · **Сформировано:** " + ts(d.get("generated_at")))
A("")

# Карточка
A("## 👤 Карточка")
A("")
A("| | |")
A("|---|---|")
A("| Статус | " + s(card.get("status")) + " |")
A("| На форуме | " + s(card.get("tenure")) + " |")
_rd = card.get("register_date")
_rd_fmt = datetime.datetime.fromtimestamp(int(_rd)).strftime("%d.%m.%Y") if _rd else "—"
A("| Регистрация | " + s(_rd_fmt) + " |")
A("| Сообщений | " + s(card.get("message_count")) + " |")
A("| Лайков | " + s(card.get("like_count")) + " |")
A("| Предупреждения | " + s(card.get("warning_text", card.get("warning_points"))) + " |")
A("| Забанен | " + ("да" if card.get("is_banned") else "нет") + " |")
A("")
A("**Описание:** " + s(vd.get("summary"), (por.get("archetypes") or ["—"])[0] if por.get("archetypes") else "—"))
A("")

# Обзор
A("## 📊 Обзор")
A("")
mrow = por.get("stats") or {}
if mrow:
    for k, v in mrow.items():
        A("- **" + k.replace("_", " ").capitalize() + ":** " + s(v))
if por.get("archetypes"):
    A("- **Архетипы:** " + s(", ".join(por["archetypes"])))
if por.get("manner"):
    A("- **Манера:** " + s(por["manner"].get("primary")) + " + " + s(por["manner"].get("secondary")))
A("")

# Активность
A("## 📈 Активность")
A("")
tp = act.get("time_profile") or {}
if tp:
    A("- **Пик активности:** " + s(tp.get("peak_hour"), "—") + ":00")
    A("- **Ночь/день/вечер:** " + str(tp.get("night_ratio", "—")) + " / " + str(tp.get("day_ratio", "—")) + " / " + str(tp.get("evening_ratio", "—")))
    A("- **Выходные:** " + str(tp.get("weekend_ratio", "—")))
yd = act.get("yearly_dynamics") or {}
if yd:
    A("- **Тренд:** " + s(yd.get("verdict")))
A("- **Топ форумов:**")
for f in (act.get("top_forums") or [])[:6]:
    A("  - " + s(f.get("forum") or f.get("forum_title") or f.get("title") or f.get("name", "—")) + " — " + str(f.get("count") or f.get("posts") or "—"))
A("")

# Поведение
A("## 🎭 Поведение")
A("")
conf = por.get("conflict") or {}
A("- **Конфликтность:** " + str(conf.get("score", "—")) + "/10 — " + s(conf.get("verdict")))
ego = por.get("ego") or {}
A("- **Эго-индекс:** " + str(ego.get("per_100", "—")) + " на 100 слов — " + s(ego.get("verdict")))
cf = por.get("confidence") or {}
A("- **Уверенность:** " + str(cf.get("score", "—")) + "% — " + s(cf.get("verdict")))
lit = por.get("literacy") or {}
A("- **Грамотность:** " + s(lit.get("verdict")))
em = por.get("emotion") or {}
A("- **Эмоции:** токсичность " + str(em.get("toxic_pct", "—")) + "%, нейтрально " + str(em.get("neutral_pct", "—")) + "%")
A("- **Признание ошибок:** " + s(admit.get("verdict")))
A("- **Эмпатия:** " + s(emp.get("verdict")))
if trig.get("top_topic_triggers"):
    A("- **Триггеры (где материт):**")
    for t in trig["top_topic_triggers"][:3]:
        A("  - " + s(t.get("topic", ""))[:60])
A("")

# Психология
A("## 🧠 Психология (AI)")
A("")
if psy:
    A("**" + s(psy.get("portrait_headline")) + "**")
    A("")
    A(s(psy.get("summary_one_line")))
    A("")
    A(s(psy.get("psychological_portrait")))
    A("")
    bf = psy.get("big_five") or {}
    if bf:
        A("### Big Five")
        A("")
        for k in ("openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"):
            if k in bf: A("- **" + k.capitalize() + ":** " + str(bf[k]) + "/10")
        if bf.get("note"): A("- " + s(bf["note"]))
        A("")
    dt = psy.get("dark_triad") or {}
    if dt:
        A("### Тёмная триада")
        A("")
        A("- **Нарциссизм:** " + str(dt.get("narcissism", 0)) + "/10")
        A("- **Макиавеллизм:** " + str(dt.get("machiavellianism", 0)) + "/10")
        A("- **Психопатия:** " + str(dt.get("psychopathy", 0)) + "/10")
        if dt.get("red_flags"): A("- **Флаги:** " + s("; ".join(dt["red_flags"])))
        A("")
    ei = psy.get("emotional_intelligence") or {}
    if ei:
        A("### Эмоциональный интеллект")
        A("")
        for k in ("self_awareness", "self_regulation", "empathy", "social_skills"):
            if k in ei: A("- **" + k.replace("_", " ").capitalize() + ":** " + str(ei[k]) + "/10")
        A("")
    if psy.get("defense_mechanisms"):
        A("**Защиты:** " + s(", ".join(psy["defense_mechanisms"])))
        A("")
    if psy.get("cognitive_distortions"):
        A("**Когнитивные искажения:** " + s(", ".join(psy["cognitive_distortions"])))
        A("")
    if psy.get("attachment_style"):
        A("**Тип привязанности:** " + s(psy["attachment_style"]))
        A("")
    sr = psy.get("status_relation") or {}
    if sr:
        A("### Отношение по статусу (0 — по-доброму, 100 — троллит)")
        A("")
        A("| Группа | Отношение |")
        A("|---|---|")
        A("| Равные (peer) | " + str(sr.get("peer", "—")) + " |")
        A("| Новички (newbie) | " + str(sr.get("newbie", "—")) + " |")
        A("| Модерация (mod) | " + str(sr.get("mod", "—")) + " |")
        A("| Слабее него (weak) | " + str(sr.get("weak", "—")) + " |")
        if psy.get("relations_note"): A("")
        if psy.get("relations_note"): A(s(psy["relations_note"]))
        A("")
    if psy.get("manner_description"):
        A("**Манера:** " + s(psy["manner_description"]))
        A("")
    if psy.get("conflict_pattern"):
        A("**Конфликтный паттерн:** " + s(psy["conflict_pattern"]))
        A("")
    if psy.get("personality_types"):
        A("**Типажи:** " + s(", ".join(psy["personality_types"])))
        A("")
else:
    A("_AI-анализ в этом досье отсутствует._")
    A("")

# Репутация
A("## 🛡 Репутация и споры")
A("")
A("- **Индекс:** " + str(rs.get("score", "—")) + "/100 — " + s(rs.get("level")))
A("- **Баллы предупреждений:** " + s(rs.get("warnings_scale")))
A("- **Заблокирован сейчас:** " + ("да" if rs.get("is_banned") or rs.get("in_blacklist") else "нет"))
A("- **Темы-претензии:** " + str(rs.get("claims", 0)) + " · **Темы-жалобы:** " + str(rs.get("complaints", 0)))
A("- " + s(rs.get("verdict")))
A("")

# Примеры
sp = por.get("sample_phrases") or []
if sp:
    A("## 💬 Характерные фразы")
    A("")
    for x in sp[:8]:
        txt = x.get("text") if isinstance(x, dict) else x
        if txt: A("- " + s(str(txt)[:160]))
    A("")

# Техника
cm = d.get("collection_metadata") or {}
A("---")
A("*Собрано: " + str(raw.get("posts_fetched", "—")) + " постов · " + str(raw.get("threads_fetched", "—")) + " тем · " + str(raw.get("wall_posts_fetched", "—")) + " стены · экспорт Zelscan " + time.strftime("%d.%m.%Y %H:%M") + "*")
A("")

md_text = "\n".join(L)
md_path = "exports/" + ORDER_DISPLAY + ".md"
import os
os.makedirs("exports", exist_ok=True)
open(md_path, "w", encoding="utf-8").write(md_text)

# HTML-версия
H = []
HA = H.append
HA("<!DOCTYPE html><html lang='ru'><head><meta charset='utf-8'><title>Zelscan — " + html.escape(str(card.get('username', username))) + "</title><style>")
HA("body{background:#0b0b0d;color:#e8e8ec;font:15px/1.65 Inter,Segoe UI,Arial,sans-serif;max-width:900px;margin:0 auto;padding:40px 24px}h1{font-size:34px;letter-spacing:-.02em;margin:.2em 0}h2{font-size:22px;margin:1.6em 0 .5em;border-bottom:1px solid #232329;padding-bottom:.3em}h3{font-size:17px;margin:1.2em 0 .4em}table{border-collapse:collapse;width:100%;margin:.6em 0}td{padding:7px 10px;border-bottom:1px solid #1e1e24;vertical-align:top}td:first-child{color:#8a8a92;width:220px}.tag{display:inline-block;padding:3px 12px;border-radius:100px;background:rgba(48,201,145,.15);color:#2BAD72;font-size:13px}.meta{color:#8a8a92;font-size:13px}.note{color:#8a8a92;font-size:13px;border-top:1px solid #1e1e24;margin-top:40px;padding-top:14px}b{color:#fff}")
HA("</style></head><body>")
HA("<h1>Досье @" + html.escape(str(card.get("username", username))) + "</h1>")
HA("<p class='meta'>" + ORDER_DISPLAY + " · " + ("Полный (AI)" if rtype == "full" else "Базовый") + " · " + ts(d.get("generated_at")) + "</p>")
for line in L:
    t = line
    if t.startswith("# "):
        HA("<h1>" + html.escape(t[2:]) + "</h1>")
    elif t.startswith("## "):
        HA("<h2>" + html.escape(t[3:]) + "</h2>")
    elif t.startswith("### "):
        HA("<h3>" + html.escape(t[4:]) + "</h3>")
    elif t.startswith("- "):
        HA("<div>· " + t[2:].replace("**", "<b>").replace("_", "<i>", 1) + "</div>")
    elif t.startswith("|"):
        rows = [c.strip() for c in t.strip("|").split("|")]
        HA("<table><tr>" + "".join("<td>" + c.replace("**", "<b>") + "</td>" for c in rows) + "</tr></table>")
    elif t == "":
        pass
    else:
        HA("<p>" + t.replace("**", "<b>") + "</p>")
HA("<p class='note'>Экспорт Zelscan · " + time.strftime("%d.%m.%Y %H:%M") + "</p>")
HA("</body></html>")
html_path = "exports/" + ORDER_DISPLAY + ".html"
open(html_path, "w", encoding="utf-8").write("\n".join(H))
print("MD:  exports/" + ORDER_DISPLAY + ".md")
print("HTML: exports/" + ORDER_DISPLAY + ".html")
