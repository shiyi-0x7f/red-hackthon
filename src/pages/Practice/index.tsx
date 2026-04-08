import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LeftOutlined,
  ClockCircleOutlined,
  SendOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  RightOutlined,
  HomeOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useQuestionStore, type Question } from '../../stores/useQuestionStore';
import { questionBankService, saveMockAnswerRecord } from '../../services';
import '../../styles/practice.css';

/* ========================================
   LaTeX 渲染工具
   ======================================== */

/** 将混合文本中的 $...$ 替换为渲染后的 HTML */
function renderLatexMixed(text: string): string {
  // 处理 $$...$$ (display math)
  let result = text.replace(/\$\$([^$]+)\$\$/g, (_match, latex) => {
    try {
      return katex.renderToString(latex, { displayMode: true, throwOnError: false });
    } catch {
      return latex;
    }
  });
  // 处理 $...$ (inline math)
  result = result.replace(/\$([^$]+)\$/g, (_match, latex) => {
    try {
      return katex.renderToString(latex, { displayMode: false, throwOnError: false });
    } catch {
      return latex;
    }
  });
  return result;
}

const LatexContent: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <div
    className={className}
    dangerouslySetInnerHTML={{ __html: renderLatexMixed(text) }}
  />
);

/* ========================================
   计时器 Hook
   ======================================== */

function useTimer() {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const reset = useCallback(() => setSeconds(0), []);

  const formatted = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return { seconds, formatted, reset };
}

/* ========================================
   答题交互组件
   ======================================== */

/** 检测题目中有多少个填空（\\;\\;）*/
function countBlanks(content: string): number {
  // 匹配 （\\;\\;） 或 (\\;\\;)  模式
  const matches = content.match(/[（(]\s*\\?;\\?;?\s*[）)]/g);
  return matches ? matches.length : 0;
}

/** 分数输入组件 — 可视化分子/分母 */
const FractionPicker: React.FC<{
  onInsert: (fraction: string) => void;
}> = ({ onInsert }) => {
  const [show, setShow] = useState(false);
  const [numerator, setNumerator] = useState('');
  const [denominator, setDenominator] = useState('');
  const numRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (show) numRef.current?.focus();
  }, [show]);

  const handleConfirm = () => {
    if (numerator.trim() && denominator.trim()) {
      onInsert(`${numerator}/${denominator}`);
      setNumerator('');
      setDenominator('');
      setShow(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') setShow(false);
  };

  if (!show) {
    return (
      <button
        className="math-tool-btn fraction-trigger"
        onClick={() => setShow(true)}
        title="输入分数"
        type="button"
      >
        <span className="fraction-icon">
          <span className="fi-num">a</span>
          <span className="fi-line" />
          <span className="fi-den">b</span>
        </span>
        分数
      </button>
    );
  }

  return (
    <div className="fraction-picker-panel">
      <div className="fraction-visual">
        <input
          ref={numRef}
          className="fraction-field fraction-num"
          type="text"
          inputMode="numeric"
          placeholder="分子"
          value={numerator}
          onChange={(e) => setNumerator(e.target.value.replace(/[^\d.-]/g, ''))}
          onKeyDown={handleKeyDown}
        />
        <div className="fraction-bar" />
        <input
          className="fraction-field fraction-den"
          type="text"
          inputMode="numeric"
          placeholder="分母"
          value={denominator}
          onChange={(e) => setDenominator(e.target.value.replace(/[^\d.-]/g, ''))}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="fraction-actions">
        <button
          className="fraction-confirm-btn"
          onClick={handleConfirm}
          disabled={!numerator.trim() || !denominator.trim()}
          type="button"
        >
          确定
        </button>
        <button
          className="fraction-cancel-btn"
          onClick={() => setShow(false)}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
};

/** 数学快捷工具栏 */
const MathToolbar: React.FC<{
  onInsert: (text: string) => void;
  showFraction?: boolean;
}> = ({ onInsert, showFraction = true }) => {
  const symbols = [
    { label: '＞', value: '>', title: '大于' },
    { label: '＜', value: '<', title: '小于' },
    { label: '＝', value: '=', title: '等于' },
    { label: '°', value: '°', title: '度' },
    { label: '℃', value: '℃', title: '摄氏度' },
    { label: '%', value: '%', title: '百分号' },
  ];

  return (
    <div className="math-toolbar">
      <span className="math-toolbar-label">快捷输入：</span>
      <div className="math-toolbar-buttons">
        {symbols.map((s) => (
          <button
            key={s.value}
            className="math-tool-btn"
            onClick={() => onInsert(s.value)}
            title={s.title}
            type="button"
          >
            {s.label}
          </button>
        ))}
        {showFraction && <FractionPicker onInsert={onInsert} />}
      </div>
    </div>
  );
};

/** 判断题 — 按钮选择 */
const JudgeInput: React.FC<{
  onSubmit: (answer: string) => void;
  disabled: boolean;
}> = ({ onSubmit, disabled }) => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="answer-section">
      <div className="judge-buttons">
        {[
          { value: '正确', emoji: '✅', label: '正确' },
          { value: '错误', emoji: '❌', label: '错误' },
        ].map((opt) => (
          <button
            key={opt.value}
            className={`judge-btn ${selected === opt.value ? 'selected' : ''}`}
            onClick={() => setSelected(opt.value)}
            disabled={disabled}
          >
            <span>{opt.emoji}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
      <button
        className="submit-answer-btn"
        onClick={() => selected && onSubmit(selected)}
        disabled={!selected || disabled}
      >
        <SendOutlined /> 提交答案
      </button>
    </div>
  );
};

/** 多空填空题 — 每个空一个独立输入 */
const MultiBlankInput: React.FC<{
  blankCount: number;
  onSubmit: (answer: string) => void;
  disabled: boolean;
}> = ({ blankCount, onSubmit, disabled }) => {
  const [values, setValues] = useState<string[]>(() => Array(blankCount).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 重置
  useEffect(() => {
    setValues(Array(blankCount).fill(''));
    inputRefs.current = Array(blankCount).fill(null);
  }, [blankCount]);

  // 自动聚焦第一个
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, [blankCount]);

  const updateValue = (index: number, val: string) => {
    const newVals = [...values];
    newVals[index] = val;
    setValues(newVals);
  };

  const insertAtBlank = (index: number, text: string) => {
    const newVals = [...values];
    newVals[index] = newVals[index] + text;
    setValues(newVals);
    inputRefs.current[index]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter') {
      // 跳到下一个空，最后一个空则提交
      if (index < blankCount - 1) {
        inputRefs.current[index + 1]?.focus();
      } else {
        const allFilled = values.every((v) => v.trim());
        if (allFilled) onSubmit(values.join('；'));
      }
    }
    if (e.key === 'Tab' && index < blankCount - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const allFilled = values.every((v) => v.trim());
  const [activeBlank, setActiveBlank] = useState(0);

  return (
    <div className="answer-section">
      <div className="multi-blank-container">
        {values.map((val, i) => (
          <div key={i} className={`blank-item ${activeBlank === i ? 'active' : ''}`}>
            <span className="blank-label">第 {i + 1} 空</span>
            <div className="blank-input-row">
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                className="answer-input blank-input"
                placeholder={`填写第 ${i + 1} 个答案`}
                value={val}
                onChange={(e) => updateValue(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onFocus={() => setActiveBlank(i)}
                disabled={disabled}
              />
            </div>
          </div>
        ))}
      </div>
      <MathToolbar
        onInsert={(text) => insertAtBlank(activeBlank, text)}
        showFraction={true}
      />
      <button
        className="submit-answer-btn"
        onClick={() => allFilled && onSubmit(values.join('；'))}
        disabled={!allFilled || disabled}
      >
        <SendOutlined /> 提交答案
      </button>
    </div>
  );
};

/** 单输入框（计算题等） — 带数学工具栏 */
const SingleInput: React.FC<{
  placeholder: string;
  onSubmit: (answer: string) => void;
  disabled: boolean;
  showFraction?: boolean;
}> = ({ placeholder, onSubmit, disabled, showFraction = true }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      onSubmit(value.trim());
    }
  };

  const insertText = (text: string) => {
    setValue((v) => v + text);
    inputRef.current?.focus();
  };

  return (
    <div className="answer-section">
      <div className="answer-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="answer-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>
      <MathToolbar onInsert={insertText} showFraction={showFraction} />
      <button
        className="submit-answer-btn"
        onClick={() => value.trim() && onSubmit(value.trim())}
        disabled={!value.trim() || disabled}
      >
        <SendOutlined /> 提交答案
      </button>
    </div>
  );
};

/** 应用/简答/综合题 — 文本区 */
const TextAreaInput: React.FC<{
  onSubmit: (answer: string) => void;
  disabled: boolean;
}> = ({ onSubmit, disabled }) => {
  const [value, setValue] = useState('');

  return (
    <div className="answer-section">
      <div className="answer-input-wrapper">
        <textarea
          className="answer-input answer-textarea"
          placeholder="写出你的解题过程和答案..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
        />
      </div>
      <button
        className="submit-answer-btn"
        onClick={() => value.trim() && onSubmit(value.trim())}
        disabled={!value.trim() || disabled}
      >
        <SendOutlined /> 提交答案
      </button>
    </div>
  );
};

/** 根据题型智能选择输入控件 */
const AnswerInput: React.FC<{
  question: Question;
  onSubmit: (answer: string) => void;
  disabled: boolean;
}> = ({ question, onSubmit, disabled }) => {
  const qtype = question.question_type;

  // 判断题 → 按钮
  if (qtype === '判断题') {
    return <JudgeInput key={question.id} onSubmit={onSubmit} disabled={disabled} />;
  }

  // 应用/简答/综合题 → 文本区
  if (['应用题', '简答题', '综合应用'].includes(qtype)) {
    return <TextAreaInput key={question.id} onSubmit={onSubmit} disabled={disabled} />;
  }

  // 填空题 → 检测空位数量
  if (qtype === '填空题') {
    const blanks = countBlanks(question.content_latex);
    if (blanks >= 2) {
      return <MultiBlankInput key={question.id} blankCount={blanks} onSubmit={onSubmit} disabled={disabled} />;
    }
    // 单空填空也用带工具栏的输入
    return <SingleInput key={question.id} placeholder="填写答案" onSubmit={onSubmit} disabled={disabled} />;
  }

  // 比较题
  if (qtype === '比较题') {
    const blanks = countBlanks(question.content_latex);
    if (blanks >= 2) {
      return <MultiBlankInput key={question.id} blankCount={blanks} onSubmit={onSubmit} disabled={disabled} />;
    }
    return <SingleInput key={question.id} placeholder="填入 > 或 < 或 =" onSubmit={onSubmit} disabled={disabled} showFraction={false} />;
  }

  // 计算题、找规律、综合计算 → 带分数工具栏的单输入
  return (
    <SingleInput
      key={question.id}
      placeholder={qtype === '找规律' ? '输入你找到的答案' : '输入计算结果'}
      onSubmit={onSubmit}
      disabled={disabled}
    />
  );
};

/* ========================================
   简单判题逻辑（前端 MVP）
   ======================================== */

/** 将分数字符串 "a/b" 转为数值 */
function evalFraction(s: string): number | null {
  const m = s.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (m) {
    const den = parseFloat(m[2]);
    if (den === 0) return null;
    return parseFloat(m[1]) / den;
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** 从 LaTeX 答案中提取 \frac{a}{b} 的数值 */
function extractFracValue(latex: string): number | null {
  const m = latex.match(/\\frac\{(-?\d+)\}\{(-?\d+)\}/);
  if (m) {
    const den = parseFloat(m[2]);
    if (den === 0) return null;
    return parseFloat(m[1]) / den;
  }
  return null;
}

function checkAnswer(question: Question, userAnswer: string): boolean {
  const expected = question.answer_latex
    .replace(/\$/g, '')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\,/g, '')
    .replace(/\\colon/g, ':')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();

  const user = userAnswer
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();

  // 判断题
  if (question.question_type === '判断题') {
    const isTrue = expected.includes('正确');
    const userTrue = user.includes('正确') || user === 'true' || user === '对';
    return isTrue === userTrue;
  }

  // 多空答案：用中文分号切割逐个比较
  if (user.includes('；') || user.includes(';')) {
    const userParts = user.split(/[；;]/).map((s) => s.trim());
    const expParts = expected.split(/[；;,]/).map((s) => s.trim());
    if (userParts.length === expParts.length) {
      return userParts.every((up, i) => {
        // 逐个比较每一空
        const ep = expParts[i] || '';
        // 数值比较
        const uv = evalFraction(up);
        const ev = evalFraction(ep);
        if (uv !== null && ev !== null && Math.abs(uv - ev) < 0.01) return true;
        // 文本比较
        return up === ep || ep.includes(up) || up.includes(ep);
      });
    }
  }

  // 分数比较：用户输入 "8/7"，期望 \frac{8}{7}
  const userFracVal = evalFraction(user);
  const expectedFracVal = extractFracValue(question.answer_latex);
  if (userFracVal !== null && expectedFracVal !== null) {
    if (Math.abs(userFracVal - expectedFracVal) < 0.001) return true;
  }

  // 数值比较：提取数字
  const expectedNums = expected.match(/-?\d+\.?\d*/g);
  const userNums = user.match(/-?\d+\.?\d*/g);

  if (expectedNums && userNums) {
    const expNum = parseFloat(expectedNums[0]);
    const usrNum = parseFloat(userNums[0]);
    if (Math.abs(expNum - usrNum) < 0.01) return true;
  }

  // 比较题：< >
  if (question.question_type === '比较题') {
    const expectedSymbols = expected.match(/[<>=]/g) || [];
    const userSymbols = user.match(/[<>=]/g) || [];
    if (expectedSymbols.length > 0 && userSymbols.length > 0) {
      return expectedSymbols.join('') === userSymbols.join('');
    }
  }

  // 文本模糊匹配
  if (expected.includes(user) || user.includes(expected)) return true;

  return expected === user;
}

/* ========================================
   反馈弹窗
   ======================================== */

const FeedbackOverlay: React.FC<{
  isCorrect: boolean;
  correctAnswer: string;
  onNext: () => void;
  isLast: boolean;
}> = ({ isCorrect, correctAnswer, onNext, isLast }) => (
  <motion.div
    className={`feedback-overlay ${isCorrect ? 'correct' : 'wrong'}`}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    onClick={onNext}
  >
    <motion.div
      className="feedback-card"
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 30, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`feedback-card-top ${isCorrect ? 'correct' : 'wrong'}`}>
        <motion.div
          className="feedback-emoji"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.1 }}
        >
          {isCorrect ? '🎉' : '💪'}
        </motion.div>
        <h3 className={`feedback-title ${isCorrect ? 'correct' : 'wrong'}`}>
          {isCorrect ? '答对啦！' : '没关系，看看正确答案'}
        </h3>
      </div>

      <div className="feedback-card-body">
        <div className="feedback-answer-label">正确答案</div>
        <LatexContent text={correctAnswer} className="feedback-answer-content" />
        <button className="feedback-next-btn" onClick={onNext}>
          {isLast ? '查看总结 🏆' : '下一题 →'}
        </button>
      </div>
    </motion.div>
  </motion.div>
);

/* ========================================
   做题总结
   ======================================== */

const SummaryView: React.FC<{
  onGoBack: () => void;
  onRetry: () => void;
}> = ({ onGoBack, onRetry }) => {
  const store = useQuestionStore();
  const { totalQuestions, correctCount, accuracy, totalTimeSecs, answers } = store.summary();
  const questions = store.questions;

  const accuracyPercent = Math.round(accuracy * 100);
  const circumference = 2 * Math.PI * 42;
  const dashoffset = circumference * (1 - accuracy);

  const getTitle = () => {
    if (accuracyPercent >= 90) return '太棒了！🌟';
    if (accuracyPercent >= 70) return '做得不错！👏';
    if (accuracyPercent >= 50) return '继续努力！💪';
    return '别灰心！🤗';
  };

  const getSubtitle = () => {
    if (accuracyPercent >= 90) return '你已经掌握得很好了';
    if (accuracyPercent >= 70) return '再巩固一下会更棒';
    if (accuracyPercent >= 50) return '多练习几次就会进步';
    return '每一次尝试都是进步';
  };

  return (
    <motion.div
      className="summary-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="summary-card"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
      >
        <div className="summary-header">
          <motion.div
            className="summary-emoji"
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 400, damping: 12 }}
          >
            {accuracyPercent >= 70 ? '🏆' : '📝'}
          </motion.div>
          <h2 className="summary-title">{getTitle()}</h2>
          <p className="summary-subtitle">{getSubtitle()}</p>
        </div>

        <div className="summary-body">
          {/* 正确率环 */}
          <div className="accuracy-ring">
            <svg width="100" height="100" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="accuracyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7C5CFC" />
                  <stop offset="100%" stopColor="#54B5FF" />
                </linearGradient>
              </defs>
              <circle className="accuracy-ring-bg" cx="50" cy="50" r="42" />
              <motion.circle
                className="accuracy-ring-fill"
                cx="50"
                cy="50"
                r="42"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: dashoffset }}
                transition={{ duration: 1.5, delay: 0.6, ease: 'easeOut' }}
              />
            </svg>
            <div className="accuracy-ring-text">{accuracyPercent}%</div>
          </div>

          {/* 统计数据 */}
          <div className="summary-stats">
            <div className="summary-stat">
              <span className="summary-stat-value">{correctCount}/{totalQuestions}</span>
              <span className="summary-stat-label">正确数</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat-value">
                {Math.floor(totalTimeSecs / 60)}:{String(totalTimeSecs % 60).padStart(2, '0')}
              </span>
              <span className="summary-stat-label">总用时</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat-value">
                {totalQuestions > 0 ? Math.round(totalTimeSecs / totalQuestions) : 0}s
              </span>
              <span className="summary-stat-label">平均用时</span>
            </div>
          </div>

          {/* 题目回顾 */}
          <div className="summary-review-list">
            {answers.map((ans, i) => {
              const q = questions[i];
              return (
                <div key={ans.questionId} className="summary-review-item">
                  <div className={`review-item-icon ${ans.isCorrect ? 'correct' : 'wrong'}`}>
                    {ans.isCorrect ? <CheckCircleFilled /> : <CloseCircleFilled />}
                  </div>
                  <div className="review-item-info">
                    <span className="review-item-unit">{q?.unit} · {q?.question_type}</span>
                  </div>
                  <span className="review-item-time">{ans.timeSpentSecs}s</span>
                </div>
              );
            })}
          </div>

          {/* 操作按钮 */}
          <div className="summary-actions">
            <button className="summary-btn summary-btn-secondary" onClick={onGoBack}>
              <HomeOutlined /> 返回地图
            </button>
            <button className="summary-btn summary-btn-primary" onClick={onRetry}>
              <RedoOutlined /> 再来一组
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ========================================
   主页面
   ======================================== */

const MODE_LABELS: Record<string, { text: string; cls: string }> = {
  diagnose: { text: '🔍 初始诊断', cls: 'mode-diagnose' },
  emerging: { text: '📊 画像构建中', cls: 'mode-emerging' },
  adaptive: { text: '🧠 AI 自适应', cls: 'mode-adaptive' },
  unit: { text: '📚 单元练习', cls: 'mode-unit' },
};

const PracticePage: React.FC = () => {
  const navigate = useNavigate();
  const { unitId } = useParams<{ unitId?: string }>();
  const store = useQuestionStore();
  const timer = useTimer();

  const [loading, setLoading] = useState(true);
  const [flashType, setFlashType] = useState<'correct' | 'wrong' | null>(null);
  const [shaking, setShaking] = useState(false);

  // 单元名映射（从 URL param 到实际单元名）
  const UNIT_MAP: Record<string, string> = {
    u1: '分数乘法', u2: '位置与方向', u3: '分数除法', u4: '比',
    u5: '圆', u6: '百分数（一）', u7: '扇形统计图', u8: '数学广角：数与形',
    u9: '负数', u10: '百分数（二）', u11: '圆柱与圆锥', u12: '比例',
    u13: '数学广角：鸽巢问题', u14: '整理与复习',
  };

  // 加载题目
  useEffect(() => {
    let cancelled = false;

    async function loadQuiz() {
      setLoading(true);
      try {
        const unitName = unitId ? UNIT_MAP[unitId] : undefined;
        const result = await questionBankService.getQuiz('default-student', unitName, 5);
        if (!cancelled && result.questions.length > 0) {
          store.loadQuiz(result.questions, result.mode);
        }
      } catch (e) {
        console.error('加载题目失败:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadQuiz();
    return () => { cancelled = true; };
  }, [unitId]);

  // 提交答案
  const handleSubmit = useCallback(
    (userAnswer: string) => {
      const question = store.currentQuestion();
      if (!question) return;

      const isCorrect = checkAnswer(question, userAnswer);

      // 屏幕闪烁
      setFlashType(isCorrect ? 'correct' : 'wrong');
      setTimeout(() => setFlashType(null), 500);

      // 错误时震动
      if (!isCorrect) {
        setShaking(true);
        setTimeout(() => setShaking(false), 400);
      }

      // 保存 mock 记录
      saveMockAnswerRecord({
        questionId: question.id,
        isCorrect,
        timeSpentSecs: Math.round((Date.now() - store.questionStartTime) / 1000),
      });

      store.submitAnswer(userAnswer, isCorrect);
    },
    [store],
  );

  // 下一题
  const handleNext = useCallback(() => {
    store.nextQuestion();
    timer.reset();
  }, [store, timer]);

  // 重新来一组
  const handleRetry = useCallback(async () => {
    setLoading(true);
    try {
      const unitName = unitId ? UNIT_MAP[unitId] : undefined;
      const result = await questionBankService.getQuiz('default-student', unitName, 5);
      if (result.questions.length > 0) {
        store.loadQuiz(result.questions, result.mode);
        timer.reset();
      }
    } catch (e) {
      console.error('重新加载失败:', e);
    } finally {
      setLoading(false);
    }
  }, [unitId, store, timer]);

  // 加载中
  if (loading) {
    return (
      <div className="practice-page">
        <div className="practice-loading">
          <div className="loading-spinner" />
          <span className="loading-text">正在准备题目...</span>
        </div>
      </div>
    );
  }

  // 总结页
  if (store.finished) {
    return (
      <SummaryView
        onGoBack={() => navigate('/learn')}
        onRetry={handleRetry}
      />
    );
  }

  const question = store.currentQuestion();
  if (!question) {
    return (
      <div className="practice-page">
        <div className="practice-loading">
          <span className="loading-text">暂无可用题目</span>
          <button className="submit-answer-btn" style={{ maxWidth: 200 }} onClick={() => navigate('/learn')}>
            返回地图
          </button>
        </div>
      </div>
    );
  }

  const progress = store.progress();
  const modeInfo = MODE_LABELS[store.mode] || MODE_LABELS.unit;
  const unitName = unitId ? UNIT_MAP[unitId] || question.unit : question.unit;

  return (
    <div className="practice-page">
      {/* 闪烁效果 */}
      <AnimatePresence>
        {flashType && (
          <motion.div
            className={`screen-flash ${flashType}`}
            key={flashType}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        )}
      </AnimatePresence>

      {/* 顶部栏 */}
      <motion.div
        className="practice-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button className="practice-back-btn" onClick={() => navigate('/learn')}>
          <LeftOutlined /> 返回
        </button>

        <div className="practice-unit-info">
          <span className="practice-unit-name">{unitName}</span>
          <span className={`practice-mode-label ${modeInfo.cls}`}>{modeInfo.text}</span>
        </div>

        <div className="practice-header-right">
          <div className="practice-timer">
            <ClockCircleOutlined className="timer-icon" />
            <span>{timer.formatted}</span>
          </div>
        </div>
      </motion.div>

      {/* 进度条 */}
      <div className="practice-progress-bar">
        <div
          className="practice-progress-fill"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="practice-progress-text">
        第 {progress.current} / {progress.total} 题
      </div>

      {/* 题目卡片 */}
      <div className="practice-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={question.id}
            className={`question-card ${shaking ? 'shake' : ''}`}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* 题目头部 */}
            <div className="question-card-header">
              <div className="question-type-tag">
                <span>{question.question_type}</span>
              </div>
              <div className="question-difficulty">
                {[1, 2, 3, 4, 5].map((d) => (
                  <span
                    key={d}
                    className={`difficulty-dot ${d <= question.difficulty ? 'filled' : ''} ${question.difficulty >= 4 ? 'hard' : ''}`}
                  />
                ))}
              </div>
            </div>

            {/* 题目内容 */}
            <div className="question-body">
              <LatexContent text={question.content_latex} className="question-content-latex" />
            </div>

            {/* 答题区 */}
            <AnswerInput
              question={question}
              onSubmit={handleSubmit}
              disabled={!!store.lastFeedback}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 反馈弹窗 */}
      <AnimatePresence>
        {store.lastFeedback && (
          <FeedbackOverlay
            isCorrect={store.lastFeedback.isCorrect}
            correctAnswer={store.lastFeedback.correctAnswer}
            onNext={handleNext}
            isLast={store.currentIndex >= store.questions.length - 1}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default PracticePage;
