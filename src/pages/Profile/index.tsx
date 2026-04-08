import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface MasteryItem {
  knowledge_id: string;
  name: string;
  mastery_score: number;
  attempt_count: number;
  forgetting_risk: number;
}

// Mock 数据（浏览器模式）
const getMockProfileData = () => {
  const records = JSON.parse(localStorage.getItem('mock_answer_records') || '[]');
  const total = records.length;
  const correct = records.filter((r: { isCorrect: boolean }) => r.isCorrect).length;

  const masteryMap: Record<string, { correct: number; total: number }> = {};
  records.forEach((r: { questionId: string; isCorrect: boolean }) => {
    const unit = r.questionId?.split('-')[0] || 'unknown';
    if (!masteryMap[unit]) masteryMap[unit] = { correct: 0, total: 0 };
    masteryMap[unit].total++;
    if (r.isCorrect) masteryMap[unit].correct++;
  });

  return {
    totalAnswers: total,
    correctCount: correct,
    accuracy: total > 0 ? correct / total : 0,
    learningDays: Math.min(Math.floor(total / 5) + 1, 30),
    streakDays: Math.min(Math.floor(total / 3), 7),
    masteryData: [
      { knowledge_id: 'k1', name: '分数乘法', mastery_score: 0.85, attempt_count: 12, forgetting_risk: 0.15 },
      { knowledge_id: 'k2', name: '位置与方向', mastery_score: 0.72, attempt_count: 8, forgetting_risk: 0.28 },
      { knowledge_id: 'k3', name: '分数除法', mastery_score: 0.65, attempt_count: 15, forgetting_risk: 0.35 },
      { knowledge_id: 'k4', name: '比', mastery_score: 0.58, attempt_count: 6, forgetting_risk: 0.42 },
      { knowledge_id: 'k5', name: '圆', mastery_score: 0.45, attempt_count: 4, forgetting_risk: 0.55 },
      { knowledge_id: 'k6', name: '百分数', mastery_score: 0.38, attempt_count: 3, forgetting_risk: 0.62 },
      { knowledge_id: 'k7', name: '扇形统计图', mastery_score: 0.30, attempt_count: 2, forgetting_risk: 0.7 },
      { knowledge_id: 'k8', name: '数与形', mastery_score: 0.20, attempt_count: 1, forgetting_risk: 0.8 },
    ] as MasteryItem[],
  };
};

const ProfilePage: React.FC = () => {
  const [profileData, setProfileData] = useState(getMockProfileData());
  const radarRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setProfileData(getMockProfileData());
  }, []);

  // 绘制雷达图
  useEffect(() => {
    const canvas = radarRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const maxR = size / 2 - 40;
    const data = profileData.masteryData.slice(0, 6);
    const n = data.length;
    if (n < 3) return;

    const angleStep = (Math.PI * 2) / n;

    // 画背景网格
    ctx.clearRect(0, 0, size, size);
    for (let ring = 1; ring <= 4; ring++) {
      const r = maxR * (ring / 4);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(124, 92, 252, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 画轴线
    for (let i = 0; i < n; i++) {
      const angle = i * angleStep - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle));
      ctx.strokeStyle = 'rgba(124, 92, 252, 0.1)';
      ctx.stroke();
    }

    // 画数据区域
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const angle = idx * angleStep - Math.PI / 2;
      const r = maxR * data[idx].mastery_score;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    gradient.addColorStop(0, 'rgba(124, 92, 252, 0.3)');
    gradient.addColorStop(1, 'rgba(124, 92, 252, 0.05)');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#7C5CFC';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 画数据点和标签
    for (let i = 0; i < n; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const r = maxR * data[i].mastery_score;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);

      // 点
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#7C5CFC';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 标签
      const lx = cx + (maxR + 22) * Math.cos(angle);
      const ly = cy + (maxR + 22) * Math.sin(angle);
      ctx.fillStyle = '#6B6B8D';
      ctx.font = '11px "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(data[i].name, lx, ly);
    }
  }, [profileData]);

  const { totalAnswers, accuracy, learningDays, streakDays, masteryData } = profileData;
  const weakPoints = [...masteryData].sort((a, b) => a.mastery_score - b.mastery_score).slice(0, 5);
  const forgettingAlerts = masteryData.filter(m => m.forgetting_risk > 0.5);

  return (
    <motion.div
      className="profile-page"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="page-title">👤 我的学习画像</h1>

      {/* 概况卡片 */}
      <div className="profile-stats-grid">
        <div className="profile-stat-card stat-primary">
          <div className="stat-number">{totalAnswers}</div>
          <div className="stat-label">总答题数</div>
        </div>
        <div className="profile-stat-card stat-success">
          <div className="stat-number">{(accuracy * 100).toFixed(0)}%</div>
          <div className="stat-label">正确率</div>
        </div>
        <div className="profile-stat-card stat-warning">
          <div className="stat-number">{learningDays}</div>
          <div className="stat-label">学习天数</div>
        </div>
        <div className="profile-stat-card stat-accent">
          <div className="stat-number">{streakDays} 🔥</div>
          <div className="stat-label">连续打卡</div>
        </div>
      </div>

      <div className="profile-charts-row">
        {/* 雷达图 */}
        <div className="card profile-radar-card">
          <h2 className="card-title">📊 知识掌握雷达</h2>
          <div className="radar-container">
            <canvas ref={radarRef} />
          </div>
        </div>

        {/* 弱项排行 */}
        <div className="card profile-weak-card">
          <h2 className="card-title">📉 需要加强的知识点</h2>
          <div className="weak-list">
            {weakPoints.map((item, idx) => (
              <div key={item.knowledge_id} className="weak-item">
                <span className="weak-rank">{idx + 1}</span>
                <span className="weak-name">{item.name}</span>
                <div className="weak-bar-wrapper">
                  <div
                    className="weak-bar"
                    style={{
                      width: `${item.mastery_score * 100}%`,
                      background: item.mastery_score < 0.4 ? '#FF6B6B'
                        : item.mastery_score < 0.7 ? '#FFB647'
                        : '#4ECDC4',
                    }}
                  />
                </div>
                <span className="weak-score">{(item.mastery_score * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 遗忘预警 */}
      {forgettingAlerts.length > 0 && (
        <div className="card profile-forget-card">
          <h2 className="card-title">⏰ 遗忘预警</h2>
          <p className="section-desc">以下知识点可能快要忘记了，建议及时复习</p>
          <div className="forget-tags">
            {forgettingAlerts.map((item) => (
              <div key={item.knowledge_id} className="forget-tag">
                <span className="forget-tag-name">{item.name}</span>
                <span className="forget-tag-risk">风险 {(item.forgetting_risk * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default ProfilePage;
