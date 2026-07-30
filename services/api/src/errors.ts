export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function notFound(message: string): never {
  throw new ApiError(404, "NOT_FOUND", message);
}

export function conflict(code: string, message: string): never {
  throw new ApiError(409, code, message);
}
