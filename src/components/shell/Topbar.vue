<script setup lang="ts">
import { ref } from "vue";
import { Activity, Bell, CircleHelp, Home, LogOut, Search, Sparkles } from "lucide-vue-next";

const query = ref("");

function search() {
  const value = query.value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(".project-row, .template-card, .asset-card, .library-card").forEach(item => {
    item.hidden = Boolean(value) && !item.textContent?.toLowerCase().includes(value);
  });
}

function goLanding() { window.goLanding?.(); }
function logout() { window.showAuth?.(true); }
function navigate(view: string) { window.showView?.(view); }
</script>

<template>
  <header class="topbar">
    <label class="search"><Search :size="16" aria-hidden="true" /><input id="globalSearch" v-model="query" type="search" placeholder="搜索项目、模板、素材" @input="search"></label>
    <div class="top-actions">
      <button class="ghost-btn" type="button" @click="goLanding"><Home :size="16" aria-hidden="true" />产品首页</button>
      <button class="ghost-btn" type="button" @click="logout"><LogOut :size="16" aria-hidden="true" />退出登录</button>
      <button class="icon-btn" type="button" aria-label="消息"><Bell :size="16" aria-hidden="true" /></button>
      <button class="icon-btn" type="button" aria-label="帮助与反馈" data-help-toggle><CircleHelp :size="16" aria-hidden="true" /></button>
      <button class="ghost-btn" type="button" @click="navigate('queue')"><Activity :size="16" aria-hidden="true" /><span id="queueCountLabel">队列</span></button>
      <button class="primary-btn" type="button" @click="navigate('create')"><Sparkles :size="16" aria-hidden="true" />新建视频</button>
    </div>
  </header>
</template>
