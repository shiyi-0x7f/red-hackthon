import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/useAppStore';

interface ModelOption {
  id: string;
  name: string;
  tag: string;
}

const availableModels: ModelOption[] = [
  { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', tag: '推荐' },
  { id: 'Qwen/Qwen2.5-72B-Instruct', name: '通义千问 72B', tag: '通用' },
  { id: 'THUDM/glm-4-9b-chat', name: 'GLM-4 9B', tag: '轻量' },
];

const SettingsPage: React.FC = () => {
  const { selectedModel, setSelectedModel, currentStudentName, currentGrade } = useAppStore();

  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [maxDuration, setMaxDuration] = useState(30);
  const [maxChat, setMaxChat] = useState(20);
  const [studentName, setStudentName] = useState(currentStudentName);
  const [studentGrade, setStudentGrade] = useState(currentGrade);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeSection, setActiveSection] = useState('model');

  useEffect(() => {
    // 尝试从 localStorage 加载设置
    const saved = localStorage.getItem('app_settings');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.maxDuration) setMaxDuration(s.maxDuration);
        if (s.maxChat) setMaxChat(s.maxChat);
        if (s.apiKeyMasked) setApiKeyMasked(s.apiKeyMasked);
      } catch { /* ignore */ }
    }
  }, []);

  const handleSave = async () => {
    // 保存到 localStorage（学习参数等）
    const masked = apiKey ? '••••••••' + apiKey.slice(-4) : apiKeyMasked;
    setApiKeyMasked(masked);
    localStorage.setItem('app_settings', JSON.stringify({
      maxDuration, maxChat, apiKeyMasked: masked,
    }));

    // 如果有新 API Key，保存到后端数据库并重新初始化 LLM
    if (apiKey.trim()) {
      try {
        const { settingsService } = await import('../../services');
        const result = await settingsService.saveApiKey(apiKey.trim(), selectedModel) as {
          success: boolean;
          message: string;
        };
        setSaveMsg(result.message || '设置已保存，AI 对话已启用 ✓');
      } catch {
        // 浏览器模式或后端不可用
        setSaveMsg('API Key 已本地保存（后端未连接）');
      }
    } else {
      setSaveMsg('设置已保存 ✓');
    }

    setApiKey('');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleClearData = async () => {
    if (!window.confirm('确定要清除所有学习数据吗？此操作不可撤销！')) return;

    // 始终清 localStorage 浏览器 mock 端
    localStorage.removeItem('mock_answer_records');

    // Tauri 模式：调后端清空数据库
    try {
      const { learningService } = await import('../../services');
      const result = await learningService.clearStudentData('default-student');
      if (result) {
        console.info('[清除数据] 后端删除行数:', result.total_deleted);
      }
    } catch (e) {
      console.warn('[清除数据] 后端调用失败（浏览器模式或未配置）:', e);
    }

    // 通知其他页面（如知识地图）刷新进度
    window.dispatchEvent(new CustomEvent('learning-data:cleared'));
    setSaveMsg('学习数据已清除');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const sections = [
    { key: 'model', icon: '🤖', label: 'AI 模型' },
    { key: 'apikey', icon: '🔑', label: 'API Key' },
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
            {activeSection === 'model' && (
              <motion.div key="model" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">选择 AI 模型</h2>
                <p className="section-desc">不同模型有不同的特点，选择最适合你的那个</p>
                <div className="model-grid">
                  {availableModels.map((m) => (
                    <div
                      key={m.id}
                      className={`model-card ${selectedModel === m.id ? 'active' : ''}`}
                      onClick={() => setSelectedModel(m.id)}
                    >
                      <div className="model-card-header">
                        <span className="model-name">{m.name}</span>
                        <span className={`model-tag tag-${m.tag === '推荐' ? 'primary' : m.tag === '通用' ? 'info' : 'success'}`}>{m.tag}</span>
                      </div>
                      <div className="model-card-id">{m.id}</div>
                      {selectedModel === m.id && (
                        <div className="model-check">✓ 当前使用</div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeSection === 'apikey' && (
              <motion.div key="apikey" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">API Key 管理</h2>
                <p className="section-desc">输入硅基流动的 API Key 以启用 AI 功能</p>
                <div className="form-group">
                  <label className="form-label">当前 Key</label>
                  <div className="form-value">{apiKeyMasked || '未设置'}</div>
                </div>
                <div className="form-group">
                  <label className="form-label">新 API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="sk-xxxxxxxxxxxxxxxx"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <span className="form-hint">Key 仅保存在本地，不会上传到任何服务器</span>
                </div>
              </motion.div>
            )}

            {activeSection === 'learning' && (
              <motion.div key="learning" className="settings-section" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="section-title">学习参数</h2>
                <p className="section-desc">调整学习时长和聊天限制</p>
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
                <div className="form-group">
                  <label className="form-label">每日聊天上限</label>
                  <div className="slider-row">
                    <input
                      type="range"
                      className="form-slider"
                      min={5}
                      max={50}
                      step={5}
                      value={maxChat}
                      onChange={(e) => setMaxChat(Number(e.target.value))}
                    />
                    <span className="slider-value">{maxChat} 次</span>
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
