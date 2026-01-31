// src/extension.ts

import * as vscode from "vscode";
import { SidePanelProvider } from "./SidePanelProvider";
import {
  generateCommitMessage,
  EXIT_CODES,
  ERROR_MESSAGES,
  CommitCopilotError,
} from "./commitCopilot";
import {
  APIProvider,
  API_KEY_STORAGE_KEYS,
  DEFAULT_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
} from "./models";

export class GenerationStateManager {
  private static _isGenerating = false;
  private static _listeners: Set<() => void> = new Set();

  static get isGenerating(): boolean {
    return this._isGenerating;
  }

  static setGenerating(value: boolean): void {
    this._isGenerating = value;
    this._listeners.forEach((listener) => listener());
  }

  static addListener(listener: () => void): void {
    this._listeners.add(listener);
  }

  static removeListener(listener: () => void): void {
    this._listeners.delete(listener);
  }
}

export class ValidationStateManager {
  private static _isValidating = false;
  private static _validatingProvider: string | null = null;
  private static _listeners: Set<() => void> = new Set();

  static get isValidating(): boolean {
    return this._isValidating;
  }

  static get validatingProvider(): string | null {
    return this._validatingProvider;
  }

  static setValidating(value: boolean, provider: string | null = null): void {
    this._isValidating = value;
    this._validatingProvider = provider;
    this._listeners.forEach((listener) => listener());
  }

  static addListener(listener: () => void): void {
    this._listeners.add(listener);
  }

  static removeListener(listener: () => void): void {
    this._listeners.delete(listener);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Commit-Copilot extension is now active!");

  const outputChannel = vscode.window.createOutputChannel(
    "Commit-Copilot Debug",
  );
  context.subscriptions.push(outputChannel);

  const provider = new SidePanelProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidePanelProvider.viewType,
      provider,
    ),
  );

  let disposable = vscode.commands.registerCommand(
    "commit-copilot.generate",
    async (arg?: vscode.SourceControl) => {
      GenerationStateManager.setGenerating(true);
      await vscode.commands.executeCommand(
        "setContext",
        "commit-copilot.isGenerating",
        true,
      );

      try {
        outputChannel.appendLine("=".repeat(50));
        outputChannel.appendLine(
          `[${new Date().toISOString()}] Starting commit-copilot generation...`,
        );
        outputChannel.appendLine("Mode: Auto-stage all changes enabled");

        let scm: vscode.SourceControl | undefined;
        if (arg && "rootUri" in arg) {
          scm = arg as vscode.SourceControl;
        }

        const gitExtension =
          vscode.extensions.getExtension("vscode.git")?.exports;
        if (!gitExtension) {
          outputChannel.appendLine("Error: Git extension not found.");
          vscode.window.showErrorMessage(
            "Git extension not found. Please ensure Git is installed and the Git extension is enabled.",
          );
          return;
        }

        const api = gitExtension.getAPI(1);
        outputChannel.appendLine(
          `Git API version: ${api.version ? api.version : "unknown"}`,
        );

        let repository = null;
        if (scm) {
          repository = api.repositories.find(
            (r: any) => r.rootUri.toString() === scm.rootUri?.toString(),
          );
          if (repository) {
            outputChannel.appendLine(
              `Selected repository from SCM context: ${repository.rootUri.fsPath}`,
            );
          }
        }

        if (!repository) {
          if (api.repositories.length > 0) {
            outputChannel.appendLine(
              `Found ${api.repositories.length} repositories.`,
            );
            repository = api.repositories[0];
            outputChannel.appendLine(
              `Selected first repository: ${repository.rootUri.fsPath}`,
            );
          } else {
            outputChannel.appendLine("No repositories found in API.");
          }
        }

        if (!repository) {
          vscode.window.showErrorMessage(
            "No Git repository found. Please open a folder containing a Git repository.",
          );
          return;
        }

        const currentProvider =
          context.globalState.get<APIProvider>("CURRENT_PROVIDER") ||
          DEFAULT_PROVIDER;
        const storageKey = API_KEY_STORAGE_KEYS[currentProvider];
        const apiKey = await context.secrets.get(storageKey);

        outputChannel.appendLine(
          `Using provider: ${PROVIDER_DISPLAY_NAMES[currentProvider]}`,
        );

        if (!apiKey && currentProvider !== "ollama") {
          outputChannel.appendLine(
            `Warning: No API Key found for ${currentProvider}.`,
          );
          const setKeyAction = "Configure API Key";
          const result = await vscode.window.showWarningMessage(
            `${PROVIDER_DISPLAY_NAMES[currentProvider]} API Key is not configured. Please set your API Key in the Commit-Copilot panel first.`,
            setKeyAction,
          );

          if (result === setKeyAction) {
            await vscode.commands.executeCommand("commit-copilot.view.focus");
          }
          return;
        }

        const progressTitle =
          currentProvider === "ollama"
            ? "Ollama"
            : `Generating commit message with ${PROVIDER_DISPLAY_NAMES[currentProvider]}...`;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: progressTitle,
            cancellable: false,
          },
          async (progress) => {
            outputChannel.appendLine("Calling generateCommitMessage...");
            outputChannel.appendLine(
              `Repository path: ${repository.rootUri.fsPath}`,
            );

            const savedModel = context.globalState.get<string>(
              `${currentProvider.toUpperCase()}_MODEL`,
            );
            if (savedModel) {
              outputChannel.appendLine(`Using model: ${savedModel}`);
            }

            const result = await generateCommitMessage({
              cwd: repository.rootUri.fsPath,
              provider: currentProvider,
              apiKey: apiKey || "",
              stageChanges: true,
              model: savedModel,
              onProgress:
                currentProvider === "ollama"
                  ? (message, increment) => {
                      progress.report({ message, increment });
                    }
                  : undefined,
            });

            if (result.success && result.message) {
              outputChannel.appendLine(`Generated message: ${result.message}`);
              repository.inputBox.value = result.message;
              await vscode.commands.executeCommand("workbench.view.scm");
              vscode.window.showInformationMessage("Commit message generated!");
            } else if (result.error) {
              const error = result.error;
              outputChannel.appendLine(
                `Error: ${error.errorCode} - ${error.message}`,
              );

              const errorInfo =
                ERROR_MESSAGES[error.exitCode] ||
                ERROR_MESSAGES[EXIT_CODES.UNKNOWN_ERROR];

              if (
                error.exitCode === EXIT_CODES.API_KEY_MISSING ||
                error.exitCode === EXIT_CODES.API_KEY_INVALID
              ) {
                const action = await vscode.window.showErrorMessage(
                  `${errorInfo.title}: ${error.message}`,
                  "Configure API Key",
                );
                if (action === "Configure API Key") {
                  vscode.commands.executeCommand("commit-copilot.view.focus");
                }
              } else if (error.exitCode === EXIT_CODES.QUOTA_EXCEEDED) {
                const action = await vscode.window.showErrorMessage(
                  `${errorInfo.title}: ${error.message}`,
                  "View Provider Console",
                );
                if (action === "View Provider Console") {
                  const providerUrls: Record<APIProvider, string> = {
                    google: "https://aistudio.google.com/",
                    openai: "https://platform.openai.com/usage",
                    anthropic: "https://console.anthropic.com/",
                    ollama: "http://127.0.0.1:11434",
                  };
                  vscode.env.openExternal(
                    vscode.Uri.parse(providerUrls[currentProvider]),
                  );
                }
              } else if (error.exitCode === EXIT_CODES.NO_CHANGES) {
                vscode.window.showInformationMessage(
                  "No changes to commit. Make some changes first!",
                );
              } else {
                vscode.window.showErrorMessage(
                  `${errorInfo.title}: ${error.message}. ${errorInfo.action || ""}`,
                );
              }
            }
          },
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Unexpected error: ${errorMessage}`);
        vscode.window.showErrorMessage(
          `Commit-Copilot failed: ${errorMessage}`,
        );
      } finally {
        GenerationStateManager.setGenerating(false);
        await vscode.commands.executeCommand(
          "setContext",
          "commit-copilot.isGenerating",
          false,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
