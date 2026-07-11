export function parseField(value: string): string | null {
  return value === '\\N' ? null : value;
}

export function parseIntField(value: string): number | null {
  const parsed = parseField(value);
  if (parsed === null) {
    return null;
  }
  const num = Number.parseInt(parsed, 10);
  return Number.isNaN(num) ? null : num;
}

export function trimField(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
