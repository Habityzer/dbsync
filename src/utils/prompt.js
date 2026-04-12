import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * @param {string} question
 */
export async function ask(question) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * @param {string} question
 */
export async function confirm(question) {
  const a = (await ask(question)).trim().toLowerCase();
  return a === 'y' || a === 'yes';
}
