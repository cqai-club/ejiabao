export function goLegacy(view: string) {
  window.location.hash = `#/${view}`;
}

export function openModelConfig(mode?: "custom" | "platform") {
  const query = mode === "custom" || mode === "platform" ? `?mode=${mode}` : "";
  window.location.hash = `#/settings/models${query}`;
}
