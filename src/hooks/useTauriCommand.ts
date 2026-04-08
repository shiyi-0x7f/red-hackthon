import { useState, useCallback } from 'react';

// 开发环境下判断是否在 Tauri 环境中
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

interface UseTauriCommandResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (...args: unknown[]) => Promise<T | null>;
}

/**
 * Tauri Command 调用 Hook
 * 
 * 自动处理 loading/error 状态
 * 在非 Tauri 环境（纯浏览器开发）下返回模拟数据
 */
export function useTauriCommand<T>(
  command: string,
  mockData?: T
): UseTauriCommandResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (...args: unknown[]): Promise<T | null> => {
    setLoading(true);
    setError(null);

    try {
      if (isTauri()) {
        // 真实 Tauri 环境
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<T>(command, args[0] as Record<string, unknown>);
        setData(result);
        return result;
      } else {
        // 浏览器开发模式 - 返回模拟数据
        console.log(`[Mock] invoke('${command}')`, args);
        await new Promise((resolve) => setTimeout(resolve, 300)); // 模拟延迟
        if (mockData !== undefined) {
          setData(mockData);
          return mockData;
        }
        return null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error(`Tauri Command 调用失败 [${command}]:`, message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [command, mockData]);

  return { data, loading, error, execute };
}
