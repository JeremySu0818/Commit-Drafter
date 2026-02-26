// src/commitCopilot.ts

import { APIProvider, DEFAULT_MODELS } from "./models";
import { createLLMClient, ProgressCallback } from "./llmClients";
import { runAgentLoop } from "./agentLoop";
import {
  EXIT_CODES,
  CommitCopilotError,
  NoChangesError,
  NoChangesButUntrackedError,
  StageFailedError,
} from "./errors";

export {
  EXIT_CODES,
  ERROR_MESSAGES,
  CommitCopilotError,
  APIKeyMissingError,
  APIKeyInvalidError,
  APIQuotaExceededError,
  APIRequestError,
  NoChangesError,
  NoChangesButUntrackedError,
  StageFailedError,
} from "./errors";

const STATUS_UNTRACKED = 7;

interface GitChange {
  readonly uri: { fsPath: string };
  readonly status: number;
}

export interface GitRepository {
  readonly rootUri: { fsPath: string; toString(): string };
  readonly state: {
    readonly workingTreeChanges: ReadonlyArray<GitChange>;
    readonly indexChanges: ReadonlyArray<GitChange>;
    readonly untrackedChanges: ReadonlyArray<GitChange>;
  };
  readonly inputBox: { value: string };
  diff(cached?: boolean): Promise<string>;
  add(paths: string[]): Promise<void>;
  commit(message: string, opts?: { all?: boolean | 'tracked' }): Promise<void>;
  status(): Promise<void>;
}

export class GitOperations {
  constructor(private readonly repository: GitRepository) { }

  async isGitRepo(): Promise<boolean> {
    return true;
  }

  async getDiff(staged: boolean = true): Promise<string> {
    try {
      const diff = await this.repository.diff(staged);
      return diff;
    } catch (error: any) {
      console.error("Error running git diff:", error);
      return "";
    }
  }

  async stageAllChanges(): Promise<boolean> {
    try {
      const paths: string[] = [];

      for (const change of this.repository.state.workingTreeChanges) {
        paths.push(change.uri.fsPath);
      }
      for (const change of this.repository.state.untrackedChanges) {
        paths.push(change.uri.fsPath);
      }

      if (paths.length > 0) {
        await this.repository.add(paths);
      }
      return true;
    } catch (error) {
      console.error("Error staging changes:", error);
      return false;
    }
  }

  async commitChanges(message: string): Promise<boolean> {
    try {
      await this.repository.commit(message);
      return true;
    } catch (error) {
      console.error("Error committing changes:", error);
      return false;
    }
  }

  async hasUntrackedFiles(): Promise<boolean> {
    try {
      if (this.repository.state.untrackedChanges.length > 0) {
        return true;
      }
      return this.repository.state.workingTreeChanges.some(
        (change) => change.status === STATUS_UNTRACKED,
      );
    } catch {
      return false;
    }
  }

  async stageFiles(files: string[]): Promise<boolean> {
    if (files.length === 0) {
      return true;
    }
    try {
      await this.repository.add(files);
      return true;
    } catch (error) {
      console.error("Error staging files:", error);
      return false;
    }
  }
}

export interface GenerateCommitMessageOptions {
  repository: GitRepository;
  provider: APIProvider;
  apiKey: string;
  model?: string;
  stageChanges?: boolean;
  onProgress?: ProgressCallback;
}

export interface GenerateCommitMessageResult {
  success: boolean;
  message?: string;
  error?: CommitCopilotError;
}

export async function generateCommitMessage(
  options: GenerateCommitMessageOptions,
): Promise<GenerateCommitMessageResult> {
  const {
    repository,
    provider,
    apiKey,
    model,
    stageChanges = true,
    onProgress,
  } = options;
  try {
    const gitOps = new GitOperations(repository);
    if (!(await gitOps.isGitRepo())) {
      throw new CommitCopilotError(
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
      if (await gitOps.hasUntrackedFiles()) {
        throw new NoChangesButUntrackedError();
      }
      diff = await gitOps.getDiff(false);
    }
    if (!diff.trim()) {
      throw new NoChangesError();
    }
    const repoRoot = repository.rootUri.fsPath;
    const commitMessage = await runAgentLoop({
      provider,
      apiKey,
      model: model || DEFAULT_MODELS[provider],
      diff,
      repoRoot,
      onProgress,
    });
    return {
      success: true,
      message: commitMessage,
    };
  } catch (error) {
    if (error instanceof CommitCopilotError) {
      return {
        success: false,
        error: error,
      };
    }
    return {
      success: false,
      error: new CommitCopilotError(
        error instanceof Error ? error.message : String(error),
        "UNKNOWN",
        EXIT_CODES.UNKNOWN_ERROR,
      ),
    };
  }
}
