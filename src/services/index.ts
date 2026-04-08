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
export interface AIQuestion {
  id: string;
  unit: string;
  semester: string;
  question_type: string;
  content_latex: string;
  answer_latex: string;
  difficulty: number;
  hint?: string;
  ai_generated: boolean;
}

export const questionService = {
  generateQuiz: (studentId: string, knowledgeIds: string[], count?: number) =>
    invoke('generate_quiz', { studentId, knowledgeIds, count }),

  /** AI 动态出题（需要 API Key） */
  generateAiQuestion: async (
    studentId: string,
    unit: string,
    difficulty?: number,
  ): Promise<AIQuestion> => {
    if (!isTauri()) {
      throw new Error('AI 出题仅在 Tauri 环境可用');
    }
    return invoke<AIQuestion>('generate_ai_question', { studentId, unit, difficulty });
  },
};

// === 学习引擎 ===
export interface SubmitAnswerResult {
  record_id: string;
  is_correct: boolean;
  error_type: string;
  feedback: string;
  time_spent_secs: number;
  hints_used: number;
  behavior_features?: {
    avg_response_time: number;
    accuracy_rate: number;
    hint_usage_rate: number;
    max_consecutive_errors: number;
  };
  student_state?: {
    fatigue: number;
    consecutive_errors: number;
    session_minutes: number;
  };
  next_action?: {
    action: string;
    reasoning: string;
    params: Record<string, unknown>;
  };
}

export const learningService = {
  startSession: (studentId: string) =>
    invoke('start_session', { studentId }),

  submitAnswer: (
    sessionId: string,
    questionId: string,
    answer: unknown,
    timeSpentSecs: number,
    hintsUsed: number = 0,
    studentId?: string,
  ): Promise<SubmitAnswerResult> =>
    invoke<SubmitAnswerResult>('submit_answer', {
      sessionId, questionId, answer, timeSpentSecs, hintsUsed, studentId,
    }),

  endSession: (sessionId: string, reason: string) =>
    invoke('end_session', { sessionId, reason }),

  generateSessionSummary: async (sessionId: string): Promise<SessionSummary> => {
    if (!isTauri()) {
      return {
        headline: '今天做得很棒！',
        highlights: ['完成了 5 道练习题', '保持了稳定的节奏'],
        to_review: ['分数除法', '比与百分数'],
        encouragement: '我们一起期待下次的进步！',
        total_questions: 5,
        correct_count: 4,
        accuracy_pct: 80,
        duration_minutes: 5,
        from_llm: false,
      };
    }
    return invoke<SessionSummary>('generate_session_summary', { sessionId });
  },
};

export interface SessionSummary {
  headline: string;
  highlights: string[];
  to_review: string[];
  encouragement: string;
  total_questions: number;
  correct_count: number;
  accuracy_pct: number;
  duration_minutes: number;
  from_llm: boolean;
}

// === 讲解（流式 + 可视化）===
export interface ExplanationDonePayload {
  request_id: string;
  full_text: string;
  visual_spec: { type: string } & Record<string, unknown>;
  from_cache: boolean;
}

export const explainService = {
  /** 启动一次流式讲解（事件监听需要先 subscribe） */
  start: (requestId: string, questionId: string, studentId?: string, sessionId?: string) =>
    invoke('generate_explanation_stream', { requestId, questionId, studentId, sessionId }),

  /**
   * 订阅讲解事件
   * 返回两个 unlisten 函数，调用 unmount 时务必清理
   */
  async subscribe(
    requestId: string,
    onChunk: (delta: string) => void,
    onDone: (payload: ExplanationDonePayload) => void,
  ): Promise<{ removeChunk: () => void; removeDone: () => void }> {
    if (!isTauri()) {
      // 浏览器 mock：直接喂一段假讲解
      setTimeout(() => {
        const mock = '**第一步：审清题意**\n\n这是一段浏览器 mock 讲解，真正的讲解需要在 Tauri 环境下运行并配置 LLM。\n\n**第二步：思考方法**\n\n回忆我们学过的知识点。';
        onChunk(mock);
        onDone({
          request_id: requestId,
          full_text: mock,
          visual_spec: { type: 'none' },
          from_cache: false,
        });
      }, 600);
      return { removeChunk: () => {}, removeDone: () => {} };
    }
    const { listen } = await import('@tauri-apps/api/event');
    const unlistenChunk = await listen<{ request_id: string; delta: string }>(
      'explanation:chunk',
      (e) => {
        if (e.payload.request_id === requestId) onChunk(e.payload.delta);
      },
    );
    const unlistenDone = await listen<ExplanationDonePayload>(
      'explanation:done',
      (e) => {
        if (e.payload.request_id === requestId) onDone(e.payload);
      },
    );
    return { removeChunk: unlistenChunk, removeDone: unlistenDone };
  },
};

// === 分层提示 ===
export interface LayeredHintResult {
  level: number;
  text: string;
}

export const hintService = {
  get: async (
    questionId: string,
    level: 1 | 2 | 3,
    studentId?: string,
    sessionId?: string,
  ): Promise<LayeredHintResult> => {
    if (!isTauri()) {
      // 浏览器 mock
      await new Promise((r) => setTimeout(r, 400));
      const mockTexts: Record<number, string> = {
        1: '想一想这道题考的是什么知识点？最近学的哪个公式可能用得上？',
        2: '我们可以先找出题目里的已知条件，再用一个式子表示出要求的内容。',
        3: '把已知条件代入公式，按步骤算一遍，注意单位和小数点。',
      };
      return { level, text: mockTexts[level] };
    }
    return invoke<LayeredHintResult>('get_layered_hint', {
      questionId, level, studentId, sessionId,
    });
  },
};

// === 学生模型 ===
export interface WrongAnswer {
  record_id: string;
  question_id: string;
  student_answer: string;
  error_type: string | null;
  created_at: string;
  content_latex: string;
  answer_latex: string;
  question_type: string;
  unit: string;
}

export interface ReviewItem {
  knowledge_id: string;
  name: string;
  mastery_score: number;
  forgetting_risk: number;
  attempt_count: number;
  hours_since_last: number;
}

export interface ProfileOverview {
  student_id: string;
  total_questions: number;
  correct_count: number;
  accuracy: number;
  total_duration_minutes: number;
  learning_days: number;
  daily_stats: Array<{
    date: string;
    duration_minutes: number;
    question_count: number;
    correct_count: number;
  }>;
  mastery_data: Array<{
    knowledge_id: string;
    name: string;
    mastery_score: number;
    attempt_count: number;
    forgetting_risk: number;
  }>;
}

export interface RealtimeProfile {
  student_id: string;
  knowledge_layer: {
    avg_mastery: number;
    topic_count: number;
    weak_topics: Array<{
      name: string;
      mastery: number;
      forgetting_risk: number;
      attempts: number;
    }>;
  };
  behavior_layer: {
    avg_response_time: number;
    accuracy_rate: number;
    hint_usage_rate: number;
    impulsivity: number;
    hint_dependency: number;
    max_consecutive_errors: number;
    sample_count: number;
  };
  state_layer: {
    fatigue: number;
    attention: number;
    frustration: number;
    cognitive_load: number;
    consecutive_errors: number;
  };
  session_layer: {
    active: boolean;
    duration_secs: number;
    total_questions: number;
    correct_count: number;
  };
}

export const studentModelService = {
  getProfile: (studentId: string) =>
    invoke('get_student_profile', { studentId }),

  getState: (studentId: string) =>
    invoke('get_student_state', { studentId }),

  /** 学生整体概况（Profile 页用） */
  getProfileOverview: async (studentId: string): Promise<ProfileOverview | null> => {
    if (!isTauri()) return null;
    return invoke<ProfileOverview>('get_profile_overview', { studentId });
  },

  /** 错题本：返回学生最近答错的题目 */
  getWrongAnswers: async (studentId: string, limit: number = 20): Promise<WrongAnswer[]> => {
    if (!isTauri()) {
      // 浏览器 mock：从 localStorage mock_answer_records 凑一些
      try {
        const records: Array<{ questionId: string; isCorrect: boolean; timestamp: number }> =
          JSON.parse(localStorage.getItem('mock_answer_records') || '[]');
        return records
          .filter((r) => !r.isCorrect)
          .slice(-limit)
          .reverse()
          .map((r, i) => ({
            record_id: 'mock-' + i,
            question_id: r.questionId,
            student_answer: '示例错答',
            error_type: 'procedural',
            created_at: new Date(r.timestamp).toISOString(),
            content_latex: '示例题目（Tauri 模式下显示真实内容）',
            answer_latex: '示例答案',
            question_type: '计算题',
            unit: '示例单元',
          }));
      } catch {
        return [];
      }
    }
    return invoke<WrongAnswer[]>('get_wrong_answers', { studentId, limit });
  },

  /** 复习推荐：高遗忘风险知识点 */
  getReviewRecommendations: async (studentId: string): Promise<ReviewItem[]> => {
    if (!isTauri()) {
      // 浏览器 mock：基于 Profile mock 数据生成
      return [
        { knowledge_id: 'kn-比', name: '比', mastery_score: 0.58, forgetting_risk: 0.72, attempt_count: 6, hours_since_last: 50 },
        { knowledge_id: 'kn-圆', name: '圆', mastery_score: 0.45, forgetting_risk: 0.66, attempt_count: 4, hours_since_last: 75 },
        { knowledge_id: 'kn-百分数', name: '百分数', mastery_score: 0.38, forgetting_risk: 0.62, attempt_count: 3, hours_since_last: 120 },
      ];
    }
    return invoke<ReviewItem[]>('get_review_recommendations', { studentId });
  },

  /** 6 层实时画像（Practice 页右侧仪表盘用） */
  getRealtimeProfile: async (studentId: string): Promise<RealtimeProfile> => {
    if (!isTauri()) {
      // 浏览器 mock：随机但合理的数据
      return {
        student_id: studentId,
        knowledge_layer: {
          avg_mastery: 0.45,
          topic_count: 3,
          weak_topics: [
            { name: '分数除法', mastery: 0.32, forgetting_risk: 0.4, attempts: 4 },
            { name: '比', mastery: 0.48, forgetting_risk: 0.2, attempts: 6 },
          ],
        },
        behavior_layer: {
          avg_response_time: 18.5, accuracy_rate: 0.62, hint_usage_rate: 0.15,
          impulsivity: 0.1, hint_dependency: 0.18, max_consecutive_errors: 2, sample_count: 8,
        },
        state_layer: {
          fatigue: 0.2, attention: 0.85, frustration: 0.1, cognitive_load: 0.3, consecutive_errors: 0,
        },
        session_layer: {
          active: false, duration_secs: 0, total_questions: 0, correct_count: 0,
        },
      };
    }
    return invoke<RealtimeProfile>('get_realtime_profile', { studentId });
  },
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
  '你好厉害，已经开始主动学习了！一起加油！',
  '哈哈，我们来做几道有趣的数学题吧！',
  '谢谢你来找我聊天！我们来聊聊数学的奥秘',
  '嗯嗯，我听到你说的啦！要不我们一起做几道数学题吧？',
];
let _chatReplyIdx = 0;
let _chatSessionStart = 0;

/** 流式对话事件 payload（与后端 `chat:done` 对应） */
export interface ChatStreamDonePayload {
  request_id: string;
  full_text: string;
  chat_remaining: number;
  is_limited: boolean;
  limit_reason?: string;
  session_secs?: number;
  session_max_secs?: number;
  cooldown_remaining_secs?: number;
  needs_escalation: boolean;
  safety_violations?: number;
  from_llm?: boolean;
}

export const chatService = {
  /**
   * 流式发送聊天消息（预留给 Live2D / 语音等实时交互使用）
   *
   * 用法：
   * ```ts
   * const requestId = 'chat-' + Date.now();
   * const { removeChunk, removeDone } = await chatService.subscribeStream(
   *   requestId,
   *   (delta) => live2d.appendSpeech(delta),
   *   (payload) => live2d.finishSpeech(payload),
   * );
   * try {
   *   await chatService.sendMessageStream(requestId, 'default-student', '你好');
   * } finally {
   *   removeChunk(); removeDone();
   * }
   * ```
   */
  sendMessageStream: async (
    requestId: string,
    studentId: string,
    message: string,
  ): Promise<ChatStreamDonePayload> => {
    if (!isTauri()) {
      // 浏览器 mock：构造 payload 并向订阅者派发 CustomEvent
      const fakeReply = `我听到你说"${message.slice(0, 8)}${message.length > 8 ? '…' : ''}"啦～我们一起想想这个问题吧！`;
      const payload: ChatStreamDonePayload = {
        request_id: requestId,
        full_text: fakeReply,
        chat_remaining: 19,
        is_limited: false,
        session_secs: 5,
        session_max_secs: 300,
        needs_escalation: false,
        from_llm: false,
      };
      // 微任务让 subscribe 的 listener 先挂好（如果先 subscribe 后 send）
      await new Promise((r) => setTimeout(r, 0));
      window.dispatchEvent(new CustomEvent('__mock_chat_done', { detail: payload }));
      return payload;
    }
    return invoke<ChatStreamDonePayload>('send_chat_message_stream', {
      requestId, studentId, message,
    });
  },

  /**
   * 订阅流式对话事件
   *
   * 返回 { removeChunk, removeDone }，务必在组件卸载时调用
   */
  async subscribeStream(
    requestId: string,
    onChunk: (delta: string) => void,
    onDone: (payload: ChatStreamDonePayload) => void,
  ): Promise<{ removeChunk: () => void; removeDone: () => void }> {
    if (!isTauri()) {
      // 浏览器 mock：在 sendMessageStream 解析后手动模拟
      let cancelled = false;
      let timers: number[] = [];
      const simulate = (text: string) => {
        if (cancelled) return;
        // 每 60ms 吐一个字
        Array.from(text).forEach((ch, i) => {
          timers.push(window.setTimeout(() => {
            if (!cancelled) onChunk(ch);
          }, i * 60));
        });
      };
      // 暴露给 mock sendMessageStream 捕获 full_text 的 hack
      const mockListener = (e: Event) => {
        const ev = e as CustomEvent<ChatStreamDonePayload>;
        if (ev.detail.request_id !== requestId) return;
        simulate(ev.detail.full_text);
        window.setTimeout(() => {
          if (!cancelled) onDone(ev.detail);
        }, ev.detail.full_text.length * 60 + 100);
      };
      window.addEventListener('__mock_chat_done', mockListener as EventListener);
      return {
        removeChunk: () => {
          cancelled = true;
          timers.forEach((t) => clearTimeout(t));
        },
        removeDone: () => {
          window.removeEventListener('__mock_chat_done', mockListener as EventListener);
        },
      };
    }
    const { listen } = await import('@tauri-apps/api/event');
    const unlistenChunk = await listen<{ request_id: string; delta: string }>(
      'chat:chunk',
      (e) => {
        if (e.payload.request_id === requestId) onChunk(e.payload.delta);
      },
    );
    const unlistenDone = await listen<ChatStreamDonePayload>(
      'chat:done',
      (e) => {
        if (e.payload.request_id === requestId) onDone(e.payload);
      },
    );
    return { removeChunk: unlistenChunk, removeDone: unlistenDone };
  },

  sendMessage: async (_studentId: string, _message: string) => {
    if (isTauri()) {
      return invoke('send_chat_message', { studentId: _studentId, message: _message });
    }
    // 浏览器 Mock：返回预设回复 + 模拟节奏控制元数据
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
    if (_chatSessionStart === 0) _chatSessionStart = Date.now();
    const sessionSecs = Math.floor((Date.now() - _chatSessionStart) / 1000);
    _chatReplyIdx++;
    const remaining = Math.max(0, 20 - _chatReplyIdx);
    // 5 分钟硬限模拟
    if (sessionSecs >= 300) {
      _chatSessionStart = 0; // 进入冷却
      return {
        reply: '我们已经聊了差不多 5 分钟啦～休息一下，等会再聊吧。',
        structured: null,
        chat_remaining: remaining,
        is_limited: true,
        limit_reason: 'session_max',
        session_secs: sessionSecs,
        session_max_secs: 300,
        needs_escalation: false,
      };
    }
    const reply = CHAT_FALLBACK_REPLIES[_chatReplyIdx % CHAT_FALLBACK_REPLIES.length];
    return {
      reply,
      structured: null,
      chat_remaining: remaining,
      is_limited: false,
      session_secs: sessionSecs,
      session_max_secs: 300,
      needs_escalation: false,
    };
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

// === 兴趣画像 ===
export interface InterestItem {
  id: number;
  category: string;
  name: string;
  affinity: number;
  source: 'manual' | 'extracted';
  notes: string | null;
  created_at: string;
}

export interface StudentBackground {
  student_id: string;
  nickname: string | null;
  school: string | null;
  hobby_summary: string | null;
  family_notes: string | null;
  dream: string | null;
}

const MOCK_INTERESTS_STORE: InterestItem[] = [];
let _mockInterestId = 1;

export const interestService = {
  list: async (studentId: string): Promise<InterestItem[]> => {
    if (!isTauri()) {
      return [...MOCK_INTERESTS_STORE];
    }
    return invoke<InterestItem[]>('list_interests', { studentId });
  },

  add: async (
    studentId: string,
    category: string,
    name: string,
    affinity: number = 0.8,
    notes?: string,
  ): Promise<number> => {
    if (!isTauri()) {
      const existing = MOCK_INTERESTS_STORE.find((i) => i.category === category && i.name === name);
      if (existing) {
        existing.affinity = affinity;
        return existing.id;
      }
      const id = _mockInterestId++;
      MOCK_INTERESTS_STORE.push({
        id, category, name, affinity,
        source: 'manual',
        notes: notes ?? null,
        created_at: new Date().toISOString(),
      });
      return id;
    }
    return invoke<number>('add_interest', { studentId, category, name, affinity, notes });
  },

  delete: async (id: number): Promise<boolean> => {
    if (!isTauri()) {
      const idx = MOCK_INTERESTS_STORE.findIndex((i) => i.id === id);
      if (idx >= 0) { MOCK_INTERESTS_STORE.splice(idx, 1); return true; }
      return false;
    }
    return invoke<boolean>('delete_interest', { id });
  },

  extractFromText: async (studentId: string, text: string): Promise<{ extracted: Array<Record<string, unknown>>; inserted_count: number }> => {
    if (!isTauri()) {
      // 简单 mock：按关键词匹配
      const keywords: Array<{ kw: string; category: string; name: string }> = [
        { kw: '足球', category: 'sport', name: '足球' },
        { kw: '篮球', category: 'sport', name: '篮球' },
        { kw: '哆啦a梦', category: 'movie', name: '哆啦A梦' },
        { kw: '哆啦A梦', category: 'movie', name: '哆啦A梦' },
        { kw: '钢琴', category: 'hobby', name: '钢琴' },
        { kw: '画画', category: 'hobby', name: '画画' },
        { kw: '奶奶', category: 'family', name: '奶奶' },
      ];
      const text_lower = text.toLowerCase();
      // 关键词匹配 + 去重（按 category+name）
      const seen = new Set<string>();
      const extracted: Array<{ category: string; name: string; affinity: number; notes: string }> = [];
      for (const k of keywords) {
        if (!text_lower.includes(k.kw.toLowerCase())) continue;
        const dedup = k.category + ':' + k.name;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        extracted.push({ category: k.category, name: k.name, affinity: 0.8, notes: '（mock 抽取）' });
      }
      // 直接塞 mock store，source 标记为 extracted
      for (const it of extracted) {
        const exists = MOCK_INTERESTS_STORE.find((x) => x.category === it.category && x.name === it.name);
        if (exists) {
          exists.affinity = Math.max(exists.affinity, it.affinity);
          exists.source = 'extracted';
        } else {
          MOCK_INTERESTS_STORE.push({
            id: _mockInterestId++,
            category: it.category,
            name: it.name,
            affinity: it.affinity,
            source: 'extracted',
            notes: it.notes,
            created_at: new Date().toISOString(),
          });
        }
      }
      return { extracted, inserted_count: extracted.length };
    }
    return invoke('extract_interests_from_text', { studentId, text });
  },

  getBackground: async (studentId: string): Promise<StudentBackground> => {
    if (!isTauri()) {
      return { student_id: studentId, nickname: null, school: null, hobby_summary: null, family_notes: null, dream: null };
    }
    return invoke<StudentBackground>('get_student_background', { studentId });
  },

  updateBackground: async (
    studentId: string,
    updates: Partial<Omit<StudentBackground, 'student_id'>>,
  ): Promise<void> => {
    if (!isTauri()) return;
    return invoke('update_student_background', { studentId, ...updates });
  },
};

export const INTEREST_CATEGORIES: Array<{ key: string; label: string; emoji: string }> = [
  { key: 'hobby', label: '爱好', emoji: '🎨' },
  { key: 'sport', label: '运动', emoji: '⚽' },
  { key: 'book', label: '读过的书', emoji: '📚' },
  { key: 'movie', label: '看过的片', emoji: '🎬' },
  { key: 'music', label: '听过的歌', emoji: '🎵' },
  { key: 'food', label: '喜欢吃', emoji: '🍜' },
  { key: 'family', label: '家人', emoji: '👨‍👩‍👧' },
  { key: 'other', label: '其他', emoji: '✨' },
];

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
