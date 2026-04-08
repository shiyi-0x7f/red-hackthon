import React, { useState } from 'react';
import { motion } from 'framer-motion';
import ParentRealtimePanel from '../../components/learning/ParentRealtimePanel';
import '../../styles/learning-extras.css';

const ParentPage: React.FC = () => {
  const [isVerified, setIsVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleVerify = () => {
    if (password === '123456') {
      setIsVerified(true);
      setError('');
    } else {
      setError('密码不正确，请重试');
    }
  };

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
          <p className="lock-desc">请输入密码，查看孩子的学习情况</p>

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

  return (
    <motion.div
      className="parent-page parent-dashboard"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="parent-header">
        <div>
          <h1 className="page-title">🧠 学习行为与状态</h1>
          <p className="page-subtitle">
            学习时长、题目数、正确率和知识掌握进度请查看孩子的「我的学习画像」页。
            这里只展示需要家长关注的行为/状态指标。
          </p>
        </div>
      </div>

      {/* 6 层实时画像（含敏感行为/状态指标，仅家长可见）*/}
      <ParentRealtimePanel studentId="default-student" />

      {/* 退出 */}
      <div className="parent-footer">
        <button className="btn-secondary" onClick={() => setIsVerified(false)}>退出家长模式 🔒</button>
      </div>
    </motion.div>
  );
};

export default ParentPage;
