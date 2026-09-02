/// <reference types="vite/client" />

declare global {
  interface EjiabaoRuntime {
    config?: Record<string, any>;
    session?: {
      read: () => any;
      isExpired?: (session?: any) => boolean;
      start?: (session: any) => any;
      save?: (session: any) => any;
      touch?: () => any;
      clear?: (reason?: string) => void;
    };
    http?: {
      get: (path: string, options?: Record<string, any>) => Promise<any>;
      post: (path: string, body?: any, options?: Record<string, any>) => Promise<any>;
      put: (path: string, body?: any, options?: Record<string, any>) => Promise<any>;
      patch: (path: string, body?: any, options?: Record<string, any>) => Promise<any>;
      delete: (path: string, options?: Record<string, any>) => Promise<any>;
    };
    storage?: {
      get: (name: string, fallback?: any) => any;
      set: (name: string, value: any) => any;
      remove: (name: string) => void;
    };
    eventBus?: {
      on: (event: string, handler: (payload: any) => void) => () => void;
      off?: (event: string, handler: (payload: any) => void) => void;
    };
    modules?: Record<string, any>;
  }

  interface Window {
    ejiabaoRuntime?: EjiabaoRuntime;
    showAuth?: (clearSession?: boolean) => void;
    showOnboarding?: () => void;
    goLanding?: () => void;
    enterApp?: (typeKey?: string) => void;
    toggleTheme?: () => void;
    setType?: (typeKey: string) => void;
    setAuthMode?: (mode: "login" | "register") => void;
    fillDefaultAuthAccount?: (force?: boolean) => void;
    completeVirtualFrontendLogin?: (method?: "default" | "wechat", message?: string) => void;
    completeBackendLogin?: (options: { account: string; password: string; phoneMode: boolean; register: boolean }) => Promise<void>;
    setAuthMessage?: (message: string, success?: boolean) => void;
    showView?: (viewName: string, options?: Record<string, any>) => boolean;
    syncThemeControls?: () => void;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}

export {};
