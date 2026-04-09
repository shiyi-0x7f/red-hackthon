import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';

const SettingsPage: React.FC = () => {
  const {
    currentStudentName,
    currentGrade,
    currentStudentId,
  } = useAppStore();
  const navigate = useNavigate();

  return (
    <motion.div
      className="settings-page"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="settings-header">
        <h1 className="settings-title">⚙️ 设置</h1>
        <p className="settings-subtitle">你的学搭搭信息</p>
      </div>

      <div className="settings-content">
        {/* 应用信息 */}
        <div className="settings-section">
          <h2 className="section-title">📱 关于学搭搭</h2>
          <p className="section-desc">AI 驱动的个性化数学学习伙伴</p>

          <div className="settings-info-grid">
            <div className="settings-info-card">
              <div className="settings-info-icon">🎓</div>
              <div className="settings-info-body">
                <div className="settings-info-label">当前身份</div>
                <div className="settings-info-value">{currentStudentName || '同学'}</div>
              </div>
            </div>

            <div className="settings-info-card">
              <div className="settings-info-icon">📚</div>
              <div className="settings-info-body">
                <div className="settings-info-label">年级</div>
                <div className="settings-info-value">{currentGrade}年级</div>
              </div>
            </div>

            <div className="settings-info-card">
              <div className="settings-info-icon">🔑</div>
              <div className="settings-info-body">
                <div className="settings-info-label">学生ID</div>
                <div className="settings-info-value" style={{ fontFamily: "'Consolas', monospace", fontSize: 12 }}>
                  {currentStudentId.slice(0, 16)}…
                </div>
              </div>
            </div>

            <div className="settings-info-card">
              <div className="settings-info-icon">✨</div>
              <div className="settings-info-body">
                <div className="settings-info-label">版本</div>
                <div className="settings-info-value">v1.0.0</div>
              </div>
            </div>
          </div>

          <div className="settings-tips">
            <div className="settings-tip-item">
              💡 <strong>修改名字</strong>：点击右上角头像即可修改（每月限改一次）
            </div>
            <div className="settings-tip-item">
              🔧 <strong>修改年级、清除数据</strong>等高级设置需要进入家长模式
            </div>
          </div>

          <button
            className="btn-primary settings-parent-btn"
            onClick={() => navigate('/parent')}
          >
            🔒 进入家长设置
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default SettingsPage;
