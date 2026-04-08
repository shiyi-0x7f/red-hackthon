import React from 'react';
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
} from '@ant-design/icons';

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


  // 根据路径判断 greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return '早上好 ☀️';
    if (hour < 18) return '下午好 🌤️';
    return '晚上好 🌙';
  };

  return (
    <div className="app-layout">
      {/* 侧边栏 */}
      <aside className="app-sidebar">
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

            <div className="user-avatar">小明</div>
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
