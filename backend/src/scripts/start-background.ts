import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(process.cwd());
const localDir = resolve(root, ".local");
const pidFile = resolve(localDir, "server.pid");
const stdoutFile = resolve(localDir, "server.out.log");
const stderrFile = resolve(localDir, "server.err.log");
const port = Number(process.env.PORT || 8787);
const healthUrl = `http://127.0.0.1:${port}/health/live`;

mkdirSync(localDir, { recursive: true });

if (await isHealthy()) {
  console.log(`后端已在运行：http://127.0.0.1:${port}`);
  process.exit(0);
}

const oldPid = readPid();
if (oldPid && isProcessAlive(oldPid)) {
  console.error(`检测到已有后端进程（PID ${oldPid}），但健康检查未通过。请先运行 npm run stop:background 或查看 ${stderrFile}`);
  process.exit(1);
}

const childPid = process.platform === "win32"
  ? await launchWithPython()
  : launchDetachedNode();

writeFileSync(pidFile, String(childPid), "utf8");

for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await isHealthy()) {
    console.log(`后端已在后台启动：http://127.0.0.1:${port}`);
    console.log(`日志：${stdoutFile}`);
    process.exit(0);
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
}

console.error(`后端启动后健康检查未通过，请查看 ${stderrFile}`);
process.exit(1);

function launchDetachedNode() {
  const stdout = openSync(stdoutFile, "a");
  const stderr = openSync(stderrFile, "a");
  const child = spawn(process.execPath, ["--env-file=.env", "dist/server.js"], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr]
  });
  if (!child.pid) {
    console.error("后端进程启动失败，请查看日志。");
    process.exit(1);
  }
  child.unref();
  return child.pid;
}

async function launchWithPython() {
  const pythonBin = process.env.VLOG_EDIT_PYTHON_BIN || process.env.PRODUCT_PROMO_PYTHON_BIN || "python";
  const script = `
import os
import pathlib
import subprocess

root = pathlib.Path(${pyString(root)})
stdout_path = pathlib.Path(${pyString(stdoutFile)})
stderr_path = pathlib.Path(${pyString(stderrFile)})

env = {}
path_value = ""
for key, value in os.environ.items():
    if key.upper() == "PATH":
        path_value = value or path_value
    else:
        env[key] = value
if path_value:
    env["Path"] = path_value

stdout = open(stdout_path, "ab", buffering=0)
stderr = open(stderr_path, "ab", buffering=0)
flags = 0
if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
    flags |= subprocess.CREATE_NEW_PROCESS_GROUP
if hasattr(subprocess, "DETACHED_PROCESS"):
    flags |= subprocess.DETACHED_PROCESS
process = subprocess.Popen(
    [${pyString(process.execPath)}, "--env-file=.env", "dist/server.js"],
    cwd=str(root),
    stdin=subprocess.DEVNULL,
    stdout=stdout,
    stderr=stderr,
    env=env,
    creationflags=flags,
    close_fds=True,
)
print(process.pid)
`;
  const result = await runProcess(pythonBin, ["-c", script], sanitizeEnvForWindows());
  if (result.code === 0) {
    const pid = Number(result.stdout.trim().split(/\s+/).pop());
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  console.error(`无法通过 Python 后台方式启动后端：${result.stderr || result.stdout || "未知错误"}`);
  process.exit(1);
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolvePromise => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.once("error", error => resolvePromise({ code: null, stdout, stderr: error.message }));
    child.once("close", code => resolvePromise({ code, stdout, stderr }));
  });
}

function sanitizeEnvForWindows() {
  const env: NodeJS.ProcessEnv = {};
  let pathValue = "";
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() === "PATH") {
      pathValue = value || pathValue;
    } else {
      env[key] = value;
    }
  }
  if (pathValue) env.Path = pathValue;
  return env;
}

function pyString(value: string) {
  return JSON.stringify(value);
}

function readPid() {
  if (!existsSync(pidFile)) return null;
  const value = Number(readFileSync(pidFile, "utf8").trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}
