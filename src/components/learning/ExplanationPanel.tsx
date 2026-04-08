import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloseOutlined, BulbOutlined } from '@ant-design/icons';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { explainService, type ExplanationDonePayload } from '../../services';
import JSXBoard, { type JSXBoardSpec } from './JSXBoard';
import FractionBar, { type FractionBarSpec } from './FractionBar';

type VisualSpec = JSXBoardSpec | FractionBarSpec | { type: 'none' };

interface Props {
  open: boolean;
  questionId: string;
  studentId?: string;
  sessionId?: string;
  onClose: () => void;
}

/** 把 markdown-ish 文本中的 $...$ 渲染为 KaTeX */
function renderMixed(text: string): string {
  // 转义 < > 防止 XSS（基础防护）
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 还原 markdown 加粗
  let result = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 段落
  result = result.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');

  // KaTeX
  result = result.replace(/\$\$([^$]+)\$\$/g, (_m, latex) => {
    try { return katex.renderToString(latex, { displayMode: true, throwOnError: false }); }
    catch { return latex; }
  });
  result = result.replace(/\$([^$]+)\$/g, (_m, latex) => {
    try { return katex.renderToString(latex, { displayMode: false, throwOnError: false }); }
    catch { return latex; }
  });

  return result;
}

const ExplanationPanel: React.FC<Props> = ({ open, questionId, studentId, sessionId, onClose }) => {
  const [streamText, setStreamText] = useState('');
  const [visualSpec, setVisualSpec] = useState<VisualSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string>('');
  const cleanupRef = useRef<(() => void) | null>(null);

  // 启动讲解
  useEffect(() => {
    if (!open) {
      // 关闭时清理
      if (cleanupRef.current) cleanupRef.current();
      cleanupRef.current = null;
      setStreamText('');
      setVisualSpec(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const requestId = `exp-${questionId}-${Date.now()}`;
    requestIdRef.current = requestId;
    setStreamText('');
    setVisualSpec(null);
    setError(null);
    setLoading(true);

    let removeChunkListener: (() => void) | null = null;
    let removeDoneListener: (() => void) | null = null;

    (async () => {
      try {
        const handlers = await explainService.subscribe(
          requestId,
          (delta: string) => {
            if (cancelled) return;
            setStreamText((prev) => prev + delta);
          },
          (payload: ExplanationDonePayload) => {
            if (cancelled) return;
            setLoading(false);
            // 替换为完整文本（防止流式截断）
            if (payload.full_text) setStreamText(payload.full_text);
            const v = payload.visual_spec;
            if (v && v.type !== 'none') {
              setVisualSpec(v as VisualSpec);
            }
          },
        );
        removeChunkListener = handlers.removeChunk;
        removeDoneListener = handlers.removeDone;

        // 触发流式生成
        await explainService.start(requestId, questionId, studentId, sessionId);
      } catch (e) {
        if (cancelled) return;
        console.error('讲解失败:', e);
        setError(e instanceof Error ? e.message : '讲解服务暂不可用，请稍后再试');
        setLoading(false);
      }
    })();

    cleanupRef.current = () => {
      cancelled = true;
      if (removeChunkListener) removeChunkListener();
      if (removeDoneListener) removeDoneListener();
    };

    return () => {
      if (cleanupRef.current) cleanupRef.current();
      cleanupRef.current = null;
    };
  }, [open, questionId, studentId, sessionId]);

  // 自动滚动到底部
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamText]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="explanation-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="explanation-panel"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="explanation-header">
              <div className="explanation-title">
                <BulbOutlined /> AI 讲解
                {loading && <span className="explanation-loading-dot">…</span>}
              </div>
              <button className="explanation-close" onClick={onClose} aria-label="关闭">
                <CloseOutlined />
              </button>
            </div>

            <div className="explanation-body" ref={scrollRef}>
              {error && (
                <div className="explanation-error">{error}</div>
              )}

              {streamText && (
                <div
                  className="explanation-text"
                  dangerouslySetInnerHTML={{ __html: renderMixed(streamText) }}
                />
              )}

              {!streamText && !error && (
                <div className="explanation-placeholder">
                  <div className="explanation-spinner" />
                  <span>AI 老师正在思考中...</span>
                </div>
              )}

              {visualSpec && visualSpec.type === 'jsxgraph' && (
                <div className="explanation-visual">
                  <JSXBoard spec={visualSpec} />
                </div>
              )}
              {visualSpec && visualSpec.type === 'fraction-bar' && (
                <div className="explanation-visual">
                  <FractionBar spec={visualSpec} />
                </div>
              )}
            </div>

            <div className="explanation-footer">
              <button className="explanation-done-btn" onClick={onClose}>
                我明白了
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ExplanationPanel;
