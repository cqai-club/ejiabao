<script setup lang="ts">
withDefaults(defineProps<{ orientation?: "horizontal" | "vertical" }>(), { orientation: "horizontal" });
</script>
<template><div class="ejiabao-ui-separator" :class="`is-${orientation}`" role="separator" /></template>
<style scoped>
.ejiabao-ui-separator { background: var(--border); }
.ejiabao-ui-separator.is-horizontal { width: 100%; height: 1px; }
.ejiabao-ui-separator.is-vertical { width: 1px; min-height: 20px; }
</style>
