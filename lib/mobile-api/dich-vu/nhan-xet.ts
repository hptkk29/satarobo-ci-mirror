import { reportCardPeriodDisplay } from "@/lib/lms/report-card";
import { getNhanXet } from "@/lib/portal/nhan-xet";
import type { KieuBuoi } from "@/lib/portal/nhan-xet-thuan";
import { getStudentReportCard } from "@/lib/portal/report-card-v2";

import { ghiTrangThaiKhongHuongDan } from "../bo-huong-dan";
import { nhanNgay } from "../dinh-dang";
import type { MaHocVienDaKiem } from "../so-huu";

/**
 * NHÓM 1 (B4) — `GET /students/:id/feedback` và `GET /students/:id/report-card`.
 * Dùng lại `getNhanXet` (cùng nguồn trang "Nhận xét & học bạ" của cổng phụ huynh) và `getStudentReportCard` (cùng nguồn `/portal/hoc-ba`) — KHÔNG tính lại điểm / xếp loại / số buổi ở đây.
 * Chỉ nhận `MaHocVienDaKiem` (đã qua `kiemHocVienCuaPhuHuynh`). DTO CHỌN TỪNG TRƯỜNG (không spread nguyên kết quả): bỏ `tenCon` (đã có ở /auth/me), `baiVe`/`coBaiTap` (bài tập tạm ẩn 03/11/2026),
 * `hocBa` (có endpoint riêng), `reportCardId` + đường PDF (P1, cần đường ký sẵn), `phep` / `xepLoai` / `diem` của chuyên cần. Ngưỡng "mới" (7 ngày) giữ nguyên như hàm nguồn.
 */
export type PhieuDto = {
  chamLuc: string | null;
  giaoVien: string | null;
  chung: Array<{ nhan: string | null; text: string }>;
  deXuat: string | null;
  nhom: Array<{ ten: string; tc: Array<{ id: string; ten: string; mo: string; vach: number }> }>;
  soTieuChi: number;
};
export type BuoiNxDto = {
  id: string;
  n: number;
  ngay: string;
  ten: string;
  hocPhan: string | null;
  kieu: KieuBuoi;
  moi: boolean;
  vangGhi: string | null;
  canBu: boolean;
  phieu: PhieuDto | null;
  muc: Record<string, number> | null;
};
export type NhanXetDto = {
  tenKhoa: string | null;
  tenLop: string | null;
  buoi: BuoiNxDto[];
  diHoc: { tieuDe: string; phu: string; mauSo: number };
  coMat: number;
  tong: number;
  daQua: number;
  canBuSo: number[];
};

export async function layNhanXet(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<NhanXetDto> {
  const d = await getNhanXet(hs, now);
  return {
    tenKhoa: d.tenKhoa,
    tenLop: d.tenLop,
    buoi: d.buoi.map((b) => ({
      id: b.id,
      n: b.n,
      ngay: b.ngay,
      ten: b.ten,
      hocPhan: b.hocPhan,
      kieu: b.kieu,
      moi: b.moi,
      vangGhi: b.vangGhi === null ? null : ghiTrangThaiKhongHuongDan(b.vangGhi),
      canBu: b.canBu,
      phieu: b.phieu
        ? {
            chamLuc: b.phieu.chamLuc,
            giaoVien: b.phieu.giaoVien,
            chung: b.phieu.chung.map((c) => ({ nhan: c.nhan, text: c.text })),
            deXuat: b.phieu.deXuat,
            nhom: b.phieu.nhom.map((g) => ({ ten: g.ten, tc: g.tc.map((t) => ({ id: t.id, ten: t.ten, mo: t.mo, vach: t.vach })) })),
            soTieuChi: b.phieu.soTieuChi,
          }
        : null,
      muc: b.muc ? { ...b.muc } : null,
    })),
    diHoc: { tieuDe: d.diHoc.tieuDe, phu: ghiTrangThaiKhongHuongDan(d.diHoc.phu), mauSo: d.diHoc.mauSo },
    coMat: d.coMat,
    tong: d.tong,
    daQua: d.daQua,
    canBuSo: [...d.canBuSo],
  };
}

export type HocBaDto = {
  tenHocVien: string;
  maHocVien: string | null;
  tenLop: string | null;
  tenKhoa: string | null;
  giaoVien: string | null;
  nhanKy: string;
  laChinhThuc: boolean;
  nhanNgayPhatHanh: string | null;
  nhanXetTongKet: string | null;
  diemTieuChi: Array<{ id: string; ten: string; muc: number; ghiChu: string | null }>;
  nhanXetGiaiDoan: Array<{ giaiDoan: string; noiDung: string }>;
  ketQua: string | null;
  /** `coMat` CHỈ có ở bản chính thức, `daDienRa` CHỈ ở bản tạm tính — ở nguồn cùng một trường `done` mang hai nghĩa khác nhau (TL11 §13.3 mục 3). */
  soBuoi: { tong: number; coMat: number | null; daDienRa: number | null; tiLe: number; vangKhongBu: number | null };
  khoaTruoc: Array<{ id: string; tenKhoa: string | null; tenLop: string | null; nhanNgayPhatHanh: string | null }>;
};

/** `null` khi học viên chưa có dữ liệu học bạ (không tồn tại giữa lúc kiểm và lúc đọc). */
export async function layHocBa(hs: MaHocVienDaKiem): Promise<HocBaDto | null> {
  const h = await getStudentReportCard(hs);
  if (!h) return null;
  return {
    tenHocVien: h.studentName,
    maHocVien: h.studentCode,
    tenLop: h.className,
    tenKhoa: h.courseName,
    giaoVien: h.teacher,
    nhanKy: h.periodLabel,
    laChinhThuc: h.isOfficial,
    nhanNgayPhatHanh: h.publishedDate ? nhanNgay(h.publishedDate) : null,
    nhanXetTongKet: h.finalComment,
    diemTieuChi: h.scores.map((s) => ({ id: s.criterionId, ten: s.name, muc: s.level, ghiChu: s.note })),
    nhanXetGiaiDoan: h.periodComments.map((p) => ({ giaiDoan: reportCardPeriodDisplay(p.period), noiDung: p.comment })),
    ketQua: h.completionStatus,
    soBuoi: {
      tong: h.total,
      coMat: h.isOfficial ? h.done : null,
      daDienRa: h.isOfficial ? null : h.done,
      tiLe: h.rate,
      vangKhongBu: h.absent,
    },
    khoaTruoc: h.olderPublished.map((o) => ({ id: o.id, tenKhoa: o.courseName, tenLop: o.className, nhanNgayPhatHanh: o.publishedDate ? nhanNgay(o.publishedDate) : null })),
  };
}
