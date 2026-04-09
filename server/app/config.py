"""全局配置（pydantic-settings）

从环境变量或 .env 文件加载。按类别组织，所有 routes/services 都通过 get_settings()
读取，便于测试时替换。
"""
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- 基础 ---
    server_host: str = "0.0.0.0"
    server_port: int = 9000
    log_level: str = "INFO"

    # --- 数据库 ---
    database_url: str = "sqlite:///./ai_learning.db"
    # 默认指向 src-tauri/migrations，保证 Tauri 和 server 共享同一套 schema
    migrations_dir: str = "../src-tauri/migrations"

    # --- API 鉴权 ---
    learning_api_key: str = "sk-ai-learning-change-me"

    # --- LLM ---
    siliconflow_api_base: str = "https://api.siliconflow.cn/v1"
    siliconflow_api_key: str = ""
    siliconflow_default_model: str = "deepseek-ai/DeepSeek-V3"

    # --- CORS ---
    cors_origins: str = "http://localhost:1420,http://localhost:5173,tauri://localhost"

    # --- 家长端 ---
    default_parent_password: str = "123456"

    # --- 数据 ---
    data_dir: str = "../data"

    # --- 前端静态文件（可选，B1 部署方案用）---
    # 如果目录存在，server 会挂载它作为根路径的静态托管 + SPA fallback
    # 用法：
    # - Docker: `COPY dist /app/static` 或 volume mount `-v ./dist:/app/static:ro`
    # - 本地：`cp -r <项目根>/dist server/static` 后重启 server
    # 目录为空或不存在时，server 跳过挂载（纯 API 模式），不会报错
    frontend_dist_dir: str = "./static"

    @property
    def db_path(self) -> Path:
        """从 database_url 中提取 sqlite 文件路径"""
        if self.database_url.startswith("sqlite:///"):
            return Path(self.database_url.replace("sqlite:///", ""))
        return Path(self.database_url)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def knowledge_map_file(self) -> Path:
        return Path(self.data_dir) / "grade6_math_knowledge_map.json"

    @property
    def question_bank_file(self) -> Path:
        return Path(self.data_dir) / "grade6_math_practice_questions_latex.json"

    @property
    def frontend_dist_path(self) -> Path:
        return Path(self.frontend_dist_dir).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
