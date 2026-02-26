// src/agentTools.ts

import * as fs from "fs";
import * as path from "path";

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolCallResult {
    name: string;
    content: string;
    error?: boolean;
}

export const AGENT_TOOLS: ToolDefinition[] = [
    {
        name: "read_file",
        description:
            "Read the contents of a file in the repository. Use this when the diff alone is insufficient to determine the nature of the change (e.g., whether removed lines were comments, dead code, or functional logic). You can specify a line range to read a portion of the file.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative path to the file from the repository root. Example: 'src/utils.ts'",
                },
                startLine: {
                    type: "number",
                    description:
                        "Optional. 1-indexed start line to read from. If omitted, reads from the beginning.",
                },
                endLine: {
                    type: "number",
                    description:
                        "Optional. 1-indexed end line to read to (inclusive). If omitted, reads to the end.",
                },
            },
            required: ["path"],
        },
    },
    {
        name: "get_file_outline",
        description:
            "Get the structural outline of a file — its top-level functions, classes, exports, and imports. Use this to understand what role a file plays in the codebase without reading all its contents, which helps determine the appropriate commit type and scope.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Relative path to the file from the repository root. Example: 'src/extension.ts'",
                },
            },
            required: ["path"],
        },
    },
    {
        name: "list_changed_files",
        description:
            "List all files that have been changed (staged) in this commit, along with their change type (added, modified, deleted, renamed). Use this to understand the full scope of the commit.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
];

const MAX_FILE_LINES = 300;
const MAX_OUTLINE_LINES = 150;

function executeReadFile(
    repoRoot: string,
    args: Record<string, unknown>,
): string {
    const relPath = args.path as string;
    if (!relPath) {
        return "Error: 'path' is required.";
    }

    const absPath = path.resolve(repoRoot, relPath);

    if (!absPath.startsWith(repoRoot)) {
        return "Error: path traversal is not allowed.";
    }

    if (!fs.existsSync(absPath)) {
        return `Error: file '${relPath}' does not exist.`;
    }

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
        return `Error: '${relPath}' is a directory, not a file.`;
    }

    if (stat.size > 512 * 1024) {
        return `Error: file '${relPath}' is too large (${(stat.size / 1024).toFixed(0)} KB). Please specify a line range.`;
    }

    try {
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");

        const startLine = Math.max(1, (args.startLine as number) || 1);
        const endLine = Math.min(
            lines.length,
            (args.endLine as number) || lines.length,
        );

        const selectedLines = lines.slice(startLine - 1, endLine);

        if (selectedLines.length > MAX_FILE_LINES) {
            const truncated = selectedLines.slice(0, MAX_FILE_LINES);
            return (
                `File: ${relPath} (lines ${startLine}-${startLine + MAX_FILE_LINES - 1} of ${lines.length}, truncated)\n\n` +
                truncated
                    .map((line, i) => `${startLine + i}: ${line}`)
                    .join("\n") +
                `\n\n... (${selectedLines.length - MAX_FILE_LINES} more lines, use startLine/endLine to read them)`
            );
        }

        return (
            `File: ${relPath} (lines ${startLine}-${endLine} of ${lines.length})\n\n` +
            selectedLines
                .map((line, i) => `${startLine + i}: ${line}`)
                .join("\n")
        );
    } catch (err: any) {
        return `Error reading file: ${err.message}`;
    }
}

function executeGetFileOutline(
    repoRoot: string,
    args: Record<string, unknown>,
): string {
    const relPath = args.path as string;
    if (!relPath) {
        return "Error: 'path' is required.";
    }

    const absPath = path.resolve(repoRoot, relPath);

    if (!absPath.startsWith(repoRoot)) {
        return "Error: path traversal is not allowed.";
    }

    if (!fs.existsSync(absPath)) {
        return `Error: file '${relPath}' does not exist.`;
    }

    try {
        const content = fs.readFileSync(absPath, "utf-8");
        const lines = content.split("\n");
        const outlineLines: string[] = [];

        outlineLines.push(`File: ${relPath} (${lines.length} total lines)`);
        outlineLines.push(`Extension: ${path.extname(relPath)}`);
        outlineLines.push("");

        const patterns = [
            { regex: /^(import\s+.*)/, label: "Import" },
            { regex: /^(export\s+(default\s+)?(class|interface|type|enum|const|function|async\s+function)\s+\w+)/, label: "Export" },
            { regex: /^(class\s+\w+)/, label: "Class" },
            { regex: /^(\s*(public|private|protected|static|async|readonly)\s+.*\(.*\))/, label: "Method" },
            { regex: /^(function\s+\w+)/, label: "Function" },
            { regex: /^(const\s+\w+\s*=)/, label: "Const" },
            { regex: /^(module\.exports)/, label: "Module Export" },
        ];

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trimStart();
            for (const pat of patterns) {
                if (pat.regex.test(trimmed)) {
                    outlineLines.push(`  L${i + 1} [${pat.label}] ${trimmed.substring(0, 120)}`);
                    break;
                }
            }
            if (outlineLines.length > MAX_OUTLINE_LINES) {
                outlineLines.push("  ... (outline truncated)");
                break;
            }
        }

        return outlineLines.join("\n");
    } catch (err: any) {
        return `Error generating outline: ${err.message}`;
    }
}

function executeListChangedFiles(
    _repoRoot: string,
    _args: Record<string, unknown>,
    diffContent: string,
): string {
    const files: { path: string; type: string }[] = [];
    const diffLines = diffContent.split("\n");

    for (const line of diffLines) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
            const aPath = match[1];
            const bPath = match[2];

            if (aPath === "/dev/null") {
                files.push({ path: bPath, type: "added" });
            } else if (bPath === "/dev/null") {
                files.push({ path: aPath, type: "deleted" });
            } else if (aPath !== bPath) {
                files.push({ path: `${aPath} → ${bPath}`, type: "renamed" });
            } else {
                files.push({ path: bPath, type: "modified" });
            }
        }
    }

    if (files.length === 0) {
        return "No changed files detected in the diff.";
    }

    const summary = files
        .map((f) => `  [${f.type.toUpperCase()}] ${f.path}`)
        .join("\n");

    return `Changed files (${files.length}):\n${summary}`;
}

export function executeToolCall(
    toolCall: ToolCallRequest,
    repoRoot: string,
    diffContent: string,
): ToolCallResult {
    try {
        let content: string;

        switch (toolCall.name) {
            case "read_file":
                content = executeReadFile(repoRoot, toolCall.arguments);
                break;
            case "get_file_outline":
                content = executeGetFileOutline(repoRoot, toolCall.arguments);
                break;
            case "list_changed_files":
                content = executeListChangedFiles(
                    repoRoot,
                    toolCall.arguments,
                    diffContent,
                );
                break;
            default:
                content = `Unknown tool: ${toolCall.name}`;
                return { name: toolCall.name, content, error: true };
        }

        return { name: toolCall.name, content };
    } catch (err: any) {
        return {
            name: toolCall.name,
            content: `Tool execution error: ${err.message}`,
            error: true,
        };
    }
}

export function toGeminiFunctionDeclarations(): object[] {
    return AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
    }));
}

export function toOpenAITools(): object[] {
    return AGENT_TOOLS.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
}

export function toAnthropicTools(): object[] {
    return AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
    }));
}