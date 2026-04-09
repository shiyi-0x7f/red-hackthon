# ============================================================
# 部署脚本 - 推送服务端文件到远程服务器
# ============================================================
# 用法: .\scripts\deploy.ps1

$ErrorActionPreference = "Stop"

$RemoteHost = "150.158.18.95"
$RemoteUser = "ubuntu"
$RemoteDir = "/www/wwwroot/ai-learning"
$LocalRoot = Split-Path -Parent $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Deploy to $RemoteHost" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# --- Step 1: 打包需要部署的文件 ---
Write-Host "`n[1/3] Packing files..." -ForegroundColor Yellow

$PackDir = Join-Path $LocalRoot "_deploy_pack"
if (Test-Path $PackDir) { Remove-Item $PackDir -Recurse -Force }
New-Item $PackDir -ItemType Directory -Force | Out-Null

# server/
Copy-Item (Join-Path $LocalRoot "server") (Join-Path $PackDir "server") -Recurse
# 排除 .venv 和 .db
Remove-Item (Join-Path $PackDir "server\.venv") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir "server\*.db") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $PackDir "server\.env") -Force -ErrorAction SilentlyContinue

# docker-compose.yml
Copy-Item (Join-Path $LocalRoot "docker-compose.yml") $PackDir

# AstrBot 插件
$pluginDest = Join-Path $PackDir "AstrBot\data\plugins\astrbot-star-math-learning"
New-Item $pluginDest -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $LocalRoot "AstrBot\data\plugins\astrbot-star-math-learning\*") $pluginDest -Recurse

# data/ 题库
Copy-Item (Join-Path $LocalRoot "data") (Join-Path $PackDir "data") -Recurse

# migrations
$migDest = Join-Path $PackDir "src-tauri\migrations"
New-Item $migDest -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $LocalRoot "src-tauri\migrations\*.sql") $migDest

# dev_docs (可选，方便在服务器上参考)
Copy-Item (Join-Path $LocalRoot "dev_docs") (Join-Path $PackDir "dev_docs") -Recurse

Write-Host "  Packed files:" -ForegroundColor Gray
Get-ChildItem $PackDir -Recurse -File | Measure-Object | ForEach-Object { Write-Host "    $($_.Count) files" -ForegroundColor Gray }

# --- Step 2: 压缩成 tar.gz ---
$ZipFile = Join-Path $LocalRoot "_deploy.tar.gz"
if (Test-Path $ZipFile) { Remove-Item $ZipFile -Force }

Write-Host "`n[2/3] Compressing..." -ForegroundColor Yellow
Push-Location $PackDir
tar -czf $ZipFile *
Pop-Location

$sizeMB = [math]::Round((Get-Item $ZipFile).Length / 1MB, 1)
Write-Host "  Archive: $sizeMB MB" -ForegroundColor Gray

# --- Step 3: SCP + SSH 部署 ---
Write-Host "`n[3/3] Uploading to server..." -ForegroundColor Yellow
Write-Host "  Target: ${RemoteUser}@${RemoteHost}:${RemoteDir}" -ForegroundColor Gray
Write-Host "  You will be prompted for SSH password." -ForegroundColor Magenta

# 创建远程目录 + 上传
ssh -o StrictHostKeyChecking=no "${RemoteUser}@${RemoteHost}" "sudo mkdir -p ${RemoteDir}"
scp -o StrictHostKeyChecking=no $ZipFile "${RemoteUser}@${RemoteHost}:/tmp/_deploy.tar.gz"
ssh -o StrictHostKeyChecking=no "${RemoteUser}@${RemoteHost}" @"
cd ${RemoteDir}
sudo tar -xzf /tmp/_deploy.tar.gz --no-same-owner
sudo rm /tmp/_deploy.tar.gz
echo 'Files deployed to ${RemoteDir}'
ls -la
"@

# 清理本地临时文件
Remove-Item $PackDir -Recurse -Force
Remove-Item $ZipFile -Force

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps on server:" -ForegroundColor Yellow
Write-Host "  1. cd ${RemoteDir}" -ForegroundColor Gray
Write-Host "  2. cp server/.env.example server/.env" -ForegroundColor Gray
Write-Host "  3. vim server/.env  # fill in SILICONFLOW_API_KEY" -ForegroundColor Gray
Write-Host "  4. docker compose up -d --build" -ForegroundColor Gray
