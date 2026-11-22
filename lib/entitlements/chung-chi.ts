// lib/entitlements/chung-chi.ts — ĐIỀU KIỆN CẤP CHỨNG CHỈ THEO LOẠI MUA (QĐ-50). THUẦN.
//
// · Gói trọn (FULL) hoàn tất khoá ⇒ chứng chỉ như hôm nay.
// · Gói 12/24/36/lẻ ⇒ chứng chỉ ghi PHẠM VI, và chỉ cấp khi QUẢN LÝ ĐÃ DUYỆT.
// Fail-closed: thiếu một điều kiện là KHÔNG cấp.

export type LoaiMuaChungChi = "FULL" | "MILESTONE" | "CUSTOM";

export function chungChiCanQuanLyDuyet(loai: LoaiMuaChungChi): boolean {
  return loai !== "FULL";
}

export interface DauVaoChungChi {
  readonly loai: LoaiMuaChungChi;
  /** Đã học xong mọi bài trong phạm vi đã mua. */
  readonly hoanTatPhamVi: boolean;
  readonly quanLyDaDuyet: boolean;
}

export type KetQuaChungChi =
  | { readonly duoc: true }
  | { readonly duoc: false; readonly lyDo: "CHUA_HOAN_TAT" | "CHUA_DUOC_DUYET" };

export function xetChungChi(vao: DauVaoChungChi): KetQuaChungChi {
  if (!vao.hoanTatPhamVi) return { duoc: false, lyDo: "CHUA_HOAN_TAT" };
  if (chungChiCanQuanLyDuyet(vao.loai) && !vao.quanLyDaDuyet) return { duoc: false, lyDo: "CHUA_DUOC_DUYET" };
  return { duoc: true };
}
