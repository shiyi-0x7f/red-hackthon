# Phase 1 — 学生模型

> MVP 阶段核心：搭建学生模型 6 层画像（简化版）。  
> 对应模块 ④ 学生模型 + ⑤ 数据采集层（基础）。  
> **Rust 原生实现，数据存储在 SQLite 中，实时状态用 DashMap 缓存。**  
> **预计工期**：W7-W8（2 周）

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
| error_types | JSON | 错误类型分布 {conceptual:3, careless:1} |
| forgetting_risk | float 0~1 | 遗忘风险（基于时间衰减） |
| last_practiced | timestamp | 上次练习时间 |
| evidence_count | int | 累积证据数量 |

### 2.3 更新算法 — 贝叶斯知识追踪 (BKT 扩展)

```rust
/// 贝叶斯知识追踪更新
pub fn update_mastery(current: f64, is_correct: bool, ctx: &TaskContext) -> f64 {
    let p_learn = 0.1;   // 从不会到会的转移概率
    let p_guess = 0.25;  // 猜对概率
    let p_slip = 0.1;    // 失误概率（会但做错）

    let weight = calculate_weight(ctx);

    let updated = if is_correct {
        let p_correct = current * (1.0 - p_slip) + (1.0 - current) * p_guess;
        let posterior = current * (1.0 - p_slip) / p_correct;
        posterior + (1.0 - posterior) * p_learn
    } else {
        let p_wrong = current * p_slip + (1.0 - current) * (1.0 - p_guess);
        current * p_slip / p_wrong
    };

    (current + (updated - current) * weight).clamp(0.0, 1.0)
}

fn calculate_weight(ctx: &TaskContext) -> f64 {
    let mut w = 1.0;
    if ctx.hint_count > 0 { w *= 0.7; }       // 用了提示 → 权重降低
    if ctx.attempt_count > 1 { w *= 0.8; }     // 多次尝试 → 权重降低
    w *= 0.8 + ctx.difficulty as f64 * 0.1;    // 难度越高，权重越大
    w.clamp(0.3, 1.5)
}
```

### 2.4 遗忘曲线

```rust
/// 艾宾浩斯遗忘风险
pub fn forgetting_risk(last_practiced: DateTime<Utc>, mastery: f64) -> f64 {
    let days = (Utc::now() - last_practiced).num_days() as f64;
    let half_life = 3.0 + mastery * 14.0;  // 掌握越好，半衰期越长
    let retention = (-0.693 * days / half_life).exp();
    1.0 - retention
}
```

---

## 三、B. 行为层

### 3.1 设计目标
回答"学生是怎么学的"—— 解题习惯和策略特征。

### 3.2 核心指标

| 指标 | 计算方式 | MVP实现 |
|------|---------|---------| 
| planning_score | 是否先整理条件再计算 | ✅ 基于解题时间分布 |
| impulsivity | 快速提交 + 错误率 | ✅ 基于 time/accuracy |
| hint_dependency | 提示使用频率 | ✅ hint_count 统计 |
| trial_error_ratio | 尝试次数分布 | ✅ attempt_count |

### 3.3 更新逻辑（滑动窗口）

```rust
/// 行为特征更新（取最近 N 个任务计算）
pub fn update_behavior(recent_tasks: &[TaskRecord]) -> BehaviorUpdate {
    let window = if recent_tasks.len() > 20 {
        &recent_tasks[recent_tasks.len()-20..]
    } else {
        recent_tasks
    };

    let impulsivity = calculate_impulsivity(window);
    let hint_dependency = calculate_hint_dependency(window);
    let planning_score = calculate_planning(window);

    // 指数移动平均平滑
    let alpha = 0.3;
    BehaviorUpdate { impulsivity, hint_dependency, planning_score, alpha }
}

fn calculate_impulsivity(tasks: &[TaskRecord]) -> f64 {
    // 快速提交(< 30秒) + 错误 → 冲动
    let fast_wrong = tasks.iter()
        .filter(|t| t.time_spent_sec < 30.0 && !t.is_correct)
        .count();
    fast_wrong as f64 / tasks.len() as f64
}

fn calculate_hint_dependency(tasks: &[TaskRecord]) -> f64 {
    let hint_used = tasks.iter().filter(|t| t.hint_count > 0).count();
    hint_used as f64 / tasks.len() as f64
}
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

### 4.3 更新逻辑（内存实时更新）

```rust
/// 实时状态更新（DashMap 中维护）
pub fn update_state(state: &mut StudentState, event: &LearningEvent) {
    match event.event_type.as_str() {
        "answer_correct" => {
            state.frustration = (state.frustration - 0.1).max(0.0);
            state.attention_level = (state.attention_level + 0.05).min(1.0);
        }
        "answer_wrong" => {
            state.frustration = (state.frustration + 0.15).min(1.0);
            if event.consecutive_errors > 2 {
                state.frustration = (state.frustration + 0.1).min(1.0);
            }
        }
        "hint_request" => {
            state.cognitive_load = (state.cognitive_load + 0.1).min(1.0);
        }
        "long_pause" => {  // 停顿 > 60s
            state.attention_level = (state.attention_level - 0.1).max(0.0);
        }
        "time_tick" => {  // 每 5 分钟
            let session_min = event.session_duration_min;
            let max_dur = max_duration_for_grade(event.grade);
            state.fatigue_level = (session_min / max_dur * 0.8).min(1.0);
        }
        _ => {}
    }
}
```

### 4.4 存储策略
- **DashMap**：实时状态（读写频繁）
- **SQLite**：每个会话结束时持久化快照

---

## 五、D. 兴趣层（MVP 简化）

### MVP 实现
- 注册时选择偏好主题
- 手动设置讲解风格
- 暂不自动提取

```rust
pub struct InterestProfile {
    pub topic_prefs: HashMap<String, f64>,  // {sports: 0.8, scifi: 0.6}
    pub explanation_style: String,           // formal/story/analogy/balanced
}
```

### V2 升级
- 从对话中自动提取兴趣
- 从行为中推断讲解风格偏好

---

## 六、F. 策略层（MVP 简化）

### MVP 实现
- 仅记录每次使用的策略和效果
- 不做自动优化

```rust
// 每次教学交互后记录
db.insert_strategy_record(StrategyRecord {
    student_id,
    strategy_type: "hint_style".to_string(),
    strategy_value: "step_by_step".to_string(),
    success_rate: if task_after_hint.is_correct { 1.0 } else { 0.0 },
    sample_count: 1,
});
```

---

## 七、Tauri Commands

```rust
#[tauri::command]
async fn get_student_profile(student_id: String) -> Result<StudentProfile>;
// 聚合所有层的完整画像

#[tauri::command]
async fn get_student_state(student_id: String) -> Result<StudentState>;
// 从 DashMap 读取实时状态

#[tauri::command]
async fn push_learning_event(student_id: String, event: LearningEvent) -> Result<()>;
// 推送行为事件，触发模型更新

#[tauri::command]
async fn get_weak_points(student_id: String, limit: i32) -> Result<Vec<WeakPoint>>;
// 获取知识薄弱点

#[tauri::command]
async fn get_forgetting_risks(student_id: String) -> Result<Vec<ForgettingRisk>>;
// 获取遗忘风险列表
```

---

## 八、开发任务清单

### W7：知识层 + 行为层
- [ ] 实现 knowledge_mastery CRUD
- [ ] 实现 BKT 更新算法
- [ ] 实现遗忘曲线计算
- [ ] 实现 behavior_features 滑动窗口更新
- [ ] 实现薄弱点和遗忘风险查询
- [ ] 单元测试：掌握度更新逻辑

### W8：状态层 + 整合
- [ ] 实现 DashMap 状态缓存
- [ ] 实现状态实时更新逻辑
- [ ] 实现事件驱动：答题结果 → 模型更新管线
- [ ] 实现 get_student_profile 聚合所有层
- [ ] 兴趣层手动设置接口
- [ ] 策略层记录接口
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
