let runtimePromise: Promise<EjiabaoRuntime | null> | null = null;

export function currentRuntime() {
  return window.ejiabaoRuntime || null;
}

/** Read the pre-Vue session format without treating it as authenticated by itself. */
export function readLegacySession() {
  try {
    const raw = window.localStorage.getItem("ejiabao-session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    window.localStorage.removeItem("ejiabao-session");
    return null;
  }
}

export function clearLegacySession() {
  window.localStorage.removeItem("ejiabao-session");
}

/**
 * Move a recoverable legacy session into the runtime store once it is ready.
 * Old formal sessions without tokens are deliberately not promoted: they
 * cannot authenticate API requests and must go through the login flow again.
 */
export function hydrateLegacySession(runtime = currentRuntime()) {
  if (!runtime?.session?.read) return null;
  const current = runtime.session.read();
  const legacy = readLegacySession();
  if (!legacy) return current || null;

  const currentVirtual = isVirtualSession(current);
  const legacyVirtual = isVirtualSession(legacy);
  const currentHasToken = Boolean(current?.accessToken || current?.refreshToken);
  const legacyHasToken = Boolean(legacy.accessToken || legacy.refreshToken);
  const currentFormal = Boolean(current && !currentVirtual && currentHasToken && isSessionValid(current));
  const legacyFormal = Boolean(!legacyVirtual && legacyHasToken && isSessionValid(legacy));

  // A stale virtual runtime session must not mask a recoverable formal session
  // persisted by the legacy shell. Prefer the formal token while retaining
  // runtime-only metadata such as device authorization when present.
  if (legacyFormal && !currentFormal) {
    const promoted = { ...current, ...legacy, virtual: false, user: { ...(current?.user || {}), ...(legacy.user || {}), virtual: false } };
    return runtime.session.start ? runtime.session.start(promoted) : promoted;
  }

  if (current) return current;
  // Tokenless formal records cannot authenticate API requests; only virtual
  // sessions and formal sessions with a usable token may be restored.
  if (legacyVirtual || legacyHasToken) return runtime.session.start ? runtime.session.start(legacy) : legacy;
  return null;
}

export function waitForRuntime(timeoutMs = 12000): Promise<EjiabaoRuntime | null> {
  const current = currentRuntime();
  if (current) return Promise.resolve(current);
  if (runtimePromise) return runtimePromise;

  runtimePromise = new Promise<EjiabaoRuntime | null>(resolve => {
    let settled = false;
    const finish = (runtime: EjiabaoRuntime | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("ejiabao:runtime-ready", onReady);
      window.clearTimeout(timer);
      resolve(runtime);
    };
    const onReady = () => finish(currentRuntime());
    const timer = window.setTimeout(() => finish(currentRuntime()), timeoutMs);
    window.addEventListener("ejiabao:runtime-ready", onReady, { once: true });
  }).finally(() => {
    runtimePromise = null;
  });

  return runtimePromise;
}

export function onRuntimeEvent(eventName: string, handler: (payload: any) => void) {
  const runtime = currentRuntime();
  if (!runtime?.eventBus?.on) return () => undefined;
  return runtime.eventBus.on(eventName, handler);
}

export function readSession() {
  return currentRuntime()?.session?.read?.() || null;
}

export function isSessionValid(session = readSession()) {
  if (!session) return false;
  const runtime = currentRuntime();
  return runtime?.session?.isExpired ? !runtime.session.isExpired(session) : true;
}

export function isVirtualSession(session = readSession()) {
  return Boolean(session?.virtual || session?.user?.virtual);
}

/** A valid session that can actually authenticate a backend request. */
export function isApiAuthenticated(session = readSession()) {
  return Boolean(
    session
      && !isVirtualSession(session)
      && (session.accessToken || session.refreshToken)
      && isSessionValid(session)
  );
}

export function legacyShowAuth(message?: string) {
  window.showAuth?.(true);
  if (message) {
    window.dispatchEvent(new CustomEvent("ejiabao:vue-auth-message", { detail: message }));
  }
}
