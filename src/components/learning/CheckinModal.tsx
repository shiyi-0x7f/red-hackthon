import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { interestService } from '../../services';

type Phase = 'opening' | 'closing';

interface Props {
  open: boolean;
  phase: Phase;
  studentId: string;
  onClose: () => void;
}

/** 预设的开场/收场问题（LLM 不可用时的兜底） */
const FALLBACK_OPENING = [
  '嗨！开始之前我们先聊两句吧～ 最近在看什么有趣的书或动画呀？',
  '嘿嘿，又见面啦！说说看，你周末有什么好玩的事？',
  '准备好开动脑筋了吗？先告诉我你最近迷上了什么东西吧 ✨',
  '今天状态怎么样？最近有没有什么特别喜欢的游戏或者运动？',
];
const FALLBACK_CLOSING = [
  '做得辛苦啦～想去做点什么放松一下？',
  '今天的练习结束啦！等下想玩点什么？',
  '辛苦你啦，和我说说今天有没有什么开心的事？',
  '完成啦！最近家里有什么好玩的事吗？',
];

const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

const CheckinModal: React.FC<Props> = ({ open, phase, studentId, onClose }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [extracted, setExtracted] = useState<Array<{ category: string; name: string }> | null>(null);

  useEffect(() => {
    if (!open) {
      setAnswer('');
      setExtracted(null);
      return;
    }
    // 随机选一个兜底问题；LLM 版本 + checkin_persona 留给后续
    setQuestion(pickRandom(phase === 'opening' ? FALLBACK_OPENING : FALLBACK_CLOSING));
  }, [open, phase]);

  const handleSubmit = async () => {
    const text = answer.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const result = await interestService.extractFromText(studentId, text);
      if (result.extracted && result.extracted.length > 0) {
        setExtracted(
          result.extracted.map((e) => ({
            category: String(e.category ?? 'other'),
            name: String(e.name ?? ''),
          })).filter((e) => e.name),
        );
      } else {
        setExtracted([]);
      }
    } catch (e) {
      console.warn('[Checkin] 提取失败:', e);
      setExtracted([]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  const handleDone = () => {
    setAnswer('');
    setExtracted(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="checkin-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="checkin-panel"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            <div className="checkin-header">
              <span className="checkin-avatar">{phase === 'opening' ? '☀️' : '🌙'}</span>
              <span className="checkin-title">
                {phase === 'opening' ? '开始前聊两句' : '辛苦啦，休息前聊两句'}
              </span>
            </div>

            {!extracted ? (
              <>
                <div className="checkin-question">{question}</div>
                <textarea
                  className="checkin-input"
                  placeholder="随便写写，不想答就跳过 😊"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  disabled={submitting}
                  autoFocus
                />
                <div className="checkin-actions">
                  <button className="checkin-skip" onClick={handleSkip} disabled={submitting}>
                    跳过
                  </button>
                  <button
                    className="checkin-submit"
                    onClick={handleSubmit}
                    disabled={!answer.trim() || submitting}
                  >
                    {submitting ? '正在听你说...' : '发送'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="checkin-done">
                  {extracted.length > 0 ? (
                    <>
                      <div className="checkin-done-head">
                        ✨ 我记住这些啦，之后的题会更贴近你的生活！
                      </div>
                      <div className="checkin-extracted-list">
                        {extracted.map((e, i) => (
                          <span key={i} className="checkin-extracted-chip">{e.name}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="checkin-done-head">
                      谢谢分享～ 我们 {phase === 'opening' ? '开始吧' : '下次再聊'}！
                    </div>
                  )}
                </div>
                <div className="checkin-actions">
                  <button className="checkin-submit" onClick={handleDone}>
                    {phase === 'opening' ? '开始练习 →' : '好的'}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CheckinModal;
