<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue?: string | number }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>
<template>
  <select v-bind="$attrs" class="ejiabao-ui-select" :value="modelValue ?? ''" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"><slot /></select>
</template>
<style scoped>
.ejiabao-ui-select { width: 100%; min-height: 40px; padding: 0 32px 0 11px; border: 1px solid var(--input); border-radius: 7px; outline: 0; color: var(--foreground); background: var(--secondary); font: inherit; cursor: pointer; }
.ejiabao-ui-select:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 18%, transparent); }
</style>
