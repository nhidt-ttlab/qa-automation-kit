/**
 * Error types and handling for the reporting system
 */

import type { API_RESPONSE_CODE } from '../constants.js';

export class ApiError extends Error {
  constructor(
    public code: (typeof API_RESPONSE_CODE)[keyof typeof API_RESPONSE_CODE],
    public message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id "${id}" not found`, 404);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'Forbidden') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class InternalError extends ApiError {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super('INTERNAL_ERROR', message, 500, details);
    this.name = 'InternalError';
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string = 'Rate limit exceeded', details?: Record<string, unknown>) {
    super('RATE_LIMITED', message, 429, details);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Wrap a promise to convert errors to ApiError
 */
export async function withErrorHandling<T>(
  promise: Promise<T>,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }

    if (error instanceof Error) {
      throw new InternalError(error.message);
    }

    throw new InternalError('An unexpected error occurred');
  }
}
