/**
 * lib/nguon/wave-c-chung.ts — phần DÙNG CHUNG của ba lệnh ghi PHASE C (C-A danh tính · C-B giá · C-C khoản thu), 26/10/2026.
 *
 * Chỉ chứa thứ KHÔNG mang nghiệp vụ: digest dòng ký, bộ phân tích `--expect=` chặt, khoá lượt chạy, khuôn cổng số duyệt, bản ghi audit mức lượt.
 * Mỗi lệnh có lõi quyết định + tầng DB + script + workflow + artifact RIÊNG (3 `plan SHA`, 3 chữ ký owner, 3 identity) — tệp này chỉ để ba lệnh KHÔNG chép tay cùng một đoạn
 * theo ba cách hơi khác nhau (lớp lỗi «sửa một bản quên hai bản»).
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { createHash } from "node:crypto";
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

/** sha256 của các dòng owner ký (nối bằng «\n») — CÙNG công thức với `kiemPheDuyetChoRows` (digest tính lại ở cổng). */
export const shaDongWaveC = (dong: readonly string[]) => createHash("sha256").update(dong.join("\n"), "utf8").digest("hex");

/** `--expect=` chặt: chỉ chữ số thập phân thuần; sai khuôn ⇒ `NaN` (KHÔNG `Number()`: '' / 0x2 / 1e1 không được thành số). Không truyền ⇒ `null`. */
export function phanTichSoDuyetWaveC(argv: readonly string[]): number | null {
  const a = argv.find((x) => x.startsWith("--expect="));
  if (a === undefined) return null;
  const raw = a.slice("--expect=".length);
  if (!/^[0-9]+$/.test(raw)) return Number.NaN;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

export type LuotChayWaveC = { batDauLuc: Date; nguonChay: NguonChayDiTru };

export const khoaLuotChayWaveC = (n: NguonChayDiTru) => `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;

/**
 * Cổng số duyệt `--expect=<N>` dùng chung. `null` nếu qua; ngược lại câu lỗi.
 * Thứ tự kiểm = thứ tự của PHASE A/B (thiếu số → sai khuôn → kế hoạch dừng → thiếu quyền ghi → lệch số).
 */
export function quyetDinhGhiWaveC(i: {
  soDuyet: number | null;
  /** Kế hoạch đang DỪNG (có lỗi) — kèm danh sách `mã:lỗi` để in. */
  dung: boolean;
  loiTomTat: readonly string[];
  /** Số dòng kế hoạch SẼ GHI. */
  soGhi: number;
  /** `has_table_privilege(...,'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  /** Tên bảng để nói thiếu quyền. */
  tenBang: string;
  /** Đơn vị đếm để nói thiếu `--expect` (đơn · ghi danh · khoản). */
  donViDem: string;
}): string | null {
  if (i.soDuyet === null) return `--ghi đòi --expect=<N> (số ${i.donViDem} SẼ GHI của lượt chạy thử đã được duyệt).`;
  if (Number.isNaN(i.soDuyet)) return "--expect phải là số nguyên không dấu (chỉ chữ số thập phân).";
  if (i.dung) return `Kế hoạch DỪNG (${i.loiTomTat.length} lỗi) — không ghi gì: ${i.loiTomTat.join(" · ")}`;
  if (i.ghiDuoc !== true) return i.ghiDuoc === false ? `User kết nối không có quyền UPDATE trên ${i.tenBang} — không ghi.` : `Không kiểm được quyền UPDATE trên ${i.tenBang} — không ghi.`;
  if (i.soDuyet !== i.soGhi) return `Số duyệt ${i.soDuyet} ≠ kế hoạch lúc chạy ${i.soGhi} — không ghi.`;
  return null;
}

/** Bản ghi audit MỨC LƯỢT CHẠY (khuôn `dungBanGhiLuot*` của PHASE A/B): người bấm · số đã duyệt · số thực ghi. `chiTiet` do từng lệnh khai. */
export function dungBanGhiLuotWaveC(i: {
  luot: LuotChayWaveC;
  soDuyet: number;
  soKeHoach: number;
  daGhi: number;
  keHoachSha: string;
  chiTiet: Record<string, unknown>;
}): Record<string, unknown> {
  if (!(i.luot.batDauLuc instanceof Date) || Number.isNaN(i.luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotWaveC: batDauLuc phải là mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
  }
  const n = i.luot.nguonChay;
  return {
    cheDo: "APPLY",
    dryRun: false,
    batDauLuc: i.luot.batDauLuc.toISOString(),
    expectedCount: i.soDuyet,
    soKeHoach: i.soKeHoach,
    actualCount: i.daGhi,
    khop: i.daGhi === i.soDuyet,
    keHoachSha: i.keHoachSha,
    ...i.chiTiet,
    nguonChay: { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt },
  };
}

/** `metadata.courseId` của dòng đơn; không có / không phải chuỗi ⇒ `null`. */
export function docKhoaTrenDongWaveC(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).courseId;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** `metadata.leadChildId` của dòng đơn; không có / không phải chuỗi ⇒ `null`. */
export function docBeTrenDongWaveC(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).leadChildId;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
