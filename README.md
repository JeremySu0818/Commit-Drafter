# Commit-Copilot VS Code Extension

Commit-Copilot is a smart VS Code extension that leverages Large Language Models (LLMs) to automatically generate meaningful, conventional commit messages based on your staged changes. It streamlines your git workflow by analyzing diffs and suggesting professional commit messages directly within your editor.

## Features

- **Multi-Provider Support**: Choose your preferred AI provider:
  - **Google Gemini**: Support for Gemini 2.0 Flash, Gemini 2.5 Flash/Pro, and Gemini 3 Preview.
  - **OpenAI**: Support for o3, o4-mini, GPT-4o, and the next-generation GPT-5 series.
  - **Anthropic**: Support for Claude Sonnet/Opus 4 and Claude Haiku/Sonnet/Opus 4.5 and Claude Opus 4.6.
  - **Ollama**: Support for local models like Gemma 3 and GPT-OSS.
- **Seamless VS Code Integration**: Access Commit-Copilot directly from the Activity Bar or Command Palette.
- **Conventional Commits**: Generates messages following the Conventional Commits specification (e.g., `feat:`, `fix:`, `docs:`).
- **Smart Context**: Intelligently analyzes your `git diff` to understand the intent of your changes.
- **Secure Key Storage**: API keys are stored securely using VS Code's Secret Storage.
- **Model Selection**: Customize which model you want to use for each provider.
- **One-Click Generation**: Instantly generate commit messages for your staged changes.
- **Preview & Edit**: Review the generated message in the Source Control input box before committing.

## Requirements

- **VS Code**: v1.80.0 or higher.
- **Git**: Installed and available in your PATH.
- **API Key**: A valid API key for your chosen provider (or a local Ollama instance).

## Usage

### 1. Installation

Download and install the extension from the VS Code Marketplace or Open VSX Registry.

### 2. Configuration

1.  Click on the **Commit Copilot** icon in the Activity Bar (left side sidebar).
2.  Select your desired **Provider** from the dropdown menu (Google, OpenAI, Anthropic, or Ollama).
3.  Enter your **API Key** (or Host URL for Ollama).
    - _Note: Keys are stored securely on your device._
4.  Click **Save**. The extension will validate your key.
5.  Once validated, you can select a specific **Model** from the dropdown if available.

### 3. Generate Commit Message

#### Method A: Activity Bar

1.  Open the **Commit Copilot** view in the Activity Bar.
2.  Ensure you have changes in your repository (staged or unstaged).
3.  Click the **"Generate Commit Message"** button.

#### Method B: Source Control Navigation

1.  Open the **Source Control** view (`Ctrl+Shift+G`).
2.  Click the **Commit-Copilot** icon (sparkle) in the navigation bar.

#### Method C: Command Palette

1.  Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac).
2.  Type `Commit-Copilot: Generate Commit Message` and select it.

### 4. Review and Commit

The generated message will automatically populate the Source Control input box. You can:

- Edit the message if needed.
- Press `Ctrl+Enter` (or Click Commit) to commit your changes.

## Development

### Prerequisites

- Node.js 20+
- npm

### Building

You can easily build the project using the provided scripts. These will handle dependency installation, compilation, and packaging automatically.

**Windows:**

```cmd
build.bat
```

**Linux / macOS:**

```bash
./build.sh
```

After building, you can open the project in VS Code (`code .`) and press `F5` to start debugging.

## License

This project is released into the public domain. You are free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.
