import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import katex from 'katex';
import { studentModelService, type WrongAnswer } from '../../services';
import ExplanationPanel from './ExplanationPanel';

interface Props {
  studentId: string;
}

/** 把混合 latex 渲染成 HTML（同 Practice 页 LatexContent，简化复制） */
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

const ERROR_TYPE_LABEL: Record<string, string> = {
  conceptual: '概念错误',
  procedural: '步骤错误',
  careless: '粗心错误',
  strategic: '策略错误',
};

const WrongAnswerBook: React.FC<Props> = ({ studentId }) => {
  const [items, setItems] = useState<WrongAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [explainQid, setExplainQid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    studentModelService
      .getWrongAnswers(studentId, 10)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => console.warn('[错题本] 拉取失败:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId]);

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

  return (
    <div className="card wrong-book-card">
      <h2 className="card-title">📕 错题本（最近 {items.length} 道）</h2>
      <p className="section-desc">点「看 AI 讲解」复用流式讲解 + JSXGraph 可视化</p>

      <div className="wrong-list">
        <AnimatePresence>
          {items.map((item, idx) => (
            <motion.div
              key={item.record_id}
              className="wrong-item"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              <div className="wrong-item-header">
                <span className="wrong-item-unit">{item.unit || '未知单元'}</span>
                <span className="wrong-item-type">{item.question_type}</span>
                {item.error_type && ERROR_TYPE_LABEL[item.error_type] && (
                  <span className="wrong-item-error-tag">{ERROR_TYPE_LABEL[item.error_type]}</span>
                )}
                <span className="wrong-item-date">{item.created_at.slice(5, 10)}</span>
              </div>

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
                  onClick={() => setExplainQid(item.question_id)}
                >
                  🧠 看 AI 讲解
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 复用 ExplanationPanel */}
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
