import * as vscode from "vscode";

export class SidePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "auto-commit.view";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "saveKey": {
          if (!data.value) {
            vscode.window.showErrorMessage("API Key cannot be empty");
            return;
          }
          try {
            await this._context.secrets.store("GEMINI_API_KEY", data.value);
            vscode.window.showInformationMessage("API Key saved securely!");
            this._view?.webview.postMessage({
              type: "status",
              value: "Key saved",
            });
          } catch (e) {
            vscode.window.showErrorMessage("Failed to save API Key");
          }
          break;
        }
        case "generate": {
          vscode.commands.executeCommand("auto-commit.generate");
          break;
        }
        case "checkKey": {
          const key = await this._context.secrets.get("GEMINI_API_KEY");
          this._view?.webview.postMessage({ type: "keyStatus", hasKey: !!key });
          break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Inline styles for simplicity or could be in a separate file
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Auto Commit</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 10px; }
                    .container { display: flex; flex-direction: column; gap: 15px; }
                    .input-group { display: flex; flex-direction: column; gap: 5px; }
                    label { font-weight: bold; }
                    input { 
                        padding: 5px; 
                        background: var(--vscode-input-background); 
                        color: var(--vscode-input-foreground); 
                        border: 1px solid var(--vscode-input-border); 
                    }
                    button { 
                        padding: 8px; 
                        background: var(--vscode-button-background); 
                        color: var(--vscode-button-foreground); 
                        border: none; 
                        cursor: pointer; 
                    }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    .status { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-top: 5px; }
                    hr { border: 0; border-top: 1px solid var(--vscode-widget-border); width: 100%; }
                </style>
			</head>
			<body>
                <div class="container">
                    <div class="input-group">
                        <label>Gemini API Key</label>
                        <input type="password" id="apiKey" placeholder="Enter your Gemini API Key">
                        <button id="saveBtn">Save Key</button>
                        <span id="keyStatus" class="status">Checking key status...</span>
                    </div>
                    
                    <hr />

                    <div class="input-group">
                        <button id="generateBtn">Generate Commit Message</button>
                    </div>
                </div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    const saveBtn = document.getElementById('saveBtn');
                    const generateBtn = document.getElementById('generateBtn');
                    const apiKeyInput = document.getElementById('apiKey');
                    const keyStatus = document.getElementById('keyStatus');

                    // Check status on load
                    vscode.postMessage({ type: 'checkKey' });

                    saveBtn.addEventListener('click', () => {
                        const key = apiKeyInput.value;
                        if(key) {
                            vscode.postMessage({ type: 'saveKey', value: key });
                            apiKeyInput.value = ''; // Clear input
                        }
                    });

                    generateBtn.addEventListener('click', () => {
                        vscode.postMessage({ type: 'generate' });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'status':
                                keyStatus.textContent = message.value;
                                break;
                            case 'keyStatus':
                                if (message.hasKey) {
                                    keyStatus.textContent = '✅ API Key is set';
                                    keyStatus.style.color = 'var(--vscode-testing-iconPassed)';
                                } else {
                                    keyStatus.textContent = '❌ API Key not set';
                                    keyStatus.style.color = 'var(--vscode-testing-iconFailed)';
                                }
                                break;
                        }
                    });
                </script>
			</body>
			</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
