import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface DailyData {
  date: string;
  duration_minutes: number;
  question_count: number;
  correct_count: number;
  accuracy: number;
}

// Mock 数据
const mockOverview = {
  total_duration_minutes: 245,
  session_count: 18,
  question_count: 156,
  correct_count: 112,
  accuracy_rate: 0.718,
  total_learning_days: 12,
};

const mockDailyData: DailyData[] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - 13 + i);
  const qc = Math.floor(Math.random() * 15) + 3;
  const cc = Math.floor(qc * (0.5 + Math.random() * 0.4));
  return {
    date: d.toISOString().split('T')[0],
    duration_minutes: Math.floor(Math.random() * 30) + 5,
    question_count: qc,
    correct_count: cc,
    accuracy: qc > 0 ? cc / qc : 0,
  };
});

const mockMastery = [
  { name: '分数乘法', mastery_score: 0.85 },
  { name: '位置与方向', mastery_score: 0.72 },
  { name: '分数除法', mastery_score: 0.65 },
  { name: '比', mastery_score: 0.58 },
  { name: '圆', mastery_score: 0.45 },
  { name: '百分数', mastery_score: 0.38 },
  { name: '扇形统计图', mastery_score: 0.30 },
  { name: '数与形', mastery_score: 0.20 },
];

const ParentPage: React.FC = () => {
  const [isVerified, setIsVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [range, setRange] = useState<'week' | 'month'>('week');

  const handleVerify = () => {
    if (password === '123456') {
      setIsVerified(true);
      setError('');
    } else {
      setError('密码不正确，请重试');
    }
  };

  const maxDuration = Math.max(...mockDailyData.map(d => d.duration_minutes), 1);


  if (!isVerified) {
    return (
      <motion.div
        className="parent-page parent-login"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="parent-lock-card">
          <div className="lock-icon">🔒</div>
          <h1 className="lock-title">家长空间</h1>
          <p className="lock-desc">请输入密码，查看孩子的学习情况</p>

          <div className="lock-form">
            <input
              type="password"
              className="form-input lock-input"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
            {error && <div className="lock-error">{error}</div>}
            <button className="btn-primary lock-btn" onClick={handleVerify}>进入</button>
          </div>
          <p className="lock-hint">默认密码：123456</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="parent-page parent-dashboard"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="parent-header">
        <div>
          <h1 className="page-title">📊 学习报告</h1>
          <p className="page-subtitle">了解孩子的学习进度和知识掌握情况</p>
        </div>
        <div className="range-toggle">
          <button className={`range-btn ${range === 'week' ? 'active' : ''}`} onClick={() => setRange('week')}>本周</button>
          <button className={`range-btn ${range === 'month' ? 'active' : ''}`} onClick={() => setRange('month')}>本月</button>
        </div>
      </div>

      {/* 总览卡片 */}
      <div className="parent-stats-grid">
        <div className="parent-stat-card">
          <div className="parent-stat-icon" style={{ background: 'linear-gradient(135deg, #7C5CFC, #9B7FFF)' }}>⏱️</div>
          <div className="parent-stat-info">
            <div className="parent-stat-num">{mockOverview.total_duration_minutes}</div>
            <div className="parent-stat-label">学习时长(分)</div>
          </div>
        </div>
        <div className="parent-stat-card">
          <div className="parent-stat-icon" style={{ background: 'linear-gradient(135deg, #4ECDC4, #7EDDD6)' }}>📝</div>
          <div className="parent-stat-info">
            <div className="parent-stat-num">{mockOverview.question_count}</div>
            <div className="parent-stat-label">完成题目</div>
          </div>
        </div>
        <div className="parent-stat-card">
          <div className="parent-stat-icon" style={{ background: 'linear-gradient(135deg, #FFB647, #FFD08A)' }}>🎯</div>
          <div className="parent-stat-info">
            <div className="parent-stat-num">{(mockOverview.accuracy_rate * 100).toFixed(0)}%</div>
            <div className="parent-stat-label">正确率</div>
          </div>
        </div>
        <div className="parent-stat-card">
          <div className="parent-stat-icon" style={{ background: 'linear-gradient(135deg, #FF6B6B, #FF9B9B)' }}>📅</div>
          <div className="parent-stat-info">
            <div className="parent-stat-num">{mockOverview.total_learning_days}</div>
            <div className="parent-stat-label">学习天数</div>
          </div>
        </div>
      </div>

      <div className="parent-charts-row">
        {/* 学习时间柱状图 */}
        <div className="card parent-chart-card">
          <h2 className="card-title">📈 学习时间趋势</h2>
          <div className="bar-chart">
            {mockDailyData.slice(-7).map((d, i) => (
              <div key={i} className="bar-chart-col">
                <div className="bar-wrapper">
                  <div
                    className="bar-fill"
                    style={{ height: `${(d.duration_minutes / maxDuration) * 100}%` }}
                  />
                </div>
                <span className="bar-label">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 知识掌握进度 */}
        <div className="card parent-mastery-card">
          <h2 className="card-title">📚 知识掌握进度</h2>
          <div className="mastery-list">
            {mockMastery.map((m, idx) => (
              <div key={idx} className="mastery-row">
                <span className="mastery-name">{m.name}</span>
                <div className="mastery-bar-outer">
                  <div
                    className="mastery-bar-inner"
                    style={{
                      width: `${m.mastery_score * 100}%`,
                      background: m.mastery_score >= 0.7 ? 'linear-gradient(90deg, #4ECDC4, #7EDDD6)'
                        : m.mastery_score >= 0.4 ? 'linear-gradient(90deg, #FFB647, #FFD08A)'
                        : 'linear-gradient(90deg, #FF6B6B, #FF9B9B)',
                    }}
                  />
                </div>
                <span className="mastery-percent">{(m.mastery_score * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 退出 */}
      <div className="parent-footer">
        <button className="btn-secondary" onClick={() => setIsVerified(false)}>退出家长模式 🔒</button>
      </div>
    </motion.div>
  );
};

export default ParentPage;
