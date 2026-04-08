import React from 'react';

export interface FractionPart {
  label: string;
  value: number; // 0~1
  color?: string;
}

export interface FractionBarSpec {
  type: 'fraction-bar';
  title?: string;
  parts: FractionPart[];
}

interface Props {
  spec: FractionBarSpec;
}

const DEFAULT_COLORS = ['#7C5CFC', '#54B5FF', '#FF8A65', '#66BB6A', '#FFB74D'];

/** 分数 / 百分比可视化条 — 用于无需 JSXGraph 的简单题 */
const FractionBar: React.FC<Props> = ({ spec }) => {
  const total = Math.max(1, spec.parts.reduce((s, p) => s + Math.max(0, p.value), 0));
  return (
    <div className="fraction-bar-wrap">
      {spec.title && <div className="fraction-bar-title">{spec.title}</div>}
      <div className="fraction-bar-track">
        {spec.parts.map((p, i) => {
          const pct = (Math.max(0, p.value) / total) * 100;
          return (
            <div
              key={i}
              className="fraction-bar-segment"
              style={{
                width: `${pct}%`,
                background: p.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
              }}
              title={`${p.label} (${pct.toFixed(0)}%)`}
            >
              <span className="fraction-bar-label">{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FractionBar;
