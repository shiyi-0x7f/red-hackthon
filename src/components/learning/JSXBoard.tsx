import React, { useEffect, useRef } from 'react';
import JXG from 'jsxgraph';
import 'jsxgraph/distrib/jsxgraph.css';

/**
 * JSXGraph 元素描述（来自后端 LLM）
 *
 * kind 对应 JSXGraph 的 board.create() 第一个参数
 * args 对应第二个参数（数组）
 * attrs 对应第三个参数（对象）
 */
export interface JXGElement {
  kind: string;
  args: unknown[];
  attrs?: Record<string, unknown>;
}

export interface JSXBoardSpec {
  type: 'jsxgraph';
  title?: string;
  boundingBox?: [number, number, number, number];
  axis?: boolean;
  showCopyright?: boolean;
  elements: JXGElement[];
}

interface Props {
  spec: JSXBoardSpec;
  height?: number;
}

/** JSXGraph 渲染器（受控） */
const JSXBoard: React.FC<Props> = ({ spec, height = 320 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const boardIdRef = useRef(`jxg-board-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!containerRef.current) return;
    const boardId = boardIdRef.current;
    containerRef.current.id = boardId;

    let board: ReturnType<typeof JXG.JSXGraph.initBoard> | null = null;
    try {
      board = JXG.JSXGraph.initBoard(boardId, {
        boundingBox: spec.boundingBox ?? [-5, 5, 5, -5],
        axis: spec.axis ?? true,
        showCopyright: spec.showCopyright ?? false,
        showNavigation: false,
        keepAspectRatio: false,
        pan: { enabled: false, needTwoFingers: false, needShift: false },
      });

      // 把后端 elements 翻译为 board.create() 调用
      for (const el of spec.elements ?? []) {
        if (!el?.kind) continue;
        try {
          // JSXGraph 的 functiongraph 需要把字符串转为函数
          let parsedArgs: unknown[] = el.args ?? [];
          if (el.kind === 'functiongraph' && typeof parsedArgs[0] === 'string') {
            const expr = parsedArgs[0] as string;
            // eslint-disable-next-line no-new-func
            const fn = new Function('x', `with (Math) { return (${expr}); }`) as (x: number) => number;
            parsedArgs = [fn, ...parsedArgs.slice(1)];
          }
          board.create(el.kind as never, parsedArgs as never, (el.attrs ?? {}) as never);
        } catch (e) {
          console.warn('[JSXBoard] 元素创建失败', el, e);
        }
      }
    } catch (e) {
      console.error('[JSXBoard] 初始化失败', e);
    }

    return () => {
      if (board) {
        try {
          JXG.JSXGraph.freeBoard(board);
        } catch {
          /* ignore */
        }
      }
    };
  }, [spec]);

  return (
    <div className="jsx-board-wrap">
      {spec.title && <div className="jsx-board-title">{spec.title}</div>}
      <div
        ref={containerRef}
        className="jxgbox"
        style={{ width: '100%', height }}
      />
    </div>
  );
};

export default JSXBoard;
