# AI Learning Server

> AI 自适应小学数学学习系统 — FastAPI 后端（C/S 架构）

本 server 从原 Tauri 单机应用（`src-tauri/`）剥离出的业务层，重写为 Python FastAPI。
对外提供一套 REST API：

- **`/api/v1/*`** — REST API，供以下两种客户端调用：
  - **Tauri 桌面客户端** —— 直连（替代原 Tauri Command，见 `src/services/index.ts` 的 HTTP mode）
  - **AstrBot Star 插件** —— 由 Gemini 在 `AstrBot/data/plugins/astrbot-star-math-learning/` 下实现，
    让学生通过 QQ / 微信 / 飞书 等 IM 平台使用学习系统

> **职责边界**：AstrBot 插件、`docker-compose.yml`、`server/Dockerfile` 由 Gemini 维护，见 `../dev_docs/12_分工边界_Gemini_vs_Claude.md`。
> 本 server（`server/app/*`、`routes/*`、`services/*`、`src-tauri/migrations/*.sql`、`src/services/index.ts`）由 Claude 维护。

架构细节见 `../dev_docs/11_C_S架构与AstrBot集成.md`。

---

## 快速开始

### 1. 本地开发

```bash
cd server
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，至少填入：
#   LEARNING_API_KEY=sk-your-own-secret
#   SILICONFLOW_API_KEY=sk-xxx       <- 硅基流动的 key

# 启动（默认监听 0.0.0.0:9000）
uvicorn app.main:app --reload --port 9000
```

首次启动会自动执行 `../src-tauri/migrations/*.sql` 下的所有迁移（和 Tauri 共用一套 schema）。
数据库文件默认在 `server/ai_learning.db`。

### 2. Docker

```bash
# 在仓库根目录
docker-compose up -d learning-server

# 查看日志
docker-compose logs -f learning-server

# 健康检查
curl http://localhost:9000/health
```

Docker 部署时数据库挂载在 `learning_data` 命名卷上，升级镜像数据不丢。

---

## 目录结构

```
server/
├── app/
│   ├── main.py                  # FastAPI 入口，注册所有路由
│   ├── config.py                # Settings (pydantic-settings)
│   ├── db/
│   │   ├── connection.py        # aiosqlite 连接池
│   │   └── migrations.py        # 运行 ../src-tauri/migrations/*.sql
│   ├── services/                # ← 从 Rust 1:1 移植
│   │   ├── student_model.py     # BKT + 遗忘曲线
│   │   ├── decision_engine.py   # 三层决策（硬规则 / 策略 / 内容）
│   │   ├── pacing_engine.py     # 四段节奏
│   │   ├── feature_engine.py    # 行为特征
│   │   ├── question_bank.py     # 出题策略
│   │   └── coach_engine.py      # 教练逻辑（目标 / 打卡 / 模式）
│   ├── ai/
│   │   ├── llm_client.py        # httpx 调硅基流动（OpenAI 兼容）
│   │   ├── prompts.py           # Prompt 模板（含双 Agent 讲解）
│   │   └── safety.py            # 禁用词 / 情感绑定 / 敏感内容过滤
│   ├── schemas/                 # pydantic 数据模型
│   └── routes/                  # 13 个 FastAPI 路由模块
│       ├── student.py           # 学生 CRUD
│       ├── knowledge.py         # 知识图谱
│       ├── question.py          # 出题（静态 + AI 动态）
│       ├── learning.py          # 会话 / 答题 / 总结
│       ├── explain.py           # SSE 流式讲解
│       ├── chat.py              # SSE 流式对话
│       ├── student_model.py     # 画像 / 错题 / 复习推荐
│       ├── decision.py          # 决策引擎
│       ├── pacing.py            # 节奏状态
│       ├── interests.py         # 兴趣 / 背景
│       ├── parent.py            # 家长端
│       └── settings.py          # API 配置
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── .env.example
```

---

## API

路径前缀 `/api/v1`。原 Tauri Command 一一对应为 HTTP 路由，前端
`src/services/index.ts` 里的 `HTTP_ROUTE_MAP` 是完整映射清单。

Gemini 的 AstrBot Star 插件也通过同一套 REST API 访问本 server，契约清单见
`../dev_docs/12_分工边界_Gemini_vs_Claude.md`。

### 统一响应格式

```json
{ "code": 0, "message": "ok", "data": { ... } }
```

错误：

```json
{ "code": 4xx | 5xx, "message": "...", "data": null }
```

### 鉴权

所有接口必须在 `Authorization: Bearer {LEARNING_API_KEY}` 下调用。
环境变量为默认值 `sk-ai-learning-change-me` 时放行，方便本地开发。

### 主要端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/students` | POST / GET | 学生 CRUD |
| `/api/v1/students/{id}` | GET | 学生详情 |
| `/api/v1/students/{id}/profile` | GET | 学生画像（掌握度汇总） |
| `/api/v1/students/{id}/state` | GET | 实时状态（疲劳/连错） |
| `/api/v1/students/{id}/wrong-answers` | GET | 错题本 |
| `/api/v1/students/{id}/review` | GET | 复习推荐（艾宾浩斯驱动） |
| `/api/v1/students/{id}/realtime` | GET | 6 层实时画像聚合 |
| `/api/v1/students/{id}/data` | DELETE | 清空学生学习数据 |
| `/api/v1/knowledge/tree` | GET | 知识树 |
| `/api/v1/questions/quiz` | POST | 静态出题（诊断/单元/自适应） |
| `/api/v1/questions/ai` | POST | AI 动态出题 |
| `/api/v1/sessions` | POST | 开始学习会话 |
| `/api/v1/sessions/{id}/answers` | POST | 提交答案（含 BKT 更新） |
| `/api/v1/sessions/{id}/end` | POST | 结束会话 |
| `/api/v1/sessions/{id}/summary` | POST | 生成会话总结 |
| `/api/v1/sessions/{id}/pacing` | GET | 节奏状态 |
| `/api/v1/explain/stream` | GET (SSE) | 流式讲解 |
| `/api/v1/hints` | POST | 分层提示 |
| `/api/v1/chat/stream` | POST (SSE) | 流式对话 |
| `/api/v1/chat/history` | GET | 对话历史 |
| `/api/v1/decision/next` | POST | 决策引擎 |
| `/api/v1/parent/login` | POST | 家长密码 |
| `/api/v1/parent/students/{id}/overview` | GET | 家长数据概览 |
| `/api/v1/settings/api` | GET / PUT | LLM 配置 |

OpenAPI Schema：启动后访问 http://localhost:9000/docs

---

## 验证

启动 server 后跑一遍冒烟测试：

```bash
# 1. health
curl http://localhost:9000/health

# 2. 创建学生
curl -X POST http://localhost:9000/api/v1/students \
  -H "Authorization: Bearer sk-ai-learning-change-me" \
  -H "Content-Type: application/json" \
  -d '{"name":"小明","grade":6}'

# 3. 查学生列表
curl http://localhost:9000/api/v1/students \
  -H "Authorization: Bearer sk-ai-learning-change-me"

# 4. 出题（静态题库 adaptive 模式）
curl -X POST http://localhost:9000/api/v1/questions/quiz \
  -H "Authorization: Bearer sk-ai-learning-change-me" \
  -H "Content-Type: application/json" \
  -d '{"student_id":"<上一步创建的 id>","mode":"diagnose","count":5}'

# 5. 单元测试
cd server && pytest tests/
```

---

## Rust → Python 移植对照表

所有服务模块都是 1:1 从 Rust 移植，可以对照着看：

| Rust (`src-tauri/src/`) | Python (`server/app/`) |
|---|---|
| `services/student_model.rs` | `services/student_model.py` |
| `services/decision_engine.rs` | `services/decision_engine.py` |
| `services/pacing_engine.rs` | `services/pacing_engine.py` |
| `services/feature_engine.rs` | `services/feature_engine.py` |
| `services/question_bank.rs` | `services/question_bank.py` |
| `ai/llm_client.rs` | `ai/llm_client.py` |
| `ai/prompts/mod.rs` | `ai/prompts.py` |
| `ai/safety.rs` | `ai/safety.py` |
| `commands/*.rs` | `routes/*.py` |
| `migrations/*.sql` | 直接复用（不拷贝） |

算法参数与行为完全一致（BKT 参数、遗忘曲线半衰期、决策阈值等），
两边运行结果在相同输入下应该一致。

---

## 已知限制

- **仅支持 6 年级**：题库 / 知识图谱只覆盖六年级。扩展到 1-5 年级见 roadmap。
- **IM 不能渲染 KaTeX**：OpenAI 兼容接口会把数学公式降级为纯文本 / Unicode 分数。
- **复习时间差未精确计算**：`/api/v1/students/{id}/review-recommendations` 当前用粗略的固定 hours，
  真实上线前需要完善 SQLite datetime 差值计算。
- **无 WebSocket**：流式走 SSE（OpenAI 标准），够用。
- **单租户**：一个 server 一套数据。未来加 `org_id` 支持多租户。

---

## 开发提示

- 运行时修改 Prompt：编辑 `app/ai/prompts.py`，uvicorn --reload 会自动热加载
- 切换默认 LLM 模型：改 `.env` 的 `SILICONFLOW_DEFAULT_MODEL` 或用 PUT `/api/v1/settings/api`
- 查看 OpenAPI Schema：启动后访问 http://localhost:9000/docs
- 单元测试：`pytest tests/`（待补全）
