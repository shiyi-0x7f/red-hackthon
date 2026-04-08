import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/index.css';
import './styles/pages.css';

const antTheme = {
  token: {
    colorPrimary: '#FF8C42',
    colorSuccess: '#5BC97F',
    colorWarning: '#F5A623',
    colorError: '#E55A6F',
    colorInfo: '#00B5C8',
    borderRadius: 12,
    fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 14,
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#F7F5FF',
    colorBorder: '#E8E5F0',
    colorText: '#2D2B55',
    colorTextSecondary: '#6B6B8D',
  },
  components: {
    Button: {
      borderRadius: 12,
      controlHeight: 40,
    },
    Card: {
      borderRadiusLG: 20,
    },
    Input: {
      borderRadius: 12,
      controlHeight: 40,
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={antTheme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
