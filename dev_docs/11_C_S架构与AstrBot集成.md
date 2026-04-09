# C/S 架构与 AstrBot 集成设计

> **目标**：把当前 Tauri 单机应用重构为 C/S 架构，后端用 Python FastAPI 实现，同时接入 AstrBot 让小学生既可以用 Tauri 桌面端，也可以通过 QQ/微信/飞书等 IM 平台使用学习系统。

> **⚠️ 集成方式更新（2026-04）**：AstrBot 接入从原方案「Custom LLM Provider（OpenAI 兼容 endpoint）」改为
> **Star 插件方案**。插件由 Gemini 在 `AstrBot/data/plugins/astrbot-star-math-learning/` 下实现，
> 通过 HTTP 调用 server 的 `/api/v1/*` REST API。本文档第 3.2 / 第 7 节的相关描述已过时，保留仅作历史参考；
> 职责划分与 API 契约以 `dev_docs/12_分工边界_Gemini_vs_Claude.md` 为准。
>
> 变更影响：
> - server 端 `openai_compat` 路由、`nlu/` 意图路由器、相关 test 已删除
> - `/v1/chat/completions` endpoint 不再提供
> - Server 只对外暴露 `/api/v1/*` 一套 REST API
> - `coach_engine.py` 保留为 service，暂无对应路由（等 Gemini 插件需要时再加）

---

## 1. 背景与动机

当前 modest-rhodes 分支是一个 Tauri 单机应用：

- 前端（React）通过 `@tauri-apps/api/core::invoke` 调用 Rust Command
- Rust Command 层直接读写本地 SQLite、调用硅基流动 LLM API
- 所有状态保存在每台机器本地

问题：
1. 无法在多端同步（学生换机、家长远程查看）
2. 无法让学生通过 IM 平台（QQ/微信/飞书）使用
3. 学习数据孤岛，无法集中做二次分析
4. AstrBot 已有成熟的多平台 IM 适配能力，但当前架构无法对接

目标架构：

```
┌──────────────────┐         ┌──────────────────┐
│  Tauri Client    │         │   AstrBot        │
│  (桌面/应用端)    │         │   (QQ/微信/飞书)  │
└────────┬─────────┘         └────────┬─────────┘
         │ HTTP REST                  │ Star 插件
         │ /api/v1/*                  │ HTTP REST /api/v1/*
         ▼                            ▼
┌────────────────────────────────────────────────┐
│        Python FastAPI 学习服务器 (S)            │
│                                                 │
│  /api/v1/*  ←  业务 REST（一一对应原 Tauri Cmd）│
│                                                 │
│  Services：BKT / Decision / Pacing / Feature   │
│           / QuestionBank / Explain / Coach     │
│                                                 │
│  SQLite（复用 src-tauri/migrations 的 16 张表） │
│  LLM：硅基流动 API（复用）                      │
└────────────────────────────────────────────────┘
```

关键原则：**以数学产品为主，教练逻辑作为其中一个模块**。设目标/打卡/切换模式等教练功能，作为 NLU 路由的一个分支加入，不喧宾夺主。

---

## 2. 目录布局

在现有 worktree 根目录下新增 `server/` 子项目，原有的 `src/` 和 `src-tauri/` 保持不动：

```
modest-rhodes/
├── src/                              # React 前端（保留，改造 services/index.ts）
├── src-tauri/                        # Tauri Rust 后端（保留，只作为 IPC 入口）
├── data/                             # 题库/知识图谱 JSON（共享）
├── dev_docs/
│   └── 11_C_S架构与AstrBot集成.md   # 本文档
├── server/                           # 🆕 Python FastAPI 学习服务器
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── .env.example
│   ├── README.md
│   ├── Dockerfile
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI entry
│   │   ├── config.py                 # Settings (pydantic-settings)
│   │   ├── db/
│   │   │   ├── connection.py         # aiosqlite 连接池
│   │   │   └── migrations.py         # 运行 src-tauri/migrations/*.sql
│   │   ├── services/                 # ← 从 Rust 移植
│   │   │   ├── student_model.py      # BKT + 遗忘曲线
│   │   │   ├── decision_engine.py    # 三层决策
│   │   │   ├── pacing_engine.py      # 四段节奏
│   │   │   ├── feature_engine.py     # 行为特征
│   │   │   ├── question_bank.py      # 出题
│   │   │   └── coach_engine.py       # 教练逻辑（目标/计划/打卡/模式）
│   │   ├── ai/
│   │   │   ├── llm_client.py         # httpx 调硅基流动
│   │   │   ├── prompts.py            # Prompt 模板
│   │   │   └── safety.py             # Prompt 安全过滤
│   │   ├── schemas/                  # pydantic 模型
│   │   │   ├── student.py
│   │   │   ├── question.py
│   │   │   ├── session.py
│   │   │   └── ...
│   │   ├── routes/                   # FastAPI 路由（对应原 Tauri Commands）
│   │   │   ├── student.py
│   │   │   ├── knowledge.py
│   │   │   ├── question.py
│   │   │   ├── learning.py
│   │   │   ├── explain.py            # SSE
│   │   │   ├── chat.py               # SSE
│   │   │   ├── student_model.py
│   │   │   ├── decision.py
│   │   │   ├── pacing.py
│   │   │   ├── parent.py
│   │   │   ├── interests.py
│   │   │   └── settings.py
│   │   │   # openai_compat.py / nlu/ 已删除（改用 Star 插件方案）
│   ├── migrations/                   # 符号链接或拷贝 src-tauri/migrations/*.sql
│   └── tests/
├── AstrBot/                          # AstrBot 源码（IM 网关）
│   └── data/plugins/
│       └── astrbot-star-math-learning/  # 🆕 Star 插件（Gemini 实现）
│           ├── main.py               # 指令注册 + handler
│           ├── api_client.py         # 调 server REST API
│           ├── session_state.py      # IM 用户 → 学生映射
│           ├── formatters.py         # LaTeX 降级 + 消息格式化
│           └── metadata.yaml
└── docker-compose.yml                # 🆕 一键拉起 server + AstrBot
```

---

## 3. HTTP API 契约

### 3.1 REST API（供 Tauri 客户端）

路径前缀：`/api/v1`

对应关系（原 Tauri Command → HTTP Route）：

| 原 Tauri Command | HTTP Method + Path | 说明 |
|---|---|---|
| `create_student` / `get_student` / `list_students` | POST/GET `/api/v1/students` | 学生 CRUD |
| `get_knowledge_tree` | GET `/api/v1/knowledge/tree?grade={n}` | 知识树 |
| `generate_quiz` | POST `/api/v1/questions/quiz` | 静态/自适应出题 |
| `generate_ai_question` | POST `/api/v1/questions/ai` | LLM 动态出题 |
| `get_question_bank_overview` | GET `/api/v1/questions/overview` | 题库统计 |
| `start_session` | POST `/api/v1/sessions` | 开始会话 |
| `submit_answer` | POST `/api/v1/sessions/{id}/answers` | 提交答案 |
| `end_session` | POST `/api/v1/sessions/{id}/end` | 结束会话 |
| `generate_session_summary` | POST `/api/v1/sessions/{id}/summary` | 会话总结 |
| `clear_student_data` | DELETE `/api/v1/students/{id}/data` | 清空学生数据 |
| `generate_explanation_stream` | GET `/api/v1/explain/stream` (SSE) | 流式讲解 |
| `get_layered_hint` | POST `/api/v1/hints` | 分层提示 |
| `get_next_action` | POST `/api/v1/decision/next` | 决策下一步 |
| `get_pacing_status` | GET `/api/v1/sessions/{id}/pacing` | 节奏状态 |
| `send_chat_message_stream` | POST `/api/v1/chat/stream` (SSE) | 流式对话 |
| `get_chat_history` | GET `/api/v1/chat/history?student_id={}` | 对话历史 |
| `get_student_profile` / `get_student_state` / `get_wrong_answers` / `get_profile_overview` / `get_review_recommendations` / `get_realtime_profile` | GET `/api/v1/students/{id}/...` | 学生模型查询 |
| `list_interests` / `add_interest` / `delete_interest` / `extract_interests_from_text` / `get_student_background` / `update_student_background` | `/api/v1/students/{id}/interests` / `/background` | 兴趣 |
| `verify_parent_password` / `set_parent_password` / `get_learning_overview` | `/api/v1/parent/*` | 家长端 |
| `get_api_settings` / `update_api_settings` | GET/PUT `/api/v1/settings/api` | 设置 |

统一响应格式：

```json
{
  "code": 0,
  "message": "ok",
  "data": { ... }
}
```

错误：

```json
{
  "code": 4xx|5xx,
  "message": "人类可读错误",
  "data": null
}
```

### 3.2 OpenAI 兼容接口（供 AstrBot）

路径：`POST /v1/chat/completions`

**这是 AstrBot 集成的关键**。学习服务器伪装成一个 OpenAI 兼容 LLM，AstrBot 把它当作 Provider 配置，所有 IM 消息都会流经这里。

请求体（OpenAI 标准）：
```json
{
  "model": "math-learning-v1",
  "messages": [
    {"role": "user", "content": "我想学分数乘法"}
  ],
  "stream": true,
  "user": "qq_123456"
}
```

处理流程：

1. 从 `user` 字段或自定义 header 提取 **IM 平台 user id**
2. 用 `IMUserMapper` 把 IM user id 映射为内部 `student_id`（不存在则自动创建学生）
3. 把 `messages` 最后一条 user 内容交给 **NLU 意图路由器**
4. 意图路由器输出：
   - `math.question` → 调 `/api/v1/questions/ai` 生成题目，格式化为 Markdown
   - `math.answer` → 调 `/api/v1/sessions/.../answers` 判题 + 反馈
   - `math.explain` → 调 `/api/v1/explain/stream` 流式讲解
   - `math.hint` → 调 `/api/v1/hints`
   - `coach.set_goal` → 调 `coach_engine.set_goal`
   - `coach.checkin` → 调 `coach_engine.submit_checkin`
   - `coach.plan` → 调 `coach_engine.generate_plan`
   - `coach.switch_mode` → 调 `coach_engine.switch_mode`
   - `chat.casual` → 调 `/api/v1/chat/stream`
5. 把业务结果包装成 **OpenAI 兼容的 SSE chunk 流** 返回

响应（SSE 流，OpenAI 标准）：
```
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"来做一道题"},"index":0}]}

data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":":\n\n$\\frac{2}{3}"},"index":0}]}

...

data: [DONE]
```

**Markdown 降级**：IM 平台不能渲染 KaTeX / JSXGraph。所以：
- LaTeX 公式保留原文（部分 IM 客户端可显示 MathJax）
- 分数用 Unicode（⅔）或「2/3」文本
- 知识地图等视觉元素退化为文字列表
- 图像类讲解（几何图）只输出文字描述

---

## 4. Rust → Python 移植清单

| Rust 文件 | Python 对应 | 行数 | 移植难度 |
|---|---|---|---|
| `services/student_model.rs` | `services/student_model.py` | 115 | ⭐ 纯算法，10 分钟 |
| `services/decision_engine.rs` | `services/decision_engine.py` | 238 | ⭐ 纯规则 + 数据类 |
| `services/pacing_engine.rs` | `services/pacing_engine.py` | 47 | ⭐ |
| `services/feature_engine.rs` | `services/feature_engine.py` | 132 | ⭐⭐ 需对应 serde 结构 |
| `services/question_bank.rs` | `services/question_bank.py` | 202 | ⭐⭐ JSON 加载逻辑 |
| `ai/llm_client.rs` | `ai/llm_client.py` | 205 | ⭐⭐ httpx + SSE |
| `ai/prompts/mod.rs` | `ai/prompts.py` | 419 | ⭐ 纯字符串模板 |
| `ai/safety.rs` | `ai/safety.py` | 169 | ⭐ |
| `commands/*.rs` | `routes/*.py` | 4164 | ⭐⭐⭐ 最大工作量 |
| `migrations/*.sql` | 直接复用 | - | 0 |

总代码量：Rust ~5700 行 → 预计 Python ~4000 行（Python 更紧凑）

---

## 5. 数据库策略

直接复用 `src-tauri/migrations/*.sql`：

- `001_init.sql` — 9 张基础表（students / knowledge_nodes / questions / learning_sessions / answer_records / knowledge_mastery / chat_records / daily_stats / app_settings）
- `002_p0_features.sql` — 5 张行为特征表
- `003_interests.sql` — 2 张兴趣表

Server 启动时自动执行迁移。数据库文件位置：
- 开发：`server/ai_learning.db`
- 生产（Docker）：`/data/ai_learning.db`（挂载 volume）

新增表（AstrBot 集成专用）：

```sql
-- im_user_mappings: IM 平台 user id ↔ 内部 student_id
CREATE TABLE IF NOT EXISTS im_user_mappings (
    platform TEXT NOT NULL,   -- 'qq' | 'wechat' | 'feishu' | 'telegram' | ...
    platform_user_id TEXT NOT NULL,
    student_id TEXT NOT NULL REFERENCES students(id),
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (platform, platform_user_id)
);
```

这张表作为新迁移 `004_im_mapping.sql` 加在 `src-tauri/migrations/` 下（或 `server/migrations/` 下），被 server 和 Tauri 两边都自动应用。

---

## 6. Tauri 客户端改造

当前 `src/services/index.ts`（~1000 行）已经有「Tauri + 浏览器 mock 双模式」，这次新增第三种模式 **HTTP backend**：

```ts
type BackendMode = 'tauri' | 'http' | 'mock';

const detectMode = (): BackendMode => {
  const override = localStorage.getItem('backend_mode');
  if (override === 'http' || override === 'tauri' || override === 'mock') return override;
  if (isTauri()) return 'tauri';
  if (import.meta.env.VITE_HTTP_BACKEND) return 'http';
  return 'mock';
};
```

每个 service function 里加一个分支：
```ts
if (mode === 'http') return httpCall('/api/v1/...', payload);
```

Settings 页新增「后端模式」选择：本地 (Tauri) / 远程 (HTTP) / 浏览器演示 (Mock)。

流式接口（讲解/对话）原本走 Tauri Event channel，HTTP 模式下改用原生 `EventSource`（SSE）。

---

## 7. AstrBot 集成指南

集成方式：**Star 插件**（取代原 OpenAI Provider 方案）

插件位于 `AstrBot/data/plugins/astrbot-star-math-learning/`，通过 HTTP 调用 server REST API。

**部署流程**：
1. `docker-compose up -d` 一键拉起 learning-server + AstrBot
2. 访问 http://localhost:6185 进入 AstrBot WebUI
3. 配置飞书/QQ/微信等平台适配器
4. 在 WebUI 的插件管理中确认 `astrbot-star-math-learning` 已加载
5. 小学生在 IM 平台发送 `/开始` 即可开始

**指令清单**：`/开始` `/出题` `/答题` `/讲解` `/进度` `/复习` `/结束` `/数学帮助`

**user 标识传递**：插件通过 `event.get_platform_name()` + `event.get_sender_id()` 识别用户，首次使用时自动调 server API 创建学生档案。

> 详细的插件代码和分工说明参见 `dev_docs/12_分工边界_Gemini_vs_Claude.md`。

---

## 8. 安全与鉴权

- **server API Key**：环境变量 `LEARNING_API_KEY`，所有请求必须带 `Authorization: Bearer {key}`
- **硅基流动 LLM Key**：环境变量 `SILICONFLOW_API_KEY`，不再存在 SQLite 里（解除原 MVP 验收 §安全 的 keyring gap）
- **Prompt 安全过滤**：沿用 `ai/safety.py`
- **多学生数据隔离**：所有查询必须带 `student_id`，server 侧用中间件校验 IM 用户只能访问自己的数据
- **家长端密码**：bcrypt 哈希（复用 Rust 版的实现）

---

## 9. 实施步骤

分阶段落地，每阶段都是可运行的中间态：

### Phase A: 骨架（最小可运行）
- `server/pyproject.toml` + `requirements.txt` + `.env.example`
- `server/app/main.py`：空 FastAPI + health check
- `server/app/config.py`：pydantic-settings
- `server/app/db/connection.py` + `migrations.py`：运行 SQL 迁移
- 启动命令：`uvicorn app.main:app --reload --port 9000`

### Phase B: 核心引擎（纯算法，不触 DB）
- `services/student_model.py`（BKT + 遗忘曲线）
- `services/pacing_engine.py`
- `services/decision_engine.py`
- `services/feature_engine.py`
- `services/question_bank.py`
- `ai/safety.py`
- `ai/prompts.py`
- `ai/llm_client.py`（httpx async）
- 单元测试覆盖关键算法

### Phase C: 基础 REST API
- `routes/student.py`
- `routes/knowledge.py`
- `routes/question.py`
- `routes/learning.py`（start/submit/end/summary）
- `schemas/*.py` 全套

### Phase D: 学生模型 + 决策 + 节奏 REST
- `routes/student_model.py`（profile/state/wrong/overview/review/realtime）
- `routes/decision.py`
- `routes/pacing.py`
- `routes/interests.py`
- `routes/parent.py`
- `routes/settings.py`

### Phase E: 流式接口
- `routes/explain.py`（SSE）
- `routes/chat.py`（SSE）
- `services/coach_engine.py`（目标/计划/打卡/模式）

### Phase F: AstrBot Star 插件（Gemini 负责）
- `AstrBot/data/plugins/astrbot-star-math-learning/main.py`（指令注册 + handler）
- `api_client.py`（调 server REST API）
- `session_state.py`（IM 用户 → 学生映射 + 会话管理）
- `formatters.py`（LaTeX 降级 + Markdown 格式化）

### Phase G: Tauri 客户端改造
- `src/services/index.ts` 新增 HTTP mode
- Settings 页加「后端模式」切换
- SSE 接收逻辑（替代原 Tauri Event）

### Phase H: 部署 + 文档
- `Dockerfile` + `docker-compose.yml`
- `server/README.md`
- AstrBot 对接教程
- 集成测试脚本

---

## 10. 验证方式

### 端到端冒烟测试

1. `cd server && uvicorn app.main:app --port 9000`
2. `curl http://localhost:9000/api/v1/students` 确认 REST 正常
3. Tauri 客户端切换到 HTTP 模式，走完「选单元 → 出题 → 答题 → 讲解」闭环
4. `docker-compose up -d` 拉起 AstrBot
5. 在飞书中发送 `/开始` `/出题` `/答题 6` `/讲解` `/进度` `/结束` 完整流程

### 单元测试

- `services/*.py` 全部有对应的 `tests/test_*.py`，覆盖关键算法分支（参考 Rust 原 `#[test]`）
- `pytest server/tests/`

---

## 11. 不做的事（保持范围）

本次重构 **不做** 以下事情，避免范围膨胀：

- 不做多租户（一个 server 一套学生数据；未来可加 org_id）
- 不做实时推送（WebSocket），SSE 就够
- 不做 1~5 年级题库扩展（单独任务）
- 不做 keyring 集成（API Key 改走环境变量，原 §安全验收条目调整）
- ~~不做 AstrBot 的定制插件开发~~ → 已改为 Star 插件方案并实现（见 Phase F）
- 不做移动端 App（Tauri 移动端暂不展开）
