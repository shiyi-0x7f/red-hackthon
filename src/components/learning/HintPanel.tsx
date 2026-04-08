import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BulbOutlined } from '@ant-design/icons';
import { hintService } from '../../services';

interface HintItem {
  level: 1 | 2 | 3;
  text: string;
}

interface Props {
  questionId: string;
  studentId?: string;
  sessionId?: string;
  /** 父组件已用提示数（用于权重计算），由父维护 */
  hintsUsed: number;
  onHintRevealed: (level: number) => void;
}

const TIER_LABEL: Record<number, string> = {
  1: '启发提示',
  2: '解题方向',
  3: '详细步骤',
};

/** 分层提示组件 — 3 次点击逐级揭示 */
const HintPanel: React.FC<Props> = ({ questionId, studentId, sessionId, hintsUsed, onHintRevealed }) => {
  const [hints, setHints] = useState<HintItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextLevel = (hints.length + 1) as 1 | 2 | 3;
  const reachedMax = hints.length >= 3;

  const handleReveal = async () => {
    if (reachedMax || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await hintService.get(questionId, nextLevel, studentId, sessionId);
      setHints((prev) => [...prev, { level: nextLevel, text: res.text }]);
      onHintRevealed(nextLevel);
    } catch (e) {
      console.error('提示请求失败:', e);
      setError('提示暂不可用');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hint-panel">
      <button
        className={`hint-trigger-btn ${reachedMax ? 'disabled' : ''}`}
        onClick={handleReveal}
        disabled={reachedMax || loading}
        type="button"
      >
        <BulbOutlined />
        {reachedMax
          ? '提示已全部展示'
          : loading
            ? '思考中...'
            : `获取${TIER_LABEL[nextLevel]}（${nextLevel}/3）`}
      </button>

      {error && <div className="hint-error">{error}</div>}

      <AnimatePresence>
        {hints.map((h) => (
          <motion.div
            key={h.level}
            className={`hint-item hint-level-${h.level}`}
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="hint-item-label">
              <span className="hint-level-badge">L{h.level}</span>
              {TIER_LABEL[h.level]}
            </div>
            <div className="hint-item-text">{h.text}</div>
          </motion.div>
        ))}
      </AnimatePresence>

      {hintsUsed > 0 && (
        <div className="hint-usage-note">
          已使用 {hintsUsed} 层提示，本题成绩会按权重折算
        </div>
      )}
    </div>
  );
};

export default HintPanel;
