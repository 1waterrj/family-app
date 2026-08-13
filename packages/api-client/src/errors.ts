import { ApiErrorSchema, type ApiErrorCode } from '@family/contracts';

export type FamilyApiErrorKind =
  | 'AUTHENTICATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'OFFLINE'
  | 'UNAVAILABLE'
  | 'UNEXPECTED';

export class FamilyApiError extends Error {
  readonly kind: FamilyApiErrorKind;
  readonly code?: ApiErrorCode;
  readonly requestId?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly status?: number;

  constructor(
    kind: FamilyApiErrorKind,
    message: string,
    details: {
      code?: ApiErrorCode;
      requestId?: string;
      fieldErrors?: Record<string, string[]>;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = 'FamilyApiError';
    this.kind = kind;
    this.code = details.code;
    this.requestId = details.requestId;
    this.fieldErrors = details.fieldErrors;
    this.status = details.status;
  }

  static malformedResponse(): FamilyApiError {
    return new FamilyApiError(
      'UNEXPECTED',
      'The API returned an invalid response.',
    );
  }

  static offline(): FamilyApiError {
    return new FamilyApiError('OFFLINE', 'Unable to reach the API.');
  }
}

export function toFamilyApiError(
  status: number,
  payload: unknown,
): FamilyApiError {
  const contracted = ApiErrorSchema.safeParse(payload);
  const details = contracted.success
    ? {
        code: contracted.data.code,
        requestId: contracted.data.requestId,
        fieldErrors: contracted.data.fieldErrors,
        status,
      }
    : { status };
  const message = contracted.success
    ? contracted.data.message
    : 'The API request failed.';

  return new FamilyApiError(kindForStatus(status), message, details);
}

function kindForStatus(status: number): FamilyApiErrorKind {
  if (status === 401) return 'AUTHENTICATION';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return 'VALIDATION';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'UNAVAILABLE';
  }
  return 'UNEXPECTED';
}
