export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly messageKey: string;
  constructor(code: string, status: number, message: string, messageKey = `error.${code.toLowerCase()}`) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.messageKey = messageKey;
  }
}

export const conflict = (code: string, message: string) => new DomainError(code, 409, message);
export const invalid = (code: string, message: string) => new DomainError(code, 422, message);
export const forbidden = (message = "Not permitted") => new DomainError("FORBIDDEN", 403, message);
export const notFound = (what = "Resource") => new DomainError("NOT_FOUND", 404, `${what} not found`);
