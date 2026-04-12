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
  console.log(`${icons.ok} ${msg}`);
}

/**
 * @param {string} msg
 */
export function errorLine(msg) {
  console.error(`${icons.err} ${msg}`);
}

/**
 * @param {string} msg
 */
export function warnLine(msg) {
  console.error(`${icons.warn} ${msg}`);
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
