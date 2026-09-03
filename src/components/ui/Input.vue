<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue?: string | number }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>
<template>
  <input v-bind="$attrs" class="ejiabao-ui-input" :value="modelValue ?? ''" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
</template>
<style scoped>
.ejiabao-ui-input { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid var(--input); border-radius: 7px; outline: 0; color: var(--foreground); background: var(--secondary); font: inherit; transition: border-color .18s ease, box-shadow .18s ease; }
.ejiabao-ui-input:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 18%, transparent); }
</style>
