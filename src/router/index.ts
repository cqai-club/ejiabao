import { createRouter, createWebHashHistory } from "vue-router";
import ProfilePage from "@/views/ProfilePage.vue";
import ModelConfigPage from "@/views/ModelConfigPage.vue";
import SettingsPage from "@/views/SettingsPage.vue";
import { useAuthStore } from "@/stores/auth";

export const migratedRouteNames = new Set(["profile", "model-config", "settings"]);

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/profile", name: "profile", component: ProfilePage },
    { path: "/settings/models", name: "model-config", component: ModelConfigPage },
    { path: "/settings", name: "settings", component: SettingsPage },
    { path: "/:pathMatch(.*)*", name: "legacy", component: { template: "<span />" } }
  ],
  scrollBehavior: () => ({ top: 0 })
});

// A direct deep link to a migrated page must not leave the legacy shell with
// an empty workspace while the Vue island waits for an authenticated session.
// The legacy auth shell is already the canonical login surface, so return to
// the root route and reveal that shell instead of duplicating login screens.
router.beforeEach(async to => {
  if (!migratedRouteNames.has(String(to.name || ""))) return true;
  const auth = useAuthStore();
  await auth.initialize();
  if (auth.isAuthenticated) return true;
  window.showAuth?.(false);
  return { path: "/", replace: true };
});

// The legacy shell still changes `location.hash` directly. Vue Router's hash
// history intentionally listens to popstate, so mirror direct hash changes
// into the router without changing how Vue-owned navigation works.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const target = window.location.hash.slice(1) || "/";
    if (router.currentRoute.value.fullPath !== target) void router.push(target);
  });
}
