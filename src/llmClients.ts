// src/llmClients.ts

import { APIProvider, DEFAULT_MODELS, OLLAMA_DEFAULT_HOST } from "./models";
import {
  APIKeyMissingError,
  APIKeyInvalidError,
  APIQuotaExceededError,
  APIRequestError,
  NoChangesError,
} from "./errors";

const SYSTEM_PROMPT = `You are a senior software engineer acting as an autonomous commit message generator.
Your task is to generate a clean, concise, and meaningful content for a git commit based on the provided diff.

**Constraint Checklist & Confidence Score:**
1. Language: English Only.
2. Format: Conventional Commits (Strictly).
- \`type(scope): description\` (First line, max 50 chars ideally, absolute max 72)
- (Optional) Body lines (Wrap at 72 chars)
- (Optional) Footer (e.g., BREAKING CHANGE: ...)
3. NO Emojis.
4. Do not include "Signed-off-by" or other metadata unless strictly necessary.
5. Content: specific and descriptive. Avoid vague messages like "fixed bug" or "updated code".

**Types:**
- \`feat\`: A new feature
- \`fix\`: A bug fix
- \`docs\`: Documentation only changes
- \`style\`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- \`refactor\`: A code change that neither fixes a bug nor adds a feature
- \`perf\`: A code change that improves performance
- \`test\`: Adding missing tests or correcting existing tests
- \`build\`: Changes that affect the build system or external dependencies
- \`ci\`: Changes to our CI configuration files and scripts
- \`chore\`: Other changes that don't modify src or test files

**Output Format:**
Return ONLY the commit message. Do not output markdown code blocks (\`\`\`), do not output explanations. Just the raw commit message string.`;

export interface LLMClientOptions {
  provider: APIProvider;
  apiKey: string;
  model?: string;
}

export type ProgressCallback = (message: string, increment?: number) => void;

export interface ILLMClient {
  generateCommitMessage(
    diff: string,
    onProgress?: ProgressCallback,
  ): Promise<string>;
}

export class GeminiClient implements ILLMClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new APIKeyMissingError();
    }
    this.apiKey = apiKey;
    this.model = (model || DEFAULT_MODELS.google).replace(/^models\//, "");
  }

  async generateCommitMessage(diff: string): Promise<string> {
    if (!diff.trim()) {
      throw new NoChangesError();
    }

    try {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const client = new GoogleGenerativeAI(this.apiKey);
      const generativeModel = client.getGenerativeModel({
        model: this.model,
        systemInstruction: SYSTEM_PROMPT,
      });

      const result = await generativeModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: `Here is the git diff:\n\n${diff}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
        },
      });

      const response = result.response;
      const text = response.text();

      if (!text) {
        throw new APIRequestError("Empty response from Gemini API");
      }

      return text.trim();
    } catch (error: any) {
      if (
        error instanceof NoChangesError ||
        error instanceof APIKeyMissingError
      ) {
        throw error;
      }

      const message = error?.message || String(error);

      if (
        message.includes("API_KEY_INVALID") ||
        message.includes("401") ||
        message.includes("403")
      ) {
        throw new APIKeyInvalidError(message);
      } else if (message.includes("429") || message.includes("quota")) {
        throw new APIQuotaExceededError(message);
      }

      throw new APIRequestError(message);
    }
  }
}

export class OpenAIClient implements ILLMClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new APIKeyMissingError();
    }
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODELS.openai;
  }

  async generateCommitMessage(diff: string): Promise<string> {
    if (!diff.trim()) {
      throw new NoChangesError();
    }

    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey: this.apiKey });
      const completion = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Here is the git diff:\n\n${diff}` },
        ],
      });

      const text = completion.choices[0]?.message?.content;

      if (!text) {
        throw new APIRequestError("Empty response from OpenAI API");
      }

      return text.trim();
    } catch (error: any) {
      if (
        error instanceof NoChangesError ||
        error instanceof APIKeyMissingError
      ) {
        throw error;
      }

      const message = error?.message || String(error);
      const status = error?.status;

      if (
        status === 401 ||
        status === 403 ||
        message.includes("Invalid API Key")
      ) {
        throw new APIKeyInvalidError(message);
      } else if (status === 429 || message.includes("rate limit")) {
        throw new APIQuotaExceededError(message);
      }

      throw new APIRequestError(message);
    }
  }
}

export class AnthropicClient implements ILLMClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new APIKeyMissingError();
    }
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODELS.anthropic;
  }

  async generateCommitMessage(diff: string): Promise<string> {
    if (!diff.trim()) {
      throw new NoChangesError();
    }

    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: this.apiKey });
      const message = await client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `Here is the git diff:\n\n${diff}` },
        ],
      });

      const textBlock = message.content.find(
        (block: { type: string }) => block.type === "text",
      );
      const text =
        textBlock && textBlock.type === "text" ? (textBlock as any).text : null;

      if (!text) {
        throw new APIRequestError("Empty response from Anthropic API");
      }

      return text.trim();
    } catch (error: any) {
      if (
        error instanceof NoChangesError ||
        error instanceof APIKeyMissingError
      ) {
        throw error;
      }

      const message = error?.message || String(error);
      const status = error?.status;

      if (
        status === 401 ||
        status === 403 ||
        message.includes("invalid_api_key")
      ) {
        throw new APIKeyInvalidError(message);
      } else if (status === 429 || message.includes("rate_limit")) {
        throw new APIQuotaExceededError(message);
      }

      throw new APIRequestError(message);
    }
  }
}

export class OllamaClient implements ILLMClient {
  private readonly host: string;
  private readonly model: string;

  constructor(host?: string, model?: string) {
    this.host = host || OLLAMA_DEFAULT_HOST;
    this.model = model || DEFAULT_MODELS.ollama;
  }

  async generateCommitMessage(
    diff: string,
    onProgress?: ProgressCallback,
  ): Promise<string> {
    if (!diff.trim()) {
      throw new NoChangesError();
    }

    try {
      const { Ollama } = await import("ollama");
      const client = new Ollama({ host: this.host });

      const pullStream = await client.pull({ model: this.model, stream: true });
      let lastPercent = 0;
      for await (const part of pullStream) {
        if (part.total && part.completed) {
          const percent = Math.round((part.completed / part.total) * 100);
          if (percent > lastPercent) {
            const increment = percent - lastPercent;
            lastPercent = percent;
            if (onProgress) {
              onProgress(
                `Pulling ${this.model}: ${part.status} (${percent}%)`,
                increment,
              );
            }
          }
        } else if (part.status && onProgress) {
          onProgress(`Pulling ${this.model}: ${part.status}`);
        }
      }

      if (onProgress) {
        onProgress("Generating commit message...", 0);
      }

      const response = await client.chat({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Here is the git diff:\n\n${diff}` },
        ],
        options: {
          temperature: 0.7,
          top_p: 0.95,
        },
      });

      const text = response.message?.content;

      if (!text) {
        throw new APIRequestError("Empty response from Ollama");
      }

      return text.trim();
    } catch (error: any) {
      if (error instanceof NoChangesError) {
        throw error;
      }

      const message = error?.message || String(error);

      if (message.includes("ECONNREFUSED") || message.includes("connect")) {
        throw new APIRequestError(
          `Cannot connect to Ollama. Make sure Ollama is running at ${this.host}`,
        );
      } else if (message.includes("model") && message.includes("not found")) {
        throw new APIRequestError(
          `Model "${this.model}" not found. Please pull it first with: ollama pull ${this.model}`,
        );
      }

      throw new APIRequestError(message);
    }
  }
}

export function createLLMClient(options: LLMClientOptions): ILLMClient {
  const { provider, apiKey, model } = options;

  switch (provider) {
    case "google":
      return new GeminiClient(apiKey, model);
    case "openai":
      return new OpenAIClient(apiKey, model);
    case "anthropic":
      return new AnthropicClient(apiKey, model);
    case "ollama":
      return new OllamaClient(apiKey, model);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
