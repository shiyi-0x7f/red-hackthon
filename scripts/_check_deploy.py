"""快速检查并修复 AstrBot 容器的部署状态"""
import paramiko, json, sys

creds = json.load(open('.deploy_creds.json', encoding='utf-8'))
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port',22), username=creds['user'], password=creds['password'], timeout=15)
print('Connected!')

def run(cmd):
    print(f'\n> {cmd[:100]}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: print(out)
    if err: print(f'[stderr] {err}')
    return rc, out, err

# 1. 检查挂载
run('sudo docker inspect astrbot --format="{{range .Mounts}}{{.Source}} -> {{.Destination}}\n{{end}}"')

# 2. 检查 cmd_config.json 中 subagent 是否启用
run('sudo docker exec astrbot grep -c "main_enable.*true" /AstrBot/data/cmd_config.json')

# 3. 检查知识库文件
run('sudo docker exec astrbot ls -la /AstrBot/data/knowledge_base/')

# 4. 检查插件
run('sudo docker exec astrbot ls /AstrBot/data/plugins/astrbot-star-math-learning/')

# 5. 检查 help.py 是否是我们改过的（比赛版）
run('sudo docker exec astrbot grep -c "比赛版" /AstrBot/astrbot/builtin_stars/builtin_commands/commands/help.py')

# 6. 查看 AstrBot 最近日志
run('sudo docker logs astrbot --tail 30')

ssh.close()
print('\nDone!')
