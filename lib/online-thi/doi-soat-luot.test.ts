// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({ lan: [] as { daChot: number; hetHanKhongNhap: number; boQua: number; loi: { attemptId: string; thongBao: string }[]; conLai: boolean }[], goi: [] as unknown[] }));
vi.mock("@/lib/elearning-online/luot-nhap-db", () => ({
  doiSoatLuotQuaHan: vi.fn(async (_db: unknown, o: unknown) => {
    M.goi.push(o);
    const r = M.lan.shift();
    if (!r) throw new Error("hết kịch bản");
    return r;
  }),
}));

import { chayDoiSoatLuotQuaHan } from "./doi-soat-luot";

const r = (daChot: number, conLai: boolean, extra: Partial<{ hetHanKhongNhap: number; boQua: number; loi: { attemptId: string; thongBao: string }[] }> = {}) => ({ daChot, hetHanKhongNhap: 0, boQua: 0, loi: [], conLai, ...extra });
const DB = {} as never;
const T = new Date("2026-11-25T03:00:00Z");

beforeEach(() => {
  M.lan = [];
  M.goi = [];
});

describe("[ODS] vòng lặp tự chốt lượt thi Online quá hạn", () => {
  it("[ODS-01] lặp tới khi conLai=false, cộng dồn số liệu, truyền now() MỖI vòng và gioiHan", async () => {
    M.lan = [r(200, true), r(150, true, { hetHanKhongNhap: 10 }), r(5, false, { boQua: 2 })];
    let n = 0;
    const kq = await chayDoiSoatLuotQuaHan(DB, { now: () => new Date(T.getTime() + 1000 * ++n), gioiHan: 200 });
    expect(kq).toMatchObject({ daChot: 355, hetHanKhongNhap: 10, boQua: 2, conLai: false, soVong: 3 });
    expect(M.goi).toEqual([{ now: new Date(T.getTime() + 1000), gioiHan: 200 }, { now: new Date(T.getTime() + 2000), gioiHan: 200 }, { now: new Date(T.getTime() + 3000), gioiHan: 200 }]);
  });
  it("[ODS-02] DỪNG khi một vòng không tiến triển (lượt lỗi kẹt đầu hàng) — không quay tại chỗ; báo conLai + lỗi", async () => {
    M.lan = [r(0, true, { loi: [{ attemptId: "a1", thongBao: "lỗi giả" }] }), r(99, true)];
    const kq = await chayDoiSoatLuotQuaHan(DB, { now: () => T });
    expect(kq).toMatchObject({ daChot: 0, conLai: true, soVong: 1, loi: [{ attemptId: "a1", thongBao: "lỗi giả" }] });
    expect(M.lan).toHaveLength(1); // vòng 2 KHÔNG được gọi
  });
  it("[ODS-03] có TRẦN số vòng (đối chứng: còn tiến triển mãi cũng dừng)", async () => {
    M.lan = Array.from({ length: 50 }, () => r(1, true));
    const kq = await chayDoiSoatLuotQuaHan(DB, { now: () => T, tranVong: 4 });
    expect(kq).toMatchObject({ soVong: 4, daChot: 4, conLai: true });
  });
  it("[ODS-04] không có gì để chốt ⇒ một vòng, conLai=false", async () => {
    M.lan = [r(0, false)];
    expect(await chayDoiSoatLuotQuaHan(DB, { now: () => T })).toMatchObject({ soVong: 1, daChot: 0, conLai: false, loi: [] });
  });
});
