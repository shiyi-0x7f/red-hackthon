"""对应 src-tauri/src/services/student_model.rs 的 #[test] 用例"""
from app.services.student_model import (
    BKTParams,
    bkt_update,
    bkt_update_weighted,
    forgetting_risk,
)


def test_bkt_correct_increases_mastery():
    before = 0.5
    after = bkt_update(before, True)
    assert after > before, "答对后掌握度应上升"


def test_bkt_incorrect_decreases_mastery():
    before = 0.5
    correct_after = bkt_update(before, True)
    wrong_after = bkt_update(before, False)
    assert wrong_after < correct_after


def test_forgetting_increases_with_time():
    r1 = forgetting_risk(0.8, 1.0)
    r2 = forgetting_risk(0.8, 48.0)
    assert r2 > r1


def test_bkt_weighted_hint_penalizes_correct():
    """同样答对，用过提示的增量应 < 未用提示"""
    no_hint = bkt_update_weighted(0.5, True, hint_count=0, difficulty=2)
    with_hint = bkt_update_weighted(0.5, True, hint_count=2, difficulty=2)
    assert no_hint > with_hint


def test_bkt_weighted_difficulty_boosts_transit():
    """高难题答对，转移概率更大"""
    easy = bkt_update_weighted(0.5, True, hint_count=0, difficulty=1)
    hard = bkt_update_weighted(0.5, True, hint_count=0, difficulty=4)
    assert hard >= easy
