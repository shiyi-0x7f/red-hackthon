import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { studentModelService, type RealtimeProfile } from '../../services';

interface Props {
  studentId: string;
  /** 触发器：每变化一次就重新拉一次（通常传 store.answers.length） */
  refreshKey: number;
}

/**
 * 学生端学习仪表盘
 *
 * ⚠️ 设计原则（严格遵守 dev_docs/00_项目总览与原则.md）：
 * 学生端只展示「中性、鼓励性」的信息，绝不展示可能让学生贴标签的指标。
 * 因此：
 * - ❌ 不显示行为层（hint_dependency / impulsivity / accuracy_rate 整体值）
 * - ❌ 不显示状态层（fatigue / attention / frustration / cognitive_load）
 * - ✅ 只显示：知识薄弱点、本次会话时长 / 进度、平均用时
 *
 * 完整 6 层画像在【家长端】展示（Parent 页 ParentDashboard）
 */
const StudentDashboard: React.FC<Props> = ({ studentId, refreshKey }) => {
  const [profile, setProfile] = useState<RealtimeProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    studentModelService
      .getRealtimeProfile(studentId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e) => console.warn('[Dashboard] 拉取画像失败:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, refreshKey]);

  if (!profile) {
    return (
      <aside className="student-dashboard">
        <div className="dash-loading">{loading ? '加载中...' : '准备中'}</div>
      </aside>
    );
  }

  const k = profile.knowledge_layer ?? { weak_topics: [], overall_mastery: 0 };
  const b = profile.behavior_layer ?? { sample_count: 0, avg_response_time: 0 };
  const sess = profile.session_layer ?? { duration_secs: 0, total_questions: 0 };

  return (
    <aside className="student-dashboard">
      <div className="dash-header">
        <span className="dash-header-title">📓 学习小本本</span>
      </div>

      {/* 知识薄弱点（只突出"我们一起加油的方向"，不显示总体掌握度数字以免打击）*/}
      {k.weak_topics.length > 0 && (
        <div className="dash-section">
          <div className="dash-section-title">🌱 我们一起加油的知识点</div>
          <div className="dash-weak-list dash-weak-list-friendly">
            <AnimatePresence>
              {k.weak_topics.slice(0, 3).map((t) => (
                <motion.div
                  key={t.name}
                  className="dash-weak-item"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="dash-weak-name">{t.name}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* 本次会话进度（中性数据，不评价）*/}
      <div className="dash-section dash-section-session">
        <div className="dash-section-title">⏱ 本次学习</div>
        <div className="dash-mini-row">
          <div className="dash-mini">
            <span className="dash-mini-label">时长</span>
            <span className="dash-mini-value">
              {Math.floor(sess.duration_secs / 60)}:{String(sess.duration_secs % 60).padStart(2, '0')}
            </span>
          </div>
          <div className="dash-mini">
            <span className="dash-mini-label">已做</span>
            <span className="dash-mini-value">{sess.total_questions} 道</span>
          </div>
        </div>
        {b.sample_count > 0 && (
          <div className="dash-mini-row" style={{ marginTop: 8 }}>
            <div className="dash-mini">
              <span className="dash-mini-label">平均用时</span>
              <span className="dash-mini-value">{b.avg_response_time.toFixed(0)}s</span>
            </div>
          </div>
        )}
      </div>

      {/* 鼓励语 — 静态正向，不基于"挫败感/疲劳"等敏感指标 */}
      <div className="dash-encourage">
        慢慢来，每一道题都是进步 ✨
      </div>
    </aside>
  );
};

export default StudentDashboard;
