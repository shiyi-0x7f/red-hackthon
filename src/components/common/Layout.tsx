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
  EditOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../../stores/useAppStore';

const STUDENT_NAME_STORAGE_KEY = 'ai_learning_student_name';
const NAME_LAST_CHANGED_KEY = 'name_last_changed';
const NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

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

/** 获取下次可改名日期的提示文案 */
function getNextChangeHint(): { canChange: boolean; hint: string } {
  const lastChanged = localStorage.getItem(NAME_LAST_CHANGED_KEY);
  if (!lastChanged) return { canChange: true, hint: '' };

  const lastTs = parseInt(lastChanged, 10);
  if (isNaN(lastTs)) return { canChange: true, hint: '' };

  const nextAllowed = lastTs + NAME_CHANGE_COOLDOWN_MS;
  const now = Date.now();

  if (now >= nextAllowed) return { canChange: true, hint: '' };

  const nextDate = new Date(nextAllowed);
  const month = nextDate.getMonth() + 1;
  const day = nextDate.getDate();
  return {
    canChange: false,
    hint: `下次可改：${month}月${day}日`,
  };
}

const Layout: React.FC = () => {
  const { currentStudentId, currentStudentName, currentGrade, setStudentName } = useAppStore();
  const [showIdCard, setShowIdCard] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 改名相关状态
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameChangeInfo, setNameChangeInfo] = useState(() => getNextChangeHint());
  const editInputRef = useRef<HTMLInputElement>(null);

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
        setIsEditing(false);
      }
    };
    if (showIdCard) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showIdCard]);

  // 编辑模式开启时自动聚焦
  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditing]);

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

  const handleStartEdit = () => {
    if (!nameChangeInfo.canChange) return;
    setEditName(currentStudentName || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditName('');
  };

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === currentStudentName) {
      handleCancelEdit();
      return;
    }
    if (trimmed.length > 12) {
      return; // 名字太长
    }

    // 更新 localStorage
    localStorage.setItem(STUDENT_NAME_STORAGE_KEY, trimmed);
    localStorage.setItem(NAME_LAST_CHANGED_KEY, String(Date.now()));

    // 更新 zustand store
    setStudentName(trimmed);

    // 刷新限制状态
    setNameChangeInfo(getNextChangeHint());
    setIsEditing(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // 名字首字
  const initial = (currentStudentName || '同学').charAt(0);

  // 年级展示
  const gradeText = currentGrade ? `${currentGrade}年级` : '六年级';

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
                      {isEditing ? (
                        <div className="id-card-name-edit">
                          <input
                            ref={editInputRef}
                            type="text"
                            className="id-card-name-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={handleNameKeyDown}
                            maxLength={12}
                            placeholder="输入新名字"
                          />
                          <div className="id-card-name-actions">
                            <button className="id-card-name-save" onClick={handleSaveName}>
                              <CheckOutlined /> 确认
                            </button>
                            <button className="id-card-name-cancel" onClick={handleCancelEdit}>
                              <CloseOutlined />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="id-card-name-row">
                          <div className="id-card-name">{currentStudentName || '同学'}</div>
                          <button
                            className={`id-card-edit-btn ${!nameChangeInfo.canChange ? 'disabled' : ''}`}
                            onClick={handleStartEdit}
                            disabled={!nameChangeInfo.canChange}
                            title={nameChangeInfo.canChange ? '修改名字（每月限改一次）' : nameChangeInfo.hint}
                          >
                            <EditOutlined />
                          </button>
                        </div>
                      )}
                      <div className="id-card-grade">{gradeText}</div>
                      {!nameChangeInfo.canChange && !isEditing && (
                        <div className="id-card-name-cooldown">{nameChangeInfo.hint}</div>
                      )}
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
