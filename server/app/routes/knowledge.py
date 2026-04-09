"""知识图谱 - 从本地 JSON 加载树结构"""
import json
import logging
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..config import Settings, get_settings
from ..schemas.common import ok
from ._deps import require_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_api_key)])


@lru_cache(maxsize=8)
def _load_knowledge_map(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/knowledge/tree")
async def get_knowledge_tree(
    grade: int = 6, settings: Settings = Depends(get_settings)
):
    """返回人教版知识树（当前仅支持 6 年级）"""
    if grade != 6:
        raise HTTPException(
            status_code=501,
            detail=f"当前仅支持 6 年级，grade={grade} 未提供数据",
        )
    path = str(settings.knowledge_map_file)
    try:
        data = _load_knowledge_map(path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=500, detail=f"知识图谱文件不存在: {path}"
        ) from None
    return ok(data)
