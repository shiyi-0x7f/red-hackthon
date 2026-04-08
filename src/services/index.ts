/**
 * Tauri Command 调用封装层
 * 
 * 统一封装所有后端调用，便于类型安全和 mock
 */

import type { Question, QuizMode } from '../stores/useQuestionStore';

// 判断是否在 Tauri 环境（兼容 Tauri 1 和 Tauri 2）
const isTauri = () => typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(command, args);
  }
  // 浏览器开发模式
  console.log(`[Mock] invoke('${command}')`, args);
  throw new Error(`Tauri command '${command}' is not available in browser mode`);
}

// === 学生管理 ===
export const studentService = {
  create: (name: string, grade: number) =>
    invoke('create_student', { name, grade }),

  get: (studentId: string) =>
    invoke('get_student', { studentId }),

  list: () =>
    invoke('list_students'),
};

// === 知识图谱 ===
export const knowledgeService = {
  getTree: (grade: number) =>
    invoke('get_knowledge_tree', { grade }),
};

// === 题库 ===
export const questionService = {
  generateQuiz: (studentId: string, knowledgeIds: string[], count?: number) =>
    invoke('generate_quiz', { studentId, knowledgeIds, count }),
};

// === 学习引擎 ===
export const learningService = {
  startSession: (studentId: string) =>
    invoke('start_session', { studentId }),

  submitAnswer: (sessionId: string, questionId: string, answer: unknown, timeSpentSecs: number) =>
    invoke('submit_answer', { sessionId, questionId, answer, timeSpentSecs }),

  endSession: (sessionId: string, reason: string) =>
    invoke('end_session', { sessionId, reason }),
};

// === 学生模型 ===
export const studentModelService = {
  getProfile: (studentId: string) =>
    invoke('get_student_profile', { studentId }),

  getState: (studentId: string) =>
    invoke('get_student_state', { studentId }),
};

// === 决策引擎 ===
export const decisionService = {
  getNextAction: (studentId: string, sessionId: string) =>
    invoke('get_next_action', { studentId, sessionId }),
};

// === 节奏控制 ===
export const pacingService = {
  getStatus: (sessionId: string) =>
    invoke('get_pacing_status', { sessionId }),
};

// === 对话 ===
const CHAT_FALLBACK_REPLIES = [
  '嘿嘿，这个问题很有趣！让我想想...',
  '你好厉害，已经开始主动学习了！一起加油！💪',
  '哈哈，我们来做几道有趣的数学题吧！',
  '谢谢你来找我聊天！我们来聊聊数学的奥秘 😊',
  '嗯嗯，我听到你说的啦！要不我们一起做几道数学题吧？📝',
];
let _chatReplyIdx = 0;

export const chatService = {
  sendMessage: async (studentId: string, message: string) => {
    if (isTauri()) {
      return invoke('send_chat_message', { studentId, message });
    }
    // 浏览器 Mock：返回预设回复
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    const reply = CHAT_FALLBACK_REPLIES[_chatReplyIdx % CHAT_FALLBACK_REPLIES.length];
    _chatReplyIdx++;
    return { reply, chat_remaining: 20 - _chatReplyIdx, is_limited: false };
  },

  getHistory: (studentId: string, limit?: number) =>
    invoke('get_chat_history', { studentId, limit }),
};

// === 家长端 ===
export const parentService = {
  verifyPassword: (password: string) =>
    invoke<boolean>('verify_parent_password', { password }),

  setPassword: (currentPassword: string, newPassword: string) =>
    invoke<boolean>('set_parent_password', { currentPassword, newPassword }),

  getLearningOverview: (studentId: string, range: string) =>
    invoke('get_learning_overview', { studentId, range }),

  getMasteryOverview: (studentId: string) =>
    invoke('get_mastery_overview', { studentId }),
};

// === 设置 ===
export const settingsService = {
  saveApiKey: (apiKey: string, model?: string) =>
    invoke('save_api_key', { apiKey, model }),

  getSettings: () =>
    invoke('get_settings'),
};

// =============================================
// 题库服务 — 含浏览器 Mock 实现
// =============================================

/** 基题库缓存 */
let _cachedQuestionBank: Question[] | null = null;

/** 从 JSON 加载基题库（浏览器端 mock） */
async function loadQuestionBankFromJson(): Promise<Question[]> {
  if (_cachedQuestionBank) return _cachedQuestionBank;

  try {
    const resp = await fetch('/data/grade6_math_practice_questions_latex.json');
    const raw = await resp.json();
    const questions: Question[] = [];
    let idx = 0;

    const semesters = raw['学期'] || {};
    for (const semesterName of ['上册', '下册']) {
      const units = semesters[semesterName] || [];
      for (const unit of units) {
        for (const q of unit['题目'] || []) {
          idx++;
          const qtype = q['题型'] || '';
          const content = q['题目_latex'] || '';
          // 推断难度
          let difficulty = 2;
          if (['填空题', '判断题'].includes(qtype)) difficulty = 1;
          else if (['应用题', '找规律', '简答题'].includes(qtype)) difficulty = 3;
          else if (['综合应用'].includes(qtype)) difficulty = 4;
          if (content.length > 120) difficulty = Math.min(difficulty + 1, 5);

          questions.push({
            id: `base-${String(idx).padStart(4, '0')}`,
            unit: unit['单元'] || '',
            semester: semesterName,
            question_type: qtype,
            content_latex: content,
            answer_latex: q['答案_latex'] || '',
            difficulty,
          });
        }
      }
    }

    _cachedQuestionBank = questions;
    console.log(`[Mock] 基题库加载完成: ${questions.length} 道题`);
    return questions;
  } catch (e) {
    console.error('[Mock] 加载基题库失败:', e);
    return [];
  }
}

/** 判断基于浏览器本地存储模拟答题数量 */
function getMockAnswerCount(): number {
  try {
    const records = JSON.parse(localStorage.getItem('mock_answer_records') || '[]');
    return records.length;
  } catch {
    return 0;
  }
}

/** 保存 mock 答题记录 */
export function saveMockAnswerRecord(record: {
  questionId: string;
  isCorrect: boolean;
  timeSpentSecs: number;
}) {
  try {
    const records = JSON.parse(localStorage.getItem('mock_answer_records') || '[]');
    records.push({ ...record, timestamp: Date.now() });
    localStorage.setItem('mock_answer_records', JSON.stringify(records));
  } catch {
    // ignore
  }
}

export interface QuizResult {
  mode: QuizMode;
  total: number;
  questions: Question[];
}

/** 题库服务 — 含 Mock 实现 */
export const questionBankService = {
  /** 获取一组练习题 */
  async getQuiz(
    studentId: string,
    unitName?: string,
    count: number = 5,
  ): Promise<QuizResult> {
    // Tauri 环境
    if (isTauri()) {
      return invoke<QuizResult>('generate_quiz', {
        studentId,
        knowledgeIds: [],
        count,
        unit: unitName,
      });
    }

    // 浏览器 Mock 模式
    const allQuestions = await loadQuestionBankFromJson();
    const answerCount = getMockAnswerCount();

    if (unitName) {
      // 指定单元
      const unitQs = allQuestions.filter((q) => q.unit === unitName);
      return {
        mode: 'unit',
        total: unitQs.length,
        questions: unitQs.slice(0, count),
      };
    }

    if (answerCount < 5) {
      // 冷启动诊断 — 每个单元 1 道
      const units = [...new Set(allQuestions.map((q) => q.unit))];
      const diagQs = units.map((u) => allQuestions.find((q) => q.unit === u)!).filter(Boolean);
      return { mode: 'diagnose', total: diagQs.length, questions: diagQs.slice(0, count) };
    }

    if (answerCount < 20) {
      // 初步画像
      const units = [...new Set(allQuestions.map((q) => q.unit))];
      const qs: Question[] = [];
      for (const u of units) {
        const uqs = allQuestions.filter((q) => q.unit === u);
        qs.push(...uqs.slice(0, 2));
      }
      return { mode: 'emerging', total: qs.length, questions: qs.slice(0, count) };
    }

    // 自适应 — 简单实现，优先低难度
    const sorted = [...allQuestions].sort((a, b) => a.difficulty - b.difficulty);
    return { mode: 'adaptive', total: sorted.length, questions: sorted.slice(0, count) };
  },

  /** 获取题库概览 */
  async getOverview(): Promise<{ total_questions: number; total_units: number }> {
    if (isTauri()) {
      return invoke('get_question_bank_overview');
    }
    const qs = await loadQuestionBankFromJson();
    const units = new Set(qs.map((q) => q.unit));
    return { total_questions: qs.length, total_units: units.size };
  },
};
