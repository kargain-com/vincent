/** Thrown when no ANS-104 item matches owner + tags (decoder maps to unknown-wmi). */
export class LeafNotFoundError extends Error {
  constructor(leafKey: string) {
    super(`missing leaf for LeafKey: ${leafKey}`);
    this.name = 'LeafNotFoundError';
  }
}
