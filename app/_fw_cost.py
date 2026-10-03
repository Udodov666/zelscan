import base64, sqlite3, json, datetime, requests
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(r"C:\Users\domas\claude222\zelscass")
key = (ROOT / ".admin_master_key").read_bytes()
conn = sqlite3.connect(ROOT / "zelscan.db")
raw = base64.urlsafe_b64decode(conn.execute("SELECT encrypted_key FROM ai_providers WHERE id='pr_fireworks'").fetchone()[0])
ak = AESGCM(key).decrypt(raw[:12], raw[12:], b"zelscan-ai-key-v1").decode()
H = {"Authorization": "Bearer " + ak, "Accept": "application/json"}
aid = "yiliso-a4n0jsivmyl1"

end = datetime.date.today() + datetime.timedelta(days=1)
start = end - datetime.timedelta(days=31)
body = {
    "startTime": start.strftime("%Y-%m-%dT00:00:00Z"),
    "endTime": end.strftime("%Y-%m-%dT00:00:00Z"),
    "scope": "ACCOUNT",
    "groupBy": ["DAY"],
}
r = requests.post(f"https://api.fireworks.ai/v1/accounts/{aid}/usageCosts:query", json=body, headers=H, timeout=25)
print(r.status_code)
print(json.dumps(r.json(), ensure_ascii=False)[:1500] if r.status_code == 200 else r.text[:500])
