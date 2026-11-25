// lib/finance/hoa-don/ket-noi/khoa-bi-mat.ts — NƠI DUY NHẤT đọc khoá gốc của hộp bí mật từ môi trường (hub/13 §3.2).
//   HOA_DON_KHOA_BI_MAT     khoá HIỆN HÀNH (≥ 32 ký tự) — dùng để mã hoá mới và giải mã
//   HOA_DON_KHOA_BI_MAT_CU  khoá CŨ (tuỳ chọn) — chỉ để giải mã trong lúc xoay khoá
// Thiếu / ngắn ⇒ KHÔNG lưu được mật khẩu (fail-closed), không bao giờ rơi về lưu thô. Không log giá trị khoá.

import { DO_DAI_KHOA_GOC_TOI_THIEU } from "@/lib/security/hop-bi-mat";

export const MUC_DICH_KET_NOI = "hoa-don.ket-noi" as const;
export const nguCanhKetNoi = (id: string): string => `ketnoi:${id}`;

export type KhoaBiMat = { ok: true; hienHanh: string; cacKhoa: string[] } | { ok: false; lyDo: string };

export function docKhoaBiMat(env: Record<string, string | undefined> = process.env): KhoaBiMat {
  const hienHanh = env["HOA_DON_KHOA_BI_MAT"] ?? "";
  if (hienHanh.length < DO_DAI_KHOA_GOC_TOI_THIEU) {
    return { ok: false, lyDo: `Máy chủ chưa đặt khoá mã hoá bí mật (HOA_DON_KHOA_BI_MAT, tối thiểu ${DO_DAI_KHOA_GOC_TOI_THIEU} ký tự) — chưa lưu được mật khẩu.` };
  }
  const cu = env["HOA_DON_KHOA_BI_MAT_CU"] ?? "";
  // Khoá cũ ngắn/hỏng ⇒ bỏ qua (không làm hỏng khoá hiện hành); chuỗi nào cần nó sẽ báo KHONG_CO_KHOA.
  const cacKhoa = cu.length >= DO_DAI_KHOA_GOC_TOI_THIEU && cu !== hienHanh ? [hienHanh, cu] : [hienHanh];
  return { ok: true, hienHanh, cacKhoa };
}
