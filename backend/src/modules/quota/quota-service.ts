import { randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";

/** 额度必须通过账本变更，支付充值和任务消耗共用同一套幂等账本。 */
export function createQuotaService() {
  async function get(userId: string) {
    return prisma.quotaAccount.upsert({ where: { userId }, create: { userId }, update: {}, select: { balance: true, reserved: true, updatedAt: true } });
  }

  async function reserve(userId: string, amount: number, reason: string, taskId?: string) {
    const idempotencyKey = `reserve:${taskId || randomUUID()}`;
    return prisma.$transaction((tx: any) => reserveInTransaction(tx, { userId, amount, reason, taskId, idempotencyKey }));
  }

  async function reserveInTransaction(tx: any, { userId, amount, reason, taskId, idempotencyKey = `reserve:${taskId || randomUUID()}` }: { userId: string; amount: number; reason: string; taskId?: string; idempotencyKey?: string }) {
    assertPositive(amount);
    const existing = await tx.quotaLedger.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const account = await tx.quotaAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    const available = account.balance - account.reserved;
    if (available < amount) throw new AppError("创作额度不足。", "QUOTA_INSUFFICIENT", 402, { available, required: amount });
    const updated = await tx.quotaAccount.update({ where: { userId }, data: { reserved: { increment: amount } } });
    return tx.quotaLedger.create({ data: { userId, taskId, kind: "RESERVE", amount: -amount, balanceAfter: updated.balance - updated.reserved, reason, idempotencyKey } });
  }

  async function settle(userId: string, amount: number, taskId: string, reason = "生成任务结算") {
    return prisma.$transaction(async (tx: any) => {
      const idempotencyKey = `debit:${taskId}`;
      const existing = await tx.quotaLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
      const account = await tx.quotaAccount.findUnique({ where: { userId } });
      if (!account || account.reserved < amount || account.balance < amount) throw new AppError("预留额度状态异常。", "QUOTA_RESERVATION_INVALID", 409);
      const updated = await tx.quotaAccount.update({ where: { userId }, data: { balance: { decrement: amount }, reserved: { decrement: amount } } });
      return tx.quotaLedger.create({ data: { userId, taskId, kind: "DEBIT", amount: -amount, balanceAfter: updated.balance - updated.reserved, reason, idempotencyKey } });
    });
  }

  async function release(userId: string, amount: number, taskId: string, reason = "任务失败释放预留额度") {
    return prisma.$transaction(async (tx: any) => {
      const idempotencyKey = `release:${taskId}`;
      const existing = await tx.quotaLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
      const account = await tx.quotaAccount.findUnique({ where: { userId } });
      if (!account || account.reserved < amount) throw new AppError("预留额度状态异常。", "QUOTA_RESERVATION_INVALID", 409);
      const updated = await tx.quotaAccount.update({ where: { userId }, data: { reserved: { decrement: amount } } });
      return tx.quotaLedger.create({ data: { userId, taskId, kind: "RELEASE", amount: 0, balanceAfter: updated.balance - updated.reserved, reason, idempotencyKey } });
    });
  }

  async function adminCredit(userId: string, amount: number, reason: string, idempotencyKey = `credit:${randomUUID()}`) {
    return prisma.$transaction((tx: any) => creditInTransaction(tx, { userId, amount, reason, idempotencyKey }));
  }

  async function creditInTransaction(tx: any, { userId, amount, reason, idempotencyKey = `credit:${randomUUID()}` }: { userId: string; amount: number; reason: string; idempotencyKey?: string }) {
    assertPositive(amount);
    const existing = await tx.quotaLedger.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const account = await tx.quotaAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    const updated = await tx.quotaAccount.update({ where: { userId }, data: { balance: { increment: amount } } });
    return tx.quotaLedger.create({ data: { userId, kind: "CREDIT", amount, balanceAfter: updated.balance - updated.reserved, reason, idempotencyKey } });
  }

  return { get, reserve, reserveInTransaction, settle, release, adminCredit, creditInTransaction };
}

function assertPositive(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError("额度数量必须是正整数。", "QUOTA_AMOUNT_INVALID");
}
