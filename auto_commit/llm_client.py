import os
from google import genai
from google.genai import types
from google.genai.errors import APIError, ClientError
from auto_commit.config import (
    SYSTEM_PROMPT,
    GEMINI_API_KEY,
    DEFAULT_GEMINI_MODEL,
)


class LLMClientError(Exception):
    def __init__(self, message: str, error_code: str = "UNKNOWN"):
        super().__init__(message)
        self.error_code = error_code


class APIKeyMissingError(LLMClientError):
    def __init__(self, provider: str):
        super().__init__(
            f"{provider.upper()}_API_KEY is not set. Please configure your API key.",
            error_code="API_KEY_MISSING",
        )


class APIKeyInvalidError(LLMClientError):
    def __init__(self, message: str):
        super().__init__(
            f"Invalid API Key: {message}",
            error_code="API_KEY_INVALID",
        )


class APIQuotaExceededError(LLMClientError):
    def __init__(self, message: str):
        super().__init__(
            f"API quota exceeded: {message}",
            error_code="QUOTA_EXCEEDED",
        )


class APIRequestError(LLMClientError):
    def __init__(self, message: str):
        super().__init__(
            f"API request failed: {message}",
            error_code="API_ERROR",
        )


class LLMClient:
    def __init__(
        self, provider: str = "gemini", model: str = None, api_key: str = None
    ):
        self.provider = provider.lower()
        self.model = model

        if self.provider == "gemini":
            key = api_key or GEMINI_API_KEY
            if not key:
                raise APIKeyMissingError(provider)
            self.client = genai.Client(api_key=key)
            self.model = model or DEFAULT_GEMINI_MODEL
        else:
            raise ValueError(f"Unsupported provider: {provider}")

    def generate_commit_message(self, diff: str) -> str:
        if not diff.strip():
            raise LLMClientError(
                "No changes detected to generate a commit for.",
                error_code="NO_CHANGES",
            )

        prompt_content = f"Here is the git diff:\n\n{diff}"

        try:
            if self.provider == "gemini":
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=prompt_content,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT
                    ),
                )
                return response.text.strip()

        except ClientError as e:
            error_msg = str(e)
            if "401" in error_msg or "403" in error_msg:
                raise APIKeyInvalidError(error_msg)
            elif "429" in error_msg:
                raise APIQuotaExceededError(error_msg)
            else:
                raise APIRequestError(error_msg)
        except APIError as e:
            error_msg = str(e)
            if "429" in error_msg:
                raise APIQuotaExceededError(error_msg)
            raise APIRequestError(error_msg)
        except Exception as e:
            raise APIRequestError(str(e))
