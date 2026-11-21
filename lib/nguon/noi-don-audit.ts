/**
 * lib/nguon/noi-don-audit.ts — NỘI DUNG bản ghi AuditLog MỨC LƯỢT CHẠY của lệnh GHI «nối đơn ↔ lead» (D8). THUẦN: không DB, không đồng hồ (`batDauLuc` do nơi gọi truyền), một import kiểu.
 *
 * ── Vì sao có bản ghi này khi đã có `NOI_LEAD` theo từng đơn ────────────────────────────────────────────────
 * `NOI_LEAD` (từng đơn) nói «đơn X đổi leadId từ null sang L» nhưng actor cố định là «Script nối đơn…» (`id: null`) — không nói AI bấm, lượt chạy NÀO, số người duyệt là bao nhiêu và
 * thực ghi bao nhiêu. Mà `Order.leadId` quyết định NGƯỜI NHẬN hoa hồng của mọi khoản thu của đơn ⇒ đây là phép ghi đổi tiền của người khác, phải truy được tới một lượt chạy GitHub Actions.
 * Khuôn theo `di-tru-audit.ts` (backfill quy nguồn): cùng `nguonChay` (4 biến mặc định của runner), cùng `batDauLuc`/`cheDo`/`dryRun`/`expectedCount`/`actualCount`.
 *
 * ── MỘT bản ghi, không hai ──────────────────────────────────────────────────────────────────────────────────
 * Backfill quy nguồn chia lô (nhiều transaction) nên cần bản BẮT ĐẦU + bản KẾT THÚC. Nối đơn chạy TRONG MỘT transaction duy nhất ([CHỌN Ở 07] — không chia lô): hoặc cả lượt commit, hoặc không gì cả.
 * Bản ghi nằm TRONG transaction đó, sau vòng ghi (đã biết `actualCount`): có phép ghi thì có dấu vết, lùi thì cả dấu vết lùi theo — không có «bản bắt đầu mồ côi». Chạy thử không bao giờ ghi DB
 * (transaction READ ONLY rồi `throw`) nên không để bản ghi nào.
 *
 * `nguonChay` là dấu vết để TRUY (người dispatch lần đầu · người bấm lượt này · run id · lần chạy), KHÔNG phải «người duyệt thứ hai»: chuỗi xác nhận và `--expect` do CÙNG một người tự khai.
 * Người duyệt thứ hai là việc của môi trường GitHub (`environment:` + reviewer bắt buộc) — xem `08-nguon-dong.md` §11.
 */
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

/** Action của bản ghi mức lượt chạy — riêng, để đếm «lượt có ghi» không lẫn với `NOI_LEAD` theo từng đơn. */
export const HANH_DONG_NOI_DON_LUOT = "NOI_LEAD_LUOT_CHAY";

/** Lượt chạy: lúc bắt đầu (nơi gọi đọc đồng hồ, lõi không đọc) + ai/lượt Actions nào kích hoạt. BẮT BUỘC khai (luật 7). */
export type LuotChayNoiDon = {
  batDauLuc: Date;
  nguonChay: NguonChayDiTru;
};

/** `nguonChay` ra đúng BỐN khoá (kể cả null) — không để khoá lạ/thiếu lọt vào audit. */
function saoNguonChay(n: NguonChayDiTru): NguonChayDiTru {
  return { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt };
}

/** Khoá thực thể của bản ghi: một lượt Actions (run id + lần chạy). Ngoài Actions (máy dev/test) không có run id ⇒ `khong-co-run`. */
export function khoaLuotChayNoiDon(n: NguonChayDiTru): string {
  return `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;
}

/**
 * Nội dung bản ghi. `cheDo`/`dryRun` ghi tường minh để người đọc audit không phải suy: bản ghi này chỉ tồn tại khi ĐÃ GHI.
 * `expectedCount` = `--expect` (N đã duyệt); `actualCount` = số đơn CHÍNH lượt này nối được (`updateMany` đổi đúng 1 dòng); `boQua` = đơn bị người khác gắn tay `leadId` giữa chừng (FIX-H9).
 * `khop` = (nối + bỏ qua) bằng N — cùng phép so mà cổng `quyetDinhGhiNoiDon` đã đòi trước khi ghi.
 */
export function dungBanGhiLuotNoiDon(i: {
  luot: LuotChayNoiDon;
  soDuyet: number;
  soKeHoach: number;
  daNoi: number;
  boQua: number;
}): Record<string, unknown> {
  const { luot } = i;
  if (!(luot.batDauLuc instanceof Date) || Number.isNaN(luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotNoiDon: batDauLuc phải là một mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
  }
  return {
    cheDo: "APPLY",
    dryRun: false,
    batDauLuc: luot.batDauLuc.toISOString(),
    expectedCount: i.soDuyet,
    soKeHoach: i.soKeHoach,
    actualCount: i.daNoi,
    boQua: i.boQua,
    khop: i.daNoi + i.boQua === i.soDuyet,
    nguonChay: saoNguonChay(luot.nguonChay),
  };
}
