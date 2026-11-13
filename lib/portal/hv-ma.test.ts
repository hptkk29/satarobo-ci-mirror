// Bộ đếm sai / khoá của mã thoát — chạy trên một DB GIẢ giữ đúng ngữ nghĩa của các câu cập nhật có điều kiện (không cần Postgres).
// Mật khẩu/ mã băm bằng bcrypt THẬT; khoá thời gian truyền `now` tường minh (luật 19).
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Dong = { id: string; parentUserId: string; maBam: string; soLanSai: number; khoaDen: Date | null };
let dong: Dong | null = null;
const nhatKy: string[] = [];
const thongBao: { dedupeKey: string | null }[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ success: true, remaining: 4, resetAt: 0 }) }));

const khop = (d: Dong, w: Record<string, unknown>): boolean => {
  if (w.parentUserId !== undefined && d.parentUserId !== w.parentUserId) return false;
  if ("khoaDen" in w) {
    const k = w.khoaDen;
    if (k === null) {
      if (d.khoaDen !== null) return false;
    } else if (k && typeof k === "object" && "lte" in (k as object)) {
      if (d.khoaDen === null || d.khoaDen.getTime() > (k as { lte: Date }).lte.getTime()) return false;
    }
  }
  if (w.soLanSai && typeof w.soLanSai === "object" && "lt" in (w.soLanSai as object)) {
    if (!(d.soLanSai < (w.soLanSai as { lt: number }).lt)) return false;
  }
  return true;
};

vi.mock("@/lib/db", () => ({
  db: {
    hocSinhMaThoat: {
      findUnique: async () => (dong ? { ...dong } : null),
      upsert: async () => undefined,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Dong> & { soLanSai?: number } }) => {
        if (!dong || !khop(dong, where)) return { count: 0 };
        Object.assign(dong, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: { soLanSai: { increment: number } } }) => {
        if (!dong || !khop(dong, where)) throw new Prisma.PrismaClientKnownRequestError("khong thay", { code: "P2025", clientVersion: "5" });
        dong.soLanSai += data.soLanSai.increment;
        return { maBam: dong.maBam, soLanSai: dong.soLanSai };
      },
    },
    hocSinhCheDoNhatKy: { create: async ({ data }: { data: { loai: string } }) => void nhatKy.push(data.loai) },
    notification: { create: async ({ data }: { data: { dedupeKey: string | null } }) => void thongBao.push({ dedupeKey: data.dedupeKey }) },
  },
}));

const { kiemMaCoDem } = await import("./hv-ma");

const T0 = new Date("2026-11-05T03:00:00Z");
const boiCanh = { studentId: "conA", tenCon: "Bé A" };
const thu = (ma: string, now = T0) => kiemMaCoDem("ph1", ma, now, boiCanh);

beforeEach(async () => {
  nhatKy.length = 0;
  thongBao.length = 0;
  dong = { id: "d1", parentUserId: "ph1", maBam: await bcrypt.hash("4827", 4), soLanSai: 0, khoaDen: null };
});

describe("mã thoát — kiemMaCoDem", () => {
  it("[HVK-01] mã đúng ⇒ dung, bộ đếm về 0", async () => {
    dong!.soLanSai = 3;
    expect(await thu("4827")).toEqual({ ket: "dung" });
    expect(dong!.soLanSai).toBe(0);
  });
  it("[HVK-02] sai ⇒ báo số lần còn lại, ghi nhật ký; chưa đủ 5 lần thì CHƯA khoá", async () => {
    expect(await thu("0000")).toEqual({ ket: "sai", conLai: 4 });
    expect(await thu("0000")).toEqual({ ket: "sai", conLai: 3 });
    expect(dong!.khoaDen).toBeNull();
    expect(nhatKy.filter((l) => l === "NHAP_SAI")).toHaveLength(2);
    expect(thongBao).toHaveLength(0);
  });
  it("[HVK-03] lần sai thứ 5 ⇒ khoá 5 phút + MỘT thông báo vào chuông ba mẹ + nhật ký KHOA", async () => {
    for (let i = 0; i < 4; i++) await thu("0000");
    const r = await thu("0000");
    expect(r).toMatchObject({ ket: "khoa", giayCon: 300, vuaKhoa: true });
    expect(dong!.khoaDen?.getTime()).toBe(T0.getTime() + 300_000);
    expect(nhatKy).toContain("KHOA");
    expect(thongBao).toHaveLength(1);
    expect(thongBao[0]?.dedupeKey).toBe(`hv-khoa:ph1:${T0.getTime() + 300_000}`);
  });
  it("[HVK-04] đang khoá thì KHÔNG so mã: nhập ĐÚNG mã cũng bị từ chối (không đoán thử trong lúc khoá)", async () => {
    for (let i = 0; i < 5; i++) await thu("0000");
    const spy = vi.spyOn(bcrypt, "compare");
    const r = await thu("4827", new Date(T0.getTime() + 60_000));
    expect(r).toMatchObject({ ket: "khoa", vuaKhoa: false });
    expect((r as { giayCon: number }).giayCon).toBe(240);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("[HVK-05] hết 5 phút ⇒ được thử lại đủ 5 lần từ đầu", async () => {
    for (let i = 0; i < 5; i++) await thu("0000");
    const sau = new Date(T0.getTime() + 301_000);
    expect(await thu("0000", sau)).toEqual({ ket: "sai", conLai: 4 });
    expect(await thu("4827", sau)).toEqual({ ket: "dung" });
  });
  it("[HVK-06] năm lần thử SONG SONG chỉ có năm lần được so; lần thứ sáu bị khoá không cần so", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    const kq = await Promise.all(Array.from({ length: 8 }, () => thu("0000")));
    expect(spy).toHaveBeenCalledTimes(5);
    expect(kq.filter((k) => k.ket === "khoa").length).toBeGreaterThanOrEqual(3);
    expect(thongBao.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
  });
  it("[HVK-07] chưa từng tạo mã ⇒ chua-co-ma (không báo đúng/sai)", async () => {
    dong = null;
    expect(await thu("4827")).toEqual({ ket: "chua-co-ma" });
  });
  it("[HVK-08] lần đúng ở giữa chừng xoá bộ đếm: 4 sai + 1 đúng + 4 sai KHÔNG khoá", async () => {
    for (let i = 0; i < 4; i++) await thu("0000");
    expect(await thu("4827")).toEqual({ ket: "dung" });
    for (let i = 0; i < 4; i++) await thu("0000");
    expect(dong!.khoaDen).toBeNull();
  });
});
