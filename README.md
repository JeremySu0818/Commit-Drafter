# Auto-Commit CLI Tool

A Python-based CLI tool to automatically generate [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) messages using LLMs (Gemini or OpenAI).

## Features

- Support for **Google Gemini** and **OpenAI** APIs.
- Generates strict **English** conventional commits.
- **No emojis** (professional standard).
- Simple CLI interface using `typer` and `rich`.

## Installation

1. Create a virtual environment:

   ```bash
   uv venv .venv
   # Windows
   .venv\Scripts\activate
   # Linux/Mac
   source .venv/bin/activate
   ```

2. Install dependencies:

   ```bash
   uv pip install -r requirements.txt
   ```

3. Configure API Keys:
   Copy `.env.example` to `.env` and fill in your keys.
   ```bash
   cp .env.example .env
   ```

## Usage

Basic usage (uses Gemini by default):

```bash
python -m src.cli generate
```

Specify provider:

```bash
python -m src.cli generate --provider openai
```

Auto-commit without confirmation:

```bash
python -m src.cli generate -y
```

## System Prompt (LLM Instructions)

The tool uses a strict system prompt to ensure consistency. You can view the full prompt in `src/config.py`.
Summary of instructions given to LLM:

- Role: Senior Software Engineer
- Output: strictly raw commit message string.
- Format: `type(scope): description`
- No Markdown, No Emojis.

## Development

- Managed by `uv pip`.
- Entry point: `src/cli.py`.
