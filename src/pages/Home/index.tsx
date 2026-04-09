import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/useAppStore';
import {
  SendOutlined,
  BookOutlined,
  RedoOutlined,
  MessageOutlined,
  SmileOutlined,
  AudioOutlined,
} from '@ant-design/icons';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import '../../styles/learning-extras.css';

/* ── 聊天内容中的 LaTeX + Markdown 渲染 ── */

/** 自动包裹裸露 LaTeX 命令 */
function autoWrapLatex(text: string): string {
  if (text.includes('$')) return text;
  if (!/\\[a-zA-Z]/.test(text)) return text;
  const mathSpan = /([A-Za-z0-9\\{}+\-*/=.()×÷_^,\s]*?\\[a-zA-Z]+(?:\{[^{}]*\})*(?:[A-Za-z0-9\\{}+\-*/=.()×÷_^,\s]*\\[a-zA-Z]+(?:\{[^{}]*\})*)*[A-Za-z0-9\\{}+\-*/=.()×÷_^,\s]*)/g;
  return text.replace(mathSpan, (m) => {
    const trimmed = m.trim();
    if (!trimmed || !/\\[a-zA-Z]/.test(trimmed)) return m;
    return ` $${trimmed}$ `;
  });
}

/** 将包含 LaTeX + Markdown 的文本渲染为 HTML */
function renderChatHtml(text: string): string {
  let processed = autoWrapLatex(text);

  // 先提取公式用占位符保护
  const placeholders: string[] = [];
  const PH = '\x00KTX';

  processed = processed.replace(/\$\$([^$]+)\$\$/g, (_m, latex) => {
    try { placeholders.push(katex.renderToString(latex, { displayMode: true, throwOnError: false })); }
    catch { placeholders.push(latex); }
    return `${PH}${placeholders.length - 1}\x00`;
  });
  processed = processed.replace(/\$([^$]+)\$/g, (_m, latex) => {
    try { placeholders.push(katex.renderToString(latex, { displayMode: false, throwOnError: false })); }
    catch { placeholders.push(latex); }
    return `${PH}${placeholders.length - 1}\x00`;
  });

  // HTML 转义
  processed = processed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown 加粗
  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 段落 / 换行
  processed = processed.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');

  // 还原 KaTeX 占位符
  processed = processed.replace(new RegExp(`${PH.replace(/\x00/g, '\\x00')}(\\d+)\\x00`, 'g'), (_m, idx) => {
    return placeholders[parseInt(idx, 10)] || '';
  });

  return processed;
}

// === 静态预设回复 ===
const GREETINGS: Record<string, { text: string; mood: string; moodEmoji: string }> = {
  morning: {
    text: '早上好呀！新的一天，让我们一起来学点有趣的数学吧~ ☀️',
    mood: '元气满满',
    moodEmoji: '☀️',
  },
  afternoon: {
    text: '下午好！午后的时光最适合动脑筋了，准备好了吗？🌤️',
    mood: '活力充沛',
    moodEmoji: '🌤️',
  },
  evening: {
    text: '晚上好！今天辛苦啦，要不要轻松复习一下今天学的内容？🌙',
    mood: '温馨陪伴',
    moodEmoji: '🌙',
  },
};

const STATIC_REPLIES = [
  '嘿嘿，这个问题很有趣！不过我现在还在学习中，很快就能跟你好好聊啦~',
  '我正在努力升级自己呢！等我准备好了，一定陪你一起探索数学的奥秘！✨',
  '你好厉害，已经开始主动学习了！我会尽快准备好，到时候一起加油！💪',
  '哈哈，我现在还在成长中，等我长大一点就能回答更多问题啦~',
  '谢谢你来找我聊天！虽然我还在成长中，但我已经很开心啦 😊',
];

const QUICK_SUGGESTIONS = [
  '帮我复习一下',
  '出道题考考我！',
  '我的学习进度怎么样？',
  '今天学什么好呢？',
];

interface StructuredReply {
  text: string;
  question?: { title?: string; content: string; hints?: string[] } | null;
  steps?: string[] | null;
  action?: string | null;
}

interface ChatMessage {
  id: number;
  role: 'companion' | 'student';
  content: string;
  structured?: StructuredReply;
}

/** 结构化消息渲染组件 */
const ChatStructuredContent: React.FC<{ data: StructuredReply }> = ({ data }) => (
  <div className="chat-structured">
    {data.text && <p className="chat-text">{data.text}</p>}
    {data.question && (
      <div className="chat-question-card">
        {data.question.title && <div className="chat-q-title">{data.question.title}</div>}
        <div className="chat-q-content">{data.question.content}</div>
        {data.question.hints && data.question.hints.length > 0 && (
          <div className="chat-q-hints">
            {data.question.hints.map((h, i) => (
              <div key={i} className="chat-q-hint">💡 {h}</div>
            ))}
          </div>
        )}
      </div>
    )}
    {data.steps && data.steps.length > 0 && (
      <div className="chat-steps">
        {data.steps.map((s, i) => (
          <div key={i} className="chat-step">
            <span className="chat-step-num">{i + 1}</span>
            <span className="chat-step-text">{s}</span>
          </div>
        ))}
      </div>
    )}
    {data.action === 'suggest_practice' && (
      <div className="chat-action-hint">👉 试试点击左边的「开始学习」按钮</div>
    )}
    {data.action === 'suggest_review' && (
      <div className="chat-action-hint">👉 可以去「复习旧知」巩固一下</div>
    )}
  </div>
)

// === Web Speech API 类型声明 ===
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

function getTimeSlot(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function getWeekday(): string {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `星期${days[new Date().getDay()]}`;
}

function getDateStr(): string {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 检测是否支持语音识别 */
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const timeSlot = getTimeSlot();
  const greeting = GREETINGS[timeSlot];
  const studentId = useAppStore((s) => s.currentStudentId);

  // 对话默认展开
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const replyIndex = useRef(0);

  // 聊天次数和时长限制已取消，UI 不再展示限制信息

  // 语音相关状态
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // 检测语音支持
  useEffect(() => {
    const SpeechRecognitionAPI = getSpeechRecognition();
    setVoiceSupported(!!SpeechRecognitionAPI);
  }, []);

  // 首次加载时添加学搭搭打招呼消息
  useEffect(() => {
    setMessages([{ id: 1, role: 'companion', content: greeting.text }]);
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  const handleSend = useCallback(async (text?: string) => {
    const content = text || inputValue.trim();
    if (!content || isTyping) return;

    const studentMsg: ChatMessage = { id: Date.now(), role: 'student', content };
    const aiMsgId = Date.now() + 1;
    setMessages((prev) => [...prev, studentMsg]);
    setInputValue('');
    setIsTyping(true);

    try {
      const { getHttpBase, getHttpApiKey } = await import('../../services');
      const url = `${getHttpBase()}/api/v1/chat/stream`;
      const key = getHttpApiKey();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (key) headers['Authorization'] = `Bearer ${key}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          student_id: studentId,
          content,
          context_type: 'casual',
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      // 先创建一个空的 AI 回复气泡
      setMessages((prev) => [
        ...prev,
        { id: aiMsgId, role: 'companion', content: '' },
      ]);

      // 流式读取 SSE 并逐 chunk 更新气泡内容
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let sepIdx: number;
        while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);

          let evName = 'message';
          const dataLines: string[] = [];
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) evName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5));
          }
          const data = dataLines.join('\n').trim();

          if (evName === 'chunk' && data) {
            fullText += data;
            // 实时更新气泡内容
            const snapshot = fullText;
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, content: snapshot } : m)),
            );
          } else if (evName === 'done' || data === '[DONE]') {
            break;
          }
        }
      }

      // 流结束 — 确保最终文本写入
      if (!fullText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, content: '(思考中…请再试一次)' } : m,
          ),
        );
      }
    } catch (err) {
      console.error('[Chat] 调用失败:', err);
      const reply = STATIC_REPLIES[replyIndex.current % STATIC_REPLIES.length];
      replyIndex.current += 1;
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'companion', content: reply },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [inputValue, studentId, isTyping]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // === 语音输入 ===
  const toggleVoice = useCallback(() => {
    if (isListening) {
      // 停止录音
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI = getSpeechRecognition();
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // 实时更新输入框
      if (finalTranscript) {
        setInputValue((prev) => prev + finalTranscript);
      } else if (interimTranscript) {
        // 展示临时结果（通过 placeholder 效果展示）
        setInputValue(interimTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('语音识别错误:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  }, [isListening]);

  return (
    <div className="home-page">
      {/* ===== 左侧：招呼气泡 + 学搭搭角色展示 ===== */}
      <div className="companion-column">
        {/* 招呼气泡 */}
        <motion.div
          className="greeting-bubble"
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <div className="bubble-arrow" />
          <p className="greeting-text">{greeting.text}</p>
          <p className="greeting-sub">今天也是充满可能的一天！一起加油吧 💪</p>
        </motion.div>

        <motion.div
          className="companion-area"
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          {/* 时段背景装饰 */}
          <div className={`companion-bg-glow ${timeSlot}`} />

          {/* 角色容器 — 预留 Live2D */}
          <div className="companion-avatar-wrapper" id="live2d-container">
            <motion.img
              src="/images/model.svg"
              alt="学搭搭"
              className="companion-avatar-img"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          {/* 心情标签 */}
          <motion.div
            className="companion-mood"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
          >
            <span className="mood-emoji">{greeting.moodEmoji}</span>
            <span className="mood-text">{greeting.mood}</span>
          </motion.div>

          {/* 日期信息 */}
          <motion.div
            className="companion-date"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            {getDateStr()} · {getWeekday()}
          </motion.div>
        </motion.div>
      </div>

      {/* ===== 右侧：快捷操作 + 聊天 ===== */}
      <div className="greeting-section">
        {/* 快捷操作 */}
        <div className="quick-actions">
          {[
            {
              icon: <BookOutlined />,
              title: '开始学习',
              desc: '继续你的数学冒险',
              color: '#FF8C42',
              gradient: 'linear-gradient(135deg, #FF8C42 0%, #FFA86A 100%)',
              path: '/learn',
            },
            {
              icon: <RedoOutlined />,
              title: '复习旧知',
              desc: '巩固已学的内容',
              color: '#5BC97F',
              gradient: 'linear-gradient(135deg, #5BC97F 0%, #A0DEB4 100%)',
              path: '/review',
            },
            {
              icon: <MessageOutlined />,
              title: '跟我聊聊',
              desc: '随便聊点什么',
              color: '#F5A623',
              gradient: 'linear-gradient(135deg, #F5A623 0%, #F8C46A 100%)',
              action: () => {
                if (!chatOpen) setChatOpen(true);
                // 聚焦到输入框
                setTimeout(() => {
                  document.querySelector<HTMLInputElement>('.chat-input')?.focus();
                }, 100);
              },
            },
          ].map((item, idx) => (
            <motion.div
              key={item.title}
              className="quick-action-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + idx * 0.1, duration: 0.4 }}
              onClick={() => {
                if (item.path) navigate(item.path);
                else item.action?.();
              }}
              whileHover={{ y: -4, boxShadow: `0 12px 28px ${item.color}30` }}
              whileTap={{ scale: 0.97 }}
            >
              <div
                className="action-icon"
                style={{ background: item.gradient }}
              >
                {item.icon}
              </div>
              <div className="action-info">
                <div className="action-title">{item.title}</div>
                <div className="action-desc">{item.desc}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ===== 对话区（默认展开） ===== */}
        <AnimatePresence initial={false}>
          {chatOpen && (
            <motion.div
              className="chat-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              <div className="chat-header">
                <SmileOutlined style={{ color: 'var(--color-primary)' }} />
                <span>跟学搭搭聊天</span>
                <button
                  className="chat-close-btn"
                  onClick={() => setChatOpen(false)}
                >
                  收起
                </button>
              </div>

              <div className="chat-messages">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    className={`chat-bubble ${msg.role}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {msg.role === 'companion' && (
                      <img src="/images/logo_128.png" alt="" className="chat-avatar" />
                    )}
                    <div className="chat-bubble-content">
                      {msg.role === 'companion' && msg.structured ? (
                        <ChatStructuredContent data={msg.structured} />
                      ) : msg.role === 'companion' ? (
                        <div dangerouslySetInnerHTML={{ __html: renderChatHtml(msg.content) }} />
                      ) : (
                        msg.content
                      )}
                    </div>
                  </motion.div>
                ))}
                {/* 等待回复 */}
                {isTyping && (
                  <div className="chat-bubble companion">
                    <img src="/images/logo_128.png" alt="" className="chat-avatar" />
                    <div className="chat-bubble-content typing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* 快捷建议 */}
              <div className="chat-suggestions">
                {QUICK_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="suggestion-chip"
                    onClick={() => handleSend(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* 输入框 + 语音 + 发送 */}
              <div className="chat-input-area">
                <input
                  type="text"
                  className="chat-input"
                  placeholder={isListening ? '🎤 正在听你说...' : '说点什么吧...'}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                />

                {/* 语音按钮 */}
                {voiceSupported && (
                  <button
                    className={`chat-voice-btn ${isListening ? 'listening' : ''}`}
                    onClick={toggleVoice}
                    title={isListening ? '停止录音' : '语音输入'}
                  >
                    {isListening ? (
                      <div className="voice-wave">
                        <span className="voice-wave-bar" />
                        <span className="voice-wave-bar" />
                        <span className="voice-wave-bar" />
                        <span className="voice-wave-bar" />
                        <span className="voice-wave-bar" />
                      </div>
                    ) : (
                      <AudioOutlined />
                    )}
                  </button>
                )}

                {/* 发送按钮 */}
                <button
                  className="chat-send-btn"
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim()}
                >
                  <SendOutlined />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 对话收起时显示展开按钮 */}
        {!chatOpen && (
          <motion.button
            className="chat-expand-btn"
            onClick={() => setChatOpen(true)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <MessageOutlined />
            <span>展开聊天</span>
          </motion.button>
        )}
      </div>
    </div>
  );
};

export default HomePage;
