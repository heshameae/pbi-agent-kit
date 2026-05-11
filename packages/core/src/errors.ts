// User-facing error types for pbi-core.
//
// Ported from pbi-cli's core/errors.py (report-layer subset only — modeling
// errors are handled by Microsoft's MCP).

export class PbiCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ReportNotFoundError extends PbiCoreError {
  constructor(
    message = 'No PBIR report found. Run this command inside a .pbip project or pass an explicit path to the .Report folder.',
  ) {
    super(message);
  }
}

export class VisualTypeError extends PbiCoreError {
  readonly visualType: string;
  constructor(visualType: string) {
    super(`Unknown visual type '${visualType}'.`);
    this.visualType = visualType;
  }
}

export class PbirValidationError extends PbiCoreError {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`PBIR validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.errors = errors;
  }
}
