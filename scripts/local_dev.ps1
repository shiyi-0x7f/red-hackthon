# ============================================================
# AI Learning System - 本地一键启动脚本 (PowerShell)
# ============================================================
# 用法: .\scripts\local_dev.ps1
#   - 自动创建 Python 虚拟环境
#   - 安装依赖
#   - 创建 .env 文件（如不存在）
#   - 启动 learning-server
# ============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $ProjectRoot) {
    $ProjectRoot = (Get-Location).Path
}

$ServerDir = Join-Path $ProjectRoot "server"
$VenvDir = Join-Path $ServerDir ".venv"
$EnvFile = Join-Path $ServerDir ".env"
$EnvExample = Join-Path $ServerDir ".env.example"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AI Learning System - Local Dev Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Python 虚拟环境 ---
Write-Host "[1/4] Checking Python virtual environment..." -ForegroundColor Yellow

if (-not (Test-Path $VenvDir)) {
    Write-Host "  Creating venv at $VenvDir" -ForegroundColor Gray
    python -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Failed to create venv. Is Python installed?" -ForegroundColor Red
        exit 1
    }
    Write-Host "  venv created." -ForegroundColor Green
} else {
    Write-Host "  venv already exists." -ForegroundColor Green
}

# 激活虚拟环境
$ActivateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
if (-not (Test-Path $ActivateScript)) {
    Write-Host "  ERROR: Cannot find venv activate script." -ForegroundColor Red
    exit 1
}
. $ActivateScript

# --- Step 2: 安装依赖 ---
Write-Host "[2/4] Installing Python dependencies..." -ForegroundColor Yellow
pip install -r (Join-Path $ServerDir "requirements.txt") -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -q
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: pip install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  Dependencies installed." -ForegroundColor Green

# --- Step 3: .env 文件 ---
Write-Host "[3/4] Checking .env configuration..." -ForegroundColor Yellow

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "  Created .env from .env.example" -ForegroundColor Green
        Write-Host "  NOTE: Please edit $EnvFile to set SILICONFLOW_API_KEY" -ForegroundColor Magenta
    } else {
        # 创建最小 .env
        @"
SERVER_HOST=0.0.0.0
SERVER_PORT=9000
LOG_LEVEL=INFO
DATABASE_URL=sqlite:///./ai_learning.db
MIGRATIONS_DIR=../src-tauri/migrations
LEARNING_API_KEY=sk-ai-learning-change-me
SILICONFLOW_API_BASE=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=
SILICONFLOW_DEFAULT_MODEL=deepseek-ai/DeepSeek-V3
CORS_ORIGINS=http://localhost:1420,http://localhost:5173
DATA_DIR=../data
"@ | Out-File -FilePath $EnvFile -Encoding utf8
        Write-Host "  Created minimal .env file" -ForegroundColor Green
    }
} else {
    Write-Host "  .env already exists." -ForegroundColor Green
}

# --- Step 4: 启动服务器 ---
Write-Host "[4/4] Starting learning server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Server URL:  http://localhost:9000" -ForegroundColor Cyan
Write-Host "  Health:      http://localhost:9000/health" -ForegroundColor Cyan
Write-Host "  API Docs:    http://localhost:9000/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

Set-Location $ServerDir
uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload
