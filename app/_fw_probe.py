import base64, json, sqlite3, datetime
import requests
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
key = (ROOT / ".admin_master_key").read_bytes()
conn = sqlite3.connect(ROOT / "zelscan.db")
row = conn.execute("SELECT encrypted_key FROM ai_providers WHERE id='pr_fireworks'").fetchone()
raw = base64.urlsafe_b64decode(row[0])
api_key = AESGCM(key).decrypt(raw[:12], raw[12:], b"zelscan-ai-key-v1").decode()

H = {"Authorization": "Bearer " + api_key, "Accept": "application/json"}
aid = "yiliso-a4n0jsivmyl1"

candidates = [
    f"https://api.fireworks.ai/v1/accounts/{aid}/billing/balance",
    f"https://api.fireworks.ai/v1/accounts/{aid}/billing/credits",
    f"https://api.fireworks.ai/v1/accounts/{aid}/credits",
    f"https://api.fireworks.ai/v1/billing/credits",
    f"https://api.fireworks.ai/v1/balance",
    f"https://api.fireworks.ai/api/billing/credit_grants",
    f"https://api.fireworks.ai/api/usage",
    f"https://app.fireworks.ai/api/billing/summary",
]
for u in candidates:
    try:
        r = requests.get(u, headers=H, timeout=12)
        print(f"{r.status_code} {u} -> {r.text[:220].replace(chr(10),' ')}")
    except Exception as e:
        print(f"ERR {u} -> {e}")
