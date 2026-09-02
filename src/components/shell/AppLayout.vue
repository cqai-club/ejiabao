<script setup lang="ts">
import { nextTick, onMounted, onUnmounted } from "vue";
import Sidebar from "./Sidebar.vue";
import Topbar from "./Topbar.vue";

let workspaceSource: HTMLElement | null = null;
let workspaceHost: HTMLElement | null = null;

function attachLegacyWorkspace() {
  const source = document.getElementById("legacy-workspace-source");
  const host = document.getElementById("legacy-workspace-slot");
  if (!source || !host || source === host) return;
  workspaceSource = source;
  workspaceHost = host;
  host.prepend(...Array.from(source.children));
  source.hidden = true;
  window.dispatchEvent(new CustomEvent("ejiabao:vue-shell-ready"));
}

onMounted(() => { void nextTick(attachLegacyWorkspace); });
onUnmounted(() => {
  if (workspaceSource && workspaceHost) {
    const legacyNodes = Array.from(workspaceHost.children).filter(node => !node.classList.contains("ejiabao-page-shell"));
    workspaceSource.replaceChildren(...legacyNodes);
    workspaceSource.hidden = true;
  }
});
</script>

<template>
  <div class="app">
    <Sidebar />
    <main class="main">
      <Topbar />
      <div id="legacy-workspace-slot" class="workspace">
        <div class="ejiabao-page-shell"><slot /></div>
      </div>
    </main>
  </div>
</template>
