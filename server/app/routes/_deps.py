"""路由公共依赖 - 鉴权、学生存在性检查等"""
from fastapi import Depends, Header, HTTPException, status

from ..config import Settings, get_settings


async def require_api_key(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """校验 Bearer token

    客户端（Tauri 或 AstrBot）必须在 Authorization header 带
    `Bearer {LEARNING_API_KEY}`。
    """
    expected = settings.learning_api_key
    if not expected or expected == "sk-ai-learning-change-me":
        # 开发模式允许空鉴权，但会打警告
        return

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 Authorization: Bearer ... 头",
        )

    token = authorization.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key 无效",
        )
