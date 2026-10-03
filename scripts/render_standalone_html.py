"""
Generate a standalone HTML preview of a dossier (v6 multi-page).
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"


def render_html(dossier: dict) -> str:
    css = (APP_DIR / "static" / "style.css").read_text(encoding="utf-8")
    template = (APP_DIR / "templates" / "index.html").read_text(encoding="utf-8")
    template = template.replace('{{ url_for(\'static\', filename=\'style.css\') }}', '#')
    template = template.replace('{{ url_for(\'static\', filename=\'app.js\') }}', '#')
    template = template.replace('<link rel="stylesheet" href="#">', '<style>' + css + '</style>')

    js_original = (APP_DIR / "static" / "app.js").read_text(encoding="utf-8")
    dossier_json = json.dumps(dossier, ensure_ascii=False, indent=2)
    has_ai = "true" if dossier.get("ai_analysis") else "false"

    # Standalone JS: hide form, render dossier
    embedded_js = """
// Standalone mode
const DOSSIER_DATA = __DOSSIER_JSON__;
const HAS_AI_ANALYSIS = __HAS_AI__;

document.addEventListener('DOMContentLoaded', () => {
    // Hide hero/search
    const hero = document.querySelector('#heroSection');
    if (hero) hero.style.display = 'none';
    
    // Add info banner at top
    const topbar = document.querySelector('.topbar');
    if (topbar) {
        const banner = document.createElement('div');
        banner.style.cssText = 'background: var(--bg-elev-1); border-bottom: 1px solid var(--border); padding: 10px 24px; font-size: 12px; color: var(--fg-muted); text-align: center;';
        const aiInfo = HAS_AI_ANALYSIS ? ' · 🤖 AI-анализ встроен' : '';
        banner.innerHTML = '📄 Автономный режим · Готовое досье #' + DOSSIER_DATA.user_id + ' (' + DOSSIER_DATA.card.username + ')' + aiInfo;
        topbar.insertAdjacentElement('afterend', banner);
    }
    
    // Render dossier
    if (typeof renderDossier === 'function') {
        renderDossier(DOSSIER_DATA);
        showDossier();
    }
});
""".replace("__DOSSIER_JSON__", dossier_json).replace("__HAS_AI__", has_ai)

    template = template.replace(
        '<script src="#"></script>',
        '<script>' + js_original + '\n' + embedded_js + '</script>'
    )
    return template


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as f:
        dossier = json.load(f)
    html = render_html(dossier)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ Saved: {args.output} ({Path(args.output).stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
