<script setup lang="ts">
defineProps<{ title?: string; description?: string }>();
</script>

<template>
  <section class="ejiabao-section-card">
    <div v-if="title || description || $slots.header" class="ejiabao-section-card-header">
      <div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <slot name="header" />
    </div>
    <div class="ejiabao-section-card-content"><slot /></div>
  </section>
</template>

<style scoped>
.ejiabao-section-card { border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--card-foreground); box-shadow: 0 14px 36px rgba(10, 12, 18, .08); }
.ejiabao-section-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 20px 20px 0; }
.ejiabao-section-card-header h2 { margin: 0; font-size: 18px; line-height: 1.25; }
.ejiabao-section-card-header p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.6; }
.ejiabao-section-card-content { padding: 20px; }
@media (max-width: 640px) { .ejiabao-section-card-header { flex-direction: column; } }
</style>
