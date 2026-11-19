export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}