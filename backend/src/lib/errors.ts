import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function asAppError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError("请求参数格式不正确。", "REQUEST_VALIDATION_FAILED", 400, {
      issues: error.issues.map(issue => ({
        path: issue.path,
        message: issue.message,
        code: issue.code
      }))
    });
  }
  return new AppError("服务器内部错误。", "INTERNAL_ERROR", 500);
}
