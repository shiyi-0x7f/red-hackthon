import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { interestService, INTEREST_CATEGORIES, type InterestItem } from '../../services';

interface Props {
  studentId: string;
  /** 只读模式（家长端使用） */
  readonly?: boolean;
}

/**
 * 学生兴趣画像组件
 * - 按类别分组展示（爱好 / 运动 / 书 / 电影 / 音乐 / 家人 ...）
 * - 每个 item 一个彩色 chip，chip 上显示 source（手动 / AI 提取）
 * - 支持手动添加（非 readonly）
 * - 支持删除（非 readonly）
 */
const InterestProfile: React.FC<Props> = ({ studentId, readonly = false }) => {
  const [items, setItems] = useState<InterestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const loadItems = async () => {
    setLoading(true);
    try {
      const data = await interestService.list(studentId);
      setItems(data);
    } catch (e) {
      console.warn('[InterestProfile] 拉取失败:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [studentId]);

  const handleAdd = async (category: string) => {
    const name = newName.trim();
    if (!name) return;
    try {
      await interestService.add(studentId, category, name, 0.85);
      setNewName('');
      setAddingCategory(null);
      await loadItems();
    } catch (e) {
      console.error('添加失败:', e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await interestService.delete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      console.error('删除失败:', e);
    }
  };

  // 按类别分组
  const byCategory: Record<string, InterestItem[]> = {};
  for (const cat of INTEREST_CATEGORIES) byCategory[cat.key] = [];
  for (const item of items) {
    const key = byCategory[item.category] !== undefined ? item.category : 'other';
    byCategory[key].push(item);
  }

  return (
    <div className="card interest-profile-card">
      <h2 className="card-title">
        🌈 {readonly ? '孩子的兴趣画像' : '我的小档案'}
      </h2>
      <p className="section-desc">
        {readonly
          ? '来自学生手动输入 + AI 从对话中提取，用于让 AI 出题更贴近孩子的生活'
          : '告诉学习搭子你喜欢什么吧，之后做的题会更有趣哦 ✨'}
      </p>

      {loading ? (
        <div className="interest-loading">加载中...</div>
      ) : (
        <div className="interest-categories">
          {INTEREST_CATEGORIES.map((cat) => {
            const list = byCategory[cat.key] || [];
            if (readonly && list.length === 0) return null;
            return (
              <div key={cat.key} className="interest-category">
                <div className="interest-category-header">
                  <span className="interest-category-label">
                    {cat.emoji} {cat.label}
                    {list.length > 0 && <span className="interest-count">({list.length})</span>}
                  </span>
                  {!readonly && (
                    <button
                      className="interest-add-btn"
                      onClick={() => setAddingCategory(addingCategory === cat.key ? null : cat.key)}
                    >
                      {addingCategory === cat.key ? '取消' : '+ 添加'}
                    </button>
                  )}
                </div>

                {addingCategory === cat.key && !readonly && (
                  <div className="interest-add-row">
                    <input
                      className="interest-add-input"
                      placeholder={`添加一个${cat.label}...`}
                      value={newName}
                      autoFocus
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd(cat.key);
                        if (e.key === 'Escape') {
                          setAddingCategory(null);
                          setNewName('');
                        }
                      }}
                    />
                    <button
                      className="interest-confirm-btn"
                      onClick={() => handleAdd(cat.key)}
                      disabled={!newName.trim()}
                    >
                      ✓
                    </button>
                  </div>
                )}

                <div className="interest-chips">
                  <AnimatePresence>
                    {list.map((item) => (
                      <motion.div
                        key={item.id}
                        className={`interest-chip source-${item.source}`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        title={item.notes || ''}
                      >
                        <span>{item.name}</span>
                        {item.source === 'extracted' && (
                          <span className="interest-chip-source-tag">AI</span>
                        )}
                        {!readonly && (
                          <button
                            className="interest-chip-del"
                            onClick={() => handleDelete(item.id)}
                            title="移除"
                          >
                            ×
                          </button>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {list.length === 0 && !readonly && addingCategory !== cat.key && (
                    <span className="interest-empty">还没有～点「+ 添加」</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InterestProfile;
