<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowRight, LogIn, MessageCircle, Moon, ShieldCheck, UserCheck, UserPlus } from "lucide-vue-next";

const mode = ref<"login" | "register">("login");
const method = ref<"email" | "phone">("email");
const account = ref("dev@ejiabao.local");
const nickname = ref("开发体验用户");
const password = ref("dev123456");
const remember = ref(true);

const accountType = computed(() => method.value === "phone" ? "tel" : "email");
const accountLabel = computed(() => method.value === "phone" ? "手机号码" : "邮箱地址");
const accountPlaceholder = computed(() => method.value === "phone" ? "请输入手机号" : "name@example.com");
const submitLabel = computed(() => mode.value === "register" ? "创建账号并继续" : "登录并继续");

function setMethod(next: "email" | "phone") {
  method.value = next;
  account.value = next === "phone" ? "13800000000" : "dev@ejiabao.local";
  window.fillDefaultAuthAccount?.(true);
}

function toggleMode() {
  mode.value = mode.value === "login" ? "register" : "login";
  window.setAuthMode?.(mode.value);
}

async function submit() {
  const nextAccount = account.value.trim();
  if (!nextAccount || !password.value) return window.setAuthMessage?.("请填写登录账号和密码。");
  if (method.value === "phone" && !/^1\d{10}$/.test(nextAccount)) return window.setAuthMessage?.("请输入正确的 11 位手机号码。");
  if (method.value === "email" && !/^\S+@\S+\.\S+$/.test(nextAccount)) return window.setAuthMessage?.("请输入正确的邮箱地址。");
  if (password.value.length < 8) return window.setAuthMessage?.("密码至少需要 8 位。");
  try {
    await window.completeBackendLogin?.({ account: nextAccount, password: password.value, phoneMode: method.value === "phone", register: mode.value === "register" });
  } catch (error: any) {
    window.setAuthMessage?.(error?.message || "正式账号登录失败，请检查后端连接或账号密码。");
  }
}

function virtualLogin(methodName: "default" | "wechat") {
  window.completeVirtualFrontendLogin?.(methodName);
}

function toggleTheme() {
  window.toggleTheme?.();
}
</script>

<template>
  <section class="auth-page" id="authPage" aria-labelledby="auth-title">
    <div class="auth-shell">
      <div class="auth-copy">
        <a class="auth-brand" href="#" aria-label="品牌标识"><img src="/assets/ejiabao-logo-new.jpg" alt="品牌标识"></a>
        <div>
          <span class="landing-overline"><ShieldCheck :size="16" aria-hidden="true" />PERSONAL CREATOR CLOUD / 01</span>
          <h1 id="auth-title">先把账号交给你，<br><em>再把想法交给云端。</em></h1>
          <p>登录后，你的项目、素材、品牌设定和生成记录都会被安全保存。换一台 Windows 设备，也能从中间停下的地方继续。</p>
        </div>
        <div class="auth-proof-grid">
          <div class="auth-proof"><strong>云端同步</strong><span>项目与素材状态持续保存</span></div>
          <div class="auth-proof"><strong>设备授权</strong><span>加密优盘绑定后才可使用</span></div>
          <div class="auth-proof"><strong>随时续写</strong><span>从草稿到成片都能接着做</span></div>
        </div>
      </div>

      <section class="auth-card" aria-label="登录表单">
        <div class="auth-card-head">
          <div><span class="tag is-lime">欢迎回来</span><h2 style="margin-top:12px">登录创作空间</h2><p class="muted" style="margin-top:6px">选择一种方式继续</p></div>
          <button class="landing-button" id="authThemeToggle" type="button" aria-label="切换深浅主题" @click="toggleTheme"><Moon :size="16" aria-hidden="true" /></button>
        </div>

        <div class="auth-tabs" role="tablist" aria-label="登录方式">
          <button class="auth-tab" :class="{ 'is-active': method === 'email' }" type="button" role="tab" :aria-selected="method === 'email'" @click="setMethod('email')">邮箱登录</button>
          <button class="auth-tab" :class="{ 'is-active': method === 'phone' }" type="button" role="tab" :aria-selected="method === 'phone'" @click="setMethod('phone')">手机号登录</button>
        </div>

        <div class="auth-message" id="authMessage" role="status" aria-live="polite"></div>

        <form class="auth-form" id="authForm" @submit.prevent="submit">
          <div class="auth-field"><label for="authAccount" id="authAccountLabel">{{ accountLabel }}</label><input id="authAccount" v-model="account" :type="accountType" :placeholder="accountPlaceholder" autocomplete="username" required></div>
          <div class="auth-register-fields" id="authRegisterFields" :class="{ 'is-show': mode === 'register' }">
            <div class="auth-field"><label for="authNickname">创作者昵称</label><input id="authNickname" v-model="nickname" type="text" placeholder="给自己一个名字" autocomplete="nickname"></div>
          </div>
          <div class="auth-field"><label for="authPassword">密码</label><input id="authPassword" v-model="password" type="password" :placeholder="mode === 'register' ? '设置 8 位以上密码' : '请输入密码'" autocomplete="current-password" required></div>
          <div class="auth-row"><label class="auth-check"><input v-model="remember" type="checkbox"> 记住此设备</label><span class="muted">开发阶段虚拟登录</span></div>
          <button class="auth-submit" id="authSubmit" type="submit"><UserPlus v-if="mode === 'register'" :size="16" aria-hidden="true" /><ArrowRight v-else :size="16" aria-hidden="true" />{{ submitLabel }}</button>
        </form>

        <div class="auth-divider">开发授权</div>
        <div class="auth-dev-actions">
          <button class="wechat-login" type="button" @click="virtualLogin('default')"><UserCheck :size="16" aria-hidden="true" />默认账号登录</button>
          <button class="wechat-login" type="button" @click="virtualLogin('wechat')"><MessageCircle :size="16" aria-hidden="true" />微信授权登录</button>
        </div>
        <div class="auth-mode-row"><span id="authModeHint">{{ mode === 'register' ? '已经有账号？' : '还没有账号？' }}</span><button class="auth-link" type="button" id="authModeToggle" @click="toggleMode">{{ mode === 'register' ? '返回登录' : '创建账号' }}</button></div>
        <p class="auth-footnote">当前为开发阶段，默认账号与微信授权都会创建本地虚拟前端用户。</p>
      </section>
    </div>
  </section>
</template>
