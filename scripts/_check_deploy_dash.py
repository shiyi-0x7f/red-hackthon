# -*- coding: utf-8 -*-
"""Verify container sees new files and check index.html"""
import json, os, sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("ERROR: pip install paramiko"); sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
creds = json.loads((ROOT / ".deploy_creds.json").read_text(encoding="utf-8"))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds["host"], port=creds.get("port", 22), username=creds["user"], password=creds["password"], timeout=15)
print("Connected!")

def run(cmd):
    print(f"\n> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out)
    if err: print(f"[ERR] {err}")
    return out

# 1. Check which Agent3D chunks the index.html references
print("=== Host index.html Agent3D references ===")
run("grep -o 'Agent3D[^\"]*' /www/wwwroot/ai-learning/AstrBot/data/dist/index.html")

# 2. Check in container
print("\n=== Container listing dist ===")
run("sudo docker exec astrbot ls /AstrBot/data/dist/assets/ | grep Agent3D")

# 3. Check container index.html
print("\n=== Container index.html Agent3D references ===")
run("sudo docker exec astrbot grep -o 'Agent3D[^\"]*' /AstrBot/data/dist/index.html")

# 4. Check if OLD index.html exists elsewhere in container
print("\n=== Check for other dist locations ===")
run("sudo docker exec astrbot find / -name 'index.html' -path '*/dist/*' 2>/dev/null | head -10")

# 5. Is astrbot running?
print("\n=== Container status ===")
run("sudo docker ps | grep astrbot")

ssh.close()
