import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import type { AppConfig } from "../../config.js";

type AccountInput = { email?: string; phone?: string; password: string; nickname?: string };

export function createAuthBackendService({ app, config }: { app: FastifyInstance; config: AppConfig }) {
  function normalizeAccount(input: AccountInput) {
    const email = input.email?.trim().toLowerCase() || undefined;
    const phone = input.phone?.trim() || undefined;
    if ((!email && !phone) || (email && phone)) throw new AppError("请提供邮箱或手机号其中一种。", "ACCOUNT_INVALID");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new AppError("邮箱格式不正确。", "EMAIL_INVALID");
    if (phone && !/^\+?[0-9\s-]{6,20}$/.test(phone)) throw new AppError("手机号格式不正确。", "PHONE_INVALID");
    if (!input.password || input.password.length < 8) throw new AppError("密码至少需要 8 位。", "PASSWORD_INVALID");
    return { email, phone };
  }

  async function issueSession(user: { id: string; role: string }, request: FastifyRequest) {
    const refreshToken = randomBytes(48).toString("base64url");
    const refreshTokenHash = hash(refreshToken);
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });
    const accessToken = await app.jwt.sign({ sub: user.id, role: user.role, sid: session.id }, { expiresIn: "15m" });
    return { accessToken, refreshToken, expiresIn: 900, user };
  }

  async function register(input: AccountInput, request: FastifyRequest) {
    const account = normalizeAccount(input);
    const passwordHash = await argon2.hash(input.password);
    try {
      const user = await prisma.$transaction(async (tx: any) => {
        const created = await tx.user.create({
          data: { ...account, passwordHash, nickname: input.nickname?.trim() || "个人创作者", quota: { create: { balance: 0 } } },
          select: { id: true, email: true, phone: true, nickname: true, role: true }
        });
        return created;
      });
      return issueSession(user, request);
    } catch (error: any) {
      if (error?.code === "P2002") throw new AppError("该邮箱或手机号已经注册。", "ACCOUNT_EXISTS", 409);
      throw error;
    }
  }

  async function login(input: AccountInput, request: FastifyRequest) {
    const account = normalizeAccount(input);
    const user = await prisma.user.findFirst({ where: account, select: { id: true, email: true, phone: true, nickname: true, role: true, passwordHash: true } });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new AppError("账号或密码不正确。", "CREDENTIALS_INVALID", 401);
    }
    return issueSession(user, request);
  }

  async function refresh(refreshToken: string, request: FastifyRequest) {
    if (!refreshToken) throw new AppError("缺少 refresh token。", "REFRESH_TOKEN_MISSING", 401);
    const existing = await prisma.authSession.findUnique({ where: { refreshTokenHash: hash(refreshToken) }, include: { user: { select: { id: true, role: true, email: true, phone: true, nickname: true } } } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) throw new AppError("登录会话已失效。", "SESSION_EXPIRED", 401);
    await prisma.authSession.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    return issueSession(existing.user, request);
  }

  async function logout(sessionId?: string) {
    if (sessionId) await prisma.authSession.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  return { register, login, refresh, logout, normalizeAccount };
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
