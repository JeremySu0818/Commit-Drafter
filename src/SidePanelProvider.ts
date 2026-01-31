// src/SidePanelProvider.ts

import * as vscode from "vscode";
import {
  APIProvider,
  PROVIDER_DISPLAY_NAMES,
  MODELS_BY_PROVIDER,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  API_KEY_STORAGE_KEYS,
  OLLAMA_DEFAULT_HOST,
} from "./models";
import { GenerationStateManager, ValidationStateManager } from "./extension";

export class SidePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "commit-copilot.view";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  private async validateGoogleApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      if (response.ok) {
        return { valid: true };
      }
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const errorMessage = errorData?.error?.message || response.statusText;
      if (
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403
      ) {
        return { valid: false, error: `Invalid API Key: ${errorMessage}` };
      } else if (response.status === 429) {
        return { valid: false, error: `API quota exceeded: ${errorMessage}` };
      } else {
        return {
          valid: false,
          error: `API request failed (${response.status}): ${errorMessage}`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { valid: false, error: `Connection error: ${errorMessage}` };
    }
  }

  private async validateOpenAIApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (response.ok) {
        return { valid: true };
      }
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const errorMessage = errorData?.error?.message || response.statusText;
      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: `Invalid API Key: ${errorMessage}` };
      } else if (response.status === 429) {
        return { valid: false, error: `API quota exceeded: ${errorMessage}` };
      } else {
        return {
          valid: false,
          error: `API request failed (${response.status}): ${errorMessage}`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { valid: false, error: `Connection error: ${errorMessage}` };
    }
  }

  private async validateAnthropicApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      if (response.ok || response.status === 200) {
        return { valid: true };
      }
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const errorMessage = errorData?.error?.message || response.statusText;
      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: `Invalid API Key: ${errorMessage}` };
      } else if (response.status === 429) {
        return { valid: false, error: `API quota exceeded: ${errorMessage}` };
      } else {
        return { valid: true };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { valid: false, error: `Connection error: ${errorMessage}` };
    }
  }

  private async validateOllamaHost(
    host: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const hostUrl = host || OLLAMA_DEFAULT_HOST;
      const response = await fetch(`${hostUrl}/api/tags`, {
        method: "GET",
      });
      if (response.ok) {
        return { valid: true };
      }
      return {
        valid: false,
        error: `Cannot connect to Ollama at ${hostUrl}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        error: `Cannot connect to Ollama: ${errorMessage}. Make sure Ollama is running.`,
      };
    }
  }

  private async validateApiKey(
    provider: APIProvider,
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    switch (provider) {
      case "google":
        return this.validateGoogleApiKey(apiKey);
      case "openai":
        return this.validateOpenAIApiKey(apiKey);
      case "anthropic":
        return this.validateAnthropicApiKey(apiKey);
      case "ollama":
        return this.validateOllamaHost(apiKey);
      default:
        return { valid: false, error: "Unknown provider" };
    }
  }

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

    const onGenerationStateChange = () => {
      this._view?.webview.postMessage({
        type: "generationStatusUpdate",
        isGenerating: GenerationStateManager.isGenerating,
      });
    };
    GenerationStateManager.addListener(onGenerationStateChange);

    const onValidationStateChange = () => {
      this._view?.webview.postMessage({
        type: "validationStatusUpdate",
        isValidating: ValidationStateManager.isValidating,
        provider: ValidationStateManager.validatingProvider,
      });
    };
    ValidationStateManager.addListener(onValidationStateChange);

    webviewView.onDidDispose(() => {
      GenerationStateManager.removeListener(onGenerationStateChange);
      ValidationStateManager.removeListener(onValidationStateChange);
    });

    const checkGitStatus = () => {
      try {
        const gitExtension = vscode.extensions.getExtension<any>("vscode.git");
        if (!gitExtension?.isActive) {
          return;
        }
        const git = gitExtension.exports?.getAPI?.(1);
        if (!git) {
          return;
        }
        if (git.repositories.length > 0) {
          const repo = git.repositories[0];
          const hasChanges =
            repo.state.workingTreeChanges.length > 0 ||
            repo.state.indexChanges.length > 0;
          webviewView.webview.postMessage({ type: "repoUpdate", hasChanges });
        } else {
          webviewView.webview.postMessage({
            type: "repoUpdate",
            hasChanges: false,
          });
        }
      } catch (error) {
        console.error("[Commit-Copilot] Error checking git status:", error);
      }
    };

    try {
      const gitExtension = vscode.extensions.getExtension<any>("vscode.git");
      if (gitExtension?.isActive && gitExtension.exports) {
        const git = gitExtension.exports.getAPI?.(1);
        if (git) {
          const setupRepoListeners = () => {
            if (git.repositories.length > 0) {
              checkGitStatus();
              git.repositories.forEach((repo: any) => {
                repo.state.onDidChange(() => {
                  checkGitStatus();
                });
              });
            }
          };

          if (git.state === "initialized") {
            setupRepoListeners();
          } else {
            git.onDidChangeState?.((state: any) => {
              if (state === "initialized") {
                setupRepoListeners();
              }
            });
          }

          git.onDidOpenRepository?.((repo: any) => {
            repo.state.onDidChange(() => {
              checkGitStatus();
            });
            checkGitStatus();
          });

          if (git.repositories.length > 0) {
            setupRepoListeners();
          }
        }
      } else if (gitExtension && !gitExtension.isActive) {
        (async () => {
          try {
            await gitExtension.activate();
            const git = gitExtension.exports?.getAPI?.(1);
            if (git) {
              checkGitStatus();
              git.onDidOpenRepository?.((repo: any) => {
                repo.state.onDidChange(() => {
                  checkGitStatus();
                });
                checkGitStatus();
              });
            }
          } catch (err) {
            console.error(
              "[Commit-Copilot] Failed to activate git extension:",
              err,
            );
          }
        })();
      }
    } catch (error) {
      console.error("[Commit-Copilot] Error setting up git listeners:", error);
    }

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "saveKey": {
          const provider = data.provider as APIProvider;
          const apiKey = data.value;
          if (!apiKey && provider !== "ollama") {
            vscode.window.showErrorMessage("API Key cannot be empty");
            this._view?.webview.postMessage({
              type: "validationResult",
              success: false,
              provider,
            });
            return;
          }
          ValidationStateManager.setValidating(true, provider);
          this._view?.webview.postMessage({ type: "validating", provider });
          try {
            const validationResult = await this.validateApiKey(
              provider,
              apiKey || OLLAMA_DEFAULT_HOST,
            );
            if (!validationResult.valid) {
              vscode.window.showWarningMessage(
                `Validation failed: ${validationResult.error || "Unable to connect"}`,
              );
              this._view?.webview.postMessage({
                type: "validationResult",
                success: false,
                error: validationResult.error,
                provider,
              });
              return;
            }
            try {
              const storageKey = API_KEY_STORAGE_KEYS[provider];
              await this._context.secrets.store(
                storageKey,
                apiKey || OLLAMA_DEFAULT_HOST,
              );
              vscode.window.showInformationMessage(
                `${PROVIDER_DISPLAY_NAMES[provider]} configuration saved successfully!`,
              );
              this._view?.webview.postMessage({
                type: "validationResult",
                success: true,
                models: MODELS_BY_PROVIDER[provider],
                provider,
              });
              this._view?.webview.postMessage({
                type: "keyStatus",
                hasKey: true,
                provider,
              });
            } catch (e) {
              vscode.window.showErrorMessage("Failed to save configuration");
              this._view?.webview.postMessage({
                type: "validationResult",
                success: false,
                provider,
              });
            }
          } finally {
            ValidationStateManager.setValidating(false, null);
          }
          break;
        }
        case "generate": {
          try {
            await vscode.commands.executeCommand("commit-copilot.generate");
          } finally {
            this._view?.webview.postMessage({ type: "generationDone" });
          }
          break;
        }
        case "checkKey": {
          const provider = (data.provider as APIProvider) || DEFAULT_PROVIDER;
          const storageKey = API_KEY_STORAGE_KEYS[provider];
          const key = await this._context.secrets.get(storageKey);
          this._view?.webview.postMessage({
            type: "keyStatus",
            hasKey: !!key,
            provider,
          });
          break;
        }
        case "checkGit": {
          checkGitStatus();
          break;
        }
        case "getModels": {
          const provider = (data.provider as APIProvider) || DEFAULT_PROVIDER;
          const storageKey = API_KEY_STORAGE_KEYS[provider];
          const key = await this._context.secrets.get(storageKey);
          if (key || provider === "ollama") {
            const savedModel = this._context.globalState.get<string>(
              `${provider.toUpperCase()}_MODEL`,
            );
            this._view?.webview.postMessage({
              type: "modelsList",
              models: MODELS_BY_PROVIDER[provider],
              currentModel: savedModel || DEFAULT_MODELS[provider],
              provider,
            });
          }
          break;
        }
        case "saveModel": {
          const provider = (data.provider as APIProvider) || DEFAULT_PROVIDER;
          await this._context.globalState.update(
            `${provider.toUpperCase()}_MODEL`,
            data.value,
          );
          break;
        }
        case "saveProvider": {
          await this._context.globalState.update(
            "CURRENT_PROVIDER",
            data.value,
          );
          break;
        }
        case "getProvider": {
          const savedProvider =
            this._context.globalState.get<APIProvider>("CURRENT_PROVIDER");
          this._view?.webview.postMessage({
            type: "currentProvider",
            provider: savedProvider || DEFAULT_PROVIDER,
          });
          break;
        }
        case "getAllKeys": {
          const keyStatuses: Record<APIProvider, boolean> = {
            google: false,
            openai: false,
            anthropic: false,
            ollama: true,
          };
          for (const [provider, storageKey] of Object.entries(
            API_KEY_STORAGE_KEYS,
          )) {
            const key = await this._context.secrets.get(storageKey);
            keyStatuses[provider as APIProvider] = !!key;
          }
          this._view?.webview.postMessage({
            type: "allKeyStatuses",
            statuses: keyStatuses,
          });
          break;
        }
        case "checkGenerationStatus": {
          this._view?.webview.postMessage({
            type: "generationStatusUpdate",
            isGenerating: GenerationStateManager.isGenerating,
          });
          break;
        }
        case "checkValidationStatus": {
          this._view?.webview.postMessage({
            type: "validationStatusUpdate",
            isValidating: ValidationStateManager.isValidating,
            provider: ValidationStateManager.validatingProvider,
          });
          break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();
    const providersJson = JSON.stringify(PROVIDER_DISPLAY_NAMES);
    const modelsJson = JSON.stringify(MODELS_BY_PROVIDER);
    const defaultModelsJson = JSON.stringify(DEFAULT_MODELS);
    const defaultProvider = DEFAULT_PROVIDER;
    const ollamaDefaultHost = OLLAMA_DEFAULT_HOST;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Commit Copilot</title>
  <style>
    body { 
      font-family: var(--vscode-font-family); 
      padding: 12px; 
      margin: 0;
    }
    .container { 
      display: flex; 
      flex-direction: column; 
      gap: 16px; 
    }
    .input-group { 
      display: flex; 
      flex-direction: column; 
      gap: 6px; 
    }
    label { 
      font-weight: 600; 
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-foreground);
      opacity: 0.8;
    }
    input { 
      padding: 8px 10px; 
      background: var(--vscode-input-background); 
      color: var(--vscode-input-foreground); 
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-size: 13px;
    }
    input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    button { 
      padding: 10px 14px; 
      background: var(--vscode-button-background); 
      color: var(--vscode-button-foreground); 
      border: none; 
      cursor: pointer;
      border-radius: 4px;
      font-weight: 500;
      font-size: 13px;
      transition: background 0.15s ease;
    }
    button:hover { 
      background: var(--vscode-button-hoverBackground); 
    }
    button:disabled, select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button.primary {
      background: var(--vscode-button-background);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    select {
      padding: 8px 10px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
    }
    select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .status { 
      font-size: 11px; 
      color: var(--vscode-descriptionForeground); 
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-dot.success {
      background: var(--vscode-testing-iconPassed);
    }
    .status-dot.error {
      background: var(--vscode-testing-iconFailed);
    }
    .status-dot.warning {
      background: var(--vscode-testing-iconQueued);
    }
    hr { 
      border: 0; 
      border-top: 1px solid var(--vscode-widget-border); 
      width: 100%; 
      margin: 4px 0;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 4px;
    }
    .config-section {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 12px;
    }
    .provider-info {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      line-height: 1.5;
    }
    .provider-info a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .provider-info a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="config-section">
      <div class="section-title"> API Provider</div>
      <div class="input-group" style="margin-top: 10px;">
        <label>Provider</label>
        <select id="providerSelect">
          <option value="" disabled>Select a provider...</option>
        </select>
      </div>
    </div>
    <div class="config-section">
      <div class="section-title" id="configTitle"> Configuration</div>
      <div class="input-group" style="margin-top: 10px;">
        <label id="apiKeyLabel">API Key</label>
        <input type="password" id="apiKey" placeholder="Enter your API Key">
        <button id="saveBtn" disabled>Save</button>
        <span id="keyStatus" class="status">
          <span class="status-dot warning"></span>
          Checking status...
        </span>
      </div>
      <div class="provider-info" id="providerInfo"></div>
    </div>
    <div class="config-section">
      <div class="section-title"> Model</div>
      <div class="input-group" style="margin-top: 10px;">
        <label>Model</label>
        <select id="modelSelect" disabled>
          <option value="" disabled selected>Select a model...</option>
        </select>
      </div>
    </div>
    <hr />
    <div class="input-group">
      <button id="generateBtn" class="primary" disabled>
         Generate Commit Message
      </button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providers = ${providersJson};
    const modelsByProvider = ${modelsJson};
    const defaultModels = ${defaultModelsJson};
    const defaultProvider = '${defaultProvider}';
    const ollamaDefaultHost = '${ollamaDefaultHost}';
    const providerSelect = document.getElementById('providerSelect');
    const saveBtn = document.getElementById('saveBtn');
    const generateBtn = document.getElementById('generateBtn');
    const apiKeyInput = document.getElementById('apiKey');
    const apiKeyLabel = document.getElementById('apiKeyLabel');
    const keyStatus = document.getElementById('keyStatus');
    const modelSelect = document.getElementById('modelSelect');
    const providerInfo = document.getElementById('providerInfo');
    const configTitle = document.getElementById('configTitle');

    let isGenerating = false;
    let hasChanges = false;
    let currentProvider = defaultProvider;
    let keyStatuses = {};

    Object.entries(providers).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      providerSelect.appendChild(option);
    });

    function updateProviderUI(provider) {
      currentProvider = provider;
      providerSelect.value = provider;
      if (provider === 'ollama') {
        apiKeyLabel.textContent = 'Ollama Host URL';
        apiKeyInput.placeholder = ollamaDefaultHost;
        apiKeyInput.type = 'text';
        configTitle.textContent = ' Ollama Configuration';
        providerInfo.innerHTML = \`
          <strong>Ollama</strong> runs locally on your machine.<br>
          Default host: <code>\${ollamaDefaultHost}</code><br>
          Make sure Ollama is running before generating.
        \`;
      } else {
        apiKeyLabel.textContent = 'API Key';
        apiKeyInput.type = 'password';
        configTitle.textContent = ' API Configuration';
        if (provider === 'google') {
          apiKeyInput.placeholder = 'Enter your Gemini API Key';
          providerInfo.innerHTML = \`
            Get your API key from <strong>Google AI Studio</strong>:<br>
            <a href="https://aistudio.google.com/app/apikey" style="color: var(--vscode-textLink-foreground);">aistudio.google.com</a>
          \`;
        } else if (provider === 'openai') {
          apiKeyInput.placeholder = 'Enter your OpenAI API Key';
          providerInfo.innerHTML = \`
            Get your API key from <strong>OpenAI Platform</strong>:<br>
            <a href="https://platform.openai.com/api-keys" style="color: var(--vscode-textLink-foreground);">platform.openai.com</a>
          \`;
        } else if (provider === 'anthropic') {
          apiKeyInput.placeholder = 'Enter your Anthropic API Key';
          providerInfo.innerHTML = \`
            Get your API key from <strong>Anthropic Console</strong>:<br>
            <a href="https://platform.claude.com/settings/keys" style="color: var(--vscode-textLink-foreground);">platform.claude.com</a>
          \`;
        }
      }
      vscode.postMessage({ type: 'checkKey', provider });
      vscode.postMessage({ type: 'getModels', provider });
    }

    function updateGenerateBtn() {
      if (isGenerating) {
        generateBtn.disabled = true;
        generateBtn.textContent = ' Generating...';
      } else if (!hasChanges) {
        generateBtn.disabled = true;
        generateBtn.textContent = ' Generate Commit Message';
        generateBtn.title = 'No changes detected';
      } else {
        generateBtn.disabled = false;
        generateBtn.textContent = ' Generate Commit Message';
        generateBtn.title = '';
      }
    }

    function updateKeyStatus(hasKey, provider) {
      const statusDot = keyStatus.querySelector('.status-dot');
      if (hasKey) {
        statusDot.className = 'status-dot success';
        keyStatus.innerHTML = '<span class="status-dot success"></span>Configured ';
        modelSelect.disabled = false;
      } else {
        statusDot.className = 'status-dot error';
        keyStatus.innerHTML = '<span class="status-dot error"></span>Not configured';
        if (provider !== 'ollama') {
          modelSelect.disabled = true;
        }
      }
    }

    vscode.postMessage({ type: 'getProvider' });
    vscode.postMessage({ type: 'checkGit' });
    vscode.postMessage({ type: 'getAllKeys' });
    vscode.postMessage({ type: 'checkGenerationStatus' });
    vscode.postMessage({ type: 'checkValidationStatus' });

    providerSelect.addEventListener('change', () => {
      const provider = providerSelect.value;
      updateProviderUI(provider);
      vscode.postMessage({ type: 'saveProvider', value: provider });
      apiKeyInput.value = '';
      saveBtn.disabled = provider !== 'ollama';
    });

    apiKeyInput.addEventListener('input', () => {
      if (currentProvider === 'ollama') {
        saveBtn.disabled = false; 
      } else {
        saveBtn.disabled = !apiKeyInput.value.trim();
      }
    });

    saveBtn.addEventListener('click', () => {
      const key = apiKeyInput.value || (currentProvider === 'ollama' ? ollamaDefaultHost : '');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Validating...';
      keyStatus.innerHTML = '<span class="status-dot warning"></span>Validating...';
      vscode.postMessage({ type: 'saveKey', value: key, provider: currentProvider });
    });

    generateBtn.addEventListener('click', () => {
      isGenerating = true;
      updateGenerateBtn();
      vscode.postMessage({ type: 'generate' });
    });

    modelSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'saveModel', value: modelSelect.value, provider: currentProvider });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'currentProvider':
          updateProviderUI(message.provider);
          break;
        case 'repoUpdate':
          hasChanges = message.hasChanges;
          updateGenerateBtn();
          break;
        case 'keyStatus':
          updateKeyStatus(message.hasKey, message.provider);
          break;
        case 'allKeyStatuses':
          keyStatuses = message.statuses;
          break;
        case 'modelsList':
          populateModels(message.models, message.currentModel);
          break;
        case 'validating':
          saveBtn.disabled = true;
          saveBtn.textContent = 'Validating...';
          keyStatus.innerHTML = '<span class="status-dot warning"></span>Validating...';
          break;
        case 'validationResult':
          if (message.success) {
            keyStatus.innerHTML = '<span class="status-dot success"></span>Saved ';
            apiKeyInput.value = '';
            saveBtn.disabled = currentProvider !== 'ollama';
            saveBtn.textContent = 'Save';
            if (message.models) {
              populateModels(message.models);
            }
            modelSelect.disabled = false;
          } else {
            keyStatus.innerHTML = '<span class="status-dot error"></span>' + (message.error || 'Validation failed');
            saveBtn.disabled = currentProvider === 'ollama' ? false : !apiKeyInput.value.trim();
            saveBtn.textContent = 'Save';
          }
          break;
        case 'generationDone':
          isGenerating = false;
          updateGenerateBtn();
          break;
        case 'generationStatusUpdate':
          isGenerating = message.isGenerating;
          updateGenerateBtn();
          break;
        case 'validationStatusUpdate':
          if (message.isValidating && message.provider === currentProvider) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Validating...';
            keyStatus.innerHTML = '<span class="status-dot warning"></span>Validating...';
          }
          break;
      }
    });

    function populateModels(models, currentModel) {
      modelSelect.innerHTML = '';
      let foundCurrent = false;
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        if (model === currentModel) {
          option.selected = true;
          foundCurrent = true;
        }
        modelSelect.appendChild(option);
      });
      modelSelect.disabled = false;
      if (!foundCurrent && models.length > 0) {
        const preferredDefault = defaultModels[currentProvider] || models[0];
        const preferred = models.find(m => m === preferredDefault) || models[0];
        modelSelect.value = preferred;
        vscode.postMessage({ type: 'saveModel', value: preferred, provider: currentProvider });
      }
    }
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
