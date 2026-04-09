/**
 * Tone.js 最小 ambient 声明 — 占位，让 TS 在 `npm install` 之前也能编译通过
 *
 * Gemini 部署时跑完 `npm install` 后，tone 包自带的完整 .d.ts 会覆盖这里的
 * 简化声明，不会冲突。
 */
declare module 'tone' {
  export function start(): Promise<void>;
  export function now(): number;

  export class Synth {
    constructor(options?: Record<string, unknown>);
  }

  export class PolySynth {
    constructor(synthClass?: typeof Synth, options?: Record<string, unknown>);
    toDestination(): this;
    triggerAttackRelease(
      notes: string | string[],
      duration: string | number,
      time?: number,
    ): this;
  }
}
