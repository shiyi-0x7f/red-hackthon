"""检查插件目录和加载情况"""
import paramiko, json
creds = json.load(open('.deploy_creds.json', encoding='utf-8'))
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)

def run(cmd):
    print(f'\n> {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print(f'[stderr] {err}')
    return rc, out

# 检查插件目录
run('sudo docker exec astrbot ls -la /AstrBot/data/plugins/')
run('sudo docker exec astrbot ls -la /AstrBot/data/plugins/astrbot-star-math-learning/')
run('sudo docker exec astrbot cat /AstrBot/data/plugins/astrbot-star-math-learning/metadata.yaml')

# 检查AstrBot完整启动日志
run('sudo docker logs astrbot 2>&1 | tail -80 | head -40')

ssh.close()
