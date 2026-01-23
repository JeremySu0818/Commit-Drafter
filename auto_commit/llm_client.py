import os
from google import genai
from google.genai import types
from auto_commit.config import (
    SYSTEM_PROMPT,
    GEMINI_API_KEY,
    DEFAULT_GEMINI_MODEL,
)


class LLMClient:
    def __init__(self, provider: str = "gemini", model: str = None, api_key: str = None):
        self.provider = provider.lower()
        self.model = model

        if self.provider == "gemini":
            key = api_key or GEMINI_API_KEY
            if not key:
                raise ValueError("GEMINI_API_KEY is not set.")
            # Initialize the new Gen AI client
            self.client = genai.Client(api_key=key)
            self.model = model or DEFAULT_GEMINI_MODEL

        else:
            raise ValueError(f"Unsupported provider: {provider}")

    def generate_commit_message(self, diff: str) -> str:
        if not diff.strip():
            return "No changes detected to generate a commit for."

        prompt_content = f"Here is the git diff:\n\n{diff}"

        try:
            if self.provider == "gemini":
                # New SDK usage
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=prompt_content,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT
                    ),
                )
                return response.text.strip()

        except Exception as e:
            return f"Error generating commit message: {str(e)}"

