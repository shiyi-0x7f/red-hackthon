import React, { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { getHttpBase } from '../../services';

export interface ManimPlayerSpec {
  type: 'manim';
  title?: string;
  video_url: string;
}

interface Props {
  spec: ManimPlayerSpec;
}

/** Manim 动画视频播放器 — glassmorphism 风格 */
const ManimPlayer: React.FC<Props> = ({ spec }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // 构造完整 URL（相对路径前缀 HTTP base）
  const videoSrc = spec.video_url.startsWith('http')
    ? spec.video_url
    : `${getHttpBase()}${spec.video_url}`;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      if (v.duration) setProgress((v.currentTime / v.duration) * 100);
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(100);
    };
    const onCanPlay = () => setLoaded(true);
    const onError = () => setError(true);

    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('error', onError);

    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('error', onError);
    };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      v.play().catch(() => {});
      setPlaying(true);
    }
  };

  const replay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
    setPlaying(true);
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setProgress(pct * 100);
  };

  return (
    <motion.div
      className="manim-player-wrap"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {spec.title && <div className="manim-player-title">🎬 {spec.title}</div>}

      <div className="manim-player-video-container">
        {!loaded && !error && (
          <div className="manim-player-loading">
            <div className="manim-loading-spinner" />
            <span>动画加载中...</span>
          </div>
        )}

        {error && (
          <div className="manim-player-error">
            <span>动画加载失败</span>
          </div>
        )}

        <video
          ref={videoRef}
          src={videoSrc}
          preload="auto"
          playsInline
          style={{ display: loaded ? 'block' : 'none' }}
          className="manim-player-video"
        />

        {loaded && (
          <div className="manim-player-overlay" onClick={togglePlay}>
            {!playing && progress < 1 && (
              <motion.div
                className="manim-play-icon"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                <PlayCircleOutlined style={{ fontSize: 48, color: 'rgba(255,255,255,0.9)' }} />
              </motion.div>
            )}
          </div>
        )}
      </div>

      {loaded && (
        <div className="manim-player-controls">
          <button
            className="manim-ctrl-btn"
            onClick={togglePlay}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          </button>

          <div className="manim-progress-bar" onClick={seekTo}>
            <div
              className="manim-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          <button
            className="manim-ctrl-btn"
            onClick={replay}
            aria-label="重播"
          >
            <ReloadOutlined />
          </button>
        </div>
      )}
    </motion.div>
  );
};

/** Manim 渲染中占位组件 */
export const ManimLoadingPlaceholder: React.FC<{ title?: string }> = ({ title }) => (
  <motion.div
    className="manim-player-wrap manim-rendering"
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
  >
    <div className="manim-player-title">🎬 {title || '数学动画'}</div>
    <div className="manim-rendering-body">
      <div className="manim-rendering-spinner" />
      <span className="manim-rendering-text">AI 正在生成数学动画...</span>
      <span className="manim-rendering-sub">这可能需要几秒钟</span>
    </div>
  </motion.div>
);

export default ManimPlayer;
