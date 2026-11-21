import { so1 } from "@/lib/portal/nhan-xet-thuan";

// Cổng phụ huynh — phần THUẦN của màn "Bài tập & bài thi" (artifact Bai-tap.dc.html).

export type TrangThaiBai = "chua-nop" | "cho-cham" | "da-cham" | "qua-han";

export const NHAN_BAI: Record<TrangThaiBai, string> = {
  "chua-nop": "Con chưa nộp",
  "cho-cham": "Chờ thầy cô chấm",
  "da-cham": "Đã chấm",
  "qua-han": "Quá hạn chưa nộp",
};

/** `status` gộp cả hai nguồn: Assignment (NOT_SUBMITTED/SUBMITTED/LATE/GRADED) và HomeworkAssignment (ASSIGNED/SUBMITTED/GRADED/MISSED). */
export function trangThaiBai(i: { status: string; dueISO: string | null; now: Date }): TrangThaiBai {
  if (i.status === "GRADED") return "da-cham";
  if (i.status === "SUBMITTED" || i.status === "LATE") return "cho-cham";
  if (i.status === "MISSED") return "qua-han";
  if (i.dueISO && new Date(i.dueISO).getTime() < i.now.getTime()) return "qua-han";
  return "chua-nop";
}

export type BaiVe = {
  id: string;
  tieuDe: string;
  /** `Buổi 7` / `Bài trên lớp` — nhãn phụ. */
  nhanPhu: string;
  trangThai: TrangThaiBai;
  hanISO: string | null;
  nopISO: string | null;
  diem: { diem: number; toiDa: number } | null;
  loiThay: string | null;
};

/** Điểm quy về thang 10, chỉ tính bài ĐÃ CHẤM có điểm và tối đa > 0 (không bịa điểm 0 cho bài chưa chấm). */
export function diemTrungBinh(bai: BaiVe[]): { tb: number; chu: string; soBai: number } | null {
  const co = bai.filter((b) => b.trangThai === "da-cham" && b.diem && b.diem.toiDa > 0);
  if (co.length === 0) return null;
  const tb = co.reduce((s, b) => s + ((b.diem as { diem: number; toiDa: number }).diem / (b.diem as { diem: number; toiDa: number }).toiDa) * 10, 0) / co.length;
  return { tb, chu: so1(tb), soBai: co.length };
}

export function tomTatBai(bai: BaiVe[]) {
  const daNop = bai.filter((b) => b.trangThai === "cho-cham" || b.trangThai === "da-cham").length;
  return {
    giao: bai.length,
    daNop,
    canLam: bai.filter((b) => b.trangThai === "chua-nop" || b.trangThai === "qua-han"),
    daNopDs: bai.filter((b) => b.trangThai === "cho-cham" || b.trangThai === "da-cham"),
    diem: diemTrungBinh(bai),
  };
}

export type BaiThi = {
  id: string;
  tieuDe: string;
  moISO: string | null;
  dongISO: string | null;
  phut: number;
  daThi: boolean;
  diem: number | null;
};

export type KieuThi = "dang-mo" | "sap-mo" | "da-thi" | "het-han";

export function kieuBaiThi(t: BaiThi, now: Date): KieuThi {
  if (t.daThi) return "da-thi";
  const t0 = now.getTime();
  if (t.moISO && new Date(t.moISO).getTime() > t0) return "sap-mo";
  if (t.dongISO && new Date(t.dongISO).getTime() < t0) return "het-han";
  return "dang-mo";
}

/** Bài thi kế tiếp: đang mở trước, rồi sắp mở gần nhất. Không có ⇒ null. */
export function thiKeTiep(ds: BaiThi[], now: Date): BaiThi | null {
  const mo = ds.filter((t) => kieuBaiThi(t, now) === "dang-mo");
  if (mo.length) return mo[0] ?? null;
  const sap = ds
    .filter((t) => kieuBaiThi(t, now) === "sap-mo")
    .sort((a, b) => new Date(a.moISO as string).getTime() - new Date(b.moISO as string).getTime());
  return sap[0] ?? null;
}
