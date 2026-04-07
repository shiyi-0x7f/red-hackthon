# Phase 1 — 内容资源与基础学习功能

> MVP 阶段第一步：搭建知识图谱、题库、出题/判题/问答基础能力。  
> 对应模块 ① 内容资源层 + ② 基础学习功能层。  
> **基于 AstrBot 的 LLM Provider 和 Quart 路由实现。**

---

## 一、知识图谱系统（模块 ①）

### 1.1 数据结构

知识点采用**层级树 + 前置依赖图**双结构：

```
数学(六年级)
├── 数与代数
│   ├── 分数四则运算
│   │   ├── 分数加减法
│   │   ├── 分数乘法
│   │   └── 分数除法
│   ├── 比和比例
│   ├── 百分数应用
│   └── 正负数初步
├── 图形与几何
│   ├── 圆的认识
│   ├── 圆的面积和周长
│   └── 立体图形
└── 统计与概率
    ├── 扇形统计图
    └── 可能性
```

### 1.2 API 路由

```python
# astrbot/dashboard/routes/knowledge_graph.py
from quart import Blueprint, jsonify, request

kb_bp = Blueprint('knowledge', __name__)

@kb_bp.route('/api/knowledge/tree', methods=['GET'])
async def get_knowledge_tree():
    """获取知识树"""
    grade = request.args.get('grade', 6, type=int)
    tree = await db.get_knowledge_tree(grade)
    return jsonify(tree)

@kb_bp.route('/api/knowledge/<kp_id>', methods=['GET'])
async def get_knowledge_detail(kp_id: str):
    """知识点详情"""
    kp = await db.get_knowledge_point(kp_id)
    return jsonify(kp)

@kb_bp.route('/api/knowledge/<kp_id>/questions', methods=['GET'])
async def get_related_questions(kp_id: str):
    """获取关联题目"""
    questions = await db.get_questions(knowledge_ids=[kp_id], difficulty=None, limit=20)
    return jsonify(questions)
```

### 1.3 初始数据建设

**MVP 最低要求**：
- 聚焦六年级数学
- 20-30 个知识点
- 知识点间建立前置依赖关系

**数据来源**：
- 人教版六年级教材目录
- 硬编码 JSON 数据，启动时自动导入

---

## 二、题库系统

### 2.1 题目类型（MVP 简化）

| 类型 | code | 说明 |
|------|------|------|
| 选择题 | choice | 单选 |
| 填空题 | fill | 数值/表达式 |
| 计算题 | solve | 解题过程 |

> MVP 阶段仅支持 3 种题型，proof/open 留到 V2。

### 2.2 题目数据结构

```json
{
  "id": "uuid",
  "content": "一个圆的半径是 3cm，求它的面积。（$\\pi$ 取 3.14）",
  "type": "solve",
  "difficulty": 2,
  "answer": {
    "value": "28.26",
    "unit": "cm²",
    "explanation": "S = πr² = 3.14 × 3² = 3.14 × 9 = 28.26 cm²"
  },
  "solution_steps": [
    {"step": 1, "content": "写出面积公式", "detail": "$S = \\pi r^2$"},
    {"step": 2, "content": "代入数据", "detail": "$S = 3.14 \\times 3^2$"},
    {"step": 3, "content": "计算结果", "detail": "$S = 3.14 \\times 9 = 28.26$ cm²"}
  ],
  "hints": [
    {"level": 1, "content": "圆的面积公式是什么？"},
    {"level": 2, "content": "面积 = π × 半径²，试试代入"},
    {"level": 3, "content": "S = 3.14 × 3 × 3 = ?"}
  ],
  "knowledge_ids": ["circle-area"],
  "tags": ["圆", "面积", "六年级"]
}
```

### 2.3 API 路由

```python
# astrbot/dashboard/routes/learning.py (题目部分)

@learning_bp.route('/api/questions', methods=['GET'])
async def query_questions():
    """按条件查询题目"""
    knowledge_id = request.args.get('knowledge_id')
    difficulty = request.args.get('difficulty', type=int)
    qtype = request.args.get('type')
    limit = request.args.get('limit', 10, type=int)
    
    questions = await db.get_questions(
        knowledge_ids=[knowledge_id] if knowledge_id else None,
        difficulty=difficulty,
        limit=limit
    )
    return jsonify(questions)

@learning_bp.route('/api/questions/<qid>/hints/<int:level>', methods=['GET'])
async def get_hint(qid: str, level: int):
    """获取分层提示"""
    question = await db.get_question(qid)
    hints = question.hints or []
    available = [h for h in hints if h['level'] <= level]
    return jsonify({'hints': available, 'max_level': len(hints)})
```

### 2.4 初始题库建设

**MVP 最低要求**：
- 30-50 道六年级数学题
- 覆盖 difficulty 1-4
- 每题至少 2 层 hints
- 硬编码在插件的 seed 数据中

---

## 三、出题系统

### 3.1 两种出题方式

#### 方式 1：题库抽取（优先）
```python
async def select_from_pool(knowledge_ids, difficulty, exclude_ids, count=1):
    """从题库中匹配，排除已做题"""
    questions = await db.get_questions(
        knowledge_ids=knowledge_ids,
        difficulty=difficulty,
        limit=count * 3  # 多取一些用于排除
    )
    filtered = [q for q in questions if q.id not in exclude_ids]
    return filtered[:count]
```

#### 方式 2：AI 动态生成（补充）
```python
async def generate_by_llm(knowledge_name, difficulty, student_brief, core):
    """调用 AstrBot LLM Provider 生成题目"""
    prompt = GENERATE_QUESTION_PROMPT.format(
        knowledge_name=knowledge_name,
        difficulty=difficulty,
        student_brief=student_brief,
    )
    provider = core.provider_manager.get_default_provider()
    result = await provider.text_chat(prompt=prompt)
    return parse_question_json(result)
```

---

## 四、判题系统

### 4.1 判题逻辑

```
选择题/填空题 → 精确匹配 + 等价判断（本地 Python）
解答题 → LLM 步骤分析（调用 AstrBot Provider）
```

### 4.2 错因分类（核心）

| 类型 | code | 示例 |
|------|------|------|
| 概念错误 | conceptual | 对公式理解错误 |
| 步骤错误 | procedural | 计算过程出错 |
| 粗心错误 | careless | 抄错数字、符号 |
| 策略错误 | strategic | 方法选择不当 |

### 4.3 判题服务

```python
# astrbot/core/learning/question_service.py

class QuestionService:
    def __init__(self, core_lifecycle):
        self.core = core_lifecycle
    
    async def evaluate_answer(self, question: Question, student_answer: str, 
                              time_spent_sec: float) -> dict:
        """判题入口"""
        if question.type in ('choice', 'fill'):
            return self._local_judge(question, student_answer)
        else:
            return await self._llm_judge(question, student_answer)
    
    def _local_judge(self, question: Question, student_answer: str) -> dict:
        """本地判题（选择/填空）"""
        correct_value = str(question.answer.get('value', '')).strip()
        is_correct = student_answer.strip() == correct_value
        return {
            'is_correct': is_correct,
            'error_type': None if is_correct else 'unknown',
            'correct_answer': question.answer,
            'feedback': '答对了！' if is_correct else f'正确答案是 {correct_value}'
        }
    
    async def _llm_judge(self, question: Question, student_answer: str) -> dict:
        """LLM 判题（解答题）"""
        prompt = JUDGE_PROMPT.format(
            question=question.content,
            answer=json.dumps(question.answer, ensure_ascii=False),
            solution_steps=json.dumps(question.solution_steps, ensure_ascii=False),
            student_answer=student_answer,
        )
        provider = self.core.provider_manager.get_default_provider()
        result = await provider.text_chat(prompt=prompt)
        return parse_judge_result(result)
```

### 4.4 判题 Prompt 模板

```
你是一名数学教师。请分析以下学生的答案：

题目：{question}
标准答案：{answer}
标准解题步骤：{solution_steps}
学生答案：{student_answer}

请判断：
1. 是否正确
2. 错误类型（conceptual/procedural/careless/strategic）
3. 具体哪一步出错
4. 用行为描述（非评判）给出反馈

注意：
- 不要说"你不行"或"你错了"
- 用"这一步..."而非"你..."
- 指出可以改进的具体点

输出格式：JSON { is_correct, error_type, error_step, feedback }
```

---

## 五、问答系统

### 5.1 功能范围

| 场景 | 说明 |
|------|------|
| 概念提问 | "圆的面积公式是什么？" |
| 题目答疑 | "这道题为什么要用除法？" |
| 步骤解释 | "第 2 步是怎么来的？" |
| 方法对比 | "这道题还能用别的方法吗？" |

### 5.2 实现方式

直接复用 AstrBot 的对话能力（LiveChat / SSE），注入学习上下文：

```python
async def ask_question_with_context(student_id, question_text, task_id=None):
    """带学习上下文的问答"""
    # 获取学生画像摘要
    student = await db.get_student(student_id)
    profile = await build_student_brief(student)
    
    # 构建上下文
    context = {
        'knowledge_name': current_knowledge_name,
        'current_question': current_question_content if task_id else None,
        'student_brief': profile,
    }
    
    prompt = QA_PROMPT.format(question=question_text, **context)
    
    # 调用 AstrBot Provider 流式输出
    provider = core.provider_manager.get_default_provider()
    async for chunk in provider.stream_chat(prompt=prompt):
        yield chunk
```

---

## 六、讲解生成

### 6.1 讲解方式

| 方式 | 适用 |
|------|------|
| AI 动态生成 | 根据学生画像个性化生成（主要方式） |
| 知识库检索 | 从 FAISS 检索现有讲解材料（补充） |

### 6.2 实现

```python
async def generate_explanation(knowledge_id, student_id, style=None):
    """生成个性化讲解"""
    kp = await db.get_knowledge_point(knowledge_id)
    student = await db.get_student(student_id)
    profile = await build_student_brief(student)
    
    prompt = EXPLAIN_PROMPT.format(
        knowledge_name=kp.name,
        student_brief=profile,
        style=style or 'balanced',
    )
    
    provider = core.provider_manager.get_default_provider()
    async for chunk in provider.stream_chat(prompt=prompt):
        yield chunk
```

---

## 七、开发任务清单

### 阶段 1：知识图谱 + 题库（~4h）
- [ ] 在 po.py 中定义 KnowledgePoint + Question 表
- [ ] 在 sqlite.py 中实现 CRUD
- [ ] 创建 knowledge_graph.py 路由
- [ ] 硬编码六年级知识点数据（JSON）
- [ ] 硬编码 30-50 道题目数据

### 阶段 2：出题 + 判题（~4h）
- [ ] 实现 QuestionService
- [ ] 实现本地判题（选择/填空）
- [ ] 实现 LLM 判题（调用 AstrBot Provider）
- [ ] 实现分层提示返回
- [ ] 创建 learning.py 路由（题目相关端点）

### 阶段 3：问答 + 讲解（~3h）
- [ ] 实现带上下文的问答（SSE 流式）
- [ ] 实现讲解生成
- [ ] 集成测试：出题→答题→判题→提示→问答 流程

---

## 八、验收标准

- [ ] 知识图谱可正确展示层级
- [ ] 题库可按知识点+难度筛选出题
- [ ] 判题错因分类准确（LLM 判题返回 JSON 可解析）
- [ ] 提示分层返回，从引导到具体
- [ ] 问答回复符合"学习搭子"风格
- [ ] 数学公式正确渲染（KaTeX）
