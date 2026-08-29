/** 浏览器端认证 API；服务端地址和路径集中管理。 */
export function createAuthApi({ http, config }) {
  const paths = {
    login: config.auth?.loginPath || "/v1/auth/login",
    register: config.auth?.registerPath || "/v1/auth/register",
    wechat: config.auth?.wechatPath || "/v1/auth/wechat",
    sendCode: config.auth?.sendCodePath || "/v1/auth/send-code",
    forgot: config.auth?.forgotPath || "/v1/auth/forgot"
  };

  async function login(payload) { return unwrap(await http.post(paths.login, payload)); }
  async function register(payload) { return unwrap(await http.post(paths.register, payload)); }
  async function wechat(payload) { return unwrap(await http.post(paths.wechat, payload)); }
  async function sendCode(payload) { return unwrap(await http.post(paths.sendCode, payload)); }
  async function forgot(payload) { return unwrap(await http.post(paths.forgot, payload)); }

  return { login, register, wechat, sendCode, forgot, paths };
}

function unwrap(response) {
  const data = response?.data || {};
  return {
    user: data.user || data.account || data.profile,
    accessToken: data.accessToken || data.access_token,
    refreshToken: data.refreshToken || data.refresh_token,
    ...data
  };
}
