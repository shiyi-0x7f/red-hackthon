use tauri::State;
use crate::state::AppState;
use crate::error::AppResult;
use serde::Deserialize;
use std::collections::HashMap;

/// 知识图谱 JSON 结构
#[derive(Debug, Deserialize)]
struct KnowledgeMapJson {
    #[serde(rename = "年级")]
    grade: String,
    #[serde(rename = "学科")]
    subject: String,
    #[serde(rename = "版本")]
    version: String,
    #[serde(rename = "学期")]
    semesters: HashMap<String, Vec<UnitJson>>,
}

#[derive(Debug, Deserialize)]
struct UnitJson {
    #[serde(rename = "单元")]
    unit: String,
    #[serde(rename = "知识点")]
    knowledge_points: Vec<String>,
}

/// 获取知识树
#[tauri::command]
pub async fn get_knowledge_tree(
    grade: i32,
    state: State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    tracing::debug!("获取知识树: {}年级", grade);

    // 从题库中提取单元信息
    let units = state.question_bank.unit_names();
    let mut unit_data: Vec<serde_json::Value> = Vec::new();

    // 尝试加载知识图谱 JSON
    let knowledge_map = load_knowledge_map();

    if let Some(map) = knowledge_map {
        for semester_name in &["上册", "下册"] {
            if let Some(semester_units) = map.semesters.get(*semester_name) {
                for (idx, unit) in semester_units.iter().enumerate() {
                    let question_count = state.question_bank.questions_for_unit(&unit.unit).len();

                    // 查询该单元掌握度（如果有学生ID的话从数据库查，这里返回单元基本信息）
                    unit_data.push(serde_json::json!({
                        "id": format!("unit-{}-{:02}", semester_name, idx + 1),
                        "name": unit.unit,
                        "semester": semester_name,
                        "sort_order": idx,
                        "knowledge_points": unit.knowledge_points,
                        "knowledge_point_count": unit.knowledge_points.len(),
                        "question_count": question_count,
                    }));
                }
            }
        }
    } else {
        // 回退：从题库单元列表构建
        for (idx, unit_name) in units.iter().enumerate() {
            let question_count = state.question_bank.questions_for_unit(unit_name).len();
            unit_data.push(serde_json::json!({
                "id": format!("unit-{:02}", idx + 1),
                "name": unit_name,
                "semester": if idx < units.len() / 2 { "上册" } else { "下册" },
                "sort_order": idx,
                "knowledge_points": [],
                "knowledge_point_count": 0,
                "question_count": question_count,
            }));
        }
    }

    Ok(serde_json::json!({
        "grade": grade,
        "total_units": unit_data.len(),
        "units": unit_data,
    }))
}

/// 加载知识图谱 JSON
fn load_knowledge_map() -> Option<KnowledgeMapJson> {
    let paths = [
        "data/grade6_math_knowledge_map.json",
        "../data/grade6_math_knowledge_map.json",
        "../../data/grade6_math_knowledge_map.json",
    ];
    for path in &paths {
        let p = std::path::Path::new(path);
        if p.exists() {
            if let Ok(content) = std::fs::read_to_string(p) {
                if let Ok(map) = serde_json::from_str::<KnowledgeMapJson>(&content) {
                    tracing::info!("知识图谱加载成功: {:?}", p);
                    return Some(map);
                }
            }
        }
    }
    tracing::warn!("未找到知识图谱 JSON 文件");
    None
}
