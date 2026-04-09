# ============================================================
# AI Learning System - API 冒烟测试脚本 (PowerShell)
# ============================================================
# 用法: .\scripts\test_api.ps1
# 前提: server 已在 http://localhost:9000 运行
# ============================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$BaseUrl = "http://localhost:9000"
$ApiKey = "sk-ai-learning-change-me"
$Headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type"  = "application/json"
}

$pass = 0
$fail = 0
$total = 0

function Test-API {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Url,
        [string]$Body = ""
    )
    $script:total++
    Write-Host -NoNewline "  [$script:total] $Name ... "

    try {
        $params = @{
            Uri     = "$BaseUrl$Url"
            Method  = $Method
            Headers = $Headers
            TimeoutSec = 10
            UseBasicParsing = $true
        }
        if ($Body) {
            $params["Body"] = [System.Text.Encoding]::UTF8.GetBytes($Body)
        }

        $resp = Invoke-WebRequest @params -ErrorAction Stop
        $data = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue

        Write-Host "PASS ($($resp.StatusCode))" -ForegroundColor Green
        $script:pass++
        return $data
    } catch {
        $errMsg = $_.Exception.Message
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            Write-Host "FAIL ($statusCode - $errMsg)" -ForegroundColor Red
        } else {
            Write-Host "FAIL ($errMsg)" -ForegroundColor Red
        }
        $script:fail++
        return $null
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AI Learning System - API Smoke Test" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Health Check ──
Write-Host "[Health]" -ForegroundColor Yellow
$health = Test-API -Name "GET /health" -Method "GET" -Url "/health"

# ── 2. Student CRUD ──
Write-Host "[Students]" -ForegroundColor Yellow
Test-API -Name "GET /students (list)" -Method "GET" -Url "/api/v1/students" | Out-Null

$createBody = '{"name":"smoke_test_student","grade":6,"avatar":"student_boy"}'
$created = Test-API -Name "POST /students (create)" -Method "POST" -Url "/api/v1/students" -Body $createBody
$studentId = ""
if ($created) {
    $studentId = $created.data.id
    Write-Host "    -> student_id = $studentId" -ForegroundColor DarkGray
}

if ($studentId) {
    Test-API -Name "GET /students/{id}" -Method "GET" -Url "/api/v1/students/$studentId" | Out-Null
}

# ── 3. Knowledge Tree ──
Write-Host "[Knowledge]" -ForegroundColor Yellow
Test-API -Name "GET /knowledge/tree" -Method "GET" -Url "/api/v1/knowledge/tree?grade=6" | Out-Null

# ── 4. Session ──
Write-Host "[Session]" -ForegroundColor Yellow
$sessionId = ""
if ($studentId) {
    $sessionBody = '{"student_id":"' + $studentId + '"}'
    $session = Test-API -Name "POST /sessions (start)" -Method "POST" -Url "/api/v1/sessions" -Body $sessionBody
    if ($session) {
        $sessionId = $session.data.session_id
        Write-Host "    -> session_id = $sessionId" -ForegroundColor DarkGray
    }
}

# ── 5. Quiz Generation ──
Write-Host "[Questions]" -ForegroundColor Yellow
$questionId = ""
if ($studentId) {
    $quizBody = '{"student_id":"' + $studentId + '","mode":"adaptive","count":1}'
    $quiz = Test-API -Name "POST /questions/quiz" -Method "POST" -Url "/api/v1/questions/quiz" -Body $quizBody
    if ($quiz -and $quiz.data.questions.Count -gt 0) {
        $questionId = $quiz.data.questions[0].id
        $answer = $quiz.data.questions[0].answer_latex
        Write-Host "    -> question_id = $questionId" -ForegroundColor DarkGray
        Write-Host "    -> answer = $answer" -ForegroundColor DarkGray
    }
}

# ── 6. Submit Answer ──
Write-Host "[Answer]" -ForegroundColor Yellow
if ($sessionId -and $questionId) {
    $answerBody = '{"session_id":"' + $sessionId + '","question_id":"' + $questionId + '","student_answer":"6","time_spent_secs":10}'
    Test-API -Name "POST /sessions/{id}/answers" -Method "POST" -Url "/api/v1/sessions/$sessionId/answers" -Body $answerBody | Out-Null
} else {
    Write-Host "  [SKIP] No session/question" -ForegroundColor DarkYellow
}

# ── 7. Student Model ──
Write-Host "[Student Model]" -ForegroundColor Yellow
if ($studentId) {
    Test-API -Name "GET /students/{id}/overview" -Method "GET" -Url "/api/v1/students/$studentId/overview" | Out-Null
    Test-API -Name "GET /students/{id}/review" -Method "GET" -Url "/api/v1/students/$studentId/review" | Out-Null
}

# ── 8. Decision ──
Write-Host "[Decision]" -ForegroundColor Yellow
if ($studentId) {
    $decBody = '{"student_id":"' + $studentId + '"}'
    Test-API -Name "POST /decision/next" -Method "POST" -Url "/api/v1/decision/next" -Body $decBody | Out-Null
}

# ── 9. End Session ──
Write-Host "[End Session]" -ForegroundColor Yellow
if ($sessionId) {
    $endBody = '{"reason":"test_end"}'
    Test-API -Name "POST /sessions/{id}/end" -Method "POST" -Url "/api/v1/sessions/$sessionId/end" -Body $endBody | Out-Null
}

# ── Result ──
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
if ($fail -eq 0) {
    Write-Host "  ALL PASS: $pass/$total" -ForegroundColor Green
} else {
    Write-Host "  Results: $pass PASS / $fail FAIL / $total TOTAL" -ForegroundColor Red
}
Write-Host "============================================" -ForegroundColor Cyan

if ($fail -gt 0) { exit 1 }
