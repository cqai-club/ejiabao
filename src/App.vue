<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { migratedRouteNames } from "@/router";
import { useAuthStore } from "@/stores/auth";
import AppLayout from "@/components/shell/AppLayout.vue";
import AuthPage from "@/components/shell/AuthPage.vue";
import LandingPage from "@/components/shell/LandingPage.vue";

const route = useRoute();
const auth = useAuthStore();
const shellMode = ref<"auth" | "onboarding" | "landing" | "app">("auth");
let bodyObserver: MutationObserver | null = null;

const isMigratedRoute = computed(() => migratedRouteNames.has(String(route.name || "")));
const shouldRenderVuePage = computed(() => isMigratedRoute.value && auth.isAuthenticated);

function syncShellMode() {
  const body = document.body;
  if (body.classList.contains("auth-active")) shellMode.value = "auth";
  else if (body.classList.contains("onboarding-active")) shellMode.value = "onboarding";
  else if (body.classList.contains("landing-active")) shellMode.value = "landing";
  else shellMode.value = "app";
}

function syncLegacyVisibility() {
  const hidden = shouldRenderVuePage.value;
  if (hidden) {
    // A direct deep link can arrive while the legacy shell still has a stale
    // landing/auth class from the previous route. Vue-owned pages must win so
    // the AppLayout is not hidden by legacy global CSS.
    document.body.classList.remove("auth-active", "onboarding-active", "landing-active");
  }
  document.body.classList.toggle("vue-migration-active", hidden);
  ["view-profile", "view-model-config", "view-settings"].forEach(id => {
    document.getElementById(id)?.setAttribute("aria-hidden", String(hidden));
  });
  syncShellMode();
}

function onRuntimeReady() {
  void auth.refresh().then(syncLegacyVisibility);
}

watch(shouldRenderVuePage, syncLegacyVisibility, { immediate: true });
onMounted(async () => {
  bodyObserver = new MutationObserver(syncShellMode);
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("ejiabao:runtime-ready", onRuntimeReady);
  syncShellMode();
  await auth.initialize();
  syncLegacyVisibility();
});
onBeforeUnmount(() => {
  bodyObserver?.disconnect();
  window.removeEventListener("ejiabao:runtime-ready", onRuntimeReady);
  document.body.classList.remove("vue-migration-active");
  ["view-profile", "view-model-config", "view-settings"].forEach(id => {
    document.getElementById(id)?.setAttribute("aria-hidden", "false");
  });
});
</script>

<template>
  <AuthPage v-if="shellMode === 'auth'" />
  <LandingPage v-else-if="shellMode === 'landing'" />
  <AppLayout v-else-if="shellMode === 'app'">
    <RouterView v-if="shouldRenderVuePage" />
  </AppLayout>
</template>
