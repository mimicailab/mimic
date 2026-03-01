import chalk from 'chalk';
import ora, { type Ora } from 'ora';

let verboseMode = false;

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
};
