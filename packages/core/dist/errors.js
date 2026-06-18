// User-facing error type for pbi-core.
export class PbiCoreError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}
//# sourceMappingURL=errors.js.map