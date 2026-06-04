// TODO: opencode plugin API integration
// See https://docs.opencode.ai/plugins

// Env-gated debug logging (activate via CC_DEBUG=true):
//   import { logDebugEvent } from "./debug-logger.js";
//
// Usage inside any plugin hook:
//   logDebugEvent("hook.name", { relevantField: value });
// Writes JSONL to ~/.cache/opencode/four-opencode-{{ knowledge }}/debug-{date}.jsonl

export function register(): void {
  // Register hooks and/or tools with the opencode plugin API
  throw new Error("Not implemented");
}
