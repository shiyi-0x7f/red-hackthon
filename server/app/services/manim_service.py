"""Manim 渲染服务 - 在后端执行 LLM 生成的 Manim 代码并返回视频文件

安全约束：
- 代码白名单校验（禁止危险 import / 系统调用）
- 超时限制（30 秒）
- 临时文件自动清理
"""
import asyncio
import hashlib
import logging
import re
import shutil
import tempfile
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# 视频输出根目录
MANIM_OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "manim_media"
MANIM_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 危险关键词黑名单
_DANGEROUS_PATTERNS = [
    r"\bimport\s+os\b",
    r"\bimport\s+sys\b",
    r"\bimport\s+subprocess\b",
    r"\bimport\s+shutil\b",
    r"\bimport\s+pathlib\b",
    r"\bimport\s+socket\b",
    r"\bimport\s+http\b",
    r"\bimport\s+urllib\b",
    r"\bimport\s+requests\b",
    r"\b__import__\b",
    r"\bexec\s*\(",
    r"\beval\s*\(",
    r"\bcompile\s*\(",
    r"\bopen\s*\(",
    r"\bos\.\w+",
    r"\bsubprocess\.\w+",
    r"\bshutil\.\w+",
    r"\bsys\.\w+",
    r"\bglobals\s*\(",
    r"\blocals\s*\(",
    r"\bgetattr\s*\(",
    r"\bsetattr\s*\(",
    r"\bdelattr\s*\(",
]

# 缓存配置
MAX_CACHE_SIZE = 100  # 最多缓存 100 个视频
CACHE_TTL_HOURS = 24  # 24 小时过期


class ManimRenderError(Exception):
    """Manim 渲染失败"""
    pass


def _validate_code(code: str) -> None:
    """校验 Manim 代码安全性"""
    for pattern in _DANGEROUS_PATTERNS:
        if re.search(pattern, code):
            raise ManimRenderError(
                f"代码包含不安全的操作: {pattern}"
            )

    # 确保只 import manim
    import_lines = re.findall(r"^\s*(?:from|import)\s+(\S+)", code, re.MULTILINE)
    for mod in import_lines:
        root_mod = mod.split(".")[0]
        if root_mod != "manim":
            raise ManimRenderError(
                f"不允许导入 manim 以外的模块: {mod}"
            )

    # 确保有 ExplainScene 类
    if "class ExplainScene" not in code:
        raise ManimRenderError("代码必须包含 class ExplainScene(Scene)")


def _clean_code(code: str) -> str:
    """清理 LLM 输出中的 markdown 包裹"""
    # 去除 ```python ... ``` 包裹
    code = re.sub(r"^```(?:python)?\s*\n?", "", code.strip())
    code = re.sub(r"\n?```\s*$", "", code.strip())
    return code.strip()


def _cache_key(code: str) -> str:
    """生成代码的缓存 key"""
    return hashlib.md5(code.encode("utf-8")).hexdigest()[:12]


def _cleanup_old_cache() -> None:
    """清理过期缓存"""
    try:
        video_dirs = sorted(
            MANIM_OUTPUT_DIR.glob("vid_*"),
            key=lambda p: p.stat().st_mtime,
        )
        now = time.time()
        for d in video_dirs:
            age_hours = (now - d.stat().st_mtime) / 3600
            if age_hours > CACHE_TTL_HOURS or len(video_dirs) > MAX_CACHE_SIZE:
                shutil.rmtree(d, ignore_errors=True)
                video_dirs.remove(d)
    except Exception as e:
        logger.warning(f"缓存清理失败: {e}")


async def render_manim(code: str) -> str:
    """渲染 Manim 代码，返回可访问的视频文件相对路径

    Args:
        code: LLM 生成的 Manim Python 代码

    Returns:
        相对于 /media/manim/ 的视频文件路径

    Raises:
        ManimRenderError: 渲染失败
    """
    code = _clean_code(code)
    _validate_code(code)

    cache = _cache_key(code)

    # 检查缓存
    cached_dir = MANIM_OUTPUT_DIR / f"vid_{cache}"
    if cached_dir.exists():
        mp4_files = list(cached_dir.glob("*.mp4"))
        if mp4_files:
            rel = mp4_files[0].relative_to(MANIM_OUTPUT_DIR)
            logger.info(f"Manim 缓存命中: {rel}")
            return str(rel).replace("\\", "/")

    # 清理旧缓存
    _cleanup_old_cache()

    # 写入临时 Python 文件
    cached_dir.mkdir(parents=True, exist_ok=True)
    script_path = cached_dir / "scene.py"
    script_path.write_text(code, encoding="utf-8")

    # 执行 manim render
    cmd = [
        "manim",
        "render",
        "-ql",          # 低质量 (480p, 15fps) 以加快速度
        "--format=mp4",
        "--media_dir", str(cached_dir),
        str(script_path),
        "ExplainScene",
    ]

    logger.info(f"Manim 渲染开始: {cache}")
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cached_dir),
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=60
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        raise ManimRenderError("Manim 渲染超时（>60秒）")
    except FileNotFoundError:
        raise ManimRenderError(
            "manim 命令未找到，请确保已安装: pip install manim"
        )

    if proc.returncode != 0:
        err_text = stderr.decode("utf-8", errors="replace")[-500:]
        logger.error(f"Manim 渲染失败:\n{err_text}")
        raise ManimRenderError(f"Manim 渲染失败: {err_text}")

    # 找到生成的 MP4 文件
    mp4_files = list(cached_dir.rglob("*.mp4"))
    if not mp4_files:
        raise ManimRenderError("Manim 渲染完成但未找到输出视频")

    # 把 MP4 文件移到 cached_dir 根下（扁平化）
    video = mp4_files[0]
    target = cached_dir / f"{cache}.mp4"
    if video != target:
        shutil.move(str(video), str(target))

    # 清理 manim 的子目录结构
    for subdir in ["videos", "images", "texts", "Tex"]:
        sub = cached_dir / subdir
        if sub.exists():
            shutil.rmtree(sub, ignore_errors=True)

    rel = target.relative_to(MANIM_OUTPUT_DIR)
    logger.info(f"Manim 渲染完成: {rel}")
    return str(rel).replace("\\", "/")


def get_video_absolute_path(relative_path: str) -> Path:
    """将相对路径转为绝对路径"""
    return MANIM_OUTPUT_DIR / relative_path
