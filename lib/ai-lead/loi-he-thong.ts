// lib/ai-lead/loi-he-thong.ts — PHÂN LOẠI lỗi hạ tầng của cổng AI Lead. THUẦN. Dùng chung bởi xac-thuc / dịch vụ / cron / thông báo.
//
// ⚠️ Chỉ trả MÃ (Prisma `Pxxxx` hoặc tên lớp lỗi) — KHÔNG BAO GIỜ trả `message`: lỗi Prisma có thể kèm giá trị cột (SĐT, tên) và log không được chứa chúng.

/** Mã Prisma báo hạ tầng tạm thời (mất kết nối · hết pool · hết hạn giao dịch · xung đột tuần tự) ⇒ 503 `TEMP_UNAVAILABLE`, KHÔNG phải 500. */
// `ChayLaiGiaoDich` (tên lớp, không phải mã Prisma): đã thử lại tối đa số lần cho phép mà hồ sơ vẫn bị nhân viên sửa liên tục — tạm thời, Agent thử lại sau, không phải lỗi 500.
const MA_PRISMA_TAM_THOI: ReadonlySet<string> = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034", "ChayLaiGiaoDich"]);

export function maLoiNoiBo(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^P\d{4}$/.test(code)) return code;
  return err instanceof Error ? err.name : "KhongRo";
}

export function laLoiTamThoi(err: unknown): boolean {
  return MA_PRISMA_TAM_THOI.has(maLoiNoiBo(err));
}
