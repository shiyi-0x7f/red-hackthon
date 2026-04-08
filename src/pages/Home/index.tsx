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
import '../../styles/learning-extras.css';

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
  '哈哈，我现在还是个小搭子，等我长大一点就能回答更多问题啦~',
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
  const studentId = useAppStore((s) => s.currentStudentId) || 'default-student';

  // 对话默认展开
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const replyIndex = useRef(0);

  // 节奏控制状态（来自后端 chatService）
  const [chatRemaining, setChatRemaining] = useState<number | null>(null);
  const [sessionSecs, setSessionSecs] = useState(0);
  const [sessionMaxSecs] = useState(300); // 5 分钟硬限
  const [limitReason, setLimitReason] = useState<string | null>(null);
  const [cooldownSecs, setCooldownSecs] = useState(0);

  // 语音相关状态
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // 检测语音支持
  useEffect(() => {
    const SpeechRecognitionAPI = getSpeechRecognition();
    setVoiceSupported(!!SpeechRecognitionAPI);
  }, []);

  // 首次加载时添加搭子打招呼消息
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
    setMessages((prev) => [...prev, studentMsg]);
    setInputValue('');
    setIsTyping(true);

    try {
      const { chatService } = await import('../../services');
      const result = await chatService.sendMessage(studentId, content) as {
        reply: string;
        structured?: StructuredReply;
        chat_remaining?: number;
        is_limited?: boolean;
        limit_reason?: string;
        session_secs?: number;
        session_max_secs?: number;
        cooldown_remaining_secs?: number;
        needs_escalation?: boolean;
      };

      // 节奏控制元数据
      if (typeof result.chat_remaining === 'number') setChatRemaining(result.chat_remaining);
      if (typeof result.session_secs === 'number') setSessionSecs(result.session_secs);
      if (result.is_limited) {
        setLimitReason(result.limit_reason ?? 'limited');
        if (result.cooldown_remaining_secs) setCooldownSecs(result.cooldown_remaining_secs);
      } else {
        setLimitReason(null);
        setCooldownSecs(0);
      }
      if (result.needs_escalation) {
        console.warn('[Chat] 触发敏感内容升级提示');
      }

      // 尝试解析 structured 或从 reply 中解析 JSON
      let structured: StructuredReply | undefined = result.structured as StructuredReply;
      if (!structured?.text) {
        try {
          const parsed = JSON.parse(result.reply);
          if (parsed.text) structured = parsed;
        } catch { /* not JSON */ }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'companion',
          content: structured?.text || result.reply,
          structured,
        },
      ]);
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
      {/* ===== 左侧：搭子角色展示 ===== */}
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
            src="/images/companion.png"
            alt="学习搭子"
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

      {/* ===== 右侧：对话 + 快捷操作 ===== */}
      <div className="greeting-section">
        {/* 招呼气泡 */}
        <motion.div
          className="greeting-bubble"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div className="bubble-arrow" />
          <p className="greeting-text">{greeting.text}</p>
          <p className="greeting-sub">今天也是充满可能的一天！一起加油吧 💪</p>
        </motion.div>

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
                <span>跟搭子聊天</span>
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
                      <img src="/images/companion.png" alt="" className="chat-avatar" />
                    )}
                    <div className="chat-bubble-content">
                      {msg.role === 'companion' && msg.structured ? (
                        <ChatStructuredContent data={msg.structured} />
                      ) : (
                        msg.content
                      )}
                    </div>
                  </motion.div>
                ))}
                {/* 等待回复 */}
                {isTyping && (
                  <div className="chat-bubble companion">
                    <img src="/images/companion.png" alt="" className="chat-avatar" />
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

              {/* 节奏控制状态条 */}
              {(chatRemaining !== null || sessionSecs > 0 || limitReason) && (
                <div className={`chat-pacing-bar ${limitReason ? 'limited' : ''}`}>
                  {limitReason === 'cooldown' && (
                    <span>💤 我们刚才聊得比较多，{Math.ceil(cooldownSecs / 60)} 分钟后再聊吧</span>
                  )}
                  {limitReason === 'session_max' && (
                    <span>⏱ 已经聊了 5 分钟啦，先休息一下 ☕</span>
                  )}
                  {limitReason === 'daily_quota' && (
                    <span>📚 今天聊天次数用完啦，明天再来</span>
                  )}
                  {!limitReason && (
                    <>
                      {chatRemaining !== null && (
                        <span className="chat-pacing-quota">今日剩余 {chatRemaining} 次</span>
                      )}
                      {sessionSecs > 0 && (
                        <span className="chat-pacing-session">
                          本次对话 {Math.floor(sessionSecs / 60)}:{String(sessionSecs % 60).padStart(2, '0')} / {sessionMaxSecs / 60}:00
                          <span className="chat-pacing-track">
                            <span className="chat-pacing-fill" style={{ width: `${Math.min(100, (sessionSecs / sessionMaxSecs) * 100)}%` }} />
                          </span>
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 输入框 + 语音 + 发送 */}
              <div className="chat-input-area">
                <input
                  type="text"
                  className="chat-input"
                  placeholder={isListening ? '🎤 正在听你说...' : limitReason ? '稍后再来吧...' : '说点什么吧...'}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!!limitReason}
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
