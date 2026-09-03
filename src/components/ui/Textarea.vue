<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>
<template>
  <textarea v-bind="$attrs" class="ejiabao-ui-textarea" :value="modelValue ?? ''" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
</template>
<style scoped>
.ejiabao-ui-textarea { width: 100%; min-height: 112px; padding: 10px 11px; border: 1px solid var(--input); border-radius: 7px; outline: 0; color: var(--foreground); background: var(--secondary); font: inherit; line-height: 1.55; resize: vertical; transition: border-color .18s ease, box-shadow .18s ease; }
.ejiabao-ui-textarea:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 18%, transparent); }
</style>
