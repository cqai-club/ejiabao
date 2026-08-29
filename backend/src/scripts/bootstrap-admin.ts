import argon2 from "argon2";
import { closeDatabase, prisma } from "../db.js";

/**
 * One-time server-side administrator bootstrap.
 *
 * Credentials are read from transient environment variables so neither the
 * source tree nor a command-line argument ever contains the password.
 * Re-running with the same email intentionally resets that account's password
 * and promotes it to ADMIN; the confirmation value prevents accidental use.
 */
const email = String(process.env.ADMIN_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || "");
const confirmation = String(process.env.ADMIN_BOOTSTRAP_CONFIRM || "");

if (confirmation !== "CREATE_OR_RESET_ADMIN") {
  fail("为避免误操作，请设置 ADMIN_BOOTSTRAP_CONFIRM=CREATE_OR_RESET_ADMIN 后再执行。");
}
if (!/^\S+@\S+\.\S+$/.test(email)) fail("ADMIN_BOOTSTRAP_EMAIL 不是有效的邮箱地址。");
if (password.length < 8) fail("ADMIN_BOOTSTRAP_PASSWORD 至少需要 8 位。");

try {
  const passwordHash = await argon2.hash(password);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", passwordHash }
      }),
      prisma.authSession.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() }
      })
    ]);
    console.log(`管理员已更新：${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        nickname: "平台管理员",
        role: "ADMIN",
        quota: { create: { balance: 0 } }
      }
    });
    console.log(`管理员已创建：${email}`);
  }
} finally {
  await closeDatabase();
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
