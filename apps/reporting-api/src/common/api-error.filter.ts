import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, isApiError } from '@qakit/reporting-shared';

/**
 * Translates the shared package's ApiError hierarchy (NotFoundError, ValidationError, ...)
 * into real HTTP status codes. Without this, services that `throw new NotFoundError(...)`
 * fall through Nest's default handler and surface as a 500.
 */
@Catch(ApiError)
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: ApiError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (isApiError(exception)) {
      response.status(exception.statusCode).json(exception.toJSON());
      return;
    }

    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
