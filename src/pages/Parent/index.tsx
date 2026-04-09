import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ParentRealtimePanel from '../../components/learning/ParentRealtimePanel';
import InterestProfile from '../../components/learning/InterestProfile';
import { useAppStore } from '../../stores/useAppStore';
import '../../styles/learning-extras.css';

/** 服务端 API 状态信息 */
interface ServerStatus {
  provider: string;
  api_base: string;
  api_key_set: boolean;
  default_model: string;
  available_models: Array<{ id: string; name: string; tag: string }>;
}

type ParentTab = 'behavior' | 'learning' | 'student' | 'status' | 'data';

const TABS: Array<{ key: ParentTab; label: string; emoji: string }> = [
  { key: 'behavior', label: '学习行为', emoji: '🧠' },
  { key: 'learning', label: '学习参数', emoji: '📚' },
  { key: 'student', label: '学生信息', emoji: '👤' },
  { key: 'status', label: '服务状态', emoji: '📡' },
  { key: 'data', label: '数据管理', emoji: '🗂️' },
];

const ParentPage: React.FC = () => {
  const {
    currentStudentId: studentId,
    currentStudentName,
    currentGrade,
    setCurrentStudent,
  } = useAppStore();

  const [isVerified, setIsVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ParentTab>('behavior');

  // 学习参数
  const [maxDuration, setMaxDuration] = useState(30);
  const [studentGrade, setStudentGrade] = useState(currentGrade);
  const [saveMsg, setSaveMsg] = useState('');

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
  }, []);

  const handleVerify = () => {
    if (password === '123456') {
      setIsVerified(true);
      setError('');
    } else {
      setError('密码不正确，请重试');
    }
  };

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

    // 如果年级有变化，更新 store
    if (studentGrade !== currentGrade) {
      setCurrentStudent(studentId, currentStudentName, studentGrade);
    }

    setSaveMsg('设置已保存 ✓');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleClearData = async () => {
    if (!window.confirm('确定要清除所有学习数据吗？此操作不可撤销！')) return;

    try {
      const { learningService } = await import('../../services');
      const result = await learningService.clearStudentData(studentId);
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

  // === 密码验证页 ===
  if (!isVerified) {
    return (
      <motion.div
        className="parent-page parent-login"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="parent-lock-card">
          <div className="lock-icon">🔒</div>
          <h1 className="lock-title">家长空间</h1>
          <p className="lock-desc">请输入密码，管理孩子的学习设置</p>

          <div className="lock-form">
            <input
              type="password"
              className="form-input lock-input"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
            {error && <div className="lock-error">{error}</div>}
            <button className="btn-primary lock-btn" onClick={handleVerify}>进入</button>
          </div>
          <p className="lock-hint">默认密码：123456</p>
        </div>
      </motion.div>
    );
  }

  // === 家长控制面板 ===
  return (
    <motion.div
      className="parent-page parent-dashboard"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="parent-header">
        <div>
          <h1 className="page-title">🔧 家长控制中心</h1>
          <p className="page-subtitle">
            管理学习参数、学生信息和服务状态
          </p>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="parent-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`parent-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(tab.key);
              if (tab.key === 'status' && !serverStatus) {
                loadServerStatus();
              }
            }}
          >
            <span className="parent-tab-emoji">{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <AnimatePresence mode="wait">
        {/* Tab 1: 学习行为 */}
        {activeTab === 'behavior' && (
          <motion.div key="behavior" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            {/* 兴趣画像（readonly，让家长了解孩子兴趣背景）*/}
            <InterestProfile studentId={studentId} readonly />

            {/* 6 层实时画像（含敏感行为/状态指标，仅家长可见）*/}
            <ParentRealtimePanel studentId={studentId} />
          </motion.div>
        )}

        {/* Tab 2: 学习参数 */}
        {activeTab === 'learning' && (
          <motion.div key="learning" className="parent-section-card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="section-title">📚 学习参数</h2>
            <p className="section-desc">调整孩子的学习节奏</p>
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

            <div className="settings-footer">
              {saveMsg && <span className="save-message">{saveMsg}</span>}
              <button className="btn-primary" onClick={handleSave}>保存设置</button>
            </div>
          </motion.div>
        )}

        {/* Tab 3: 学生信息 */}
        {activeTab === 'student' && (
          <motion.div key="student" className="parent-section-card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="section-title">👤 学生信息</h2>
            <p className="section-desc">管理学生的基本信息</p>

            <div className="form-group">
              <label className="form-label">姓名</label>
              <div className="form-value">{currentStudentName || '同学'}</div>
              <span className="form-hint">💡 名字请在右上角头像处修改（每月限改一次）</span>
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

            <div className="settings-footer">
              {saveMsg && <span className="save-message">{saveMsg}</span>}
              <button className="btn-primary" onClick={handleSave}>保存设置</button>
            </div>
          </motion.div>
        )}

        {/* Tab 4: 服务状态 */}
        {activeTab === 'status' && (
          <motion.div key="status" className="parent-section-card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="section-title">📡 服务状态</h2>
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

        {/* Tab 5: 数据管理 */}
        {activeTab === 'data' && (
          <motion.div key="data" className="parent-section-card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="section-title">🗂️ 数据管理</h2>
            <p className="section-desc">管理孩子的学习数据</p>
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
            {saveMsg && <div style={{ marginTop: 16 }}><span className="save-message">{saveMsg}</span></div>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 退出 */}
      <div className="parent-footer">
        <button className="btn-secondary" onClick={() => setIsVerified(false)}>退出家长模式 🔒</button>
      </div>
    </motion.div>
  );
};

export default ParentPage;
