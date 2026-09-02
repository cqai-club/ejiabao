import { computed, ref } from "vue";
import { defineStore } from "pinia";

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<"light" | "dark">((document.body.dataset.theme === "light" ? "light" : "dark"));
  const isDark = computed(() => theme.value === "dark");

  function apply(next: "light" | "dark") {
    theme.value = next;
    document.body.dataset.theme = next;
    localStorage.setItem("ejiabao-theme", next);
    window.syncThemeControls?.();
  }

  function toggle() {
    apply(isDark.value ? "light" : "dark");
  }

  return { theme, isDark, apply, toggle };
});
