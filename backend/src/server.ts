import { buildApp } from "./app.js";
import { closeDatabase } from "./db.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp(config);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`e剪宝后端已启动：${config.PORT}`);
} catch (error) {
  app.log.error(error);
  await closeDatabase();
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info(`收到 ${signal}，开始安全退出`);
  await app.close();
  await closeDatabase();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
