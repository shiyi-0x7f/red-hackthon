"""FastAPI 应用入口

- `/api/v1/*`  —— 业务 REST，供 Tauri 客户端 / AstrBot 插件调用
- `/health`    —— 健康检查
- 其余所有路径 —— 如果 `FRONTEND_DIST_DIR` 存在则走前端 SPA（B1 方案：同域部署）
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import get_settings
from .db.connection import init_db_path
from .db.migrations import run_migrations

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info("AI Learning Server 启动中...")
    init_db_path()
    await run_migrations()
    logger.info(f"服务器就绪 @ {settings.server_host}:{settings.server_port}")
    yield
    logger.info("AI Learning Server 已关闭")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AI Learning Server",
        description="AI 自适应小学数学学习系统 - 后端",
        version=__version__,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": __version__}

    # 注册路由
    # 说明：AstrBot 集成方式已改为 Star 插件（见 dev_docs/12_分工边界_Gemini_vs_Claude.md）。
    # server 只提供 /api/v1/* REST API，插件通过 HTTP 调用。不再提供 OpenAI 兼容接口。
    from .routes import (
        chat,
        decision,
        explain,
        interests,
        knowledge,
        learning,
        pacing,
        parent,
        question,
        settings as settings_route,
        student,
        student_model,
    )

    api_prefix = "/api/v1"
    app.include_router(student.router, prefix=api_prefix, tags=["student"])
    app.include_router(knowledge.router, prefix=api_prefix, tags=["knowledge"])
    app.include_router(question.router, prefix=api_prefix, tags=["question"])
    app.include_router(learning.router, prefix=api_prefix, tags=["learning"])
    app.include_router(student_model.router, prefix=api_prefix, tags=["student-model"])
    app.include_router(decision.router, prefix=api_prefix, tags=["decision"])
    app.include_router(pacing.router, prefix=api_prefix, tags=["pacing"])
    app.include_router(parent.router, prefix=api_prefix, tags=["parent"])
    app.include_router(interests.router, prefix=api_prefix, tags=["interests"])
    app.include_router(settings_route.router, prefix=api_prefix, tags=["settings"])
    app.include_router(explain.router, prefix=api_prefix, tags=["explain"])
    app.include_router(chat.router, prefix=api_prefix, tags=["chat"])

    # ==========================================================================
    # 前端 SPA 挂载（B1 部署方案 — 同域部署）
    # ==========================================================================
    # 仅当 FRONTEND_DIST_DIR 目录存在且包含 index.html 时启用。
    #
    # 路由优先级（FastAPI 按注册顺序匹配）：
    #   1. 上面注册的 /api/v1/* 和 /health / /docs / /openapi.json（已经在前面注册）
    #   2. /assets/* → StaticFiles（hash 命名的 JS/CSS/图片）
    #   3. 其他所有 GET → spa_fallback：存在的静态文件优先，否则返回 index.html
    #
    # 这样做的好处：
    #   - 刷新 /learn、/profile、/practice 等 BrowserRouter 路径不会 404
    #   - 前后端同域，fetch('/api/v1/...') 零 CORS
    #   - 纯 API 部署（不放前端）也能工作，只要 dist 目录不存在就跳过挂载
    # ==========================================================================
    _mount_frontend_if_available(app, settings)

    return app


def _mount_frontend_if_available(app: FastAPI, settings) -> None:
    dist = settings.frontend_dist_path
    index_html = dist / "index.html"
    if not dist.is_dir() or not index_html.is_file():
        logger.info(
            f"前端目录不存在或缺少 index.html: {dist} — 跳过挂载，server 以纯 API 模式运行"
        )
        return

    logger.info(f"挂载前端 SPA: {dist}")

    # 2. /assets/* — vite 构建产物的哈希资源
    assets_dir = dist / "assets"
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="frontend-assets",
        )

    # 3. 其他所有 GET 走 SPA fallback
    # 这里必须最后注册，确保 /api/v1/* 已经在前面抢先匹配
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # 防守：以防 Starlette 把已注册的 API 路径也传到这里
        if (
            full_path.startswith("api/")
            or full_path == "health"
            or full_path.startswith("docs")
            or full_path.startswith("redoc")
            or full_path.startswith("openapi")
            or full_path.startswith("assets/")
        ):
            raise HTTPException(status_code=404)

        # 优先返回存在的静态文件（favicon.ico / robots.txt / public/data/*.json 等）
        # 安全：Path 会自动解析 .. 跨越，用 resolve() 然后校验是否在 dist 里面
        candidate = (dist / full_path).resolve()
        try:
            candidate.relative_to(dist)
        except ValueError:
            raise HTTPException(status_code=403) from None

        if candidate.is_file():
            return FileResponse(candidate)

        # 其他一切都是 BrowserRouter 虚拟路径 → 回退到 index.html
        return FileResponse(index_html)


app = create_app()
