# Phase 1 — 节奏控制与轻量对话

> 对应模块 ⑦ 节奏控制系统 + ⑧ 交互层（轻量对话）。  
> 控制"学多久、什么时候停、停了怎么办"。  
> **Rust 后端实现，前端 React 组件。**  
> **预计工期**：W11-W12（2 周）

---

## 一、节奏控制系统

### 1.1 设计原则

> 学习必须有明确结束，但结束应该是"结构化收束"，而不是"强制切断"。

### 1.2 时长控制（小学阶段）

| 年级 | 单次上限 | 控制强度 | 说明 |
|------|---------|---------|------|
| 1-2 年级 | 15-20 min | 强 | 注意力维持时间短 |
| 3-4 年级 | 20-25 min | 强 | |
| 5-6 年级 | 25-30 min | 中 | 可适当延长 |

> MVP 聚焦小学阶段，仅配置小学时长规则。初中/高中待扩展。

### 1.3 四段式收束流程

```
阶段 1: 提前预告（结束前 3-5 分钟）
  → "我们这轮学习差不多到时间了，可以再做一道总结题。"

阶段 2: 收尾任务
  → 小结题 / 关键点回顾 / 一句话总结

阶段 3: 明确结束
  → "今天的学习先到这里"（不模糊）

阶段 4: 退出引导
  → 选项：结束 / 轻复习 / 明天继续
  → 如果坚持继续 → 降级模式
```

### 1.4 降级模式

当用户超时仍不退出时，逐步收紧：

| 级别 | 措施 |
|------|------|
| 降级 1 | 不推新知识，只允许轻量复习 |
| 降级 2 | 关闭对话扩展，延长任务间隔 |
| 降级 3 | 软休眠：不主动推送，等用户操作 |
| 降级 4 | 明确提示"今天学习时间已结束" |

### 1.5 状态触发规则

除了时间到，以下条件也触发收束：

```rust
pub fn should_trigger_pacing(state: &StudentState, session: &SessionContext) -> Option<PacingAction> {
    // 时间预警
    let remaining = max_duration_for_grade(session.grade) - session.duration_min;
    if remaining <= 5.0 && remaining > 0.0 {
        return Some(PacingAction::PreNotice);
    }
    if remaining <= 0.0 {
        return Some(PacingAction::WindDown);
    }

    // 疲劳触发
    if state.fatigue_level > 0.7 {
        return Some(PacingAction::SuggestBreak);
    }

    // 严重挫败
    if state.frustration > 0.7 && session.consecutive_errors > 3 {
        return Some(PacingAction::ForceBreak);
    }

    None
}
```

### 1.6 Tauri Commands

```rust
#[tauri::command]
async fn get_pacing_status(session_id: String) -> Result<PacingStatus>;
// 返回: { elapsed_min, max_min, remaining_min, state, message }

#[tauri::command]
async fn request_extend(session_id: String) -> Result<ExtendResult>;
// 返回: { allowed, new_max, mode }
```

### 1.7 收束话术模板

```rust
const PACING_MESSAGES: &[(&str, &[&str])] = &[
    ("pre_notice", &[
        "我们这轮学习差不多到时间了，可以再做一道总结题。",
        "还有几分钟，我们把刚刚的重点收一下。",
    ]),
    ("wind_down", &[
        "今天的学习先到这里。{}",
        "我们这轮已经完成了，建议休息一下。",
    ]),
    ("suggest_break", &[
        "感觉节奏有点快了，要不要先休息一下？",
        "我们可以先停一停，换个轻松的。",
    ]),
    ("degraded", &[
        "我这边先暂停新的内容，你可以回顾一下之前学的。",
    ]),
];
```

---

## 二、轻量对话模块

### 2.1 定位

> 不是"陪伴产品"，而是"学习调节干预模块"。

**目标**：
- 释放短期压力
- 收集轻量背景信息
- 判断后续学习节奏
- 帮学生恢复到可继续学习的状态

**不应该**：
- 无限陪聊
- 情感依赖
- 深度心理咨询

### 2.2 对话状态机

```
S1: 学习中（默认）
  → 触发条件满足 → S2

S2: 轻调节对话
  → 对话目标：今天感受、压力感、近况
  → 计时开始（3-5 分钟上限）
  → S3

S3: 恢复评估
  → 语言活跃度恢复？注意力回升？
  → 恢复 → S1 (回到学习)
  → 未恢复 → 建议休息/结束

S4: 强制收束
  → 超时/超量 → 引导回学习
```

### 2.3 触发条件

```rust
pub fn should_trigger_chat(state: &StudentState, session: &SessionContext) -> bool {
    // 条件 1: 连续学习超过阈值
    if session.duration_min > 20.0 && !session.had_break {
        return true;
    }

    // 条件 2: 连续错误
    if session.consecutive_errors >= 3 {
        return true;
    }

    // 条件 3: 注意力持续下降
    if state.attention_level < 0.3 {
        return true;
    }

    false
}
```

### 2.4 硬控制规则

| 规则 | 值 | 说明 |
|------|---|------|
| 单次聊天上限 | 3-5 分钟 | 小学生更短 |
| 每日总聊天上限 | 20 分钟 | 超量禁止触发 |
| 连续触发冷却 | 15 分钟 | 避免反复触发 |
| 夜间时段 (20:30后) | 缩短上限 | 小学生更严格 |

### 2.5 对话 Prompt

```
你是学生的学习搭子，现在进入一段轻量调节对话。

目标：
1. 了解学生当前状态和感受
2. 轻松聊几句缓解压力
3. 收集有用信息（兴趣/近况/压力源）
4. 在 3-5 轮对话内自然收束，引导回学习

规则：
- 不做心理诊断
- 不说"我一直在陪你"
- 不延伸为无限对话
- 如果学生主动谈到困难学科，可以自然过渡回学习话题
- 收集到的有用信息标记为 [EXTRACT: ...]

学生当前状态：
- 年级: {grade}
- 疲劳度: {fatigue}
- 连续错误: {errors}
- 本次学习时长: {duration}min

注意：学生是小学生，用简单、活泼、易懂的语言。
```

### 2.6 信息提取

对话结束后，从对话内容中提取有用信息更新学生模型：

```rust
pub async fn extract_chat_info(messages: &[ChatMessage]) -> ChatExtraction {
    // LLM 提取
    let extraction = llm_client.extract(messages, &[
        "pressure_level", "interests", "current_mood", "life_events"
    ]).await;

    ChatExtraction {
        pressure_trend: extraction.pressure_level,   // → 状态层
        new_interests: extraction.interests,          // → 兴趣层
        event_memory: extraction.life_events,         // → 事件记忆
    }
}
```

### 2.7 Tauri Commands

```rust
#[tauri::command]
async fn start_chat(
    app: tauri::AppHandle,
    student_id: String,
    session_id: String,
    trigger_reason: String,
) -> Result<ChatStartResult>;  // { chat_id, first_message }

#[tauri::command]
async fn send_chat_message(
    app: tauri::AppHandle,  // 流式推送
    chat_id: String,
    content: String,
) -> Result<()>;  // 通过 app.emit("chat-chunk") 流式输出

#[tauri::command]
async fn end_chat(chat_id: String) -> Result<ChatEndResult>;

#[tauri::command]
async fn get_chat_state(student_id: String) -> Result<ChatState>;
```

---

## 三、前端界面要点

### 3.1 节奏控制 UI
- 顶部进度条显示剩余时间
- 预警时进度条变色（黄→橙）
- 收束时弹出温和的总结卡片
- 退出选项用卡片式选择（非弹窗）

### 3.2 对话 UI
- 侧边抽屉或底部弹出
- 流式输出（Tauri Events）
- 轻量 bubble 风格，非全屏聊天
- 显示剩余对话时间
- 有"回到学习"按钮

---

## 四、开发任务清单

### W11：节奏控制
- [ ] 实现 PacingEngine 服务
- [ ] 实现年级分层时长配置
- [ ] 实现四段收束流程
- [ ] 实现降级模式
- [ ] 实现状态触发规则
- [ ] 实现 pacing Tauri Commands
- [ ] 前端：时间进度条 + 收束卡片
- [ ] 与决策引擎集成（疲劳/超时→自动触发）

### W12：轻量对话 + 整体集成
- [ ] 实现对话状态机
- [ ] 实现对话 Prompt + 流式输出
- [ ] 实现硬控制规则（时限/冷却/每日上限）
- [ ] 实现信息提取（对话→模型更新）
- [ ] 前端：对话侧边栏
- [ ] 端到端测试：完整学习流程（学习→对话→恢复→继续/结束）
- [ ] 全系统集成测试

---

## 五、验收标准

- [ ] 学习时间到达上限前 5 分钟发出预警
- [ ] 时间到达上限后进入收束流程
- [ ] 收束包含总结+选择（非突然切断）
- [ ] 超时不退出进入降级模式
- [ ] 对话在 5 分钟内自动收束
- [ ] 每日对话超 20 分钟后无法再触发
- [ ] 连续触发对话有 15 分钟冷却
- [ ] 对话提取的信息正确更新到学生模型
- [ ] 所有收束话术无强制感，有选择感
