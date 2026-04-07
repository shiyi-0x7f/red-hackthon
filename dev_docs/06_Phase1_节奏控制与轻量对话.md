# Phase 1 — 节奏控制与轻量对话

> 对应模块 ⑦ 节奏控制系统 + ⑧ 交互层（轻量对话）。  
> 控制"学多久、什么时候停、停了怎么办"。  
> **Python 后端实现，前端复用 AstrBot LiveChat 组件。**

---

## 一、节奏控制系统

### 1.1 设计原则

> 学习必须有明确结束，但结束应该是"结构化收束"，而不是"强制切断"。

### 1.2 时长控制（小学阶段）

| 年级 | 单次上限 | 控制强度 | 说明 |
|------|---------|---------|------|
| 1-2 年级 | 15-20 min | 强 | 注意力维持时间短 |
| 3-4 年级 | 20-25 min | 强 | |
| 5-6 年级 | 25-30 min | 中 | MVP 聚焦此段 |

### 1.3 四段式收束流程

```
阶段 1: 提前预告（结束前 3-5 分钟）
  → "我们这轮学习差不多到时间了，可以再做一道总结题。"

阶段 2: 收尾任务
  → 小结题 / 关键点回顾

阶段 3: 明确结束
  → "今天的学习先到这里"（不模糊）

阶段 4: 退出引导
  → 选项：结束 / 轻复习 / 明天继续
  → 如果坚持继续 → 降级模式
```

### 1.4 降级模式

| 级别 | 措施 |
|------|------|
| 降级 1 | 不推新知识，只允许轻量复习 |
| 降级 2 | 关闭对话扩展，延长任务间隔 |
| 降级 3 | 软休眠：不主动推送，等用户操作 |
| 降级 4 | 明确提示"今天学习时间已结束" |

### 1.5 状态触发规则

```python
# astrbot/core/learning/pacing_engine.py

class PacingEngine:
    def check_pacing(self, state: dict, session: dict, grade: int) -> dict | None:
        """检查是否需要触发节奏控制"""
        max_dur = _max_duration(grade)
        elapsed = session.get('duration_min', 0)
        remaining = max_dur - elapsed
        
        # 时间预警
        if 0 < remaining <= 5:
            return {'action': 'pre_notice', 'remaining': remaining}
        if remaining <= 0:
            return {'action': 'wind_down'}
        
        # 疲劳触发
        if state.get('fatigue_level', 0) > 0.7:
            return {'action': 'suggest_break'}
        
        # 严重挫败
        if (state.get('frustration', 0) > 0.7 and 
            session.get('consecutive_errors', 0) > 3):
            return {'action': 'force_break'}
        
        return None
```

### 1.6 API 路由

```python
@learning_bp.route('/api/learning/pacing/<session_id>', methods=['GET'])
async def get_pacing_status(session_id: str):
    """获取节奏控制状态"""
    session = await db.get_session(session_id)
    state = get_student_state(session.student_id)
    student = await db.get_student(session.student_id)
    
    pacing = pacing_engine.check_pacing(state, session.dict(), student.grade)
    
    elapsed = (datetime.now() - session.started_at).total_seconds() / 60
    max_dur = _max_duration(student.grade)
    
    return jsonify({
        'elapsed_min': elapsed,
        'max_min': max_dur,
        'remaining_min': max(0, max_dur - elapsed),
        'pacing_action': pacing,
    })

@learning_bp.route('/api/learning/extend/<session_id>', methods=['POST'])
async def request_extend(session_id: str):
    """请求延长学习"""
    session = await db.get_session(session_id)
    # 进入降级模式
    return jsonify({
        'allowed': True,
        'mode': 'degraded',
        'message': '可以再看一下之前学的内容，但不推新题了。',
    })
```

### 1.7 收束话术模板

```python
PACING_MESSAGES = {
    'pre_notice': [
        "我们这轮学习差不多到时间了，可以再做一道总结题。",
        "还有几分钟，我们把刚刚的重点收一下。",
    ],
    'wind_down': [
        "今天的学习先到这里。{summary}",
        "我们这轮已经完成了，建议休息一下。",
    ],
    'suggest_break': [
        "感觉节奏有点快了，要不要先休息一下？",
        "我们可以先停一停，换个轻松的。",
    ],
    'degraded': [
        "我这边先暂停新的内容，你可以回顾一下之前学的。",
    ],
}
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

### 2.2 实现方式

**直接复用 AstrBot 的对话能力**：

- 飞书端：AstrBot 平台层原生支持
- Web 端：复用 AstrBot LiveChat 组件 + 注入学习上下文
- 对话模式切换：通过 AstrBot Persona 切换 strict/gentle

```python
# 在专属导师插件中处理对话
# astrbot/builtin_stars/dedicated_tutor/main.py

from astrbot.api.star import Star, register

class DedicatedTutor(Star):
    @register("chat_trigger")
    async def on_chat(self, event):
        """学习调节对话"""
        student = await self._get_student(event.user_id)
        state = get_student_state(student.id)
        
        # 构建带学习上下文的 Prompt
        context_prompt = CHAT_PROMPT.format(
            grade=student.grade,
            fatigue=state.get('fatigue_level', 0),
            consecutive_errors=state.get('consecutive_errors', 0),
            duration=state.get('session_duration', 0),
        )
        
        # 通过 AstrBot 的 Persona 系统注入
        # Persona 已配置好 system prompt
        # 只需补充学习状态上下文
        event.context['learning_state'] = context_prompt
```

### 2.3 硬控制规则

| 规则 | 值 | 说明 |
|------|---|------|
| 单次聊天上限 | 3-5 分钟 | 小学生更短 |
| 每日总聊天上限 | 20 分钟 | 超量禁止触发 |
| 连续触发冷却 | 15 分钟 | 避免反复触发 |

### 2.4 对话 Prompt

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

学生当前状态：
- 年级: {grade}
- 疲劳度: {fatigue}
- 连续错误: {errors}
- 本次学习时长: {duration}min

注意：学生是小学生，用简单、活泼、易懂的语言。
```

> 此 Prompt 配置在 AstrBot 的 Persona `math-tutor-gentle` 中，无需硬编码。

### 2.5 信息提取

对话结束后，从对话内容中提取有用信息：

```python
async def extract_chat_info(messages: list[dict]) -> dict:
    """LLM 提取对话中的有用信息"""
    prompt = EXTRACT_PROMPT.format(messages=json.dumps(messages, ensure_ascii=False))
    provider = core.provider_manager.get_default_provider()
    result = await provider.text_chat(prompt=prompt)
    
    extraction = json.loads(result)
    return {
        'pressure_trend': extraction.get('pressure_level'),   # → 状态层
        'new_interests': extraction.get('interests'),          # → 兴趣层
        'event_memory': extraction.get('life_events'),         # → AstrBot 记忆
    }
```

---

## 三、前端界面要点

### 3.1 节奏控制 UI（Vue 组件）

```vue
<!-- dashboard/src/components/learning/PacingBar.vue -->
<template>
  <v-progress-linear
    :model-value="progress"
    :color="progressColor"
    height="6"
    rounded
  />
  <div class="pacing-info text-caption">
    剩余 {{ remaining }} 分钟
  </div>
</template>
```

- 顶部进度条显示剩余时间
- 预警时进度条变色（蓝→黄→橙）
- 收束时弹出温和的总结卡片
- 退出选项用 Vuetify v-card 选择

### 3.2 对话 UI

**直接复用 AstrBot Dashboard 的 LiveChat 组件**：

- AstrBot 已有完整的聊天 UI（`views/ConversationPage.vue`, 52KB）
- 支持 SSE 流式输出
- 支持 KaTeX / Markdown 渲染
- 只需在学习页面中嵌入一个"对话抽屉"

```vue
<!-- 在学习页面中嵌入对话 -->
<v-navigation-drawer v-model="chatDrawer" location="right" width="400">
  <LiveChatEmbed :student-id="currentStudentId" />
</v-navigation-drawer>
```

---

## 四、专属导师命令

通过 AstrBot 插件系统实现，Web 端和飞书端共享：

| 命令 | 功能 | Web 等效 API |
|------|------|-------------|
| `/start` | 开始学习会话 | `POST /api/tutor/start` |
| `/goal <目标>` | 设定学习目标 | `POST /api/tutor/goal` |
| `/plan` | 查看个性化学习计划 | `GET /api/tutor/plan/<id>` |
| `/checkin` | 签到 + 状态报告 | `POST /api/tutor/checkin` |
| `/mode strict\|gentle` | 切换模式 | `PUT /api/tutor/mode` |

```python
# astrbot/builtin_stars/dedicated_tutor/main.py

class DedicatedTutor(Star):
    @register("command", "start", "开始学习")
    async def cmd_start(self, event):
        student = await self._get_or_create_student(event.user_id)
        session = await learning_service.start_session(student.id)
        first_task = session['first_task']
        await event.reply(f"📚 学习开始！\n\n{format_task(first_task)}")
    
    @register("command", "plan", "查看学习计划")
    async def cmd_plan(self, event):
        student = await self._get_student(event.user_id)
        profile = await student_service.get_profile(student.id)
        plan = await generate_plan(profile)
        await event.reply(plan)
    
    @register("command", "mode", "切换模式")
    async def cmd_mode(self, event):
        mode = event.args[0] if event.args else 'gentle'
        student = await self._get_student(event.user_id)
        student.mode = mode
        await db.update_student(student)
        # 切换 AstrBot Persona
        persona_id = f'math-tutor-{mode}'
        await persona_mgr.set_active_persona(event.user_id, persona_id)
        await event.reply(f"✅ 已切换为 {'严格' if mode == 'strict' else '温和'} 模式")
```

---

## 五、开发任务清单

### 阶段 1：节奏控制（~3h）
- [ ] 实现 PacingEngine
- [ ] 实现时长配置
- [ ] 实现四段收束
- [ ] 实现降级模式
- [ ] 创建 pacing API

### 阶段 2：对话 + 命令（~4h）
- [ ] 创建 dedicated_tutor 插件
- [ ] 实现 /start /goal /plan /checkin /mode 命令
- [ ] 创建 tutor_commands.py 路由（Web 等效）
- [ ] 对话上下文注入（学习状态 → Prompt）
- [ ] 前端：对话抽屉（复用 LiveChat）

### 阶段 3：集成（~2h）
- [ ] 节奏控制与决策引擎联动
- [ ] 飞书端命令测试
- [ ] Web 端全链路测试

---

## 六、验收标准

- [ ] 学习时间到达上限前 5 分钟发出预警
- [ ] 时间到达上限后进入收束流程
- [ ] 收束包含总结+选择（非突然切断）
- [ ] 超时不退出进入降级模式
- [ ] /start /goal /plan /checkin /mode 命令可用
- [ ] Web 端和飞书端命令行为一致
- [ ] strict/gentle 模式切换后对话风格可观察差异
- [ ] 所有收束话术无强制感，有选择感
