#!/usr/bin/env node
/**
 * copilot-bot  — terminal CLI for copilot-bot-ai
 *
 * Prerequisites
 *   1. Install the copilot-bot-ai VS Code extension.
 *   2. Run command: "Copilot Bot AI: Save Token for CLI"  (once per machine).
 *   3. npm install -g (or use npx) after `npm run package:install`.
 *
 * Usage
 *   copilot-bot "What is recursion?"
 *   copilot-bot "Explain async/await" --model claude-sonnet-4.6
 *   copilot-bot "Review this code" --system "You are a senior engineer"
 *   echo "explain quicksort" | copilot-bot
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_FILE = join(homedir(), '.copilot-bot-ai', 'config.json');
const API_URL     = 'https://api.githubcopilot.com/chat/completions';

const VALID_MODELS = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5-mini',
  'o1', 'o1-mini', 'o3-mini',
  'claude-opus-4.6', 'claude-sonnet-4.6', 'claude-sonnet-4.5',
];

// ── CLI argument parsing ───────────────────────────────────────────────────────
const args = process.argv.slice(2);

function parseArgs(argv) {
  const result = { model: 'gpt-4o', system: '', prompt: '' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model' && argv[i + 1]) {
      result.model = argv[++i];
    } else if (argv[i] === '--system' && argv[i + 1]) {
      result.system = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      printHelp();
      process.exit(0);
    } else if (!argv[i].startsWith('--')) {
      positional.push(argv[i]);
    }
  }
  result.prompt = positional.join(' ');
  return result;
}

function printHelp() {
  console.log(`
copilot-bot — GitHub Copilot terminal CLI

Usage:
  copilot-bot "Your prompt here" [options]
  echo "prompt" | copilot-bot [options]

Options:
  --model <name>     Model family to use (default: gpt-4o)
  --system <text>    Custom system prompt
  --help, -h         Show this help

Valid models:
  ${VALID_MODELS.join(', ')}

Setup (one-time):
  1. Install the copilot-bot-ai VS Code extension
  2. Open VS Code Command Palette → "Copilot Bot AI: Save Token for CLI"
`);
}

// ── Read token ────────────────────────────────────────────────────────────────
function readToken() {
  if (!existsSync(CONFIG_FILE)) {
    console.error(`
❌  No auth token found at ${CONFIG_FILE}

Setup (one-time):
  1. Install the copilot-bot-ai VS Code extension
  2. Open VS Code Command Palette (Cmd+Shift+P / Ctrl+Shift+P)
  3. Run: "Copilot Bot AI: Save Token for CLI"
  4. Re-run this command
`);
    process.exit(1);
  }

  try {
    const cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    if (!cfg.github_token) throw new Error('github_token field missing');
    return cfg.github_token;
  } catch (err) {
    console.error(`❌  Failed to parse ${CONFIG_FILE}: ${err.message}`);
    process.exit(1);
  }
}

// ── Read stdin if available ───────────────────────────────────────────────────
async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

// ── Copilot REST streaming ────────────────────────────────────────────────────
async function streamCopilot(token, model, messages) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization':           `Bearer ${token}`,
        'Content-Type':            'application/json',
        'Copilot-Integration-Id':  'vscode-chat',
        'Accept':                  'text/event-stream',
        'editor-version':          'vscode/1.99.0',
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch (err) {
    console.error(`❌  Network error: ${err.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`❌  API error ${response.status}: ${body}`);
    if (response.status === 401) {
      console.error('\n   Token may be expired. Re-run "Copilot Bot AI: Save Token for CLI" in VS Code.');
    }
    process.exit(1);
  }

  // Parse SSE stream
  const decoder  = new TextDecoder();
  let   leftover = '';

  for await (const rawChunk of response.body) {
    const text  = leftover + decoder.decode(rawChunk, { stream: true });
    const lines = text.split('\n');
    leftover    = lines.pop() ?? '';   // last incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed  = JSON.parse(payload);
        const content = parsed?.choices?.[0]?.delta?.content;
        if (typeof content === 'string') process.stdout.write(content);
      } catch {
        // ignore malformed JSON chunks
      }
    }
  }

  // Ensure a trailing newline
  process.stdout.write('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { model, system, prompt: cliPrompt } = parseArgs(args);

  // Accept prompt from stdin or CLI argument
  const stdinText = await readStdin();
  const prompt    = (cliPrompt || stdinText).trim();

  if (!prompt) {
    console.error('❌  No prompt provided.  Try: copilot-bot "Hello world" or echo "Hello" | copilot-bot');
    printHelp();
    process.exit(1);
  }

  const token = readToken();

  const messages = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: prompt });

  await streamCopilot(token, model, messages);
}

main().catch((err) => {
  console.error(`❌  Unexpected error: ${err.message}`);
  process.exit(1);
});
