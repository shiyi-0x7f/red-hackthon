# -*- coding: utf-8 -*-
"""Create agent personas via AstrBot WebUI API (remote)"""
import json
import os
import requests

ASTRBOT_URL = "http://150.158.18.95:6185"
USERNAME = "astrbot"
PASSWORD = "12345678"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load persona data
with open(os.path.join(ROOT, 'scripts', 'personas_data.json'), 'r', encoding='utf-8') as f:
    PERSONAS = json.load(f)

# Step 1: Login
print('Logging in...')
# AstrBot stores password as MD5 hash in config
import hashlib
pwd_hash = hashlib.md5("12345678".encode()).hexdigest()
r = requests.post(f"{ASTRBOT_URL}/api/auth/login", json={
    "username": USERNAME,
    "password": pwd_hash,
})
resp = r.json()
token = (resp.get('data') or {}).get('token', '')
if not token:
    print(f"Login failed: {resp}")
    exit(1)
print(f"  Token: {token[:30]}...")

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}

# Step 2: Create personas
print('\nCreating personas...')
for p in PERSONAS:
    pid = p['persona_id']
    r = requests.post(f"{ASTRBOT_URL}/api/persona/create", json={
        "persona_id": pid,
        "system_prompt": p['system_prompt'],
        "begin_dialogs": [],
        "tools": None,
        "skills": None,
    }, headers=headers)
    resp = r.json()
    status = resp.get('status', 'unknown')
    if status == 'ok':
        print(f"  [OK] {pid}")
    else:
        msg = resp.get('message', str(resp)[:100])
        print(f"  [!]  {pid}: {msg}")

# Step 3: Verify
print('\nVerifying...')
r = requests.get(f"{ASTRBOT_URL}/api/persona/list", headers=headers)
resp = r.json()
personas = (resp.get('data') or {}).get('personas', [])
print(f"  Total personas: {len(personas)}")
for p in personas:
    pid = p.get('persona_id', '?')
    prompt = (p.get('system_prompt') or '')[:50]
    print(f"    - {pid}: {prompt}...")

print('\nDone!')
