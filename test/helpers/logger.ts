import { vi } from 'vitest';

export const loggers: any[] = [];

export const lastLogger = () => loggers[loggers.length - 1];

export const loggersNamed = (name: string) => loggers.filter((logger) => logger.context === name);

export class Logger {
  verbose = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  constructor(public context?: string) {
    loggers.push(this);
  }
}

export const loggerModule = { Logger };
