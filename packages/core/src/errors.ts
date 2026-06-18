// User-facing error type for pbi-core.

export class PbiCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
