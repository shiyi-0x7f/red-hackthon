<p align="center">
  <img src="app-icon.png" alt="学搭搭" width="128" height="128" />
</p>

<h1 align="center">🧮 学搭搭</h1>

<p align="center">
  <strong>基于长期学生模型驱动教学决策的人机协作学习系统</strong>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> •
  <a href="#系统架构">系统架构</a> •
  <a href="#功能特性">功能特性</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#部署指南">部署指南</a> •
  <a href="#开发文档">开发文档</a>
</p>

---

## 📖 项目简介

**学搭搭** 是一个以数学学习为主线、基于长期学生模型驱动教学决策的人机协作学习系统。区别于市面上"对话式 AI 工具"，本系统的核心是一套**学习操作系统**：构建持续更新的 6 层学生画像，用三层决策引擎控制整个学习过程，而不仅仅是推荐题目。

> *"不是让学生离不开 AI，而是让学生在 AI 帮助下更能面对学习本身。"*

### 🎯 与现有产品的本质区别

| 维度 | 现有 AI 学习产品 | 学搭搭 |
|------|-----------------|------------|
| 📝 记忆 | 会话级记忆，下次重来 | **长期学生模型**，跨场景持续积累 |
| 🎨 个性化 | 只调难度 | 内容 + 方式 + 节奏 + 包装 **全面个性化** |
| 🔍 过程 | 只看结果对错 | **采集过程数据**（用时、提示依赖、冲动度等），分析行为模式 |
| 💓 状态 | 不感知学生状态 | **实时状态识别**（疲劳、挫败、认知负荷），动态调节教学 |
| 🧠 决策 | 推荐题目 | 三层决策引擎**控制整个学习过程**（学什么 / 怎么学 / 是否休息） |
| 🏗️ 定位 | AI 工具 | **学习操作系统** |

### 🛡️ 三条铁律

1. **学习优先**：一切模块（对话、游戏、宠物）服务于数学学习效果
2. **非诊断**：AI 不定义学生是什么样的人，只帮助学生看到自己正在做什么
3. **反依赖**：不制造情感依赖，只提供支持关系。用户留下来是因为"真的学得更好了"

---

## ✨ 功能特性

### 🏠 学习首页
- 学搭搭式交互（协作伙伴，非"老师"）
- 智能学习状态识别（疲劳度、挫败感、认知负荷）
- 四段节奏控制（热身 → 进攻 → 巩固 → 收束）

### 📚 自适应学习引擎
- **可扩展题库**：支持 JSON 手工录入 + AI 动态生成 + 未来对接外部题库 API，当前覆盖六年级知识点
- **贝叶斯知识追踪 (BKT)**：用概率模型追踪每个知识点的掌握度，而非简单的对/错统计
- **艾宾浩斯遗忘曲线**：根据掌握程度自适应调整复习半衰期，精准的复习时机推荐
- **三层决策引擎**：
  - 硬规则层（不可违反）：疲劳/超时/严重挫败 → 强制收束或休息
  - 策略选择层：根据行为特征调整提示策略、是否强制停顿
  - 内容选择层：遗忘风险复习 → 新知识推进 → 薄弱巩固
- **分层提示系统**：三级提示（方向引导 → 具体方法 → 接近答案），根据学生的提示依赖度自动调节
- **SSE 流式讲解**：双 Agent 讲解，几何题自动渲染 JSXGraph 交互图形

### 🗺️ 知识图谱
- 人教版小学数学知识点编码体系（`PEP-G{年级}-S{学期}-U{单元}-{序号}`）
- 知识点掌握度热力可视化
- 前置依赖关系驱动的学习路径解锁

### 📊 学生模型（6 层画像）

系统核心中枢。所有学习数据回流更新画像，所有教学决策从画像读取：

| 层级 | 回答的问题 | 关键指标 |
|------|----------|---------|
| **知识层** | 学生会不会 | 各知识点掌握概率、遗忘风险、错误类型分布 |
| **行为层** | 学生怎么学 | 规划能力、冲动度、提示依赖、试错比例 |
| **状态层** | 当前什么状态 | 注意力、疲劳度、挫败感、认知负荷（实时更新） |
| **兴趣层** | 学生喜欢什么 | 偏好主题、讲解风格、从对话中自动提取 |
| **认知层** | 思维特点 | 计算力/理解力/空间/推理 4 维能力（V2） |
| **策略层** | 什么教法有效 | 记录每种策略的效果，持续优化（V2） |

### 📝 错题本 & 智能复习
- 按单元 / 错因类型（概念错误、步骤错误、粗心、策略错误）分类浏览
- 艾宾浩斯遗忘曲线驱动的优先级打分，高掌握度知识点大幅降低复习频率
- 减少复习负担，只练真正需要复习的

### ⏱️ 节奏控制系统
- 年级分层的学习时长控制（1-2 年级 15-20min，5-6 年级 25-30min）
- 四段式收束流程：提前预告 → 收尾任务 → 明确结束 → 退出引导（不是"强制切断"）
- 降级模式：超时不退出时逐步收紧（不推新知识 → 关闭对话 → 软休眠）

### 💬 轻量对话（学习调节）
- 定位：**学习调节干预模块**，不是陪伴产品
- 目标：释放短期压力、收集背景信息、帮学生恢复到可继续学习的状态
- 硬控制：单次 3-5 分钟上限、每日 20 分钟总量、15 分钟冷却
- 对话后自动提取兴趣/压力/近况，回流到学生模型

### 👨‍👩‍👧 家长端
- 密码保护的独立视图
- 学习数据概览与进度追踪

### 🤖 多端接入
- **桌面端**：React + Tauri 原生应用
- **Web 端**：浏览器直接访问
- **IM 平台**：通过 AstrBot 对接飞书/QQ/微信，学生在 IM 中发送 `/开始` `/出题` `/答题` 即可使用

---

## 🏗️ 系统架构

```
┌──────────────────┐         ┌──────────────────┐
│  Tauri / Web     │         │   AstrBot IM     │
│  (桌面/浏览器)    │         │   (飞书/QQ/微信)  │
└────────┬─────────┘         └────────┬─────────┘
         │ HTTP REST                  │ Star 插件
         │ /api/v1/*                  │ HTTP REST /api/v1/*
         ▼                            ▼
┌────────────────────────────────────────────────┐
│        Python FastAPI 学习服务器                 │
│                                                 │
│  Services:                                      │
│    BKT 知识追踪 / 三层决策引擎 / 四段节奏控制    │
│    行为特征工程 / 出题策略 / 教练逻辑            │
│                                                 │
│  AI Engine:                                     │
│    LLM 调用 / Prompt 模板 / 安全过滤            │
│                                                 │
│  SQLite（复用 16 张迁移表）                      │
└───────────────────┬────────────────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │  硅基流动 LLM API │
          │ (OpenAI 兼容协议) │
          └──────────────────┘
```

### 核心数据闭环

```
用户行为 → 数据采集 → 特征提取 → 学生模型更新 → 决策引擎 → 学习主引擎 → 交互反馈 → 用户新行为
```

---

## 🛠️ 技术栈

### 前端
| 技术 | 用途 |
|------|------|
| React 18 + TypeScript | UI 框架 |
| Vite 6 | 构建工具 |
| Ant Design 5 | UI 组件库 |
| Zustand 5 | 状态管理 |
| ECharts 5.6 | 数据可视化（能力雷达图、学习趋势） |
| Framer Motion 12 | 动画与交互 |
| KaTeX 0.16 | 数学公式渲染 |
| JSXGraph 1.12 | 几何图形交互渲染 |
| React Router 7 | 路由管理 |

### 后端
| 技术 | 用途 |
|------|------|
| Python 3.11+ / FastAPI | 异步 Web 框架 |
| aiosqlite | 异步 SQLite 连接 |
| httpx | LLM API 异步调用 |
| pydantic / pydantic-settings | 数据校验与配置管理 |
| SSE (Server-Sent Events) | 流式讲解与对话 |

### 基础设施
| 技术 | 用途 |
|------|------|
| Docker / Docker Compose | 容器化一键部署 |
| AstrBot | IM 网关（飞书/QQ/微信多平台适配） |
| SQLite | 数据存储（16 张表，复用 Tauri 迁移） |
| 硅基流动 SiliconFlow | LLM 推理服务（多模型可选） |
| Tauri 2 | 可选桌面端封装 |

---

## 🚀 快速开始

### 前置要求

- **Node.js** >= 18 + **pnpm**
- **Python** >= 3.11
- 硅基流动 API Key（[申请地址](https://siliconflow.cn/)）

### 1. 克隆仓库

```bash
git clone https://github.com/shiyi-0x7f/red-hackthon.git
cd red-hackthon
```

### 2. 启动后端

```powershell
cd server
python -m venv .venv
.venv\Scripts\activate        # Linux/Mac: source .venv/bin/activate

pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，至少填入 SILICONFLOW_API_KEY

# 启动（默认 0.0.0.0:9000）
uvicorn app.main:app --reload --port 9000
```

首次启动自动执行 `src-tauri/migrations/*.sql` 迁移，数据库文件在 `server/ai_learning.db`。

### 3. 启动前端

```powershell
# 回到项目根目录
pnpm install
pnpm dev
```

访问 http://localhost:1420 即可使用。API 文档访问 http://localhost:9000/docs 。

---

## 🐳 部署指南

### Docker 一键部署（推荐）

```powershell
# 1. 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，填入 SILICONFLOW_API_KEY

# 2. 构建前端静态文件
pnpm install
pnpm build

# 3. 启动所有服务
docker-compose up -d

# 4. 查看状态
docker-compose ps
docker-compose logs -f
```

| 服务 | 端口 | 说明 |
|------|------|------|
| 学习服务器 | `9100` | FastAPI REST API + 静态文件托管 |
| AstrBot | `6185` | IM 网关管理面板 |

### AstrBot IM 集成

1. 访问 http://localhost:6185 进入 AstrBot WebUI
2. 配置飞书/QQ/微信等平台适配器
3. 确认 `astrbot-star-math-learning` 插件已加载
4. 学生在 IM 平台发送 `/开始` 即可使用

指令清单：`/开始` `/出题` `/答题` `/讲解` `/进度` `/复习` `/结束` `/数学帮助`

---

## 📁 项目结构

```
red-hackthon/
├── src/                          # 前端源码 (React + TypeScript)
│   ├── components/               # 公共组件
│   ├── pages/                    # 页面（Home/Learn/Practice/Profile/Review/Rest/Parent/Settings）
│   ├── services/                 # API 服务层（支持 Tauri/HTTP/Mock 三种模式）
│   ├── stores/                   # Zustand 状态管理
│   └── styles/                   # 全局样式
├── server/                       # 后端源码 (Python FastAPI)
│   ├── app/
│   │   ├── main.py               # FastAPI 入口
│   │   ├── services/             # 核心业务（BKT/决策引擎/节奏控制/行为特征/出题策略）
│   │   ├── ai/                   # AI 模块（LLM调用/Prompt模板/安全过滤）
│   │   ├── routes/               # 13 个 API 路由模块
│   │   └── schemas/              # 数据模型
│   └── requirements.txt
├── AstrBot/                      # AstrBot IM 网关（子模块）
├── data/                         # 题库 & 知识图谱数据（JSON）
├── dev_docs/                     # 开发设计文档（15 篇）
├── docker-compose.yml            # Docker 编排（server + AstrBot）
└── package.json
```

---

## 📡 API 概览

后端启动后访问 http://localhost:9000/docs 查看完整 OpenAPI 文档。

### 鉴权

所有接口需要 `Authorization: Bearer {LEARNING_API_KEY}` 请求头。开发阶段默认 key 为 `sk-ai-learning-change-me` 时自动放行。

### 主要端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/students` | POST / GET | 学生 CRUD |
| `/api/v1/students/{id}/profile` | GET | 学生 6 层画像聚合 |
| `/api/v1/students/{id}/realtime` | GET | 实时状态（疲劳/注意力/挫败/认知负荷） |
| `/api/v1/students/{id}/wrong-answers` | GET | 错题本（含错因分类） |
| `/api/v1/students/{id}/review` | GET | 遗忘曲线驱动的复习推荐 |
| `/api/v1/knowledge/tree` | GET | 知识图谱树 |
| `/api/v1/questions/quiz` | POST | 出题（诊断/单元/自适应模式） |
| `/api/v1/questions/ai` | POST | AI 动态出题（基于兴趣情境化） |
| `/api/v1/sessions` | POST | 开始学习会话 |
| `/api/v1/sessions/{id}/answers` | POST | 提交答案（触发 BKT 更新 + 决策） |
| `/api/v1/explain/stream` | GET (SSE) | 流式讲解 |
| `/api/v1/chat/stream` | POST (SSE) | 流式对话 |
| `/api/v1/decision/next` | POST | 决策引擎（学什么/怎么学/是否休息） |

---

## 📚 开发文档

详细设计文档位于 [`dev_docs/`](./dev_docs/) 目录：

| 文档 | 内容 |
|------|------|
| [00_项目总览与原则](./dev_docs/00_项目总览与原则.md) | 产品定位、三条铁律、9 大模块架构 |
| [01_技术栈与基础设施](./dev_docs/01_技术栈与基础设施.md) | 技术选型与基础设施决策 |
| [02_数据库设计](./dev_docs/02_数据库设计.md) | 16 张表完整 Schema |
| [03_内容资源与基础功能](./dev_docs/03_Phase1_内容资源与基础功能.md) | 知识图谱、题库、判题、分层提示、讲解 |
| [04_学生模型](./dev_docs/04_Phase1_学生模型.md) | 6 层画像设计、BKT 算法、遗忘曲线 |
| [05_决策引擎与学习主引擎](./dev_docs/05_Phase1_决策引擎与学习主引擎.md) | 三层决策、学习状态机、反馈生成 |
| [06_节奏控制与轻量对话](./dev_docs/06_Phase1_节奏控制与轻量对话.md) | 四段收束、降级模式、对话调节 |
| [09_Prompt工程与安全规范](./dev_docs/09_Prompt工程与安全规范.md) | Prompt 模板与安全过滤规则 |
| [11_C/S架构与AstrBot集成](./dev_docs/11_C_S架构与AstrBot集成.md) | 架构重构设计、API 契约、部署方案 |
| [12_分工边界](./dev_docs/12_分工边界_Gemini_vs_Claude.md) | 模块职责划分与 API 契约清单 |

---

## 🗺️ 产品两层本质

```
第一层（底座）：传统 AI 学习系统
├── 出题、题库、问答、讲解、判题、提示、复习、学习记录
└── 基础设施

第二层（差异化核心）：长期个性化决策系统
├── 学生模型（6 层画像）
├── 长时记忆（跨场景持续）
├── 教学决策引擎（三层：硬规则 → 策略 → 内容）
├── 节奏控制系统（四段收束 + 降级模式）
├── 学搭搭式交互（协作伙伴，非工具）
└── 多场景数据融合（桌面端 + IM 端共享画像）
```

> 传统功能解决"能不能教"，差异化系统解决"怎么教得更适合这个学生"。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 License

本项目仅供学习和研究使用。

---

<p align="center">
  <sub>Built with ❤️ for better math education</sub>
</p>
