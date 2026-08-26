export class CoreEngineError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoreEngineError";
    this.httpStatus = httpStatus;
  }
}

export class BadRequestError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 400, options);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 401, options);
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 404, options);
    this.name = "NotFoundError";
  }
}

export class ServiceDisabledError extends NotFoundError {
  readonly capability: string;

  constructor(message: string, capability: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceDisabledError";
    this.capability = capability;
  }
}

export class ServerError extends CoreEngineError {
  constructor(message: string, httpStatus: number, options?: { cause?: unknown }) {
    super(message, httpStatus, options);
    this.name = "ServerError";
  }
}

export class RateLimitError extends CoreEngineError {
  readonly retryAfterMs?: number;

  constructor(message: string, options?: { retryAfterMs?: number; cause?: unknown }) {
    super(message, 429, options);
    this.name = "RateLimitError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class ContextValidationError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 422, options);
    this.name = "ContextValidationError";
  }
}

export class IssuerDidValidationError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 422, options);
    this.name = "IssuerDidValidationError";
  }
}

export class KeyIdValidationError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 422, options);
    this.name = "KeyIdValidationError";
  }
}

export class RenderMethodValidationError extends CoreEngineError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 422, options);
    this.name = "RenderMethodValidationError";
  }
}
