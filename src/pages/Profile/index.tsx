import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReactECharts from 'echarts-for-react';
import { studentModelService, type ProfileOverview } from '../../services';
import { useAppStore } from '../../stores/useAppStore';
import WrongAnswerBook from '../../components/learning/WrongAnswerBook';
import InterestProfile from '../../components/learning/InterestProfile';
import '../../styles/learning-extras.css';

/**
 * 从层级化的知识点名称中提取最末层（叶子节点）
 *
 * 后端 knowledge_nodes.name 有时是全路径格式（"分数乘法-分数乘法应用题-分数乘法应用题"），
 * 直接渲染会导致雷达图 / X 轴标签太长而截断或重叠。这里做两件事：
 * 1. 按常见分隔符 `- → > › /` 切分取最后一段
 * 2. 如果最后一段与倒数第二段重复（人工标注常见错误），则再往上取一级
 *
 * 如果完整名称本身就很短，直接返回原名。
 */
function leafName(full: string | undefined, maxLen = 8): string {
  if (!full) return '';
  const parts = full
    .split(/[-→>›/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return full;
  let last = parts[parts.length - 1];
  // "A-A-A" 的情况再回退一层（没意义，取再上一级）
  if (parts.length >= 2 && parts[parts.length - 2] === last) {
    last = parts[parts.length - 2];
  }
  // 截断过长尾部（保留原来信息由 tooltip / title 显示）
  return last.length > maxLen ? last.slice(0, maxLen) + '…' : last;
}

interface MasteryItem {
  knowledge_id: string;
  name: string;
  mastery_score: number;
  attempt_count: number;
  forgetting_risk: number;
}

interface DailyStat {
  date: string;
  duration_minutes: number;
}

/** Profile 页内部用的数据结构 */
interface ProfileData {
  totalAnswers: number;
  correctCount: number;
  accuracy: number;
  learningDays: number;
  totalDurationMinutes: number;
  dailyStats: DailyStat[];
  masteryData: MasteryItem[];
}

const EMPTY_PROFILE_DATA: ProfileData = {
  totalAnswers: 0,
  correctCount: 0,
  accuracy: 0,
  learningDays: 0,
  totalDurationMinutes: 0,
  dailyStats: [],
  masteryData: [],
};

/** 把后端 ProfileOverview 转成 Profile 页内部用的数据格式 */
function fromBackendOverview(o: ProfileOverview): ProfileData {
  return {
    totalAnswers: o.total_questions,
    correctCount: o.correct_count,
    accuracy: o.accuracy,
    learningDays: o.learning_days,
    totalDurationMinutes: o.total_duration_minutes,
    dailyStats: o.daily_stats.map((d) => ({
      date: d.date.length >= 10 ? d.date.slice(5, 10) : d.date,
      duration_minutes: d.duration_minutes,
    })),
    masteryData: o.mastery_data.map((m) => ({
      knowledge_id: m.knowledge_id,
      name: m.name,
      mastery_score: m.mastery_score,
      attempt_count: m.attempt_count,
      forgetting_risk: m.forgetting_risk,
    })),
  };
}

/**
 * 学习建议卡片 — 基于 masteryData 自动计算 3 条建议
 *
 * - 复习：掌握度最低的 2 个知识点
 * - 巩固：遗忘风险最高的 2 个（排除已在复习里的）
 * - 挑战：掌握度最高且练习 ≥ 3 次的 1 个（鼓励进阶）
 */
const LearningSuggestionCard: React.FC<{ masteryData: MasteryItem[] }> = ({ masteryData }) => {
  if (!masteryData || masteryData.length === 0) return null;

  const sortedByMastery = [...masteryData].sort((a, b) => a.mastery_score - b.mastery_score);
  const sortedByRisk = [...masteryData].sort((a, b) => b.forgetting_risk - a.forgetting_risk);

  const toReview = sortedByMastery.slice(0, 2);
  const reviewIds = new Set(toReview.map((x) => x.knowledge_id));
  const toRefresh = sortedByRisk
    .filter((x) => x.forgetting_risk > 0.4 && !reviewIds.has(x.knowledge_id))
    .slice(0, 2);

  const challengeCandidate = [...masteryData]
    .filter((x) => x.mastery_score >= 0.75 && x.attempt_count >= 3)
    .sort((a, b) => b.mastery_score - a.mastery_score)[0];

  const rows: Array<{
    tag: string;
    tagClass: string;
    title: string;
    items: MasteryItem[];
  }> = [];

  if (toReview.length > 0) {
    rows.push({
      tag: '优先复习',
      tagClass: 'suggestion-tag-review',
      title: '这些知识点掌握度偏低，先练几道基础题巩固一下',
      items: toReview,
    });
  }
  if (toRefresh.length > 0) {
    rows.push({
      tag: '及时温习',
      tagClass: 'suggestion-tag-refresh',
      title: '一段时间没碰了，回顾一下避免遗忘',
      items: toRefresh,
    });
  }
  if (challengeCandidate) {
    rows.push({
      tag: '可以挑战',
      tagClass: 'suggestion-tag-challenge',
      title: '掌握得不错，可以试试更难的题',
      items: [challengeCandidate],
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="card suggestion-card">
      <h2 className="card-title card-title-sm">💡 学习建议</h2>
      <div className="suggestion-rows">
        {rows.map((r) => (
          <div key={r.tag} className="suggestion-row">
            <span className={`suggestion-tag ${r.tagClass}`}>{r.tag}</span>
            <div className="suggestion-row-body">
              <div className="suggestion-row-title">{r.title}</div>
              <div className="suggestion-row-items">
                {r.items.map((it) => (
                  <span key={it.knowledge_id} className="suggestion-item" title={it.name}>
                    {leafName(it.name, 10)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ProfilePage: React.FC = () => {
  const [profileData, setProfileData] = useState(getMockProfileData());
  const [dataSource, setDataSource] = useState<'mock' | 'tauri'>('mock');

  useEffect(() => {
    let cancelled = false;
    // 优先尝试从 Tauri 后端拿真实数据；失败 / 浏览器模式 → mock
    studentModelService
      .getProfileOverview(STUDENT_ID)
      .then((real) => {
        if (cancelled) return;
        if (real && real.mastery_data && real.mastery_data.length > 0) {
          setProfileData(fromBackendOverview(real));
          setDataSource('tauri');
          console.info('[Profile] 使用真实后端数据');
        } else if (real) {
          // 后端有响应但 mastery 为空 → 学生还没做过题：显示空状态但用真实统计
          setProfileData((prev) => ({
            ...prev,
            totalAnswers: real.total_questions,
            correctCount: real.correct_count,
            accuracy: real.accuracy,
            learningDays: real.learning_days,
            totalDurationMinutes: real.total_duration_minutes,
            dailyStats: real.daily_stats.length > 0
              ? real.daily_stats.map((d) => ({
                  date: d.date.length >= 10 ? d.date.slice(5, 10) : d.date,
                  duration_minutes: d.duration_minutes,
                }))
              : prev.dailyStats,
          }));
          setDataSource('tauri');
          console.info('[Profile] 真实后端但暂无 mastery 数据，使用 mock mastery');
        } else {
          setProfileData(getMockProfileData());
          setDataSource('mock');
        }
      })
      .catch((e) => {
        console.warn('[Profile] 后端拉取失败，回退 mock:', e);
        if (!cancelled) setProfileData(getMockProfileData());
      });
    return () => { cancelled = true; };
  }, []);

  // === ECharts 雷达图配置 ===
  const radarOption = useMemo(() => {
    const data = profileData.masteryData.slice(0, 6);
    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: (p: { value: number[] }) =>
          p.value.map((v, i) => `${data[i].name}：${v}%`).join('<br/>'),
      },
      radar: {
        // 用叶子名称避免标签溢出/重叠，max 固定 100 方便对比
        indicator: data.map((d) => ({ name: leafName(d.name, 6), max: 100 })),
        radius: '62%',
        splitNumber: 4,
        axisName: {
          color: '#6B6B8D',
          fontSize: 11,
          // 悬浮时自动展示完整路径（echarts 不原生支持 indicator hover tooltip，
          // 但我们已经通过 series tooltip 覆盖了所有点位的完整信息）
          formatter: (value: string) => value,
        },
        nameGap: 8,
        splitLine: { lineStyle: { color: 'rgba(255, 140, 66, 0.15)' } },
        splitArea: { areaStyle: { color: ['rgba(255, 140, 66, 0.02)', 'rgba(255, 140, 66, 0.06)'] } },
        axisLine: { lineStyle: { color: 'rgba(255, 140, 66, 0.2)' } },
      },
      series: [
        {
          type: 'radar' as const,
          symbol: 'circle',
          symbolSize: 6,
          data: [
            {
              value: data.map((d) => Math.round(d.mastery_score * 100)),
              name: '掌握度',
              areaStyle: {
                color: {
                  type: 'radial' as const,
                  x: 0.5, y: 0.5, r: 0.7,
                  colorStops: [
                    { offset: 0, color: 'rgba(255, 140, 66, 0.45)' },
                    { offset: 1, color: 'rgba(84, 181, 255, 0.1)' },
                  ],
                },
              },
              lineStyle: { color: '#FF8C42', width: 2 },
              itemStyle: { color: '#FF8C42', borderColor: '#fff', borderWidth: 2 },
            },
          ],
        },
      ],
    };
  }, [profileData]);

  // === 掌握度分布折线（按练习量排序，高到低）===
  // 注意：这不是时间序列，而是"学得最多的 → 学得最少的"知识点掌握度分布。
  // 真正的时间序列需要 mastery_history 表，放到 V2。
  const trendOption = useMemo(() => {
    const sorted = [...profileData.masteryData].sort((a, b) => b.attempt_count - a.attempt_count);
    return {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: Array<{ dataIndex: number; value: number }>) => {
          const p = params[0];
          const item = sorted[p.dataIndex];
          return `${item.name}<br/>掌握度：${p.value}%<br/>练习：${item.attempt_count} 题`;
        },
      },
      grid: { left: 50, right: 20, top: 20, bottom: 72 },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((d) => leafName(d.name, 5)),
        axisLabel: {
          rotate: 45,
          fontSize: 10,
          color: '#6B6359',
          interval: 0,
          margin: 12,
        },
        axisLine: { lineStyle: { color: '#F0E5D6' } },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { formatter: '{value}%', color: '#6B6359' },
        splitLine: { lineStyle: { color: 'rgba(255, 140, 66, 0.08)' } },
      },
      series: [
        {
          type: 'line' as const,
          data: sorted.map((d) => Math.round(d.mastery_score * 100)),
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { color: '#FF8C42', width: 3 },
          itemStyle: { color: '#00B5C8', borderColor: '#fff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(255, 140, 66, 0.35)' },
                { offset: 1, color: 'rgba(255, 140, 66, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  }, [profileData]);

  // === 学习量柱状图（按知识点的练习次数）===
  // 0 值柱子用半透明灰色 + 虚线边框，一眼就能看出"没练过"
  const attemptOption = useMemo(() => {
    const sorted = [...profileData.masteryData]
      .sort((a, b) => b.attempt_count - a.attempt_count)
      .slice(0, 8);

    const unpracticedStyle = {
      color: 'rgba(180, 180, 180, 0.18)',
      borderColor: 'rgba(150, 150, 150, 0.55)',
      borderType: 'dashed' as const,
      borderWidth: 1,
      borderRadius: [4, 4, 0, 0],
    };
    const activeStyle = {
      color: {
        type: 'linear' as const,
        x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: '#FF8C42' },
          { offset: 1, color: '#00B5C8' },
        ],
      },
      borderRadius: [6, 6, 0, 0],
    };

    return {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: Array<{ dataIndex: number; value: number }>) => {
          const p = params[0];
          const item = sorted[p.dataIndex];
          const badge = p.value === 0 ? '（未练习）' : `${p.value} 道`;
          return `${item.name}<br/>练习题量：${badge}`;
        },
      },
      grid: { left: 40, right: 20, top: 20, bottom: 72 },
      xAxis: {
        type: 'category' as const,
        data: sorted.map((d) => leafName(d.name, 5)),
        axisLabel: {
          rotate: 45,
          fontSize: 10,
          color: '#6B6359',
          interval: 0,
          margin: 12,
        },
        axisLine: { lineStyle: { color: '#F0E5D6' } },
      },
      yAxis: {
        type: 'value' as const,
        minInterval: 1,
        axisLabel: { color: '#6B6359' },
        splitLine: { lineStyle: { color: 'rgba(255, 140, 66, 0.08)' } },
      },
      series: [
        {
          name: '练习题量',
          type: 'bar' as const,
          // 每个数据点带自己的 itemStyle，0 值走 unpracticed 样式
          data: sorted.map((d) => ({
            value: d.attempt_count,
            itemStyle: d.attempt_count === 0 ? unpracticedStyle : activeStyle,
          })),
          barWidth: '50%',
          // 给 0 值一个最小可见高度，避免完全看不见
          barMinHeight: 4,
        },
      ],
    };
  }, [profileData]);

  const { totalAnswers, accuracy, learningDays, totalDurationMinutes, dailyStats, masteryData } = profileData;
  const weakPoints = [...masteryData].sort((a, b) => a.mastery_score - b.mastery_score).slice(0, 5);
  const forgettingAlerts = masteryData.filter(m => m.forgetting_risk > 0.5);

  // 学习时间趋势柱状图（最近 7 天每日分钟数）
  const dailyDurationOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const, formatter: '{b}<br/>学习 {c} 分钟' },
    grid: { left: 50, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category' as const,
      data: dailyStats.map((d) => d.date),
      axisLabel: { fontSize: 11, color: '#6B6359' },
      axisLine: { lineStyle: { color: '#F0E5D6' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { formatter: '{value}\u00a0分', color: '#6B6359' },
      splitLine: { lineStyle: { color: 'rgba(255, 140, 66, 0.08)' } },
    },
    series: [{
      type: 'bar' as const,
      data: dailyStats.map((d) => d.duration_minutes),
      itemStyle: {
        color: {
          type: 'linear' as const,
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: '#FF8C42' },
            { offset: 1, color: '#FFA86A' },
          ],
        },
        borderRadius: [8, 8, 0, 0],
      },
      barWidth: '50%',
    }],
  }), [dailyStats]);

  // === Tab 定义 ===
  type TabKey = 'overview' | 'knowledge' | 'wrongbook' | 'profile';
  const TABS: Array<{ key: TabKey; label: string; emoji: string }> = [
    { key: 'overview', label: '学习概况', emoji: '📊' },
    { key: 'knowledge', label: '知识地图', emoji: '🎯' },
    { key: 'wrongbook', label: '错题本', emoji: '📕' },
    { key: 'profile', label: '我的档案', emoji: '🌈' },
  ];
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  return (
    <motion.div
      className="profile-page"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="page-title">
        👤 我的学习画像
        <span className={`profile-source-tag ${dataSource}`}>
          {dataSource === 'tauri' ? '✅ 实时数据' : '🧪 演示数据'}
        </span>
      </h1>

      {/* Tab 切换栏 */}
      <div className="profile-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`profile-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="profile-tab-emoji">{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <motion.div
        key={activeTab}
        className="profile-tab-content"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {/* Tab 1: 学习概况 */}
        {activeTab === 'overview' && (
          <>
            <div className="profile-stats-grid">
              <div className="profile-stat-card stat-primary">
                <div className="stat-number">{totalDurationMinutes}</div>
                <div className="stat-label">学习时长(分)</div>
              </div>
              <div className="profile-stat-card stat-success">
                <div className="stat-number">{totalAnswers}</div>
                <div className="stat-label">完成题目</div>
              </div>
              <div className="profile-stat-card stat-warning">
                <div className="stat-number">{(accuracy * 100).toFixed(0)}%</div>
                <div className="stat-label">正确率</div>
              </div>
              <div className="profile-stat-card stat-accent">
                <div className="stat-number">{learningDays}</div>
                <div className="stat-label">学习天数</div>
              </div>
            </div>

            <div className="card profile-time-trend-card">
              <h2 className="card-title">📈 学习时间趋势</h2>
              <ReactECharts option={dailyDurationOption} style={{ height: 240, width: '100%' }} />
            </div>
          </>
        )}

        {/* Tab 2: 知识地图 — 2x2 自适应网格 */}
        {activeTab === 'knowledge' && (
          <>
            {forgettingAlerts.length > 0 && (
              <div className="forget-banner">
                <span className="forget-banner-icon">⏰</span>
                <span className="forget-banner-label">遗忘预警</span>
                <div className="forget-banner-tags">
                  {forgettingAlerts.map((item) => (
                    <span key={item.knowledge_id} className="forget-banner-tag">
                      {item.name}
                      <span className="forget-banner-risk">{(item.forgetting_risk * 100).toFixed(0)}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="knowledge-grid">
              <div className="card knowledge-cell knowledge-cell-chart">
                <h2 className="card-title card-title-sm">📊 知识掌握雷达</h2>
                <ReactECharts option={radarOption} style={{ height: 260, width: '100%' }} />
              </div>

              <div className="card knowledge-cell">
                <h2 className="card-title card-title-sm">📉 需要加强的知识点</h2>
                <div className="weak-list weak-list-compact">
                  {weakPoints.slice(0, 5).map((item, idx) => {
                    const pct = Math.round(item.mastery_score * 100);
                    const tier =
                      item.mastery_score < 0.4 ? 'red'
                      : item.mastery_score < 0.7 ? 'yellow'
                      : 'green';
                    return (
                      <div
                        key={item.knowledge_id}
                        className="weak-item weak-item-compact"
                        title={item.name}
                      >
                        <span className="weak-rank">{idx + 1}</span>
                        <span className="weak-name">{leafName(item.name, 10)}</span>
                        <div className="weak-bar-wrapper">
                          <div
                            className="weak-bar"
                            style={{
                              width: `${pct}%`,
                              background:
                                tier === 'red' ? '#E55A6F'
                                : tier === 'yellow' ? '#F5A623'
                                : '#5BC97F',
                            }}
                          />
                        </div>
                        <span className={`weak-score weak-score-${tier}`}>{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card knowledge-cell knowledge-cell-chart">
                <h2 className="card-title card-title-sm">📈 掌握度分布</h2>
                <ReactECharts option={trendOption} style={{ height: 260, width: '100%' }} />
              </div>

              <div className="card knowledge-cell knowledge-cell-chart">
                <h2 className="card-title card-title-sm">📊 各知识点练习量</h2>
                <ReactECharts option={attemptOption} style={{ height: 260, width: '100%' }} />
              </div>
            </div>

            {/* 学习建议卡片 — 基于 masteryData 计算 */}
            <LearningSuggestionCard masteryData={masteryData} />
          </>
        )}

        {/* Tab 3: 错题本 */}
        {activeTab === 'wrongbook' && (
          <WrongAnswerBook studentId={STUDENT_ID} />
        )}

        {/* Tab 4: 我的档案（兴趣画像） */}
        {activeTab === 'profile' && (
          <InterestProfile studentId={STUDENT_ID} />
        )}
      </motion.div>
    </motion.div>
  );
};

export default ProfilePage;
