/**
 * 后端调用统一封装层
 *
 * 只有两种 backend mode：
 * - 'tauri' — 运行在 Tauri 桌面端，直接调用 Rust Command
 * - 'http'  — 其他所有场景（浏览器），走独立 FastAPI 学习服务器
 *
 * 浏览器访问时自动启用 http 模式 + 默认 sk + 同源相对路径；
 * 每个浏览器随机分配独立的 student_id，多人访问互不干扰。
 */

import type { Question, QuizMode } from '../stores/useQuestionStore';

// -------- backend mode 检测 --------
type BackendMode = 'tauri' | 'http';

/**
 * Server 的开发模式默认 API Key。
 * server/app/routes/_deps.py 里约定：当 LEARNING_API_KEY 为该值时跳过校验，
 * 相当于"放行模式"。用作前端默认 sk 可以保证浏览器首次访问立刻能工作。
 */
export const DEFAULT_HTTP_API_KEY = 'sk-ai-learning-change-me';

const isTauri = () =>
  typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);

export const getBackendMode = (): BackendMode => {
  if (typeof window === 'undefined') return 'http';
  const override = window.localStorage.getItem('backend_mode') as BackendMode | null;
  if (override === 'tauri' || override === 'http') return override;
  // 只有两种可能：Tauri 应用窗口 or 其他（浏览器）
  return isTauri() ? 'tauri' : 'http';
};

export const getHttpBase = (): string => {
  if (typeof window === 'undefined') return '';
  // 用户在 Settings 页手动设置 > 构建时 env 注入 > 空串（= same-origin 相对路径）
  //
  // 空串为默认意味着生产部署里如果前端和 server 同源（B1 方案 FastAPI StaticFiles
  // 挂载 /dist，或 nginx 反向代理把 /api 转给 server），fetch('/api/v1/...') 就能
  // 直接工作——无需配置。
  //
  // 跨源部署（前端在 Cloudflare Pages / Vercel，后端在另一个域名）：
  //   构建时设 VITE_HTTP_BACKEND=https://api.your-domain.com
  //   或用户在 Settings 页手动填写完整地址
  const stored = window.localStorage.getItem('http_backend_base');
  if (stored !== null) return stored.replace(/\/$/, '');
  const fromEnv = (import.meta as any).env?.VITE_HTTP_BACKEND as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
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

/** 生成一个稳定的学生 id（前缀 web- 便于和 Tauri 端区分） */
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

    // 不存在 → 创建
    const createUrl = `${getHttpBase()}/api/v1/students`;
    await fetch(createUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // NOTE: server POST /students 会自动生成 id，这里传递的是 name/grade
        // 但我们希望 server 用我们指定的 id。当前 server 代码里 create_student 不支持
        // 客户端指定 id —— 见 routes/student.py。为了兼容现状，这里先忽略 id 参数，
        // 让 server 生成后返回，前端把 server 返回的 id 存回 localStorage。
        name: studentName,
        grade: 6,
      }),
    }).then(async (r) => {
      if (!r.ok) return;
      const data = await r.json();
      const serverId = data?.data?.id;
      if (serverId && serverId !== studentId) {
        // server 生成的 id 覆盖本地随机 id
        window.localStorage.setItem(STUDENT_ID_STORAGE_KEY, serverId);
        console.info(`[auto-init] server 分配学生 id: ${serverId}（替换本地 ${studentId}）`);
      }
    });
  } catch (e) {
    console.warn('[auto-init] ensureStudentExists 失败（忽略）:', e);
  }
}

/**
 * 浏览器首次打开时自动完成的初始化工作。
 *
 * 做的事：
 * 1. 非 Tauri 场景：如果 localStorage 没 backend_mode，写入 http / 空 base / 默认 sk
 *    无论 dev / prod 都做，浏览器里就是要走 server
 * 2. 生成并持久化每浏览器独立的学生 id（避免多人访问互相污染数据）
 * 3. 触发 ensureStudentExists 让 server 端提前建好学生行（异步，不阻塞渲染）
 *
 * 在 main.tsx 调一次即可。Tauri 模式下只做学生 id 生成。
 */
export function autoInitBrowserSettings(): void {
  if (typeof window === 'undefined') return;

  // 1) 浏览器模式下（非 Tauri），自动启用 http + 填入默认 sk
  if (!isTauri()) {
    if (window.localStorage.getItem('backend_mode') === null) {
      window.localStorage.setItem('backend_mode', 'http');
      console.info('[auto-init] 浏览器访问 → 启用 HTTP same-origin 模式');
    }
    if (window.localStorage.getItem('http_backend_base') === null) {
      window.localStorage.setItem('http_backend_base', ''); // 同源
    }
    if (window.localStorage.getItem('http_backend_key') === null) {
      window.localStorage.setItem('http_backend_key', DEFAULT_HTTP_API_KEY);
    }
  }

  // 2) 分配/读取学生 id 和名字
  const studentId = getStudentId();
  const studentName = getStudentName();
  console.info(`[auto-init] 学生身份: ${studentName} (${studentId})`);

  // 3) 异步确保 server 端有这个学生（http 模式才跑）
  void ensureStudentExists(studentId, studentName);
}

/**
 * Tauri Command → HTTP (method, path) 映射
 * 只覆盖主要业务命令。未命中的命令在 http 模式下会抛错。
 */
type HttpRoute =
  | { method: 'GET'; path: string; query?: string[] }
  | { method: 'POST'; path: string; body?: boolean }
  | { method: 'PUT'; path: string; body?: boolean }
  | { method: 'DELETE'; path: string };

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
  generate_quiz: () => ({ method: 'POST', path: '/api/v1/questions/quiz', body: true }),
  generate_ai_question: () => ({ method: 'POST', path: '/api/v1/questions/ai', body: true }),

  // 学习会话
  start_session: () => ({ method: 'POST', path: '/api/v1/sessions', body: true }),
  submit_answer: (a) => ({ method: 'POST', path: `/api/v1/sessions/${a.sessionId}/answers`, body: true }),
  end_session: (a) => ({ method: 'POST', path: `/api/v1/sessions/${a.sessionId}/end`, body: true }),
  generate_session_summary: (a) => ({ method: 'POST', path: `/api/v1/sessions/${a.sessionId}/summary` }),

  // 讲解 / 提示
  get_layered_hint: () => ({ method: 'POST', path: '/api/v1/hints', body: true }),

  // 学生模型
  get_student_profile: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/profile` }),
  get_student_state: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/state` }),
  get_wrong_answers: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/wrong-answers` }),
  get_profile_overview: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/overview` }),
  get_review_recommendations: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/review` }),
  get_realtime_profile: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/realtime` }),

  // 决策 / 节奏
  get_next_action: () => ({ method: 'POST', path: '/api/v1/decision/next', body: true }),
  get_pacing_status: (a) => ({ method: 'GET', path: `/api/v1/sessions/${a.sessionId}/pacing` }),

  // 对话
  get_chat_history: (a) => ({ method: 'GET', path: `/api/v1/chat/history?student_id=${a.studentId}` }),

  // 兴趣 / 背景
  list_interests: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/interests` }),
  add_interest: (a) => ({ method: 'POST', path: `/api/v1/students/${a.studentId}/interests`, body: true }),
  delete_interest: (a) => ({ method: 'DELETE', path: `/api/v1/interests/${a.interestId}` }),
  extract_interests_from_text: () => ({ method: 'POST', path: '/api/v1/interests/extract', body: true }),
  get_student_background: (a) => ({ method: 'GET', path: `/api/v1/students/${a.studentId}/background` }),
  update_student_background: (a) => ({ method: 'PUT', path: `/api/v1/students/${a.studentId}/background`, body: true }),

  // 家长
  verify_parent_password: () => ({ method: 'POST', path: '/api/v1/parent/login', body: true }),
  get_learning_overview: (a) => ({
    method: 'GET',
    path: `/api/v1/parent/students/${a.studentId}/overview?range=${a.range ?? 'week'}`,
  }),

  // 设置
  get_api_settings: () => ({ method: 'GET', path: '/api/v1/settings/api' }),
  update_api_settings: () => ({ method: 'PUT', path: '/api/v1/settings/api', body: true }),
};

async function httpInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const builder = HTTP_ROUTE_MAP[command];
  if (!builder) {
    throw new Error(`HTTP mode: command '${command}' has no route mapping yet`);
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
  if ('body' in route && route.body && args) {
    init.body = JSON.stringify(args);
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

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const mode = getBackendMode();
  if (mode === 'tauri') {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(command, args);
  }
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
      buffer += decoder.decode(value, { stream: true });

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
 * 现有 API 把「start」和「subscribe」拆成两步（源于 Tauri 全局事件总线的设计）。
 * HTTP 模式下我们需要把两步粘起来：subscribe() 先把 handlers 挂进 registry，
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

  /** 清除学生所有学习数据（删库，保留学生 / 知识点 / 题目静态表） */
  clearStudentData: async (studentId: string): Promise<{ total_deleted: number } | null> => {
    if (!isTauri()) return null;
    return invoke('clear_student_data', { studentId });
  },

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
  start: async (
    requestId: string,
    questionId: string,
    studentId?: string,
    sessionId?: string,
  ) => {
    const mode = getBackendMode();
    if (mode === 'tauri') {
      return invoke('generate_explanation_stream', {
        requestId, questionId, studentId, sessionId,
      });
    }
    if (mode === 'http') {
      // HTTP 模式下真正发起 fetch 并把事件分发给已注册的 handlers
      const entry = httpStreamRegistry.get(requestId);
      if (!entry) {
        throw new Error(`explainService.start: requestId=${requestId} 未先 subscribe`);
      }
      const url =
        `${getHttpBase()}/api/v1/explain/stream?question_id=${encodeURIComponent(questionId)}`;
      const headers: Record<string, string> = {};
      const key = getHttpApiKey();
      if (key) headers.Authorization = `Bearer ${key}`;

      // 后台异步跑，不 await（和 Tauri 的行为一致：start 返回后流仍在推送）
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
      return;
    }
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
    const mode = getBackendMode();
    if (mode === 'http') {
      return httpStreamSubscribe(
        requestId,
        onChunk,
        (p: any) => onDone(p as ExplanationDonePayload),
      );
    }
    // tauri 模式
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
/** 流式对话事件 payload（与后端 `chat:done` 对应）
 *
 * 聊天次数 / 时长限制相关字段保留可选以向后兼容历史 Tauri 后端，但浏览器 http 模式下
 * 不再设置这些字段，前端 UI 也不展示限制提示。
 */
export interface ChatStreamDonePayload {
  request_id: string;
  full_text: string;
  /** @deprecated HTTP 模式不再使用，保留兼容 Tauri 后端 */
  chat_remaining?: number;
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
    const mode = getBackendMode();

    if (mode === 'tauri') {
      return invoke<ChatStreamDonePayload>('send_chat_message_stream', {
        requestId, studentId, message,
      });
    }

    if (mode === 'http') {
      // HTTP 模式：POST /api/v1/chat/stream 并读 SSE，事件分发给 registry 里的 handlers
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

      // 构造 payload — 不再含 chat_remaining/limit 等限制字段
      const payload: ChatStreamDonePayload = {
        request_id: requestId,
        full_text: fullText,
        is_limited: false,
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
    }

    throw new Error('sendMessageStream: unknown backend mode');
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
    const mode = getBackendMode();
    if (mode === 'tauri') {
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
    }
    // http 模式
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
  saveApiKey: (apiKey: string, model?: string) =>
    invoke('save_api_key', { apiKey, model }),

  getSettings: () =>
    invoke('get_settings'),
};

// =============================================
// 题库服务 — 纯 HTTP / Tauri
// =============================================

export interface QuizResult {
  mode: QuizMode;
  total: number;
  questions: Question[];
}

/**
 * @deprecated 浏览器 mock 答题记录存储已移除，所有答题记录由 server 端
 *   `/api/v1/sessions/{id}/answers` 持久化到 SQLite。此函数保留为 no-op
 *   以兼容未来可能还在使用它的组件。
 */
export function saveMockAnswerRecord(_record: {
  questionId: string;
  isCorrect: boolean;
  timeSpentSecs: number;
  knowledgePoint?: string;
  unit?: string;
}): void {
  // no-op — server 持久化替代本地 mock
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
