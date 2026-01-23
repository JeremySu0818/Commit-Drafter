import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import { SidePanelProvider } from './SidePanelProvider';

// Exit codes matching the CLI
const EXIT_CODES = {
    SUCCESS: 0,
    NOT_GIT_REPO: 1,
    STAGE_FAILED: 2,
    NO_CHANGES: 3,
    API_KEY_MISSING: 10,
    API_KEY_INVALID: 11,
    QUOTA_EXCEEDED: 12,
    API_ERROR: 13,
    COMMIT_FAILED: 20,
    UNKNOWN_ERROR: 99,
} as const;

// User-friendly error messages
const ERROR_MESSAGES: Record<number, { title: string; action?: string }> = {
    [EXIT_CODES.NOT_GIT_REPO]: {
        title: 'Not a Git repository',
        action: 'Please open a folder that contains a Git repository.',
    },
    [EXIT_CODES.STAGE_FAILED]: {
        title: 'Failed to stage changes',
        action: 'Check if Git is properly configured.',
    },
    [EXIT_CODES.NO_CHANGES]: {
        title: 'No changes to commit',
        action: 'Make some changes to your files first.',
    },
    [EXIT_CODES.API_KEY_MISSING]: {
        title: 'API Key not configured',
        action: 'Please set your Gemini API Key in the Auto-Commit panel.',
    },
    [EXIT_CODES.API_KEY_INVALID]: {
        title: 'Invalid API Key',
        action: 'Your API Key is invalid or has been revoked. Please check and update it.',
    },
    [EXIT_CODES.QUOTA_EXCEEDED]: {
        title: 'API quota exceeded',
        action: 'You have exceeded your API quota. Please check your Google AI Studio account.',
    },
    [EXIT_CODES.API_ERROR]: {
        title: 'API request failed',
        action: 'There was an error communicating with the Gemini API. Please try again.',
    },
    [EXIT_CODES.COMMIT_FAILED]: {
        title: 'Failed to commit changes',
        action: 'Check if there are any Git conflicts or issues.',
    },
    [EXIT_CODES.UNKNOWN_ERROR]: {
        title: 'An unexpected error occurred',
        action: 'Check the "Auto-Commit Debug" output for details.',
    },
};

/**
 * Parse error details from stderr output
 */
function parseStderrError(stderr: string): { errorCode?: string; message?: string } {
    // Try to extract error code from format: [ERROR_CODE] message
    const codeMatch = stderr.match(/\[([A-Z_]+)\]/);
    const errorCode = codeMatch ? codeMatch[1] : undefined;

    // Extract the message after "Error:"
    const messageMatch = stderr.match(/Error:.*?(?:\[[A-Z_]+\])?\s*(.+)/s);
    const message = messageMatch ? messageMatch[1].trim() : stderr.trim();

    return { errorCode, message };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Auto-Commit extension is now active!');

    // Create an output channel for debugging
    const outputChannel = vscode.window.createOutputChannel("Auto-Commit Debug");
    context.subscriptions.push(outputChannel);

    // Register the Side Panel Provider
    const provider = new SidePanelProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidePanelProvider.viewType, provider)
    );

    let disposable = vscode.commands.registerCommand('auto-commit.generate', async (scm?: vscode.SourceControl) => {
        await vscode.commands.executeCommand('setContext', 'auto-commit.isGenerating', true);
        try {
            outputChannel.appendLine('='.repeat(50));
        outputChannel.appendLine(`[${new Date().toISOString()}] Starting auto-commit generation...`);

        // Get the Git extension
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

        // Find the repository
        let repository = null;
        if (scm) {
            // If triggered from SCM title or context menu, find matching repository
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

        // Check if API Key is configured before running
        const apiKey = await context.secrets.get('GEMINI_API_KEY');
        if (!apiKey) {
            outputChannel.appendLine('Warning: No GEMINI_API_KEY found in secure storage.');
            const setKeyAction = 'Set API Key';
            const result = await vscode.window.showWarningMessage(
                'Gemini API Key is not configured. Please set your API Key in the Auto-Commit panel first.',
                setKeyAction
            );
            if (result === setKeyAction) {
                // Focus on the Auto-Commit panel
                await vscode.commands.executeCommand('auto-commit.view.focus');
            }
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Generating commit message...",
                cancellable: false,
            },
            async (progress) => {
                return new Promise<void>(async (resolve) => {
                    // Use the bundled executable
                    const exePath = path.join(context.extensionPath, 'auto-commit.exe');

                    outputChannel.appendLine(`Executable Path: ${exePath}`);

                    const cmd = `"${exePath}" generate --print-only`;
                    outputChannel.appendLine(`Executing command: ${cmd}`);

                    // Prepare environment variables
                    const env = { ...process.env };
                    outputChannel.appendLine('Injecting GEMINI_API_KEY from secure storage.');
                    env['GEMINI_API_KEY'] = apiKey;

                    // Execute with timeout to prevent hanging
                    const timeout = 60000; // 60 seconds
                    const childProcess = exec(
                        cmd,
                        {
                            cwd: repository.rootUri.fsPath,
                            env: env,
                            timeout: timeout,
                        },
                        (error, stdout, stderr) => {
                            outputChannel.appendLine(`Stdout: ${stdout}`);
                            if (stderr) {
                                outputChannel.appendLine(`Stderr: ${stderr}`);
                            }

                            if (error) {
                                outputChannel.appendLine(`Exit Code: ${error.code}`);
                                outputChannel.appendLine(`Error: ${error.message}`);

                                const exitCode = error.code || EXIT_CODES.UNKNOWN_ERROR;
                                const errorInfo = ERROR_MESSAGES[exitCode] || ERROR_MESSAGES[EXIT_CODES.UNKNOWN_ERROR];

                                // Parse additional error details from stderr
                                const { errorCode, message } = parseStderrError(stderr);
                                outputChannel.appendLine(`Parsed Error Code: ${errorCode}`);
                                outputChannel.appendLine(`Parsed Error Message: ${message}`);

                                // Show user-friendly error message
                                let errorMessage = errorInfo.title;
                                if (message) {
                                    errorMessage += `: ${message}`;
                                }

                                // Show error with action button for certain errors
                                if (exitCode === EXIT_CODES.API_KEY_MISSING || exitCode === EXIT_CODES.API_KEY_INVALID) {
                                    vscode.window
                                        .showErrorMessage(errorMessage, 'Configure API Key')
                                        .then((action) => {
                                            if (action === 'Configure API Key') {
                                                vscode.commands.executeCommand('auto-commit.view.focus');
                                            }
                                        });
                                } else if (exitCode === EXIT_CODES.QUOTA_EXCEEDED) {
                                    vscode.window
                                        .showErrorMessage(errorMessage, 'Open Google AI Studio')
                                        .then((action) => {
                                            if (action === 'Open Google AI Studio') {
                                                vscode.env.openExternal(
                                                    vscode.Uri.parse('https://aistudio.google.com/')
                                                );
                                            }
                                        });
                                } else if (exitCode === EXIT_CODES.NO_CHANGES) {
                                    // No changes is not really an error, show as info
                                    vscode.window.showInformationMessage(
                                        'No changes to commit. Make some changes first!'
                                    );
                                } else {
                                    vscode.window.showErrorMessage(
                                        `${errorMessage}. ${errorInfo.action || ''}`
                                    );
                                }

                                resolve();
                                return;
                            }

                            const message = stdout.trim();
                            if (message) {
                                // Check if the message looks like an error (shouldn't happen with proper exit codes)
                                if (message.startsWith('Error:') || message.includes('Error generating')) {
                                    outputChannel.appendLine('Warning: stdout contains error message');
                                    vscode.window.showErrorMessage(message);
                                } else {
                                    outputChannel.appendLine(`Generated message: ${message}`);
                                    repository.inputBox.value = message;
                                    vscode.window.showInformationMessage('Commit message generated!');
                                }
                            } else {
                                outputChannel.appendLine('Stdout was empty after trim.');
                                vscode.window.showWarningMessage(
                                    'Generated message was empty. Check "Auto-Commit Debug" output for details.'
                                );
                            }
                            resolve();
                        }
                    );

                    // Handle timeout
                    childProcess.on('error', (err) => {
                        outputChannel.appendLine(`Process error: ${err.message}`);
                        vscode.window.showErrorMessage(
                            `Failed to run Auto-Commit: ${err.message}`
                        );
                        resolve();
                    });
                });
            }
        );
        } finally {
            await vscode.commands.executeCommand('setContext', 'auto-commit.isGenerating', false);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
