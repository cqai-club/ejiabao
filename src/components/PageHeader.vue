<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <header class="ejiabao-page-header">
    <div>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div class="ejiabao-page-header-actions"><slot /></div>
  </header>
</template>

<style scoped>
.ejiabao-page-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 640px) { .ejiabao-page-header-actions { justify-content: flex-start; } }
</style>
