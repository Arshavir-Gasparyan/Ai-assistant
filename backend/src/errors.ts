/**
 * An expected, client-facing error. The global error handler turns it into
 * { error: { code, message } } with the given HTTP status.
 * Throw it for things the client did wrong or can fix (bad file type, not found...).
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
