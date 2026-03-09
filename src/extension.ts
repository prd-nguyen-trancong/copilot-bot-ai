import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { CopilotService } from './copilotService';
import { CopilotBotAiApi, CopilotResponse } from './types';

// Path where the CLI reads its cached token
const CLI_CONFIG_DIR  = path.join(os.homedir(), '.copilot-bot-ai');
const CLI_CONFIG_FILE = path.join(CLI_CONFIG_DIR, 'config.json');

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

let service: CopilotService;

/**
 * Called by VS Code when the extension is activated.
 *
 * @returns A public API object that other extensions can consume via
 * `vscode.extensions.getExtension('your-publisher.copilot-bot-ai').exports`.
 */
export function activate(
  context: vscode.ExtensionContext
): CopilotBotAiApi {
  // 1. Create a dedicated Output Channel for all responses
  const outputChannel = vscode.window.createOutputChannel('Copilot Bot AI');
  context.subscriptions.push(outputChannel);

  // 2. Instantiate the core service
  service = new CopilotService(outputChannel);

  // 3. Register the interactive command ──────────────────────────────────
  const sendPromptCmd = vscode.commands.registerCommand(
    'copilotBotAi.sendPrompt',
    async () => {
      // Prompt the user for input
      const userPrompt = await vscode.window.showInputBox({
        title: 'Copilot Bot AI',
        prompt: 'Enter your prompt for Copilot',
        placeHolder: 'e.g. Explain the observer pattern with a TypeScript example',
        ignoreFocusOut: true,
      });

      if (!userPrompt) {
        return; // user cancelled
      }

      // Show & focus the output channel
      outputChannel.show(true /* preserveFocus */);
      outputChannel.appendLine('━'.repeat(60));
      outputChannel.appendLine(`📝 Prompt: ${userPrompt}`);
      outputChannel.appendLine('━'.repeat(60));

      try {
        const response: CopilotResponse = await service.sendPrompt(
          { prompt: userPrompt },
          // Stream every chunk directly into the output channel
          (chunk) => outputChannel.append(chunk)
        );

        outputChannel.appendLine('');
        outputChannel.appendLine(`── Model: ${response.model} ──`);
        outputChannel.appendLine('');
      } catch {
        outputChannel.appendLine('');
        outputChannel.appendLine('── Request failed. See error above. ──');
        outputChannel.appendLine('');
      }
    }
  );
  context.subscriptions.push(sendPromptCmd);

  // 4. Command: save GitHub token so the CLI can use it outside VS Code ────
  const saveTokenCmd = vscode.commands.registerCommand(
    'copilotBotAi.saveTokenForCLI',
    async () => {
      try {
        // Trigger GitHub sign-in (no-op if already authenticated)
        const session = await vscode.authentication.getSession(
          'github',
          ['read:user'],
          { createIfNone: true }
        );

        if (!fs.existsSync(CLI_CONFIG_DIR)) {
          fs.mkdirSync(CLI_CONFIG_DIR, { recursive: true, mode: 0o700 });
        }

        const cfg = {
          github_token: session.accessToken,
          account:      session.account.label,
          saved_at:     new Date().toISOString(),
        };
        fs.writeFileSync(CLI_CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });

        const msg = `✅ Token for "${cfg.account}" saved to ${CLI_CONFIG_FILE}. You can now run copilot-bot from any terminal.`;
        vscode.window.showInformationMessage(msg);
        outputChannel.appendLine(msg);
      } catch (err) {
        const msg = `Failed to save token: ${String(err)}`;
        vscode.window.showErrorMessage(`Copilot Bot AI: ${msg}`);
        outputChannel.appendLine(`✖ ${msg}`);
      }
    }
  );
  context.subscriptions.push(saveTokenCmd);

  // 5. Listen for model availability changes ────────────────────────────────
  const onModelsChanged = vscode.lm.onDidChangeChatModels(() => {
    outputChannel.appendLine('ℹ  Available language models changed.');
  });
  context.subscriptions.push(onModelsChanged);

  // 6. Return the public API for other extensions ────────────────────────
  const api: CopilotBotAiApi = {
    async sendPrompt(prompt, options) {
      return service.sendPrompt({ prompt, ...options });
    },
    async sendPromptStreaming(prompt, onChunk, options) {
      return service.sendPrompt({ prompt, ...options }, onChunk);
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  // Nothing to clean up — VS Code disposes subscriptions automatically.
}
