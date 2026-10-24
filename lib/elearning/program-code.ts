/**
 * EL-08 — SINH MÃ CHƯƠNG TRÌNH: `SR.DT.[CN].[NĂM].[STT]`.
 *
 * ⚠️ Đoạn `[CB]` (bậc công việc) ĐÃ BỎ khỏi mã (C6). Lý do: §8.3(a) định nghĩa
 * L5 = "nhân sự < 60 ngày, CTV, thực tập" — tức một GIAI ĐOẠN, không phải một
 * bậc. Nó nay tách thành `stageTag` riêng, nên nhét vào mã là ghi cứng một phân
 * loại đã đổi nghĩa vào thứ không sửa lại được: mã đã in ra giấy.
 *
 * ⚠️ `[STT]` KHÔNG suy được từ phía client. Nó là số thứ tự trong (chức năng ×
 * năm) và phải sinh dưới khoá `@@unique([primaryFunctionTag, year, seq])` — hai
 * người bấm Tạo cùng lúc thì một người phải va khoá và thử lại, chứ không được
 * cùng đọc "hiện có 3" rồi cùng ghi số 4.
 */

export type FunctionTag =
  | "SALE"
  | "TEACHING"
  | "MARKETING"
  | "HR"
  | "ACCOUNTING"
  | "OPERATION"
  | "COMPANY_WIDE";

/**
 * Mã hai/ba ký tự cho phần `[CN]`.
 *
 * Viết tắt CỐ ĐỊNH, không suy từ tên enum: đổi tên giá trị enum sau này (việc
 * bình thường) sẽ đổi luôn mã của những chương trình ĐÃ IN RA nếu suy động.
 */
const MA_CHUC_NANG: Record<FunctionTag, string> = {
  SALE: "KD",
  TEACHING: "GD",
  MARKETING: "MK",
  HR: "NS",
  ACCOUNTING: "KT",
  OPERATION: "VH",
  COMPANY_WIDE: "CT",
};

export function maChucNang(tag: FunctionTag): string {
  return MA_CHUC_NANG[tag];
}

export function dungMaChuongTrinh(input: {
  primaryFunctionTag: FunctionTag;
  year: number;
  seq: number;
}): string {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2999) {
    throw new Error(`Năm không hợp lệ: ${input.year}`);
  }
  if (!Number.isInteger(input.seq) || input.seq < 1) {
    throw new Error(`Số thứ tự không hợp lệ: ${input.seq}`);
  }
  // Đệm 3 chữ số: sắp xếp theo chuỗi mới ra đúng thứ tự (001 < 010 < 100). Không
  // đệm thì "10" đứng trước "2" trong mọi danh sách sắp theo mã.
  const stt = String(input.seq).padStart(3, "0");
  return `SR.DT.${maChucNang(input.primaryFunctionTag)}.${input.year}.${stt}`;
}

/** Đọc ngược mã ra các phần — dùng khi đối chiếu dữ liệu nhập từ ngoài. */
export function tachMaChuongTrinh(
  ma: string,
): { chucNang: string; year: number; seq: number } | null {
  const m = /^SR\.DT\.([A-Z]{2,3})\.(\d{4})\.(\d{3,})$/.exec(ma.trim());
  if (!m) return null;
  return { chucNang: m[1]!, year: Number(m[2]), seq: Number(m[3]) };
}

/**
 * Luật §8.1 — chương trình phải gắn phiếu nhu cầu ĐÃ DUYỆT, hoặc nêu lý do miễn.
 *
 * ⚠️ Không được để trống CẢ HAI, và cũng không nên có CẢ HAI: có phiếu rồi mà
 * vẫn ghi lý do miễn thì người đọc sau không biết cái nào là sự thật.
 *
 * ⚠️ Phiếu ở trạng thái `NEW` KHÔNG tính. Chấp nhận phiếu chưa duyệt là biến câu
 * "phải có phiếu ĐÃ DUYỆT" thành "phải có ai đó đã gõ một cái phiếu".
 */
export type KetQuaKiemNhuCau =
  | { ok: true }
  | { ok: false; code: "NEED_REQUIRED" | "NEED_NOT_APPROVED" | "NEED_AND_EXEMPT" };

export function kiemGanPhieuNhuCau(input: {
  needId: string | null;
  needStatus: "NEW" | "APPROVED" | null;
  needExemptReason: string | null;
}): KetQuaKiemNhuCau {
  const coLyDo = Boolean(input.needExemptReason?.trim());

  if (input.needId && coLyDo) return { ok: false, code: "NEED_AND_EXEMPT" };
  if (!input.needId && !coLyDo) return { ok: false, code: "NEED_REQUIRED" };
  if (input.needId && input.needStatus !== "APPROVED") {
    return { ok: false, code: "NEED_NOT_APPROVED" };
  }
  return { ok: true };
}

export const THONG_BAO_NHU_CAU: Record<
  Exclude<KetQuaKiemNhuCau, { ok: true }>["code"],
  string
> = {
  NEED_REQUIRED:
    "Chương trình phải gắn phiếu nhu cầu đã duyệt — hoặc ghi lý do miễn phiếu",
  NEED_NOT_APPROVED: "Phiếu nhu cầu chưa được duyệt",
  NEED_AND_EXEMPT:
    "Đã gắn phiếu nhu cầu thì bỏ lý do miễn — giữ cả hai làm người đọc sau không biết cái nào đúng",
};
