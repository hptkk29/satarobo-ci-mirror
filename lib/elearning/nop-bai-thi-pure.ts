// Hộp xác nhận NỘP BÀI THI — phần THUẦN: câu nào chưa làm, đã trả lời bao nhiêu. Không import React/DB.
//
// ⚠️ "Đã trả lời" dùng ĐÚNG định nghĩa của thanh tiến độ ở `exam-runner.tsx` (có lựa chọn HOẶC có chữ không trắng) — hai nơi không
// được đếm khác nhau. Chỉ là thông tin hiển thị: KHÔNG chặn nộp (bỏ trống một câu là quyền của người thi, câu đó tính 0 điểm).

export type CauRut = { examQuestionId: string };

export function laDaTraLoi(
  c: CauRut,
  traLoi: Readonly<Record<string, readonly unknown[] | undefined>>,
  chuText: Readonly<Record<string, string | undefined>>,
): boolean {
  return (traLoi[c.examQuestionId]?.length ?? 0) > 0 || (chuText[c.examQuestionId]?.trim().length ?? 0) > 0;
}

/** Số thứ tự (1-based) của các câu CHƯA làm, theo thứ tự hiển thị. */
export function cauChuaLam(
  cacCau: readonly CauRut[],
  traLoi: Readonly<Record<string, readonly unknown[] | undefined>>,
  chuText: Readonly<Record<string, string | undefined>>,
): number[] {
  const ra: number[] = [];
  cacCau.forEach((c, i) => {
    if (!laDaTraLoi(c, traLoi, chuText)) ra.push(i + 1);
  });
  return ra;
}

/** Trần ký tự của một câu trả lời chữ — ĐÚNG số máy chủ chặn (`exam-taking.ts` `textAnswer: max(10_000)`). */
export const TRAN_KY_TU_CAU_CHU = 10_000;

/** Số TỪ (tách theo khoảng trắng). Chỉ để người thi tự ước độ dài — KHÔNG ảnh hưởng điểm. */
export function demTu(chu: string): number {
  const t = chu.trim();
  return t === "" ? 0 : t.split(/\s+/u).length;
}

/** Dòng đếm dưới ô trả lời: "12 từ · 80/10000 ký tự"; quá trần thì nói rõ để không gửi rồi mới biết. */
export function dongDemChu(chu: string): { chu: string; quaTran: boolean } {
  const kyTu = [...chu].length;
  const quaTran = kyTu > TRAN_KY_TU_CAU_CHU;
  return { chu: `${demTu(chu)} từ · ${kyTu}/${TRAN_KY_TU_CAU_CHU} ký tự`, quaTran };
}

/** "14:05 ngày 19/11/2026" theo giờ Việt Nam — dựng bằng `formatToParts` (định dạng `vi-VN` của Intl đổi thứ tự/đệm số theo môi trường). */
export function nhanGioMoLai(iso: string): string {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("hour")}:${g("minute")} ngày ${g("day")}/${g("month")}/${g("year")}`;
}
