# MVP 版本开发文档

> **AI 自适应数学学习系统 — MVP 工程执行手册**  
> 技术栈：AstrBot 深度改造 (Python + Vue 3 + Vuetify) + 硅基流动 LLM + SQLite  
> 目标学段：人教版小学六年级数学 | 通道：Web + 飞书私聊  
> 预计工期：黑客松 48 小时

---

# 第一部分：项目搭建

## 1.1 MVP 范围定义

### ✅ 必做

| 模块 | 内容 | 时段 |
|------|------|------|
| 数据库扩展 | AstrBot SQLite + 7 张学习系统表 | 0-2h |
| 学习服务层 | BKT + 决策引擎 + 出题/判题服务 | 2-8h |
| API 路由 | 4 个新路由文件 + 注册 | 8-12h |
| 题库初始化 | 30-50 道六年级数学题 | 12-14h |
| Vue 仪表盘 | 学生画像 + 雷达图 + 进度 | 14-20h |
| Vue 对话页 | 复用 LiveChat + 命令快捷栏 | 20-26h |
| Vue 学习页 | 出题/答题/反馈交互 | 26-32h |
| 知识图谱 | 掌握度热力图 | 32-36h |
| 样式打磨 | Vuetify 主题定制 | 36-40h |
| 联调 + 插件 | AstrBot 插件 + 飞书对接 | 40-46h |
| 演示准备 | 封板 + 演练 | 46-48h |

### ❌ 不做

- 棋类 / 全能挑战 / 复杂宠物 / Live2D
- 阅读抽背（依赖火山引擎语音）
- 认知特征层（V2）
- 家长端独立页面（MVP 可 mock）
- 定时督学 CronJob
- 多学段（仅六年级）

---

## 1.2 技术栈速查

| 层 | 技术 | 备注 |
|----|------|------|
| 前端 | Vue 3 + Vuetify + Vite + TypeScript | AstrBot Dashboard 扩展 |
| 数学 | KaTeX | Dashboard 已集成 |
| 图表 | ApexCharts (vue3-apexcharts) | Dashboard 已集成 |
| Markdown | markdown-it + highlight.js | Dashboard 已集成 |
| 后端 | Python (AstrBot Quart Server) | 直接改 AstrBot 源码 |
| 数据库 | SQLite 3 (SQLModel ORM) | AstrBot 统一数据库 |
| LLM | 硅基流动 via AstrBot Provider Manager | 多模型可选 |
| 向量检索 | FAISS | AstrBot 知识库 |
| IM 通道 | 飞书私聊 + WebChat | AstrBot 平台层 |
| 状态缓存 | Python dict | 学生实时状态 |
| 认证 | AstrBot JWT | Dashboard 认证 |
| 人格切换 | AstrBot Persona | strict/gentle |

---

## 1.3 项目结构

```
ai-learning/
├── AstrBot/                              # AstrBot 源码（直接修改）
│   ├── astrbot/
│   │   ├── core/
│   │   │   ├── db/
│   │   │   │   ├── po.py                # ← 新增 7 张学习系统表
│   │   │   │   └── sqlite.py            # ← 新增学习数据 CRUD
│   │   │   ├── learning/                # ← 新增：学习系统核心服务
│   │   │   │   ├── __init__.py
│   │   │   │   ├── student_model.py     # BKT + 遗忘曲线
│   │   │   │   ├── decision_engine.py   # 三层决策
│   │   │   │   ├── question_service.py  # 出题 + LLM 判题
│   │   │   │   ├── pacing_engine.py     # 节奏控制
│   │   │   │   ├── safety.py            # 输出安全过滤
│   │   │   │   └── prompt_builder.py    # Prompt 动态组装
│   │   │   ├── provider/               # LLM Provider（原有复用）
│   │   │   ├── platform/               # 飞书/WebChat（原有复用）
│   │   │   ├── persona_mgr.py          # Persona 管理（原有复用）
│   │   │   └── knowledge_base/         # FAISS 知识库（原有复用）
│   │   ├── builtin_stars/
│   │   │   └── dedicated_tutor/        # ← 新增：专属导师插件
│   │   │       ├── main.py             # Star 主类 + 命令
│   │   │       ├── metadata.yaml
│   │   │       ├── seed_data.py        # 初始题库数据
│   │   │       └── prompts/
│   │   │           ├── system.txt
│   │   │           ├── judge.txt
│   │   │           ├── generate.txt
│   │   │           ├── explain.txt
│   │   │           ├── chat.txt
│   │   │           └── review.txt
│   │   └── dashboard/
│   │       ├── server.py               # ← 注册 4 个新路由
│   │       └── routes/
│   │           ├── student.py          # ← 新增
│   │           ├── learning.py         # ← 新增
│   │           ├── tutor_commands.py   # ← 新增
│   │           └── knowledge_graph.py  # ← 新增
│   ├── dashboard/                       # 前端源码
│   │   └── src/
│   │       ├── views/learning/         # ← 新增：学习系统页面
│   │       │   ├── DashboardPage.vue   # 仪表盘
│   │       │   ├── TutorChatPage.vue   # 智能对话
│   │       │   ├── LearnSessionPage.vue # 学习会话
│   │       │   └── KnowledgeMapPage.vue # 知识图谱
│   │       ├── components/learning/    # ← 新增：学习组件
│   │       │   ├── MathRenderer.vue
│   │       │   ├── QuestionCard.vue
│   │       │   ├── PacingBar.vue
│   │       │   ├── CommandBar.vue
│   │       │   └── RadarChart.vue
│   │       ├── composables/            # ← 新增：API 调用
│   │       │   └── useLearning.ts
│   │       └── router/                 # ← 修改：添加路由
│   └── main.py                          # AstrBot 入口
│
├── dev_docs/                             # 开发文档
├── docs/                                 # 黑客松规划文档
└── README.md
```

---

## 1.4 初始化清单

### Python 后端

```bash
# 进入 AstrBot 目录
cd ai-learning/AstrBot

# 安装依赖
pip install -e .
# 或
pip install -r requirements.txt

# 启动 AstrBot
python main.py
# 访问 http://localhost:6185 进入管理面板
```

### 配置（通过 AstrBot 管理面板）

1. **添加 LLM Provider**：硅基流动 API Key + 选择 DeepSeek-V3
2. **创建 Persona**：`math-tutor-gentle` (温和) + `math-tutor-strict` (严格)
3. **平台接入**（可选）：配置飞书机器人

### 前端开发

```bash
# 前端开发模式
cd AstrBot/dashboard
pnpm install
pnpm dev
# 访问 http://localhost:5173
```

---

## 1.5 数据库扩展（在 po.py 中新增）

```python
# astrbot/core/db/po.py — 学习系统扩展表

class Student(TimestampMixin, SQLModel, table=True):
    """学生档案"""
    __tablename__ = "students"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    nickname: str = Field(max_length=255, nullable=False)
    avatar_path: str | None = Field(default=None)
    grade: int = Field(nullable=False)              # 年级 1-6
    study_goal: str | None = Field(default=None, sa_type=Text)
    mode: str = Field(default="gentle", max_length=32)
    platform_uid: str | None = Field(default=None, max_length=255, unique=True)

class KnowledgePoint(TimestampMixin, SQLModel, table=True):
    """知识点"""
    __tablename__ = "knowledge_points"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(max_length=255, nullable=False)
    code: str | None = Field(default=None, max_length=64, unique=True)
    grade: int = Field(nullable=False)
    semester: int = Field(default=1)
    unit: int | None = Field(default=None)
    category: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, sa_type=Text)
    difficulty_base: int = Field(default=3)
    parent_id: str | None = Field(default=None, max_length=36)
    sort_order: int = Field(default=0)

class Question(TimestampMixin, SQLModel, table=True):
    """题目"""
    __tablename__ = "questions"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    content: str = Field(sa_type=Text, nullable=False)
    type: str = Field(max_length=32, nullable=False)   # choice/fill/solve
    difficulty: int = Field(nullable=False)
    answer: dict = Field(sa_type=JSON, nullable=False)
    solution_steps: list | None = Field(default=None, sa_type=JSON)
    hints: list | None = Field(default=None, sa_type=JSON)
    error_patterns: list | None = Field(default=None, sa_type=JSON)
    knowledge_ids: list | None = Field(default=None, sa_type=JSON)
    tags: list | None = Field(default=None, sa_type=JSON)
    is_active: bool = Field(default=True)

class KnowledgeMastery(TimestampMixin, SQLModel, table=True):
    """知识掌握度"""
    __tablename__ = "knowledge_mastery"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    student_id: str = Field(nullable=False, index=True)
    knowledge_id: str = Field(nullable=False, index=True)
    mastery_score: float = Field(default=0.0)
    error_types: dict = Field(default_factory=dict, sa_type=JSON)
    forgetting_risk: float = Field(default=0.0)
    last_practiced: datetime | None = Field(default=None)
    evidence_count: int = Field(default=0)

class BehaviorFeatures(TimestampMixin, SQLModel, table=True):
    """行为特征"""
    __tablename__ = "behavior_features"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    student_id: str = Field(nullable=False, unique=True)
    planning_score: float = Field(default=0.5)
    impulsivity: float = Field(default=0.5)
    hint_dependency: float = Field(default=0.5)

class StudentState(TimestampMixin, SQLModel, table=True):
    """实时状态（运行时在内存，会话结束持久化）"""
    __tablename__ = "student_states"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    student_id: str = Field(nullable=False, unique=True)
    attention_level: float = Field(default=0.7)
    fatigue_level: float = Field(default=0.0)
    frustration: float = Field(default=0.0)
    cognitive_load: float = Field(default=0.3)

class LearningSession(TimestampMixin, SQLModel, table=True):
    """学习会话"""
    __tablename__ = "learning_sessions"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    student_id: str = Field(nullable=False, index=True)
    session_type: str = Field(default="learning", max_length=32)
    started_at: datetime = Field(nullable=False)
    ended_at: datetime | None = Field(default=None)
    duration_min: float | None = Field(default=None)
    end_reason: str | None = Field(default=None, max_length=64)
    summary: dict | None = Field(default=None, sa_type=JSON)

class TaskRecord(TimestampMixin, SQLModel, table=True):
    """答题记录"""
    __tablename__ = "task_records"
    id: str = Field(primary_key=True, default_factory=lambda: str(uuid.uuid4()))
    session_id: str | None = Field(default=None, index=True)
    student_id: str = Field(nullable=False, index=True)
    question_id: str | None = Field(default=None)
    student_answer: str | None = Field(default=None, sa_type=Text)
    is_correct: bool | None = Field(default=None)
    error_type: str | None = Field(default=None, max_length=32)
    time_spent_sec: float | None = Field(default=None)
    hint_count: int = Field(default=0)
    attempt_count: int = Field(default=1)
    difficulty: int | None = Field(default=None)
```

---

# 第二部分：核心模块实现

## 2.1 LLM 调用（通过 AstrBot Provider）

```python
# 直接复用 AstrBot 的 Provider Manager，不需要自己写 HTTP 客户端

class QuestionService:
    def __init__(self, core_lifecycle):
        self.core = core_lifecycle
    
    async def call_llm(self, prompt: str) -> str:
        """统一 LLM 调用入口"""
        provider = self.core.provider_manager.get_default_provider()
        result = await provider.text_chat(prompt=prompt)
        return result
    
    async def stream_llm(self, prompt: str):
        """流式 LLM 调用"""
        provider = self.core.provider_manager.get_default_provider()
        async for chunk in provider.stream_chat(prompt=prompt):
            yield chunk
```

> AstrBot Provider Manager 已封装：多模型切换、流式输出、错误重试、Token 统计。
> 管理面板可直接配置硅基流动 API Key 和模型选择。

---

## 2.2 知识图谱与题库

### 六年级数学知识点结构

```
人教版六年级数学
├── 六年级上册
│   ├── 第1单元: 分数乘法
│   ├── 第2单元: 位置与方向(二)
│   ├── 第3单元: 分数除法
│   ├── 第4单元: 比
│   ├── 第5单元: 圆
│   ├── 第6单元: 百分数(一)
│   └── 第7单元: 扇形统计图
└── 六年级下册
    ├── 第1单元: 负数
    ├── 第2单元: 百分数(二)
    ├── 第3单元: 圆柱与圆锥
    ├── 第4单元: 比例
    └── 第5单元: 数学广角——鸽巢问题
```

### 题目数据结构示例

```json
{
  "content": "一个圆的半径是 3cm，求它的面积。（$\\pi$ 取 3.14）",
  "type": "solve",
  "difficulty": 2,
  "answer": { "value": "28.26", "unit": "cm²" },
  "solution_steps": [
    { "step": 1, "content": "写出面积公式", "detail": "$S = \\pi r^2$" },
    { "step": 2, "content": "代入数据", "detail": "$S = 3.14 \\times 3^2 = 3.14 \\times 9$" },
    { "step": 3, "content": "计算结果", "detail": "$S = 28.26$ cm²" }
  ],
  "hints": [
    { "level": 1, "content": "圆的面积公式是什么？" },
    { "level": 2, "content": "面积 = π × 半径²，试试代入" },
    { "level": 3, "content": "S = 3.14 × 3 × 3 = ?" }
  ],
  "knowledge_ids": ["circle-area"],
  "tags": ["圆", "面积", "六年级"]
}
```

### API 路由

```python
# astrbot/dashboard/routes/knowledge_graph.py

@kb_bp.route('/api/knowledge/tree', methods=['GET'])
async def get_knowledge_tree():
    grade = request.args.get('grade', 6, type=int)
    tree = await db.get_knowledge_tree(grade)
    return jsonify(Response().ok(tree).__dict__)

@kb_bp.route('/api/knowledge/<kp_id>/questions', methods=['GET'])
async def get_related_questions(kp_id: str):
    questions = await db.get_questions(knowledge_ids=[kp_id], limit=20)
    return jsonify(Response().ok(questions).__dict__)
```

### 判题错因分类

| 类型 | code | 小学常见示例 |
|------|------|------------|
| 概念错误 | conceptual | 把减法用成加法、不理解"几倍" |
| 步骤错误 | procedural | 竖式计算进位遗漏 |
| 粗心错误 | careless | 抄错数字、漏掉单位 |
| 策略错误 | strategic | 应用题不会列算式 |

---

## 2.3 学生模型

### MVP 实现范围

| 层 | 状态 | 说明 |
|----|------|------|
| A. 知识层 | ✅ | BKT 掌握度 + 遗忘曲线 |
| B. 行为层 | ✅ | 基础 3 项指标 |
| C. 状态层 | ✅ | 实时 4 维状态 |
| D. 兴趣层 | ⚠️ | 手动设置 |
| E. 认知层 | ❌ | V2 |
| F. 策略层 | ⚠️ | 仅记录 |

### 知识层更新 — BKT 扩展

```python
# astrbot/core/learning/student_model.py

def update_mastery(current: float, is_correct: bool, 
                   hint_count: int = 0, attempt_count: int = 1, 
                   difficulty: int = 3) -> float:
    """贝叶斯知识追踪更新"""
    p_learn = 0.1
    p_guess = 0.25
    p_slip = 0.1
    
    weight = _calculate_weight(hint_count, attempt_count, difficulty)
    
    if is_correct:
        p_correct = current * (1.0 - p_slip) + (1.0 - current) * p_guess
        posterior = current * (1.0 - p_slip) / p_correct
        updated = posterior + (1.0 - posterior) * p_learn
    else:
        p_wrong = current * p_slip + (1.0 - current) * (1.0 - p_guess)
        updated = current * p_slip / p_wrong
    
    return max(0.0, min(1.0, current + (updated - current) * weight))

def _calculate_weight(hint_count, attempt_count, difficulty):
    w = 1.0
    if hint_count > 0: w *= 0.7
    if attempt_count > 1: w *= 0.8
    w *= 0.8 + difficulty * 0.1
    return max(0.3, min(1.5, w))
```

### 遗忘曲线

```python
import math
from datetime import datetime

def forgetting_risk(last_practiced: datetime, mastery: float) -> float:
    """艾宾浩斯遗忘风险"""
    days = (datetime.now() - last_practiced).total_seconds() / 86400
    half_life = 3.0 + mastery * 14.0
    retention = math.exp(-0.693 * days / half_life)
    return 1.0 - retention
```

### 状态层实时更新

```python
# 内存缓存
_state_cache: dict[str, dict] = {}

def update_state(student_id: str, event_type: str, event_data: dict = {}) -> dict:
    """实时更新学生状态"""
    state = _state_cache.get(student_id, {
        'attention_level': 0.7, 'fatigue_level': 0.0,
        'frustration': 0.0, 'cognitive_load': 0.3,
    })
    
    if event_type == 'answer_correct':
        state['frustration'] = max(0, state['frustration'] - 0.1)
        state['attention_level'] = min(1, state['attention_level'] + 0.05)
    elif event_type == 'answer_wrong':
        state['frustration'] = min(1, state['frustration'] + 0.15)
        if event_data.get('consecutive_errors', 0) > 2:
            state['frustration'] = min(1, state['frustration'] + 0.1)
    elif event_type == 'hint_request':
        state['cognitive_load'] = min(1, state['cognitive_load'] + 0.1)
    elif event_type == 'time_tick':
        session_min = event_data.get('session_duration', 0)
        max_dur = 30  # 六年级上限
        state['fatigue_level'] = min(1, session_min / max_dur * 0.8)
    
    _state_cache[student_id] = state
    return state
```

### API 路由

```python
# astrbot/dashboard/routes/student.py

@student_bp.route('/api/student/<sid>/profile', methods=['GET'])
async def get_student_profile(sid: str):
    student = await db.get_student(sid)
    masteries = await db.get_student_masteries(sid)
    state = get_student_state(sid)
    weak_points = await db.get_weak_points(sid, limit=5)
    return jsonify(Response().ok({
        'student': student.dict(),
        'mastery': [m.dict() for m in masteries],
        'state': state,
        'weak_points': [w.dict() for w in weak_points],
    }).__dict__)

@student_bp.route('/api/student/<sid>/state', methods=['GET'])
async def get_state(sid: str):
    state = get_student_state(sid)
    return jsonify(Response().ok(state).__dict__)

@student_bp.route('/api/student/<sid>/weak-points', methods=['GET'])
async def get_weak_points(sid: str):
    limit = request.args.get('limit', 10, type=int)
    points = await db.get_weak_points(sid, limit=limit)
    return jsonify(Response().ok([p.dict() for p in points]).__dict__)
```

---

## 2.4 决策引擎 + 学习主引擎

### 三层决策

```python
# astrbot/core/learning/decision_engine.py

class DecisionEngine:
    async def decide_next(self, student_id: str, session: dict) -> dict:
        state = get_student_state(student_id)
        student = await self.db.get_student(student_id)
        
        # 层1: 硬规则
        if state.get('fatigue_level', 0) > 0.8:
            return {'action': 'wind_down', 'reasoning': '疲劳度过高'}
        if session.get('duration_min', 0) > 30:
            return {'action': 'end', 'reasoning': '已超过建议学习时长'}
        if state.get('frustration', 0) > 0.7 and session.get('consecutive_errors', 0) > 3:
            return {'action': 'rest', 'reasoning': '连续受挫，建议休息'}
        if state.get('cognitive_load', 0) > 0.85:
            return {'action': 'practice', 'difficulty': 1, 'reasoning': '认知负荷高'}
        
        # 层2: 策略选择
        behavior = await self.db.get_behavior_features(student_id)
        hint_strategy = 'light' if behavior and behavior.hint_dependency > 0.6 else 'guided'
        
        # 层3: 内容选择
        forgetting = await self.db.get_forgetting_risks(student_id, threshold=0.6)
        if forgetting and session.get('review_count', 0) < 2:
            return {'action': 'review', 'knowledge_id': forgetting[0].knowledge_id,
                    'hint_strategy': hint_strategy, 'reasoning': '遗忘风险高，安排复习'}
        
        if state.get('attention_level', 0.5) > 0.5 and state.get('cognitive_load', 0.3) < 0.6:
            kp = await self._select_next_knowledge(student_id)
            return {'action': 'new_content', 'knowledge_id': kp.id,
                    'hint_strategy': hint_strategy, 'reasoning': f'推进新知识: {kp.name}'}
        
        weak = await self._get_weakest_mastered(student_id)
        return {'action': 'practice', 'knowledge_id': weak.knowledge_id,
                'difficulty': 2, 'hint_strategy': hint_strategy, 'reasoning': '巩固练习'}
```

### 学习流程

```
[开始会话]
  → 获取学生画像
  → 决策引擎: 第一个任务
  → 循环:
      ├── 展示任务 (讲解/题目)
      ├── 用户作答
      ├── 判题 + 反馈
      ├── 更新学生模型
      ├── 检查节奏 (时间/状态)
      │   ├── 正常 → 决策下一个任务
      │   ├── 需休息 → 触发休息/对话
      │   └── 该收束 → 进入总结
      └── 生成会话总结
  → [结束]
```

### API 路由

```python
# astrbot/dashboard/routes/learning.py

@learning_bp.route('/api/learning/session', methods=['POST'])
async def start_session():
    """开始学习会话 → 返回第一个任务"""
    data = await request.get_json()
    student_id = data['student_id']
    
    session = LearningSession(student_id=student_id, started_at=datetime.now())
    session = await db.create_session(session)
    
    decision = await decision_engine.decide_next(student_id, {'duration_min': 0})
    first_task = await generate_task(decision)
    
    return jsonify(Response().ok({
        'session_id': session.id,
        'first_task': first_task,
        'decision': decision,
    }).__dict__)

@learning_bp.route('/api/learning/answer', methods=['POST'])
async def submit_answer():
    """提交答案 → 判题 → 模型更新 → 下一题"""
    data = await request.get_json()
    
    question = await db.get_question(data['question_id'])
    evaluation = await question_service.evaluate_answer(question, data['answer'])
    
    await update_student_model(data['student_id'], question, evaluation,
                               data.get('time_spent_sec', 0), data.get('hint_count', 0))
    
    await db.create_task_record(TaskRecord(
        session_id=data['session_id'], student_id=data['student_id'],
        question_id=data['question_id'], student_answer=data['answer'],
        is_correct=evaluation['is_correct'], error_type=evaluation.get('error_type'),
        time_spent_sec=data.get('time_spent_sec'), hint_count=data.get('hint_count', 0),
    ))
    
    session_info = await build_session_info(data['session_id'])
    next_decision = await decision_engine.decide_next(data['student_id'], session_info)
    next_task = await generate_task(next_decision)
    feedback = generate_feedback(evaluation)
    
    return jsonify(Response().ok({
        'evaluation': evaluation, 'feedback': feedback,
        'next_task': next_task, 'decision': next_decision,
    }).__dict__)

@learning_bp.route('/api/learning/hint/<task_id>', methods=['GET'])
async def get_hint(task_id: str):
    """获取分层提示"""
    level = request.args.get('level', 1, type=int)
    question = await db.get_question(task_id)
    hints = [h for h in (question.hints or []) if h['level'] <= level]
    return jsonify(Response().ok({'hints': hints}).__dict__)

@learning_bp.route('/api/learning/session/<sid>/end', methods=['PUT'])
async def end_session(sid: str):
    """结束会话 → 返回总结"""
    session = await db.end_session(sid, {'reason': 'user_exit'})
    return jsonify(Response().ok(session.dict()).__dict__)
```

### 反馈文案规则

**小学生友好 + 非评判**：

```
✅ 答对:
  "这道题你自己做出来了，棒！"
  "思路很清晰，继续保持。"

❌ 答错（行为描述式）:
  "这一步的减法，个位不够减需要向十位借 1 哦。我们一起再看看。"
  "这道题是用减法来算的。'给了别人'就是变少了，对吧？"

⚠️ 禁止:
  "你又错了" / "太简单了你都不会" / "你真聪明"
```

---

## 2.5 节奏控制

### 时长分层

| 年级 | 单次上限 | 预警时间 |
|------|---------|---------
| 5-6 年级 | 25-30 min | 提前 5 min |

> MVP 仅配置六年级。

### 四段收束

```
阶段 1: 预告 → "我们今天差不多啦，再做一道总结题。"
阶段 2: 收尾 → 一道简单回顾题或一句话总结
阶段 3: 结束 → "今天学了XX，做得不错！"
阶段 4: 引导 → 结束 / 轻复习 / 明天继续
         → 坚持继续 → 降级模式
```

### 对话硬控制

| 规则 | 值 |
|------|---|
| 单次上限 | 3-5 分钟 |
| 每日总上限 | 20 分钟 |
| 冷却间隔 | 15 分钟 |

---

## 2.6 专属导师插件

```python
# astrbot/builtin_stars/dedicated_tutor/main.py

from astrbot.api.star import Star, register

class DedicatedTutor(Star):
    """专属导师插件 — 处理 IM 命令 + 初始化题库"""
    
    @register("command", "start", "开始学习")
    async def cmd_start(self, event):
        student = await self._get_or_create_student(event)
        session = await learning_service.start_session(student.id)
        await event.reply(f"📚 开始学习！\n\n{format_task(session['first_task'])}")
    
    @register("command", "goal", "设定学习目标")
    async def cmd_goal(self, event):
        goal = event.get_text()
        student = await self._get_student(event)
        student.study_goal = goal
        await db.update_student(student)
        await event.reply(f"✅ 目标已设定: {goal}")
    
    @register("command", "plan", "查看学习计划")
    async def cmd_plan(self, event):
        student = await self._get_student(event)
        profile = await build_student_profile(student.id)
        plan = await generate_plan_with_llm(profile)
        await event.reply(plan)
    
    @register("command", "checkin", "签到")
    async def cmd_checkin(self, event):
        student = await self._get_student(event)
        state = get_student_state(student.id)
        report = format_checkin_report(student, state)
        await event.reply(report)
    
    @register("command", "mode", "切换模式 (gentle/strict)")
    async def cmd_mode(self, event):
        mode = event.get_text().strip() or 'gentle'
        student = await self._get_student(event)
        student.mode = mode
        await db.update_student(student)
        persona_id = f'math-tutor-{mode}'
        # 切换 AstrBot Persona
        await event.reply(f"✅ 已切换为 {'严格' if mode == 'strict' else '温和'} 模式")
```

---

# 第三部分：Prompt 模板（核心）

## 系统人格（AstrBot Persona 配置）

```
你是一个小学数学学习搭子。你的目标是帮助小学生更好地理解数学。

核心规则：
1. 永远不要给学生贴标签
2. 用行为描述替代能力定性
3. 用简单、活泼、易懂的语言（学生是小学生）
4. 引导思考，不直接给答案
5. 用"我们"而非"我来教你"
6. 允许学生休息和离开

绝对禁止：
- "你很笨" / "太简单了" / "你又错了"
- "我一直在陪你" / "只有我理解你"
- 任何心理诊断或人格判断

风格：亲切、鼓励、有耐心，像一个会数学的好朋友
```

## 判题 Prompt

```
你是小学数学老师。分析学生答案：

题目：{question}
标准答案：{answer}
学生答案：{student_answer}
学生年级：{grade}年级

请判断：
1. 是否正确 (true/false)
2. 错误类型 (conceptual/procedural/careless/strategic)
3. 哪一步出错
4. 用小学生听得懂的话给出反馈（不评判，只描述和引导）

输出 JSON: { "is_correct": bool, "error_type": str, "error_step": str, "feedback": str }
```

## 对话 Prompt

```
你是学生的学习搭子，进入轻量调节对话。

学生年级：{grade}年级
疲劳度：{fatigue}
连续错误：{errors}
本次学习：{duration}分钟

目标：1.了解状态 2.轻松聊几句 3.在 3 轮内自然收束回学习
语言：简单、活泼、小学生能听懂
禁止：心理诊断、情感绑定、无限扩展
```

---

# 第四部分：48h 执行排期

| 时段 | 主要任务 | 交付物 |
|------|---------|--------|
| **0-2h** | 数据库扩展：po.py 加 7 张表 | DB 可建表 |
| **2-4h** | sqlite.py 加 CRUD 方法 | 数据可读写 |
| **4-8h** | 学习服务层：BKT + 决策引擎 + 出题服务 | 核心逻辑可运行 |
| **8-12h** | Dashboard 新路由 4 文件 + 注册到 server.py | API 可调用 |
| **12-14h** | 硬编码 30-50 道六年级数学题 | 题库可用 |
| **14-20h** | Vue：学习仪表盘页（画像+雷达图+进度） | 首页可看 |
| **20-26h** | Vue：对话页（复用 LiveChat + 命令栏） | 对话可用 |
| **26-32h** | Vue：学习会话页（出题/答题/反馈流程） | 核心交互可用 |
| **32-36h** | Vue：知识图谱可视化 | 热力图可看 |
| **36-40h** | 样式打磨 + Vuetify 主题定制 | 视觉惊艳 |
| **40-44h** | 前后端联调 + AstrBot 专属导师插件对接 | 全链路通 |
| **44-46h** | Bug fix + 边界处理 | 稳定 |
| **46-48h** | 演示准备 + 封板 | 可演示 |

---

# 第五部分：验收标准

## 核心功能

- [ ] 能按六年级知识点体系出题
- [ ] AI 判题错因分类准确（LLM 返回可解析 JSON）
- [ ] 提示分 3 层，从引导到具体
- [ ] 问答/讲解流式输出，符合"学习搭子"风格

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

## 专属导师命令

- [ ] /start /goal /plan /checkin /mode 可用
- [ ] Web 端和飞书端命令行为一致
- [ ] strict/gentle 模式差异可观察

## 双通道一致性

- [ ] Web 端仪表盘数据实时更新
- [ ] 飞书端与 Web 端共享学生数据
- [ ] 知识图谱可视化可展示

## 安全

- [ ] 所有 AI 输出无禁用词
- [ ] 无人格判断/情感绑定
- [ ] 敏感内容触发升级提示
