import chalk from 'chalk';

/** @typedef {{ verbose?: boolean }} LogContext */

/**
 * @param {LogContext} ctx
 * @param {...unknown} args
 */
export function debug(ctx, ...args) {
  if (ctx?.verbose) {
    console.error(chalk.gray('[debug]'), ...args);
  }
}

export const icons = {
  ok: '✅',
  err: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  pkg: '📦',
  save: '💾',
  link: '🔗',
  chart: '📊',
  empty: '📭',
  spin: '🔄',
};

/**
 * @param {string} msg
 */
export function success(msg) {
  console.log(`${icons.ok} ${chalk.green(msg)}`);
}

/**
 * @param {string} msg
 */
export function errorLine(msg) {
  console.error(`${icons.err} ${chalk.red.bold(msg)}`);
}

/**
 * Destructive or high-attention warning (yellow + bold in terminals that support it).
 * @param {string} msg
 */
export function warnLine(msg) {
  console.error(`${icons.warn} ${chalk.yellow.bold(msg)}`);
}

/**
 * Secondary explanation after a warning (dim; does not imply an error).
 * @param {string} msg
 */
export function noteLine(msg) {
  console.log(`${icons.info} ${chalk.dim(msg)}`);
}

/**
 * @param {string} msg
 */
export function infoLine(msg) {
  console.log(msg);
}

/**
 * @param {import('./errors.js').AppError} err
 */
export function printErrorWithSuggestion(err) {
  errorLine(err.message);
  if (err.suggestion) {
    console.error(chalk.dim(`   ${err.suggestion}`));
  }
}
