// src/agentLoop.ts

import {
    executeToolCall,
    ToolCallRequest,
    ToolCallResult,
    toGeminiFunctionDeclarations,
    toOpenAITools,
    toAnthropicTools,
} from "./agentTools";
import { APIProvider, DEFAULT_MODELS, OLLAMA_DEFAULT_HOST } from "./models";
import {
    APIKeyMissingError,
    APIKeyInvalidError,
    APIQuotaExceededError,
    APIRequestError,
    NoChangesError,
} from "./errors";
import { ProgressCallback } from "./llmClients";

const MAX_AGENT_STEPS = 5;

const AGENT_SYSTEM_PROMPT = `You are a senior software engineer acting as an autonomous commit message agent.
You have access to tools that let you inspect the repository to make informed decisions.

## Your Mission
Generate a precise, meaningful conventional commit message based on the provided git diff.
You MUST use tools when the diff alone is ambiguous about the nature of the change.

## Decision Process (MANDATORY)
Before generating the commit message, you must classify the change by following these steps:

1. **Scan the diff**: Identify what was added, removed, or modified.
2. **Assess ambiguity**: If the diff shows lines removed/changed but you cannot confidently determine
   whether they are comments, dead code, configuration, or functional logic — you MUST call \`read_file\`
   or \`get_file_outline\` to examine the surrounding context.
3. **Apply the classification rules** (see below) ONLY after you have sufficient context.
4. **Output the final commit message** with no additional explanation.

## Classification Rules (STRICT)
Apply these rules IN ORDER. The first matching rule wins:

| Condition | Type |
|-----------|------|
| Only adds/updates \`.md\`, \`.txt\`, JSDoc/docstrings, or documentation files | \`docs\` |
| Only adds/modifies test files (\`*.test.*\`, \`*.spec.*\`, \`__tests__/\`) | \`test\` |
| Only changes CI config (\`.github/workflows\`, \`.gitlab-ci.yml\`, Jenkinsfile) | \`ci\` |
| Only changes build config (\`webpack\`, \`esbuild\`, \`tsconfig\`, \`Dockerfile\`, \`Makefile\`) | \`build\` |
| Adds a new user-facing feature or capability | \`feat\` |
| Fixes a bug (corrects incorrect behavior) | \`fix\` |
| Improves performance without changing behavior | \`perf\` |
| Changes ONLY whitespace, formatting, semicolons, trailing commas (no logic change) | \`style\` |
| Restructures existing code logic WITHOUT changing external behavior | \`refactor\` |
| Everything else: deleting comments, removing dead code, updating dependencies, renaming without logic change, housekeeping tasks | \`chore\` |

### Critical Distinctions
- **chore vs refactor**: If the ONLY change is removing comments, TODO notes, console.logs, or unused imports — this is \`chore\`, NOT \`refactor\`. \`refactor\` requires restructuring of actual program logic.
- **chore vs style**: Removing comments is \`chore\`. Reformatting existing code (indentation, bracket style) is \`style\`.
- **feat vs refactor**: If the change exposes new functionality to the user/API, it's \`feat\`. If it only reorganizes internals, it's \`refactor\`.

## Format
- Conventional Commits format: \`type(scope): description\`
- First line max 72 characters, ideally under 50
- Optional body and footer
- English only, no emojis
- Do NOT wrap in markdown code blocks

## When to Use Tools
- You see lines removed but can't determine if they're comments or code → call \`read_file\`
- You want to understand a file's role in the project → call \`get_file_outline\`
- You want to see the full scope of changes → call \`list_changed_files\`
- When in doubt, ALWAYS investigate. It's better to make one extra tool call than to misclassify.

## Output
When you are confident in your classification, output ONLY the commit message string. No markdown, no explanation.`;

interface AgentLoopOptions {
    provider: APIProvider;
    apiKey: string;
    model?: string;
    diff: string;
    repoRoot: string;
    onProgress?: ProgressCallback;
}

export async function runAgentLoop(
    options: AgentLoopOptions,
): Promise<string> {
    const { provider, apiKey, model, diff, repoRoot, onProgress } = options;

    switch (provider) {
        case "google":
            return runGeminiAgentLoop(apiKey, model, diff, repoRoot, onProgress);
        case "openai":
            return runOpenAIAgentLoop(apiKey, model, diff, repoRoot, onProgress);
        case "anthropic":
            return runAnthropicAgentLoop(apiKey, model, diff, repoRoot, onProgress);
        case "ollama":
            return runOllamaAgentLoop(model, diff, repoRoot, onProgress);
        default:
            throw new Error(`Unsupported provider for agent loop: ${provider}`);
    }
}

async function runGeminiAgentLoop(
    apiKey: string,
    model: string | undefined,
    diff: string,
    repoRoot: string,
    onProgress?: ProgressCallback,
): Promise<string> {
    if (!apiKey) {
        throw new APIKeyMissingError();
    }
    if (!diff.trim()) {
        throw new NoChangesError();
    }

    try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const client = new GoogleGenerativeAI(apiKey);
        const modelName = (model || DEFAULT_MODELS.google).replace(
            /^models\//,
            "",
        );

        const generativeModel = client.getGenerativeModel({
            model: modelName,
            systemInstruction: AGENT_SYSTEM_PROMPT,
            tools: [
                {
                    functionDeclarations:
                        toGeminiFunctionDeclarations() as any,
                },
            ],
        });

        const history: any[] = [];
        const userMessage = `Here is the git diff for the staged changes:\n\n${diff}`;

        const chat = generativeModel.startChat({ history });

        let response = await chat.sendMessage(userMessage);
        let step = 0;

        while (step < MAX_AGENT_STEPS) {
            const candidate = response.response.candidates?.[0];
            if (!candidate) {
                throw new APIRequestError("Empty response from Gemini API");
            }

            const functionCalls = candidate.content?.parts?.filter(
                (p: any) => p.functionCall,
            );

            if (!functionCalls || functionCalls.length === 0) {
                const text = response.response.text();
                if (!text) {
                    throw new APIRequestError("Empty text response from Gemini API");
                }
                return text.trim();
            }

            const toolResults: any[] = [];
            for (const part of functionCalls) {
                const fc = (part as any).functionCall;
                if (onProgress) {
                    onProgress(`🔍 Investigating: ${fc.name}(${JSON.stringify(fc.args).substring(0, 60)})...`);
                }

                const result = executeToolCall(
                    { name: fc.name, arguments: fc.args || {} },
                    repoRoot,
                    diff,
                );

                toolResults.push({
                    functionResponse: {
                        name: fc.name,
                        response: { content: result.content },
                    },
                });
            }

            response = await chat.sendMessage(toolResults);
            step++;
        }

        const finalResponse = await chat.sendMessage(
            "You have used all available investigation steps. Based on what you've gathered, output the final commit message now.",
        );
        const text = finalResponse.response.text();
        return text?.trim() || "chore: update files";
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

async function runOpenAIAgentLoop(
    apiKey: string,
    model: string | undefined,
    diff: string,
    repoRoot: string,
    onProgress?: ProgressCallback,
): Promise<string> {
    if (!apiKey) {
        throw new APIKeyMissingError();
    }
    if (!diff.trim()) {
        throw new NoChangesError();
    }

    try {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey });
        const modelName = model || DEFAULT_MODELS.openai;

        const messages: any[] = [
            { role: "system", content: AGENT_SYSTEM_PROMPT },
            {
                role: "user",
                content: `Here is the git diff for the staged changes:\n\n${diff}`,
            },
        ];

        let step = 0;

        while (step < MAX_AGENT_STEPS) {
            const completion = await client.chat.completions.create({
                model: modelName,
                messages,
                tools: toOpenAITools() as any,
                tool_choice: "auto",
            });

            const choice = completion.choices[0];
            if (!choice) {
                throw new APIRequestError("Empty response from OpenAI API");
            }

            const assistantMessage = choice.message;
            messages.push(assistantMessage);

            if (
                choice.finish_reason === "tool_calls" &&
                assistantMessage.tool_calls &&
                assistantMessage.tool_calls.length > 0
            ) {
                for (const toolCall of assistantMessage.tool_calls) {
                    const args = JSON.parse(toolCall.function.arguments || "{}");
                    if (onProgress) {
                        onProgress(`🔍 Investigating: ${toolCall.function.name}(${JSON.stringify(args).substring(0, 60)})...`);
                    }

                    const result = executeToolCall(
                        { name: toolCall.function.name, arguments: args },
                        repoRoot,
                        diff,
                    );

                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: result.content,
                    });
                }
                step++;
            } else {
                const text = assistantMessage.content;
                if (!text) {
                    throw new APIRequestError("Empty text response from OpenAI API");
                }
                return text.trim();
            }
        }

        messages.push({
            role: "user",
            content:
                "You have used all available investigation steps. Output the final commit message now.",
        });
        const finalCompletion = await client.chat.completions.create({
            model: modelName,
            messages,
        });
        const text = finalCompletion.choices[0]?.message?.content;
        return text?.trim() || "chore: update files";
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

async function runAnthropicAgentLoop(
    apiKey: string,
    model: string | undefined,
    diff: string,
    repoRoot: string,
    onProgress?: ProgressCallback,
): Promise<string> {
    if (!apiKey) {
        throw new APIKeyMissingError();
    }
    if (!diff.trim()) {
        throw new NoChangesError();
    }

    try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey });
        const modelName = model || DEFAULT_MODELS.anthropic;

        const messages: any[] = [
            {
                role: "user",
                content: `Here is the git diff for the staged changes:\n\n${diff}`,
            },
        ];

        let step = 0;

        while (step < MAX_AGENT_STEPS) {
            const response = await client.messages.create({
                model: modelName,
                max_tokens: 4096,
                system: AGENT_SYSTEM_PROMPT,
                messages,
                tools: toAnthropicTools() as any,
            });

            const textBlocks = response.content.filter(
                (b: any) => b.type === "text",
            );
            const toolUseBlocks = response.content.filter(
                (b: any) => b.type === "tool_use",
            );

            if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
                const text = textBlocks.map((b: any) => b.text).join("");
                if (!text) {
                    throw new APIRequestError("Empty response from Anthropic API");
                }
                return text.trim();
            }

            messages.push({ role: "assistant", content: response.content });

            const toolResults: any[] = [];
            for (const block of toolUseBlocks) {
                const toolUse = block as any;
                if (onProgress) {
                    onProgress(`🔍 Investigating: ${toolUse.name}(${JSON.stringify(toolUse.input).substring(0, 60)})...`);
                }

                const result = executeToolCall(
                    { name: toolUse.name, arguments: toolUse.input || {} },
                    repoRoot,
                    diff,
                );

                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: result.content,
                });
            }

            messages.push({ role: "user", content: toolResults });
            step++;
        }

        messages.push({
            role: "user",
            content: [
                {
                    type: "text",
                    text: "You have used all available investigation steps. Output the final commit message now.",
                },
            ],
        });
        const finalResponse = await client.messages.create({
            model: modelName,
            max_tokens: 4096,
            system: AGENT_SYSTEM_PROMPT,
            messages,
        });
        const text = finalResponse.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
        return text?.trim() || "chore: update files";
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

async function runOllamaAgentLoop(
    model: string | undefined,
    diff: string,
    repoRoot: string,
    onProgress?: ProgressCallback,
): Promise<string> {
    if (!diff.trim()) {
        throw new NoChangesError();
    }

    try {
        const { Ollama } = await import("ollama");
        const client = new Ollama({ host: OLLAMA_DEFAULT_HOST });
        const modelName = model || DEFAULT_MODELS.ollama;

        const pullStream = await client.pull({ model: modelName, stream: true });
        let lastPercent = 0;
        for await (const part of pullStream) {
            if (part.total && part.completed) {
                const percent = Math.round((part.completed / part.total) * 100);
                if (percent > lastPercent) {
                    const increment = percent - lastPercent;
                    lastPercent = percent;
                    if (onProgress) {
                        onProgress(
                            `Pulling ${modelName}: ${part.status} (${percent}%)`,
                            increment,
                        );
                    }
                }
            } else if (part.status && onProgress) {
                onProgress(`Pulling ${modelName}: ${part.status}`);
            }
        }

        if (onProgress) {
            onProgress("Generating commit message...", 0);
        }

        const changedFiles = extractChangedFilesFromDiff(diff);
        let contextBlock = "";

        for (const filePath of changedFiles.slice(0, 5)) {
            const result = executeToolCall(
                { name: "read_file", arguments: { path: filePath } },
                repoRoot,
                diff,
            );
            if (!result.error) {
                contextBlock += `\n--- Context: ${filePath} ---\n${result.content}\n`;
            }
        }

        const enhancedPrompt = contextBlock
            ? `Here is the git diff for the staged changes:\n\n${diff}\n\nHere is the full context of the changed files for your reference:\n${contextBlock}`
            : `Here is the git diff for the staged changes:\n\n${diff}`;

        const response = await client.chat({
            model: modelName,
            messages: [
                { role: "system", content: AGENT_SYSTEM_PROMPT },
                { role: "user", content: enhancedPrompt },
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
                `Cannot connect to Ollama. Make sure Ollama is running at ${OLLAMA_DEFAULT_HOST}`,
            );
        } else if (message.includes("model") && message.includes("not found")) {
            throw new APIRequestError(
                `Model "${model || DEFAULT_MODELS.ollama}" not found. Please pull it first.`,
            );
        }
        throw new APIRequestError(message);
    }
}

function extractChangedFilesFromDiff(diff: string): string[] {
    const files: string[] = [];
    const regex = /^diff --git a\/(.+?) b\/(.+)$/gm;
    let match;
    while ((match = regex.exec(diff)) !== null) {
        const bPath = match[2];
        if (bPath !== "/dev/null") {
            files.push(bPath);
        }
    }
    return [...new Set(files)];
}