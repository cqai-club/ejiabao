/**
 * 认证服务。
 * 当前默认使用本地演示 provider 保持 UI 可离线预览；接入正式账号系统时传入 api 即可替换。
 */
export function createAuthService({ storage, session, eventBus, api = null, config = {} }) {
  function validateIdentifier(identifier) {
    const value = String(identifier || "").trim();
    const isPhone = /^\+?[0-9\s-]{6,20}$/.test(value);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!isPhone && !isEmail) throw new Error("请输入正确的邮箱或手机号码。");
    return { value, kind: isEmail ? "email" : "phone" };
  }

  function validatePassword(password) {
    if (String(password || "").length < 8) throw new Error("密码至少需要 8 位。");
  }

  async function login({ identifier, password, remember = true } = {}) {
    const account = validateIdentifier(identifier);
    if (!String(password || "")) throw new Error("请输入密码。");
    if (!api?.login && !config.allowDemo) throw new Error("账号服务尚未配置，暂时无法登录。");
    const result = api?.login
      ? await api.login({ ...toApiAccount(account), password, remember })
      : { user: { id: account.value, identifier: account.value, identifierKind: account.kind, name: "个人创作者" } };
    const nextSession = session.start({ user: result.user, remember, authMethod: account.kind, accessToken: result.accessToken, refreshToken: result.refreshToken });
    eventBus.emit("auth:signed-in", nextSession);
    return nextSession;
  }

  async function register({ identifier, password, inviteCode = "" } = {}) {
    const account = validateIdentifier(identifier);
    validatePassword(password);
    if (!api?.register && !config.allowDemo) throw new Error("账号服务尚未配置，暂时无法注册。");
    if (api?.register) return api.register({ ...toApiAccount(account), password, inviteCode });
    return login({ identifier, password, remember: true });
  }

  async function loginWithWeChat({ code } = {}) {
    if (!code && !api?.wechat) throw new Error("微信授权尚未完成，请稍后重试。");
    if (!api?.wechat && !config.allowDemo) throw new Error("微信授权服务尚未配置。");
    const result = api?.wechat
      ? await api.wechat({ code })
      : { user: { id: `wechat:${Date.now()}`, name: "微信用户", identifierKind: "wechat" } };
    const nextSession = session.start({ user: result.user, remember: true, authMethod: "wechat", accessToken: result.accessToken, refreshToken: result.refreshToken });
    eventBus.emit("auth:signed-in", nextSession);
    return nextSession;
  }

  function logout({ clearLocalData = false } = {}) {
    session.clear("logout");
    if (clearLocalData) storage.clear();
    eventBus.emit("auth:signed-out", { clearLocalData });
  }

  async function sendCode({ identifier, purpose = "register" } = {}) {
    const account = validateIdentifier(identifier);
    if (!api?.sendCode && !config.allowDemo) throw new Error("验证码服务尚未配置。");
    return api?.sendCode ? api.sendCode({ ...toApiAccount(account), purpose }) : { sent: true, demo: true };
  }

  async function forgotPassword({ identifier } = {}) {
    const account = validateIdentifier(identifier);
    if (!api?.forgot && !config.allowDemo) throw new Error("找回密码服务尚未配置。");
    return api?.forgot ? api.forgot(toApiAccount(account)) : { accepted: true, demo: true };
  }

  return { login, register, loginWithWeChat, logout, sendCode, forgotPassword, validateIdentifier, validatePassword };
}

function toApiAccount(account) {
  return account.kind === "email" ? { email: account.value } : { phone: account.value };
}
