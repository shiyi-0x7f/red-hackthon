"""快速部署：只更新插件文件到服务器并重启 AstrBot"""
import paramiko, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
creds = json.load(open(os.path.join(ROOT, '.deploy_creds.json'), encoding='utf-8'))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)
print('Connected!')

sftp = ssh.open_sftp()

# 需要更新的文件列表
PLUGIN_DIR = os.path.join(ROOT, 'AstrBot', 'data', 'plugins', 'astrbot-star-math-learning')
REMOTE_PLUGIN_DIR = '/www/wwwroot/ai-learning/AstrBot/data/plugins/astrbot-star-math-learning'

files_to_upload = [
    ('main.py', f'{REMOTE_PLUGIN_DIR}/main.py'),
    ('api_client.py', f'{REMOTE_PLUGIN_DIR}/api_client.py'),
    ('formatters.py', f'{REMOTE_PLUGIN_DIR}/formatters.py'),
    ('session_state.py', f'{REMOTE_PLUGIN_DIR}/session_state.py'),
]

for local_name, remote_path in files_to_upload:
    local_path = os.path.join(PLUGIN_DIR, local_name)
    if os.path.exists(local_path):
        print(f'  Uploading {local_name}...')
        sftp.put(local_path, remote_path)
    else:
        print(f'  SKIP {local_name} (not found)')

sftp.close()
print('All files uploaded!')

# 重启 AstrBot
print('\nRestarting AstrBot...')
stdin, stdout, stderr = ssh.exec_command(
    'cd /www/wwwroot/ai-learning && sudo docker compose restart astrbot',
    timeout=60,
)
rc = stdout.channel.recv_exit_status()
out = stdout.read().decode('utf-8', errors='replace').strip()
err = stderr.read().decode('utf-8', errors='replace').strip()
if out: print(f'  {out}')
if err: print(f'  {err}')

# 等待启动
import time; time.sleep(5)

# 验证启动
print('\nVerifying...')
stdin, stdout, stderr = ssh.exec_command(
    'sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml ps',
    timeout=30,
)
stdout.channel.recv_exit_status()
print(stdout.read().decode('utf-8', errors='replace').strip())

ssh.close()
print('\nDeploy complete!')
