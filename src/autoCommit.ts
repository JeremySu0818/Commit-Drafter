import { exec } from "child_process";
import { promisify } from "util";
import { DEFAULT_MODEL } from "./models";

const execAsync = promisify(exec);

// ============================================================================
// Configuration & Constants
// ============================================================================

export const EXIT_CODES = {
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

export const ERROR_MESSAGES: Record<
  number,
  { title: string; action?: string }
> = {
  [EXIT_CODES.NOT_GIT_REPO]: {
    title: "Not a Git repository",
    action: "Please open a folder that contains a Git repository.",
  },
  [EXIT_CODES.STAGE_FAILED]: {
    title: "Failed to stage changes",
    action: "Check if Git is properly configured.",
  },
  [EXIT_CODES.NO_CHANGES]: {
    title: "No changes to commit",
    action: "Make some changes to your files first.",
  },
  [EXIT_CODES.API_KEY_MISSING]: {
    title: "API Key not configured",
    action: "Please set your Gemini API Key in the Auto-Commit panel.",
  },
  [EXIT_CODES.API_KEY_INVALID]: {
    title: "Invalid API Key",
    action:
      "Your API Key is invalid or has been revoked. Please check and update it.",
  },
  [EXIT_CODES.QUOTA_EXCEEDED]: {
    title: "API quota exceeded",
    action:
      "You have exceeded your API quota. Please check your Google AI Studio account.",
  },
  [EXIT_CODES.API_ERROR]: {
    title: "API request failed",
    action:
      "There was an error communicating with the Gemini API. Please try again.",
  },
  [EXIT_CODES.COMMIT_FAILED]: {
    title: "Failed to commit changes",
    action: "Check if there are any Git conflicts or issues.",
  },
  [EXIT_CODES.UNKNOWN_ERROR]: {
    title: "An unexpected error occurred",
    action: 'Check the "Auto-Commit Debug" output for details.',
  },
};

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



// ============================================================================
// Custom Error Classes
// ============================================================================

export class AutoCommitError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string = "UNKNOWN",
    public readonly exitCode: number = EXIT_CODES.UNKNOWN_ERROR,
  ) {
    super(message);
    this.name = "AutoCommitError";
  }
}

export class APIKeyMissingError extends AutoCommitError {
  constructor() {
    super(
      "GEMINI_API_KEY is not set. Please configure your API key.",
      "API_KEY_MISSING",
      EXIT_CODES.API_KEY_MISSING,
    );
    this.name = "APIKeyMissingError";
  }
}

export class APIKeyInvalidError extends AutoCommitError {
  constructor(details?: string) {
    super(
      `Invalid API Key${details ? `: ${details}` : ""}`,
      "API_KEY_INVALID",
      EXIT_CODES.API_KEY_INVALID,
    );
    this.name = "APIKeyInvalidError";
  }
}

export class APIQuotaExceededError extends AutoCommitError {
  constructor(details?: string) {
    super(
      `API quota exceeded${details ? `: ${details}` : ""}`,
      "QUOTA_EXCEEDED",
      EXIT_CODES.QUOTA_EXCEEDED,
    );
    this.name = "APIQuotaExceededError";
  }
}

export class APIRequestError extends AutoCommitError {
  constructor(details?: string) {
    super(
      `API request failed${details ? `: ${details}` : ""}`,
      "API_ERROR",
      EXIT_CODES.API_ERROR,
    );
    this.name = "APIRequestError";
  }
}

export class NoChangesError extends AutoCommitError {
  constructor() {
    super(
      "No changes detected to generate a commit for.",
      "NO_CHANGES",
      EXIT_CODES.NO_CHANGES,
    );
    this.name = "NoChangesError";
  }
}

export class StageFailedError extends AutoCommitError {
  constructor(details?: string) {
    super(
      `Failed to stage changes${details ? `: ${details}` : ""}`,
      "STAGE_FAILED",
      EXIT_CODES.STAGE_FAILED,
    );
    this.name = "StageFailedError";
  }
}

// ============================================================================
// Git Operations
// ============================================================================

export class GitOperations {
  constructor(private readonly cwd: string) {}

  /**
   * Check if the current directory is inside a Git repository.
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await execAsync("git rev-parse --is-inside-work-tree", { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the git diff (staged changes by default).
   */
  async getDiff(staged: boolean = true): Promise<string> {
    try {
      const cmd = staged ? "git diff --cached" : "git diff";
      const { stdout } = await execAsync(cmd, {
        cwd: this.cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
      });
      return stdout;
    } catch (error) {
      console.error("Error running git diff:", error);
      return "";
    }
  }

  /**
   * Stage all changes in the repository.
   */
  async stageAllChanges(): Promise<boolean> {
    try {
      await execAsync("git add .", { cwd: this.cwd });
      return true;
    } catch (error) {
      console.error("Error staging changes:", error);
      return false;
    }
  }

  /**
   * Commit changes with the given message.
   */
  async commitChanges(message: string): Promise<boolean> {
    try {
      // Escape double quotes in the message for the shell
      const escapedMessage = message.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${escapedMessage}"`, { cwd: this.cwd });
      return true;
    } catch (error) {
      console.error("Error committing changes:", error);
      return false;
    }
  }

  /**
   * Get list of untracked files
   */
  async getUntrackedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: this.cwd,
          encoding: "utf-8",
        },
      );
      return stdout.split("\n").filter((line) => line.trim().length > 0);
    } catch (error) {
      console.error("Error getting untracked files:", error);
      return [];
    }
  }

  /**
   * Stage specific files
   */
  async stageFiles(files: string[]): Promise<boolean> {
    if (files.length === 0) {
      return true;
    }
    try {
      // Escape filenames to handle spaces/special chars if needed, though simple strings usually work if no weird chars.
      // Better to wrap in quotes.
      const fileArgs = files.map((f) => `"${f}"`).join(" ");
      await execAsync(`git add ${fileArgs}`, { cwd: this.cwd });
      return true;
    } catch (error) {
      console.error("Error staging files:", error);
      return false;
    }
  }
}

// ============================================================================
// LLM Client (Gemini API)
// ============================================================================

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class LLMClient {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new APIKeyMissingError();
    }
    this.apiKey = apiKey;
    this.apiKey = apiKey;
    this.model = (model || DEFAULT_MODEL).replace(/^models\//, "");
  }

  /**
   * Generate a commit message based on the git diff.
   */
  async generateCommitMessage(diff: string): Promise<string> {
    if (!diff.trim()) {
      throw new NoChangesError();
    }

    const promptContent = `Here is the git diff:\n\n${diff}`;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              parts: [{ text: promptContent }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
          },
        }),
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => ({}))) as GeminiResponse;
        const errorMessage = errorData?.error?.message || response.statusText;
        const statusCode = response.status;

        if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
          throw new APIKeyInvalidError(errorMessage);
        } else if (statusCode === 429) {
          throw new APIQuotaExceededError(errorMessage);
        } else {
          throw new APIRequestError(`(${statusCode}) ${errorMessage}`);
        }
      }

      const data = (await response.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new APIRequestError("Empty response from Gemini API");
      }

      return text.trim();
    } catch (error) {
      if (error instanceof AutoCommitError) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new APIRequestError(errorMessage);
    }
  }
}

// ============================================================================
// Main Auto-Commit Function
// ============================================================================

export interface GenerateCommitMessageOptions {
  cwd: string;
  apiKey: string;
  model?: string;
  stageChanges?: boolean;
}

export interface GenerateCommitMessageResult {
  success: boolean;
  message?: string;
  error?: AutoCommitError;
}

/**
 * Generate a commit message for the staged changes in the repository.
 * This is the main function that orchestrates the entire process.
 */
export async function generateCommitMessage(
  options: GenerateCommitMessageOptions,
): Promise<GenerateCommitMessageResult> {
  const { cwd, apiKey, model, stageChanges = true } = options;

  try {
    const gitOps = new GitOperations(cwd);

    // Check if in a git repository
    if (!(await gitOps.isGitRepo())) {
      throw new AutoCommitError(
        "Not a git repository. Please run this command inside a git repository.",
        "NOT_GIT_REPO",
        EXIT_CODES.NOT_GIT_REPO,
      );
    }

    // Stage all changes if requested
    if (stageChanges) {
      const staged = await gitOps.stageAllChanges();
      if (!staged) {
        throw new StageFailedError();
      }
    }

    // Get the diff
    let diff = await gitOps.getDiff(true);

    // If no staged changes found and auto-staging was disabled, try to get unstaged changes
    if (!diff.trim() && !stageChanges) {
      diff = await gitOps.getDiff(false);
    }

    if (!diff.trim()) {
      throw new NoChangesError();
    }

    // Generate commit message using LLM
    const llmClient = new LLMClient(apiKey, model);
    const commitMessage = await llmClient.generateCommitMessage(diff);

    return {
      success: true,
      message: commitMessage,
    };
  } catch (error) {
    if (error instanceof AutoCommitError) {
      return {
        success: false,
        error: error,
      };
    }
    return {
      success: false,
      error: new AutoCommitError(
        error instanceof Error ? error.message : String(error),
        "UNKNOWN",
        EXIT_CODES.UNKNOWN_ERROR,
      ),
    };
  }
}
