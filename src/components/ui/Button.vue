<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

const props = withDefaults(defineProps<{
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}>(), {
  variant: "default",
  size: "default",
  type: "button",
  disabled: false
});

const classes = computed(() => cn(
  "ejiabao-ui-button",
  `is-${props.variant}`,
  `size-${props.size}`,
  props.disabled && "is-disabled"
));
</script>

<template>
  <button :class="classes" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped>
.ejiabao-ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--foreground);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: transform .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.ejiabao-ui-button:hover:not(:disabled) { transform: translateY(-1px); }
.ejiabao-ui-button:focus-visible { outline: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 22%, transparent); }
.ejiabao-ui-button:disabled { cursor: not-allowed; opacity: .55; }
.ejiabao-ui-button.is-default { color: var(--primary-foreground); background: var(--primary); }
.ejiabao-ui-button.is-secondary { color: var(--secondary-foreground); background: var(--secondary); border-color: var(--border); }
.ejiabao-ui-button.is-outline { background: var(--card); border-color: var(--border); }
.ejiabao-ui-button.is-outline:hover:not(:disabled) { border-color: var(--accent); }
.ejiabao-ui-button.is-ghost:hover:not(:disabled) { background: var(--secondary); }
.ejiabao-ui-button.is-destructive { color: var(--destructive-foreground); background: var(--destructive); }
.ejiabao-ui-button.size-sm { min-height: 34px; padding: 0 10px; font-size: 12px; }
.ejiabao-ui-button.size-lg { min-height: 44px; padding: 0 18px; }
.ejiabao-ui-button.size-icon { width: 40px; padding: 0; }
</style>
