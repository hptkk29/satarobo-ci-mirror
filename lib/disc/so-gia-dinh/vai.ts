/**
 * VAI TRONG NHÀ — bản KHÔNG phụ thuộc engine, dùng được ở client (lưới [ENG-P09]: file 'use client' không được import engine-goc).
 *
 * Thứ tự `VAI_GIA_DINH` là CỐ ĐỊNH VĨNH VIỄN (chỉ số được lưu ở `DiscThanhVien.vaiTro`; vai mới thêm vào CUỐI). Bản này là
 * SAO của `lib/disc/engine-goc/config/disc-gia-dinh.ts`; `vai.test.ts` [SG-VAI-01] khẳng định hai bản giống hệt nhau —
 * lệch là test đỏ, không phải bug câm.
 */
export const VAI_GIA_DINH = ["con", "me", "bo", "ba", "ong", "anh-chi-em", "nguoi-than", "khac"] as const;
export type VaiGiaDinh = (typeof VAI_GIA_DINH)[number];

export const CHU_VAI: Readonly<Record<VaiGiaDinh, string>> = {
  con: "Con",
  me: "Mẹ",
  bo: "Bố",
  ba: "Bà",
  ong: "Ông",
  "anh-chi-em": "Anh / chị / em",
  "nguoi-than": "Người thân",
  khac: "Khác",
};

/** Vai còn đang đi học ⇒ mới hỏi lớp. */
export function coHoiLop(vai: VaiGiaDinh): boolean {
  return vai === "con" || vai === "anh-chi-em";
}

/** Trẻ em? — vai «con» hoặc có lớp (đoán sai thì lệch về phía coi là người lớn; chủ ý của engine). */
export function laTreEm(vaiTro: string, lop?: string | null): boolean {
  return vaiTro === "con" || Boolean(lop);
}

export const LOP_MAM_NON = "mam-non";
export const LOP_TREN_12 = "tren-12";

/** Số lớp 1–12 của một giá trị `lop`; mầm non / trên 12 / rác ⇒ undefined. */
export function soLopCua(lop: string | null | undefined): number | undefined {
  if (lop === null || lop === undefined || lop === LOP_MAM_NON || lop === LOP_TREN_12) return undefined;
  const so = Number(lop);
  return Number.isInteger(so) && so >= 1 && so <= 12 ? so : undefined;
}
