import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { studentModelService, type RealtimeProfile } from '../../services';

interface Props {
  studentId: string;
  /** 触发器：每变化一次就重新拉一次（通常传 store.answers.length） */
  refreshKey: number;
}

/** 数值条 */
const Bar: React.FC<{
  label: string;
  value: number; // 0~1
  color: string;
  reverse?: boolean; // true: 越低越好 → 红色高
  format?: (v: number) => string;
}> = ({ label, value, color, reverse, format }) => {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const display = format ? format(value) : `${pct.toFixed(0)}%`;
  const danger = reverse ? value > 0.6 : value < 0.4;
  return (
    <div className="dash-bar">
      <div className="dash-bar-row">
        <span className="dash-bar-label">{label}</span>
        <span className={`dash-bar-value ${danger ? 'danger' : ''}`}>{display}</span>
      </div>
      <div className="dash-bar-track">
        <motion.div
          className="dash-bar-fill"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
};

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
        <div className="dash-loading">{loading ? '加载画像...' : '画像数据为空'}</div>
      </aside>
    );
  }

  const k = profile.knowledge_layer;
  const b = profile.behavior_layer;
  const s = profile.state_layer;
  const sess = profile.session_layer;

  return (
    <aside className="student-dashboard">
      <div className="dash-header">
        <span className="dash-header-title">学生画像</span>
        <span className="dash-header-tag">实时</span>
      </div>

      {/* 知识层 */}
      <div className="dash-section">
        <div className="dash-section-title">📚 知识掌握</div>
        <Bar
          label="平均掌握度"
          value={k.avg_mastery}
          color="linear-gradient(90deg, #7C5CFC, #54B5FF)"
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
        {k.weak_topics.length > 0 && (
          <div className="dash-weak-list">
            <div className="dash-weak-label">⚠️ 薄弱点 (Top {k.weak_topics.length})</div>
            <AnimatePresence>
              {k.weak_topics.map((t) => (
                <motion.div
                  key={t.name}
                  className="dash-weak-item"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="dash-weak-name">{t.name}</span>
                  <span className="dash-weak-pct">{(t.mastery * 100).toFixed(0)}%</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* 行为层 */}
      <div className="dash-section">
        <div className="dash-section-title">🎯 行为特征</div>
        <Bar label="正确率" value={b.accuracy_rate} color="#54B5FF" />
        <Bar label="提示依赖" value={b.hint_dependency} color="#FFB74D" reverse />
        <Bar label="冲动度" value={b.impulsivity} color="#FF8A65" reverse />
        <div className="dash-mini-row">
          <div className="dash-mini">
            <span className="dash-mini-label">平均用时</span>
            <span className="dash-mini-value">{b.avg_response_time.toFixed(0)}s</span>
          </div>
          <div className="dash-mini">
            <span className="dash-mini-label">样本</span>
            <span className="dash-mini-value">{b.sample_count}</span>
          </div>
        </div>
      </div>

      {/* 状态层 */}
      <div className="dash-section">
        <div className="dash-section-title">💡 当前状态</div>
        <Bar label="疲劳度" value={s.fatigue} color="#FF8A65" reverse />
        <Bar label="注意力" value={s.attention} color="#66BB6A" />
        <Bar label="挫败感" value={s.frustration} color="#EF5350" reverse />
        <Bar label="认知负荷" value={s.cognitive_load} color="#AB47BC" reverse />
      </div>

      {/* 会话信息 */}
      {sess.active && (
        <div className="dash-section dash-section-session">
          <div className="dash-section-title">⏱ 本次会话</div>
          <div className="dash-mini-row">
            <div className="dash-mini">
              <span className="dash-mini-label">时长</span>
              <span className="dash-mini-value">
                {Math.floor(sess.duration_secs / 60)}:{String(sess.duration_secs % 60).padStart(2, '0')}
              </span>
            </div>
            <div className="dash-mini">
              <span className="dash-mini-label">已答</span>
              <span className="dash-mini-value">{sess.correct_count}/{sess.total_questions}</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default StudentDashboard;
