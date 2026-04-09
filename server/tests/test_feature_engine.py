"""对应 src-tauri/src/services/feature_engine.rs 的 #[test] 用例"""
from app.services.feature_engine import AnswerData, compute_features


def test_empty_records():
    f = compute_features([])
    assert f.accuracy_rate == 0.0
    assert f.max_consecutive_errors == 0


def test_all_correct():
    records = [
        AnswerData(time_spent_secs=10, is_correct=True, hint_used=0, was_skipped=False),
        AnswerData(time_spent_secs=15, is_correct=True, hint_used=0, was_skipped=False),
        AnswerData(time_spent_secs=20, is_correct=True, hint_used=0, was_skipped=False),
    ]
    f = compute_features(records)
    assert f.accuracy_rate == 1.0
    assert f.max_consecutive_errors == 0
    assert abs(f.avg_response_time - 15.0) < 0.01


def test_consecutive_errors():
    records = [
        AnswerData(time_spent_secs=10, is_correct=True, hint_used=0, was_skipped=False),
        AnswerData(time_spent_secs=10, is_correct=False, hint_used=0, was_skipped=False),
        AnswerData(time_spent_secs=10, is_correct=False, hint_used=1, was_skipped=False),
        AnswerData(time_spent_secs=10, is_correct=False, hint_used=0, was_skipped=False),
        AnswerData(time_spent_secs=10, is_correct=True, hint_used=0, was_skipped=False),
    ]
    f = compute_features(records)
    assert f.max_consecutive_errors == 3
    assert abs(f.accuracy_rate - 0.4) < 0.01
    assert abs(f.hint_usage_rate - 0.2) < 0.01
