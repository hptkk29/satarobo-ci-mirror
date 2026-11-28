import { z } from "zod";

/**
 * P6 · NUMERIC — câu hỏi NHẬP SỐ (`QtCau-nhapso` / `NvQ-nhapso`): đáp án là SỐ, có đơn vị (chỉ để hiển thị) và SAI SỐ ± cho phép.
 *
 * Hàm THUẦN: không DB, không đồng hồ. Máy chủ chấm bằng chính hàm này; ô nhập của người học dùng `docSo` để báo "chưa hợp lệ" ngay.
 *
 * ⚠️ KHÔNG so sánh chuỗi. "60", "60,0", "60.00", "+60" là cùng một số; "6 0", "60cm", "1.000,5" (hai kiểu dấu) thì KHÔNG đoán — trả
 * `KHONG_HOP_LE` để người học sửa, thay vì chấm sai im lặng một câu họ trả lời đúng.
 *
 * Luật đọc số (thiết kế: "Chấp nhận dấu phẩy và dấu chấm thập phân"):
 *  · chỉ chữ số, MỘT dấu thập phân (`,` hoặc `.`), dấu `-` ở đầu (số âm) hoặc `+`;
 *  · hai dấu cùng loại hay lẫn hai loại ("3.000.000", "1.000,5") ⇒ KHÔNG HỢP LỆ — không ai đoán được đó là nhóm nghìn hay thập phân;
 *  · khoảng trắng đầu/cuối được bỏ; khoảng trắng GIỮA thì không;
 *  · tối đa 15 chữ số có nghĩa (vượt là mất độ chính xác của số thực).
 */

export const MAX_CHU_SO = 15;

export type KetQuaDocSo = { ok: true; so: number } | { ok: false; lyDo: "TRONG" | "KY_TU_LA" | "NHIEU_DAU_THAP_PHAN" | "QUA_DAI" };

export function docSo(raw: string): KetQuaDocSo {
  const s = raw.trim();
  if (s === "") return { ok: false, lyDo: "TRONG" };
  const m = /^([+-]?)(\d*)([.,]?)(\d*)$/.exec(s);
  if (!m) {
    // Phân biệt "nhiều dấu thập phân" (nhiều dấu . , ) với ký tự lạ (chữ, khoảng trắng giữa, đơn vị…).
    return /^[+-]?[\d.,]+$/.test(s) && /[.,]/.test(s) ? { ok: false, lyDo: "NHIEU_DAU_THAP_PHAN" } : { ok: false, lyDo: "KY_TU_LA" };
  }
  const dau = m[1] ?? "";
  const nguyen = m[2] ?? "";
  const phan = m[4] ?? "";
  if (nguyen === "" && phan === "") return { ok: false, lyDo: "KY_TU_LA" }; // chỉ có dấu, vd "-" hoặc ","
  if ((nguyen + phan).replace(/^0+/, "").length > MAX_CHU_SO) return { ok: false, lyDo: "QUA_DAI" };
  const so = Number(`${dau === "-" ? "-" : ""}${nguyen || "0"}${phan ? "." + phan : ""}`);
  return Number.isFinite(so) ? { ok: true, so } : { ok: false, lyDo: "KY_TU_LA" };
}

export const CAU_LY_DO_KHONG_HOP_LE: Record<Extract<KetQuaDocSo, { ok: false }>["lyDo"], string> = {
  TRONG: "Chưa nhập số",
  KY_TU_LA: "Chỉ nhập chữ số, một dấu , hoặc . và dấu − ở đầu nếu là số âm (đơn vị đã có sẵn bên cạnh ô)",
  NHIEU_DAU_THAP_PHAN: "Chỉ dùng MỘT dấu , hoặc . làm dấu thập phân — không nhập dấu ngăn cách hàng nghìn",
  QUA_DAI: `Số quá dài (tối đa ${MAX_CHU_SO} chữ số)`,
};

/** Nội dung câu NHẬP SỐ lưu trong `TrnQuestion.contentJson` (khuôn RIÊNG của e-learning — không đụng hợp đồng dùng chung với site giáo viên/portal). */
export const cauSoSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z.literal("numeric"),
    question: z.string().trim().min(1, "Chưa nhập nội dung câu hỏi").max(2000),
    /** Đáp án đúng. */
    answer: z.number().finite("Đáp án phải là số"),
    /** Sai số ± cho phép (≥ 0). 0 = phải đúng chính xác. */
    tolerance: z.number().finite().min(0, "Sai số không được âm").max(1_000_000_000),
    /** Đơn vị — chỉ HIỂN THỊ cạnh ô nhập, không tham gia chấm. */
    unit: z.string().trim().max(20, "Đơn vị tối đa 20 ký tự").optional(),
    /** Gợi ý hiện cho người học sau khi trả lời SAI (chỉ ở màn xem lại, không phải lúc đang làm bài). */
    hint: z.string().trim().max(500).optional(),
  })
  .strict();

export type CauSo = z.infer<typeof cauSoSchema>;

export type KetQuaChamSo =
  | { ketQua: "DUNG"; so: number; lech: number }
  | { ketQua: "SAI"; so: number; lech: number }
  | { ketQua: "KHONG_HOP_LE"; lyDo: Extract<KetQuaDocSo, { ok: false }>["lyDo"] };

/**
 * Chấm một câu nhập số. Đúng/sai trọn vẹn (không điểm một phần). `|x − đáp án| ≤ sai số`, cộng một dung sai số thực rất nhỏ để `0.1 + 0.2` không làm hỏng
 * câu có sai số 0 — tính theo độ lớn của đáp án, không hằng số tuyệt đối.
 */
export function chamSo(cau: Pick<CauSo, "answer" | "tolerance">, traLoi: string): KetQuaChamSo {
  const r = docSo(traLoi);
  if (!r.ok) return { ketQua: "KHONG_HOP_LE", lyDo: r.lyDo };
  const lech = Math.abs(r.so - cau.answer);
  const dungSaiSoThuc = 1e-9 * Math.max(1, Math.abs(cau.answer), Math.abs(r.so));
  return { ketQua: lech <= cau.tolerance + dungSaiSoThuc ? "DUNG" : "SAI", so: r.so, lech };
}

/** Câu trả lời CHUẨN HOÁ để lưu (`TrnExamAnswer.answerJson`): số đã đọc + chuỗi gốc (để màn xem lại hiện đúng điều người học gõ). */
export function chuanHoaTraLoiSo(traLoi: string): { so: number; goc: string } | null {
  const r = docSo(traLoi);
  return r.ok ? { so: r.so, goc: traLoi.trim() } : null;
}

/** Dữ liệu câu NHẬP SỐ sau khi đọc (đã là SỐ). */
export type SoNhap = { answer: number; tolerance: number; unit?: string; hint?: string };

/** Đọc `so` (chuỗi) ra SỐ; trả lỗi tiếng Việt theo từng ô, hoặc dữ liệu hợp lệ. Dùng chung cho kiểm tra (Zod) và cho đường ghi. */
export function docSoNhap(so: { dapAn: string; saiSo: string; donVi?: string; goiY?: string }):
  | { ok: true; so: SoNhap }
  | { ok: false; loi: { truong: "dapAn" | "saiSo"; message: string } } {
  const a = docSo(so.dapAn);
  if (!a.ok) return { ok: false, loi: { truong: "dapAn", message: `Đáp án: ${CAU_LY_DO_KHONG_HOP_LE[a.lyDo]}` } };
  // Sai số bỏ trống = 0 (phải đúng chính xác) — đó là lựa chọn CÓ CHỦ Ý, không phải nhập thiếu.
  const t = so.saiSo.trim() === "" ? ({ ok: true, so: 0 } as const) : docSo(so.saiSo);
  if (!t.ok) return { ok: false, loi: { truong: "saiSo", message: `Sai số: ${CAU_LY_DO_KHONG_HOP_LE[t.lyDo]}` } };
  if (t.so < 0) return { ok: false, loi: { truong: "saiSo", message: "Sai số không được âm" } };
  return { ok: true, so: { answer: a.so, tolerance: t.so, ...(so.donVi ? { unit: so.donVi } : {}), ...(so.goiY ? { hint: so.goiY } : {}) } };
}
