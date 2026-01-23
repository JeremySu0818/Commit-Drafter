import os
import sys
from dotenv import load_dotenv


def get_base_path():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


env_path = os.path.join(get_base_path(), ".env")
load_dotenv(env_path)
load_dotenv()


def save_key_to_env(key_name: str, key_value: str):
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    updated = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key_name}="):
            new_lines.append(f"{key_name}={key_value}\n")
            updated = True
        else:
            new_lines.append(line)

    if not updated:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines.append("\n")
        new_lines.append(f"{key_name}={key_value}\n")

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


SYSTEM_PROMPT = """You are a senior software engineer acting as an autonomous commit message generator.
Your task is to generate a clean, concise, and meaningful content for a git commit based on the provided diff.

**Constraint Checklist & Confidence Score:**
1. Language: English Only.
2. Format: Conventional Commits (Strictly).
- `type(scope): description` (First line, max 50 chars ideally, absolute max 72)
- (Optional) Body lines (Wrap at 72 chars)
- (Optional) Footer (e.g., BREAKING CHANGE: ...)
3. NO Emojis.
4. Do not include "Signed-off-by" or other metadata unless strictly necessary.
5. Content: specific and descriptive. Avoid vague messages like "fixed bug" or "updated code".

**Types:**
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to our CI configuration files and scripts
- `chore`: Other changes that don't modify src or test files

**Output Format:**
Return ONLY the commit message. Do not output markdown code blocks (```), do not output explanations. Just the raw commit message string.
"""

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
