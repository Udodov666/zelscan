import base64, sqlite3, json, requests
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(r"C:\Users\domas\claude222\zelscass")
key = (ROOT / ".admin_master_key").read_bytes()
conn = sqlite3.connect(ROOT / "zelscan.db")
raw = base64.urlsafe_b64decode(conn.execute("SELECT encrypted_key FROM ai_providers WHERE id='pr_fireworks'").fetchone()[0])
ak = AESGCM(key).decrypt(raw[:12], raw[12:], b"zelscan-ai-key-v1").decode()
H = {"Authorization": "Bearer " + ak, "Accept": "application/json"}
aid = "yiliso-a4n0jsivmyl1"
for p in [f"https://api.fireworks.ai/v1/accounts/{aid}/quotas", f"https://api.fireworks.ai/v1/accounts/{aid}"]:
    r = requests.get(p, headers=H, timeout=20)
    print(r.status_code, p)
    print(r.text[:1500])
    print("---")
