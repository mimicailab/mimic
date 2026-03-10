import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';

let verboseMode = false;
let debugLogPath: string | null = null;

export function setVerbose(enabled: boolean): void {
  verboseMode = enabled;
}

export function isVerbose(): boolean {
  return verboseMode;
}

export function step(message: string): void {
  console.log(chalk.blue('▸') + ' ' + message);
}

export function success(message: string): void {
  console.log(chalk.green('✓') + ' ' + message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + chalk.yellow(message));
}

export function error(message: string): void {
  console.error(chalk.red('✗') + ' ' + chalk.red(message));
}

export function debug(message: string): void {
  if (verboseMode) {
    console.log(chalk.gray('  ' + message));
  }
}

export function info(message: string): void {
  console.log(chalk.dim('  ' + message));
}

export function done(message: string): void {
  console.log();
  console.log(chalk.green.bold('✓') + ' ' + chalk.bold(message));
}

export function header(title: string): void {
  console.log();
  console.log(chalk.bold(title));
  console.log(chalk.dim('━'.repeat(Math.min(title.length + 4, 60))));
}

export function spinner(text: string): Ora {
  return ora({ text, color: 'blue' }).start();
}

/**
 * Initialize file-based debug logging. All `debugFile()` calls will append
 * to this file. Creates the parent directory if needed.
 */
export function initDebugLog(filePath: string): void {
  debugLogPath = filePath;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `=== Mimic Debug Log — ${new Date().toISOString()} ===\n\n`);
}

/**
 * Append a structured section to the debug log file.
 * No-op if `initDebugLog()` has not been called.
 */
export function debugFile(section: string, data: unknown): void {
  if (!debugLogPath) return;
  const separator = '─'.repeat(72);
  const timestamp = new Date().toISOString();
  let body: string;
  if (typeof data === 'string') {
    body = data;
  } else {
    try {
      body = JSON.stringify(data, null, 2);
    } catch {
      body = String(data);
    }
  }
  appendFileSync(
    debugLogPath,
    `\n${separator}\n[${timestamp}] ${section}\n${separator}\n${body}\n`,
  );
}

export const logger = {
  step,
  success,
  warn,
  error,
  debug,
  info,
  done,
  header,
  spinner,
  setVerbose,
  isVerbose,
  initDebugLog,
  debugFile,
};
