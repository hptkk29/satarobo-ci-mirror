import { describe, expect, it, vi } from "vitest";

/**
 * [TDM] V8.24 (BR-HT-01) — `progress` chuyển «mốc lớn» + «tuần này» của `getHanhTrinh` ra app (trước đó web có, API di động bỏ). Mock bốn nguồn của web; kiểm chuyển NGUYÊN chữ, null khi không có, không đổi phần cũ.
 *   [TDM-01] có mốc + tuần này ⇒ chuyển đúng ba trường chữ, không thêm trường lạ
 *   [TDM-02] không mốc / không buổi kế tiếp ⇒ `null` (không bịa)
 *   [TDM-03] phần cũ (hanhTrinh/chuyenCan/nhanXet) giữ nguyên hình dạng
 */
const ht = (moc: unknown, tuanNay: unknown) => ({
  tenKhoa: "Lập trình Robot",
  tenLop: "L1",
  tomTat: { daHoc: 5, tong: 12, conLai: 7, coMat: 4, mauSoCoMat: 5, canBu: 0, canBuLopKhac: 0 },
  moc,
  tuanNay,
});
const mocHt = vi.hoisted(() => ({ gia: null as unknown }));
vi.mock("@/lib/portal/hanh-trinh", () => ({ getHanhTrinh: vi.fn(async () => mocHt.gia) }));
vi.mock("@/lib/portal/chuyen-can", () => ({
  getChuyenCan: vi.fn(async () => ({ so: { coMat: 4, tiLe: { mauSo: 5, phanTram: 80 }, choBu: 0, vangKhongBu: 0 }, ketLuan: { tieuDe: "Đủ buổi", giaiThich: "", sac: "tot" }, hang: [] })),
}));
vi.mock("@/lib/portal/feedback", () => ({ getStudentFeedback: vi.fn(async () => []) }));
vi.mock("@/lib/portal/tong-quan", () => ({ getTongQuan: vi.fn(async () => ({ hanhTrinh: { hocPhan: [{ ma: "HP1", ten: "Học phần 1", tong: 4, daHoc: 4, ong: ["xong", "xong", "xong", "xong"] }] } })) }));

import { layTienDo } from "./dich-vu/tien-do";

const HS = "hs-1" as never;
const NOW = new Date("2026-11-21T05:00:00Z");

describe("[TDM] progress: mốc lớn + tuần này", () => {
  it("[TDM-01] có mốc + tuần này ⇒ chuyển đúng chữ", async () => {
    mocHt.gia = ht({ nhan: "MỐC LỚN · BUỔI 8", tieuDe: "Dò line", ngay: "CN, 06/12" }, { nhan: "TUẦN NÀY · BUỔI 6", tieuDe: "Tránh vật cản", dong: "CN, 22/11 · 18:00" });
    const d = await layTienDo(HS, "u1", NOW);
    expect(d.moc).toEqual({ nhan: "MỐC LỚN · BUỔI 8", tieuDe: "Dò line", ngay: "CN, 06/12" });
    expect(d.tuanNay).toEqual({ nhan: "TUẦN NÀY · BUỔI 6", tieuDe: "Tránh vật cản", dong: "CN, 22/11 · 18:00" });
  });

  it("[TDM-02] không mốc / không buổi kế tiếp ⇒ null", async () => {
    mocHt.gia = ht(null, null);
    const d = await layTienDo(HS, "u1", NOW);
    expect(d.moc).toBeNull();
    expect(d.tuanNay).toBeNull();
  });

  it("[TDM-03] phần cũ giữ nguyên hình dạng", async () => {
    mocHt.gia = ht(null, null);
    const d = await layTienDo(HS, "u1", NOW);
    expect(Object.keys(d).sort()).toEqual(["chuyenCan", "hanhTrinh", "moc", "nhanXet", "tenKhoa", "tenLop", "tuanNay"]);
    expect(d.hanhTrinh).toMatchObject({ daHoc: 5, tong: 12, conLai: 7 });
    expect(d.chuyenCan).toMatchObject({ coMat: 4, mauSo: 5, phanTram: 80 });
  });
});
