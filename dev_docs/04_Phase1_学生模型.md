# Phase 1 — 学生模型

> MVP 阶段核心：搭建学生模型 6 层画像（简化版）。  
> 对应模块 ④ 学生模型 + ⑤ 数据采集层（基础）。  
> **使用 Python 实现，数据存储在 AstrBot SQLite 中。**

---

## 一、学生模型总览

学生模型是整个系统的**中枢**。所有学习数据最终都要回流更新学生模型，所有教学决策都从学生模型读取。

### MVP 简化策略

| 层级 | MVP 实现 | 完整版（V2+） |
|------|---------|---------------|
| A. 知识层 | ✅ 完整实现 | 增加向量化 |
| B. 行为层 | ✅ 基础指标 | 增加过程数据分析 |
| C. 状态层 | ✅ 简化实现 | 增加多信号融合 |
| D. 兴趣层 | ⚠️ 仅支持手动设置 | 对话自动提取 |
| E. 认知层 | ❌ 暂不实现 | V2 棋类+挑战后 |
| F. 策略层 | ⚠️ 仅记录，不优化 | V2 增加策略优化 |

---

## 二、A. 知识层（核心）

### 2.1 设计目标
回答"学生会不会"—— 每个知识点的掌握概率。

### 2.2 核心字段

| 字段 | 类型 | 说明 |
|------|------|------|
| mastery_score | float 0~1 | 掌握概率（非0/1二值） |
| error_types | dict(JSON) | 错误类型分布 {conceptual:3, careless:1} |
| forgetting_risk | float 0~1 | 遗忘风险（基于时间衰减） |
| last_practiced | datetime | 上次练习时间 |
| evidence_count | int | 累积证据数量 |

### 2.3 更新算法 — 贝叶斯知识追踪 (BKT 扩展)

```python
# astrbot/core/learning/student_model.py

def update_mastery(current: float, is_correct: bool, 
                   hint_count: int = 0, attempt_count: int = 1, 
                   difficulty: int = 3) -> float:
    """BKT 更新掌握度"""
    # BKT 参数
    p_learn = 0.1       # 从不会到会的转移概率
    p_guess = 0.25      # 猜对概率
    p_slip = 0.1        # 失误概率（会但做错）
    
    # 权重调节因子
    weight = _calculate_weight(hint_count, attempt_count, difficulty)
    
    if is_correct:
        p_correct = current * (1.0 - p_slip) + (1.0 - current) * p_guess
        posterior = current * (1.0 - p_slip) / p_correct
        updated = posterior + (1.0 - posterior) * p_learn
    else:
        p_wrong = current * p_slip + (1.0 - current) * (1.0 - p_guess)
        updated = current * p_slip / p_wrong
    
    return max(0.0, min(1.0, current + (updated - current) * weight))


def _calculate_weight(hint_count: int, attempt_count: int, difficulty: int) -> float:
    """计算权重调节因子"""
    w = 1.0
    # 用了提示 → 权重降低
    if hint_count > 0:
        w *= 0.7
    # 多次尝试 → 权重降低
    if attempt_count > 1:
        w *= 0.8
    # 难度越高，单次证据权重越大
    w *= 0.8 + difficulty * 0.1
    return max(0.3, min(1.5, w))
```

### 2.4 遗忘曲线

```python
import math
from datetime import datetime

def calculate_forgetting_risk(last_practiced: datetime, mastery_score: float) -> float:
    """艾宾浩斯遗忘风险"""
    days_since = (datetime.now() - last_practiced).total_seconds() / 86400
    # 掌握越好，半衰期越长（3~17天）
    half_life = 3.0 + mastery_score * 14.0
    retention = math.exp(-0.693 * days_since / half_life)
    return 1.0 - retention  # 遗忘风险
```

---

## 三、B. 行为层

### 3.1 设计目标
回答"学生是怎么学的"—— 解题习惯和策略特征。

### 3.2 核心指标

| 指标 | 计算方式 | MVP实现 |
|------|---------|---------
| planning_score | 是否先整理条件再计算 | ✅ 基于解题时间分布 |
| impulsivity | 快速提交 + 错误率 | ✅ 基于 time/accuracy |
| hint_dependency | 提示使用频率 | ✅ hint_count 统计 |
| trial_error_ratio | 尝试次数分布 | ✅ attempt_count |

### 3.3 更新逻辑（滑动窗口）

```python
def update_behavior(current: dict, recent_tasks: list[dict]) -> dict:
    """基于最近 N 个任务更新行为特征"""
    window = recent_tasks[-20:]  # 取最近 20 个任务
    
    impulsivity = _calculate_impulsivity(window)
    hint_dependency = _calculate_hint_dependency(window)
    planning_score = _calculate_planning(window)
    
    # 指数移动平均平滑
    alpha = 0.3  # 新数据权重
    return {
        'impulsivity': _ema(current.get('impulsivity', 0.5), impulsivity, alpha),
        'hint_dependency': _ema(current.get('hint_dependency', 0.5), hint_dependency, alpha),
        'planning_score': _ema(current.get('planning_score', 0.5), planning_score, alpha),
    }


def _calculate_impulsivity(tasks: list[dict]) -> float:
    """快速提交(<30秒) + 错误 → 冲动"""
    if not tasks:
        return 0.5
    fast_wrong = sum(1 for t in tasks if t['time_spent_sec'] < 30 and not t['is_correct'])
    return fast_wrong / len(tasks)


def _calculate_hint_dependency(tasks: list[dict]) -> float:
    """提示使用频率"""
    if not tasks:
        return 0.5
    hint_used = sum(1 for t in tasks if t['hint_count'] > 0)
    return hint_used / len(tasks)


def _ema(old: float, new: float, alpha: float) -> float:
    """指数移动平均"""
    return old * (1 - alpha) + new * alpha
```

---

## 四、C. 状态层

### 4.1 设计目标
回答"学生当前处于什么状态"—— 短期波动，高频更新。

### 4.2 核心信号

| 指标 | 信号来源 | 阈值 |
|------|---------|------|
| attention_level | 响应速度变化、连续正确 | < 0.3 → 需关注 |
| fatigue_level | 学习时长、错误率上升 | > 0.7 → 建议休息 |
| frustration | 连续错误、放弃行为 | > 0.6 → 需干预 |
| cognitive_load | 任务难度 + 时间压力 | > 0.8 → 降难度 |

### 4.3 更新逻辑（内存缓存）

```python
# 运行时状态缓存（Python 内存 dict）
_state_cache: dict[str, dict] = {}

def update_state(student_id: str, event_type: str, event_data: dict) -> dict:
    """实时更新学生状态"""
    state = _state_cache.get(student_id, {
        'attention_level': 0.7,
        'fatigue_level': 0.0,
        'frustration': 0.0,
        'cognitive_load': 0.3,
    })
    
    if event_type == 'answer_correct':
        state['frustration'] = max(0, state['frustration'] - 0.1)
        state['attention_level'] = min(1, state['attention_level'] + 0.05)
    
    elif event_type == 'answer_wrong':
        state['frustration'] = min(1, state['frustration'] + 0.15)
        consecutive_errors = event_data.get('consecutive_errors', 0)
        if consecutive_errors > 2:
            state['frustration'] = min(1, state['frustration'] + 0.1)
    
    elif event_type == 'hint_request':
        state['cognitive_load'] = min(1, state['cognitive_load'] + 0.1)
    
    elif event_type == 'long_pause':  # 停顿 > 60s
        state['attention_level'] = max(0, state['attention_level'] - 0.1)
    
    elif event_type == 'time_tick':  # 每 5 分钟
        session_min = event_data.get('session_duration', 0)
        max_dur = _max_duration(event_data.get('grade', 6))
        state['fatigue_level'] = min(1, session_min / max_dur * 0.8)
    
    _state_cache[student_id] = state
    return state


def _max_duration(grade: int) -> int:
    """年级对应最大学习时长（分钟）"""
    if grade <= 2:
        return 20
    elif grade <= 4:
        return 25
    else:
        return 30
```

### 4.4 存储策略
- **运行时**：Python dict 缓存（读写高频）
- **持久化**：每个会话结束时写入 SQLite `student_states` 表

---

## 五、D. 兴趣层（MVP 简化）

### MVP 实现
- 注册时选择偏好主题
- 手动设置讲解风格
- 暂不自动提取

```python
# InterestProfile 表字段
topic_prefs: dict    # {"sports": 0.8, "scifi": 0.6}
explanation_style: str  # "formal" | "story" | "analogy" | "balanced"
```

---

## 六、F. 策略层（MVP 简化）

### MVP 实现
- 仅记录每次使用的策略和效果
- 不做自动优化

```python
# 每次教学交互后记录
await db.create_strategy_record(StrategyHistory(
    student_id=student_id,
    strategy_type='hint_style',
    strategy_value='step_by_step',
    success_rate=1.0 if task_after_hint_correct else 0.0,
    sample_count=1,
))
```

---

## 七、API 设计

```
# 获取完整画像
GET    /api/student/<id>/profile
       response: {
           student: { nickname, grade, mode, ... },
           knowledge: { points: [...], weak_areas: [...] },
           behavior: { planning: 0.6, impulsivity: 0.3, ... },
           state: { attention: 0.7, fatigue: 0.2, ... },
           interest: { topics: {...}, style: "..." },
       }

# 获取当前状态（从内存缓存）
GET    /api/student/<id>/state
       response: { attention, fatigue, frustration, cognitive_load }

# 推送行为事件（触发模型更新）
POST   /api/student/<id>/event
       body: { event_type, data }

# 获取知识薄弱点
GET    /api/student/<id>/weak-points?limit=10
       response: [{ knowledge_id, mastery, forgetting_risk, error_types }]
```

---

## 八、开发任务清单

### 阶段 1：知识层 + 行为层（~3h）
- [ ] 实现 update_mastery() BKT 算法
- [ ] 实现 calculate_forgetting_risk()
- [ ] 实现 update_behavior() 滑动窗口
- [ ] 在 sqlite.py 中实现 mastery CRUD
- [ ] 创建 student.py 路由

### 阶段 2：状态层 + 整合（~3h）
- [ ] 实现状态内存缓存 + 实时更新
- [ ] 实现事件驱动：答题 → 模型更新管线
- [ ] 实现 /profile API 聚合所有层
- [ ] 实现会话结束 → 持久化状态
- [ ] 集成测试：答题→判题→模型更新→画像查询

---

## 九、验收标准

- [ ] 答对题目后 mastery_score 上升，答错下降
- [ ] 用了提示的正确答案权重低于独立完成
- [ ] 长时间未练习的知识点 forgetting_risk 上升
- [ ] 连续答错后 frustration 上升，答对后下降
- [ ] 学习时长增加后 fatigue 上升
- [ ] 快速提交+答错会增加 impulsivity 分数
- [ ] 频繁使用提示 hint_dependency 上升
- [ ] 所有模型字段更新在 100ms 内完成
