import * as vscode from 'vscode';
import {
  CopilotRequestOptions,
  CopilotResponse,
  CopilotStreamCallback,
} from './types';

// ---------------------------------------------------------------------------
// Mapping from settings enum values → LanguageModelChatSelector.family
// ---------------------------------------------------------------------------

const FAMILY_MAP: Record<string, string | undefined> = {
  auto: undefined, // no family filter → first available
  'claude-opus-4.6': 'claude-opus-4.6',
  'claude-sonnet-4.6': 'claude-sonnet-4.6',
  'claude-sonnet-4.5': 'claude-sonnet-4.5',
  'gpt-4.1': 'gpt-4.1',
  'gpt-4o': 'gpt-4o',
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-4o-mini': 'gpt-4o-mini',
  o1: 'o1',
  'o1-mini': 'o1-mini',
  'o3-mini': 'o3-mini',
};

// ---------------------------------------------------------------------------
// CopilotService
// ---------------------------------------------------------------------------

export class CopilotService {
  private readonly outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  // -----------------------------------------------------------------------
  // Model selection
  // -----------------------------------------------------------------------

  /**
   * Select a Copilot language model based on a family string.
   *
   * @param familyOverride - A family key such as `"gpt-4o"` or `"auto"`.
   *   Falls back to the `copilotBotAi.modelFamily` setting when omitted.
   * @returns The selected {@link vscode.LanguageModelChat} or `undefined`
   *   when no matching model is available.
   */
  async selectModel(
    familyOverride?: string
  ): Promise<vscode.LanguageModelChat | undefined> {
    const config = vscode.workspace.getConfiguration('copilotBotAi');
    const configFamily: string = familyOverride ?? config.get<string>('modelFamily', 'auto');
    const family = FAMILY_MAP[configFamily] ?? configFamily;

    const selector: vscode.LanguageModelChatSelector = {
      vendor: 'copilot',
      ...(family ? { family } : {}),
    };

    const models = await vscode.lm.selectChatModels(selector);

    if (models.length === 0) {
      // If a specific family was requested but unavailable, fall back to any
      // Copilot model before giving up.
      if (family) {
        const fallback = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (fallback.length > 0) {
          this.log(
            `⚠ Model family "${configFamily}" not found. Falling back to "${fallback[0].name}" (${fallback[0].id}).`
          );
          return fallback[0];
        }
      }

      vscode.window.showWarningMessage(
        'Copilot Bot AI: No language model available. ' +
          'Ensure GitHub Copilot is installed and active, and that you have an active Copilot subscription.'
      );
      return undefined;
    }

    return models[0];
  }

  // -----------------------------------------------------------------------
  // Send prompt
  // -----------------------------------------------------------------------

  /**
   * Send a prompt to a Copilot language model, stream the response, and
   * return the full concatenated text once done.
   *
   * @param options - Request options including the prompt text.
   * @param onChunk - Optional callback invoked with each text fragment as
   *   it arrives from the model (useful for real-time UI updates).
   */
  async sendPrompt(
    options: CopilotRequestOptions,
    onChunk?: CopilotStreamCallback
  ): Promise<CopilotResponse> {
    // 1. Select model
    const model = await this.selectModel(options.modelFamily);
    if (!model) {
      throw new Error('No Copilot language model available.');
    }

    // 2. Build messages
    const messages: vscode.LanguageModelChatMessage[] = [];

    // System-level instructions (sent as the first User message, since
    // the LM API does not support a dedicated "system" role yet).
    const systemPrompt =
      options.systemPrompt ??
      vscode.workspace
        .getConfiguration('copilotBotAi')
        .get<string>('systemPrompt', '');

    if (systemPrompt) {
      messages.push(vscode.LanguageModelChatMessage.User(systemPrompt));
    }

    // The actual user prompt
    messages.push(vscode.LanguageModelChatMessage.User(options.prompt));

    // 3. Send request
    const token =
      options.cancellationToken ?? new vscode.CancellationTokenSource().token;

    this.log(`→ Sending prompt to ${model.name} (${model.id}) …`);
    this.log(`  Family : ${model.family}`);
    this.log(`  Prompt : ${options.prompt.substring(0, 120)}${options.prompt.length > 120 ? '…' : ''}`);
    this.log('');

    let chatResponse: vscode.LanguageModelChatResponse;

    try {
      chatResponse = await model.sendRequest(messages, {}, token);
    } catch (err) {
      this.handleError(err);
      throw err;
    }

    // 4. Stream response
    let fullText = '';

    try {
      for await (const fragment of chatResponse.text) {
        fullText += fragment;
        onChunk?.(fragment);
      }
    } catch (err) {
      // The async stream can fail (e.g. network interruption).
      this.log(`\n⚠ Stream interrupted: ${(err as Error).message}`);
      throw err;
    }

    this.log('\n✔ Response complete.\n');

    return { fullText, model: model.id };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Append a line to the output channel. */
  private log(message: string): void {
    this.outputChannel.appendLine(message);
  }

  /** Handle errors thrown by `sendRequest`. */
  private handleError(err: unknown): void {
    if (err instanceof vscode.LanguageModelError) {
      const code = err.code;
      this.log(`✖ LanguageModelError [${code}]: ${err.message}`);

      switch (code) {
        case 'NotFound':
          vscode.window.showErrorMessage(
            'Copilot Bot AI: The requested language model was not found. Check your model family setting.'
          );
          break;
        case 'NoPermissions':
          vscode.window.showErrorMessage(
            'Copilot Bot AI: You have not granted permission to use the language model. Please consent when prompted.'
          );
          break;
        case 'Blocked':
          vscode.window.showWarningMessage(
            'Copilot Bot AI: The response was blocked by the content filter.'
          );
          break;
        default:
          vscode.window.showErrorMessage(
            `Copilot Bot AI: Language model error — ${err.message}`
          );
      }

      // LanguageModelError extends Error; the underlying cause may be
      // available on the standard Error.cause property (ES2022).
      const cause = (err as unknown as { cause?: Error }).cause;
      if (cause instanceof Error) {
        this.log(`  Cause: ${cause.message}`);
      }
    } else if (err instanceof Error) {
      this.log(`✖ Error: ${err.message}`);
      vscode.window.showErrorMessage(`Copilot Bot AI: ${err.message}`);
    } else {
      this.log(`✖ Unknown error: ${String(err)}`);
    }
  }
}
