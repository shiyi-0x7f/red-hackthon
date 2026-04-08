# Phase 1 — 内容资源与基础学习功能

> MVP 阶段第一步：搭建知识图谱、题库、出题/判题/问答基础能力。  
> 对应模块 ① 内容资源层 + ② 基础学习功能层。  
> **Rust 实现，所有接口为 Tauri Commands。**  
> **预计工期**：W3-W6（4 周）

---

## 一、知识图谱

### 1.1 人教版小学数学知识点结构

```
人教版小学数学
├── 一年级上册
│   ├── 第1单元: 数一数
│   ├── 第2单元: 比一比
│   ├── 第3单元: 1~5的认识和加减法
│   └── ...
├── 一年级下册
│   └── ...
├── ...
└── 六年级下册
    ├── 第1单元: 负数
    ├── 第2单元: 百分数(二)
    └── ...
```

### 1.2 知识点编码规则

```
PEP-G{年级}-S{学期}-U{单元}-{序号}

示例：
PEP-G1-S1-U3-01  → 一年级上册第3单元第1个知识点
PEP-G6-S2-U3-02  → 六年级下册第3单元第2个知识点
```

### 1.3 知识点数据示例

```json
{
  "id": "uuid...",
  "name": "20以内的退位减法",
  "code": "PEP-G1-S2-U2-01",
  "grade": 1,
  "semester": 2,
  "unit": 2,
  "category": "number",
  "description": "用破十法、想加算减法计算20以内的退位减法",
  "difficulty_base": 2,
  "parent_id": "减法基础-id",
  "prerequisites": ["PEP-G1-S1-U5-01"]
}
```

### 1.4 Tauri Commands

```rust
#[tauri::command]
async fn get_knowledge_tree(grade: i32, semester: Option<i32>) -> Result<Vec<KnowledgeNode>>;

#[tauri::command]
async fn get_knowledge_point(id: String) -> Result<KnowledgePoint>;

#[tauri::command]
async fn get_prerequisites(knowledge_id: String) -> Result<Vec<KnowledgePoint>>;

#[tauri::command]
async fn search_knowledge(query: String) -> Result<Vec<KnowledgePoint>>;
```

---

## 二、题库

### 2.1 题目数据结构

```json
{
  "content": "小明有 12 个苹果，给了小红 5 个，还剩多少个？",
  "type": "fill",
  "difficulty": 1,
  "answer": { "value": "7", "unit": "个" },
  "solution_steps": [
    { "step": 1, "content": "找出已知条件", "detail": "小明有 12 个，给了 5 个" },
    { "step": 2, "content": "列算式", "detail": "12 - 5 = ?" },
    { "step": 3, "content": "计算结果", "detail": "12 - 5 = 7" }
  ],
  "hints": [
    { "level": 1, "content": "想一想，'给了'是变多了还是变少了？" },
    { "level": 2, "content": "用减法来算：12 - 5 = ?" },
    { "level": 3, "content": "12 - 5 = 7，还剩 7 个苹果" }
  ],
  "error_patterns": [
    { "type": "conceptual", "pattern": "用加法计算", "feedback": "'给了别人'是变少，应该用减法哦" }
  ],
  "tags": ["减法", "应用题", "一年级"]
}
```

### 2.2 题目来源

| 来源 | 方式 | 阶段 |
|------|------|------|
| 手工录入 | JSON 文件导入 | MVP |
| AI 生成 | LLM 根据知识点生成 | MVP |
| 题库 API | 对接成熟题库 | V2 |

### 2.3 Tauri Commands

```rust
#[tauri::command]
async fn generate_quiz(
    student_id: String,
    knowledge_ids: Vec<String>,
    difficulty_range: (i32, i32),
    count: i32,
    exclude_ids: Vec<String>,
) -> Result<Vec<Question>>;

#[tauri::command]
async fn get_question(id: String) -> Result<Question>;

#[tauri::command]
async fn import_questions(questions_json: String) -> Result<ImportResult>;
```

---

## 三、判题系统

### 3.1 判题流程

```
学生答案 → 规则判题（精确匹配）
         ↓ 无法判断
         → LLM 判题（含错因分析）
         ↓
         → 返回 { is_correct, error_type, error_step, feedback }
```

### 3.2 错因分类

| 类型 | code | 小学常见示例 |
|------|------|------------|
| 概念错误 | conceptual | 减法用成加法、不理解"几倍" |
| 步骤错误 | procedural | 竖式计算进位遗漏 |
| 粗心错误 | careless | 抄错数字、漏掉单位 |
| 策略错误 | strategic | 应用题不会列算式 |

### 3.3 判题 Prompt

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

### 3.4 Tauri Commands

```rust
#[tauri::command]
async fn evaluate_answer(
    task_id: String,
    question_id: String,
    student_answer: serde_json::Value,
    time_spent_sec: f64,
) -> Result<EvaluationResult>;
```

---

## 四、分层提示

### 4.1 三层提示设计

| 层级 | 目标 | 示例 |
|------|------|------|
| Level 1 | 方向性引导 | "想想这是用加法还是减法？" |
| Level 2 | 具体方法 | "用减法算：12 - 5 = ?" |
| Level 3 | 接近答案 | "12 - 5 = 7" |

### 4.2 提示策略

| 学生特征 | 策略 | 说明 |
|---------|------|------|
| hint_dependency > 0.6 | light | 只给 Level 1 |
| hint_dependency < 0.3 | guided | 给 Level 1+2 |
| 连续错误 > 3 | step_by_step | 给全部 3 层 |

### 4.3 Tauri Commands

```rust
#[tauri::command]
async fn get_hint(
    task_id: String,
    question_id: String,
    current_level: i32,
) -> Result<HintResult>;
```

---

## 五、问答与讲解

### 5.1 问答（流式输出）

```rust
#[tauri::command]
async fn ask_question_stream(
    app: tauri::AppHandle,
    student_id: String,
    question: String,
    context_task_id: Option<String>,
) -> Result<()>;
// 通过 app.emit("qa-chunk", chunk) 逐 token 推送
// 结束时 app.emit("qa-done", full_response)
```

### 5.2 讲解（流式输出）

```rust
#[tauri::command]
async fn generate_explanation_stream(
    app: tauri::AppHandle,
    knowledge_id: String,
    student_id: String,
    style: Option<String>,
) -> Result<()>;
// 通过 app.emit("explain-chunk", chunk) 逐 token 推送
```

### 5.3 讲解 Prompt

```
你是学生的数学学习搭子。请讲解以下知识点：

知识点：{knowledge_name}
学生年级：{grade}年级
学生画像摘要：{student_brief}
讲解风格：{style}

要求：
1. 用"我们"的口吻
2. 从学生已有知识出发
3. 先给直觉，再给严格定义
4. 结尾给一个"试试看"的小问题
5. 用小学生能听懂的语言
```

---

## 六、开发任务清单

### W3：知识图谱
- [ ] 设计人教版 1-6 年级知识点编码
- [ ] 创建知识点 JSON 数据文件
- [ ] 实现知识点导入和 CRUD
- [ ] 实现前置依赖关系
- [ ] 知识树 Tauri Command

### W4：题库
- [ ] 录入初始题库（每年级 30+ 道）
- [ ] 实现题库导入（JSON）
- [ ] 实现按条件出题（知识点+难度+排除）
- [ ] 实现 AI 出题（LLM 生成）
- [ ] 题库管理 Tauri Commands

### W5：判题 + 提示
- [ ] 实现规则判题（精确匹配）
- [ ] 实现 LLM 判题（错因分析）
- [ ] 实现三层提示系统
- [ ] 实现提示策略（根据行为层调整）
- [ ] 单元测试

### W6：问答 + 讲解 + 前端
- [ ] 实现流式问答
- [ ] 实现流式讲解
- [ ] 前端学习主界面（题目展示+答题+反馈）
- [ ] KaTeX 数学公式渲染
- [ ] 端到端测试

---

## 七、验收标准

- [ ] 能按年级/学期/单元查询知识点
- [ ] 能按知识点+难度出题
- [ ] 判题准确率 > 80%（含错因分类）
- [ ] 三层提示从引导到具体
- [ ] 问答/讲解流式输出正常
- [ ] 所有输出符合安全规范（不评判、不贴标签）
