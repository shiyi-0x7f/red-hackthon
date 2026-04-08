import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { studentModelService, type RealtimeProfile } from '../../services';

interface Props {
  studentId: string;
}

/** 评级标签 */
const rate = (v: number, reverse = false): { label: string; color: string } => {
  const r = reverse ? 1 - v : v;
  if (r >= 0.7) return { label: '良好', color: '#5BC97F' };
  if (r >= 0.4) return { label: '一般', color: '#F5A623' };
  return { label: '需关注', color: '#E55A6F' };
};

const Gauge: React.FC<{
  label: string;
  value: number; // 0~1
  description: string;
  reverse?: boolean;
}> = ({ label, value, description, reverse }) => {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const r = rate(value, reverse);
  return (
    <div className="parent-gauge">
      <div className="parent-gauge-row">
        <span className="parent-gauge-label">{label}</span>
        <span className="parent-gauge-rating" style={{ background: r.color }}>{r.label}</span>
      </div>
      <div className="parent-gauge-track">
        <motion.div
          className="parent-gauge-fill"
          style={{ background: r.color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <div className="parent-gauge-desc">
        {description} · 当前 {pct.toFixed(0)}%
      </div>
    </div>
  );
};

/**
 * 家长端 — 学生 6 层实时画像（完整版）
 *
 * 包含给学生不展示的敏感指标：
 * - 行为层（hint_dependency / impulsivity）
 * - 状态层（fatigue / attention / frustration / cognitive_load）
 *
 * 这些数据只对家长可见，给家长判断是否需要调整学习节奏 / 寻求帮助
 */
const ParentRealtimePanel: React.FC<Props> = ({ studentId }) => {
  const [profile, setProfile] = useState<RealtimeProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    studentModelService
      .getRealtimeProfile(studentId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e) => console.warn('[ParentPanel] 拉取画像失败:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading || !profile) {
    return (
      <div className="card parent-realtime-panel">
        <h2 className="card-title">🧠 学习行为与状态（详细）</h2>
        <div style={{ padding: 20, textAlign: 'center', color: '#A89E91' }}>
          {loading ? '正在加载学生数据...' : '暂无数据'}
        </div>
      </div>
    );
  }

  const b = profile.behavior_layer;
  const s = profile.state_layer;

  return (
    <div className="card parent-realtime-panel">
      <h2 className="card-title">🧠 学习行为与状态（详细）</h2>
      <p className="parent-panel-disclaimer">
        以下数据由 AI 学习引擎根据近 20 道题的行为生成，仅供参考。请避免直接转述给孩子，更建议作为「调整节奏」的依据。
      </p>

      <div className="parent-panel-section">
        <div className="parent-panel-section-title">🎯 行为特征</div>
        <Gauge
          label="提示依赖度"
          value={b.hint_dependency}
          description="孩子在答题前/中查看提示的频率，过高可能说明知识点不熟练"
          reverse
        />
        <Gauge
          label="冲动作答倾向"
          value={b.impulsivity}
          description="响应时间过短的题目占比，过高可能未仔细审题"
          reverse
        />
        <Gauge
          label="近期正确率"
          value={b.accuracy_rate}
          description="近 20 道题的正确率"
        />
        <div className="parent-panel-mini-stats">
          <div className="parent-panel-mini">
            <span>平均用时</span>
            <strong>{b.avg_response_time.toFixed(0)} 秒</strong>
          </div>
          <div className="parent-panel-mini">
            <span>样本量</span>
            <strong>{b.sample_count} 题</strong>
          </div>
          <div className="parent-panel-mini">
            <span>最长连错</span>
            <strong>{b.max_consecutive_errors} 题</strong>
          </div>
        </div>
      </div>

      <div className="parent-panel-section">
        <div className="parent-panel-section-title">💡 当前学习状态</div>
        <Gauge
          label="疲劳度"
          value={s.fatigue}
          description="基于学习时长 + 连续错误估算，>60% 建议休息"
          reverse
        />
        <Gauge
          label="注意力"
          value={s.attention}
          description="基于答题速度和稳定性估算"
        />
        <Gauge
          label="挫败感"
          value={s.frustration}
          description="连续做错时上升，>60% 建议安抚或切换简单题"
          reverse
        />
        <Gauge
          label="认知负荷"
          value={s.cognitive_load}
          description="当前题目对孩子大脑的负担程度"
          reverse
        />
      </div>

      {profile.knowledge_layer.weak_topics.length > 0 && (
        <div className="parent-panel-section">
          <div className="parent-panel-section-title">⚠️ 薄弱知识点 Top 3</div>
          <div className="parent-weak-grid">
            {profile.knowledge_layer.weak_topics.map((t) => (
              <div key={t.name} className="parent-weak-item">
                <div className="parent-weak-name">{t.name}</div>
                <div className="parent-weak-mastery">掌握度 {(t.mastery * 100).toFixed(0)}%</div>
                <div className="parent-weak-meta">
                  练习 {t.attempts} 次 · 遗忘风险 {(t.forgetting_risk * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ParentRealtimePanel;
