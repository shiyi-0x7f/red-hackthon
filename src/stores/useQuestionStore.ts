import { create } from 'zustand';

/** 题目结构 */
export interface Question {
  id: string;
  unit: string;
  semester: string;
  question_type: string;
  content_latex: string;
  answer_latex: string;
  difficulty: number;
  /** 知识点名称（前 3 单元已标注；后续单元可能为 undefined） */
  knowledge_point?: string;
}

/** 答题记录 */
export interface AnswerRecord {
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  timeSpentSecs: number;
  hintsUsed: number;
}

/** 做题模式 */
export type QuizMode = 'diagnose' | 'emerging' | 'adaptive' | 'unit';

interface QuestionState {
  /** 当前题目列表 */
  questions: Question[];
  /** 当前题目索引 */
  currentIndex: number;
  /** 出题模式 */
  mode: QuizMode;
  /** 答题记录 */
  answers: AnswerRecord[];
  /** 是否正在加载 */
  loading: boolean;
  /** 是否已完成全部题目 */
  finished: boolean;
  /** 当前题目的开始时间 */
  questionStartTime: number;
  /** 上一题的反馈状态 */
  lastFeedback: { isCorrect: boolean; correctAnswer: string } | null;
  /** 当前题已使用的提示层数（0~3）*/
  currentHintsUsed: number;

  // Actions
  loadQuiz: (questions: Question[], mode: QuizMode) => void;
  submitAnswer: (userAnswer: string, isCorrect: boolean) => void;
  nextQuestion: () => void;
  clearFeedback: () => void;
  reset: () => void;
  incrementHints: () => void;
  /** 后端 LLM 判题结果覆盖前端规则判题 */
  correctLastFeedback: (isCorrect: boolean) => void;
  /** 在当前位置之后插入一道新题（用于 AI 动态出题） */
  insertNextQuestion: (q: Question) => void;

  // Computed
  currentQuestion: () => Question | null;
  progress: () => { current: number; total: number; percent: number };
  summary: () => {
    totalQuestions: number;
    correctCount: number;
    accuracy: number;
    totalTimeSecs: number;
    answers: AnswerRecord[];
  };
}

export const useQuestionStore = create<QuestionState>((set, get) => ({
  questions: [],
  currentIndex: 0,
  mode: 'diagnose',
  answers: [],
  loading: false,
  finished: false,
  questionStartTime: Date.now(),
  lastFeedback: null,
  currentHintsUsed: 0,

  loadQuiz: (questions, mode) =>
    set({
      questions,
      mode,
      currentIndex: 0,
      answers: [],
      loading: false,
      finished: false,
      questionStartTime: Date.now(),
      lastFeedback: null,
      currentHintsUsed: 0,
    }),

  submitAnswer: (userAnswer, isCorrect) => {
    const state = get();
    const question = state.questions[state.currentIndex];
    if (!question) return;

    const timeSpentSecs = Math.round((Date.now() - state.questionStartTime) / 1000);
    const record: AnswerRecord = {
      questionId: question.id,
      userAnswer,
      isCorrect,
      timeSpentSecs,
      hintsUsed: state.currentHintsUsed,
    };

    set({
      answers: [...state.answers, record],
      lastFeedback: {
        isCorrect,
        correctAnswer: question.answer_latex,
      },
    });
  },

  nextQuestion: () => {
    const state = get();
    const nextIdx = state.currentIndex + 1;
    if (nextIdx >= state.questions.length) {
      set({ finished: true, lastFeedback: null });
    } else {
      set({
        currentIndex: nextIdx,
        questionStartTime: Date.now(),
        lastFeedback: null,
        currentHintsUsed: 0,
      });
    }
  },

  clearFeedback: () => set({ lastFeedback: null }),

  incrementHints: () => set((s) => ({ currentHintsUsed: Math.min(3, s.currentHintsUsed + 1) })),

  correctLastFeedback: (isCorrect) => set((state) => {
    if (!state.lastFeedback || state.answers.length === 0) return {};
    const newAnswers = [...state.answers];
    const lastIdx = newAnswers.length - 1;
    newAnswers[lastIdx] = { ...newAnswers[lastIdx], isCorrect };
    return {
      answers: newAnswers,
      lastFeedback: { ...state.lastFeedback, isCorrect },
    };
  }),

  insertNextQuestion: (q) => set((state) => {
    const newQs = [...state.questions];
    newQs.splice(state.currentIndex + 1, 0, q);
    return { questions: newQs, finished: false };
  }),

  reset: () =>
    set({
      questions: [],
      currentIndex: 0,
      mode: 'diagnose',
      answers: [],
      loading: false,
      finished: false,
      questionStartTime: Date.now(),
      lastFeedback: null,
      currentHintsUsed: 0,
    }),

  currentQuestion: () => {
    const state = get();
    return state.questions[state.currentIndex] ?? null;
  },

  progress: () => {
    const state = get();
    const total = state.questions.length;
    const current = state.currentIndex + 1;
    return {
      current: Math.min(current, total),
      total,
      percent: total > 0 ? Math.round((Math.min(current, total) / total) * 100) : 0,
    };
  },

  summary: () => {
    const state = get();
    const correctCount = state.answers.filter((a) => a.isCorrect).length;
    const totalTimeSecs = state.answers.reduce((sum, a) => sum + a.timeSpentSecs, 0);
    return {
      totalQuestions: state.answers.length,
      correctCount,
      accuracy: state.answers.length > 0 ? correctCount / state.answers.length : 0,
      totalTimeSecs,
      answers: state.answers,
    };
  },
}));
