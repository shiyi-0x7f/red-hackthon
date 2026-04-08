import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

interface ReviewItem {
  id: string;
  name: string;
  mastery: number;
  forgettingRisk: number;
  lastPracticed: string;
  daysSince: number;
}

const mockReviewItems: ReviewItem[] = [
  { id: 'r1', name: '分数除法', mastery: 0.55, forgettingRisk: 0.72, lastPracticed: '3天前', daysSince: 3 },
  { id: 'r2', name: '圆的面积', mastery: 0.42, forgettingRisk: 0.68, lastPracticed: '5天前', daysSince: 5 },
  { id: 'r3', name: '百分数应用', mastery: 0.38, forgettingRisk: 0.65, lastPracticed: '4天前', daysSince: 4 },
  { id: 'r4', name: '比的基本性质', mastery: 0.60, forgettingRisk: 0.58, lastPracticed: '2天前', daysSince: 2 },
  { id: 'r5', name: '位置与方向', mastery: 0.48, forgettingRisk: 0.55, lastPracticed: '6天前', daysSince: 6 },
  { id: 'r6', name: '扇形统计图', mastery: 0.30, forgettingRisk: 0.80, lastPracticed: '7天前', daysSince: 7 },
];

const ReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const sortedItems = [...mockReviewItems].sort((a, b) => b.forgettingRisk - a.forgettingRisk);
  const todoItems = sortedItems.filter(i => !completedIds.has(i.id));
  const doneItems = sortedItems.filter(i => completedIds.has(i.id));

  const handleStartReview = (item: ReviewItem) => {
    navigate(`/practice/${encodeURIComponent(item.name)}`);
  };

  const handleMarkDone = (id: string) => {
    setCompletedIds(prev => new Set(prev).add(id));
  };

  const urgencyColor = (risk: number) => {
    if (risk >= 0.7) return '#FF6B6B';
    if (risk >= 0.5) return '#FFB647';
    return '#4ECDC4';
  };

  const urgencyLabel = (risk: number) => {
    if (risk >= 0.7) return '急需复习';
    if (risk >= 0.5) return '建议复习';
    return '可以复习';
  };

  return (
    <motion.div
      className="review-page"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="review-header">
        <div>
          <h1 className="page-title">🔄 智能复习</h1>
          <p className="page-subtitle">AI 根据遗忘曲线，帮你找到最需要复习的知识点</p>
        </div>
        <div className="review-summary">
          <div className="review-summary-item">
            <span className="review-summary-num">{todoItems.length}</span>
            <span className="review-summary-label">待复习</span>
          </div>
          <div className="review-summary-item done">
            <span className="review-summary-num">{doneItems.length}</span>
            <span className="review-summary-label">已完成</span>
          </div>
        </div>
      </div>

      {/* 今日复习计划 */}
      <div className="review-plan">
        <h2 className="section-title-inline">📋 今日复习计划</h2>

        {todoItems.length === 0 ? (
          <div className="review-empty">
            <span className="review-empty-icon">🎉</span>
            <p>今天的复习任务都完成啦！</p>
          </div>
        ) : (
          <div className="review-cards">
            <AnimatePresence>
              {todoItems.map((item, idx) => (
                <motion.div
                  key={item.id}
                  className="review-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <div className="review-card-left">
                    <div className="review-urgency" style={{ background: urgencyColor(item.forgettingRisk) }}>
                      {urgencyLabel(item.forgettingRisk)}
                    </div>
                    <div className="review-card-info">
                      <h3 className="review-card-name">{item.name}</h3>
                      <div className="review-card-meta">
                        <span>掌握度 {(item.mastery * 100).toFixed(0)}%</span>
                        <span className="meta-dot">·</span>
                        <span>上次练习 {item.lastPracticed}</span>
                      </div>
                    </div>
                  </div>

                  <div className="review-card-progress">
                    <div className="mini-progress-bar">
                      <div className="mini-progress-fill" style={{ width: `${item.mastery * 100}%` }} />
                    </div>
                  </div>

                  <div className="review-card-actions">
                    <button className="btn-primary btn-sm" onClick={() => handleStartReview(item)}>
                      开始复习
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => handleMarkDone(item.id)}>
                      已复习 ✓
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* 已完成 */}
      {doneItems.length > 0 && (
        <div className="review-done-section">
          <h2 className="section-title-inline">✅ 已完成</h2>
          <div className="review-done-list">
            {doneItems.map((item) => (
              <div key={item.id} className="review-done-item">
                <span className="done-check">✓</span>
                <span className="done-name">{item.name}</span>
                <span className="done-mastery">{(item.mastery * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default ReviewPage;
