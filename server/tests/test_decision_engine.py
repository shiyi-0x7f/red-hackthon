"""对应 src-tauri/src/services/decision_engine.rs 的 #[test] 用例"""
from app.services.decision_engine import MasteryInfo, decide


def test_force_end_on_high_fatigue():
    r = decide(
        fatigue=0.95,
        frustration=0.0,
        consecutive_errors=0,
        session_minutes=10,
        max_session_minutes=30,
        mastery_data=[],
    )
    assert r.action == "force_end"


def test_suggest_break_on_errors():
    r = decide(
        fatigue=0.3,
        frustration=0.5,
        consecutive_errors=5,
        session_minutes=10,
        max_session_minutes=30,
        mastery_data=[],
    )
    assert r.action == "suggest_break"


def test_timeout_force_end():
    r = decide(
        fatigue=0.3,
        frustration=0.0,
        consecutive_errors=0,
        session_minutes=30,
        max_session_minutes=30,
        mastery_data=[],
    )
    assert r.action == "force_end"


def test_review_on_high_forgetting():
    mastery = [
        MasteryInfo(
            knowledge_id="k1",
            name="分数乘法",
            mastery_score=0.5,
            forgetting_risk=0.8,
            last_practiced_hours_ago=72.0,
        )
    ]
    r = decide(
        fatigue=0.2,
        frustration=0.0,
        consecutive_errors=0,
        session_minutes=10,
        max_session_minutes=30,
        mastery_data=mastery,
    )
    assert r.action == "schedule_review"


def test_continue_on_weak_points():
    mastery = [
        MasteryInfo(
            knowledge_id="k1",
            name="圆的面积",
            mastery_score=0.2,
            forgetting_risk=0.1,
            last_practiced_hours_ago=1.0,
        )
    ]
    r = decide(
        fatigue=0.2,
        frustration=0.0,
        consecutive_errors=0,
        session_minutes=10,
        max_session_minutes=30,
        mastery_data=mastery,
    )
    assert r.action == "continue_practice"
