export type APIProvider = "google" | "openai" | "anthropic" | "ollama";
export const PROVIDER_DISPLAY_NAMES: Record<APIProvider, string> = {
  google: "Google (Gemini)",
  openai: "OpenAI (ChatGPT)",
  anthropic: "Anthropic (Claude)",
  ollama: "Ollama (Local)",
};
export type ModelConfig = { id: string; alias: string };

export const GEMINI_MODELS: ModelConfig[] = [
  { id: "gemini-2.0-flash", alias: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", alias: "Gemini 2.0 Flash Lite" },
  { id: "gemini-2.5-flash", alias: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", alias: "Gemini 2.5 Flash Lite" },
  { id: "gemini-2.5-pro", alias: "Gemini 2.5 Pro" },
  { id: "gemini-3-flash-preview", alias: "Gemini 3 Flash" },
  { id: "gemini-3-pro-preview", alias: "Gemini 3 Pro" },
];

export const OPENAI_MODELS: ModelConfig[] = [
  { id: "o3", alias: "o3" },
  { id: "o3-mini", alias: "o3-mini" },
  { id: "o4-mini", alias: "o4-mini" },
  { id: "gpt-4o", alias: "GPT-4o" },
  { id: "gpt-4o-mini", alias: "GPT-4o mini" },
  { id: "gpt-5-nano", alias: "GPT-5 nano" },
  { id: "gpt-5-mini", alias: "GPT-5 mini" },
  { id: "gpt-5", alias: "GPT-5" },
  { id: "gpt-5.1", alias: "GPT-5.1" },
  { id: "gpt-5.2", alias: "GPT-5.2" },
];

export const ANTHROPIC_MODELS: ModelConfig[] = [
  { id: "claude-sonnet-4-20250514", alias: "Claude Sonnet 4" },
  { id: "claude-opus-4-20250514", alias: "Claude Opus 4" },
  { id: "claude-opus-4-1-20250805", alias: "Claude Opus 4.1" },
  { id: "claude-haiku-4-5-20251001", alias: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-5-20250929", alias: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-5-20251101", alias: "Claude Opus 4.5" },
  { id: "claude-opus-4-6-20260205", alias: "Claude Opus 4.6" },
];

export const OLLAMA_MODELS: ModelConfig[] = [
  { id: "gemma3:1b", alias: "Gemma 3 1B" },
  { id: "gemma3:4b", alias: "Gemma 3 4B" },
  { id: "gemma3:12b", alias: "Gemma 3 12B" },
  { id: "gemma3:27b", alias: "Gemma 3 27B" },
  { id: "gpt-oss:20b", alias: "gpt-oss-20B" },
  { id: "gpt-oss:120b", alias: "gpt-oss-120B" },
  { id: "llama3.3:8b", alias: "Llama 3.3 8B" },
  { id: "llama3.3:70b", alias: "Llama 3.3 70B" },
  { id: "phi4:14b", alias: "Phi-4 14B" },
  { id: "mistral:7b", alias: "Mistral 7B" },
];

export const MODELS_BY_PROVIDER: Record<APIProvider, ModelConfig[]> = {
  google: GEMINI_MODELS,
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  ollama: OLLAMA_MODELS,
};

export const DEFAULT_MODELS: Record<APIProvider, string> = {
  google: "gemini-3-flash-preview",
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-4-5-20251001",
  ollama: "gemma3:12b",
};
export const DEFAULT_PROVIDER: APIProvider = "google";
export const DEFAULT_MODEL = DEFAULT_MODELS[DEFAULT_PROVIDER];
export const API_KEY_STORAGE_KEYS: Record<APIProvider, string> = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  ollama: "OLLAMA_HOST",
};
export const OLLAMA_DEFAULT_HOST = "http://127.0.0.1:11434";
