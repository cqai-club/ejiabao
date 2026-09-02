import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

async function collectFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function copyInlineAssetDirectoriesPlugin() {
  const mappings = [
    { source: fileURLToPath(new URL("./assets/cases", import.meta.url)), output: "assets/cases" },
    { source: fileURLToPath(new URL("./assets/payment", import.meta.url)), output: "assets/payment" }
  ];

  return {
    name: "ejiabao-copy-inline-asset-directories",
    apply: "build",
    async generateBundle() {
      for (const mapping of mappings) {
        for (const filePath of await collectFiles(mapping.source)) {
          const relativePath = relative(mapping.source, filePath).replaceAll("\\", "/");
          this.emitFile({
            type: "asset",
            fileName: `${mapping.output}/${relativePath}`,
            source: await readFile(filePath)
          });
        }
      }
    }
  };
}

export default defineConfig(({ command, isPreview }) => ({
  plugins: [
    vue(),
    tailwindcss(),
    copyInlineAssetDirectoriesPlugin(),
    ...(command === "serve" && !isPreview
      ? [codeInspectorPlugin({ bundler: "vite", dev: true })]
      : [])
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false
  }
}));
