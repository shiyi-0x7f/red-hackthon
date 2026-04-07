# Phase 2 — 增强观测与过程分析

> V2 阶段（第 4-6 月）：完善过程数据采集、行为特征工程、阅读/抽背模块、兴趣自动提取、长时记忆系统、Live2D 基础版、教师端。

---

## 一、阶段目标

> 从"看结果"升级为"看过程"，从"手动设置兴趣"到"自动理解学生"。

| 模块 | V2 新增/增强 |
|------|-------------|
| 数据采集 | 前端埋点：停顿、修改、跳步、放弃、注意力信号 |
| 特征工程 | 完整行为特征计算引擎（规划/冲动/恢复等） |
| 学生模型 | 兴趣层自动更新、行为层完整化、认知层初步 |
| 长时记忆 | 4 层记忆体系（事实/事件/模式/策略） |
| 阅读/抽背 | 书籍上传、结构化解析、复盘、语音抽背 |
| Live2D | 抽象能量体、状态反馈动画 |
| 教师端 | 学习报告、学生画像、教学建议 |
| 决策引擎 | 更多策略规则，策略效果自动评估 |

---

## 二、前端过程数据采集

### 2.1 需要埋点的事件

| 事件 | event_type | 采集数据 |
|------|-----------|---------|
| 开始解题 | task_start | timestamp |
| 暂停/切换 | task_pause | duration, reason |
| 修改答案 | answer_modify | old_value, new_value, step |
| 请求提示 | hint_request | level |
| 放弃题目 | task_abandon | time_spent, progress |
| 检查答案 | answer_check | (自我检查行为) |
| 页面失焦 | focus_lost | duration |
| 鼠标/键盘空闲 | idle_detected | duration |
| 快速提交 | fast_submit | time_spent < threshold |

### 2.2 前端埋点 SDK

```typescript
class LearningTracker {
    // 自动追踪
    trackFocus(): void           // visibilitychange 事件
    trackIdle(): void            // 键盘/鼠标空闲检测
    trackTaskTiming(): void      // 计时

    // 主动上报
    reportModify(data): void
    reportPause(data): void
    reportAbandon(data): void

    // 批量上报（每 10 秒 / 页面离开时）
    flush(): void
}
```

---

## 三、行为特征工程（完整版）

### 3.1 核心特征

| 特征 | 计算方式 |
|------|---------|
| planning_score | 题目开始后是否有结构化停顿（>5s）再作答 |
| impulsivity | 快速提交率 × 错误率 |
| hint_dependency | 提示使用频率 + 提示后正确率 |
| trial_error_ratio | 多次尝试/修改次数占比 |
| review_quality | 复盘时修正率 + 错因识别准确度 |
| self_monitoring | 主动检查行为频率 |
| recovery_score | 错误后 N 步表现恢复速度 |
| focus_stability | 失焦/空闲事件频率 |

### 3.2 特征更新管线

```
事件日志 → 批量聚合(每会话/每日) → 特征计算 → EMA 平滑 → 模型更新
```

---

## 四、长时记忆系统

### 4.1 四层记忆

| 层 | 内容 | 更新频率 | 来源 |
|----|------|---------|------|
| 事实记忆 | 喜欢科幻、晚9点后注意力差 | 低 | 对话/行为 |
| 事件记忆 | 4月4日二次函数连错三题 | 每次关键事件 | 学习记录 |
| 模式记忆 | 遇三步以上题容易局部计算 | 自动归纳 | 行为分析 |
| 策略记忆 | 先提问再讲解更有效 | 验证后 | 策略效果 |

### 4.2 记忆召回

在生成讲解/对话/决策时，召回相关记忆注入 Prompt：

```typescript
async function recallMemories(studentId: string, context: string): Promise<Memory[]> {
    // 1. 关键词匹配
    const facts = await factMemories.findByKeywords(studentId, extractKeywords(context));
    // 2. 最近事件
    const events = await eventMemories.findRecent(studentId, 7);  // 7天内
    // 3. 活跃模式
    const patterns = await patternMemories.findActive(studentId);

    return [...facts, ...events, ...patterns];
}
```

---

## 五、阅读/抽背模块

### 5.1 功能拆分

| 子功能 | 说明 |
|--------|------|
| 书籍导入 | 上传 PDF/文本，自动切章节、抽关键概念 |
| 复盘 | AI 引导回顾：讲了什么、记住了什么、理解不稳的点 |
| 抽背 | 语音/文字背诵 → 评估：完整性、理解 vs 机械记忆 |
| 观点互换 | 反方论证、费曼讲解法 |

### 5.2 API

```
POST   /api/reading/upload          上传材料
POST   /api/reading/:id/parse       解析章节
POST   /api/reading/:id/review      生成复盘问题
POST   /api/recitation/start        开始抽背
POST   /api/recitation/evaluate     评估背诵（语音/文字）
POST   /api/discussion/debate       观点互换
```

---

## 六、Live2D 抽象体

### 6.1 设计原则

- ✅ 有生命感，但不具人格
- ✅ 用动画表达系统状态
- ❌ 无明确人脸、无情绪拟人

### 6.2 状态映射

| 系统状态 | 视觉表现 |
|---------|---------|
| 正常学习 | 稳定发光/呼吸，节奏均匀 |
| 用户输入 | 微亮响应，轻微脉冲 |
| AI 思考 | 缓慢流动 |
| 答对 | 短暂扩散 |
| 卡住 | 缓慢波动 |
| 休息 | 渐弱/休眠态 |
| 进步 | 形态微进化 |

### 6.3 宠物成长规则

- 绑定学习进步（非登录时间/聊天量）
- 不索取、不情感绑定
- 成长可视化 = 学生看到自己进步的具象化

---

## 七、教师端

### 7.1 核心功能

| 功能 | 说明 |
|------|------|
| 班级概览 | 各学生学习状态一览 |
| 学生画像 | 查看完整 6 层画像 |
| 学习报告 | 周/月报告：掌握变化、行为趋势 |
| 薄弱点分析 | 班级级别的知识点掌握分布 |
| 教学建议 | 基于画像的具体教学建议 |

### 7.2 教师端输出规范

教师看到的内容可以更明确，但仍：
- 不做人格定性
- 不做心理诊断
- 基于行为证据

---

## 八、开发任务概览

| 月 | 主要工作 |
|----|---------|
| M4 | 前端埋点 + 特征工程 + 长时记忆 |
| M5 | 阅读/抽背 + 兴趣自动提取 + 决策引擎增强 |
| M6 | Live2D 基础版 + 教师端 + 集成优化 |

---

## 九、验收标准

- [ ] 前端事件采集覆盖率 > 90%
- [ ] 行为特征计算延迟 < 500ms
- [ ] 长时记忆召回能注入到讲解/对话中
- [ ] 阅读材料可自动切章节+生成问题
- [ ] 语音抽背识别准确率 > 85%
- [ ] Live2D 状态切换流畅，无卡顿
- [ ] 教师端报告可读、有可操作建议
