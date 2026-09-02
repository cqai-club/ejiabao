<script setup lang="ts">
import { computed } from "vue";
const props = withDefaults(defineProps<{ modelValue?: number; max?: number }>(), { modelValue: 0, max: 100 });
const width = computed(() => `${Math.max(0, Math.min(100, (props.modelValue / props.max) * 100))}%`);
</script>
<template><div class="ejiabao-ui-progress" role="progressbar" :aria-valuenow="modelValue" aria-valuemin="0" :aria-valuemax="max"><span :style="{ width }" /></div></template>
<style scoped>
.ejiabao-ui-progress { overflow: hidden; height: 8px; border-radius: 999px; background: var(--surface-3, #e1e1d8); }
.ejiabao-ui-progress span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--lime), var(--cyan)); transition: width .25s ease; }
</style>
