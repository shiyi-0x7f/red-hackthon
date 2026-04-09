/**
 * 后端调用统一封装层
 *
 * 统一走 HTTP 模式 — 连接独立 FastAPI 学习服务器。
 * Rust / Tauri 对接代码已全部移除，AI 和业务逻辑全部由 Python 服务端处理。
 *
 * 每个浏览器随机分配独立的 student_id，多人访问互不干扰。
 */

import type { Question, QuizMode } from '../stores/useQuestionStore';

/**
 * Server 的开发模式默认 API Key。
 * server/app/routes/_deps.py 里约定：当 LEARNING_API_KEY 为该值时跳过校验，
 * 相当于"放行模式"。用作前端默认 sk 可以保证首次访问立刻能工作。
 */
export const DEFAULT_HTTP_API_KEY = 'sk-ai-learning-change-me';

/** 统一使用 HTTP 后端模式（Rust Command 对接代码已全部移除） */
export const getBackendMode = (): 'http' => 'http';

/**
 * 检测当前是否运行在 Tauri 桌面壳中。
 *
 * 仅用于选择 HTTP backend 的默认 base URL：Tauri WebView 没有同源 server，
 * 必须指向远程服务器；浏览器访问部署域名时用同源相对路径。
 *
 * 所有 API 调用仍然统一走 HTTP（不再有 Rust invoke 双路径）。
 */
const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

/** Tauri 桌面壳的默认远程 server 地址 */
export const TAURI_DEFAULT_BACKEND = 'http://learn.11xy.cn';

/**
 * 获取 HTTP 后端 base URL
 *
 * 优先级：
 * 1. localStorage 里的 `http_backend_base`（Settings 页可手动改）
 * 2. 构建时的 `VITE_HTTP_BACKEND` env var
 * 3. Tauri 桌面端：`TAURI_DEFAULT_BACKEND`（远程 server）
 * 4. 浏览器 Web 端：空字符串（same-origin 相对路径，B1 同域部署）
 *
 * 为什么 Web 端默认空字符串：
 *   fetch('/api/v1/...') 会用当前页面的 origin（比如 https://learn.11xy.cn），
 *   用户从 HTTPS 访问时不会触发 mixed-content 错误。
 */
export const getHttpBase = (): string => {
  if (typeof window === 'undefined') return '';
  const stored = window.localStorage.getItem('http_backend_base');
  if (stored !== null) return stored.replace(/\/$/, '');
  const fromEnv = (import.meta as any).env?.VITE_HTTP_BACKEND as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (isTauri()) return TAURI_DEFAULT_BACKEND;
  return '';
};

export const getHttpApiKey = (): string => {
  if (typeof window === 'undefined') return DEFAULT_HTTP_API_KEY;
  const stored = window.localStorage.getItem('http_backend_key');
  if (stored !== null) return stored;
  const fromEnv = (import.meta as any).env?.VITE_HTTP_BACKEND_KEY as string | undefined;
  if (fromEnv) return fromEnv;
  return DEFAULT_HTTP_API_KEY;
};

// ==========================================
// 学生身份自动分配（按浏览器）
// ==========================================

const STUDENT_ID_STORAGE_KEY = 'ai_learning_student_id';
const STUDENT_NAME_STORAGE_KEY = 'ai_learning_student_name';

/** 生成一个友好的随机学生名字（「同学 + 2 位数字」） */
function generateStudentName(): string {
  const n = Math.floor(Math.random() * 90) + 10;
  return `同学${n}`;
}

/** 生成一个稳定的学生 id（前缀 web- 便于识别来源） */
function generateStudentId(): string {
  // 使用 crypto.randomUUID 在所有现代浏览器可用
  let uuid: string;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    uuid = crypto.randomUUID();
  } else {
    // 兜底 fallback
    uuid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return `web-${uuid.slice(0, 12)}`;
}

/**
 * 获取当前浏览器的学生 id
 *
 * 逻辑：
 * 1. 如果 localStorage 里已有 → 直接返回（跨标签页 / 刷新都稳定）
 * 2. 否则生成一个新的 id，写入 localStorage，返回
 * 3. server 端首次调用业务 API 时会自动创建对应的 students 行（通过 ensureStudentExists）
 *
 * 不同浏览器 / 不同隐私窗口 → 不同 id → 数据完全隔离
 */
export function getStudentId(): string {
  if (typeof window === 'undefined') return 'ssr-anon';
  const existing = window.localStorage.getItem(STUDENT_ID_STORAGE_KEY);
  if (existing) return existing;
  const fresh = generateStudentId();
  window.localStorage.setItem(STUDENT_ID_STORAGE_KEY, fresh);
  return fresh;
}

export function getStudentName(): string {
  if (typeof window === 'undefined') return '同学';
  const existing = window.localStorage.getItem(STUDENT_NAME_STORAGE_KEY);
  if (existing) return existing;
  const fresh = generateStudentName();
  window.localStorage.setItem(STUDENT_NAME_STORAGE_KEY, fresh);
  return fresh;
}

/**
 * 在 http 模式下确保学生在 server 端已创建
 *
 * 首次调用（且 server 不认识这个 id）时：
 * - 调 POST /api/v1/students 创建一条记录
 * - 忽略"已存在"的错误（幂等）
 *
 * 非 http 模式直接 no-op。调用方不需要 await，失败也无关紧要。
 */
async function ensureStudentExists(studentId: string, studentName: string): Promise<void> {
  if (getBackendMode() !== 'http') return;
  try {
    // 先查一下，存在就跳过
    const url = `${getHttpBase()}/api/v1/students/${encodeURIComponent(studentId)}`;
    const headers: Record<string, string> = {};
    const key = getHttpApiKey();
    if (key) headers.Authorization = `Bearer ${key}`;

    const getResp = await fetch(url, { method: 'GET', headers });
    if (getResp.ok) {
      const data = await getResp.json();
      if (data?.code === 0 && data.data) return; // 已存在
    }

    // 不存在 → 创建（传递客户端生成的 id，避免 server 生成不同 id 导致不一致）
    const createUrl = `${getHttpBase()}/api/v1/students`;
    await fetch(createUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: studentId,   // ← 关键：把前端生成的 web-xxxx 传给 server
        name: studentName,
        grade: 6,
      }),
    }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json();
      const serverId = data?.data?.id;
      if (serverId && serverId !== studentId) {
        // 极端情况：server 没接受我们的 id（旧版 server），覆盖本地
        window.localStorage.setItem(STUDENT_ID_STORAGE_KEY, serverId);
        // 同步更新 zustand store，避免使用过期的 studentId
        try {
          const { useAppStore } = await import('../stores/useAppStore');
          useAppStore.getState().setCurrentStudent(serverId, studentName, 6);
        } catch { /* 首次加载时 store 可能还未就绪 */ }
        console.info(`[auto-init] server 分配学生 id: ${serverId}（替换本地 ${studentId}）`);
      } else {
        console.info(`[auto-init] 学生已在 server 创建: ${serverId || studentId}`);
      }
    });
  } catch (e) {
    console.warn('[auto-init] ensureStudentExists 失败（忽略）:', e);
  }
}

/**
 * 首次打开时自动完成的初始化工作。
 *
 * 做的事：
 * 1. 确保 localStorage 有 http 模式和默认 sk
 * 2. 生成并持久化每浏览器独立的学生 id（避免多人访问互相污染数据）
 * 3. 触发 ensureStudentExists 让 server 端提前建好学生行（异步，不阻塞渲染）
 *
 * 在 main.tsx 调一次即可。
 */
export function autoInitBrowserSettings(): void {
  if (typeof window === 'undefined') return;

  // 1) 统一启用 HTTP 模式 + 填入默认 sk
  if (window.localStorage.getItem('backend_mode') === null) {
    window.localStorage.setItem('backend_mode', 'http');
    console.info('[auto-init] 启用 HTTP 模式');
  }
  if (window.localStorage.getItem('http_backend_base') === null) {
    // Tauri 桌面壳 → 远程 server（WebView 没有同源 server）
    // 浏览器 Web  → 空串同源相对路径（B1 同域部署）
    const defaultBase = isTauri() ? TAURI_DEFAULT_BACKEND : '';
    window.localStorage.setItem('http_backend_base', defaultBase);
    if (defaultBase) {
      console.info(`[auto-init] Tauri 桌面端默认后端: ${defaultBase}`);
    }
  }
  if (window.localStorage.getItem('http_backend_key') === null) {
    window.localStorage.setItem('http_backend_key', DEFAULT_HTTP_API_KEY);
  }

  // 2) 分配/读取学生 id 和名字
  const studentId = getStudentId();
  const studentName = getStudentName();
  console.info(`[auto-init] 学生身份: ${studentName} (${studentId})`);

  // 3) 异步确保 server 端有这个学生
  void ensureStudentExists(studentId, studentName);
}

/**
 * 前端 invoke 命令 → HTTP (method, path, body) 映射
 *
 * body 字段的三态语义：
 * - `undefined`       : 不发送 body（GET / DELETE / 某些无 body 的 POST）
 * - `true`            : 自动把 args 走 toSnakeCase 后作为 body（camelCase 参数默认路径）
 * - `object`/`Record` : 显式 body 对象，跳过 toSnakeCase，用于语义不对齐的字段（
 *                       例如 `answer` → `student_answer`、`hintsUsed` → `hint_used`）
 */
type HttpRoute =
  | { method: 'GET' | 'DELETE'; path: string }
  | { method: 'POST' | 'PUT'; path: string; body?: true | Record<string, unknown> };

const HTTP_ROUTE_MAP: Record<string, (args: any) => HttpRoute> = {
  // 学生
  create_student: () => ({ method: 'POST', path: '/api/v1/students', body: true }),
  get_student: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}` }),
  list_students: () => ({ method: 'GET', path: '/api/v1/students' }),
  clear_student_data: (a) => ({ method: 'DELETE', path: `/api/v1/students/${a.studentId}/data` }),

  // 知识图谱
  get_knowledge_tree: (a) => ({ method: 'GET', path: `/api/v1/knowledge/tree?grade=${a.grade}` }),

  // 题库 / 出题
  get_question_bank_overview: () => ({ method: 'GET', path: '/api/v1/questions/overview' }),
  // 显式 body：把 mode 设为 'auto'，server 再按学生答题总数切换 diagnose/emerging/adaptive
  // 避免 Pydantic 默认 'adaptive' 对新用户强行走自适应模式
  generate_quiz: (a) => ({
    method: 'POST',
    path: '/api/v1/questions/quiz',
    body: {
      student_id: a.studentId,
      mode: a.unit ? 'unit' : 'auto',
      unit: a.unit ?? null,
      count: a.count ?? 5,
      knowledge_ids: a.knowledgeIds ?? [],
    },
  }),
  generate_ai_question: (a) => ({
    method: 'POST',
    path: '/api/v1/questions/ai',
    body: {
      student_id: a.studentId,
      unit: a.unit,
      difficulty: a.difficulty ?? 2,
      weak_topics: a.weakTopics ?? [],
      use_interest: a.useInterest ?? true,
    },
  }),

  // 学习会话
  start_session: (a) => ({
    method: 'POST',
    path: '/api/v1/sessions',
    body: { student_id: a.studentId },
  }),
  // 显式 body：answer → student_answer，hintsUsed → hint_used（单复数不同！）
  submit_answer: (a) => ({
    method: 'POST',
    path: `/api/v1/sessions/${a.sessionId}/answers`,
    body: {
      session_id: a.sessionId,
      question_id: a.questionId,
      student_answer: a.answer,
      time_spent_secs: a.timeSpentSecs ?? 0,
      hint_used: a.hintsUsed ?? 0,
      was_skipped: a.wasSkipped ?? false,
    },
  }),
  end_session: (a) => ({
    method: 'POST',
    path: `/api/v1/sessions/${a.sessionId}/end`,
    body: { reason: a.reason ?? 'user_quit' },
  }),
  generate_session_summary: (a) => ({
    method: 'POST',
    path: `/api/v1/sessions/${a.sessionId}/summary`,
  }),

  // 讲解 / 提示
  get_layered_hint: (a) => ({
    method: 'POST',
    path: '/api/v1/hints',
    body: {
      question_id: a.questionId,
      level: a.level,
      student_id: a.studentId,
    },
  }),

  // 学生模型
  get_student_profile: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/profile` }),
  get_student_state: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/state` }),
  get_wrong_answers: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/wrong-answers` }),
  get_profile_overview: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/overview` }),
  get_review_recommendations: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/review` }),
  get_realtime_profile: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/realtime` }),

  // 决策 / 节奏
  get_next_action: (a) => ({
    method: 'POST',
    path: '/api/v1/decision/next',
    body: { student_id: a.studentId, session_id: a.sessionId ?? null },
  }),
  get_pacing_status: (a) => ({ method: 'GET', path: `/api/v1/sessions/${a.sessionId}/pacing` }),

  // 对话
  get_chat_history: (a) => ({
    method: 'GET',
    path: `/api/v1/chat/history?student_id=${encodeURIComponent(a.studentId)}${a.limit ? `&limit=${a.limit}` : ''}`,
  }),

  // 兴趣 / 背景
  list_interests: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/interests` }),
  add_interest: (a) => ({
    method: 'POST',
    path: `/api/v1/students/${a.studentId}/interests`,
    body: {
      category: a.category,
      name: a.name,
      affinity: a.affinity ?? 0.8,
      notes: a.notes ?? null,
      source: 'manual',
    },
  }),
  delete_interest: (a) => ({ method: 'DELETE', path: `/api/v1/interests/${a.id}` }),
  extract_interests_from_text: (a) => ({
    method: 'POST',
    path: '/api/v1/interests/extract',
    body: { text: a.text, student_id: a.studentId },
  }),
  get_student_background: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/background` }),
  update_student_background: (a) => ({
    method: 'PUT',
    path: `/api/v1/students/${a.studentId}/background`,
    body: {
      student_id: a.studentId,
      // 前端的旧字段名映射到 server 的精简字段名
      hobbies: a.hobbySummary ?? a.hobbies ?? '',
      family: a.familyNotes ?? a.family ?? '',
      notes: a.notes ?? a.dream ?? '',
    },
  }),

  // 家长
  verify_parent_password: (a) => ({
    method: 'POST',
    path: '/api/v1/parent/login',
    body: { password: a.password },
  }),
  get_learning_overview: (a) => ({
    method: 'GET',
    path: `/api/v1/parent/students/${a.studentId}/overview?range=${a.range ?? 'week'}`,
  }),

  // 设置
  get_api_settings: () => ({ method: 'GET', path: '/api/v1/settings/api' }),
  update_api_settings: (a) => ({
    method: 'PUT',
    path: '/api/v1/settings/api',
    body: {
      api_key: a.apiKey ?? null,
      default_model: a.model ?? a.defaultModel ?? null,
    },
  }),
  // 别名：Settings 页调用 save_api_key，映射到同一 PUT /api
  save_api_key: (a) => ({
    method: 'PUT',
    path: '/api/v1/settings/api',
    body: {
      api_key: a.apiKey ?? null,
      default_model: a.model ?? null,
    },
  }),
};

/** camelCase → snake_case 转换（递归处理嵌套对象和数组） */
function toSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toSnakeCase);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      result[snakeKey] = toSnakeCase(value);
    }
    return result;
  }
  return obj;
}

async function httpInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const builder = HTTP_ROUTE_MAP[command];
  if (!builder) {
    throw new Error(`HTTP mode: command '${command}' has no route mapping`);
  }
  const route = builder(args ?? {});
  const base = getHttpBase();
  const url = `${base}${route.path}`;

  const init: RequestInit = {
    method: route.method,
    headers: {
      'Content-Type': 'application/json',
      ...(getHttpApiKey() ? { Authorization: `Bearer ${getHttpApiKey()}` } : {}),
    },
  };

  // body 三态：
  //   undefined      → 不发送
  //   true           → 自动 toSnakeCase(args)
  //   Record<string> → 显式对象，跳过自动转换（用于 field 名不是简单 camel↔snake 的场景）
  if ('body' in route && route.body !== undefined) {
    if (route.body === true) {
      init.body = JSON.stringify(toSnakeCase(args ?? {}));
    } else {
      init.body = JSON.stringify(route.body);
    }
  }

  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  const envelope = (await resp.json()) as { code: number; message: string; data: T };
  if (envelope.code !== 0) {
    throw new Error(envelope.message || `backend error code=${envelope.code}`);
  }
  return envelope.data;
}

/**
 * 统一后端调用入口 — 只走 HTTP，不再对接 Rust / Tauri Command
 */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return httpInvoke<T>(command, args);
}

// ==========================================
// HTTP mode SSE 工具 - 供 explain / chat 流式接口使用
// ==========================================

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * 通用 fetch-based SSE 读取器
 *
 * 为什么不用 EventSource：
 * - EventSource 只支持 GET（/api/v1/chat/stream 是 POST）
 * - EventSource 不能带 Authorization header
 * - fetch + ReadableStream 都能支持
 *
 * 解析 SSE 格式（server-sent events）：
 *   event: foo\n
 *   data: bar\n
 *   \n  ← 事件分隔符
 */
async function* fetchSSE(
  url: string,
  init: RequestInit & { abortSignal?: AbortSignal },
): AsyncGenerator<SSEEvent, void, void> {
  const { abortSignal, ...rest } = init;
  const resp = await fetch(url, { ...rest, signal: abortSignal });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  if (!resp.body) throw new Error('SSE response has no body');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      // SSE 事件以 "\n\n" 分隔
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        let evName = 'message';
        const dataLines: string[] = [];
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) evName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        const data = dataLines.join('\n');
        if (data === '[DONE]') return;
        yield { event: evName, data };
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch { /* ignore */ }
  }
}

/**
 * HTTP mode 下 explain/chat 的流式订阅注册表
 *
 * API 把「start」和「subscribe」拆成两步：subscribe() 先把 handlers 挂进 registry，
 * start() 真正发起 fetch 并从 registry 里找到 handlers 分发事件。
 */
interface StreamHandlers {
  onChunk?: (delta: string) => void;
  onDone?: (payload: any) => void;
  onError?: (err: Error) => void;
  abort: AbortController;
}
const httpStreamRegistry: Map<string, StreamHandlers> = new Map();

function httpStreamSubscribe(
  requestId: string,
  onChunk?: (delta: string) => void,
  onDone?: (payload: any) => void,
): { removeChunk: () => void; removeDone: () => void } {
  const existing = httpStreamRegistry.get(requestId);
  if (existing) {
    existing.onChunk = onChunk;
    existing.onDone = onDone;
  } else {
    httpStreamRegistry.set(requestId, { onChunk, onDone, abort: new AbortController() });
  }
  const cleanup = () => {
    const h = httpStreamRegistry.get(requestId);
    if (!h) return;
    try {
      h.abort.abort();
    } catch { /* ignore */ }
    httpStreamRegistry.delete(requestId);
  };
  return { removeChunk: cleanup, removeDone: cleanup };
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

  /** AI 动态出题 */
  generateAiQuestion: async (
    studentId: string,
    unit: string,
    difficulty?: number,
  ): Promise<AIQuestion> => {
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

  /** 清除学生所有学习数据（删库，保留学生 / 知识点 / 题目静态表） */
  clearStudentData: async (studentId: string): Promise<{ total_deleted: number } | null> => {
    return invoke('clear_student_data', { studentId });
  },

  generateSessionSummary: async (sessionId: string): Promise<SessionSummary> => {
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
  start: async (
    requestId: string,
    questionId: string,
    _studentId?: string,
    _sessionId?: string,
  ) => {
    // HTTP 模式：发起 fetch 并把事件分发给已注册的 handlers
    const entry = httpStreamRegistry.get(requestId);
    if (!entry) {
      throw new Error(`explainService.start: requestId=${requestId} 未先 subscribe`);
    }
    const url =
      `${getHttpBase()}/api/v1/explain/stream?question_id=${encodeURIComponent(questionId)}`;
    const headers: Record<string, string> = {};
    const key = getHttpApiKey();
    if (key) headers.Authorization = `Bearer ${key}`;

    // 后台异步跑，不 await
    (async () => {
      let fullText = '';
      let visualSpec: { type: string } & Record<string, unknown> = { type: 'none' };
      try {
        for await (const ev of fetchSSE(url, {
          method: 'GET',
          headers,
          abortSignal: entry.abort.signal,
        })) {
          if (ev.event === 'text') {
            fullText += ev.data;
            entry.onChunk?.(ev.data);
          } else if (ev.event === 'visual') {
            try {
              const parsed = JSON.parse(ev.data);
              visualSpec = { type: 'jsxgraph', ...parsed };
            } catch {
              // 解析失败就当没 visual
            }
          } else if (ev.event === 'error') {
            entry.onError?.(new Error(ev.data));
            return;
          } else if (ev.event === 'done') {
            break;
          }
        }
        entry.onDone?.({
          request_id: requestId,
          full_text: fullText,
          visual_spec: visualSpec,
          from_cache: false,
        } as ExplanationDonePayload);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        entry.onError?.(e as Error);
      } finally {
        httpStreamRegistry.delete(requestId);
      }
    })();
  },

  /**
   * 订阅讲解事件
   * 返回两个 unlisten 函数，调用 unmount 时务必清理
   */
  async subscribe(
    requestId: string,
    onChunk: (delta: string) => void,
    onDone: (payload: ExplanationDonePayload) => void,
  ): Promise<{ removeChunk: () => void; removeDone: () => void }> {
    return httpStreamSubscribe(
      requestId,
      onChunk,
      (p: any) => onDone(p as ExplanationDonePayload),
    );
  },
};

// === 分层提示 ===
export interface LayeredHintResult {
  level: number;
  text: string;
}

export const hintService = {
  get: (
    questionId: string,
    level: 1 | 2 | 3,
    studentId?: string,
    sessionId?: string,
  ): Promise<LayeredHintResult> =>
    invoke<LayeredHintResult>('get_layered_hint', {
      questionId, level, studentId, sessionId,
    }),
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
  /** 艾宾浩斯理想间隔（小时） */
  ideal_interval_hours?: number;
  /** 实际时间 / 理想间隔，>1 即已过期 */
  overdue_ratio?: number;
  /** 优先级打分，越大越紧迫 */
  priority_score?: number;
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
  getProfileOverview: (studentId: string): Promise<ProfileOverview | null> =>
    invoke<ProfileOverview>('get_profile_overview', { studentId }).catch(() => null),

  /** 错题本：返回学生最近答错的题目 */
  getWrongAnswers: (studentId: string, limit: number = 20): Promise<WrongAnswer[]> =>
    invoke<WrongAnswer[]>('get_wrong_answers', { studentId, limit }),

  /** 复习推荐：基于艾宾浩斯 + 优先级打分 */
  getReviewRecommendations: (studentId: string): Promise<ReviewItem[]> =>
    invoke<ReviewItem[]>('get_review_recommendations', { studentId }),

  /** 6 层实时画像（Practice 页右侧仪表盘用） */
  getRealtimeProfile: (studentId: string): Promise<RealtimeProfile> =>
    invoke<RealtimeProfile>('get_realtime_profile', { studentId }),
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
/** 流式对话完成事件 payload */
export interface ChatStreamDonePayload {
  request_id: string;
  full_text: string;
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
    // HTTP 模式：POST /api/v1/chat/stream 并读 SSE
    const entry = httpStreamRegistry.get(requestId);
    // 如果调用顺序是 send 先于 subscribe，也兜底创建 entry
    const target: StreamHandlers = entry ?? (() => {
      const fresh: StreamHandlers = { abort: new AbortController() };
      httpStreamRegistry.set(requestId, fresh);
      return fresh;
    })();

    const url = `${getHttpBase()}/api/v1/chat/stream`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const key = getHttpApiKey();
    if (key) headers.Authorization = `Bearer ${key}`;

    let fullText = '';
    let errored: Error | null = null;
    try {
      for await (const ev of fetchSSE(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          student_id: studentId,
          content: message,
          context_type: 'casual',
        }),
        abortSignal: target.abort.signal,
      })) {
        if (ev.event === 'chunk') {
          fullText += ev.data;
          target.onChunk?.(ev.data);
        } else if (ev.event === 'error') {
          errored = new Error(ev.data);
          break;
        } else if (ev.event === 'done') {
          break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        errored = e as Error;
      }
    }

    // 构造 payload
    const payload: ChatStreamDonePayload = {
      request_id: requestId,
      full_text: fullText,
      needs_escalation: false,
      from_llm: !errored,
    };

    if (errored) {
      target.onError?.(errored);
      httpStreamRegistry.delete(requestId);
      throw errored;
    }

    target.onDone?.(payload);
    httpStreamRegistry.delete(requestId);
    return payload;
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
    return httpStreamSubscribe(
      requestId,
      onChunk,
      (p: any) => onDone(p as ChatStreamDonePayload),
    );
  },

  sendMessage: (studentId: string, message: string) =>
    invoke('send_chat_message', { studentId, message }),

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

export const interestService = {
  list: (studentId: string): Promise<InterestItem[]> =>
    invoke<InterestItem[]>('list_interests', { studentId }),

  add: (
    studentId: string,
    category: string,
    name: string,
    affinity: number = 0.8,
    notes?: string,
  ): Promise<number> =>
    invoke<number>('add_interest', { studentId, category, name, affinity, notes }),

  delete: (id: number): Promise<boolean> =>
    invoke<boolean>('delete_interest', { id }),

  extractFromText: (
    studentId: string,
    text: string,
  ): Promise<{ extracted: Array<Record<string, unknown>>; inserted_count: number }> =>
    invoke('extract_interests_from_text', { studentId, text }),

  getBackground: (studentId: string): Promise<StudentBackground> =>
    invoke<StudentBackground>('get_student_background', { studentId }),

  updateBackground: (
    studentId: string,
    updates: Partial<Omit<StudentBackground, 'student_id'>>,
  ): Promise<void> =>
    invoke('update_student_background', { studentId, ...updates }),
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
  getSettings: () =>
    invoke('get_api_settings'),
};

// =============================================
// 题库服务 — 纯 HTTP
// =============================================

export interface QuizResult {
  mode: QuizMode;
  total: number;
  questions: Question[];
}

export const questionBankService = {
  /** 获取一组练习题 */
  getQuiz: (
    studentId: string,
    unitName?: string,
    count: number = 5,
  ): Promise<QuizResult> =>
    invoke<QuizResult>('generate_quiz', {
      studentId,
      knowledgeIds: [],
      count,
      unit: unitName,
    }),

  /** 获取题库概览 */
  getOverview: (): Promise<{ total_questions: number; total_units: number }> =>
    invoke('get_question_bank_overview'),
};
