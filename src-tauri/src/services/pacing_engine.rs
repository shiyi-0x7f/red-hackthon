/// 节奏控制引擎
/// 
/// 负责：时长监控、疲劳预警、收束策略
/// 开发计划：W11

/// 节奏状态
#[derive(Debug, Clone, serde::Serialize)]
pub struct PacingState {
    pub elapsed_minutes: i64,
    pub max_minutes: i32,
    pub remaining_minutes: i32,
    pub phase: PacingPhase,
}

/// 节奏阶段
#[derive(Debug, Clone, serde::Serialize)]
pub enum PacingPhase {
    /// 正常学习
    Normal,
    /// 预警（剩余 5 分钟）
    Warning,
    /// 收束（开始总结）
    WindingDown,
    /// 超时降级
    Overtime,
}

/// 评估当前节奏状态（骨架）
pub fn evaluate(elapsed_minutes: i64, max_minutes: i32) -> PacingState {
    let remaining = max_minutes as i64 - elapsed_minutes;
    let phase = if remaining <= 0 {
        PacingPhase::Overtime
    } else if remaining <= 2 {
        PacingPhase::WindingDown
    } else if remaining <= 5 {
        PacingPhase::Warning
    } else {
        PacingPhase::Normal
    };

    PacingState {
        elapsed_minutes,
        max_minutes,
        remaining_minutes: remaining.max(0) as i32,
        phase,
    }
}
