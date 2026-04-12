#!/usr/bin/env node
import { runCli } from '../src/index.js';
import { AppError } from '../src/utils/errors.js';
import { printErrorWithSuggestion } from '../src/utils/ui.js';

runCli(process.argv).catch((err) => {
  if (err instanceof AppError) {
    printErrorWithSuggestion(err);
    process.exit(err.exitCode ?? 1);
    return;
  }
  console.error(err?.message || err);
  process.exit(1);
});
