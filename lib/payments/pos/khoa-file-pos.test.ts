// [POS-KF-*] — khoá "cùng một file" của nút "Tiếp tục từ lô x/y". THUẦN.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DongPos } from "./kieu";
import { khoaFilePos } from "./khoa-file-pos";

const dong = (i: number, p: Partial<DongPos> = {}): DongPos => ({
  maGiaoDich: `FT${String(i).padStart(10, "0")}`,
  loaiGiaoDich: "Thanh toán",
  hinhThuc: "Thẻ",
  trangThai: "Thành công",
  soTien: 1_000_000 + i,
  thoiGian: "2026-09-29T10:00:00+07:00",
  dienGiai: "",
  maChuanChi: null,
  maGiaoDichThe: null,
  maGiaoDichGoc: null,
  trangThaiHoanHuy: null,
  maDonHang: null,
  maQuay: "Q1",
  maThietBi: "MAY",
  soTheMasked: null,
  loaiThe: null,
  maHachToan: null,
  phiGiaoDich: null,
  ...p,
});

const file = (sua?: { i: number; p: Partial<DongPos> }) =>
  Array.from({ length: 50 }, (_, i) => (sua && sua.i === i ? dong(i, sua.p) : dong(i)));

describe("[POS-KF] khoá file cho nút tiếp tục", () => {
  it("[POS-KF-01] cùng nội dung ⇒ cùng khoá", () => {
    expect(khoaFilePos("a.zip", file(), 3)).toBe(khoaFilePos("a.zip", file(), 3));
  });

  it("[POS-KF-02] bản xuất lại: đổi MỘT ô ở dòng GIỮA (mã đầu/cuối, số dòng, số lô giữ nguyên) ⇒ KHÁC khoá", () => {
    // Mã TRƯỚC bản vá: khoá = tên|số dòng|số lô|mã đầu|mã cuối ⇒ ba ca dưới đều ra CÙNG khoá.
    const goc = khoaFilePos("a.zip", file(), 3);
    expect(khoaFilePos("a.zip", file({ i: 20, p: { trangThaiHoanHuy: "Hủy toàn phần" } }), 3)).not.toBe(goc);
    expect(khoaFilePos("a.zip", file({ i: 21, p: { maHachToan: "HT1" } }), 3)).not.toBe(goc);
    expect(khoaFilePos("a.zip", file({ i: 22, p: { soTien: 5 } }), 3)).not.toBe(goc);
  });

  it("[POS-KF-03] khác tên / khác số lô ⇒ khác khoá", () => {
    const goc = khoaFilePos("a.zip", file(), 3);
    expect(khoaFilePos("b.zip", file(), 3)).not.toBe(goc);
    expect(khoaFilePos("a.zip", file(), 4)).not.toBe(goc);
  });

  it("[POS-KF-W1] màn import dựng khoá bằng `khoaFilePos` — không tự ghép chuỗi mã đầu/cuối", () => {
    const ma = readFileSync(resolve(process.cwd(), "app/(admin)/admin/bien-dong-so-du/_components/nhap-file-pos.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(ma.match(/\bkhoaFilePos\(/g)?.length ?? 0).toBe(1);
    expect(ma.match(/dong\.at\(-1\)\?\.maGiaoDich/g)?.length ?? 0).toBe(0);
  });
});
