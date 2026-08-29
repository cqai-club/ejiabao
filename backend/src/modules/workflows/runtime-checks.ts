import { spawn } from "node:child_process";
import type { AppConfig } from "../../config.js";

const REQUIRED_FFMPEG_FILTERS = ["color", "scale", "overlay", "amix", "drawtext", "subtitles"];

export function resolveFfmpeg(config: Pick<AppConfig, "DSH_FFMPEG">) {
  return config.DSH_FFMPEG || process.env.DSH_FFMPEG || "ffmpeg";
}

export async function checkWorkflowFfmpeg(command: string, requiredFilters = REQUIRED_FFMPEG_FILTERS) {
  const version = await commandAvailable(command, ["-version"]);
  if (!version) {
    return { ok: false, command, version: false, filters: false, missingFilters: requiredFilters };
  }

  const listed = await commandOutput(command, ["-hide_banner", "-filters"]);
  if (!listed.ok) {
    return { ok: false, command, version: true, filters: false, missingFilters: requiredFilters };
  }

  const missingFilters = requiredFilters.filter(filter => !new RegExp(`\\b${escapeRegExp(filter)}\\b`).test(listed.output));
  return {
    ok: missingFilters.length === 0,
    command,
    version: true,
    filters: true,
    missingFilters
  };
}

async function commandAvailable(command: string, args: string[]) {
  const result = await commandOutput(command, args);
  return result.ok;
}

async function commandOutput(command: string, args: string[]) {
  return new Promise<{ ok: boolean; output: string }>(resolve => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, output: Buffer.concat(chunks).toString("utf8") });
    }, 8_000);
    child.stdout?.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.once("error", () => {
      clearTimeout(timeout);
      resolve({ ok: false, output: Buffer.concat(chunks).toString("utf8") });
    });
    child.once("close", code => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
