import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { studentModelService, type ReviewItem as BackendReviewItem } from '../../services';

const STUDENT_ID = 'default-student';

interface UiReviewItem {
  id: string;
  knowledge_id: string;
  name: string;
  mastery: number;
  forgettingRisk: number;
  attemptCount: number;
  hoursSinceLast: number;
}

function fromBackend(b: BackendReviewItem): UiReviewItem {
  return {
    id: b.knowledge_id,
    knowledge_id: b.knowledge_id,
    name: b.name,
    mastery: b.mastery_score,
    forgettingRisk: b.forgetting_risk,
    attemptCount: b.attempt_count,
    hoursSinceLast: b.hours_since_last,
  };
}

const formatLastSeen = (hours: number): string => {
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const ReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<UiReviewItem[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState<'mock' | 'tauri'>('mock');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    studentModelService
      .getReviewRecommendations(STUDENT_ID)
      .then((real) => {
        if (cancelled) return;
        setItems(real.map(fromBackend));
        // 检测是否真实后端：通过 hours_since_last 字段是否随机化判断
        // 简化：用 isTauri 副效应（service 内部已分流）
        if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
          setDataSource('tauri');
        }
      })
      .catch((e) => console.warn('[Review] 拉取推荐失败:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const sortedItems = [...items].sort((a, b) => b.forgettingRisk - a.forgettingRisk);
  const todoItems = sortedItems.filter((i) => !completedIds.has(i.id));
  const doneItems = sortedItems.filter((i) => completedIds.has(i.id));

  const handleStartReview = (item: UiReviewItem) => {
    // Practice 页支持中文 unit 名直接作为 unitId
    navigate(`/practice/${encodeURIComponent(item.name)}`);
  };

  const handleMarkDone = (id: string) => {
    setCompletedIds((prev) => new Set(prev).add(id));
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
          <h1 className="page-title">
            🔄 智能复习
            <span className={`profile-source-tag ${dataSource}`}>
              {dataSource === 'tauri' ? '✅ 实时数据' : '🧪 演示数据'}
            </span>
          </h1>
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

      <div className="review-plan">
        <h2 className="section-title-inline">📋 今日复习计划</h2>

        {loading ? (
          <div className="review-empty">
            <span className="review-empty-icon">⏳</span>
            <p>正在从遗忘曲线分析需要复习的知识点...</p>
          </div>
        ) : todoItems.length === 0 ? (
          <div className="review-empty">
            <span className="review-empty-icon">🎉</span>
            <p>{items.length === 0 ? '还没有学习数据，先去做几道题吧！' : '今天的复习任务都完成啦！'}</p>
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
                        <span>遗忘风险 {(item.forgettingRisk * 100).toFixed(0)}%</span>
                        <span className="meta-dot">·</span>
                        <span>上次 {formatLastSeen(item.hoursSinceLast)}</span>
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
