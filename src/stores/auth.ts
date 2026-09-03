import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  clearLegacySession,
  currentRuntime,
  hydrateLegacySession,
  isApiAuthenticated as hasApiSession,
  isSessionValid,
  isVirtualSession,
  readLegacySession,
  waitForRuntime
} from "@/lib/runtime";

export const useAuthStore = defineStore("auth", () => {
  const session = ref<any>(null);
  const initialized = ref(false);
  let runtimeRef: EjiabaoRuntime | null = null;
  let initializePromise: Promise<any> | null = null;
  const unsubscribers = new Set<() => void>();

  // A legacy session without a token is not a logged-in backend session. A
  // virtual session remains useful for local-only preview pages.
  const isAuthenticated = computed(() => Boolean(
    session.value
      && isSessionValid(session.value)
      && (isVirtualSession(session.value) || session.value.accessToken || session.value.refreshToken)
  ));
  const isApiAuthenticated = computed(() => hasApiSession(session.value));
  const user = computed(() => session.value?.user || null);

  async function initialize() {
    const current = currentRuntime();
    if (initialized.value && runtimeRef === current) return session.value;
    if (initializePromise) return initializePromise;

    initializePromise = (async () => {
      const runtime = await waitForRuntime();
      if (!runtime) {
        // Keep virtual preview usable while the runtime is still loading, but
        // never promote a tokenless formal session to authenticated state.
        session.value = readLegacySession();
        runtimeRef = null;
        initialized.value = false;
        return session.value;
      }

      if (runtimeRef !== runtime) {
        clearSubscriptions();
        runtimeRef = runtime;
        subscribe(runtime);
      }

      session.value = hydrateLegacySession(runtime) || runtime.session?.read?.() || readLegacySession();
      initialized.value = true;
      return session.value;
    })().finally(() => {
      initializePromise = null;
    });

    return initializePromise;
  }

  async function refresh() {
    await initialize();
    const runtime = currentRuntime();
    if (runtime) {
      const next = hydrateLegacySession(runtime) || runtime.session?.read?.() || null;
      if (next && runtime.session?.isExpired?.(next)) {
        runtime.session.clear?.("expired");
        clearLegacySession();
        session.value = null;
      } else {
        session.value = next || readLegacySession();
      }
    } else {
      session.value = readLegacySession();
    }
    return session.value;
  }

  async function logout() {
    await initialize();
    const runtime = currentRuntime();
    const auth = runtime?.modules?.auth;
    if (auth?.logout) auth.logout();
    else runtime?.session?.clear?.("logout");
    clearLegacySession();
    session.value = null;
    window.showAuth?.(true);
  }

  function subscribe(runtime: EjiabaoRuntime) {
    const eventBus = runtime.eventBus;
    if (!eventBus?.on) return;
    addSubscription(eventBus.on("session:changed", next => {
      session.value = next;
    }));
    addSubscription(eventBus.on("session:cleared", () => {
      clearLegacySession();
      session.value = null;
    }));
    addSubscription(eventBus.on("auth:expired", () => {
      clearLegacySession();
      session.value = null;
    }));
  }

  function addSubscription(unsubscribe: (() => void) | undefined) {
    if (typeof unsubscribe === "function") unsubscribers.add(unsubscribe);
  }

  function clearSubscriptions() {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.clear();
  }

  return { session, initialized, isAuthenticated, isApiAuthenticated, user, initialize, refresh, logout };
});
