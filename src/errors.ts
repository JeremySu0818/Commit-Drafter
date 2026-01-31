// src/errors.ts

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
    action: "Please set your API Key in the Commit-Drafter panel.",
  },
  [EXIT_CODES.API_KEY_INVALID]: {
    title: "Invalid API Key",
    action:
      "Your API Key is invalid or has been revoked. Please check and update it.",
  },
  [EXIT_CODES.QUOTA_EXCEEDED]: {
    title: "API quota exceeded",
    action:
      "You have exceeded your API quota. Please check your provider account.",
  },
  [EXIT_CODES.API_ERROR]: {
    title: "API request failed",
    action: "There was an error communicating with the API. Please try again.",
  },
  [EXIT_CODES.COMMIT_FAILED]: {
    title: "Failed to commit changes",
    action: "Check if there are any Git conflicts or issues.",
  },
  [EXIT_CODES.UNKNOWN_ERROR]: {
    title: "An unexpected error occurred",
    action: 'Check the "Commit-Drafter Debug" output for details.',
  },
};

export class CommitDrafterError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string = "UNKNOWN",
    public readonly exitCode: number = EXIT_CODES.UNKNOWN_ERROR,
  ) {
    super(message);
    this.name = "CommitDrafterError";
  }
}

export class APIKeyMissingError extends CommitDrafterError {
  constructor() {
    super(
      "API Key is not set. Please configure your API key.",
      "API_KEY_MISSING",
      EXIT_CODES.API_KEY_MISSING,
    );
    this.name = "APIKeyMissingError";
  }
}

export class APIKeyInvalidError extends CommitDrafterError {
  constructor(details?: string) {
    super(
      `Invalid API Key${details ? `: ${details}` : ""}`,
      "API_KEY_INVALID",
      EXIT_CODES.API_KEY_INVALID,
    );
    this.name = "APIKeyInvalidError";
  }
}

export class APIQuotaExceededError extends CommitDrafterError {
  constructor(details?: string) {
    super(
      `API quota exceeded${details ? `: ${details}` : ""}`,
      "QUOTA_EXCEEDED",
      EXIT_CODES.QUOTA_EXCEEDED,
    );
    this.name = "APIQuotaExceededError";
  }
}

export class APIRequestError extends CommitDrafterError {
  constructor(details?: string) {
    super(
      `API request failed${details ? `: ${details}` : ""}`,
      "API_ERROR",
      EXIT_CODES.API_ERROR,
    );
    this.name = "APIRequestError";
  }
}

export class NoChangesError extends CommitDrafterError {
  constructor() {
    super(
      "No changes detected to generate a commit for.",
      "NO_CHANGES",
      EXIT_CODES.NO_CHANGES,
    );
    this.name = "NoChangesError";
  }
}

export class StageFailedError extends CommitDrafterError {
  constructor(details?: string) {
    super(
      `Failed to stage changes${details ? `: ${details}` : ""}`,
      "STAGE_FAILED",
      EXIT_CODES.STAGE_FAILED,
    );
    this.name = "StageFailedError";
  }
}
