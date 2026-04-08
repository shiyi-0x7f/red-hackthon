import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReactECharts from 'echarts-for-react';

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

  useEffect(() => {
    setProfileData(getMockProfileData());
  }, []);

  // === ECharts 雷达图配置 ===
  const radarOption = useMemo(() => {
    const data = profileData.masteryData.slice(0, 6);
    return {
      tooltip: { trigger: 'item' as const },
      radar: {
        indicator: data.map((d) => ({ name: d.name, max: 1 })),
        radius: '68%',
        splitNumber: 4,
        axisName: {
          color: '#6B6B8D',
          fontSize: 11,
        },
        splitLine: { lineStyle: { color: 'rgba(124, 92, 252, 0.15)' } },
        splitArea: { areaStyle: { color: ['rgba(124, 92, 252, 0.02)', 'rgba(124, 92, 252, 0.06)'] } },
        axisLine: { lineStyle: { color: 'rgba(124, 92, 252, 0.2)' } },
      },
      series: [
        {
          type: 'radar' as const,
          symbol: 'circle',
          symbolSize: 6,
          data: [
            {
              value: data.map((d) => d.mastery_score),
              name: '掌握度',
              areaStyle: {
                color: {
                  type: 'radial' as const,
                  x: 0.5, y: 0.5, r: 0.7,
                  colorStops: [
                    { offset: 0, color: 'rgba(124, 92, 252, 0.45)' },
                    { offset: 1, color: 'rgba(84, 181, 255, 0.1)' },
                  ],
                },
              },
              lineStyle: { color: '#7C5CFC', width: 2 },
              itemStyle: { color: '#7C5CFC', borderColor: '#fff', borderWidth: 2 },
            },
          ],
        },
      ],
    };
  }, [profileData]);

  // === 掌握度趋势折线（按 attempt_count 排序模拟时间序列）===
  const trendOption = useMemo(() => {
    const sorted = [...profileData.masteryData].sort((a, b) => b.attempt_count - a.attempt_count);
    return {
      tooltip: { trigger: 'axis' as const, formatter: '{b}<br/>掌握度: {c}%' },
      grid: { left: 50, right: 20, top: 30, bottom: 40 },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((d) => d.name),
        axisLabel: { rotate: 30, fontSize: 10, color: '#7b77a3' },
        axisLine: { lineStyle: { color: '#e6e1ff' } },
      },
      yAxis: {
        type: 'value' as const,
        max: 100,
        axisLabel: { formatter: '{value}%', color: '#7b77a3' },
        splitLine: { lineStyle: { color: 'rgba(124, 92, 252, 0.08)' } },
      },
      series: [
        {
          type: 'line' as const,
          data: sorted.map((d) => Math.round(d.mastery_score * 100)),
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { color: '#7C5CFC', width: 3 },
          itemStyle: { color: '#54B5FF', borderColor: '#fff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(124, 92, 252, 0.35)' },
                { offset: 1, color: 'rgba(124, 92, 252, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [profileData]);

  // === 学习量柱状图（按知识点的练习次数）===
  const attemptOption = useMemo(() => {
    const sorted = [...profileData.masteryData].sort((a, b) => b.attempt_count - a.attempt_count).slice(0, 8);
    return {
      tooltip: { trigger: 'axis' as const, formatter: '{b}<br/>{a}: {c} 道' },
      grid: { left: 50, right: 20, top: 30, bottom: 40 },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((d) => d.name),
        axisLabel: { rotate: 30, fontSize: 10, color: '#7b77a3' },
        axisLine: { lineStyle: { color: '#e6e1ff' } },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { color: '#7b77a3' },
        splitLine: { lineStyle: { color: 'rgba(124, 92, 252, 0.08)' } },
      },
      series: [
        {
          name: '练习题量',
          type: 'bar' as const,
          data: sorted.map((d) => d.attempt_count),
          itemStyle: {
            color: {
              type: 'linear' as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#7C5CFC' },
                { offset: 1, color: '#54B5FF' },
              ],
            },
            borderRadius: [6, 6, 0, 0],
          },
          barWidth: '50%',
        },
      ],
    };
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
        {/* ECharts 雷达图 */}
        <div className="card profile-radar-card">
          <h2 className="card-title">📊 知识掌握雷达</h2>
          <ReactECharts option={radarOption} style={{ height: 320, width: '100%' }} />
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

      {/* 掌握度趋势 + 练习量柱状 */}
      <div className="profile-charts-row">
        <div className="card profile-trend-card">
          <h2 className="card-title">📈 掌握度趋势（按熟悉度排序）</h2>
          <ReactECharts option={trendOption} style={{ height: 260, width: '100%' }} />
        </div>
        <div className="card profile-attempt-card">
          <h2 className="card-title">📊 各知识点练习量</h2>
          <ReactECharts option={attemptOption} style={{ height: 260, width: '100%' }} />
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
