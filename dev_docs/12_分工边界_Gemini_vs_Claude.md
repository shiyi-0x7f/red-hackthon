# 分工边界：Gemini vs Claude

> **目的**：明确两个 AI 助手各自负责的文件和模块，避免任何交叉修改。

---

## 总原则

- **Claude**：负责 `server/` 目录（Python FastAPI 后端）和 `src/` + `src-tauri/`（Tauri 客户端改造）。**只做代码编写和修改**。
- **Gemini**：负责 `AstrBot/` 目录下的插件开发、Docker 部署配置、compose 文件，**并且负责所有运行时事务**（虚拟环境、依赖安装、启动服务、测试验证、调试排错）。

**绝对不能互相修改对方负责的文件。**

---

## Claude 的职责范围

### 文件范围
```
server/                          # Python FastAPI 后端 ← Claude 独占
├── app/
│   ├── main.py
│   ├── config.py
│   ├── routes/*.py              # 所有 REST API 路由
│   ├── services/*.py            # 业务逻辑
│   ├── ai/*.py                  # LLM 客户端、Prompt、安全
│   ├── schemas/*.py             # Pydantic 模型
│   ├── db/*.py                  # 数据库连接
│   └── nlu/                     # 如果需要的话（当前方案不需要）
├── requirements.txt
├── .env / .env.example
└── tests/

src/                             # React 前端 ← Claude 独占
src-tauri/                       # Rust 后端 ← Claude 独占
├── migrations/*.sql             # 数据库迁移 SQL ← Claude 独占
data/                            # 题库/知识图谱 JSON ← Claude 独占
```

### Claude 的任务（纯代码）
1. Server Phase E 补全（coach_engine 等）
2. Server Phase G：Tauri 客户端 services/index.ts HTTP mode 改造
3. server/app/routes/openai_compat.py **不需要实现**（已改为 Star 插件方案）
4. `server/app/main.py` 中 `openai_compat` 的 import 可以移除或留空壳
5. 数据库迁移 SQL（`src-tauri/migrations/*.sql`）

### ⚠️ Claude 注意事项
- **只写代码、不跑代码**。虚拟环境创建、`pip install`、`uvicorn` 启动、pytest 运行等一切运行时操作由 Gemini 执行
- AstrBot 接入方式已从 **OpenAI Provider** 改为 **Star 插件**
- NLU 意图路由（`server/app/nlu/`）**不再需要**，Gemini 侧的插件通过指令系统直接路由
- server 端 REST API 是 Gemini 侧插件的依赖，API 契约（路径、请求/响应格式）不要随意变更
- 如需变更 API 契约，请先在本文档中记录
- 写完代码后告知 Gemini（或用户），由 Gemini 负责运行和验证

---

## Gemini 的职责范围

### 文件范围
```
AstrBot/data/plugins/astrbot-star-math-learning/   # AstrBot 插件 ← Gemini 独占
├── main.py                      # 插件入口 + 指令注册
├── metadata.yaml                # 插件元数据
├── api_client.py                # 调 server REST API 的封装
├── session_state.py             # IM 用户 → 学生映射 + 会话状态
├── formatters.py                # 消息格式化（LaTeX 降级等）
└── requirements.txt

docker-compose.yml               # 项目根目录的 compose ← Gemini 独占
server/Dockerfile                # server 的 Docker 构建 ← Gemini 独占
```

### Gemini 的任务
1. 创建 AstrBot Star 插件（指令系统 + API 调用 + 消息格式化）
2. Docker 部署配置（compose + Dockerfile + 镜像加速）
3. 飞书平台适配和测试
4. **运行时全权负责**（见下方"运行时职责"章节）

### ⚠️ Gemini 注意事项
- **不修改** `server/` 下 Claude 写的任何文件（server/Dockerfile 除外，由 Gemini 管理）
- 插件通过 HTTP 调 server REST API，依赖 `server/.env` 中的 `LEARNING_API_KEY`
- 如果发现 server API 缺少某个接口，在本文档 "API 需求" 部分提出，由 Claude 实现

---

## 运行时职责（Gemini 独占）

Claude 只负责写代码。以下所有运行时操作由 Gemini 执行：

| 操作 | 说明 |
|------|------|
| **Python 虚拟环境** | 创建 venv、安装 requirements.txt、管理依赖 |
| **启动 server** | `uvicorn app.main:app` 的启动、重启、参数调整 |
| **启动 AstrBot** | Docker 或本地方式启动 |
| **运行测试** | `pytest server/tests/`、curl API 验证、插件测试 |
| **调试排错** | 看日志、定位报错、确认修复 |
| **Docker 构建** | `docker-compose build`、`docker-compose up` |
| **数据库操作** | 确认迁移执行、查看数据、排查 schema 问题 |
| **环境配置** | `.env` 文件填写、环境变量设置 |

> **工作流**：Claude 写完代码 → 告知用户/Gemini → Gemini 运行验证 → 如有问题反馈给 Claude 修改

---

## 共享约定

### API 契约（Gemini 插件 → Claude Server）

Gemini 插件调用的 server 端点清单（来自 `11_C_S架构与AstrBot集成.md` §3.1）：

| 端点 | 方法 | 插件用途 |
|------|------|---------|
| `/api/v1/students` | POST | 首次使用时创建学生 |
| `/api/v1/students` | GET | 列出学生 |
| `/api/v1/students/{id}` | GET | 查学生资料 |
| `/api/v1/sessions` | POST | 开始学习会话 |
| `/api/v1/sessions/{id}/answers` | POST | 提交答案 |
| `/api/v1/sessions/{id}/end` | POST | 结束会话 |
| `/api/v1/sessions/{id}/summary` | POST | 生成会话总结 |
| `/api/v1/questions/quiz` | POST | 静态出题 |
| `/api/v1/questions/ai` | POST | AI 动态出题 |
| `/api/v1/explain/stream` | GET (SSE) | 流式讲解 |
| `/api/v1/students/{id}/profile` | GET | 学生画像 |
| `/api/v1/students/{id}/review` | GET | 复习建议 |
| `/api/v1/decision/next` | POST | 决策下一步 |
| `/api/v1/knowledge/tree` | GET | 知识树 |

### 认证
- Header: `Authorization: Bearer {LEARNING_API_KEY}`
- 开发模式下 key 为 `sk-ai-learning-change-me` 时跳过校验

### 部署地址

| 环境 | Learning Server | AstrBot |
|------|----------------|---------|
| **本地开发** | `http://localhost:9000` | `http://localhost:6185` |
| **服务器** | `http://150.158.18.95:9100` | `http://150.158.18.95:6185` |

> ⚠️ **端口变更**：服务器上 9000 端口已被占用，Docker 外部映射改为 **9100**（容器内部仍为 9000）。
> 前端 `VITE_HTTP_BACKEND` 连服务器时需指向 `http://150.158.18.95:9100`。
>
> 📌 **后续**：将通过域名 + 宝塔反代替换 IP:端口，届时统一更新为域名地址。

### 响应格式
```json
{"code": 0, "message": "ok", "data": { ... }}
```

## Bug 反馈（待 Claude 修复）

> Gemini 在测试中发现的 server 端 bug，请 Claude 修复：

| 日期 | 描述 | 严重度 | 状态 |
|------|------|--------|------|
| 2026-04-09 | **submit_answer 500**：`POST /api/v1/sessions/{id}/answers` 提交答案时报 `sqlite3.IntegrityError: FOREIGN KEY constraint failed`。原因：`generate_quiz` 出题时从 JSON 文件返回 `question_id='base-0001'`，但没有 INSERT 到数据库 `questions` 表中，导致 `answer_records` INSERT 时外键约束失败。 | 🔴 高 | ✅ 已修 (2026-04-09 by Claude) |
| 2026-04-09 | **profile 路由路径**：`GET /api/v1/students/{id}/overview` 是正确路径（已在插件中修正）。API 契约表中的 `/students/{id}/profile` 已过时，实际是 `/students/{id}/overview` | ✅ 已修 | — |

### Bug 1 修复说明（Claude 2026-04-09）

**策略**：采用 Rust 版 `src-tauri/src/commands/learning.rs` 同款的 **lazy upsert** 方案（line 169-191），不动 schema、不关 FK 约束。

**修改文件**：
- `server/app/routes/learning.py` — `submit_answer` 路由：
  - 题目查找增加 QuestionBank JSON 兜底：DB 查不到 → 从 `grade6_math_practice_questions_latex.json` 找
  - 新增辅助函数 `_ensure_knowledge_and_question()`：先 `INSERT OR IGNORE INTO knowledge_nodes`（id = `kn-{unit}`），再 `INSERT OR IGNORE INTO questions`，然后再 INSERT answer_records
  - 三种 fallback 层级：`questions 表命中` → `QuestionBank JSON 命中` → `orphan 占位行`（客户端伪造 id 时仍能落盘，不 500）
  - BKT 更新改为使用解析后的 `resolved_knowledge_id` 和 `question_difficulty`，不再依赖原 `question_row`
- `server/app/routes/question.py` — `generate_ai_question` 路由：
  - 新增 DB 依赖，LLM 返回后立刻 upsert knowledge_nodes + INSERT questions
  - 生成稳定的 `ai-{uuid}` id 作为主键，响应里把 `id` / `knowledge_id` / `ai_generated: true` 塞回给客户端
  - 与 Rust 版前缀命名一致，submit_answer 可以通过 `ai-` 前缀识别 AI 题来源

**验证方法**（交给 Gemini）：
```bash
# 1. 创建学生 + 开会话
STUDENT_ID=$(curl -sX POST http://localhost:9000/api/v1/students \
  -H "Content-Type: application/json" \
  -d '{"name":"测试","grade":6}' | jq -r '.data.id')
SESSION_ID=$(curl -sX POST http://localhost:9000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d "{\"student_id\":\"$STUDENT_ID\"}" | jq -r '.data.session_id')

# 2. 出一道静态题
QID=$(curl -sX POST http://localhost:9000/api/v1/questions/quiz \
  -H "Content-Type: application/json" \
  -d "{\"student_id\":\"$STUDENT_ID\",\"mode\":\"diagnose\",\"count\":1}" \
  | jq -r '.data.questions[0].id')

# 3. 答题（这一步之前会 500，现在应返回 200 + evaluation）
curl -X POST "http://localhost:9000/api/v1/sessions/$SESSION_ID/answers" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"question_id\":\"$QID\",\"student_answer\":\"6\",\"time_spent_secs\":10,\"hint_used\":0}"
```

---

## API 需求（待 Claude 补充的接口）

> Gemini 在开发插件过程中如发现 server 缺少某个接口，在此处登记：

| 日期 | 需求描述 | 状态 |
|------|---------|------|
| （暂无）| | |

---

## 数据库迁移

- `src-tauri/migrations/` 下的 SQL 由 Claude 管理
- Gemini 不直接操作数据库，所有数据操作通过 server REST API
- 如果 Gemini 需要新表（如 `im_user_mappings`），在上面 "API 需求" 中提出

---

## 近期变更同步（Claude → Gemini）

> Claude 每次改完代码在这里登记。Gemini 看到后更新自己的部署/测试/插件，有问题在上方 Bug 反馈区登记。

### 2026-04-09 · Profile 页「知识地图」UI 优化（纯前端）

**动因**：用户反馈 4 个可视化组件的标签堆叠、长路径截断、0 值柱子无意义等问题。

**修改文件**：
- `src/pages/Profile/index.tsx`
  - 新增 `leafName(full, maxLen)` 辅助函数：从 `A-B-C` 形式的层级名称里取叶子节点（去掉前缀路径），去重连续相同段，超长截断
  - 雷达图 indicator 用 `leafName`，tooltip 保留完整路径，`max: 100` 统一刻度
  - 掌握度分布图（原「趋势图」，rename 为「分布」避免语义误导）：X 轴用 leafName + 旋转 45° + `interval: 0`
  - 练习量柱状图：X 轴 leafName + 旋转 45°；**0 值柱子走虚线半透明样式**（`unpracticedStyle`），非 0 走渐变色（`activeStyle`）；tooltip 对 0 值显示"（未练习）"
  - 薄弱知识点列表：名称用 leafName，`title=` 显示完整路径（hover 看详情）；百分比文字按 <40 / 40-70 / >70 三色（`weak-score-red/yellow/green`）
  - 新增 `LearningSuggestionCard` 子组件：基于 masteryData 自动算出 3 类建议
    - 优先复习（掌握度 top-2 低）
    - 及时温习（遗忘风险 >0.4 且不在上一类里）
    - 可以挑战（掌握度 ≥0.75 且练习 ≥3 次的顶尖项）
  - 知识地图 tab 每个卡片 ECharts 高度 180 → 260
- `src/styles/learning-extras.css`
  - `.profile-tabs` 改为底线风格（移除胶囊 + 渐变，统一视觉，选中态 `border-bottom: 2px solid #FF8C42` + 加粗文字）
  - `.knowledge-grid` 从 `repeat(auto-fit, minmax(240px, 1fr))` 改为固定 `repeat(2, minmax(0, 1fr))`，小于 820px 单列
  - 新增 `.weak-score-red/yellow/green` 颜色类
  - 新增 `.weak-name` 带 ellipsis 控制最大宽度
  - 新增 `.suggestion-card` 及子元素样式（tag / row / item）

**验证方式**（交给 Gemini）：
- `npm run dev` 起前端，或 `npm run build` 后 preview
- 访问 `/profile` → 切到「知识地图」tab
- 肉眼确认：4 个卡片 2×2 布局，无标签重叠，tab 样式统一，底部出现「学习建议」卡片

---

### 2026-04-09 · 前端云端部署准备（代码层）

**动因**：用户想把前端也部署到服务器（`150.158.18.95:9100`）。原代码硬编码 `http://localhost:9000`，且未区分 dev/prod 环境变量。

**前置调查结果**：前端**代码层已具备云端部署条件**
- 所有 `@tauri-apps/*` 都是 `await import(...)` 动态加载，被 `isTauri()` 运行时守卫，浏览器下不会触发
- 无 Tauri fs API（readTextFile/convertFileSrc 等）
- `index.html` 无 Tauri 专属 CSP
- services/index.ts 已有完整的 `tauri | http | mock` 三态分发

**本次修改**：
- `src/services/index.ts` — `getHttpBase()` 默认返回 `''`（same-origin 相对路径），不再硬编码 localhost；注释说明三种场景的配置方式
- `src/pages/Settings/index.tsx` — 后端地址输入框 placeholder 改为「留空 = 同源相对路径」，hint 示例更新为 `http://192.168.1.10:9100`
- 仓库根目录新增 `.env.production.example`：详细说明 `VITE_HTTP_BACKEND` / `VITE_HTTP_BACKEND_KEY` 的三种使用场景（同域 / 跨域 / 开发联调）
- `public/_redirects` 新增：`/* /index.html 200`，Cloudflare Pages / Netlify 通用 SPA fallback（React 使用 BrowserRouter，刷新 `/learn` 这类路径需要服务器 rewrite）

**行为变化**：
- 构建时未设 `VITE_HTTP_BACKEND` → 运行时所有 API 调用走相对路径 `fetch('/api/v1/...')`
- 这意味着前端必须和 server 同源（或由反向代理转发 `/api/*` 给 server），否则请求会打到前端静态托管域名
- 跨源部署场景下必须显式设置 `VITE_HTTP_BACKEND=https://api.your-domain.com` 并确保 server CORS 包含前端域名

### ✅ 部署形态已选定：B1 — FastAPI 直接吐静态文件

**决策**：用户 2026-04-09 拍板走 **B1**（FastAPI StaticFiles mount + SPA fallback）。
单进程、零 CORS、和「一台服务器同时跑前后端」的设定最匹配。

**Claude 侧代码已完成**：
- `server/app/config.py` — 新增 `frontend_dist_dir` 字段和 `frontend_dist_path` property，默认值 `./static`
- `server/app/main.py` — 新增 `_mount_frontend_if_available()` 函数，在 create_app 末尾调用：
  - 目录 / index.html 不存在 → 跳过挂载，以纯 API 模式运行（**不会报错**）
  - 存在 → 挂载 `/assets/*` 到 StaticFiles + 注册 `/{full_path:path}` catch-all 走 SPA fallback
  - SPA fallback 优先返回存在的静态文件（favicon.ico / data JSON 等），其余都回退到 `index.html`
  - 路径安全：`candidate.relative_to(dist)` 校验防止 `..` 逃出 dist 目录
  - API 路由优先级：`/api/v1/*`、`/health`、`/docs` 等都在 catch-all 之前注册，不会被拦截
- `server/.env.example` — 新增 `FRONTEND_DIST_DIR=./static` 默认值和使用说明

**Gemini 需要做的事**：

1. **构建前端**（在仓库根目录，Gemini 或用户手动都行）：
   ```bash
   cd /path/to/modest-rhodes
   npm install        # 首次
   npm run build      # 产物在 ./dist/
   ```

2. **把 dist 送进 server 容器**（二选一）：

   - **方法 A：构建镜像时 COPY 进去**（推荐生产）

     Gemini 在 `server/Dockerfile` 里加一行（**注意：Dockerfile 是 Gemini 的领地，Claude 不动**）：
     ```dockerfile
     # 在现有 COPY app /app/app 后面加：
     COPY static /app/static   # 期待构建上下文里有 ./static/（是前端 dist 拷过来的）
     ```
     然后构建流程：`cp -r dist server/static && docker-compose build learning-server`

   - **方法 B：volume mount**（适合开发 / 频繁换前端）

     在 `docker-compose.yml` 的 `learning-server` service 下加：
     ```yaml
     volumes:
       - ./dist:/app/static:ro
     ```
     构建后 dist 变化直接生效，不用重建镜像。

3. **验证**：
   ```bash
   # 访问以下 URL 都应能工作（假设 server 在 150.158.18.95:9100）：
   curl http://150.158.18.95:9100/health          # 健康检查
   curl http://150.158.18.95:9100/api/v1/students # API 仍在 /api/v1 下
   curl http://150.158.18.95:9100/                # 返回 index.html
   curl http://150.158.18.95:9100/learn           # 也返回 index.html（SPA fallback）
   curl http://150.158.18.95:9100/assets/xxx.js   # 返回前端 JS bundle
   ```

   浏览器访问 `http://150.158.18.95:9100/` 应看到完整的 React 应用。

4. **生产环境变量**（构建前端时）：
   - **不要设** `VITE_HTTP_BACKEND`（留空让 `getHttpBase()` 走 same-origin 相对路径）
   - `VITE_HTTP_BACKEND_KEY` 可以设，但注意前端 bundle 里可见
   - 用户如果想在运行时强制切换后端地址，在 Settings 页输入即可（存 localStorage）

5. **不需要做的事**：
   - ❌ 不需要配置 CORS（同源）
   - ❌ 不需要 nginx / Traefik 反代（FastAPI 自己处理）
   - ❌ 不需要改 `src/` 或 `server/app/` 下任何代码（都已经就绪）

---

### 2026-04-09 · 前一批已完成的代码尾巴（提醒 Gemini 重跑测试）

在修 Bug 1（submit_answer FK）之前，Claude 还补了 4 个纯代码尾巴，如果 Gemini 之前的测试是基于旧代码跑的，需要重跑：

1. **`routes/student_model.py::get_review_recs`** 从 `hours_since = 24.0` 硬编码改为 SQLite `julianday('now') - julianday(last_practiced_at)` 真实时间差；新增 `attempt_count` / `correct_count` / 细化的 `reason` 字段
2. **`routes/question.py::generate_quiz`** 补全模式自适应：按答题总数在 `diagnose`/`emerging`/`adaptive` 间自动切换，对齐 Rust 版；`mastery_data` 用 `knowledge_nodes.name` 作 key
3. **`routes/chat.py` SSE generator** 持久化 assistant 消息的 `db` 连接生命周期问题：抽出 `_persist_chat_message()` 用 `db_conn()` 独立短连接写入，避开 EventSource 迭代时依赖注入的 db 已关闭的问题
4. **前端 `src/services/index.ts`** `explainService` / `chatService` 新增 HTTP mode 分支：用 `fetchSSE()` + `httpStreamRegistry` 实现 fetch+ReadableStream 解析 SSE，支持 POST body 和 Authorization header（原生 EventSource 做不到）

这些都是 code-only，Python 语法检查 clean，TypeScript 编译 clean。
