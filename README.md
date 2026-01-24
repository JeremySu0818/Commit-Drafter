# Auto-Commit VS Code Extension

Auto-Commit is a smart VS Code extension that leverages Large Language Models (LLMs) to automatically generate meaningful, conventional commit messages based on your staged changes. It streamlines your git workflow by analyzing diffs and suggesting professional commit messages directly within your editor.

## Features

- **Seamless VS Code Integration**: Access Auto-Commit directly from the Activity Bar or Command Palette.
- **LLM Powered**: Uses Google's Gemini models to intelligently understand your code changes.
- **Conventional Commits**: Generates messages following the Conventional Commits specification (e.g., `feat:`, `fix:`, `docs:`).
- **One-Click Generation**: Instantly generate commit messages for your staged changes.
- **Preview & Edit**: Review the generated message before committing.
- **Cross-Platform**: Works on Windows, macOS, and Linux.

## Requirements

- **Editor**: Visual Studio Code v1.80.0 or higher.
- **Git**: Installed and available in your PATH.
- **API Key**: A valid [Google Gemini API Key](https://aistudio.google.com/api-keys).

## Usage

### 1. Installation

Install the `.vsix` package or download from the VS Code Marketplace (if published).

### 2. Getting Started

1.  Open a folder containing a Git repository in VS Code.
2.  Make changes to your files and **stage** them (or let Auto-Commit stage them for you).

### 3. Generate Commit Message

You can generate a commit message in two ways:

#### Method A: Activity Bar

1.  Click on the **Auto Commit** icon in the Activity Bar (left side).
2.  Click the **"Generate Commit Message"** button (or Sparkle icon).

#### Method B: Command Palette

1.  Press `Ctrl+Shift+P` to open the Command Palette.
2.  Type `Auto-Commit: Generate Commit Message` and select it.

### 4. API Key Setup

On your first use, you will be prompted to enter your **Google Gemini API Key**. This key is securely stored for future use.

### 5. Review and Commit

The generated message will appear in the input box. You can:

- Edit the message if needed.
- Click **Commit** (check mark) to commit the changes to your repository.

## Development

### Prerequisites

- Node.js 18+
- npm

### Building

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch
```

### Project Structure

```
src/
├── extension.ts      # VS Code extension entry point
├── autoCommit.ts     # Core logic: Git operations, LLM client, error handling
└── SidePanelProvider.ts  # Webview panel for API key configuration
```

## License

This project is released into the public domain. You are free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.
