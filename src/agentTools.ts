import * as fs from "fs";
import * as path from "path";
import { GitOperations } from "./commitCopilot";

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
        name: "get_diff",
        description:
            "Get the actual git diff content for a specific file. You MUST specify the file path. Call this tool for each file you want to investigate. You MUST call this tool at least once to understand what was actually changed before making a classification decision.",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description:
                        "Required. Relative path to a specific file to get the diff for. Use the file paths from the staged changes summary.",
                },
            },
            required: ["path"],
        },
    },
    {
        name: "read_file",
        description:
            "Read the current contents of a file in the repository. Use this to understand the full context around changes — e.g., whether removed lines were comments, dead code, or functional logic. You can specify a line range to read a portion of the file.",
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
];

const MAX_FILE_LINES = Infinity;
const MAX_OUTLINE_LINES = Infinity;

function executeGetDiff(
    _repoRoot: string,
    args: Record<string, unknown>,
    diffContent: string,
): string {
    const filePath = args.path as string | undefined;

    if (!filePath) {
        return "Error: 'path' is required. Please specify a file path to get its diff. Use the file paths from the staged changes summary.";
    }

    const lines = diffContent.split("\n");
    const fileBlocks: string[] = [];
    let capturing = false;

    for (const line of lines) {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
            const aPath = match[1];
            const bPath = match[2];
            capturing = aPath === filePath || bPath === filePath;
        }
        if (capturing) {
            fileBlocks.push(line);
        }
    }

    if (fileBlocks.length === 0) {
        return `No diff found for file: ${filePath}`;
    }

    return fileBlocks.join("\n");
}

async function executeReadFile(
    repoRoot: string,
    args: Record<string, unknown>,
    isStaged: boolean,
    gitOps?: GitOperations,
): Promise<string> {
    const relPath = args.path as string;
    if (!relPath) {
        return "Error: 'path' is required.";
    }

    const absPath = path.resolve(repoRoot, relPath);

    if (!absPath.startsWith(repoRoot)) {
        return "Error: path traversal is not allowed.";
    }

    let content: string;
    try {
        if (isStaged && gitOps) {
            // Read from Git Index
            content = await gitOps.show(relPath);
            if (!content) {
                // Fallback to disk if show fails or returns empty
                if (!fs.existsSync(absPath)) {
                    return `Error: file '${relPath}' does not exist in index or disk.`;
                }
                content = fs.readFileSync(absPath, "utf-8");
            }
        } else {
            // Read from disk
            if (!fs.existsSync(absPath)) {
                return `Error: file '${relPath}' does not exist.`;
            }
            content = fs.readFileSync(absPath, "utf-8");
        }

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

async function executeGetFileOutline(
    repoRoot: string,
    args: Record<string, unknown>,
    isStaged: boolean,
    gitOps?: GitOperations,
): Promise<string> {
    const relPath = args.path as string;
    if (!relPath) {
        return "Error: 'path' is required.";
    }

    const absPath = path.resolve(repoRoot, relPath);

    if (!absPath.startsWith(repoRoot)) {
        return "Error: path traversal is not allowed.";
    }

    try {
        let content: string;
        if (isStaged && gitOps) {
            content = await gitOps.show(relPath);
            if (!content) {
                if (!fs.existsSync(absPath)) return `Error: file '${relPath}' does not exist.`;
                content = fs.readFileSync(absPath, "utf-8");
            }
        } else {
            if (!fs.existsSync(absPath)) {
                return `Error: file '${relPath}' does not exist.`;
            }
            content = fs.readFileSync(absPath, "utf-8");
        }

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

export async function executeToolCall(
    toolCall: ToolCallRequest,
    repoRoot: string,
    diffContent: string,
    isStaged: boolean = true,
    gitOps?: GitOperations,
): Promise<ToolCallResult> {
    try {
        let content: string;

        switch (toolCall.name) {
            case "get_diff":
                content = executeGetDiff(repoRoot, toolCall.arguments, diffContent);
                break;
            case "read_file":
                content = await executeReadFile(repoRoot, toolCall.arguments, isStaged, gitOps);
                break;
            case "get_file_outline":
                content = await executeGetFileOutline(repoRoot, toolCall.arguments, isStaged, gitOps);
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

export function parseDiffSummary(
    diff: string,
): { path: string; type: string; added: number; removed: number }[] {
    const files: { path: string; type: string; added: number; removed: number }[] = [];
    const lines = diff.split("\n");

    let currentFile: { path: string; type: string; added: number; removed: number } | null = null;

    for (const line of lines) {
        const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (diffMatch) {
            if (currentFile) {
                files.push(currentFile);
            }

            const aPath = diffMatch[1];
            const bPath = diffMatch[2];

            let type = "modified";
            let filePath = bPath;
            if (aPath === "/dev/null") {
                type = "added";
                filePath = bPath;
            } else if (bPath === "/dev/null") {
                type = "deleted";
                filePath = aPath;
            } else if (aPath !== bPath) {
                type = "renamed";
                filePath = `${aPath} → ${bPath}`;
            }

            currentFile = { path: filePath, type, added: 0, removed: 0 };
            continue;
        }

        if (currentFile) {
            if (line.startsWith("+") && !line.startsWith("+++")) {
                currentFile.added++;
            } else if (line.startsWith("-") && !line.startsWith("---")) {
                currentFile.removed++;
            }
        }
    }

    if (currentFile) {
        files.push(currentFile);
    }

    return files;
}

export function getProjectStructure(repoRoot: string): string {
    const IGNORE_DIRS = new Set([
        ".git",
        "node_modules",
        ".next",
        "dist",
        "build",
        "out",
        ".cache",
        "coverage",
        "__pycache__",
        ".vscode",
        ".idea",
    ]);

    const MAX_FILES = Infinity;
    let fileCount = 0;

    function walk(dir: string, prefix: string = ""): string[] {
        const lines: string[] = [];

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return lines;
        }

        entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < entries.length; i++) {
            if (fileCount >= MAX_FILES) {
                lines.push(`${prefix}... (truncated, ${MAX_FILES}+ files)`);
                break;
            }

            const entry = entries[i];
            const isLast = i === entries.length - 1;
            const connector = isLast ? "└── " : "├── ";
            const childPrefix = isLast ? "    " : "│   ";

            if (entry.isDirectory()) {
                if (IGNORE_DIRS.has(entry.name)) {
                    continue;
                }
                lines.push(`${prefix}${connector}${entry.name}/`);
                const childLines = walk(
                    path.join(dir, entry.name),
                    prefix + childPrefix,
                );
                lines.push(...childLines);
            } else {
                lines.push(`${prefix}${connector}${entry.name}`);
                fileCount++;
            }
        }

        return lines;
    }

    const treeLines = walk(repoRoot);
    return treeLines.join("\n");
}

export function buildInitialContext(diff: string, repoRoot: string): string {
    const fileSummary = parseDiffSummary(diff);
    const projectTree = getProjectStructure(repoRoot);

    const changedFilesSection = fileSummary
        .map(
            (f) =>
                `  [${f.type.toUpperCase()}] ${f.path}  (+${f.added} / -${f.removed} lines)`,
        )
        .join("\n");

    return `## Staged Changes Summary

The following files have been modified in this commit:

${changedFilesSection}

## Project Structure (tracked files)

${projectTree}

---

You have ONLY been given the file names and line counts. You do NOT yet know what the actual changes are.
Use your tools to inspect the changes before classifying. You have \`get_diff\`, \`read_file\`, and \`get_file_outline\` — use whichever combination is most effective.
Do NOT guess the commit type based solely on file names.

REMINDER: When you are done investigating, your ENTIRE text output must be ONLY the commit message in \`type(scope): description\` format — scope parentheses are MANDATORY. No analysis, no explanation, no commentary.`;
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