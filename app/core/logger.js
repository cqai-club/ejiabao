/**
 * 统一日志入口。正式版可以在这里接入本地日志文件、远端日志或加密优盘日志。
 */
export function createLogger(scope = "app") {
  const prefix = `[e剪宝/${scope}]`;
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args)
  };
}
