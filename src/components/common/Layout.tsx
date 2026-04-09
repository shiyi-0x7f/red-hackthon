import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  HomeOutlined,
  BookOutlined,
  RedoOutlined,
  CoffeeOutlined,
  UserOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  FireOutlined,
  StarOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  CheckOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../../stores/useAppStore';

const navItems = [
  { path: '/home', icon: <HomeOutlined />, label: '首页' },
  { path: '/learn', icon: <BookOutlined />, label: '学习' },
  { path: '/review', icon: <RedoOutlined />, label: '复习' },
  { path: '/rest', icon: <CoffeeOutlined />, label: '休息' },
  { path: '/profile', icon: <UserOutlined />, label: '我的' },
];

const bottomItems = [
  { path: '/settings', icon: <SettingOutlined />, label: '设置' },
  { path: '/parent', icon: <SafetyCertificateOutlined />, label: '家长' },
];

const Layout: React.FC = () => {
  const { currentStudentId, currentStudentName } = useAppStore();
  const [showIdCard, setShowIdCard] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 根据路径判断 greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return '早上好 ☀️';
    if (hour < 18) return '下午好 🌤️';
    return '晚上好 🌙';
  };

  // 点击外部关闭卡片
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setShowIdCard(false);
      }
    };
    if (showIdCard) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showIdCard]);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(currentStudentId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = currentStudentId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 名字首字
  const initial = (currentStudentName || '同学').charAt(0);

  return (
    <div className="app-layout">
      {/* 侧边栏 */}
      <aside className="app-sidebar">
        <div className="sidebar-logo">
          <img src="/images/logo_128.png" alt="学搭搭" className="sidebar-logo-img" />
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `sidebar-nav-item ${isActive ? 'active' : ''}`
              }
            >
              {item.icon}
              <span className="nav-tooltip">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          {bottomItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `sidebar-nav-item ${isActive ? 'active' : ''}`
              }
            >
              {item.icon}
              <span className="nav-tooltip">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </aside>

      {/* 主内容 */}
      <div className="app-main">
        {/* 顶部栏 */}
        <header className="app-topbar">
          <div className="topbar-left">
            <span className="topbar-greeting">{getGreeting()}</span>
          </div>

          <div className="topbar-right">
            <div className="gamification-stats">
              <div className="stat-badge streak">
                <FireOutlined className="stat-badge-icon" />
                <span>连续 3 天</span>
              </div>
              <div className="stat-badge xp">
                <ThunderboltOutlined className="stat-badge-icon" />
                <span>850 经验</span>
              </div>
              <div className="stat-badge stars">
                <StarOutlined className="stat-badge-icon" />
                <span>12 ⭐</span>
              </div>
            </div>

            {/* 用户头像 + ID 弹出卡片 */}
            <div className="user-avatar-wrapper" ref={cardRef}>
              <div
                className="user-avatar"
                id="user-avatar-btn"
                onClick={() => setShowIdCard(!showIdCard)}
                title="点击查看学生ID"
              >
                {initial}
              </div>

              {showIdCard && (
                <div className="user-id-card" id="user-id-card">
                  <div className="id-card-header">
                    <div className="id-card-avatar">{initial}</div>
                    <div className="id-card-info">
                      <div className="id-card-name">{currentStudentName || '同学'}</div>
                      <div className="id-card-grade">六年级</div>
                    </div>
                  </div>

                  <div className="id-card-divider" />

                  <div className="id-card-id-section">
                    <div className="id-card-label">
                      <LinkOutlined /> 学生ID
                    </div>
                    <div className="id-card-id-row">
                      <code className="id-card-id-value">{currentStudentId}</code>
                      <button
                        className={`id-card-copy-btn ${copied ? 'copied' : ''}`}
                        onClick={handleCopyId}
                        id="copy-student-id-btn"
                      >
                        {copied ? <><CheckOutlined /> 已复制</> : <><CopyOutlined /> 复制</>}
                      </button>
                    </div>
                  </div>

                  <div className="id-card-tip">
                    💡 在飞书机器人中输入 <code>/绑定 {currentStudentId}</code> 即可同步学习数据
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="app-content">
          <Outlet />
        </main>
      </div>

      {/* 背景装饰 */}
      <div className="bg-decoration top-right animate-float">✕</div>
      <div className="bg-decoration bottom-left animate-float" style={{ animationDelay: '1.5s' }}>÷</div>
    </div>
  );
};

export default Layout;
