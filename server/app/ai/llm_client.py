"""LLM 客户端 - 从 src-tauri/src/ai/llm_client.rs 移植

使用 httpx (AsyncClient) 调硅基流动 OpenAI 兼容 API。
提供普通 complete 和流式 complete_stream 两种接口。
"""
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class Message:
    role: str  # 'system' | 'user' | 'assistant'
    content: str

    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content}


@dataclass
class LLMOptions:
    temperature: float = 0.7
    max_tokens: int = 2048
    top_p: float = 0.9


class LLMError(Exception):
    pass


class LLMClient:
    """硅基流动 LLM 客户端 (OpenAI 兼容)"""

    def __init__(self, api_base: str, api_key: str, model: str):
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.model = model

    def set_model(self, model: str) -> None:
        self.model = model
        logger.info(f"LLM 模型切换为: {model}")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _body(self, messages: list[Message], opts: LLMOptions, stream: bool) -> dict:
        return {
            "model": self.model,
            "messages": [m.to_dict() for m in messages],
            "temperature": opts.temperature,
            "max_tokens": opts.max_tokens,
            "top_p": opts.top_p,
            "stream": stream,
        }

    async def complete(
        self,
        messages: list[Message],
        opts: LLMOptions | None = None,
    ) -> str:
        """普通完成 - 等待完整响应"""
        opts = opts or LLMOptions()
        url = f"{self.api_base}/chat/completions"
        body = self._body(messages, opts, stream=False)

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(url, headers=self._headers(), json=body)
            except httpx.RequestError as e:
                raise LLMError(f"请求失败: {e}") from e

            if response.status_code != 200:
                raise LLMError(f"API 返回 {response.status_code}: {response.text}")

            data = response.json()

        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise LLMError(f"响应中无 choices: {data}") from e

    async def complete_stream(
        self,
        messages: list[Message],
        opts: LLMOptions | None = None,
    ) -> AsyncIterator[str]:
        """流式完成 - 逐 token 异步迭代输出"""
        opts = opts or LLMOptions()
        url = f"{self.api_base}/chat/completions"
        body = self._body(messages, opts, stream=True)

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", url, headers=self._headers(), json=body
            ) as response:
                if response.status_code != 200:
                    text = await response.aread()
                    raise LLMError(
                        f"API 返回 {response.status_code}: {text.decode('utf-8', errors='replace')}"
                    )

                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line or line == "data: [DONE]":
                            continue
                        if not line.startswith("data: "):
                            continue
                        try:
                            payload = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        choices = payload.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content


# 全局单例（由 main.py 或 config 初始化）
_global_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """按需从 settings 构造全局 LLMClient"""
    global _global_client
    if _global_client is None:
        from ..config import get_settings

        s = get_settings()
        _global_client = LLMClient(
            api_base=s.siliconflow_api_base,
            api_key=s.siliconflow_api_key,
            model=s.siliconflow_default_model,
        )
    return _global_client
