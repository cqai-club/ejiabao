<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowLeft, ImageUp, Save, ShieldCheck, SlidersHorizontal } from "lucide-vue-next";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import Input from "@/components/ui/Input.vue";
import Textarea from "@/components/ui/Textarea.vue";
import PageHeader from "@/components/PageHeader.vue";
import SectionCard from "@/components/SectionCard.vue";
import { useProfile } from "@/composables/useProfile";
import { useSettings } from "@/composables/useSettings";
import { goLegacy } from "@/lib/navigation";

const { profile, loading, saving, message, error, load, save, setAvatar } = useProfile();
const settingsState = useSettings();
const { quota, quotaLoading, availableQuota } = settingsState;
const avatarInput = ref<HTMLInputElement | null>(null);

function selectAvatar() {
  avatarInput.value?.click();
}

function onAvatarChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => setAvatar(String(reader.result || "")), { once: true });
  reader.readAsDataURL(file);
}

onMounted(async () => {
  await Promise.all([load(), settingsState.load()]);
});
</script>

<template>
  <div class="ejiabao-page-shell">
    <PageHeader title="个人主页" description="让每一次创作，都留下属于你的名字与语气。">
      <Button variant="outline" @click="goLegacy('dashboard')"><ArrowLeft :size="16" />返回工作台</Button>
      <Button :disabled="saving" @click="save"><Save :size="16" />{{ saving ? '保存中…' : '保存资料' }}</Button>
    </PageHeader>

    <div v-if="message || error" class="ejiabao-feedback" :class="{ 'is-error': error }" role="status">{{ error || message }}</div>
    <div v-if="loading" class="ejiabao-loading">正在读取资料…</div>

    <div class="ejiabao-grid two profile-grid">
      <SectionCard class="profile-hero-card">
        <div class="profile-hero-main">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar">
              <img v-if="profile.avatar" :src="profile.avatar" alt="个人头像">
              <span v-else>{{ (profile.name || '创').slice(0, 1) }}</span>
            </div>
            <Button variant="outline" size="sm" @click="selectAvatar"><ImageUp :size="14" />更换头像</Button>
            <input ref="avatarInput" class="sr-only" type="file" accept="image/*" @change="onAvatarChange">
          </div>
          <div>
            <Badge variant="success">个人创作者</Badge>
            <h2 class="profile-name">{{ profile.name }}</h2>
            <p class="ejiabao-card-copy">把灵感交给云端，也把最后的判断留在自己手里。</p>
            <div class="profile-chip-grid"><span>视频创作</span><span>云端生成</span><span>Windows 用户</span></div>
          </div>
        </div>
        <div class="ejiabao-stat-grid">
          <div class="ejiabao-stat"><span class="ejiabao-muted">累计作品</span><strong>24</strong></div>
          <div class="ejiabao-stat"><span class="ejiabao-muted">已发布</span><strong>16</strong></div>
          <div class="ejiabao-stat"><span class="ejiabao-muted">创作时长</span><strong>126 分钟</strong></div>
        </div>
      </SectionCard>

      <SectionCard title="基本信息" description="这些信息只用于展示和创作偏好。">
        <template #header><Badge variant="outline">可编辑</Badge></template>
        <div class="ejiabao-form-grid">
          <div class="ejiabao-field wide"><label for="vue-profile-name">昵称</label><Input id="vue-profile-name" v-model="profile.name" maxlength="24" /></div>
          <div class="ejiabao-field"><label for="vue-profile-email">登录邮箱</label><Input id="vue-profile-email" v-model="profile.email" readonly /></div>
          <div class="ejiabao-field"><label for="vue-profile-phone">绑定手机号</label><Input id="vue-profile-phone" v-model="profile.phone" readonly /></div>
          <div class="ejiabao-field wide"><label for="vue-profile-bio">个人简介</label><Textarea id="vue-profile-bio" v-model="profile.bio" maxlength="120" /></div>
        </div>
      </SectionCard>

      <SectionCard title="创作偏好" description="帮助工作台更快理解你的表达方式。">
        <template #header><SlidersHorizontal :size="18" /></template>
        <div class="ejiabao-setting-row"><div><strong>常用画幅</strong><p>发布到短视频平台时优先使用。</p></div><Badge variant="success">9:16 竖屏</Badge></div>
        <div class="ejiabao-setting-row"><div><strong>常用风格</strong><p>默认生成节奏与画面倾向。</p></div><Badge>高级干净</Badge></div>
        <div class="ejiabao-setting-row"><div><strong>偏好平台</strong><p>用于推荐导出规格和标题长度。</p></div><Badge>抖音 · 小红书</Badge></div>
      </SectionCard>

      <SectionCard title="账户状态" description="设备和云端服务的当前状态。">
        <template #header><Badge variant="success">运行正常</Badge></template>
        <div class="ejiabao-setting-row"><div><strong>设备授权</strong><p>加密优盘已绑定当前 Windows 设备。</p></div><Badge variant="success">有效</Badge></div>
        <div class="ejiabao-setting-row"><div><strong>云端算力</strong><p>本月仍可使用的生成额度。</p></div><strong>{{ availableQuota }} 分钟<span v-if="quotaLoading" class="quota-loading">读取中</span></strong></div>
        <div class="ejiabao-setting-row"><div><strong>最近登录</strong><p>Windows 桌面端 · 刚刚</p></div><ShieldCheck :size="18" /></div>
      </SectionCard>
    </div>
  </div>
</template>

<style scoped>
.profile-grid { align-items: start; }
.profile-hero-card { grid-column: 1 / -1; background: radial-gradient(circle at 90% 0%, color-mix(in srgb, var(--cyan) 16%, transparent), transparent 44%), var(--card); }
.profile-hero-main { display: flex; align-items: center; gap: 22px; }
.profile-avatar-wrap { display: grid; justify-items: center; gap: 10px; }
.profile-avatar { display: grid; place-items: center; width: 92px; height: 92px; overflow: hidden; border: 1px solid var(--accent); border-radius: 24px; color: var(--primary-foreground); background: var(--primary); font-size: 32px; font-weight: 800; }
.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
.profile-name { margin: 12px 0 6px; font-size: 26px; }
.profile-chip-grid { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
.profile-chip-grid span { padding: 5px 9px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted-foreground); background: var(--secondary); font-size: 11px; }
.quota-loading { margin-left: 6px; color: var(--muted-foreground); font-size: 11px; font-weight: 400; }
.ejiabao-feedback { margin: -6px 0 16px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--lime) 35%, var(--border)); border-radius: 7px; color: var(--text); background: color-mix(in srgb, var(--lime) 16%, var(--card)); font-size: 13px; }
.ejiabao-feedback.is-error { border-color: color-mix(in srgb, var(--destructive) 40%, var(--border)); background: color-mix(in srgb, var(--destructive) 10%, var(--card)); }
.ejiabao-loading { margin-bottom: 16px; color: var(--muted-foreground); font-size: 13px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 640px) { .profile-hero-main { align-items: flex-start; flex-direction: column; } }
</style>
