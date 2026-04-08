import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  StarFilled,
  StarOutlined,
  LockOutlined,
  CheckCircleFilled,
  RightOutlined,
  TrophyFilled,
  EnvironmentFilled,
  FlagFilled,
} from '@ant-design/icons';
import '../../styles/learn-map.css';

interface RawKnowledgeUnit {
  单元: string;
  知识点: string[];
}
interface RawKnowledgeMap {
  学期: Record<string, RawKnowledgeUnit[]>;
}

/* ========================================
   类型 & 配置
   ======================================== */

interface MapNode {
  id: string;
  name: string;
  stars: number;
  status: 'locked' | 'available' | 'current' | 'completed';
  attempts: number;
}

interface MapUnit {
  id: string;
  name: string;
  theme: string;
  emoji: string;
  landscape: string;
  nodes: MapNode[];
}

const UNIT_CFGS = [
  { theme: '#FF8C42', emoji: '🏔️', landscape: '分数山脉' },
  { theme: '#00B5C8', emoji: '🧭', landscape: '方向海湾' },
  { theme: '#E55A6F', emoji: '🌋', landscape: '除法火山' },
  { theme: '#5BC97F', emoji: '⚖️', landscape: '比例绿洲' },
  { theme: '#F5A623', emoji: '🔮', landscape: '圆形秘境' },
  { theme: '#E07AFF', emoji: '💎', landscape: '百分水晶洞' },
  { theme: '#FF8C42', emoji: '🗺️', landscape: '统计沙漠' },
  { theme: '#66BB6A', emoji: '🌿', landscape: '数形森林' },
  { theme: '#78909C', emoji: '❄️', landscape: '负数冰原' },
  { theme: '#9B7BD0', emoji: '🏦', landscape: '百分城堡' },
  { theme: '#26A69A', emoji: '🏛️', landscape: '立体神殿' },
  { theme: '#5C6BC0', emoji: '📐', landscape: '比例迷宫' },
  { theme: '#EC407A', emoji: '🐦', landscape: '鸽巢密林' },
  { theme: '#FFD54F', emoji: '🏆', landscape: '终极殿堂' },
];

/**
 * 从知识图谱 JSON 构造单元：每个知识点 = 一个节点
 *
 * 点击节点 → 打开详情 → "开始闯关" 跳转到
 *   /practice/{unit}?kp={kp}
 * Practice 页读取 kp 参数后：
 *   - 从基础题库拉该单元的题（规则筛选）
 *   - 若 API Key 可用，追加 1~2 道 AI 按学生兴趣生成的题
 *
 * 节点状态（演示用）：前 N 完成、第 N+1 当前、第 N+2 可用，其余 locked
 */
function buildUnitsFromKnowledgeMap(km: RawKnowledgeMap): MapUnit[] {
  const units: MapUnit[] = [];
  let nodeCounter = 0;
  const COMPLETED_TOTAL = 10;
  const CURRENT_INDEX = 10;
  const AVAILABLE_INDEX = 11;

  let unitIdx = 0;
  for (const semesterName of ['上册', '下册']) {
    const semUnits = km.学期[semesterName] || [];
    for (const u of semUnits) {
      const cfg = UNIT_CFGS[unitIdx % UNIT_CFGS.length];
      const nodes: MapNode[] = u.知识点.map((kp, ki) => {
        const globalIdx = nodeCounter++;
        let status: MapNode['status'] = 'locked';
        let stars = 0, attempts = 0;
        if (globalIdx < COMPLETED_TOTAL) {
          status = 'completed';
          stars = globalIdx < 4 ? 3 : globalIdx < 8 ? 2 : 1;
          attempts = 2 + Math.floor(Math.random() * 8);
        } else if (globalIdx === CURRENT_INDEX) {
          status = 'current';
          attempts = 1;
        } else if (globalIdx === AVAILABLE_INDEX) {
          status = 'available';
        }
        return {
          id: `k${unitIdx + 1}-${ki + 1}`,
          name: kp,
          stars,
          status,
          attempts,
        };
      });
      units.push({
        id: `u${unitIdx + 1}`,
        name: u.单元,
        ...cfg,
        nodes,
      });
      unitIdx++;
    }
  }
  return units;
}

const PER_ROW = 4;

/* ========================================
   小组件
   ======================================== */

const Stars: React.FC<{ count: number; size?: number }> = ({ count, size = 13 }) => (
  <div className="map-stars">
    {[1, 2, 3].map(i => (
      <span key={i} className={`map-star ${i <= count ? 'filled' : ''}`}>
        {i <= count ? <StarFilled style={{ fontSize: size, color: '#F5A623' }} /> : <StarOutlined style={{ fontSize: size, color: '#D9D9D9' }} />}
      </span>
    ))}
  </div>
);

function nodeClass(n: MapNode) {
  if (n.status === 'locked') return 'node-locked';
  if (n.status === 'available') return 'node-available';
  if (n.status === 'current') return 'node-current';
  if (n.stars >= 3) return 'node-gold';
  if (n.stars >= 2) return 'node-silver';
  return 'node-bronze';
}

function nodeEmoji(n: MapNode) {
  if (n.status === 'locked') return '';
  if (n.status === 'available') return '❓';
  if (n.status === 'current') return '📍';
  if (n.stars >= 3) return '👑';
  if (n.stars >= 2) return '✅';
  return '📖';
}

function unitMedal(nodes: MapNode[]): string | null {
  if (!nodes.every(n => n.status === 'completed')) return null;
  const min = Math.min(...nodes.map(n => n.stars));
  return min >= 3 ? '🥇' : min >= 2 ? '🥈' : min >= 1 ? '🥉' : null;
}

/* ========================================
   节点
   ======================================== */

const Node: React.FC<{
  node: MapNode; theme: string; delay: number;
  onClick: () => void;
}> = ({ node, theme, delay, onClick }) => {
  const locked = node.status === 'locked';
  const current = node.status === 'current';
  const gold = node.status === 'completed' && node.stars >= 3;

  return (
    <motion.div
      className={`path-node ${node.status}`}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.35, type: 'spring', stiffness: 220 }}
      onClick={() => !locked && onClick()}
    >
      {current && (
        <>
          <div className="current-ring ring-1" style={{ borderColor: theme }} />
          <div className="current-ring ring-2" style={{ borderColor: theme }} />
        </>
      )}

      <div
        className={`path-node-circle ${nodeClass(node)}`}
        style={node.status === 'available' || node.status === 'current' ? { borderColor: theme } : undefined}
      >
        {locked
          ? <LockOutlined className="node-icon locked" />
          : <span className="node-icon-text">{nodeEmoji(node)}</span>
        }
        {node.status === 'completed' && (
          <div className="node-badge-check" style={{ background: node.stars >= 3 ? '#FFD700' : node.stars >= 2 ? '#B0B0C0' : '#CD7F32' }}>
            <CheckCircleFilled style={{ fontSize: 9, color: '#fff' }} />
          </div>
        )}
        {gold && <><span className="sparkle" /><span className="sparkle" /><span className="sparkle" /></>}
      </div>

      <div className={`path-node-label ${locked ? 'locked' : ''}`}>
        <span className="path-node-name">{node.name}</span>
        {!locked && <Stars count={node.stars} size={10} />}
      </div>

      {current && (
        <motion.div className="current-flag" style={{ color: theme }}
          animate={{ y: [0, -3, 0] }} transition={{ duration: 1.5, repeat: Infinity }}>
          <FlagFilled /> 当前
        </motion.div>
      )}
    </motion.div>
  );
};

/* ========================================
   蜿蜒行 (S 形布局)
   ======================================== */

const WindingNodes: React.FC<{
  unit: MapUnit; unitIdx: number;
  onNodeClick: (n: MapNode) => void;
}> = ({ unit, unitIdx, onNodeClick }) => {
  // 分行
  const rows: MapNode[][] = [];
  for (let i = 0; i < unit.nodes.length; i += PER_ROW) rows.push(unit.nodes.slice(i, i + PER_ROW));

  const isDone = (i: number) => {
    const n = unit.nodes[i];
    return n && (n.status === 'completed' || n.status === 'current');
  };

  return (
    <div className="unit-nodes">
      {rows.map((row, ri) => {
        const reversed = ri % 2 === 1;
        const display = reversed ? [...row].reverse() : row;
        const baseIdx = ri * PER_ROW;
        // 行对齐: 奇数行→左 偶数行→右，蛇形
        const align = ri % 2 === 0 ? 'row-left' : 'row-right';

        return (
          <React.Fragment key={ri}>
            {/* 垂直转弯 */}
            {ri > 0 && (
              <div className={`path-turn ${reversed ? 'align-right' : 'align-left'}`}>
                <div
                  className={`turn-line ${isDone(baseIdx) ? 'line-done' : 'line-undone'}`}
                  style={isDone(baseIdx) ? { background: unit.theme } : undefined}
                />
              </div>
            )}

            {/* 节点行 */}
            <div className={`path-row ${align}`}>
              {display.map((node, ni) => {
                const actualI = reversed ? baseIdx + (row.length - 1 - ni) : baseIdx + ni;
                const showLink = ni > 0;
                const prevI = reversed ? actualI + 1 : actualI - 1;
                const linkDone = isDone(prevI);

                return (
                  <React.Fragment key={node.id}>
                    {showLink && (
                      <div
                        className={`path-link ${linkDone ? 'link-done' : 'link-undone'}`}
                        style={linkDone ? { background: unit.theme } : undefined}
                      />
                    )}
                    <Node node={node} theme={unit.theme} delay={unitIdx * 0.05 + actualI * 0.025} onClick={() => onNodeClick(node)} />
                  </React.Fragment>
                );
              })}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

/* ========================================
   详情弹窗
   ======================================== */

const Detail: React.FC<{ node: MapNode; theme: string; unitName: string; onClose: () => void }> = ({ node, theme, unitName, onClose }) => {
  const navigate = useNavigate();
  return (
  <motion.div className="node-detail-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.div className="node-detail-card"
      initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }} onClick={e => e.stopPropagation()}>

      <div className="detail-header" style={{ background: `linear-gradient(135deg, ${theme}, ${theme}BB)` }}>
        <div className="detail-emoji">{node.stars >= 3 ? '👑' : node.status === 'completed' ? '✅' : '📖'}</div>
        <h3 className="detail-title">{node.name}</h3>
        <Stars count={node.stars} size={22} />
      </div>

      <div className="detail-body">
        <div className="detail-stats">
          <div className="detail-stat"><span className="detail-stat-value">{node.attempts}</span><span className="detail-stat-label">练习次数</span></div>
          <div className="detail-stat"><span className="detail-stat-value">{node.stars}/3</span><span className="detail-stat-label">星级</span></div>
          <div className="detail-stat"><span className="detail-stat-value">{node.stars >= 3 ? '精通' : node.stars >= 2 ? '熟练' : node.stars >= 1 ? '入门' : '未开始'}</span><span className="detail-stat-label">掌握度</span></div>
        </div>

        <div className="detail-star-guide">
          {[{ s: 1, l: '🥉', d: '入门 — 基础题正确率 ≥ 60%' }, { s: 2, l: '🥈', d: '熟练 — 中等题正确率 ≥ 70%' }, { s: 3, l: '🥇', d: '精通 — 困难题正确率 ≥ 80%' }].map(g => (
            <div key={g.s} className={`star-guide-row ${node.stars >= g.s ? 'achieved' : ''}`}><span>{g.l}</span><span className="star-guide-desc">{g.d}</span></div>
          ))}
        </div>

        <button className="detail-start-btn" style={{ background: `linear-gradient(135deg, ${theme}, ${theme}BB)` }} onClick={() => { navigate(`/practice/${encodeURIComponent(unitName)}?kp=${encodeURIComponent(node.name)}`); onClose(); }}>
          {node.status === 'completed' ? '🔄 再次挑战' : '🚀 开始闯关'} <RightOutlined />
        </button>
      </div>
    </motion.div>
  </motion.div>
  );
};

/* ========================================
   主页面
   ======================================== */

const LearnPage: React.FC = () => {
  const [sel, setSel] = useState<{ node: MapNode; theme: string; unitName: string } | null>(null);
  const [sem, setSem] = useState<'上册' | '下册'>('上册');
  const [allUnits, setAllUnits] = useState<MapUnit[]>([]);
  const [loading, setLoading] = useState(true);

  // 加载真实知识图谱（JSON 里是单元 → 知识点列表）
  useEffect(() => {
    let cancelled = false;
    fetch('/data/grade6_math_knowledge_map.json')
      .then((r) => r.json() as Promise<RawKnowledgeMap>)
      .then((km) => {
        if (cancelled) return;
        setAllUnits(buildUnitsFromKnowledgeMap(km));
      })
      .catch((e) => console.error('[Learn] 知识图谱加载失败:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 按学期分流：前 8 单元 = 上册，其余下册
  const upper = allUnits.slice(0, 8);
  const lower = allUnits.slice(8);
  const units = sem === '上册' ? upper : lower;

  useEffect(() => {
    if (loading) return;
    setTimeout(() => {
      document.querySelector('.path-node.current')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 800);
  }, [loading]);

  const totalStars = allUnits.reduce((s, u) => s + u.nodes.reduce((a, n) => a + n.stars, 0), 0);
  const maxStars = allUnits.reduce((s, u) => s + u.nodes.length * 3, 0);

  if (loading) {
    return (
      <div className="learn-map-page">
        <div className="map-loading">📚 正在加载知识地图...</div>
      </div>
    );
  }

  return (
    <div className="learn-map-page">
      <motion.div className="map-header" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="map-header-left">
          <h1 className="map-title"><EnvironmentFilled style={{ color: 'var(--color-primary)', marginRight: 8 }} />知识探索地图</h1>
          <p className="map-subtitle">六年级 · 人教版数学</p>
        </div>
        <div className="map-header-right">
          <div className="semester-switch">
            {(['上册', '下册'] as const).map(s => (
              <button key={s} className={`semester-btn ${sem === s ? 'active' : ''}`} onClick={() => setSem(s)}>{s}</button>
            ))}
          </div>
          <div className="total-stars-badge">
            <TrophyFilled style={{ fontSize: 16, color: '#F5A623' }} />
            <span className="total-stars-count">{totalStars}</span>
            <span className="total-stars-max">/ {maxStars}</span>
          </div>
        </div>
      </motion.div>

      <div className="map-scroll-area">
        <div className="map-trail">
          {units.map((unit, idx) => {
            const allLocked = unit.nodes.every(n => n.status === 'locked');
            const uStars = unit.nodes.reduce((s, n) => s + n.stars, 0);
            const uMax = unit.nodes.length * 3;
            const medal = unitMedal(unit.nodes);

            return (
              <motion.div key={unit.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.08 }}>
                {/* 里程碑路牌 */}
                <div className="unit-signpost">
                  <div className="signpost-card" style={{
                    background: allLocked
                      ? 'linear-gradient(135deg, #C5C2D0, #B0ADBE)'
                      : `linear-gradient(135deg, ${unit.theme}, ${unit.theme}DD)`,
                  }}>
                    <span className="signpost-emoji">{unit.emoji}</span>
                    <div className="signpost-info">
                      <div className="signpost-name">{unit.name}</div>
                      <div className="signpost-landscape">{unit.landscape}</div>
                    </div>
                    {medal && <span className="signpost-medal">{medal}</span>}
                    <div className="signpost-stars">
                      <StarFilled style={{ fontSize: 11, color: allLocked ? '#B0ADBE' : '#FFE082' }} />
                      <span>{uStars}/{uMax}</span>
                    </div>
                  </div>
                </div>

                {/* 节点路径 */}
                <WindingNodes unit={unit} unitIdx={idx} onNodeClick={n => setSel({ node: n, theme: unit.theme, unitName: unit.name })} />
              </motion.div>
            );
          })}

          <motion.div className="map-finish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
            <div className="finish-flag">🏁</div>
            <div className="finish-text">{sem === '上册' ? '上册学完，继续下册冒险！' : '恭喜完成数学之旅！'}</div>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {sel && <Detail node={sel.node} theme={sel.theme} unitName={sel.unitName} onClose={() => setSel(null)} />}
      </AnimatePresence>
    </div>
  );
};

export default LearnPage;
