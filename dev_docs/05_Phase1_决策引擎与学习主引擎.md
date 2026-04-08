# Phase 1 — 决策引擎与学习主引擎

> 对应模块 ③ 学习主引擎 + ⑥ 教学决策引擎（规则版）。  
> 系统的"大脑"：决定学什么、怎么学、什么时候停。  
> **Rust 原生实现，所有接口为 Tauri Commands。**  
> **预计工期**：W9-W10（2 周）

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

```rust
pub struct DecisionResult {
    pub action: String,          // new_content | review | practice | rest | chat | wind_down | end
    pub knowledge_id: Option<String>,
    pub difficulty: Option<i32>,
    pub hint_strategy: String,   // none | light | guided | step_by_step
    pub explanation_style: Option<String>,
    pub task_type: String,       // question | explain | discuss
    pub reasoning: String,       // 决策理由（可解释性）
}
```

### 1.4 三层决策逻辑

```rust
pub fn decide_next(model: &StudentProfile, session: &SessionContext) -> DecisionResult {
    // 层级 1: 硬规则（不可违反）
    if let Some(hard) = check_hard_rules(model, session) {
        return hard;
    }

    // 层级 2: 策略选择
    let strategy = select_strategy(model);

    // 层级 3: 内容选择
    select_content(model, session, &strategy)
}
```

#### 层级 1：硬规则（不可违反）

```rust
fn check_hard_rules(model: &StudentProfile, session: &SessionContext) -> Option<DecisionResult> {
    // 疲劳过高
    if model.state.fatigue_level > 0.8 {
        return Some(DecisionResult::wind_down("疲劳度过高，进入收束"));
    }

    // 超时
    let max_dur = max_duration_for_grade(model.grade);
    if session.duration_min > max_dur {
        return Some(DecisionResult::end("已超过建议学习时长"));
    }

    // 严重挫败
    if model.state.frustration > 0.7 && session.consecutive_errors > 3 {
        return Some(DecisionResult::rest("连续受挫，建议休息"));
    }

    // 认知过载
    if model.state.cognitive_load > 0.85 {
        return Some(DecisionResult::practice_easy("认知负荷过高，切换低难度巩固"));
    }

    None
}
```

#### 层级 2：策略选择

```rust
fn select_strategy(model: &StudentProfile) -> LearningStrategy {
    LearningStrategy {
        // 提示依赖高 → 减少提示
        hint_strategy: if model.behavior.hint_dependency > 0.6 { "light" } else { "guided" },
        // 冲动度高 → 强制停顿
        require_pause: model.behavior.impulsivity > 0.6,
        // 规划弱 → 先问思路
        require_plan_first: model.behavior.planning_score < 0.4,
    }
}
```

#### 层级 3：内容选择

```rust
fn select_content(
    model: &StudentProfile,
    session: &SessionContext,
    strategy: &LearningStrategy,
) -> DecisionResult {
    // 1. 先检查遗忘风险
    let forgetting = get_high_risk_points(model, 0.6);
    if !forgetting.is_empty() && session.review_count < 2 {
        return DecisionResult::review(
            forgetting[0].knowledge_id.clone(),
            strategy.hint_strategy.clone(),
            format!("{} 遗忘风险高，安排复习", forgetting[0].name),
        );
    }

    // 2. 状态良好 → 推进新知识
    if model.state.attention_level > 0.5 && model.state.cognitive_load < 0.6 {
        let next_kp = select_next_knowledge(model);
        return DecisionResult::new_content(
            next_kp.id.clone(),
            adapt_difficulty(&model.state, &next_kp),
            strategy.hint_strategy.clone(),
            format!("注意力良好，推进新知识: {}", next_kp.name),
        );
    }

    // 3. 状态一般 → 巩固
    let weak = get_weakest_mastered(model);
    DecisionResult::practice(
        weak.knowledge_id.clone(),
        if weak.mastery_score < 0.5 { 2 } else { 3 },
        strategy.hint_strategy.clone(),
        format!("状态一般，巩固 {}", weak.name),
    )
}
```

---

## 二、学习主引擎

### 2.1 定位
把决策引擎的"指令"转化成具体的学习任务。

### 2.2 学习流程状态机

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

> MVP 简化：去掉复杂阶段区分，统一为"做题→反馈→下一步"循环。

### 2.3 Tauri Commands

```rust
#[tauri::command]
async fn start_session(student_id: String) -> Result<SessionStartResult>;
// 返回: { session_id, first_task, decision_reasoning }

#[tauri::command]
async fn submit_answer(
    session_id: String,
    task_id: String,
    answer: serde_json::Value,
    time_spent_sec: f64,
    hint_count: i32,
) -> Result<SubmitResult>;
// 返回: { evaluation, feedback, next_task, decision_reasoning }

#[tauri::command]
async fn request_hint(session_id: String, task_id: String) -> Result<HintResult>;

#[tauri::command]
async fn skip_task(session_id: String, task_id: String) -> Result<SkipResult>;

#[tauri::command]
async fn end_session(session_id: String, reason: String) -> Result<SessionSummary>;
```

### 2.4 提交答案核心流程

```rust
async fn handle_submit_answer(params: SubmitParams, state: &AppState) -> Result<SubmitResult> {
    // 1. 判题
    let question = db::get_question(&params.question_id)?;
    let evaluation = evaluate_answer(&question, &params.answer, params.time_spent_sec).await?;

    // 2. 更新学生模型
    update_student_model(
        &params.student_id,
        &question,
        &evaluation,
        params.time_spent_sec,
        params.hint_count,
    ).await?;

    // 3. 记录答题
    db::insert_task_record(TaskRecord {
        session_id: params.session_id.clone(),
        student_id: params.student_id.clone(),
        question_id: params.question_id.clone(),
        student_answer: params.answer.to_string(),
        is_correct: evaluation.is_correct,
        error_type: evaluation.error_type.clone(),
        time_spent_sec: params.time_spent_sec,
        hint_count: params.hint_count,
        ..Default::default()
    })?;

    // 4. 决策下一步
    let profile = get_student_profile(&params.student_id)?;
    let session_ctx = build_session_context(&params.session_id)?;
    let decision = decide_next(&profile, &session_ctx);
    let next_task = generate_task(&decision).await?;

    // 5. 生成反馈
    let feedback = generate_feedback(&evaluation);

    Ok(SubmitResult { evaluation, feedback, next_task, decision })
}
```

---

## 三、反馈生成

### 3.1 安全表达规则

所有反馈必须遵循三条铁律（非诊断、非评判、有方向）。

### 3.2 反馈模板

```rust
fn generate_feedback(evaluation: &EvaluationResult) -> String {
    if evaluation.is_correct {
        // 正确反馈（随机选一条）
        pick_random(&[
            "这道题你独立完成了，思路很清晰 👍",
            "做得不错，继续保持！",
            "你的计算过程很稳，赞！",
        ])
    } else {
        // 错误反馈（根据错误类型）
        match evaluation.error_type.as_deref() {
            Some("conceptual") => "这个概念的理解还可以再巩固一下，我们换个角度看看。",
            Some("procedural") => "计算过程中有个小弯，我们一起检查一下步骤。",
            Some("careless") => "答案离正确就差一点点，再仔细看看数字和符号。",
            Some("strategic") => "这种题有另一种更稳的方法，我们试试？",
            _ => "我们一起看看这道题。",
        }.to_string()
    }
}
```

---

## 四、开发任务清单

### W9：决策引擎
- [ ] 实现 DecisionResult 数据结构
- [ ] 实现硬规则层
- [ ] 实现策略选择层
- [ ] 实现内容选择层（遗忘复习/新知识/巩固）
- [ ] 实现 adapt_difficulty 自适应难度
- [ ] 决策结果含 reasoning
- [ ] 单元测试

### W10：学习主引擎
- [ ] 实现 start_session Tauri Command
- [ ] 实现 submit_answer → 判题 → 模型更新 → 下一题
- [ ] 实现任务生成（根据 DecisionResult）
- [ ] 实现反馈生成（安全文案）
- [ ] 实现 end_session 会话总结
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
