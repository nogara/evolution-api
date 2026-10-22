import { vi } from 'vitest';

export const loggers: any[] = [];

export const lastLogger = () => loggers[loggers.length - 1];

export const loggersNamed = (name: string) => loggers.filter((logger) => logger.context === name);

export const onlyLoggerNamed = (name: string) => {
  const found = loggersNamed(name);
  if (found.length !== 1) {
    throw new Error(`Expected exactly one logger named ${name}, found ${found.length}`);
  }
  return found[0];
};

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
