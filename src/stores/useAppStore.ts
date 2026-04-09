import { create } from 'zustand';
import { getStudentId, getStudentName } from '../services';

interface AppState {
  /** 当前学生 ID（每个浏览器独立，lazy 生成 + localStorage 持久化） */
  currentStudentId: string;
  /** 当前学生姓名 */
  currentStudentName: string;
  /** 当前学生年级 */
  currentGrade: number;
  /** 是否已验证家长密码 */
  isParentVerified: boolean;
  /** 当前选择的 LLM 模型 */
  selectedModel: string;

  // Actions
  setCurrentStudent: (id: string, name: string, grade: number) => void;
  setParentVerified: (verified: boolean) => void;
  setSelectedModel: (model: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // 从 services.getStudentId() 初始化 — 首次访问自动生成并写入 localStorage
  currentStudentId: getStudentId(),
  currentStudentName: getStudentName(),
  currentGrade: 6,
  isParentVerified: false,
  selectedModel: 'deepseek-ai/DeepSeek-V3',

  setCurrentStudent: (id, name, grade) =>
    set({ currentStudentId: id, currentStudentName: name, currentGrade: grade }),

  setParentVerified: (verified) =>
    set({ isParentVerified: verified }),

  setSelectedModel: (model) =>
    set({ selectedModel: model }),
}));
