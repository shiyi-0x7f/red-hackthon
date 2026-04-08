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
  idealIntervalHours: number;
  overdueRatio: number;
  priorityScore: number;
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
    idealIntervalHours: b.ideal_interval_hours ?? 0,
    overdueRatio: b.overdue_ratio ?? 1,
    priorityScore: b.priority_score ?? 0,
  };
}

const formatLastSeen = (hours: number): string => {
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

const formatInterval = (hours: number): string => {
  if (hours < 1) return '20 分钟';
  if (hours < 24) return `${Math.round(hours)} 小时`;
  const days = Math.round(hours / 24);
  return `${days} 天`;
};

/** 单个复习卡片 */
const ReviewCard: React.FC<{
  item: UiReviewItem;
  idx: number;
  urgencyColor: (ratio: number) => string;
  urgencyLabel: (ratio: number) => string;
  onStart: (item: UiReviewItem) => void;
  onDone: (id: string) => void;
}> = ({ item, idx, urgencyColor, urgencyLabel, onStart, onDone }) => (
  <motion.div
    key={item.id}
    className="review-card"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, x: -100 }}
    transition={{ delay: idx * 0.05 }}
  >
    <div className="review-card-left">
      <div className="review-urgency" style={{ background: urgencyColor(item.overdueRatio) }}>
        {urgencyLabel(item.overdueRatio)}
      </div>
      <div className="review-card-info">
        <h3 className="review-card-name">{item.name}</h3>
        <div className="review-card-meta">
          <span>掌握度 {(item.mastery * 100).toFixed(0)}%</span>
          <span className="meta-dot">·</span>
          <span>上次 {formatLastSeen(item.hoursSinceLast)}</span>
          <span className="meta-dot">·</span>
          <span>最佳间隔 {formatInterval(item.idealIntervalHours)}</span>
        </div>
      </div>
    </div>

    <div className="review-card-progress">
      <div className="mini-progress-bar">
        <div className="mini-progress-fill" style={{ width: `${item.mastery * 100}%` }} />
      </div>
    </div>

    <div className="review-card-actions">
      <button className="btn-primary btn-sm" onClick={() => onStart(item)}>
        开始复习
      </button>
      <button className="btn-secondary btn-sm" onClick={() => onDone(item.id)}>
        已复习 ✓
      </button>
    </div>
  </motion.div>
);

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

  // 已经按优先级排序过（服务端 + mock 都 sorted by priority_score desc）
  const sortedItems = [...items].sort((a, b) => b.priorityScore - a.priorityScore);

  // 按过期紧迫度分两组：
  //   must-today: overdueRatio >= 1.5（已经严重过期）
  //   soon:       overdueRatio < 1.5（刚到期 / 接近到期）
  const mustToday = sortedItems.filter((i) => i.overdueRatio >= 1.5 && !completedIds.has(i.id));
  const soonItems = sortedItems.filter((i) => i.overdueRatio < 1.5 && !completedIds.has(i.id));
  const doneItems = sortedItems.filter((i) => completedIds.has(i.id));

  const handleStartReview = (item: UiReviewItem) => {
    // Practice 页支持中文 unit 名直接作为 unitId
    navigate(`/practice/${encodeURIComponent(item.name)}`);
  };

  const handleMarkDone = (id: string) => {
    setCompletedIds((prev) => new Set(prev).add(id));
  };

  const urgencyColor = (ratio: number) => {
    if (ratio >= 2) return '#E55A6F';
    if (ratio >= 1.5) return '#F5A623';
    return '#5BC97F';
  };

  const urgencyLabel = (ratio: number) => {
    if (ratio >= 2) return '急需复习';
    if (ratio >= 1.5) return '建议复习';
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
          <p className="page-subtitle">艾宾浩斯遗忘曲线 · 只推荐到期的，今日最多 5 项</p>
        </div>
        <div className="review-summary">
          <div className="review-summary-item">
            <span className="review-summary-num">{mustToday.length}</span>
            <span className="review-summary-label">今日必复习</span>
          </div>
          <div className="review-summary-item">
            <span className="review-summary-num">{soonItems.length}</span>
            <span className="review-summary-label">可顺手复习</span>
          </div>
          <div className="review-summary-item done">
            <span className="review-summary-num">{doneItems.length}</span>
            <span className="review-summary-label">已完成</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="review-empty">
          <span className="review-empty-icon">⏳</span>
          <p>正在按遗忘曲线算法分析需要复习的知识点...</p>
        </div>
      ) : mustToday.length === 0 && soonItems.length === 0 ? (
        <div className="review-empty">
          <span className="review-empty-icon">🎉</span>
          <p>{items.length === 0 ? '还没有学习数据，先去做几道题吧！' : '所有知识点都在最佳记忆期内，今天可以放松~'}</p>
        </div>
      ) : (
        <>
          {mustToday.length > 0 && (
            <div className="review-plan">
              <h2 className="section-title-inline">🔔 今日必复习（已过期）</h2>
              <div className="review-cards">
                <AnimatePresence>
                  {mustToday.map((item, idx) => (
                    <ReviewCard
                      key={item.id}
                      item={item}
                      idx={idx}
                      urgencyColor={urgencyColor}
                      urgencyLabel={urgencyLabel}
                      onStart={handleStartReview}
                      onDone={handleMarkDone}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {soonItems.length > 0 && (
            <div className="review-plan">
              <h2 className="section-title-inline">⏰ 可顺手复习（刚到期）</h2>
              <div className="review-cards">
                <AnimatePresence>
                  {soonItems.map((item, idx) => (
                    <ReviewCard
                      key={item.id}
                      item={item}
                      idx={idx}
                      urgencyColor={urgencyColor}
                      urgencyLabel={urgencyLabel}
                      onStart={handleStartReview}
                      onDone={handleMarkDone}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </>
      )}

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
