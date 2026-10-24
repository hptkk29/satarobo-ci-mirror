/**
 * lib/nguon/sua-nguoi-chot-audit.ts — NỘI DUNG AuditLog của lệnh GHI «sửa `Lead.convertedById` legacy». THUẦN: không DB, không đồng hồ.
 *
 * HAI loại bản ghi, cùng một transaction với phép ghi:
 *  · MỨC LEAD  (`LEGACY_CONVERTER_FIX`): cũ → mới, mã lý do `LEGACY_BACKFILL_CONVERTER_FIX`, tóm tắt bằng chứng, nonce + digest của artifact owner đã ký, lượt Actions.
 *    Đây cũng là NGUỒN để hoàn tác: mỗi bản ghi mang đủ `oldConvertedById` để dựng dòng ngược (xem `dongHoanTacTuAudit`).
 *  · MỨC LƯỢT  (`SUA_NGUOI_CHOT_LUOT_CHAY`): người dispatch · người bấm lượt này · run id · lần chạy · số đã duyệt (ghi/xem tay) · sha kế hoạch · số thực ghi.
 *
 * Khuôn theo `noi-don-audit.ts`. `nguonChay` là dấu vết để TRUY, không phải «người duyệt thứ hai».
 */
import type { NguonChayDiTru } from "./di-tru-nguon-chay";
import { MA_LY_DO_SUA, type DongKeHoach } from "./sua-nguoi-chot";

export const HANH_DONG_SUA_LEAD = "LEGACY_CONVERTER_FIX";
export const HANH_DONG_SUA_LUOT = "SUA_NGUOI_CHOT_LUOT_CHAY";
export const LOAI_THUC_THE_LUOT = "SuaNguoiChotLegacy";

export type LuotChaySua = { batDauLuc: Date; nguonChay: NguonChayDiTru };

function saoNguonChay(n: NguonChayDiTru): NguonChayDiTru {
  return { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt };
}

/** Khoá thực thể của bản ghi mức lượt: một lượt Actions (run id + lần chạy). */
export function khoaLuotChaySua(n: NguonChayDiTru): string {
  return `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;
}

export type PheDuyetTrichDan = { nonce: string; inputDigest: string; keyId: string };

/** `oldValues`/`newValues` của bản ghi MỨC LEAD. Không có tên khách / SĐT / email: chỉ id nhân viên, mã, tên gọi nhân viên trong `saleEvidence`. */
export function dungBanGhiLead(d: DongKeHoach, pd: PheDuyetTrichDan, runRef: string): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  return {
    oldValues: { convertedById: d.oldConvertedById },
    newValues: {
      convertedById: d.newConvertedById,
      reasonCode: MA_LY_DO_SUA,
      dongLoai: d.loai,
      dongLyDo: d.reasonCode,
      evidenceClass: d.evidenceClass,
      confidence: d.confidence,
      saleEvidence: d.saleEvidence,
      campusCheck: d.campusCheck,
      sourceActor: d.sourceActor,
      approvalNonce: pd.nonce,
      approvalDigest: pd.inputDigest,
      approvalKeyId: pd.keyId,
      runRef,
    },
  };
}

export function dungBanGhiLuotSua(i: {
  luot: LuotChaySua;
  soDuyet: number;
  soDuyetXemTay: number;
  keHoachSha: string;
  daGhi: number;
  daDoi: number;
  daXoa: number;
  nonce: string;
}): Record<string, unknown> {
  const { luot } = i;
  if (!(luot.batDauLuc instanceof Date) || Number.isNaN(luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotSua: batDauLuc phải là một mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
  }
  return {
    cheDo: "APPLY",
    dryRun: false,
    reasonCode: MA_LY_DO_SUA,
    batDauLuc: luot.batDauLuc.toISOString(),
    expectedCount: i.soDuyet,
    expectedReview: i.soDuyetXemTay,
    keHoachSha: i.keHoachSha,
    actualCount: i.daGhi,
    reassigned: i.daDoi,
    clearedToReview: i.daXoa,
    khop: i.daGhi === i.soDuyet,
    approvalNonce: i.nonce,
    nguonChay: saoNguonChay(luot.nguonChay),
  };
}

export type BanGhiLeadDocLai = { entityId: string; oldValues: unknown; newValues: unknown };

/**
 * HOÀN TÁC (chỉ DỰNG dòng, không ghi): từ các bản ghi audit mức lead đã đọc lại, dựng dòng ngược `leadId|mới→cũ`. Một lần hoàn tác thật phải chạy
 * qua CHÍNH lõi này dưới một tên workflow riêng đã ký — chưa làm ở đợt này (xem tài liệu 16 §Hoàn tác). Bản ghi nào thiếu `oldValues`/`newValues`
 * thì BỎ và đếm vào `hong`, không đoán.
 */
export function dongHoanTacTuAudit(rows: readonly BanGhiLeadDocLai[]): { dong: { leadId: string; hienTaiMongDoi: string | null; hoanVe: string | null }[]; hong: number } {
  const dong: { leadId: string; hienTaiMongDoi: string | null; hoanVe: string | null }[] = [];
  let hong = 0;
  for (const r of rows) {
    const o = r.oldValues as { convertedById?: unknown } | null;
    const n = r.newValues as { convertedById?: unknown; reasonCode?: unknown } | null;
    const cu = o?.convertedById;
    const moi = n?.convertedById;
    const hopLe = (v: unknown): v is string | null => v === null || typeof v === "string";
    if (o === null || n === null || n.reasonCode !== MA_LY_DO_SUA || !hopLe(cu) || !hopLe(moi)) {
      hong++;
      continue;
    }
    dong.push({ leadId: r.entityId, hienTaiMongDoi: moi, hoanVe: cu });
  }
  dong.sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0));
  return { dong, hong };
}
