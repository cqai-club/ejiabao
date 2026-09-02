<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { BrainCircuit, FolderCog, HardDrive, KeyRound, Plus, Save, ScrollText, ShieldCheck, Trash2 } from "lucide-vue-next";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import Select from "@/components/ui/Select.vue";
import Switch from "@/components/ui/Switch.vue";
import Progress from "@/components/ui/Progress.vue";
import PageHeader from "@/components/PageHeader.vue";
import SectionCard from "@/components/SectionCard.vue";
import { useSettings } from "@/composables/useSettings";
import { useThemeStore } from "@/stores/theme";
import { openModelConfig } from "@/lib/navigation";
import { currentRuntime, isApiAuthenticated } from "@/lib/runtime";

const { settings, quota, quotaLoading, availableQuota, loading, saving, message, error, load, save, clearCache, chooseExportDirectory } = useSettings();
const theme = useThemeStore();

const quotaProgress = computed(() => quota.remote
  ? (quota.balance > 0 ? Math.round((availableQuota.value / quota.balance) * 100) : 0)
  : 54);

watch(() => settings.theme, value => {
  if (value === "light" || value === "dark") theme.apply(value);
});

onMounted(load);

async function manageCache() {
  message.value = "";
  error.value = "";
  try {
    const count = await clearCache();
    message.value = count ? `已清理 ${count} 项本地预览缓存。` : "当前没有可清理的本地预览缓存。";
  } catch (cause: any) {
    error.value = cause?.message || "本地缓存清理失败。";
  }
}

async function changeExportDirectory() {
  message.value = "";
  error.value = "";
  try {
    const selected = await chooseExportDirectory();
    if (!selected) return;
    await save();
    if (!error.value) message.value = `默认导出目录已切换为“${selected}”。`;
  } catch (cause: any) {
    error.value = cause?.message || "默认导出目录切换失败。";
  }
}

async function exportLogs() {
  message.value = "";
  error.value = "";
  try {
    const runtime = currentRuntime();
    if (!runtime || !isApiAuthenticated(runtime.session?.read?.())) throw new Error("请登录正式账号后再查看运行日志。");
    if (!runtime.http?.get) throw new Error("网络服务尚未就绪，请稍后重试。");
    const response = await runtime.http.get("/v1/system/logs/recent", { timeoutMs: 30000 });
    const blob = new Blob([response.data?.lines || "当前没有日志。"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ejiabao-backend-log-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    message.value = "运行日志已导出。";
  } catch (cause: any) {
    error.value = cause?.message || "运行日志导出失败。";
  }
}

function openRecharge() {
  openModelConfig("platform");
}
</script>

<template>
  <div class="ejiabao-page-shell">
    <PageHeader title="设置" description="桌面端账户、生成偏好、通知和本地缓存。">
      <Button :disabled="saving" @click="save"><Save :size="16" />{{ saving ? '保存中…' : '保存设置' }}</Button>
    </PageHeader>

    <div v-if="message || error" class="ejiabao-feedback" :class="{ 'is-error': error }" role="status">{{ error || message }}</div>
    <div v-if="loading" class="ejiabao-loading">正在读取设置…</div>

    <div class="ejiabao-grid two settings-grid">
      <SectionCard class="quota-card" title="创作额度" description="用于云端生成、数字人口播与高质量导出。">
        <template #header><Badge variant="success">个人版</Badge></template>
        <div class="ejiabao-balance"><strong>{{ availableQuota }}</strong><span>分钟可用</span><small v-if="quotaLoading">正在读取云端额度…</small><small v-else-if="quota.remote">账户余额 {{ quota.balance }} 分钟 · 处理中预留 {{ quota.reserved }} 分钟</small><small v-else>每月 1 日刷新 · 约可生成 18 条短视频</small></div>
        <Progress :model-value="quotaProgress" />
        <div class="ejiabao-quota-meta"><template v-if="quota.remote"><span>可用比例：{{ quotaProgress }}%</span><span>处理中：{{ quota.reserved }} 分钟</span></template><template v-else><span>已使用：82 分钟</span><span>总额度：150 分钟</span></template></div>
        <div class="ejiabao-actions">
          <Button variant="outline" @click="openModelConfig()"><BrainCircuit :size="16" />模型配置</Button>
          <Button variant="secondary" @click="openRecharge"><Plus :size="16" />充值额度</Button>
        </div>
      </SectionCard>

      <SectionCard title="生成偏好">
        <template #header><Badge variant="outline">自动处理</Badge></template>
        <div class="ejiabao-setting-row"><div><strong>生成式视频</strong><p>剧情短片、活动动效、文生视频。</p></div><Select v-model="settings.generativeVideo" class="setting-select"><option>自动匹配</option><option>镜头优先</option><option>节奏优先</option></Select></div>
        <div class="ejiabao-setting-row"><div><strong>数字人口播</strong><p>照片驱动、唇形同步、声音合成。</p></div><Select v-model="settings.digitalHuman" class="setting-select"><option>自然优先</option><option>速度优先</option></Select></div>
        <div class="ejiabao-setting-row"><div><strong>智能剪辑</strong><p>字幕、降噪、转场、BGM。</p></div><Select v-model="settings.smartCut" class="setting-select"><option>平衡</option><option>严格去重</option></Select></div>
      </SectionCard>

      <SectionCard title="桌面端">
        <template #header><Badge variant="outline">Windows</Badge></template>
        <div class="ejiabao-setting-row"><div><strong>本地缓存</strong><p>素材代理文件名和预览缓存。</p></div><Button variant="outline" size="sm" @click="manageCache"><FolderCog :size="14" />管理</Button></div>
        <div class="ejiabao-setting-row"><div><strong>完成通知</strong><p>云端任务完成后系统通知。</p></div><Switch v-model="settings.notifications" /></div>
        <div class="ejiabao-setting-row"><div><strong>默认导出目录</strong><p>{{ settings.defaultExportDirectory }}</p></div><Button variant="outline" size="sm" @click="changeExportDirectory"><HardDrive :size="14" />更改</Button></div>
      </SectionCard>

      <SectionCard title="安全与隐私" description="设备授权、导出权限与本地数据管理。">
        <template #header><Badge variant="success">已保护</Badge></template>
        <div class="ejiabao-setting-row"><div><strong>设备授权</strong><p>加密优盘已绑定当前 Windows 设备。</p></div><Badge variant="success"><ShieldCheck :size="13" />有效</Badge></div>
        <div class="ejiabao-setting-row"><div><strong>敏感数据</strong><p>模型密钥只通过加密连接提交到服务端。</p></div><KeyRound :size="18" /></div>
        <div class="ejiabao-setting-row"><div><strong>导出权限</strong><p>控制作品是否允许保存到本机。</p></div><Select v-model="settings.exportPermission" class="setting-select"><option>允许导出</option><option>仅预览</option></Select></div>
        <div class="ejiabao-setting-row"><div><strong>清理本地缓存</strong><p>不会删除云端项目中的素材。</p></div><Button variant="outline" size="sm" @click="manageCache"><Trash2 :size="14" />清理</Button></div>
        <div class="ejiabao-setting-row"><div><strong>查看运行日志</strong><p>排查生成失败或设备问题。</p></div><Button variant="outline" size="sm" @click="exportLogs"><ScrollText :size="14" />导出</Button></div>
        <div class="ejiabao-setting-row"><div><strong>当前主题</strong><p>沿用工作台的品牌主题。</p></div><Button variant="ghost" size="sm" @click="theme.toggle">{{ theme.isDark ? '深色' : '浅色' }}</Button></div>
      </SectionCard>
    </div>
  </div>
</template>

<style scoped>
.settings-grid { align-items: start; }
.quota-card { grid-column: 1 / -1; background: radial-gradient(circle at 90% 0%, color-mix(in srgb, var(--lime) 20%, transparent), transparent 42%), var(--card); }
.ejiabao-balance small { margin-left: auto; color: var(--muted-foreground); font-size: 12px; }
.setting-select { width: 150px; flex: 0 0 150px; }
.ejiabao-feedback { margin: -6px 0 16px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--lime) 35%, var(--border)); border-radius: 7px; color: var(--text); background: color-mix(in srgb, var(--lime) 16%, var(--card)); font-size: 13px; }
.ejiabao-feedback.is-error { border-color: color-mix(in srgb, var(--destructive) 40%, var(--border)); background: color-mix(in srgb, var(--destructive) 10%, var(--card)); }
.ejiabao-loading { margin-bottom: 16px; color: var(--muted-foreground); font-size: 13px; }
@media (max-width: 640px) { .ejiabao-balance { align-items: flex-start; flex-wrap: wrap; } .ejiabao-balance small { flex-basis: 100%; margin-left: 0; } .setting-select { width: 100%; flex-basis: auto; } }
</style>
