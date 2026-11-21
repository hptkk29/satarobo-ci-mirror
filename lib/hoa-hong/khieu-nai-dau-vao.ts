// lib/hoa-hong/khieu-nai-dau-vao.ts — KIỂM ĐẦU VÀO của khiếu nại (tạo · quyết định). THUẦN — không DB, không đồng hồ.
//
// Nguồn: docs/source-commission/04 §15, 05 AC-DSP-02d / AC-DSP-05c, 06 §5.5.
//
// Client và Server Action dùng CHUNG một bộ kiểm (client để chỉ lỗi cạnh ô, server để không tin client): hai bộ kiểm riêng là hai luật.
// Lỗi trả theo TỪNG Ô (`truong`) — màn hiện cạnh ô và cuộn tới ô lỗi đầu, không một câu chung ở đầu form.
//
// Bằng chứng: CHỈ nhận mục ghi chú `{ ghiChu }` ở lượt này. Mục dạng tệp (`fileKey` · `fileUrl`) bị TỪ CHỐI — không nhận lặng lẽ: đường tải
// tệp cho người chỉ có `commission:view-self` cần mở `/api/admin/upload-url` (quyết định bảo mật của chủ dự án), và một `fileUrl` do client khai
// sẽ được vẽ thành liên kết ở màn duyệt. Cột `evidence` là JSON nên thêm dạng tệp sau này không cần migration.
import { z } from "zod";

import { LY_DO_TOI_THIEU } from "./kieu";
import { dinhDangDong } from "./vi-sao";

export const LY_DO_KHIEU_NAI_TOI_DA = 2000;
export const SO_BANG_CHUNG_TOI_DA = 5;
/** Trần một dòng điều chỉnh tay (đồng): chặn gõ nhầm thừa số 0 — không phải ngưỡng nghiệp vụ. */
export const SO_TIEN_TOI_DA = 1_000_000_000;

export type LoiTruong = { truong: string; thongBao: string };
export type KetQuaKiem<T> = { ok: true; value: T } | { ok: false; loi: LoiTruong[] };

export type DichKhieuNai = { loai: "DONG" | "KHOAN"; id: string };
export type MucBangChung = { ghiChu: string };
export type DauVaoTao = { dich: DichKhieuNai; lyDo: string; bangChung: MucBangChung[] };

export type DauVaoQuyet =
  | { loai: "TU_CHOI"; lyDo: string }
  | { loai: "DUYET_DOI_NGUON"; lyDo: string }
  | { loai: "DUYET_TIEN"; lyDo: string; soTien: number; mauDongId: string | null; roleCode: string | null };

const chuoi = z.string();

function lyDoHopLe(x: unknown): { ok: true; v: string } | { ok: false } {
  const p = chuoi.safeParse(x);
  if (!p.success) return { ok: false };
  const v = p.data.trim();
  return v.length >= LY_DO_TOI_THIEU && v.length <= LY_DO_KHIEU_NAI_TOI_DA ? { ok: true, v } : { ok: false };
}

const THONG_BAO_LY_DO = `Nêu lý do (từ ${LY_DO_TOI_THIEU} đến ${LY_DO_KHIEU_NAI_TOI_DA} ký tự).`;

export function kiemDauVaoTao(raw: unknown): KetQuaKiem<DauVaoTao> {
  const loi: LoiTruong[] = [];
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // đích
  const dichTho = o.dich !== null && typeof o.dich === "object" ? (o.dich as Record<string, unknown>) : null;
  const dichId = dichTho && typeof dichTho.id === "string" ? dichTho.id.trim() : "";
  const dichLoai = dichTho?.loai;
  const dich: DichKhieuNai | null =
    dichTho && (dichLoai === "DONG" || dichLoai === "KHOAN") && dichId.length > 0 && dichId.length <= 64 ? { loai: dichLoai, id: dichId } : null;
  if (!dich) loi.push({ truong: "dich", thongBao: "Chọn dòng hoa hồng hoặc khoản thu cần khiếu nại." });

  // lý do
  const ly = lyDoHopLe(o.lyDo);
  if (!ly.ok) loi.push({ truong: "lyDo", thongBao: THONG_BAO_LY_DO });

  // bằng chứng
  const bc = Array.isArray(o.bangChung) ? o.bangChung : [];
  const muc: MucBangChung[] = [];
  let bcSai = bc.length === 0 || bc.length > SO_BANG_CHUNG_TOI_DA;
  for (const m of bc) {
    const t = m !== null && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
    // Đúng MỘT khoá `ghiChu`: mục mang thêm khoá khác (fileUrl, fileKey…) bị từ chối, không bị lột bớt rồi nhận.
    if (!t || Object.keys(t).length !== 1 || typeof t.ghiChu !== "string") {
      bcSai = true;
      continue;
    }
    const g = t.ghiChu.trim();
    if (g.length < LY_DO_TOI_THIEU || g.length > LY_DO_KHIEU_NAI_TOI_DA) bcSai = true;
    else muc.push({ ghiChu: g });
  }
  if (bcSai) {
    loi.push({
      truong: "bangChung",
      thongBao: `Ghi ít nhất một bằng chứng (căn cứ cụ thể, từ ${LY_DO_TOI_THIEU} ký tự), tối đa ${SO_BANG_CHUNG_TOI_DA} mục.`,
    });
  }

  if (loi.length > 0 || !dich || !ly.ok) return { ok: false, loi };
  return { ok: true, value: { dich, lyDo: ly.v, bangChung: muc } };
}

export function kiemDauVaoQuyet(raw: unknown): KetQuaKiem<DauVaoQuyet> {
  const o = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const loai = o.loai;
  if (loai !== "TU_CHOI" && loai !== "DUYET_DOI_NGUON" && loai !== "DUYET_TIEN") {
    return { ok: false, loi: [{ truong: "loai", thongBao: "Chọn cách giải quyết khiếu nại." }] };
  }
  const loi: LoiTruong[] = [];
  const ly = lyDoHopLe(o.lyDo);
  if (!ly.ok) loi.push({ truong: "lyDo", thongBao: THONG_BAO_LY_DO });

  if (loai !== "DUYET_TIEN") {
    if (loi.length > 0 || !ly.ok) return { ok: false, loi };
    return { ok: true, value: { loai, lyDo: ly.v } };
  }

  const st = o.soTien;
  const soTienHopLe = typeof st === "number" && Number.isInteger(st) && st !== 0 && Math.abs(st) <= SO_TIEN_TOI_DA;
  if (!soTienHopLe) {
    loi.push({ truong: "soTien", thongBao: `Nhập số tiền điều chỉnh khác 0 (đồng, số nguyên, tối đa ${dinhDangDong(SO_TIEN_TOI_DA)}). Số âm = đòi lại.` });
  }
  const tuyChon = (x: unknown): string | null => (typeof x === "string" && x.trim().length > 0 && x.trim().length <= 64 ? x.trim() : null);
  if (loi.length > 0 || !ly.ok || typeof st !== "number") return { ok: false, loi };
  return { ok: true, value: { loai, lyDo: ly.v, soTien: st, mauDongId: tuyChon(o.mauDongId), roleCode: tuyChon(o.roleCode) } };
}
