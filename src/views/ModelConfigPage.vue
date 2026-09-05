<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, CheckCircle2, KeyRound, Save, WalletCards, Zap } from "lucide-vue-next";
import Button from "@/components/ui/Button.vue";
import Badge from "@/components/ui/Badge.vue";
import Input from "@/components/ui/Input.vue";
import Select from "@/components/ui/Select.vue";
import Progress from "@/components/ui/Progress.vue";
import PageHeader from "@/components/PageHeader.vue";
import SectionCard from "@/components/SectionCard.vue";
import { useModelConfig, type Provider } from "@/composables/useModelConfig";
import { useSettings } from "@/composables/useSettings";
import { goLegacy } from "@/lib/navigation";
import { currentRuntime, isApiAuthenticated } from "@/lib/runtime";

const { mode, available, loading, savingProvider, testingProvider, message, error, providers, load, save, test, usePlatform } = useModelConfig();
const settingsState = useSettings();
const { quota, quotaLoading, availableQuota } = settingsState;
const route = useRoute();
const quotaDetailsVisible = ref(false);
const selectedPlan = ref("");
const rechargeLoading = ref(false);
const billingLoading = ref(false);
const billingEnabled = ref(false);
const billingPackages = ref<BillingPackage[]>([]);
const billingStatus = ref<"loading" | "unauthenticated" | "disabled" | "empty" | "ready" | "error">("loading");
const billingStatusMessage = ref("");
const providerList = computed(() => [providers.codex, providers["deepseek-harness"], providers.inferflow]);
const selectedPackage = computed(() => billingPackages.value.find(item => item.key === selectedPlan.value) || null);
const quotaProgress = computed(() => quota.remote
  ? (quota.balance > 0 ? Math.round((availableQuota.value / quota.balance) * 100) : 0)
  : 54);

function providerDescription(provider: Provider) {
  if (provider === "codex") return "负责中控对话中的规划、执行与校验。";
  if (provider === "deepseek-harness") return "负责脚本拆解、分镜编排与工作流调度。";
  return "负责知识口播的数字人生成，由 digital-human-workflow.ts 调用。";
}

function providerUsage(provider: Provider) {
  if (provider === "codex") return "中控对话 · 创作规划";
  if (provider === "deepseek-harness") return "中控调度 · 六类工作流";
  return "知识口播 · 数字人口播生成";
}

function modelLabel(provider: Provider) {
  return provider === "inferflow" ? "Skill 名称" : "模型名称";
}

function modelPlaceholder(provider: Provider) {
  if (provider === "codex") return "例如：gpt-5.2";
  if (provider === "deepseek-harness") return "例如：deepseek-chat";
  return "例如：digital_human_standard";
}

type BillingPackage = {
  key: string;
  name: string;
  credits: number;
  amountFen: number;
  amountYuan?: string;
};

function selectPlan(planKey: string) {
  selectedPlan.value = planKey;
}

function formatPackageAmount(item: BillingPackage) {
  const amount = item.amountFen / 100;
  return Number.isInteger(amount) ? `￥${amount}` : `￥${amount.toFixed(2)}`;
}

function normalizeBillingPackage(value: any): BillingPackage | null {
  const key = String(value?.key || "").trim();
  const name = String(value?.name || "").trim();
  const credits = Number(value?.credits);
  const amountFen = Number(value?.amountFen);
  if (!key || !name || !Number.isSafeInteger(credits) || credits <= 0 || !Number.isSafeInteger(amountFen) || amountFen <= 0) return null;
  return { key, name, credits, amountFen, amountYuan: value?.amountYuan ? String(value.amountYuan) : undefined };
}

async function loadBillingPackages() {
  billingLoading.value = true;
  billingStatus.value = "loading";
  billingStatusMessage.value = "";
  billingEnabled.value = false;
  billingPackages.value = [];
  selectedPlan.value = "";
  try {
    const runtime = currentRuntime();
    if (!runtime || !isApiAuthenticated(runtime.session?.read?.())) {
      billingStatus.value = "unauthenticated";
      billingStatusMessage.value = "登录正式账号后可查看充值套餐。";
      return;
    }
    if (!runtime.http?.get) throw new Error("网络服务尚未就绪，请稍后重试。");
    const response = await runtime.http.get("/v1/billing/packages", { timeoutMs: 30000 });
    billingEnabled.value = response?.data?.enabled === true;
    billingPackages.value = Array.isArray(response?.data?.packages)
      ? response.data.packages.map(normalizeBillingPackage).filter(Boolean) as BillingPackage[]
      : [];
    if (!billingEnabled.value) {
      billingStatus.value = "disabled";
      billingStatusMessage.value = "微信支付尚未启用，当前不能充值。";
    } else if (!billingPackages.value.length) {
      billingStatus.value = "empty";
      billingStatusMessage.value = "当前暂无可用充值套餐。";
    } else {
      billingStatus.value = "ready";
    }
  } catch (cause: any) {
    billingStatus.value = "error";
    billingStatusMessage.value = cause?.message || "充值套餐读取失败，请稍后重试。";
  } finally {
    billingLoading.value = false;
  }
}

async function createRechargeOrder() {
  const plan = selectedPackage.value;
  if (!plan) return;
  rechargeLoading.value = true;
  message.value = "";
  error.value = "";
  try {
    const runtime = currentRuntime();
    if (!runtime || !isApiAuthenticated(runtime.session?.read?.())) throw new Error("请登录正式账号后再充值。");
    if (!billingEnabled.value || billingStatus.value !== "ready") throw new Error(billingStatusMessage.value || "当前暂无可用充值套餐。");
    if (!runtime.http?.post) throw new Error("网络服务尚未就绪，请稍后重试。");
    const orderResponse = await runtime.http.post("/v1/billing/orders", { packageKey: plan.key }, { timeoutMs: 30000 });
    const codeUrl = orderResponse.data?.order?.codeUrl;
    message.value = codeUrl
      ? "充值订单已创建。请在桌面端使用微信扫码完成支付。"
      : "充值订单已创建，请稍后查询订单状态。";
  } catch (cause: any) {
    error.value = cause?.message || "充值订单创建失败。";
  } finally {
    rechargeLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([load(), settingsState.load(), loadBillingPackages()]);
  if (route.query.mode === "custom" || route.query.mode === "platform") mode.value = route.query.mode;
});
</script>

<template>
  <div class="ejiabao-page-shell">
    <PageHeader title="模型配置" description="选择创作中控和六类工作流使用的推理方式：接入自己的 API，或直接使用平台积分。">
      <Button variant="outline" @click="goLegacy('settings')"><ArrowLeft :size="16" />返回设置</Button>
      <Badge :variant="available ? 'success' : 'warning'">{{ available ? '安全托管' : '后端待连接' }}</Badge>
    </PageHeader>

    <div v-if="message || error" class="ejiabao-feedback" :class="{ 'is-error': error }" role="status">{{ error || message }}</div>
    <div v-if="loading" class="ejiabao-loading">正在读取模型配置…</div>

    <div class="ejiabao-access-grid">
      <button class="ejiabao-access-card ejiabao-card-button" :class="{ 'is-active': mode === 'custom' }" type="button" @click="mode = 'custom'">
        <div class="access-top"><span class="access-icon"><KeyRound :size="17" /></span><Badge variant="outline">自定义调用</Badge></div>
        <h2>使用自己的 API</h2>
        <p class="ejiabao-card-copy">为 Codex、DeepSeek Harness 与 InferFlow 分别设置接口地址、模型或 Skill 和 API Key；密钥只会加密保存在云端。</p>
      </button>
      <button class="ejiabao-access-card ejiabao-card-button" :class="{ 'is-active': mode === 'platform' }" type="button" @click="mode = 'platform'">
        <div class="access-top"><span class="access-icon"><WalletCards :size="17" /></span><Badge variant="success">省心调用</Badge></div>
        <h2>使用平台积分</h2>
        <p class="ejiabao-card-copy">无需准备密钥。平台会为中控与已接入工作流自动安排可用算力，并按任务结算积分。</p>
      </button>
    </div>

    <SectionCard v-if="mode === 'custom'" title="自定义 API" description="保存后可单独测试连接；留空 API Key 表示保留已保存的密钥。">
      <template #header><Badge variant="outline">按账户隔离</Badge></template>
      <div class="ejiabao-provider-grid">
        <SectionCard v-for="provider in providerList" :key="provider.provider" class="provider-card">
          <div class="ejiabao-provider-head">
            <div><h2>{{ provider.label }}</h2><p class="ejiabao-card-copy">{{ providerDescription(provider.provider as Provider) }}</p></div>
            <Badge :variant="provider.apiKeyConfigured ? 'success' : 'outline'">{{ provider.apiKeyConfigured ? '自定义 API 已保存' : '等待配置' }}</Badge>
          </div>
          <div class="ejiabao-form-grid provider-fields">
            <div class="ejiabao-field wide"><label :for="`model-${provider.provider}-base`">接口地址</label><Input :id="`model-${provider.provider}-base`" v-model="provider.baseUrl" autocomplete="off" placeholder="https://…/v1" /></div>
            <div class="ejiabao-field" :class="{ wide: provider.provider !== 'codex' }"><label :for="`model-${provider.provider}-name`">{{ modelLabel(provider.provider as Provider) }}</label><Input :id="`model-${provider.provider}-name`" v-model="provider.model" autocomplete="off" :placeholder="modelPlaceholder(provider.provider as Provider)" /></div>
            <div v-if="provider.provider === 'codex'" class="ejiabao-field"><label :for="`model-${provider.provider}-reasoning`">推理强度</label><Select :id="`model-${provider.provider}-reasoning`" v-model="provider.reasoningEffort"><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option></Select></div>
            <div class="ejiabao-field wide"><label :for="`model-${provider.provider}-key`">API Key</label><Input :id="`model-${provider.provider}-key`" v-model="provider.apiKey" type="password" autocomplete="new-password" placeholder="首次配置时填写；后续留空即可保留" /></div>
          </div>
          <p class="key-note">{{ provider.apiKeyConfigured ? `密钥状态：${provider.apiKeyMasked || '已加密保存'}。留空输入框即可继续保留。` : '该密钥不会写入本机浏览器或优盘，仅通过加密连接提交至服务端。' }}</p>
          <div class="ejiabao-actions"><span class="ejiabao-muted">用于：{{ providerUsage(provider.provider as Provider) }}</span><div><Button variant="outline" size="sm" :disabled="testingProvider === provider.provider" @click="test(provider.provider as Provider)"><Zap :size="14" />{{ testingProvider === provider.provider ? '测试中…' : '测试连接' }}</Button><Button size="sm" :disabled="savingProvider === provider.provider" @click="save(provider.provider as Provider)"><Save :size="14" />{{ savingProvider === provider.provider ? '保存中…' : '保存' }}</Button></div></div>
        </SectionCard>
      </div>
      <div class="scope-grid">
        <div><strong>中控创作台</strong><span>Codex 和 DeepSeek Harness 根据你的选择切换调用。</span></div>
        <div><strong>六类创作</strong><span>商品推广、剧情短片、Vlog、文生播客与活动预告使用 DeepSeek；知识口播使用 InferFlow。</span></div>
        <div><strong>已接入工作流</strong><span>知识口播会优先使用当前账户的 InferFlow 配置；未配置时回退平台配置。</span></div>
      </div>
    </SectionCard>

    <SectionCard v-else title="平台积分调用" description="无需管理 API Key。平台负责安全调用、并发排队与任务积分结算。">
      <template #header><Badge variant="success">平台托管</Badge></template>
      <div class="ejiabao-balance"><strong>{{ availableQuota }}</strong><span>分钟可用 · 用于中控规划和云端生成任务。</span><small v-if="quotaLoading">正在读取云端额度…</small><small v-else-if="quota.remote">账户余额 {{ quota.balance }} 分钟 · 处理中预留 {{ quota.reserved }} 分钟</small></div>
      <Progress :model-value="quotaProgress" />
      <div class="ejiabao-quota-meta"><template v-if="quota.remote"><span>可用比例：{{ quotaProgress }}%</span><span>处理中：{{ quota.reserved }} 分钟</span></template><template v-else><span>已使用：82 分钟</span><span>总额度：150 分钟</span></template></div>
      <div class="ejiabao-actions"><Button variant="outline" size="sm" @click="quotaDetailsVisible = !quotaDetailsVisible">{{ quotaDetailsVisible ? '收起明细' : '查看明细' }}</Button><Button variant="secondary" size="sm" :disabled="savingProvider === 'platform'" @click="usePlatform">切换全部模型到平台积分</Button></div>
      <div v-if="quotaDetailsVisible" class="quota-detail-panel"><div><span>8 月 22 日 · 商品推广</span><strong>-6 分钟</strong></div><div><span>8 月 21 日 · 知识口播</span><strong>-8 分钟</strong></div><div><span>8 月 20 日 · 充值创作包</span><strong>+120 分钟</strong></div></div>
      <div v-if="billingStatus !== 'ready'" class="recharge-status" role="status">
        <span v-if="billingStatus === 'loading'">正在读取充值套餐…</span>
        <span v-else>{{ billingStatusMessage }}</span>
      </div>
      <template v-else>
        <div class="ejiabao-recharge-grid">
          <button v-for="plan in billingPackages" :key="plan.key" type="button" :class="{ 'is-selected': selectedPlan === plan.key }" @click="selectPlan(plan.key)"><strong>{{ formatPackageAmount(plan) }}</strong><span>{{ plan.credits }} 分钟 · {{ plan.name }}</span></button>
        </div>
        <div class="recharge-note"><span>{{ selectedPackage ? `已选择：${selectedPackage.name} · ${selectedPackage.credits} 分钟` : '选择一个创作包后继续充值。' }}</span><Button :disabled="!selectedPackage || rechargeLoading" size="sm" @click="createRechargeOrder"><CheckCircle2 :size="14" />{{ rechargeLoading ? '创建中…' : '生成充值二维码' }}</Button></div>
      </template>
      <p class="key-note"><KeyRound :size="14" />切换后，当前账户会停止使用自定义 Key；平台不会展示或上传此前保存的任何密钥。</p>
    </SectionCard>
  </div>
</template>

<style scoped>
.ejiabao-card-button { width: 100%; padding: 18px; border: 1px solid var(--border); border-radius: 8px; color: var(--foreground); background: var(--card); font: inherit; }
.ejiabao-card-button h2 { margin: 12px 0 6px; font-size: 18px; text-align: left; }
.ejiabao-card-button p { margin: 0; text-align: left; }
.ejiabao-card-button.is-active { border-color: var(--accent); box-shadow: 0 12px 30px color-mix(in srgb, var(--accent) 12%, transparent); }
.access-top { display: flex; align-items: center; justify-content: space-between; }
.access-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 7px; color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
.provider-card { background: color-mix(in srgb, var(--card) 92%, var(--accent) 8%); }
.provider-card :deep(.ejiabao-section-card-content) { padding: 18px; }
.provider-fields { margin-top: 16px; }
.key-note { display: flex; align-items: center; gap: 6px; margin: 14px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.55; }
.scope-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.scope-grid > div { display: grid; gap: 5px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--secondary); }
.scope-grid span { color: var(--muted-foreground); font-size: 12px; line-height: 1.55; }
.quota-detail-panel { display: grid; gap: 8px; margin-top: 18px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--secondary); }
.quota-detail-panel > div { display: flex; justify-content: space-between; gap: 12px; color: var(--muted-foreground); font-size: 12px; }
.quota-detail-panel strong { color: var(--foreground); }
.recharge-status { margin-top: 18px; padding: 12px; border: 1px dashed var(--border); border-radius: 7px; color: var(--muted-foreground); font-size: 12px; }
.recharge-note { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; color: var(--muted-foreground); font-size: 12px; }
.ejiabao-feedback { margin: -6px 0 16px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--lime) 35%, var(--border)); border-radius: 7px; color: var(--text); background: color-mix(in srgb, var(--lime) 16%, var(--card)); font-size: 13px; }
.ejiabao-feedback.is-error { border-color: color-mix(in srgb, var(--destructive) 40%, var(--border)); background: color-mix(in srgb, var(--destructive) 10%, var(--card)); }
.ejiabao-loading { margin-bottom: 16px; color: var(--muted-foreground); font-size: 13px; }
@media (max-width: 900px) { .scope-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .recharge-note { align-items: flex-start; flex-direction: column; } }
</style>
