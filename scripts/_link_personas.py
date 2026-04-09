# -*- coding: utf-8 -*-
"""Update cmd_config.json to link agents to personas and set default"""
import json
import paramiko
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
creds = json.load(open(os.path.join(ROOT, '.deploy_creds.json'), encoding='utf-8'))

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(creds['host'], port=creds.get('port', 22), username=creds['user'], password=creds['password'], timeout=15)

sftp = ssh.open_sftp()

# Read current config
with sftp.open('/www/wwwroot/ai-learning/AstrBot/data/cmd_config.json', 'r') as f:
    config = json.loads(f.read())

# Link agents to personas
agent_names = ['quiz_agent', 'judge_agent', 'explain_agent', 'learning_analyst', 'chat_agent']
for agent in config.get('subagent_orchestrator', {}).get('agents', []):
    name = agent.get('name', '')
    if name in agent_names:
        agent['persona_id'] = name
        print(f'  {name} -> persona_id={name}')

# Set default persona
ps = config.get('provider_settings', {})
ps['default_personality'] = 'math_learning_buddy'
config['provider_settings'] = ps
print('  default -> math_learning_buddy')

# Write back
with sftp.open('/www/wwwroot/ai-learning/AstrBot/data/cmd_config.json', 'w') as f:
    f.write(json.dumps(config, ensure_ascii=False, indent=2))

sftp.close()

# Restart
print('Restarting AstrBot...')
stdin, stdout, stderr = ssh.exec_command(
    'sudo docker compose -f /www/wwwroot/ai-learning/docker-compose.yml restart astrbot',
    timeout=60,
)
stdout.channel.recv_exit_status()
print(stderr.read().decode('utf-8', errors='replace').strip())

time.sleep(5)
print('Done!')
ssh.close()
