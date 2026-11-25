/**
 * lib/nguon/di-tru-audit.ts — NỘI DUNG hai bản ghi AuditLog của lệnh GHI backfill quy nguồn (§20). THUẦN: không DB, không đồng hồ (`batDauLuc` do nơi gọi truyền), một import kiểu.
 *
 * ── Vì sao HAI bản ghi ───────────────────────────────────────────────────────────────────────────────────────
 * Bản BẮT ĐẦU (`DI_TRU_NGUON`) nằm TRONG transaction của lô đầu thật sự ghi được dòng — không có chuyện đã ghi mà thiếu dấu vết. Lúc đó chưa biết tổng số THỰC GHI (còn các lô sau).
 * `AuditLog` bất biến (không update), nên số thực ghi phải ở bản ghi THỨ HAI, ghi sau vòng lô, action riêng (`DI_TRU_NGUON_KET_THUC`) để việc đếm «lượt có ghi» theo action không lẫn.
 * Lượt chết giữa chừng (`DiTruDungGiuaChungError`) cũng để bản ghi kết thúc — trạng thái `DUNG_GIUA_CHUNG` — nên người đọc thấy «đã bắt đầu mà không hoàn tất» thay vì một bản ghi bắt đầu mồ côi.
 * Lượt chạy lại mà «ghi 0» KHÔNG để bản ghi nào (quyết định cũ — không audit giả); dấu vết của nó là log Actions + báo cáo markdown, không phải bảng audit.
 *
 * ── Hai thứ tên «runId» khác nhau, đừng lẫn ──────────────────────────────────────────────────────────────────
 *  · `AuditLog.entityId` = `ke-hoach:<16 ký tự đầu digest>` — khoá của KẾ HOẠCH đã duyệt; hai lượt chạy cùng kế hoạch dùng CHUNG khoá này.
 *  · `nguonChay.runId` = `GITHUB_RUN_ID` — lượt chạy GitHub Actions; `nguonChay.runAttempt` = lần chạy thứ mấy (Re-run ⇒ 2, 3…).
 * Phân biệt hai lượt cùng kế hoạch bằng (`nguonChay.runId`, `nguonChay.runAttempt`, `luotChay.batDauLuc`).
 */
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

/** Bản ghi BẮT ĐẦU — action đã tồn tại từ trước (đừng đổi tên: báo cáo/runbook/test cũ trích nó). */
export const HANH_DONG_DI_TRU_BAT_DAU = "DI_TRU_NGUON";
/** Bản ghi KẾT THÚC — action riêng. */
export const HANH_DONG_DI_TRU_KET_THUC = "DI_TRU_NGUON_KET_THUC";

export type TrangThaiKetThucDiTru = "HOAN_TAT" | "DUNG_GIUA_CHUNG";

/**
 * Dấu vết CỦA LƯỢT CHẠY, chung cho cả hai bản ghi. `cheDo`/`dryRun` ghi tường minh để người đọc audit không phải suy: bản ghi này chỉ tồn tại khi ĐÃ GHI (dry-run không bao giờ ghi DB).
 * `expectedCount` = `--expect` (N đã duyệt); `expectedReviewCount` = `--expect-review` (M).
 */
export type LuotChayDiTru = {
  cheDo: "APPLY";
  dryRun: false;
  batDauLuc: string;
  expectedCount: number;
  expectedReviewCount: number;
};

export function dungLuotChayDiTru(i: { batDauLuc: Date; soDuyet: number; soDuyetReview: number; nguonChay: NguonChayDiTru }): LuotChayDiTru {
  if (!(i.batDauLuc instanceof Date) || Number.isNaN(i.batDauLuc.getTime())) {
    throw new Error("dungLuotChayDiTru: batDauLuc phải là một mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
  }
  return {
    cheDo: "APPLY",
    dryRun: false,
    batDauLuc: i.batDauLuc.toISOString(),
    expectedCount: i.soDuyet,
    expectedReviewCount: i.soDuyetReview,
  };
}

/** `nguonChay` ra đúng BỐN khoá (kể cả null) — không để khoá lạ/thiếu lọt vào audit. */
export function saoNguonChay(n: NguonChayDiTru): NguonChayDiTru {
  return { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt };
}

/**
 * Nội dung bản ghi KẾT THÚC. `actualCount` = số `LeadAttribution` mà CHÍNH lượt này chèn (không phải số kế hoạch, không phải số dòng của lượt khác).
 * `khop` = (ghi + đã có + đã xoá) bằng `expectedCount` — cùng phép so mà script in cảnh báo; luôn `false` khi dừng giữa chừng.
 */
export function dungKetThucDiTru(i: {
  luot: LuotChayDiTru;
  nguonChay: NguonChayDiTru;
  trangThai: TrangThaiKetThucDiTru;
  ghi: number;
  daCo: number;
  daXoa: number;
  soLo: number;
  soLoKeHoach: number;
  /** Đã che SĐT/email (`moTaLoiAnToan`); null khi hoàn tất. */
  nguyenNhan: string | null;
}): Record<string, unknown> {
  return {
    trangThai: i.trangThai,
    luotChay: { ...i.luot },
    expectedCount: i.luot.expectedCount,
    actualCount: i.ghi,
    daCo: i.daCo,
    daXoa: i.daXoa,
    soLo: i.soLo,
    soLoKeHoach: i.soLoKeHoach,
    khop: i.trangThai === "HOAN_TAT" && i.ghi + i.daCo + i.daXoa === i.luot.expectedCount,
    nguyenNhan: i.nguyenNhan,
    nguonChay: saoNguonChay(i.nguonChay),
  };
}
