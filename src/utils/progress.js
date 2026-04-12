import cliProgress from 'cli-progress';
import chalk from 'chalk';
import ora from 'ora';

/**
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Spinner + byte counter when total size is unknown (e.g. pg_dump stream).
 * @param {string} text
 * @param {{ verbose?: boolean }} ctx
 */
export function createStreamProgress(text, ctx = {}) {
  if (ctx.verbose) {
    let bytes = 0;
    return {
      start() {},
      /** @param {number} n */
      increment(n) {
        bytes += n;
      },
      succeed(finalText) {
        if (finalText) console.log(finalText);
      },
      fail() {},
      getBytes: () => bytes,
    };
  }

  const spin = ora({ text, spinner: 'dots' }).start();
  let bytes = 0;

  return {
    start() {},
    /** @param {number} n */
    increment(n) {
      bytes += n;
      spin.text = `${text} ${formatBytes(bytes)}`;
    },
    succeed(finalText) {
      spin.succeed(finalText ?? `${text} ${formatBytes(bytes)}`);
    },
    fail(msg) {
      spin.fail(msg);
    },
    getBytes: () => bytes,
  };
}

/**
 * Progress bar when total bytes known (e.g. restore from file).
 * @param {string} label
 * @param {number} totalBytes
 * @param {{ verbose?: boolean }} ctx
 */
export function createFileProgressBar(label, totalBytes, ctx = {}) {
  if (ctx.verbose || totalBytes <= 0) {
    let transferred = 0;
    return {
      start() {},
      /** @param {number} n */
      increment(n) {
        transferred += n;
      },
      stop() {},
      getTransferred() {
        return transferred;
      },
    };
  }

  const bar = new cliProgress.SingleBar(
    {
      format: `${label} |${chalk.cyan('{bar}')}| {percentage}% | {transferred} | {duration}s`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  let transferred = 0;
  const startTime = Date.now();

  return {
    start() {
      bar.start(totalBytes, 0, {
        transferred: '0 B',
        duration: '0.0',
      });
    },
    /** @param {number} n */
    increment(n) {
      transferred += n;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      bar.update(transferred, {
        transferred: formatBytes(transferred),
        duration: elapsed,
      });
    },
    stop() {
      bar.stop();
    },
    getTransferred() {
      return transferred;
    },
  };
}
