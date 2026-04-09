import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/useAppStore';

/** 服务端 API 状态信息 */
interface ServerStatus {
  provider: string;
  api_base: string;
  api_key_set: boolean;
  default_model: string;
  available_models: Array<{ id: string; name: string; tag: string }>;
}

const SettingsPage: React.FC = () => {
  const {
    currentStudentName,
    currentGrade,
    currentStudentId,
  } = useAppStore();

  const [maxDuration, setMaxDuration] = useState(30);
  const [studentName, setStudentName] = useState(currentStudentName);
  const [studentGrade, setStudentGrade] = useState(currentGrade);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeSection, setActiveSection] = useState('status');

  // 服务端状态
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    // 加载本地学习参数
    const saved = localStorage.getItem('app_settings');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.maxDuration) setMaxDuration(s.maxDuration);
      } catch { /* ignore */ }
    }

    // 加载服务端状态
    loadServerStatus();
  }, []);

  const loadServerStatus = async () => {
    setServerLoading(true);
    setServerError('');
    try {
      const { settingsService } = await import('../../services');
      const result = await settingsService.getSettings() as ServerStatus;
      setServerStatus(result);
    } catch (e) {
      setServerError('无法连接服务器');
      console.warn('[Settings] 获取服务端状态失败:', e);
    } finally {
      setServerLoading(false);
    }
  };

  const handleSave = async () => {
    localStorage.setItem('app_settings', JSON.stringify({ maxDuration }));
    setSaveMsg('设置已保存 ✓');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleClearData = async () => {
    if (!window.confirm('确定要清除所有学习数据吗？此操作不可撤销！')) return;

    try {
      const { learningService } = await import('../../services');
      const result = await learningService.clearStudentData(currentStudentId);
      if (result) {
        console.info('[清除数据] 后端删除行数:', result.total_deleted);
      }
    } catch (e) {
      console.warn('[清除数据] 后端调用失败:', e);
    }

    // 通知其他页面（如知识地图）刷新进度
    window.dispatchEvent(new CustomEvent('learning-data:cleared'));
    setSaveMsg('学习数据已清除');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const sections = [
    { key: 'status', icon: '📡', label: '服务状态' },
    { key: 'learning', icon: '📚', label: '学习参数' },
    { key: 'student', icon: '👤', label: '学生信息' },
    { key: 'data', icon: '🗂️', label: '数据管理' },
  ];

  return (
    <motion.div
      className="settings-page"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="settings-header">
        <h1 className="settings-title">⚙️ 设置</h1>
        <p className="settings-subtitle">自定义你的学习搭子</p>
      </div>

      <div className="settings-layout">
        {/* 左侧导航 */}
        <div className="settings-nav">
          {sections.map((s) => (
            <button
              key={s.key}
              className={`settings-nav-item ${activeSection === s.key ? 'active' : ''}`}
              onClick={() => setActiveSection(s.key)}
            >
              <span className="settings-nav-icon">{s.icon}</span>
              <span className="settings-nav-label">{s.label}</span>
            </button>
          ))}
        </div>

        {/* 右侧内容 */}
        <div className="settings-content">
          <AnimatePresence mode="wait">
            {activeSection === 'status' && (
              <motion.div key="status" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">服务状态</h2>
                <p className="section-desc">当前连接的 AI 学习服务器信息（由服务端统一配置）</p>

                {serverLoading && (
                  <div className="status-loading">
                    <span className="status-spinner">⏳</span> 正在连接服务器...
                  </div>
                )}

                {serverError && (
                  <div className="status-error">
                    <span className="status-icon">❌</span>
                    <div>
                      <div className="status-error-text">{serverError}</div>
                      <button className="btn-link" onClick={loadServerStatus}>重试连接</button>
                    </div>
                  </div>
                )}

                {serverStatus && !serverLoading && (
                  <div className="status-grid">
                    <div className="status-card">
                      <div className="status-card-label">连接状态</div>
                      <div className="status-card-value status-ok">
                        <span className="status-dot online"></span> 已连接
                      </div>
                    </div>
                    <div className="status-card">
                      <div className="status-card-label">AI 模型</div>
                      <div className="status-card-value">{serverStatus.default_model}</div>
                    </div>
                    <div className="status-card">
                      <div className="status-card-label">API Key</div>
                      <div className="status-card-value">
                        {serverStatus.api_key_set ? (
                          <span className="status-ok">✓ 已配置</span>
                        ) : (
                          <span className="status-warn">⚠ 未配置</span>
                        )}
                      </div>
                    </div>
                    <div className="status-card">
                      <div className="status-card-label">服务提供商</div>
                      <div className="status-card-value">{serverStatus.provider || 'SiliconFlow'}</div>
                    </div>
                  </div>
                )}

                {serverStatus && serverStatus.available_models && (
                  <div style={{ marginTop: 20 }}>
                    <h3 className="subsection-title">可用模型</h3>
                    <div className="model-grid">
                      {serverStatus.available_models.map((m) => (
                        <div
                          key={m.id}
                          className={`model-card ${serverStatus.default_model === m.id ? 'active' : ''}`}
                          style={{ cursor: 'default' }}
                        >
                          <div className="model-card-header">
                            <span className="model-name">{m.name}</span>
                            <span className={`model-tag tag-${m.tag === '推荐' ? 'primary' : m.tag === '通用' ? 'info' : 'success'}`}>{m.tag}</span>
                          </div>
                          <div className="model-card-id">{m.id}</div>
                          {serverStatus.default_model === m.id && (
                            <div className="model-check">✓ 当前使用</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeSection === 'learning' && (
              <motion.div key="learning" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">学习参数</h2>
                <p className="section-desc">调整学习节奏</p>
                <div className="form-group">
                  <label className="form-label">单次学习最大时长</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      className="form-slider"
                      min={10}
                      max={60}
                      step={5}
                      value={maxDuration}
                      onChange={(e) => setMaxDuration(Number(e.target.value))}
                    />
                    <span className="slider-value">{maxDuration} 分钟</span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'student' && (
              <motion.div key="student" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">学生信息</h2>
                <p className="section-desc">修改学生的基本信息</p>
                <div className="form-group">
                  <label className="form-label">姓名</label>
                  <input
                    type="text"
                    className="form-input"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">年级</label>
                  <div className="grade-selector">
                    {[1, 2, 3, 4, 5, 6].map((g) => (
                      <button
                        key={g}
                        className={`grade-btn ${studentGrade === g ? 'active' : ''}`}
                        onClick={() => setStudentGrade(g)}
                      >
                        {g}年级
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === 'data' && (
              <motion.div key="data" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">数据管理</h2>
                <p className="section-desc">管理你的学习数据</p>
                <div className="data-actions">
                  <div className="data-action-card warning">
                    <div className="data-action-icon">⚠️</div>
                    <div className="data-action-info">
                      <h3>清除学习记录</h3>
                      <p>删除所有答题记录、掌握度数据，恢复初始状态</p>
                    </div>
                    <button className="btn-danger" onClick={handleClearData}>清除数据</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 保存按钮 */}
          <div className="settings-footer">
            {saveMsg && <span className="save-message">{saveMsg}</span>}
            <button className="btn-primary" onClick={handleSave}>保存设置</button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default SettingsPage;
