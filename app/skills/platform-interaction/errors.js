/** 平台交互层的统一错误类型。 */
export class PlatformInteractionError extends Error {
  constructor(message, { provider, code = "PLATFORM_ERROR", status, cause } = {}) {
    super(message, { cause });
    this.name = "PlatformInteractionError";
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}
