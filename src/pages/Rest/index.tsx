import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const mathFacts = [
  { emoji: '🔢', title: '零的故事', content: '数字"0"最早由古印度数学家发明，后来通过阿拉伯人传到欧洲。在很长一段时间里，欧洲人都不接受"空无一物"也可以是一个数字！' },
  { emoji: '📐', title: '圆周率 π', content: 'π 是一个无限不循环小数，目前已被计算到超过100万亿位！如果将 π 的所有数字写成一本书，需要的纸张可以绕地球好几圈。' },
  { emoji: '🌻', title: '向日葵的秘密', content: '向日葵的种子排列遵循斐波那契数列：1, 1, 2, 3, 5, 8, 13, 21...每个数等于前两个数之和。大自然也在用数学！' },
  { emoji: '♾️', title: '无穷大', content: '数学中有很多种"无穷大"！数学家康托尔证明了实数的无穷大竟然比自然数的无穷大还要"大"！' },
  { emoji: '🎲', title: '生日悖论', content: '在23个人中，至少有两个人生日相同的概率超过50%！在70个人中，这个概率高达99.9%！是不是很神奇？' },
  { emoji: '🏛️', title: '完美数', content: '6是第一个完美数，因为 1+2+3=6。第二个完美数是28（1+2+4+7+14=28）。到目前为止，人类只找到了51个完美数！' },
  { emoji: '🐢', title: '阿基里斯与乌龟', content: '古希腊哲学家芝诺提出：快跑的阿基里斯永远追不上慢吞吞的乌龟。这个著名的悖论帮助数学家发展了"极限"的概念。' },
  { emoji: '🧊', title: '莫比乌斯环', content: '拿一条纸带，扭转180度后将两端粘在一起，你就得到了一个只有一个面、一条边的神奇物体——莫比乌斯环！' },
];

const RestPage: React.FC = () => {
  const navigate = useNavigate();
  const [restMode, setRestMode] = useState<'select' | 'timer' | 'fact' | 'game'>('select');
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [currentFact, setCurrentFact] = useState(0);

  // 数字记忆游戏
  const [gamePhase, setGamePhase] = useState<'show' | 'input' | 'result'>('show');
  const [gameNumbers, setGameNumbers] = useState('');
  const [gameInput, setGameInput] = useState('');
  const [gameLevel, setGameLevel] = useState(4);
  const [gameScore, setGameScore] = useState(0);
  const gameInputRef = useRef<HTMLInputElement>(null);

  // 倒计时
  useEffect(() => {
    if (!isRunning || secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning, secondsLeft]);

  const startTimer = (mins: number) => {
    setTimerMinutes(mins);
    setSecondsLeft(mins * 60);
    setIsRunning(true);
    setRestMode('timer');
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const timerProgress = timerMinutes > 0 ? 1 - secondsLeft / (timerMinutes * 60) : 0;

  // 数字记忆游戏
  const startGame = useCallback(() => {
    const nums = Array.from({ length: gameLevel }, () => Math.floor(Math.random() * 10)).join('');
    setGameNumbers(nums);
    setGameInput('');
    setGamePhase('show');
    setTimeout(() => {
      setGamePhase('input');
      setTimeout(() => gameInputRef.current?.focus(), 100);
    }, gameLevel * 600 + 500);
  }, [gameLevel]);

  const checkGameAnswer = () => {
    setGamePhase('result');
    if (gameInput === gameNumbers) {
      setGameScore(prev => prev + gameLevel * 10);
      setGameLevel(prev => Math.min(prev + 1, 12));
    }
  };

  return (
    <motion.div
      className="rest-page"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <AnimatePresence mode="wait">
        {restMode === 'select' && (
          <motion.div key="select" className="rest-select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="rest-hero">
              <span className="rest-hero-emoji">☕</span>
              <h1 className="rest-hero-title">休息一下，充充电</h1>
              <p className="rest-hero-desc">适当休息才能学得更好哦～选择你想做的事情</p>
            </div>

            <div className="rest-options-grid">
              {/* 倒计时休息 */}
              <div className="rest-option-card" onClick={() => setRestMode('timer')}>
                <div className="rest-option-icon" style={{ background: 'linear-gradient(135deg, #FF8C42, #FFA86A)' }}>⏰</div>
                <h3>定时休息</h3>
                <p>设置休息倒计时，到时间提醒你</p>
              </div>

              {/* 数学小知识 */}
              <div className="rest-option-card" onClick={() => { setCurrentFact(Math.floor(Math.random() * mathFacts.length)); setRestMode('fact'); }}>
                <div className="rest-option-icon" style={{ background: 'linear-gradient(135deg, #5BC97F, #A0DEB4)' }}>💡</div>
                <h3>趣味数学</h3>
                <p>了解有趣的数学小知识</p>
              </div>

              {/* 数字记忆 */}
              <div className="rest-option-card" onClick={() => { setGameLevel(4); setGameScore(0); startGame(); setRestMode('game'); }}>
                <div className="rest-option-icon" style={{ background: 'linear-gradient(135deg, #F5A623, #F8C46A)' }}>🧠</div>
                <h3>数字记忆</h3>
                <p>锻炼记忆力的小游戏</p>
              </div>
            </div>
          </motion.div>
        )}

        {restMode === 'timer' && (
          <motion.div key="timer" className="rest-timer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {!isRunning && secondsLeft === 0 ? (
              <>
                <h2 className="rest-section-title">选择休息时长</h2>
                <div className="timer-choices">
                  {[5, 10, 15].map(min => (
                    <button key={min} className="timer-choice-btn" onClick={() => startTimer(min)}>
                      <span className="timer-choice-num">{min}</span>
                      <span className="timer-choice-unit">分钟</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="timer-display">
                <svg className="timer-ring" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255, 140, 66,0.1)" strokeWidth="8" />
                  <circle
                    cx="100" cy="100" r="90" fill="none" stroke="#FF8C42" strokeWidth="8"
                    strokeDasharray={565.48}
                    strokeDashoffset={565.48 * timerProgress}
                    strokeLinecap="round"
                    transform="rotate(-90 100 100)"
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <div className="timer-text">
                  {secondsLeft > 0 ? (
                    <>
                      <span className="timer-digits">{formatTime(secondsLeft)}</span>
                      <span className="timer-label">放松中...</span>
                    </>
                  ) : (
                    <>
                      <span className="timer-done-emoji">🎉</span>
                      <span className="timer-done-text">休息结束！</span>
                      <span className="timer-done-sub">精力充沛，继续加油吧～</span>
                    </>
                  )}
                </div>
              </div>
            )}
            <button className="btn-secondary rest-back-btn" onClick={() => { setIsRunning(false); setSecondsLeft(0); setRestMode('select'); }}>
              ← 返回
            </button>
            {secondsLeft === 0 && isRunning === false && timerMinutes > 0 && (
              <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/home')}>
                回到首页继续学习 🚀
              </button>
            )}
          </motion.div>
        )}

        {restMode === 'fact' && (
          <motion.div key="fact" className="rest-fact" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="fact-card">
              <div className="fact-emoji">{mathFacts[currentFact].emoji}</div>
              <h2 className="fact-title">{mathFacts[currentFact].title}</h2>
              <p className="fact-content">{mathFacts[currentFact].content}</p>
            </div>
            <div className="fact-actions">
              <button className="btn-primary" onClick={() => setCurrentFact((currentFact + 1) % mathFacts.length)}>
                下一个 →
              </button>
              <button className="btn-secondary rest-back-btn" onClick={() => setRestMode('select')}>
                ← 返回
              </button>
            </div>
          </motion.div>
        )}

        {restMode === 'game' && (
          <motion.div key="game" className="rest-game" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="game-header">
              <h2>🧠 数字记忆挑战</h2>
              <div className="game-stats">
                <span>等级 {gameLevel - 3}</span>
                <span className="game-score">得分: {gameScore}</span>
              </div>
            </div>

            <div className="game-area">
              {gamePhase === 'show' && (
                <div className="game-show">
                  <p className="game-instruction">记住这些数字！</p>
                  <div className="game-numbers">{gameNumbers}</div>
                </div>
              )}
              {gamePhase === 'input' && (
                <div className="game-input">
                  <p className="game-instruction">输入你记住的数字：</p>
                  <input
                    ref={gameInputRef}
                    type="text"
                    className="game-input-field"
                    value={gameInput}
                    onChange={e => setGameInput(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => e.key === 'Enter' && checkGameAnswer()}
                    maxLength={gameLevel}
                    autoFocus
                  />
                  <button className="btn-primary" onClick={checkGameAnswer} style={{ marginTop: 16 }}>确认</button>
                </div>
              )}
              {gamePhase === 'result' && (
                <div className="game-result">
                  {gameInput === gameNumbers ? (
                    <>
                      <span className="game-result-emoji">🎉</span>
                      <p className="game-result-text">太棒了！记忆力真好！</p>
                    </>
                  ) : (
                    <>
                      <span className="game-result-emoji">😅</span>
                      <p className="game-result-text">差一点点～</p>
                      <p className="game-result-answer">正确答案：{gameNumbers}</p>
                      <p className="game-result-answer">你的答案：{gameInput || '(空)'}</p>
                    </>
                  )}
                  <button className="btn-primary" onClick={startGame} style={{ marginTop: 20 }}>
                    再来一次！
                  </button>
                </div>
              )}
            </div>

            <button className="btn-secondary rest-back-btn" onClick={() => setRestMode('select')}>
              ← 返回
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default RestPage;
