type LogFields = Record<string, unknown>;

function line(level: string, msg: string, fields?: LogFields): void {
  const ts = new Date().toISOString();
  const suffix = fields ? " " + JSON.stringify(fields) : "";
  console.log(`[${ts}] [${level}] ${msg}${suffix}`);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => line("INFO", msg, fields),
  warn: (msg: string, fields?: LogFields) => line("WARN", msg, fields),
  error: (msg: string, fields?: LogFields) => line("ERROR", msg, fields),
};
