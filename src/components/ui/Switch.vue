<script setup lang="ts">
import { computed } from "vue";
const props = withDefaults(defineProps<{ modelValue?: boolean; disabled?: boolean }>(), { modelValue: false, disabled: false });
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const pressed = computed(() => Boolean(props.modelValue));
</script>
<template>
  <button class="ejiabao-ui-switch" :class="{ 'is-on': pressed }" type="button" role="switch" :aria-checked="pressed" :disabled="disabled" @click="emit('update:modelValue', !pressed)"><span /></button>
</template>
<style scoped>
.ejiabao-ui-switch { position: relative; width: 42px; height: 24px; padding: 0; border: 1px solid var(--border); border-radius: 999px; background: var(--secondary); cursor: pointer; transition: background .18s ease, border-color .18s ease; }
.ejiabao-ui-switch span { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted-foreground); transition: transform .18s ease, background .18s ease; }
.ejiabao-ui-switch.is-on { border-color: var(--lime); background: var(--lime); }
.ejiabao-ui-switch.is-on span { background: #101113; transform: translateX(18px); }
.ejiabao-ui-switch:focus-visible { outline: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 22%, transparent); }
.ejiabao-ui-switch:disabled { opacity: .55; cursor: not-allowed; }
</style>
