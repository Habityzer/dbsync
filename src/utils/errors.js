/**
 * Application errors with optional suggested fixes for CLI output.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {string} [opts.suggestion]
   * @param {number} [opts.exitCode]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'AppError';
    this.suggestion = opts.suggestion;
    this.exitCode = opts.exitCode ?? 1;
  }
}

export class ConfigError extends AppError {
  constructor(message, suggestion) {
    super(message, { suggestion });
    this.name = 'ConfigError';
  }
}

export class ConnectionError extends AppError {
  constructor(message, suggestion) {
    super(message, { suggestion });
    this.name = 'ConnectionError';
  }
}

export class FileSystemError extends AppError {
  constructor(message, suggestion) {
    super(message, { suggestion });
    this.name = 'FileSystemError';
  }
}

export class BackupError extends AppError {
  constructor(message, suggestion) {
    super(message, { suggestion });
    this.name = 'BackupError';
  }
}
