"""AI Learning Server - FastAPI 后端

提供两套接口：
- /api/v1/*            —— 供 Tauri 客户端直接调用（REST）
- /v1/chat/completions —— OpenAI 兼容接口，供 AstrBot 作为 Custom Provider 接入
"""

__version__ = "0.1.0"
