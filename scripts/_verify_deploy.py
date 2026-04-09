"""验证部署：检查 AstrBot 日志确认插件加载"""
import paramiko, json, time

creds = json.load(open('.deploy_creds.json', encoding='utf-8'))
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)

# 等几秒让 AstrBot 完全启动
time.sleep(3)

# 检查日志
stdin, stdout, stderr = ssh.exec_command(
    'sudo docker logs astrbot --tail 30 2>&1 | grep -E "(star_manager|Plugin|Error|error|math)" | head -20',
    timeout=30,
)
stdout.channel.recv_exit_status()
out = stdout.read().decode('utf-8', errors='replace').strip()
print('=== AstrBot Logs (filtered) ===')
print(out if out else '(no matching lines)')

# 检查后端 API 可达
stdin, stdout, stderr = ssh.exec_command(
    'curl -s http://localhost:9100/health | head -5',
    timeout=10,
)
stdout.channel.recv_exit_status()
out = stdout.read().decode('utf-8', errors='replace').strip()
print(f'\n=== Backend Health ===\n{out}')

# 检查 AstrBot 内部能否访问 learning-server
stdin, stdout, stderr = ssh.exec_command(
    'sudo docker exec astrbot python3 -c "import httpx; r=httpx.get(\'http://learning-server:9000/health\', timeout=5); print(r.status_code, r.text[:100])" 2>&1',
    timeout=15,
)
stdout.channel.recv_exit_status()
out = stdout.read().decode('utf-8', errors='replace').strip()
print(f'\n=== AstrBot -> Backend connectivity ===\n{out}')

ssh.close()
print('\nVerification done!')
