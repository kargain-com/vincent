/** Error thrown when input cannot be canonicalized per RFC 8785 / I-JSON. */
export class CanonicalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizeError';
  }
}

function hasLoneSurrogates(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) {
        return true;
      }
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertValidString(value: string): void {
  if (hasLoneSurrogates(value)) {
    throw new CanonicalizeError('String contains lone Unicode surrogates');
  }
}

function assertValidNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalizeError('Number must be finite (NaN and Infinity are invalid in JSON)');
  }
}

function serializePrimitive(value: unknown): string {
  if (typeof value === 'number') {
    assertValidNumber(value);
  }
  if (typeof value === 'string') {
    assertValidString(value);
  }
  if (value === undefined) {
    throw new CanonicalizeError('Undefined is not valid in canonical JSON');
  }
  return JSON.stringify(value);
}

function compareUtf16(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) {
      return ca - cb;
    }
  }
  return a.length - b.length;
}

function sortPropertyNames(keys: string[]): string[] {
  return keys.sort(compareUtf16);
}

function serialize(value: unknown, parts: string[]): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value !== null &&
      typeof value === 'object' &&
      'toJSON' in value &&
      typeof (value as { toJSON?: unknown }).toJSON === 'function')
  ) {
    parts.push(serializePrimitive(value));
    return;
  }

  if (Array.isArray(value)) {
    parts.push('[');
    let next = false;
    for (const element of value) {
      if (next) {
        parts.push(',');
      }
      next = true;
      serialize(element, parts);
    }
    parts.push(']');
    return;
  }

  parts.push('{');
  let next = false;
  const record = value as Record<string, unknown>;
  for (const property of sortPropertyNames(Object.keys(record))) {
    if (next) {
      parts.push(',');
    }
    next = true;
    assertValidString(property);
    parts.push(JSON.stringify(property));
    parts.push(':');
    const propValue = record[property];
    if (propValue === undefined) {
      throw new CanonicalizeError('Object property value must not be undefined');
    }
    serialize(propValue, parts);
  }
  parts.push('}');
}

/** Canonicalize a JSON-compatible value per RFC 8785 (JCS). */
export function canonicalize(doc: unknown): string {
  const parts: string[] = [];
  serialize(doc, parts);
  return parts.join('');
}
