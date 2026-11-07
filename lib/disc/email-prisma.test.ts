// @vitest-environment node
/**
 * [DISC-EPR-*] Tầng Prisma của email DISC: điều kiện CAS (hạn theo CỘT, gửi lại chỉ khi token cũ hết hạn) nằm TRONG `where` của phép ghi.
 * `where` sai vẫn trả kết quả hợp lệ ở mọi test thuần ⇒ phải ghim điều kiện bằng cách chụp đối số gửi cho Prisma. Không chạm DB. Dữ liệu GIẢ.
 */
import { describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  updateMany: vi.fn(async (_a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ count: 1 })),
  findUnique: vi.fn(async (_a: { select: Record<string, boolean> }) => null as unknown),
  rateLimit: vi.fn(async (_a: { key: string; max: number; windowMs: number }) => ({ success: true })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { discSubmission: { updateMany: M.updateMany, findUnique: M.findUnique }, emailQueue: { findFirst: vi.fn() } } }));
vi.mock("@/lib/email/queue", () => ({ enqueueEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: M.rateLimit }));

import { TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY, TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY } from "./email";
import { emailStore, gioiHanEmailThat } from "./email-prisma";

const NOW = new Date("2026-11-01T00:00:00Z");
const HET = new Date("2026-11-01T01:00:00Z");

describe("[DISC-EPR-01] datTokenLanDau: chưa có token HOẶC token cũ hết hạn; ghi cả hash lẫn hạn", () => {
  it("where có nhánh OR (hash null | hạn ≤ now) và data mang emailVerifyExpiresAt", async () => {
    M.updateMany.mockClear();
    expect(await emailStore.datTokenLanDau("s1", "h1", HET, NOW)).toBe(true);
    const a = M.updateMany.mock.calls[0]![0];
    expect(a.where).toMatchObject({ id: "s1", emailStatus: "VERIFICATION_REQUIRED", deletedAt: null, emailTo: { not: null } });
    expect(a.where.OR).toEqual([{ emailVerifyTokenHash: null }, { emailVerifyExpiresAt: { lte: NOW } }]);
    expect(a.data).toEqual({ emailVerifyTokenHash: "h1", emailVerifyExpiresAt: HET });
  });
  it("count 0 (đã có token còn hạn / đua thua) ⇒ false", async () => {
    M.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await emailStore.datTokenLanDau("s1", "h1", HET, NOW)).toBe(false);
  });
});

describe("[DISC-EPR-02] xacMinhNeuKhop: hạn theo CỘT nằm trong chính phép ghi; xong là xoá token + hạn", () => {
  it("where đòi hash khớp ∧ emailVerifyExpiresAt > now ∧ còn VERIFICATION_REQUIRED", async () => {
    M.updateMany.mockClear();
    expect(await emailStore.xacMinhNeuKhop("s1", "h1", NOW)).toBe(true);
    const a = M.updateMany.mock.calls[0]![0];
    expect(a.where).toMatchObject({ id: "s1", emailStatus: "VERIFICATION_REQUIRED", emailVerifyTokenHash: "h1", emailVerifyExpiresAt: { gt: NOW }, deletedAt: null });
    expect(a.data).toMatchObject({ emailStatus: "QUEUED", emailVerifiedAt: NOW, emailVerifyTokenHash: null, emailVerifyExpiresAt: null });
  });
  it("goTokenNeuKhop: chỉ gỡ đúng hash này, xoá cả hạn", async () => {
    M.updateMany.mockClear();
    await emailStore.goTokenNeuKhop("s1", "h1");
    expect(M.updateMany.mock.calls[0]![0]).toEqual({ where: { id: "s1", emailVerifyTokenHash: "h1" }, data: { emailVerifyTokenHash: null, emailVerifyExpiresAt: null } });
  });
  it("layBai đọc cột hạn (thiếu là service coi mọi link hết hạn)", async () => {
    M.findUnique.mockClear();
    await emailStore.layBai("s1");
    expect(M.findUnique.mock.calls[0]![0].select).toMatchObject({ emailVerifyExpiresAt: true, emailTo: true });
  });
});

describe("[DISC-EPR-03] trần số thư: khoá theo địa chỉ ĐÃ BĂM / theo bài, đúng ngưỡng ngày", () => {
  it("theoDiaChi / theoBai gọi rateLimit đúng khoá + ngưỡng; hết hạn mức ⇒ false", async () => {
    M.rateLimit.mockClear();
    expect(await gioiHanEmailThat.theoDiaChi("khoa-bam-1")).toBe(true);
    expect(await gioiHanEmailThat.theoBai("s1")).toBe(true);
    expect(M.rateLimit.mock.calls.map((c) => c[0])).toEqual([
      { key: "disc-email:dia-chi:khoa-bam-1", max: TRAN_THU_XAC_MINH_MOI_DIA_CHI_MOI_NGAY, windowMs: 86_400_000 },
      { key: "disc-email:bai:s1", max: TRAN_THU_XAC_MINH_MOI_BAI_MOI_NGAY, windowMs: 86_400_000 },
    ]);
    M.rateLimit.mockResolvedValueOnce({ success: false });
    expect(await gioiHanEmailThat.theoBai("s1")).toBe(false);
  });
});
