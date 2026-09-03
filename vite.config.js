import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

async function collectFiles(source) {
  const sourceStat = await stat(source);
  if (sourceStat.isFile()) return [source];
  const entries = await readdir(source, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = join(source, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function copyInlineAssetsPlugin() {
  const mappings = [
    { source: fileURLToPath(new URL("./assets/cases", import.meta.url)), output: "assets/cases" },
    { source: fileURLToPath(new URL("./assets/payment", import.meta.url)), output: "assets/payment" },
    { source: fileURLToPath(new URL("./node_modules/lucide/dist/umd/lucide.min.js", import.meta.url)), output: "lucide.min.js" }
  ];

  return {
    name: "ejiabao-copy-inline-assets",
    apply: "build",
    async generateBundle() {
      for (const mapping of mappings) {
        for (const filePath of await collectFiles(mapping.source)) {
          const relativePath = relative(mapping.source, filePath).replaceAll("\\", "/");
          const fileName = relativePath ? `${mapping.output}/${relativePath}` : mapping.output;
          this.emitFile({
            type: "asset",
            fileName,
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
    copyInlineAssetsPlugin(),
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
