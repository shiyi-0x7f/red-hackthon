"""系统设置路由 - API Key / 默认模型"""
import aiosqlite
from fastapi import APIRouter, Depends

from ..ai.llm_client import get_llm_client
from ..config import Settings, get_settings
from ..db.connection import get_db
from ..schemas.common import ok
from ..schemas.decision import ApiSettingsUpdate
from ._deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])

AVAILABLE_MODELS = [
    {"id": "deepseek-ai/DeepSeek-V3", "name": "DeepSeek V3", "tag": "推荐"},
    {"id": "Qwen/Qwen2.5-72B-Instruct", "name": "通义千问 72B", "tag": "通用"},
    {"id": "THUDM/glm-4-9b-chat", "name": "GLM-4 9B", "tag": "轻量"},
]


@router.get("/settings/api")
async def get_api_settings(settings: Settings = Depends(get_settings)):
    return ok(
        {
            "provider": "siliconflow",
            "api_base": settings.siliconflow_api_base,
            "api_key_set": bool(settings.siliconflow_api_key),
            "default_model": settings.siliconflow_default_model,
            "available_models": AVAILABLE_MODELS,
        }
    )


@router.put("/settings/api")
async def update_api_settings(
    payload: ApiSettingsUpdate,
    db: aiosqlite.Connection = Depends(get_db),
):
    """更新 API Key / 默认模型。持久化到 app_settings 表。

    注意：运行时环境变量优先。数据库里的值会被 config 加载时读取为覆盖。
    """
    if payload.api_key is not None:
        await db.execute(
            """
            INSERT INTO app_settings (key, value) VALUES ('siliconflow_api_key', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (payload.api_key,),
        )
    if payload.default_model is not None:
        await db.execute(
            """
            INSERT INTO app_settings (key, value) VALUES ('siliconflow_default_model', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (payload.default_model,),
        )
        # 同步切换全局客户端
        get_llm_client().set_model(payload.default_model)
    await db.commit()
    return ok({"updated": True})
