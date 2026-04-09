"""一键部署脚本 — 推送文件到服务器并启动 Docker 服务

用法: python scripts/deploy.py
配置: .deploy_creds.json
"""
import json
import os
import stat
import sys
import tarfile
import tempfile
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("ERROR: pip install paramiko")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
CREDS_FILE = ROOT / ".deploy_creds.json"

# ── 需要部署的文件/目录 ──
DEPLOY_ITEMS = [
    # (本地相对路径, 远程相对路径, 是否目录)
    ("server", "server", True),
    ("docker-compose.yml", "docker-compose.yml", False),
    ("data", "data", True),
    ("dist", "dist", True),
    ("src-tauri/migrations", "src-tauri/migrations", True),
    ("dev_docs", "dev_docs", True),
    ("AstrBot/data/plugins/astrbot-star-math-learning", "AstrBot/data/plugins/astrbot-star-math-learning", True),
    ("AstrBot/data/cmd_config.json", "AstrBot/data/cmd_config.json", False),
    ("AstrBot/data/knowledge_base", "AstrBot/data/knowledge_base", True),
    ("AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py", "AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py", False),
    ("AstrBot/Dockerfile", "AstrBot/Dockerfile", False),
    # AstrBot Dashboard 前端构建产物
    ("AstrBot/dashboard/dist", "AstrBot/data/dist", True),
]

# ── 打包时排除的文件 ──
EXCLUDE_PATTERNS = {
    ".venv", "__pycache__", "*.pyc", "*.db", "node_modules",
    ".git", ".DS_Store", "Thumbs.db",
}


def should_exclude(path: str) -> bool:
    parts = Path(path).parts
    for p in parts:
        if p in EXCLUDE_PATTERNS:
            return True
        for pat in EXCLUDE_PATTERNS:
            if pat.startswith("*") and p.endswith(pat[1:]):
                return True
    return False


def create_archive(items: list, root: Path) -> str:
    """打包部署文件为 tar.gz"""
    archive_path = str(root / "_deploy.tar.gz")
    file_count = 0

    with tarfile.open(archive_path, "w:gz") as tar:
        for local_rel, remote_rel, is_dir in items:
            local_path = root / local_rel
            if not local_path.exists():
                print(f"  SKIP (not found): {local_rel}")
                continue

            if is_dir:
                for file in local_path.rglob("*"):
                    if file.is_file():
                        rel = file.relative_to(root)
                        if should_exclude(str(rel)):
                            continue
                        arcname = str(rel).replace("\\", "/")
                        tar.add(str(file), arcname=arcname)
                        file_count += 1
            else:
                arcname = local_rel.replace("\\", "/")
                tar.add(str(local_path), arcname=arcname)
                file_count += 1

    print(f"  Packed {file_count} files ({os.path.getsize(archive_path) / 1024:.0f} KB)")
    return archive_path


def deploy(creds: dict, archive_path: str):
    """SSH 上传并在服务器上解压 + docker compose up"""
    host = creds["host"]
    port = creds.get("port", 22)
    user = creds["user"]
    password = creds["password"]
    remote_dir = creds["remote_dir"]

    print(f"\n  Connecting to {user}@{host}:{port}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, port=port, username=user, password=password, timeout=15)

    # SFTP 上传
    print(f"  Uploading archive...")
    sftp = ssh.open_sftp()
    remote_tmp = "/tmp/_deploy.tar.gz"
    sftp.put(archive_path, remote_tmp)
    sftp.close()
    print("  Upload complete.")

    # 远程执行: 解压 + docker compose
    commands = [
        f"sudo mkdir -p {remote_dir}",
        f"cd {remote_dir} && sudo tar -xzf {remote_tmp} --no-same-owner",
        f"sudo rm {remote_tmp}",
        # 创建 .env（如果不存在）
        f"cd {remote_dir}/server && [ ! -f .env ] && sudo cp .env.example .env || echo '.env exists'",
        # Docker Compose 构建并启动
        f"cd {remote_dir} && sudo docker compose up -d --build",
    ]

    for cmd in commands:
        print(f"\n  > {cmd[:80]}...")
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=300)
        exit_code = stdout.channel.recv_exit_status()
        out = stdout.read().decode("utf-8", errors="replace").strip()
        err = stderr.read().decode("utf-8", errors="replace").strip()

        if out:
            for line in out.split("\n")[-10:]:
                print(f"    {line}")
        if err:
            for line in err.split("\n")[-5:]:
                print(f"    [stderr] {line}")

        if exit_code != 0 and "docker" in cmd:
            print(f"  ⚠️  Command exited with code {exit_code}")

    ssh.close()


def main():
    print("=" * 50)
    print("  AI Learning System - One-Click Deploy")
    print("=" * 50)

    if not CREDS_FILE.exists():
        print(f"\nERROR: {CREDS_FILE} not found.")
        print("Create it with: host, port, user, password, remote_dir")
        sys.exit(1)

    creds = json.loads(CREDS_FILE.read_text(encoding="utf-8"))
    print(f"\nTarget: {creds['user']}@{creds['host']}:{creds['remote_dir']}")

    print("\n[1/2] Packing files...")
    archive = create_archive(DEPLOY_ITEMS, ROOT)

    print("\n[2/2] Deploying to server...")
    deploy(creds, archive)

    # 清理
    os.remove(archive)

    print("\n" + "=" * 50)
    print("  [OK] Deploy complete!")
    print("=" * 50)
    print(f"\nServices should be running at:")
    print(f"  Frontend: http://{creds['host']}:9100/")
    print(f"  API:      http://{creds['host']}:9100/health")
    print(f"  AstrBot:  http://{creds['host']}:6185")
    print(f"\nTo check logs:")
    print(f"  ssh {creds['user']}@{creds['host']}")
    print(f"  cd {creds['remote_dir']} && docker compose logs -f")


if __name__ == "__main__":
    main()
