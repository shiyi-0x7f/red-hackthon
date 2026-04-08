import { create } from 'zustand';

interface LearningState {
  /** 当前学习会话 ID */
  sessionId: string | null;
  /** 会话状态 */
  sessionStatus: 'idle' | 'active' | 'paused' | 'ended';
  /** 已答题数 */
  questionsAnswered: number;
  /** 正确数 */
  correctCount: number;
  /** 会话时长（秒） */
  elapsedSeconds: number;
  /** 当前题目 */
  currentQuestion: unknown | null;

  // Actions
  startSession: (sessionId: string) => void;
  endSession: () => void;
  incrementAnswered: (correct: boolean) => void;
  setCurrentQuestion: (question: unknown) => void;
  updateElapsed: (seconds: number) => void;
}

export const useLearningStore = create<LearningState>((set) => ({
  sessionId: null,
  sessionStatus: 'idle',
  questionsAnswered: 0,
  correctCount: 0,
  elapsedSeconds: 0,
  currentQuestion: null,

  startSession: (sessionId) =>
    set({
      sessionId,
      sessionStatus: 'active',
      questionsAnswered: 0,
      correctCount: 0,
      elapsedSeconds: 0,
      currentQuestion: null,
    }),

  endSession: () =>
    set({ sessionStatus: 'ended', currentQuestion: null }),

  incrementAnswered: (correct) =>
    set((state) => ({
      questionsAnswered: state.questionsAnswered + 1,
      correctCount: correct ? state.correctCount + 1 : state.correctCount,
    })),

  setCurrentQuestion: (question) =>
    set({ currentQuestion: question }),

  updateElapsed: (seconds) =>
    set({ elapsedSeconds: seconds }),
}));
