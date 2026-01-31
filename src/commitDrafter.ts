// src/autoCommit.ts

import { exec } from "child_process";
import { promisify } from "util";
import { APIProvider, DEFAULT_MODELS } from "./models";
import { createLLMClient, ProgressCallback } from "./llmClients";
import {
  EXIT_CODES,
  CommitDrafterError,
  NoChangesError,
  StageFailedError,
} from "./errors";

export {
  EXIT_CODES,
  ERROR_MESSAGES,
  CommitDrafterError,
  APIKeyMissingError,
  APIKeyInvalidError,
  APIQuotaExceededError,
  APIRequestError,
  NoChangesError,
  StageFailedError,
} from "./errors";

const execAsync = promisify(exec);

export class GitOperations {
  constructor(private readonly cwd: string) {}

  async isGitRepo(): Promise<boolean> {
    try {
      await execAsync("git rev-parse --is-inside-work-tree", { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }

  async getDiff(staged: boolean = true): Promise<string> {
    try {
      const cmd = staged ? "git diff --cached" : "git diff";
      const { stdout } = await execAsync(cmd, {
        cwd: this.cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      console.error("Error running git diff:", error);
      return "";
    }
  }

  async stageAllChanges(): Promise<boolean> {
    try {
      await execAsync("git add .", { cwd: this.cwd });
      return true;
    } catch (error) {
      console.error("Error staging changes:", error);
      return false;
    }
  }

  async commitChanges(message: string): Promise<boolean> {
    try {
      const escapedMessage = message.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${escapedMessage}"`, { cwd: this.cwd });
      return true;
    } catch (error) {
      console.error("Error committing changes:", error);
      return false;
    }
  }

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

  async stageFiles(files: string[]): Promise<boolean> {
    if (files.length === 0) {
      return true;
    }
    try {
      const fileArgs = files.map((f) => `"${f}"`).join(" ");
      await execAsync(`git add ${fileArgs}`, { cwd: this.cwd });
      return true;
    } catch (error) {
      console.error("Error staging files:", error);
      return false;
    }
  }
}

export interface GenerateCommitMessageOptions {
  cwd: string;
  provider: APIProvider;
  apiKey: string;
  model?: string;
  stageChanges?: boolean;
  onProgress?: ProgressCallback;
}

export interface GenerateCommitMessageResult {
  success: boolean;
  message?: string;
  error?: CommitDrafterError;
}

export async function generateCommitMessage(
  options: GenerateCommitMessageOptions,
): Promise<GenerateCommitMessageResult> {
  const {
    cwd,
    provider,
    apiKey,
    model,
    stageChanges = true,
    onProgress,
  } = options;
  try {
    const gitOps = new GitOperations(cwd);
    if (!(await gitOps.isGitRepo())) {
      throw new CommitDrafterError(
        "Not a git repository. Please run this command inside a git repository.",
        "NOT_GIT_REPO",
        EXIT_CODES.NOT_GIT_REPO,
      );
    }
    if (stageChanges) {
      const staged = await gitOps.stageAllChanges();
      if (!staged) {
        throw new StageFailedError();
      }
    }
    let diff = await gitOps.getDiff(true);
    if (!diff.trim() && !stageChanges) {
      diff = await gitOps.getDiff(false);
    }
    if (!diff.trim()) {
      throw new NoChangesError();
    }
    const llmClient = createLLMClient({
      provider,
      apiKey,
      model: model || DEFAULT_MODELS[provider],
    });
    const commitMessage = await llmClient.generateCommitMessage(
      diff,
      onProgress,
    );
    return {
      success: true,
      message: commitMessage,
    };
  } catch (error) {
    if (error instanceof CommitDrafterError) {
      return {
        success: false,
        error: error,
      };
    }
    return {
      success: false,
      error: new CommitDrafterError(
        error instanceof Error ? error.message : String(error),
        "UNKNOWN",
        EXIT_CODES.UNKNOWN_ERROR,
      ),
    };
  }
}
