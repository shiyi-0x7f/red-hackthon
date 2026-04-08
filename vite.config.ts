import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    // 监听所有网卡，开启局域网访问
    // 启动后会打印 Local + Network 两条地址，手机 / 其他设备可通过
    // http://<本机 IP>:1420 直接打开
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    // 显式关闭 HMR 限制，默认 HMR 也会走 host 和 port
    hmr: {
      host: "0.0.0.0",
    },
    watch: {
      // tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
