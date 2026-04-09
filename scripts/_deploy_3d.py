# -*- coding: utf-8 -*-
"""Deploy 3D dashboard page to AstrBot"""
import paramiko
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
creds = json.load(open(os.path.join(ROOT, '.deploy_creds.json'), encoding='utf-8'))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port', 22), username=creds['user'], password=creds['password'], timeout=15)
print('Connected!')

sftp = ssh.open_sftp()

# Upload to /tmp first
local_file = os.path.join(ROOT, 'AstrBot', 'data', 'plugins', 'astrbot-star-math-learning', '3d_dashboard.html')
sftp.put(local_file, '/tmp/3d_dashboard.html')
sftp.close()
print('  Uploaded to /tmp')

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    stdout.channel.recv_exit_status()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    if out: print(f'  {out}')
    if err: print(f'  {err}')

# Copy to plugin dir
run('sudo cp /tmp/3d_dashboard.html /www/wwwroot/ai-learning/AstrBot/data/plugins/astrbot-star-math-learning/')

# Copy into container dist folder
run('sudo docker cp /tmp/3d_dashboard.html astrbot:/AstrBot/data/dist/3d-dashboard.html')

# Also put in volume-mounted dist
run('sudo mkdir -p /www/wwwroot/ai-learning/AstrBot/data/dist')
run('sudo cp /tmp/3d_dashboard.html /www/wwwroot/ai-learning/AstrBot/data/dist/3d-dashboard.html')

ssh.close()
print(f'\nDone! Access: http://150.158.18.95:6185/3d-dashboard.html')
