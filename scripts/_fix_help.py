"""修复 help.py: 将比赛版 help.py 复制进 AstrBot 容器"""
import paramiko, json, sys, io

creds = json.load(open('.deploy_creds.json', encoding='utf-8'))
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)
print('Connected!')

def run(cmd):
    print(f'\n> {cmd[:120]}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: 
        for line in out.split('\n')[-15:]:
            print(line)
    if err: 
        for line in err.split('\n')[-5:]:
            print(f'[stderr] {line}')
    return rc, out, err

# 方案: 通过 docker cp 将本地改好的 help.py 上传到服务器再复制进容器
# 先把文件内容上传到 /tmp
help_py = open('AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py', 'r', encoding='utf-8').read()
sftp = ssh.open_sftp()
with sftp.open('/tmp/help_fixed.py', 'w') as f:
    f.write(help_py)
sftp.close()
print('Uploaded help.py to /tmp/help_fixed.py')

# docker cp 进容器
run('sudo docker cp /tmp/help_fixed.py astrbot:/AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py')

# 验证
run('sudo docker exec astrbot head -20 /AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py')

# 重启 AstrBot 使改动生效
run('sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml restart astrbot')

# 等几秒后查看日志
import time; time.sleep(5)
run('sudo docker logs astrbot --tail 20 2>&1 | head -20')

# 最终验证
run('sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml ps')

ssh.close()
print('\nAll done!')
