import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const pidFile = resolve(process.cwd(), ".local", "server.pid");
if (!existsSync(pidFile)) {
  console.log("没有找到后台后端进程记录。");
  process.exit(0);
}

const pid = Number(readFileSync(pidFile, "utf8").trim());
try {
  if (Number.isInteger(pid) && pid > 0) process.kill(pid);
  console.log(`已停止后端进程（PID ${pid}）。`);
} catch (error: any) {
  if (error?.code !== "ESRCH") throw error;
  console.log("后端进程已经停止。");
} finally {
  unlinkSync(pidFile);
}
