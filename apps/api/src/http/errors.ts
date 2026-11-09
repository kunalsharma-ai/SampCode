/**
 * HTTP errors. Services and route handlers throw these; the error middleware (app.ts) turns them into
 * the JSON answer. The bodies keep the shape the studio, the apps and API clients already read:
 *   throw new NotFoundException('Survey not found')  ->  404 { message, error: 'Not Found', statusCode: 404 }
 *   throw new ForbiddenException({ message, code })   ->  403 { message, code }   (an object is sent as it is)
 */

export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  PAYMENT_REQUIRED = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  GONE = 410,
  PAYLOAD_TOO_LARGE = 413,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export const statusTitle = (status: number) => TITLES[status] ?? 'Error';

export type ErrorBody = string | Record<string, unknown>;

/** An error with an HTTP status and the body to answer with. */
export class HttpException extends Error {
  constructor(
    private readonly response: ErrorBody,
    private readonly status: number,
  ) {
    super(typeof response === 'string' ? response : typeof response.message === 'string' ? response.message : statusTitle(status));
    this.name = new.target.name;
  }

  getStatus(): number {
    return this.status;
  }

  getResponse(): ErrorBody {
    return this.response;
  }

  /** The JSON body of the answer. */
  toBody(): Record<string, unknown> {
    return typeof this.response === 'string' ? { statusCode: this.status, message: this.response } : this.response;
  }
}

/** The body for `new XxxException(messageOrObject?)`: a message gets the standard shape, an object is kept. */
function body(status: number, messageOrObject: unknown): ErrorBody {
  if (messageOrObject === undefined) return { message: statusTitle(status), statusCode: status };
  if (typeof messageOrObject === 'string' || Array.isArray(messageOrObject))
    return { message: messageOrObject, error: statusTitle(status), statusCode: status };
  return messageOrObject as Record<string, unknown>;
}

const make = (status: number) =>
  class extends HttpException {
    constructor(messageOrObject?: string | string[] | Record<string, unknown>) {
      super(body(status, messageOrObject), status);
    }
  };

export class BadRequestException extends make(400) {}
export class UnauthorizedException extends make(401) {}
export class ForbiddenException extends make(403) {}
export class NotFoundException extends make(404) {}
export class ConflictException extends make(409) {}
export class GoneException extends make(410) {}
export class PayloadTooLargeException extends make(413) {}
export class UnprocessableEntityException extends make(422) {}
export class TooManyRequestsException extends make(429) {}
export class InternalServerErrorException extends make(500) {}
export class BadGatewayException extends make(502) {}
export class ServiceUnavailableException extends make(503) {}
