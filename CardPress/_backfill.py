import json, base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = r'c:\Users\nauna\Documents\FindomAlexia\gacha-3\CardPress'
key = bytes.fromhex(open(BASE + r'\cardkey.hex').read().strip())

p = BASE + r'\cards_out.json'
entries = json.load(open(p, encoding='utf-8'))

for c in entries:
    raw = base64.b64decode(c['enc'])
    iv, ct = raw[:12], raw[12:]
    c['url'] = AESGCM(key).decrypt(iv, ct, None).decode()
    print(c['id'], '->', c['url'])

json.dump(entries, open(p, 'w', encoding='utf-8'), indent=2)
print('backfilled', len(entries), 'urls ✓')
