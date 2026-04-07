# Phase 1 — 决策引擎与学习主引擎

> 对应模块 ③ 学习主引擎 + ⑥ 教学决策引擎（规则版）。  
> 系统的"大脑"：决定学什么、怎么学、什么时候停。  
> **Python 实现，调用 AstrBot LLM Provider 生成内容。**

---

## 一、教学决策引擎

### 1.1 定位
> 从"推荐题目"升级为"控制学习过程"

传统系统只做：答对→升难度→答错→降难度。  
本系统决策：学什么 / 怎么学 / 用什么方式 / 提示多少 / 是否休息。

### 1.2 决策输入

| 来源 | 数据 |
|------|------|
| 知识层 | 掌握度、遗忘风险、薄弱点 |
| 行为层 | 规划能力、提示依赖、冲动程度 |
| 状态层 | 注意力、疲劳、挫败、认知负荷 |
| 兴趣层 | 偏好主题、讲解风格 |
| 会话上下文 | 已做题数、正确率、用时 |
| 策略层 | 历史有效策略 |

### 1.3 决策输出

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class DecisionResult:
    action: str     # new_content | review | practice | reinforce | rest | chat | wind_down | end
    knowledge_id: Optional[str] = None
    difficulty: Optional[int] = None
    hint_strategy: str = 'guided'       # none | light | guided | step_by_step
    explanation_style: Optional[str] = None
    task_type: str = 'question'         # question | explain | discuss
    reasoning: str = ''                 # 决策理由（可解释性）
```

### 1.4 三层决策逻辑

```python
# astrbot/core/learning/decision_engine.py

class DecisionEngine:
    def __init__(self, db):
        self.db = db
    
    async def decide_next(self, student_id: str, session: dict) -> DecisionResult:
        """三层决策"""
        state = get_student_state(student_id)
        student = await self.db.get_student(student_id)
        
        # 层1: 硬规则（不可违反）
        hard = self._check_hard_rules(state, session, student)
        if hard:
            return hard
        
        # 层2: 策略选择
        strategy = await self._select_strategy(student_id)
        
        # 层3: 内容选择
        return await self._select_content(student_id, session, state, strategy)
```

#### 层级 1：硬规则（不可违反）

```python
def _check_hard_rules(self, state: dict, session: dict, student) -> Optional[DecisionResult]:
    # 疲劳过高
    if state.get('fatigue_level', 0) > 0.8:
        return DecisionResult(action='wind_down', reasoning='疲劳度过高，进入收束')
    
    # 超时
    duration = session.get('duration_min', 0)
    max_dur = _max_duration(student.grade)
    if duration > max_dur:
        return DecisionResult(action='end', reasoning='已超过建议学习时长')
    
    # 严重挫败
    if state.get('frustration', 0) > 0.7 and session.get('consecutive_errors', 0) > 3:
        return DecisionResult(action='rest', reasoning='连续受挫，建议休息')
    
    # 认知过载
    if state.get('cognitive_load', 0) > 0.85:
        return DecisionResult(
            action='practice', difficulty=1,
            reasoning='认知负荷过高，切换低难度巩固'
        )
    
    return None
```

#### 层级 2：策略选择

```python
async def _select_strategy(self, student_id: str) -> dict:
    behavior = await self.db.get_behavior_features(student_id)
    
    return {
        # 提示依赖高 → 减少提示
        'hint_strategy': 'light' if behavior.hint_dependency > 0.6 else 'guided',
        # 冲动度高 → 强制停顿
        'require_pause': behavior.impulsivity > 0.6,
        # 规划弱 → 先问思路
        'require_plan_first': behavior.planning_score < 0.4,
    }
```

#### 层级 3：内容选择

```python
async def _select_content(self, student_id, session, state, strategy) -> DecisionResult:
    # 1. 先检查遗忘风险
    forgetting = await self.db.get_forgetting_risks(student_id, threshold=0.6)
    if forgetting and session.get('review_count', 0) < 2:
        target = forgetting[0]
        return DecisionResult(
            action='review',
            knowledge_id=target.knowledge_id,
            reasoning=f'{target.knowledge_id} 遗忘风险高，安排复习'
        )
    
    # 2. 状态良好 → 推进新知识
    if state.get('attention_level', 0.5) > 0.5 and state.get('cognitive_load', 0.3) < 0.6:
        kp = await self._select_next_knowledge(student_id)
        return DecisionResult(
            action='new_content',
            knowledge_id=kp.id,
            difficulty=self._adapt_difficulty(state, kp),
            reasoning=f'注意力良好，推进新知识点: {kp.name}'
        )
    
    # 3. 状态一般 → 巩固
    weak = await self._get_weakest_mastered(student_id)
    return DecisionResult(
        action='practice',
        knowledge_id=weak.knowledge_id,
        difficulty=2 if weak.mastery_score < 0.5 else 3,
        reasoning=f'状态一般，巩固 {weak.knowledge_id}'
    )
```

### 1.5 决策 API

```
POST   /api/learning/decision
       body: { student_id, session_id }
       response: {
           action: "new_content",
           knowledge_id: "...",
           difficulty: 3,
           hint_strategy: "guided",
           reasoning: "注意力良好，推进圆的面积"
       }
```

---

## 二、学习主引擎

### 2.1 定位
把决策引擎的"指令"转化成具体的学习任务。

### 2.2 学习流程状态机

```
[开始] 
  → WarmUp (热身/回顾)
  → Practice (练习)
  → WindDown (收束总结)
  → [结束]
```

> MVP 简化：去掉 NewContent/Assessment/Reinforce/LightBreak，合并为 Practice 统一处理。

### 2.3 会话管理

```python
# astrbot/dashboard/routes/learning.py

@learning_bp.route('/api/learning/session', methods=['POST'])
async def start_session():
    """开始学习会话"""
    data = await request.get_json()
    student_id = data['student_id']
    
    # 1. 获取学生画像
    student = await db.get_student(student_id)
    
    # 2. 创建会话
    session = LearningSession(
        student_id=student_id,
        session_type='learning',
        started_at=datetime.now(),
        initial_state=get_student_state(student_id),
    )
    session = await db.create_session(session)
    
    # 3. 决策第一个任务
    decision = await decision_engine.decide_next(student_id, {'duration_min': 0})
    
    # 4. 生成具体任务
    first_task = await generate_task(decision)
    
    return jsonify({
        'session': session.dict(),
        'first_task': first_task,
        'decision': asdict(decision),
    })
```

### 2.4 任务生成

```python
async def generate_task(decision: DecisionResult) -> dict:
    """根据决策生成具体任务"""
    if decision.action == 'new_content' and decision.task_type == 'explain':
        content = []
        async for chunk in question_service.generate_explanation(
            decision.knowledge_id, ...
        ):
            content.append(chunk)
        return {'type': 'explanation', 'content': ''.join(content)}
    
    elif decision.action in ('review', 'practice', 'reinforce'):
        question = await question_service.select_question(
            knowledge_ids=[decision.knowledge_id],
            difficulty=decision.difficulty,
        )
        return {
            'type': 'question',
            'question': question.dict(),
            'hint_strategy': decision.hint_strategy,
        }
    
    elif decision.action == 'rest':
        return {'type': 'break', 'duration': 5, 'message': '休息一下吧 ☕'}
    
    elif decision.action == 'wind_down':
        return {'type': 'summary', 'message': '我们来总结一下今天学了什么'}
    
    else:
        return {'type': 'end', 'message': '今天的学习先到这里'}
```

### 2.5 提交答案后的流转

```python
@learning_bp.route('/api/learning/answer', methods=['POST'])
async def submit_answer():
    """提交答案 → 判题 → 模型更新 → 下一题"""
    data = await request.get_json()
    
    # 1. 判题
    question = await db.get_question(data['question_id'])
    evaluation = await question_service.evaluate_answer(
        question, data['answer'], data.get('time_spent_sec', 0)
    )
    
    # 2. 更新学生模型
    await update_student_model(
        student_id=data['student_id'],
        question=question,
        evaluation=evaluation,
        time_spent=data.get('time_spent_sec', 0),
        hint_count=data.get('hint_count', 0),
    )
    
    # 3. 记录答题
    await db.create_task_record(TaskRecord(
        session_id=data['session_id'],
        student_id=data['student_id'],
        question_id=data['question_id'],
        student_answer=data['answer'],
        is_correct=evaluation['is_correct'],
        error_type=evaluation.get('error_type'),
        time_spent_sec=data.get('time_spent_sec'),
        hint_count=data.get('hint_count', 0),
    ))
    
    # 4. 决策下一步
    session_info = await build_session_info(data['session_id'])
    next_decision = await decision_engine.decide_next(data['student_id'], session_info)
    next_task = await generate_task(next_decision)
    
    # 5. 生成反馈
    feedback = generate_feedback(evaluation)
    
    return jsonify({
        'evaluation': evaluation,
        'feedback': feedback,
        'next_task': next_task,
        'decision': asdict(next_decision),
    })
```

### 2.6 完整 API

```
POST   /api/learning/session              开始学习会话
POST   /api/learning/answer               提交答案
GET    /api/learning/hint/<task_id>        获取提示
PUT    /api/learning/session/<id>/end      结束会话
GET    /api/learning/session/<id>          获取会话详情
GET    /api/learning/history/<student_id>  获取学习历史
```

---

## 三、反馈生成

### 3.1 安全表达规则

所有反馈必须遵循三条铁律（非诊断、非评判、有方向）。

### 3.2 反馈逻辑

```python
def generate_feedback(evaluation: dict) -> str:
    """生成安全的反馈文案"""
    if evaluation['is_correct']:
        return "这道题你独立完成了，思路很清晰 👍"
    else:
        error_type = evaluation.get('error_type', 'unknown')
        templates = {
            'conceptual': "这个概念的理解还可以再巩固一下，我们换个角度看看。",
            'procedural': "计算过程中有个小弯，我们一起检查一下步骤。",
            'careless': "答案离正确就差一点点，再仔细看看数字和符号。",
            'strategic': "这种题有另一种更稳的方法，我们试试？",
        }
        return templates.get(error_type, evaluation.get('feedback', '我们一起看看这道题。'))
```

---

## 四、开发任务清单

### 阶段 1：决策引擎（~4h）
- [ ] 实现 DecisionEngine 类
- [ ] 实现硬规则层
- [ ] 实现内容选择（遗忘复习/新知识/巩固）
- [ ] 实现 _adapt_difficulty 自适应难度
- [ ] 决策结果含 reasoning

### 阶段 2：学习主引擎（~4h）
- [ ] 实现学习会话 API（start/end）
- [ ] 实现答案提交 → 判题 → 模型更新 → 下一题
- [ ] 实现任务生成
- [ ] 实现反馈生成
- [ ] 端到端集成测试

---

## 五、验收标准

- [ ] 疲劳 > 0.8 时自动进入收束，不推新题
- [ ] 连续错误 > 3 次后建议休息或降难度
- [ ] 有遗忘风险的知识点会被优先安排复习
- [ ] 学生注意力良好时推进新知识
- [ ] 提示依赖高的学生减少主动提示
- [ ] 所有反馈文案无评判性语言
- [ ] 决策结果包含可读的 reasoning 字段
- [ ] 完整学习流程：开始→做题→判题→反馈→下一题→总结→结束
