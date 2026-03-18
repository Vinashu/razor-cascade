export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "text";

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  context?: LogContext;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeLevel(level: LogLevel | string): LogLevel {
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }

  return "info";
}

function formatEntry(entry: LogEntry, format: LogFormat): string {
  if (format === "text") {
    const context = entry.context && Object.keys(entry.context).length > 0 ? ` ${JSON.stringify(entry.context)}` : "";
    return `[${entry.level}] ${entry.timestamp} ${entry.message}${context}`;
  }

  return JSON.stringify(entry);
}

export class Logger {
  private level: LogLevel;
  private format: LogFormat;

  public constructor(level: LogLevel = "info", format: LogFormat = "json") {
    this.level = normalizeLevel(level);
    this.format = format;
  }

  public setLevel(level: LogLevel | string): void {
    this.level = normalizeLevel(level);
  }

  public setFormat(format: LogFormat): void {
    this.format = format;
  }

  public debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  public error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.level]) {
      return;
    }

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    };

    console.error(formatEntry(entry, this.format));
  }
}

export const logger = new Logger();
export default logger;
