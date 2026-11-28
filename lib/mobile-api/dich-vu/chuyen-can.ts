import { getChuyenCan, type OBuoi } from "@/lib/portal/chuyen-can";
import type { KieuO } from "@/lib/portal/chuyen-can-thuan";

import { ghiTrangThaiKhongHuongDan, ketLuanDiDong } from "../bo-huong-dan";
import type { MaHocVienDaKiem } from "../so-huu";

/**
 * NHÓM 2 (B4) — `GET /students/:id/attendance`. Dùng lại `getChuyenCan` của web (cùng nguồn trang Chuyên cần; số buổi, tỉ lệ, lượt bù đều do hàm nguồn tính — KHÔNG tính lại ở đây).
 * Bỏ (TL11 §6.5): `ketLuan.nut` (href web), `diem`, `baiVe`, `coBaiTap`, `sanPham`, `coPhieu`, `canhBao`, `xepLoai`, `phep`, `tenCon`, `dangKy`, `chonMacDinh`, `nhanNgoai`.
 * "Trạng thái học bù" = các ô `bu` (học bù xong) / `cho` (chờ bù) / `xep` (đã xếp lịch bù) + `luot` (số lượt bù) — CHỈ những gì hàm nguồn trả; không suy thêm.
 */
export type OBuoiDto = { id: string; n: number; kieu: KieuO; ten: string; ngay: string; ghi: string };
export type ChuyenCanDto = {
  tenKhoa: string | null;
  tenLop: string | null;
  capNhat: string | null;
  /** B4.5: KHÔNG có `viec` / nút — câu bảo-làm-gì đã bị lọc ở `bo-huong-dan.ts` (app chưa có luồng gửi yêu cầu). */
  ketLuan: { tieuDe: string; giaiThich: string; sac: "tot" | "canh-bao" };
  so: {
    lopDaHoc: number;
    conDaHoc: number;
    coMat: number;
    bu: number;
    choBu: number;
    vangKhongBu: number;
    chuaCham: number;
    conLai: number;
    tongNhom: number;
    tiLe: { phanTram: number; coMat: number; mauSo: number } | null;
  };
  hang: Array<{ ten: string; tom: string; o: OBuoiDto[] }>;
  luot: { tong: number; dung: number; giu: number; con: number } | null;
};

const o = (b: OBuoi): OBuoiDto => ({ id: b.id, n: b.n, kieu: b.kieu, ten: b.ten, ngay: b.ngay, ghi: ghiTrangThaiKhongHuongDan(b.ghi) });

export async function layChuyenCan(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<ChuyenCanDto> {
  const c = await getChuyenCan(hs, now);
  return {
    tenKhoa: c.tenKhoa,
    tenLop: c.tenLop,
    capNhat: c.capNhat,
    ketLuan: ketLuanDiDong(c.ketLuan),
    so: {
      lopDaHoc: c.so.lopDaHoc,
      conDaHoc: c.so.conDaHoc,
      coMat: c.so.coMat,
      bu: c.so.bu,
      choBu: c.so.choBu,
      vangKhongBu: c.so.vangKhongBu,
      chuaCham: c.so.chuaCham,
      conLai: c.so.conLai,
      tongNhom: c.so.tongNhom,
      tiLe: c.so.tiLe ? { phanTram: c.so.tiLe.phanTram, coMat: c.so.tiLe.coMat, mauSo: c.so.tiLe.mauSo } : null,
    },
    hang: c.hang.map((h) => ({ ten: h.ten, tom: h.tom, o: h.o.map(o) })),
    luot: c.luot ? { tong: c.luot.tong, dung: c.luot.dung, giu: c.luot.giu, con: c.luot.con } : null,
  };
}
