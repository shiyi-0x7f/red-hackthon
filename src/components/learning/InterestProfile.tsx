import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { interestService, INTEREST_CATEGORIES, type InterestItem } from '../../services';

interface Props {
  studentId: string;
  /** 只读模式（家长端使用） */
  readonly?: boolean;
}

/** 合并后的分组（把相似类别合并，减少空白区域） */
const CATEGORY_GROUPS = [
  {
    key: 'hobby',
    label: '爱好与运动',
    emoji: '🎯',
    includes: ['hobby', 'sport'],
    color: '#FF8C42',
    bgGradient: 'linear-gradient(135deg, #FFF3E8, #FFF0E0)',
  },
  {
    key: 'media',
    label: '书影音',
    emoji: '📚',
    includes: ['book', 'movie', 'music'],
    color: '#6C63FF',
    bgGradient: 'linear-gradient(135deg, #F0EDFF, #EBE7FF)',
  },
  {
    key: 'food',
    label: '喜欢吃',
    emoji: '🍜',
    includes: ['food'],
    color: '#FF6B8A',
    bgGradient: 'linear-gradient(135deg, #FFF0F3, #FFE8EE)',
  },
  {
    key: 'family',
    label: '家人',
    emoji: '👨‍👩‍👧',
    includes: ['family'],
    color: '#00B5C8',
    bgGradient: 'linear-gradient(135deg, #E8F8FA, #E0F5F8)',
  },
  {
    key: 'other',
    label: '其他',
    emoji: '✨',
    includes: ['other'],
    color: '#5BC97F',
    bgGradient: 'linear-gradient(135deg, #ECFAF0, #E5F7EA)',
  },
];

/** 找到兴趣项对应的合并分组 key */
function findGroupKey(category: string): string {
  for (const g of CATEGORY_GROUPS) {
    if (g.includes.includes(category)) return g.key;
  }
  return 'other';
}

/** 子分类标签（合并分组内的子类别 emoji+label） */
function subCategoryLabel(cat: string): { emoji: string; label: string } | null {
  const found = INTEREST_CATEGORIES.find(c => c.key === cat);
  return found ? { emoji: found.emoji, label: found.label } : null;
}

/**
 * 学生兴趣画像组件 — 合并版
 * - 相似类别合并（爱好+运动 → "爱好与运动"，书/影/音 → "书影音"）
 * - 卡片网格布局 + 彩色渐变背景
 * - 可爱动效 + 圆角 chip 样式
 */
const InterestProfile: React.FC<Props> = ({ studentId, readonly = false }) => {
  const [items, setItems] = useState<InterestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [addSubCat, setAddSubCat] = useState<string>('');
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
      setAddingGroup(null);
      setAddSubCat('');
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

  // 按合并分组归类
  const grouped: Record<string, InterestItem[]> = {};
  for (const g of CATEGORY_GROUPS) grouped[g.key] = [];
  for (const item of items) {
    const gk = findGroupKey(item.category);
    grouped[gk].push(item);
  }

  // 计算总数
  const totalCount = items.length;

  return (
    <div className="interest-profile-card">
      {/* 标题区域 */}
      <div className="ip-header">
        <div className="ip-header-left">
          <span className="ip-header-icon">🌈</span>
          <div>
            <h2 className="ip-title">
              {readonly ? '孩子的兴趣画像' : '我的小档案'}
            </h2>
            <p className="ip-subtitle">
              {readonly
                ? '来自学生手动输入 + AI 从对话中提取'
                : '告诉我你喜欢什么，我会更懂你哦~'}
            </p>
          </div>
        </div>
        {totalCount > 0 && (
          <motion.div
            className="ip-total-badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            {totalCount} 项
          </motion.div>
        )}
      </div>

      {/* 内容区域 */}
      {loading ? (
        <div className="ip-loading">
          <span className="ip-loading-emoji">🔍</span>
          <span>正在加载你的档案...</span>
        </div>
      ) : (
        <div className="ip-grid">
          {CATEGORY_GROUPS.map((group) => {
            const list = grouped[group.key] || [];
            if (readonly && list.length === 0) return null;

            const isAdding = addingGroup === group.key;
            // 子类别选项（合并分组中的子分类）
            const subCategories = group.includes
              .map((k) => INTEREST_CATEGORIES.find((c) => c.key === k))
              .filter(Boolean) as typeof INTEREST_CATEGORIES;

            return (
              <motion.div
                key={group.key}
                className="ip-group-card"
                style={{
                  '--group-color': group.color,
                  '--group-bg': group.bgGradient,
                } as React.CSSProperties}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: CATEGORY_GROUPS.indexOf(group) * 0.06 }}
              >
                {/* 分组头 */}
                <div className="ip-group-header">
                  <div className="ip-group-icon-wrap">
                    <span className="ip-group-icon">{group.emoji}</span>
                  </div>
                  <span className="ip-group-label">{group.label}</span>
                  {list.length > 0 && (
                    <span className="ip-group-count">{list.length}</span>
                  )}
                  {!readonly && (
                    <button
                      className={`ip-add-btn ${isAdding ? 'active' : ''}`}
                      onClick={() => {
                        if (isAdding) {
                          setAddingGroup(null);
                          setNewName('');
                          setAddSubCat('');
                        } else {
                          setAddingGroup(group.key);
                          setAddSubCat(group.includes[0]);
                        }
                      }}
                    >
                      {isAdding ? '✕' : '＋'}
                    </button>
                  )}
                </div>

                {/* 添加面板 */}
                <AnimatePresence>
                  {isAdding && !readonly && (
                    <motion.div
                      className="ip-add-panel"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* 如果合并分组有多个子类别，显示选择器 */}
                      {subCategories.length > 1 && (
                        <div className="ip-sub-selector">
                          {subCategories.map((sc) => (
                            <button
                              key={sc.key}
                              className={`ip-sub-chip ${addSubCat === sc.key ? 'selected' : ''}`}
                              onClick={() => setAddSubCat(sc.key)}
                            >
                              {sc.emoji} {sc.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="ip-add-row">
                        <input
                          className="ip-add-input"
                          placeholder={`添加一个${subCategories.find(s => s.key === addSubCat)?.label || group.label
                            }...`}
                          value={newName}
                          autoFocus
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAdd(addSubCat || group.includes[0]);
                            if (e.key === 'Escape') {
                              setAddingGroup(null);
                              setNewName('');
                            }
                          }}
                        />
                        <button
                          className="ip-add-confirm"
                          onClick={() => handleAdd(addSubCat || group.includes[0])}
                          disabled={!newName.trim()}
                        >
                          添加
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 兴趣列表 */}
                <div className="ip-chips">
                  <AnimatePresence>
                    {list.map((item) => {
                      const sub = subCategoryLabel(item.category);
                      return (
                        <motion.div
                          key={item.id}
                          className={`ip-chip ${item.source === 'extracted' ? 'ai' : ''}`}
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          whileHover={{ scale: 1.05, y: -2 }}
                          title={item.notes || ''}
                        >
                          {sub && group.includes.length > 1 && (
                            <span className="ip-chip-sub">{sub.emoji}</span>
                          )}
                          <span className="ip-chip-name">{item.name}</span>
                          {item.source === 'extracted' && (
                            <span className="ip-chip-ai">AI</span>
                          )}
                          {!readonly && (
                            <button
                              className="ip-chip-del"
                              onClick={() => handleDelete(item.id)}
                              title="移除"
                            >
                              ×
                            </button>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  {list.length === 0 && !readonly && !isAdding && (
                    <span className="ip-empty-hint">
                      还没有～点 ＋ 号添加吧
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InterestProfile;
