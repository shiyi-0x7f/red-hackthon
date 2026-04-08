use serde::{Deserialize, Serialize};

/// 学生基本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Student {
    pub id: String,
    pub name: String,
    pub grade: i32,
    pub created_at: String,
}

/// 学习会话
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningSession {
    pub id: String,
    pub student_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub end_reason: Option<String>,
    pub total_questions: i32,
    pub correct_count: i32,
}

/// 题目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub knowledge_id: String,
    pub question_type: String,
    pub difficulty: i32,
    pub content: serde_json::Value,
    pub answer: serde_json::Value,
    pub explanation: Option<String>,
}

/// 答题记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerRecord {
    pub id: String,
    pub session_id: String,
    pub question_id: String,
    pub student_answer: serde_json::Value,
    pub is_correct: bool,
    pub time_spent_secs: i64,
    pub hint_used: i32,
    pub error_type: Option<String>,
    pub created_at: String,
}

/// 知识点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub grade: i32,
    pub unit: i32,
    pub description: Option<String>,
}

/// 知识掌握度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeMastery {
    pub student_id: String,
    pub knowledge_id: String,
    pub mastery_score: f64,
    pub attempt_count: i32,
    pub correct_count: i32,
    pub last_practiced_at: Option<String>,
    pub forgetting_risk: f64,
}
