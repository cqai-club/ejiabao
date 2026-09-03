<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Activity, Bell, Clapperboard, CloudCog, FolderOpen, LayoutDashboard, LibraryBig, Palette, PanelsTopLeft, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, UserRound } from "lucide-vue-next";

const collapsed = ref(document.body.classList.contains("sidebar-collapsed"));
const activeView = ref("dashboard");
const profileName = ref("个人创作者");
const typeKey = ref("commerce");
const navItems = [
  ["dashboard", "工作台", LayoutDashboard], ["create", "新建创作", Clapperboard], ["templates", "模板中心", PanelsTopLeft],
  ["assets", "素材库", FolderOpen], ["brand", "品牌设定", Palette], ["queue", "云端队列", CloudCog],
  ["review", "审片导出", Activity], ["library", "作品库", LibraryBig], ["settings", "设置", Settings]
] as const;
const types = [
  ["commerce", "商品推广", "图转视频", "var(--lime)"], ["talking", "知识口播", "数字人", "var(--cyan)"],
  ["story", "剧情短片", "文生视频", "var(--purple)"], ["vlog", "Vlog", "实拍精剪", "var(--yellow)"],
  ["mix", "文生播客", "声音可视化", "var(--green)"], ["event", "活动预告", "快宣物料", "var(--orange)"]
] as const;

function syncRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const route = hash.split("?")[0];
  activeView.value = route === "settings/models" ? "settings" : route.split("/")[0] || "dashboard";
  const match = new URLSearchParams(hash.split("?")[1] || "").get("type");
  if (match) typeKey.value = match;
  const storedName = localStorage.getItem("ejiabao-profile-name");
  if (storedName) profileName.value = storedName;
}

function navigate(view: string, nextType?: string) {
  if (nextType) {
    typeKey.value = nextType;
    window.setType?.(nextType);
  }
  window.showView?.(view);
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  document.body.classList.toggle("sidebar-collapsed", collapsed.value);
  localStorage.setItem("ejiabao-sidebar-collapsed", String(collapsed.value));
}

function goLanding() {
  window.goLanding?.();
}

function toggleTheme() {
  window.toggleTheme?.();
}

onMounted(() => {
  syncRoute();
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("storage", syncRoute);
});
onUnmounted(() => {
  window.removeEventListener("hashchange", syncRoute);
  window.removeEventListener("storage", syncRoute);
});

const toggleIcon = computed(() => collapsed.value ? PanelLeftOpen : PanelLeftClose);
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="brand" aria-label="品牌标识" role="button" tabindex="0" @click="goLanding"><img src="/assets/ejiabao-logo-new.jpg" alt="品牌标识"></div>
      <button class="sidebar-toggle" id="sidebarToggle" type="button" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" :aria-pressed="collapsed" @click="toggleCollapsed"><component :is="toggleIcon" :size="16" aria-hidden="true" /></button>
    </div>

    <nav class="nav" aria-label="主导航">
      <button v-for="[view, label, Icon] in navItems" :key="view" :class="{ 'is-active': activeView === view }" type="button" @click="navigate(view)"><component :is="Icon" :size="16" aria-hidden="true" />{{ label }}</button>
    </nav>

    <div class="side-group" aria-label="视频类型">
      <div class="side-title"><span class="side-title-mark"><Sparkles :size="16" aria-hidden="true" /></span><span>新建创作类型</span></div>
      <button v-for="[key, title, subtitle, color] in types" :key="key" class="type-link" :class="{ 'is-active': typeKey === key }" :style="{ '--type-color': color }" type="button" @click="navigate('create', key)"><span>{{ title }}</span><span>{{ subtitle }}</span></button>
    </div>

    <div class="account-box"><div class="account-row">
      <button class="account-profile-trigger" type="button" aria-label="打开个人主页" @click="navigate('profile')"><div class="avatar" id="sidebarAvatar">创</div><div class="account-copy" style="min-width:0"><strong id="sidebarProfileName" style="display:block">{{ profileName }}</strong><span class="muted" style="font-size:12px">云端算力：68 分钟</span></div></button>
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="切换深浅主题" @click="toggleTheme"><span></span></button>
    </div></div>
  </aside>
</template>
