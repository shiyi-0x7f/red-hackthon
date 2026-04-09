"""部署 cmd_config.json + 插件 + help.py"""
import paramiko, json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
creds = json.load(open(os.path.join(ROOT, '.deploy_creds.json'), encoding='utf-8'))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)
print('Connected!')

sftp = ssh.open_sftp()

# 1. cmd_config.json
src = os.path.join(ROOT, 'AstrBot', 'data', 'cmd_config.json')
dst = '/www/wwwroot/ai-learning/AstrBot/data/cmd_config.json'
print(f'  Config: cmd_config.json')
sftp.put(src, dst)

# 2. Plugin files
PLUGIN_DIR = os.path.join(ROOT, 'AstrBot', 'data', 'plugins', 'astrbot-star-math-learning')
REMOTE_PLUGIN_DIR = '/www/wwwroot/ai-learning/AstrBot/data/plugins/astrbot-star-math-learning'
for f in ['main.py', 'api_client.py', 'formatters.py', 'session_state.py']:
    print(f'  Plugin: {f}')
    sftp.put(os.path.join(PLUGIN_DIR, f), f'{REMOTE_PLUGIN_DIR}/{f}')

# 3. help.py via docker cp
help_local = os.path.join(ROOT, 'AstrBot', 'astrbot', 'builtin_stars', 'builtin_commands', 'commands', 'help.py')
sftp.put(help_local, '/tmp/help_fixed.py')
print('  Help: help.py')

sftp.close()

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if err: print(f'  {err}')
    return rc

run('sudo docker cp /tmp/help_fixed.py astrbot:/AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py')
run('sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml restart astrbot')
time.sleep(5)
run('sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml ps')

ssh.close()
print('Done!')
