/**
 * 答题音效 — 关卡式「根音 + 性格」协议
 *
 * 设计思路：
 * - 每一题对应一个根音（C / D / E / F / G），随题目进度向上递进，给学生"往高处走"的成就感
 * - 答对：Major 三和弦（安定感）
 * - 答错：Sus4 三和弦（紧张感，期待解决）
 * - "解决反馈"：如果用户在同一题上答错后又答对，会自然听到 Sus4 → Major 的解决进行
 *
 * 注意：
 * - 根音由调用方传入 `questionIndex`（0~4，超出则取模循环）决定，根音只随题目前进而变化
 * - 在同一题内重复答错/答对不会改变根音，完美支持"错 → 对"的解决听感
 * - 用 Tone.PolySynth + 钢琴化 envelope，攻击快、衰减短，听起来干脆
 * - Tone.js 要求第一次播放必须在用户手势后（autoplay policy），所以
 *   `ensureAudioReady()` 封装了 `Tone.start()`
 */
import * as Tone from 'tone';

/** 5 个级别的根音，对应前 5 题 */
const ROOTS = ['C4', 'D4', 'E4', 'F4', 'G4'] as const;

/** 每个根音的 Major 三和弦（根 + 大三度 + 纯五度） */
const MAJOR_CHORDS: Record<typeof ROOTS[number], string[]> = {
  C4: ['C4', 'E4', 'G4'],
  D4: ['D4', 'F#4', 'A4'],
  E4: ['E4', 'G#4', 'B4'],
  F4: ['F4', 'A4', 'C5'],
  G4: ['G4', 'B4', 'D5'],
};

/** 每个根音的 Sus4 三和弦（根 + 纯四度 + 纯五度） */
const SUS4_CHORDS: Record<typeof ROOTS[number], string[]> = {
  C4: ['C4', 'F4', 'G4'],
  D4: ['D4', 'G4', 'A4'],
  E4: ['E4', 'A4', 'B4'],
  // F4 的 sus4 是 Bb，在 Tone.js 里用 A#4 表示
  F4: ['F4', 'A#4', 'C5'],
  G4: ['G4', 'C5', 'D5'],
};

let synth: Tone.PolySynth | null = null;
let ready = false;

/**
 * 首次播放前必须在用户手势回调里调用一次（例如点击"开始答题"按钮）
 *
 * 因为浏览器的 Autoplay Policy，AudioContext 默认是 suspended 状态，
 * 必须经过一次用户交互触发 `Tone.start()` 才能发声。
 */
export async function ensureAudioReady(): Promise<void> {
  if (ready) return;
  try {
    await Tone.start();
  } catch (e) {
    // 某些浏览器在非用户手势里调会抛错，直接忽略；下次用户手势时会再次尝试
    console.warn('[audio] Tone.start() 失败（可能在非用户手势里调用），延后重试:', e);
    return;
  }

  // 钢琴化的 envelope：攻击极快、衰减中等、释放稍长留余韵
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle8' },
    envelope: {
      attack: 0.005,
      decay: 0.25,
      sustain: 0.2,
      release: 1.1,
    },
    volume: -8,
  }).toDestination();

  ready = true;
}

/** 内部统一的和弦播放函数 */
function playChord(notes: string[], duration = '0.9s'): void {
  if (!synth) return;
  try {
    synth.triggerAttackRelease(notes, duration, Tone.now());
  } catch (e) {
    console.warn('[audio] 播放失败:', e);
  }
}

function pickRoot(questionIndex: number): typeof ROOTS[number] {
  const i = Math.max(0, questionIndex) % ROOTS.length;
  return ROOTS[i];
}

/**
 * 答对时播放当前根音的 Major 三和弦
 *
 * @param questionIndex 当前题目的 0-based 索引，决定根音
 */
export function playCorrect(questionIndex: number): void {
  if (!ready) {
    // 异步补一次 init，这次不播放；下一题再响
    void ensureAudioReady();
    return;
  }
  const root = pickRoot(questionIndex);
  playChord(MAJOR_CHORDS[root]);
}

/**
 * 答错时播放当前根音的 Sus4 三和弦
 *
 * @param questionIndex 当前题目的 0-based 索引，决定根音
 */
export function playWrong(questionIndex: number): void {
  if (!ready) {
    void ensureAudioReady();
    return;
  }
  const root = pickRoot(questionIndex);
  playChord(SUS4_CHORDS[root]);
}
