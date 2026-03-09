import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Public types — also used by extensions consuming the public API
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link CopilotService.sendPrompt}.
 */
export interface CopilotRequestOptions {
  /** The user prompt to send to the model. */
  prompt: string;

  /**
   * Override the model family for this single request.
   * Pass `"auto"` (or omit) to use the value from settings.
   */
  modelFamily?: string;

  /** Optional system-level instructions prepended to the conversation. */
  systemPrompt?: string;

  /** Cancellation token — the caller can abort a long-running request. */
  cancellationToken?: vscode.CancellationToken;
}

/**
 * Resolved result returned after the full model response has been streamed.
 */
export interface CopilotResponse {
  /** The complete concatenated text from the model. */
  fullText: string;

  /** The identifier of the model that produced the response. */
  model: string;
}

/**
 * Callback invoked for every text chunk as it arrives from the model.
 */
export type CopilotStreamCallback = (chunk: string) => void;

/**
 * Shape of the public API returned from `activate()` so that other
 * extensions can call into this extension programmatically.
 *
 * @example
 * ```ts
 * const ext = vscode.extensions.getExtension<CopilotBotAiApi>('your-publisher.copilot-bot-ai');
 * await ext?.activate();
 * const api = ext!.exports;
 * const res = await api.sendPrompt('Explain recursion');
 * console.log(res.fullText);
 * ```
 */
export interface CopilotBotAiApi {
  /**
   * Send a prompt to the Copilot language model and receive the full
   * response after streaming completes.
   */
  sendPrompt(
    prompt: string,
    options?: Partial<Omit<CopilotRequestOptions, 'prompt'>>
  ): Promise<CopilotResponse>;

  /**
   * Send a prompt and receive each text chunk via a callback as it arrives.
   * Returns the full response once streaming finishes.
   */
  sendPromptStreaming(
    prompt: string,
    onChunk: CopilotStreamCallback,
    options?: Partial<Omit<CopilotRequestOptions, 'prompt'>>
  ): Promise<CopilotResponse>;
}
