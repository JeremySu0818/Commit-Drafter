import os
from google import genai
from google.genai import types
from openai import OpenAI
from .config import (
    SYSTEM_PROMPT,
    GEMINI_API_KEY,
    OPENAI_API_KEY,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_OPENAI_MODEL,
)


class LLMClient:
    def __init__(self, provider: str = "gemini", model: str = None):
        self.provider = provider.lower()
        self.model = model

        if self.provider == "gemini":
            if not GEMINI_API_KEY:
                raise ValueError("GEMINI_API_KEY is not set in environment variables.")
            # Initialize the new Gen AI client
            self.client = genai.Client(api_key=GEMINI_API_KEY)
            self.model = model or DEFAULT_GEMINI_MODEL

        elif self.provider == "openai":
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY is not set in environment variables.")
            self.client = OpenAI(api_key=OPENAI_API_KEY)
            self.model = model or DEFAULT_OPENAI_MODEL

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

            elif self.provider == "openai":
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt_content},
                    ],
                )
                return response.choices[0].message.content.strip()

        except Exception as e:
            return f"Error generating commit message: {str(e)}"
