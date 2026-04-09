# -*- coding: utf-8 -*-
import json, paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
creds = json.loads((ROOT / ".deploy_creds.json").read_text(encoding="utf-8"))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds["host"], port=creds.get("port", 22), username=creds["user"], password=creds["password"], timeout=15)
print("Connected!")

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    stdout.channel.recv_exit_status()
    return stdout.read().decode().strip()

# Which main bundle does index.html reference?
r = run("grep -oP 'index-[a-zA-Z0-9_-]+\\.js' /www/wwwroot/ai-learning/AstrBot/data/dist/index.html | head -3")
print(f"index.html references: {r}")

# Which index bundle has the NEW chunk name?
r = run("grep -rl CUQWRDET /www/wwwroot/ai-learning/AstrBot/data/dist/assets/index-*.js 2>/dev/null")
print(f"NEW chunk referenced by: {r}")

r = run("grep -rl RUXUnivl /www/wwwroot/ai-learning/AstrBot/data/dist/assets/index-*.js 2>/dev/null")
print(f"OLD chunk referenced by: {r}")

# List index bundles
r = run("ls -la /www/wwwroot/ai-learning/AstrBot/data/dist/assets/index-*.js")
print(f"Index bundles:\n{r}")

# Check index.html modification time
r = run("ls -la /www/wwwroot/ai-learning/AstrBot/data/dist/index.html")
print(f"index.html: {r}")

ssh.close()
