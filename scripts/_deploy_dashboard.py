# -*- coding: utf-8 -*-
"""Quick deploy: just the AstrBot dashboard dist files (v2 — restart container)"""
import json, os, sys, tarfile
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("ERROR: pip install paramiko"); sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
creds = json.loads((ROOT / ".deploy_creds.json").read_text(encoding="utf-8"))

# Pack dashboard dist
dist_dir = ROOT / "AstrBot" / "dashboard" / "dist"
if not dist_dir.exists():
    print("ERROR: dashboard dist not found, run npm run build first"); sys.exit(1)

archive = str(ROOT / "_dash_deploy.tar.gz")
count = 0
with tarfile.open(archive, "w:gz") as tar:
    for f in dist_dir.rglob("*"):
        if f.is_file():
            arcname = "AstrBot/data/dist/" + str(f.relative_to(dist_dir)).replace("\\", "/")
            tar.add(str(f), arcname=arcname)
            count += 1
print(f"Packed {count} files ({os.path.getsize(archive) / 1024:.0f} KB)")

# SSH upload
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds["host"], port=creds.get("port", 22), username=creds["user"], password=creds["password"], timeout=15)
print("Connected!")

sftp = ssh.open_sftp()
sftp.put(archive, "/tmp/_dash.tar.gz")
sftp.close()
print("Uploaded!")

remote_dir = creds["remote_dir"]

def run(cmd):
    print(f"> {cmd[:100]}...")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(f"  {out}")
    if err and rc != 0: print(f"  [ERR] {err}")
    return rc

# 1. 解压到远程目录 (volume mount)
run(f"cd {remote_dir} && sudo tar -xzf /tmp/_dash.tar.gz --no-same-owner")
run("sudo rm -f /tmp/_dash.tar.gz")

# 2. 重启 astrbot 容器 (会重新挂载 volume,获取新的 dist)
print("\nRestarting astrbot container...")
run("sudo docker restart astrbot")

ssh.close()
os.remove(archive)
print(f"\nDone! Access: http://{creds['host']}:6185/#/agent-3d")
