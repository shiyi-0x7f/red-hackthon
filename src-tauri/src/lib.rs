mod commands;
mod config;
mod db;
mod error;
mod models;
mod services;
mod state;
mod ai;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::{fmt, EnvFilter};

/// 初始化日志系统
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,ai_learning_lib=debug"));

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true)
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tracing::info!("AI 学习搭子启动中...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // 初始化应用状态
            let app_state = AppState::new(&app_handle)
                .expect("初始化应用状态失败");

            // 运行数据库迁移
            app_state.run_migrations()
                .expect("数据库迁移失败");

            app.manage(app_state);

            tracing::info!("应用初始化完成");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 学生管理
            commands::student::create_student,
            commands::student::get_student,
            commands::student::list_students,
            // 知识图谱
            commands::knowledge::get_knowledge_tree,
            // 题库
            commands::question::generate_quiz,
            commands::question::get_question_bank_overview,
            commands::question::generate_ai_question,
            // 学习主引擎
            commands::learning::start_session,
            commands::learning::submit_answer,
            commands::learning::end_session,
            commands::learning::generate_session_summary,
            // 学生模型
            commands::student_model::get_student_profile,
            commands::student_model::get_student_state,
            commands::student_model::get_realtime_profile,
            commands::student_model::get_profile_overview,
            commands::student_model::get_wrong_answers,
            commands::student_model::get_review_recommendations,
            // 决策引擎
            commands::decision::get_next_action,
            // 节奏控制
            commands::pacing::get_pacing_status,
            // 对话
            commands::chat::send_chat_message,
            commands::chat::send_chat_message_stream,
            commands::chat::get_chat_history,
            // 家长端
            commands::parent::verify_parent_password,
            commands::parent::set_parent_password,
            commands::parent::get_learning_overview,
            commands::parent::get_mastery_overview,
            // 设置
            commands::settings::save_api_key,
            commands::settings::get_settings,
            // 讲解 + 提示（P0）
            commands::explain::generate_explanation_stream,
            commands::explain::get_layered_hint,
            // 兴趣画像（P4）
            commands::interests::list_interests,
            commands::interests::add_interest,
            commands::interests::delete_interest,
            commands::interests::extract_interests_from_text,
            commands::interests::get_student_background,
            commands::interests::update_student_background,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}
