<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

const props = withDefaults(defineProps<{ variant?: "default" | "success" | "outline" | "warning" }>(), { variant: "default" });
const classes = computed(() => cn("ejiabao-ui-badge", `is-${props.variant}`));
</script>
<template><span :class="classes"><slot /></span></template>
<style scoped>
.ejiabao-ui-badge { display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted-foreground); background: var(--secondary); font-size: 11px; font-weight: 700; white-space: nowrap; }
.ejiabao-ui-badge.is-success { color: #101113; border-color: transparent; background: var(--lime); }
.ejiabao-ui-badge.is-outline { background: transparent; }
.ejiabao-ui-badge.is-warning { color: #101113; border-color: transparent; background: var(--yellow, #ffd83d); }
</style>
