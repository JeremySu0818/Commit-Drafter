import * as vscode from 'vscode';
import { SidePanelProvider } from './SidePanelProvider';
import {
    generateCommitMessage,
    EXIT_CODES,
    ERROR_MESSAGES,
    AutoCommitError,
} from './autoCommit';

export function activate(context: vscode.ExtensionContext) {
    console.log('Auto-Commit extension is now active!');

    const outputChannel = vscode.window.createOutputChannel("Auto-Commit Debug");
    context.subscriptions.push(outputChannel);

    const provider = new SidePanelProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidePanelProvider.viewType, provider)
    );

    let disposable = vscode.commands.registerCommand('auto-commit.generate', async (arg?: vscode.SourceControl | { stageUntrackedOnly?: boolean }) => {
        await vscode.commands.executeCommand('setContext', 'auto-commit.isGenerating', true);
        try {
            outputChannel.appendLine('='.repeat(50));
            outputChannel.appendLine(`[${new Date().toISOString()}] Starting auto-commit generation...`);

            // Determine inputs
            let scm: vscode.SourceControl | undefined;
            let stageUntrackedOnly = false;

            if (arg && 'rootUri' in arg) {
                scm = arg as vscode.SourceControl;
            } else if (arg && typeof arg === 'object' && 'stageUntrackedOnly' in arg) {
                stageUntrackedOnly = !!(arg as { stageUntrackedOnly?: boolean }).stageUntrackedOnly;
            } else if (arg && typeof arg === 'object') {
               // Handle case where arg is just an object but maybe missing the specific key, or other future args
               // For now just assume if it's not SourceControl, we treat properties as options
               if ('stageUntrackedOnly' in arg) {
                    stageUntrackedOnly = !!(arg as any).stageUntrackedOnly;
               }
            }

            // Get Git extension and repository
            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) {
                outputChannel.appendLine('Error: Git extension not found.');
                vscode.window.showErrorMessage(
                    'Git extension not found. Please ensure Git is installed and the Git extension is enabled.'
                );
                return;
            }

            const api = gitExtension.getAPI(1);
            outputChannel.appendLine(`Git API version: ${api.version ? api.version : 'unknown'}`);

            let repository = null;
            if (scm) {
                repository = api.repositories.find((r: any) => r.rootUri.toString() === scm.rootUri?.toString());
                if (repository) {
                    outputChannel.appendLine(`Selected repository from SCM context: ${repository.rootUri.fsPath}`);
                }
            }

            if (!repository) {
                if (api.repositories.length > 0) {
                    outputChannel.appendLine(`Found ${api.repositories.length} repositories.`);
                    repository = api.repositories[0];
                    outputChannel.appendLine(`Selected first repository: ${repository.rootUri.fsPath}`);
                } else {
                    outputChannel.appendLine('No repositories found in API.');
                }
            }

            if (!repository) {
                vscode.window.showErrorMessage(
                    'No Git repository found. Please open a folder containing a Git repository.'
                );
                return;
            }

            // Get API key from secure storage
            const apiKey = await context.secrets.get('GEMINI_API_KEY');
            if (!apiKey) {
                outputChannel.appendLine('Warning: No GEMINI_API_KEY found in secure storage.');
                const setKeyAction = 'Set API Key';
                const result = await vscode.window.showWarningMessage(
                    'Gemini API Key is not configured. Please set your API Key in the Auto-Commit panel first.',
                    setKeyAction
                );
                if (result === setKeyAction) {
                    await vscode.commands.executeCommand('auto-commit.view.focus');
                }
                return;
            }

            // Generate commit message with progress indicator
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Generating commit message...",
                    cancellable: false,
                },
                async (progress) => {
                    outputChannel.appendLine('Calling generateCommitMessage...');
                    outputChannel.appendLine(`Repository path: ${repository.rootUri.fsPath}`);
                    outputChannel.appendLine(`Stage untracked only: ${stageUntrackedOnly}`);

                    const result = await generateCommitMessage({
                        cwd: repository.rootUri.fsPath,
                        apiKey: apiKey,
                        stageChanges: false,
                        stageUntrackedOnly: stageUntrackedOnly,
                    });

                    if (result.success && result.message) {
                        outputChannel.appendLine(`Generated message: ${result.message}`);
                        repository.inputBox.value = result.message;
                        
                        // 自動跳轉到 Source Control 視圖
                        await vscode.commands.executeCommand('workbench.view.scm');
                        
                        vscode.window.showInformationMessage('Commit message generated!');
                    } else if (result.error) {
                        const error = result.error;
                        outputChannel.appendLine(`Error: ${error.errorCode} - ${error.message}`);

                        const errorInfo = ERROR_MESSAGES[error.exitCode] || ERROR_MESSAGES[EXIT_CODES.UNKNOWN_ERROR];

                        if (error.exitCode === EXIT_CODES.API_KEY_MISSING || error.exitCode === EXIT_CODES.API_KEY_INVALID) {
                            const action = await vscode.window.showErrorMessage(
                                `${errorInfo.title}: ${error.message}`,
                                'Configure API Key'
                            );
                            if (action === 'Configure API Key') {
                                vscode.commands.executeCommand('auto-commit.view.focus');
                            }
                        } else if (error.exitCode === EXIT_CODES.QUOTA_EXCEEDED) {
                            const action = await vscode.window.showErrorMessage(
                                `${errorInfo.title}: ${error.message}`,
                                'Open Google AI Studio'
                            );
                            if (action === 'Open Google AI Studio') {
                                vscode.env.openExternal(
                                    vscode.Uri.parse('https://aistudio.google.com/')
                                );
                            }
                        } else if (error.exitCode === EXIT_CODES.NO_CHANGES) {
                            vscode.window.showInformationMessage(
                                'No changes to commit. Make some changes first!'
                            );
                        } else {
                            vscode.window.showErrorMessage(
                                `${errorInfo.title}: ${error.message}. ${errorInfo.action || ''}`
                            );
                        }
                    }
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`Unexpected error: ${errorMessage}`);
            vscode.window.showErrorMessage(`Auto-Commit failed: ${errorMessage}`);
        } finally {
            await vscode.commands.executeCommand('setContext', 'auto-commit.isGenerating', false);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}