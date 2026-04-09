"""Quick deploy: push server/ Python code + restart api container (no docker build)"""
import paramiko, json, os, tarfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
creds = json.loads((ROOT / ".deploy_creds.json").read_text(encoding="utf-8"))
REMOTE_DIR = creds["remote_dir"]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)
print('Connected!')

# Pack only server/ dir
archive = str(ROOT / "_server_deploy.tar.gz")
count = 0
with tarfile.open(archive, "w:gz") as tar:
    server_dir = ROOT / "server"
    for f in server_dir.rglob("*"):
        if f.is_file() and "__pycache__" not in str(f) and ".pyc" not in str(f):
            arcname = str(f.relative_to(ROOT)).replace("\\", "/")
            tar.add(str(f), arcname=arcname)
            count += 1
print(f"Packed {count} files ({os.path.getsize(archive) / 1024:.0f} KB)")

sftp = ssh.open_sftp()
sftp.put(archive, "/tmp/_server_deploy.tar.gz")
sftp.close()
os.remove(archive)
print("Uploaded!")

def run(cmd):
    print(f"  > {cmd[:100]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        for line in out.split('\n')[-8:]:
            print(f"    {line}")
    if err:
        for line in err.split('\n')[-3:]:
            print(f"    [stderr] {line}")
    return rc

# Extract server files
run(f"cd {REMOTE_DIR} && sudo tar -xzf /tmp/_server_deploy.tar.gz --no-same-owner")
run("sudo rm /tmp/_server_deploy.tar.gz")

# Copy app code into running container (Dockerfile puts it at /app/app/)
run(f"sudo docker cp {REMOTE_DIR}/server/app/. ai-learning-server:/app/app/")
# Clear pycache so Python reloads fresh
run("sudo docker exec ai-learning-server find /app -name '__pycache__' -exec rm -rf {{}} + 2>/dev/null || true")
run("sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml restart learning-server")
time.sleep(8)
run("sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml ps learning-server")

ssh.close()
print("Done!")
