# MVP 版本开发文档

> **AI 自适应小学数学学习系统 — MVP 工程执行手册**  
> 技术栈：Tauri 2 (React + Vite + Rust) + 硅基流动 LLM + SQLite  
> 目标学段：人教版小学数学 (1-6年级) | 目标平台：Windows  
> 预计工期：12 周（W1 ~ W12）

---

# 第一部分：项目搭建

## 1.1 MVP 范围定义

### ✅ 必做

| 模块 | 内容 | 周次 |
|------|------|------|
| 项目脚手架 | Tauri 2 + React + Vite + SQLite | W1-W2 |
| 内容资源层 | 人教版小学知识图谱 + 题库导入 | W3-W4 |
| 基础学习功能 | 出题/判题/问答/讲解 | W5-W6 |
| 学生模型 | 知识层 + 行为层 + 状态层 | W7-W8 |
| 决策引擎 + 学习主引擎 | 规则版决策 + 学习流程状态机 | W9-W10 |
| 节奏控制 + 轻量对话 | 时长控制 + 收束 + 限时聊天 | W11 |
| 家长端 + 集成测试 | 简单家长视图 + 端到端验证 | W12 |

### ❌ 不做

- 棋类 / 全能挑战 / 复杂宠物 / Live2D
- 阅读抽背（V2 阶段，依赖火山引擎语音）
- 认知特征层（V2 棋类后）
- 教师端（V2 轻量 Web 服务）
- 多端同步

---

## 1.2 技术栈速查

| 层 | 技术 | 备注 |
|----|------|------|
| 前端 | React 18 + Vite + TypeScript | Tauri WebView |
| UI | Ant Design 5 | 企业级组件 |
| 数学 | KaTeX | 公式渲染 |
| 图表 | ECharts | 学习可视化 |
| 动画 | Framer Motion | 微交互 |
| 后端 | Rust (Tauri Commands) | 不使用 Sidecar |
| 数据库 | SQLite 3 (rusqlite) | 本地文件 |
| LLM | 硅基流动 API | OpenAI 兼容，多模型可选 |
| 状态缓存 | Rust 内存 (DashMap) | 学生实时状态 |

---

## 1.3 项目结构

```
ai-learning/
├── src-tauri/                        # Rust 后端
│   ├── src/
│   │   ├── main.rs                   # Tauri 入口
│   │   ├── lib.rs                    # 模块声明
│   │   ├── commands/                 # Tauri Commands
│   │   │   ├── mod.rs
│   │   │   ├── student.rs            # 学生管理
│   │   │   ├── knowledge.rs          # 知识图谱
│   │   │   ├── question.rs           # 题库
│   │   │   ├── learning.rs           # 学习主引擎
│   │   │   ├── student_model.rs      # 学生模型
│   │   │   ├── decision.rs           # 决策引擎
│   │   │   ├── pacing.rs             # 节奏控制
│   │   │   ├── chat.rs               # 对话
│   │   │   └── parent.rs             # 家长端
│   │   ├── models/                   # 数据结构 (serde)
│   │   ├── services/                 # 业务逻辑
│   │   │   ├── student_model.rs      # BKT/遗忘曲线
│   │   │   ├── decision_engine.rs    # 决策规则
│   │   │   ├── pacing_engine.rs      # 节奏控制
│   │   │   └── feature_engine.rs     # 特征计算
│   │   ├── ai/                       # LLM 相关
│   │   │   ├── llm_client.rs         # 硅基流动客户端
│   │   │   ├── prompts/              # Prompt 模板
│   │   │   └── prompt_builder.rs     # 动态组装
│   │   ├── db/                       # 数据库
│   │   │   ├── mod.rs
│   │   │   ├── connection.rs
│   │   │   └── migrations.rs         # 自动建表
│   │   ├── state.rs                  # AppState (DashMap)
│   │   ├── config.rs
│   │   └── error.rs
│   ├── migrations/                   # SQL 建表文件
│   │   └── 001_init.sql
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                              # 前端
│   ├── App.tsx
│   ├── main.tsx
│   ├── pages/
│   │   ├── Learn/                    # 学习主界面
│   │   ├── Review/                   # 复习
│   │   ├── Rest/                     # 休息区
│   │   ├── Profile/                  # 个人画像
│   │   ├── Settings/                 # 设置（含模型选择）
│   │   └── Parent/                   # 家长端（密码保护）
│   ├── components/
│   │   ├── learning/                 # 题目展示/答题/反馈
│   │   ├── chat/                     # 对话气泡
│   │   ├── math/                     # KaTeX 渲染
│   │   └── common/                   # 通用组件
│   ├── hooks/
│   │   └── useTauriCommand.ts
│   ├── stores/                       # Zustand
│   ├── services/                     # invoke 封装
│   └── styles/
│
├── dev_docs/
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## 1.4 W1-W2 初始化

### Cargo.toml 核心依赖

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
rusqlite = { version = "0.31", features = ["bundled"] }
tracing = "0.1"
tracing-subscriber = "0.3"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
keyring = "2"
thiserror = "1"
dashmap = "5"
bcrypt = "0.15"
```

### 前端依赖

```bash
pnpm add antd @ant-design/icons katex echarts zustand
pnpm add framer-motion react-router-dom
```

### 配置文件

```toml
# src-tauri/config/default.toml
[llm]
provider = "siliconflow"
api_base = "https://api.siliconflow.cn/v1"
default_model = "deepseek-ai/DeepSeek-V3"

[llm.available_models]
models = [
    { id = "deepseek-ai/DeepSeek-V3", name = "DeepSeek V3", tag = "推荐" },
    { id = "Qwen/Qwen2.5-72B-Instruct", name = "通义千问 72B", tag = "通用" },
    { id = "THUDM/glm-4-9b-chat", name = "GLM-4 9B", tag = "轻量" },
]

[pacing]
max_session_duration = 30
max_chat_per_day = 20

[volcano]
asr_app_id = ""
tts_app_id = ""

[parent]
password_hash = ""
```

> 详细建表 SQL、LLM 客户端、算法代码等请参考各分文档（01~06）。

---

# 第二部分：核心模块速查

## 2.1 LLM 客户端

```rust
pub struct LLMClient {
    api_base: String,     // https://api.siliconflow.cn/v1
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl LLMClient {
    pub async fn complete(&self, messages: &[Message], opts: &LLMOptions) -> Result<String>;
    pub async fn stream(&self, messages: &[Message]) -> Result<impl Stream<Item = String>>;
    pub fn set_model(&mut self, model_id: &str);
    pub fn available_models(&self) -> Vec<ModelInfo>;
}
```

## 2.2 核心 Tauri Commands

```rust
// 知识图谱
#[tauri::command] async fn get_knowledge_tree(grade: i32) -> Result<Vec<KnowledgeNode>>;

// 出题
#[tauri::command] async fn generate_quiz(student_id: String, knowledge_ids: Vec<String>, ...) -> Result<Vec<Question>>;

// 判题
#[tauri::command] async fn evaluate_answer(task_id: String, question_id: String, answer: Value, ...) -> Result<EvaluationResult>;

// 流式问答/讲解
#[tauri::command] async fn ask_question_stream(app: AppHandle, ...) -> Result<()>;
#[tauri::command] async fn generate_explanation_stream(app: AppHandle, ...) -> Result<()>;

// 学习主引擎
#[tauri::command] async fn start_session(student_id: String) -> Result<SessionStartResult>;
#[tauri::command] async fn submit_answer(session_id: String, ...) -> Result<SubmitResult>;
#[tauri::command] async fn end_session(session_id: String, reason: String) -> Result<SessionSummary>;

// 学生模型
#[tauri::command] async fn get_student_profile(student_id: String) -> Result<StudentProfile>;
#[tauri::command] async fn get_student_state(student_id: String) -> Result<StudentState>;
#[tauri::command] async fn push_learning_event(student_id: String, event: LearningEvent) -> Result<()>;

// 节奏控制
#[tauri::command] async fn get_pacing_status(session_id: String) -> Result<PacingStatus>;

// 对话
#[tauri::command] async fn start_chat(app: AppHandle, ...) -> Result<ChatStartResult>;
#[tauri::command] async fn send_chat_message(app: AppHandle, ...) -> Result<()>;

// 家长端
#[tauri::command] async fn verify_parent_password(password: String) -> Result<bool>;
#[tauri::command] async fn get_learning_overview(student_id: String, range: String) -> Result<LearningOverview>;
#[tauri::command] async fn get_mastery_overview(student_id: String) -> Result<Vec<MasteryItem>>;
```

## 2.3 核心算法

- **BKT 知识追踪**：见 `04_Phase1_学生模型.md`
- **遗忘曲线**：艾宾浩斯衰减，掌握越好半衰期越长
- **三层决策**：硬规则→策略选择→内容选择，见 `05_Phase1_决策引擎.md`
- **状态实时更新**：DashMap 缓存，事件驱动，见 `04_Phase1_学生模型.md`

---

# 第三部分：Prompt 模板

## 系统人格

```
你是一个小学数学学习搭子。目标：帮助小学生理解数学。
核心：不贴标签、行为描述、引导思考、用"我们"、允许休息。
禁止：评判、情感绑定、心理诊断。
风格：亲切、鼓励、有耐心，像会数学的好朋友。
```

## 判题 Prompt

```
题目：{question}  标准答案：{answer}  学生答案：{student_answer}  年级：{grade}
→ JSON: { is_correct, error_type, error_step, feedback }
```

## 对话 Prompt

```
年级：{grade}  疲劳：{fatigue}  连续错误：{errors}  学习时长：{duration}min
→ 3 轮内收束，简单活泼语言，禁止心理诊断/情感绑定
```

> 完整 Prompt 模板见 `09_Prompt工程与安全规范.md`

---

# 第四部分：开发周历

| 周 | 主要任务 | 交付物 |
|----|---------|--------|
| **W1** | 项目脚手架、数据库建表、CI | 项目可编译运行 |
| **W2** | LLM 客户端、基础 UI 框架、路由 | 能调通硅基流动 API |
| **W3** | 知识图谱数据导入、知识树 API | 人教版知识点可查询 |
| **W4** | 题库导入、题库查询、出题逻辑 | 能按条件出题 |
| **W5** | 判题系统、分层提示 | 答题→判题→提示流程跑通 |
| **W6** | 问答+讲解（流式输出）、前端学习界面 | 完整学习交互 |
| **W7** | 知识掌握度 (BKT)、遗忘曲线、行为层 | 模型可更新可查询 |
| **W8** | 状态层实时更新、画像聚合 API | 答题→模型更新跑通 |
| **W9** | 决策引擎三层规则 | 能根据画像智能推题 |
| **W10** | 学习主引擎（会话管理+流程状态机） | 完整学习闭环 |
| **W11** | 节奏控制 + 轻量对话 | 自动收束、限时聊天 |
| **W12** | 家长端 + 端到端测试 + Bug 修复 | **MVP 可用** |

---

# 第五部分：验收标准

## 核心功能

- [ ] 能按人教版知识点体系出题
- [ ] AI 判题错因分类准确率 > 80%
- [ ] 提示分 3 层，从引导到具体
- [ ] 问答/讲解流式输出，符合"学习搭子"风格
- [ ] 用户可在设置页切换 LLM 模型

## 学生模型

- [ ] 答对 mastery_score 上升，答错下降
- [ ] 用了提示的正确权重低于独立完成
- [ ] 遗忘风险随时间上升
- [ ] 连续错误后 frustration 上升
- [ ] 行为层指标与实际行为一致

## 决策引擎

- [ ] 疲劳高→不推新题
- [ ] 连续错误→建议休息
- [ ] 遗忘高→优先安排复习
- [ ] 注意力好→推进新知识
- [ ] 决策含可读 reasoning

## 节奏控制

- [ ] 时间到前有预警（不突然切断）
- [ ] 收束包含总结 + 选择
- [ ] 超时进入降级模式

## 对话

- [ ] 3-5 分钟内自动收束
- [ ] 每日上限 20 分钟
- [ ] 冷却机制生效
- [ ] 所有输出无评判性语言

## 家长端

- [ ] 密码验证有效
- [ ] 学习概览数据准确
- [ ] 知识掌握进度可视化
- [ ] 不暴露原始对话/特征分数

## 安全

- [ ] 所有 AI 输出无禁用词
- [ ] 无人格判断/情感绑定
- [ ] API Key 安全存储（系统 keyring）
- [ ] 敏感内容触发升级提示
