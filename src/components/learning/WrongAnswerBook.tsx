import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import katex from 'katex';
import { RightOutlined } from '@ant-design/icons';
import { studentModelService, type WrongAnswer } from '../../services';
import ExplanationPanel from './ExplanationPanel';

interface Props {
  studentId: string;
}

/** 把混合 latex 渲染成 HTML */
function renderMixed(text: string): string {
  let result = text.replace(/\$\$([^$]+)\$\$/g, (_m, latex) => {
    try { return katex.renderToString(latex, { displayMode: true, throwOnError: false }); }
    catch { return latex; }
  });
  result = result.replace(/\$([^$]+)\$/g, (_m, latex) => {
    try { return katex.renderToString(latex, { displayMode: false, throwOnError: false }); }
    catch { return latex; }
  });
  return result;
}

/** 截取题目预览（去 latex 包裹符，限长） */
function summarize(text: string, max = 40): string {
  const clean = text.replace(/\$\$?([^$]+)\$\$?/g, '$1').replace(/\\[a-zA-Z]+/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

const ERROR_TYPE_LABEL: Record<string, string> = {
  conceptual: '概念错误',
  procedural: '步骤错误',
  careless: '粗心错误',
  strategic: '策略错误',
};
const ERROR_TYPE_COLOR: Record<string, string> = {
  conceptual: '#E55A6F',
  procedural: '#F5A623',
  careless: '#00B5C8',
  strategic: '#9B7BD0',
};

type ErrorFilter = 'all' | 'conceptual' | 'procedural' | 'careless' | 'strategic';

const WrongAnswerBook: React.FC<Props> = ({ studentId }) => {
  const [items, setItems] = useState<WrongAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [explainQid, setExplainQid] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('all');
  const [unitFilter, setUnitFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    studentModelService
      .getWrongAnswers(studentId, 50)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => console.warn('[错题本] 拉取失败:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  // 单元列表（去重）
  const allUnits = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.unit) set.add(i.unit); });
    return Array.from(set);
  }, [items]);

  // 错因类型统计（用于 badge 数字）
  const errorCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    items.forEach((i) => {
      if (i.error_type) counts[i.error_type] = (counts[i.error_type] || 0) + 1;
    });
    return counts;
  }, [items]);

  // 过滤
  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      if (errorFilter !== 'all' && i.error_type !== errorFilter) return false;
      if (unitFilter !== 'all' && i.unit !== unitFilter) return false;
      return true;
    });
  }, [items, errorFilter, unitFilter]);

  if (loading) {
    return (
      <div className="card wrong-book-card">
        <h2 className="card-title">📕 错题本</h2>
        <div className="wrong-book-empty">加载中...</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card wrong-book-card">
        <h2 className="card-title">📕 错题本</h2>
        <div className="wrong-book-empty">
          🎉 还没有错题，继续保持！
        </div>
      </div>
    );
  }

  const FILTER_TABS: Array<{ key: ErrorFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'conceptual', label: '概念' },
    { key: 'procedural', label: '步骤' },
    { key: 'careless', label: '粗心' },
    { key: 'strategic', label: '策略' },
  ];

  return (
    <div className="card wrong-book-card">
      <div className="wrong-book-header">
        <h2 className="card-title">📕 错题本</h2>
        <span className="wrong-book-count">共 {items.length} 道，当前显示 {filteredItems.length}</span>
      </div>

      {/* 错因筛选 */}
      <div className="wrong-filter-row">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`wrong-filter-chip ${errorFilter === tab.key ? 'active' : ''}`}
            onClick={() => setErrorFilter(tab.key)}
          >
            {tab.label}
            {(errorCounts[tab.key] ?? 0) > 0 && (
              <span className="wrong-filter-count">{errorCounts[tab.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* 单元筛选 */}
      {allUnits.length > 0 && (
        <div className="wrong-filter-row wrong-filter-units">
          <button
            className={`wrong-filter-chip ${unitFilter === 'all' ? 'active' : ''}`}
            onClick={() => setUnitFilter('all')}
          >
            全部单元
          </button>
          {allUnits.map((u) => (
            <button
              key={u}
              className={`wrong-filter-chip ${unitFilter === u ? 'active' : ''}`}
              onClick={() => setUnitFilter(u)}
            >
              {u}
            </button>
          ))}
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="wrong-book-empty">当前筛选下暂无题目～ 试试换个条件</div>
      ) : (
        <div className="wrong-list">
          <AnimatePresence>
            {filteredItems.map((item, idx) => {
              const isExpanded = expandedId === item.record_id;
              const errColor = item.error_type ? ERROR_TYPE_COLOR[item.error_type] : '#E55A6F';
              return (
                <motion.div
                  key={item.record_id}
                  layout
                  className={`wrong-item wrong-item-slim ${isExpanded ? 'expanded' : ''}`}
                  style={{ borderLeftColor: errColor }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: idx * 0.03 }}
                >
                  {/* 折叠态：只显示关键信息 + 箭头 */}
                  <button
                    className="wrong-item-bar"
                    onClick={() => setExpandedId(isExpanded ? null : item.record_id)}
                  >
                    <div className="wrong-item-bar-main">
                      <div className="wrong-item-bar-meta">
                        <span className="wrong-item-unit">{item.unit || '未知单元'}</span>
                        <span className="wrong-item-type">{item.question_type}</span>
                        {item.error_type && ERROR_TYPE_LABEL[item.error_type] && (
                          <span
                            className="wrong-item-error-tag"
                            style={{ background: errColor + '22', color: errColor }}
                          >
                            {ERROR_TYPE_LABEL[item.error_type]}
                          </span>
                        )}
                        <span className="wrong-item-date">{item.created_at.slice(5, 10)}</span>
                      </div>
                      <div className="wrong-item-preview">
                        {summarize(item.content_latex)}
                      </div>
                    </div>
                    <RightOutlined className={`wrong-item-chev ${isExpanded ? 'open' : ''}`} />
                  </button>

                  {/* 展开态：完整题目 + 答案对比 + 讲解按钮 */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        key="expanded"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="wrong-item-expanded"
                      >
                        <div className="wrong-item-expanded-inner">
                          <div
                            className="wrong-item-content"
                            dangerouslySetInnerHTML={{ __html: renderMixed(item.content_latex) }}
                          />

                          <div className="wrong-item-answers">
                            <div className="wrong-answer-row wrong-answer-student">
                              <span className="wrong-answer-label">你的答案</span>
                              <span className="wrong-answer-value">{item.student_answer}</span>
                            </div>
                            <div className="wrong-answer-row wrong-answer-correct">
                              <span className="wrong-answer-label">正确答案</span>
                              <span
                                className="wrong-answer-value"
                                dangerouslySetInnerHTML={{ __html: renderMixed(item.answer_latex) }}
                              />
                            </div>
                          </div>

                          <div className="wrong-item-actions">
                            <button
                              className="wrong-explain-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExplainQid(item.question_id);
                              }}
                            >
                              🧠 看 AI 讲解
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {explainQid && (
        <ExplanationPanel
          open={!!explainQid}
          questionId={explainQid}
          studentId={studentId}
          onClose={() => setExplainQid(null)}
        />
      )}
    </div>
  );
};

export default WrongAnswerBook;
