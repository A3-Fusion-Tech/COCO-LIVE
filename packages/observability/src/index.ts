const SENSITIVE = /(otp|secret|token|password|authorization|cookie|document|lat|lon|coordinates|phone)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(sink: (line: string) => void = (l) => void process.stdout.write(l + "\n"), base: Record<string, unknown> = {}): Logger {
  const emit = (level: string) => (msg: string, fields: Record<string, unknown> = {}) =>
    sink(JSON.stringify({ level, msg, time: new Date().toISOString(), ...(redact({ ...base, ...fields }) as object) }));
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export class Metrics {
  private counters = new Map<string, number>();
  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  snapshot() {
    return Object.fromEntries(this.counters);
  }
}

export const newCorrelationId = () => `req_${crypto.randomUUID().replace(/-/g, "")}`;
