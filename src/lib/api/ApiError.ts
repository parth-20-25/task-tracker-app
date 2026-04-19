export class ApiError extends Error {
  status: number;
  details: unknown;
  errorCode: string;

  constructor(message: string, status: number, details?: unknown, errorCode: string = "UNKNOWN_ERROR") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details ?? null;
    this.errorCode = errorCode;
  }
}
