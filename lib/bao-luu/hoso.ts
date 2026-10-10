// lib/bao-luu/hoso.ts — LUẬT lập / duyệt hồ sơ bảo lưu. THUẦN, không DB.
//
// Mỗi hàm trả LỜI TRẢ LỜI + LÝ DO bằng tiếng Việt, và THU THẬP MỌI LỖI thay vì dừng ở lỗi đầu: người lập hồ sơ
// sửa một lượt chứ không phải bấm Lưu bốn lần để thấy bốn lỗi. Phần chạm DB ở `dich-vu.ts` / `ngu-canh-db.ts`.
//
// ⚠️ MỌI NGÀY là tham số (`now`) — không `new Date()` trong hàm (luật 19). Mọi phép so ngày theo LỊCH VN.
import { hanToiDaBaoLuu, kiemTranBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnStartOfDay, vnYmd } from "@/lib/time/vn";

export type LyDoBaoLuu = "ILLNESS" | "FAMILY" | "RELOCATION" | "SCHEDULE" | "OTHER";

export const NHAN_LY_DO: Record<LyDoBaoLuu, string> = {
  ILLNESS: "Ốm đau",
  FAMILY: "Việc gia đình dài ngày",
  RELOCATION: "Đi xa / chuyển nơi ở tạm",
  SCHEDULE: "Lịch thay đổi kéo dài",
  OTHER: "Khác",
};

export type ChinhSach = {
  /** `enrollment.suspendMaxMonths` — tái dùng làm "pause.maxMonths". */
  maxMonths: number;
  minDays: number;
  maxPerEnrollment: number;
  medicalProofDays: number;
  backdateMaxSessions: number;
  maxOverdueDebtDays: number;
  extendTimes: number;
  extendMaxMonths: number;
};

const NGAY_MS = 86_400_000;

/** Số ngày LỊCH VN từ `a` đến `b` (b − a). Âm nếu b trước a. */
export function soNgayLich(a: Date, b: Date): number {
  return Math.round((vnStartOfDay(b).getTime() - vnStartOfDay(a).getTime()) / NGAY_MS);
}

// ───────────────────────────────────────────────────────────────────────────────
// LẬP
// ───────────────────────────────────────────────────────────────────────────────

export type DauVaoLap = {
  reasonCode: LyDoBaoLuu | null;
  reasonNote: string;
  /** Ngày dự kiến quay lại — KHÔNG bắt buộc (BR-12). */
  expectedReturnDate: Date | null;
  /** Buổi nghỉ đầu tiên, nếu xin lùi ngày bắt đầu (BR-09). Quyết định cuối ở lúc DUYỆT. */
  firstAbsentDate: Date | null;
  coDon: boolean;
  soMinhChung: number;
  /** Chỉ `bao-luu:exception` mới được vượt trần; bắt buộc lý do. */
  vuotTran: { lyDo: string } | null;
};

export type BoiCanhLap = {
  now: Date;
  /** `Course.allowPause`. */
  khoaChoPhep: boolean;
  trangThaiGhiDanh: string;
  /** Ghi danh đã bị xoá mềm. */
  daXoa: boolean;
  /** Số hồ sơ PARENT/LEGACY của ghi danh KHÔNG ở REJECTED/CANCELLED (BR-08). */
  soLanDaDung: number;
  /** `dangBaoLuu` — ghi danh (hoặc cả học viên) đang có hồ sơ mở. */
  coHoSoMo: boolean;
  chinhSach: ChinhSach;
};

export type KetQuaLap =
  | {
      ok: true;
      /** Cảnh báo KHÔNG chặn (vd còn nợ quá hạn — chặn ở lúc duyệt). */
      canhBao: string[];
      /** Hạn tiêu chuẩn nếu bắt đầu hôm nay (BR-10). Số thật được chốt lúc duyệt. */
      standardEndDateDuKien: Date;
    }
  | { ok: false; loi: string[] };

/** Ghi danh được phép bảo lưu = đang học chính thức (BR-03). Đồng bộ với `STUDYING_ENROLLMENT_STATUSES`. */
export const TRANG_THAI_GHI_DANH_BAO_LUU_DUOC: readonly string[] = ["STUDYING", "ACTIVE"];

export function kiemLapHoSo(v: DauVaoLap, c: BoiCanhLap): KetQuaLap {
  const loi: string[] = [];
  const cs = c.chinhSach;

  if (c.daXoa) loi.push("Ghi danh đã bị xoá.");
  if (!c.khoaChoPhep) loi.push("Khoá học này không áp dụng bảo lưu (khoá ngắn hạn / ôn thi / theo mùa).");
  if (!TRANG_THAI_GHI_DANH_BAO_LUU_DUOC.includes(c.trangThaiGhiDanh)) {
    loi.push("Chỉ bảo lưu được ghi danh đang học chính thức — không bảo lưu ghi danh học thử hoặc chưa vào lớp.");
  }
  if (c.coHoSoMo) loi.push("Ghi danh này đang có hồ sơ bảo lưu còn hiệu lực.");
  if (c.soLanDaDung >= cs.maxPerEnrollment) {
    loi.push(
      `Đã đủ ${cs.maxPerEnrollment} lần bảo lưu cho ghi danh này (hồ sơ bị từ chối hoặc rút lại không tính).`,
    );
  }

  if (!v.reasonCode) loi.push("Chọn lý do bảo lưu.");
  else if (v.reasonCode === "OTHER" && v.reasonNote.trim().length < 5) {
    loi.push('Lý do "Khác" phải ghi chú rõ (ít nhất 5 ký tự).');
  }
  if (v.reasonNote.length > 1000) loi.push("Ghi chú quá dài (tối đa 1000 ký tự).");

  // BR-07 — đơn đã ký là bắt buộc.
  if (!v.coDon) loi.push("Cần tải lên đơn bảo lưu đã ký (bản quét hoặc ảnh chụp).");

  // BR-12 + BR-10/11 — ngày dự kiến quay lại không bắt buộc; nếu khai thì phải nằm trong trần và ≥ tối thiểu.
  const batDauDuKien = c.now;
  if (v.expectedReturnDate) {
    const tran = kiemTranBaoLuu({ startedAt: batDauDuKien, expectedEndAt: v.expectedReturnDate, maxMonths: cs.maxMonths });
    if (!tran.ok) {
      if (tran.code === "RESERVE_TOO_LONG") {
        if (!v.vuotTran) loi.push(`${tran.message} Vượt trần chỉ còn đường ngoại lệ của Ban giám đốc.`);
        else if (v.vuotTran.lyDo.trim().length < 10) loi.push("Vượt trần thời hạn phải ghi lý do ngoại lệ (ít nhất 10 ký tự).");
      } else {
        loi.push(tran.message);
      }
    } else if (cs.minDays > 0 && soNgayLich(batDauDuKien, v.expectedReturnDate) < cs.minDays) {
      loi.push(`Thời gian bảo lưu tối thiểu ${cs.minDays} ngày.`);
    }
  }

  // BR-05 — ốm đau dài hơn `medicalProofDays` ⇒ bắt buộc minh chứng. Không khai ngày quay lại thì thời gian
  // dự kiến CHƯA BIẾT, mà hạn tiêu chuẩn (≥1 tháng) luôn vượt 30 ngày ⇒ coi là dài.
  // TODO(bao-luu Q-medical-no-date): mặc định đòi minh chứng khi ốm đau mà không khai ngày quay lại.
  if (v.reasonCode === "ILLNESS" && v.soMinhChung === 0) {
    const duKienNgay = v.expectedReturnDate
      ? soNgayLich(batDauDuKien, v.expectedReturnDate)
      : soNgayLich(batDauDuKien, hanToiDaBaoLuu(batDauDuKien, cs.maxMonths));
    if (duKienNgay > cs.medicalProofDays) {
      loi.push(`Bảo lưu vì ốm đau dài hơn ${cs.medicalProofDays} ngày phải đính kèm minh chứng (đơn thuốc, giấy ra viện…).`);
    }
  }

  if (v.firstAbsentDate && vnStartOfDay(v.firstAbsentDate).getTime() > vnStartOfDay(c.now).getTime()) {
    loi.push("Buổi nghỉ đầu tiên không được ở tương lai.");
  }

  if (loi.length > 0) return { ok: false, loi };
  return { ok: true, canhBao: [], standardEndDateDuKien: hanToiDaBaoLuu(batDauDuKien, cs.maxMonths) };
}

// ───────────────────────────────────────────────────────────────────────────────
// DUYỆT
// ───────────────────────────────────────────────────────────────────────────────

/**
 * MAKER–CHECKER (chốt C): người LẬP không được DUYỆT hồ sơ của chính mình — kể cả khi có quyền duyệt, kể cả
 * Quản trị tối cao. Dùng cho: duyệt, từ chối, và (với người đề nghị gia hạn) duyệt gia hạn.
 * `nguoiLap = null` (hồ sơ do hệ thống/di trú sinh ra) ⇒ không ai là "chính mình".
 */
export function chanTuDuyet(nguoiThucHien: string, nguoiLap: string | null | undefined): string | null {
  if (nguoiLap && nguoiThucHien === nguoiLap) {
    return "Người lập hồ sơ không được duyệt hồ sơ của chính mình — nhờ người khác duyệt.";
  }
  return null;
}

export type KhoanDenHan = {
  /** Hạn đóng. */
  dueDate: Date;
  /** Còn phải thu của khoản này (đồng). ≤ 0 ⇒ đã đóng đủ, không tính. */
  conNo: number;
};

/** Số ngày quá hạn LỚN NHẤT trong các khoản còn nợ; 0 nếu không khoản nào quá hạn. */
export function soNgayQuaHanLonNhat(khoan: readonly KhoanDenHan[], now: Date): number {
  let max = 0;
  for (const k of khoan) {
    if (k.conNo <= 0) continue;
    const ngay = soNgayLich(k.dueDate, now);
    if (ngay > max) max = ngay;
  }
  return max;
}

/** BR-06 — chặn DUYỆT khi có khoản đến hạn mà quá hạn LỚN HƠN `maxOverdueDebtDays` (đúng bằng thì cho qua). */
export function chanDuyetVeNo(khoan: readonly KhoanDenHan[], maxOverdueDebtDays: number, now: Date): string | null {
  const n = soNgayQuaHanLonNhat(khoan, now);
  if (n > maxOverdueDebtDays) {
    return `Ghi danh còn khoản đến hạn quá ${n} ngày (quá mức ${maxOverdueDebtDays} ngày cho phép) — thu xong mới duyệt được.`;
  }
  return null;
}

export type NgayBatDau =
  | { ok: true; startedAt: Date; soBuoiLui: number }
  | { ok: false; loi: string };

/**
 * BR-09 — Ngày bắt đầu = ngày duyệt, HOẶC lùi về buổi nghỉ đầu tiên nhưng không quá `backdateMaxSessions` buổi học
 * của lớp.
 *
 * `soBuoiTuNgayDauDenNay` = số buổi học (không huỷ) của lớp có ngày từ ngày nghỉ đầu tiên tới `now` — người gọi đếm
 * bằng DB. Lùi đúng N buổi là được; N+1 là chặn (TC-04 / TC-05).
 */
export function tinhNgayBatDau(input: {
  now: Date;
  firstAbsentDate: Date | null;
  soBuoiTuNgayDauDenNay: number;
  backdateMaxSessions: number;
}): NgayBatDau {
  if (!input.firstAbsentDate) return { ok: true, startedAt: input.now, soBuoiLui: 0 };
  const ngay = vnStartOfDay(input.firstAbsentDate);
  if (ngay.getTime() > vnStartOfDay(input.now).getTime()) {
    return { ok: false, loi: "Buổi nghỉ đầu tiên không được ở tương lai." };
  }
  if (input.soBuoiTuNgayDauDenNay <= 0) {
    return { ok: false, loi: `Lớp không có buổi học nào từ ngày ${vnYmd(ngay)} — không có gì để lùi.` };
  }
  if (input.soBuoiTuNgayDauDenNay > input.backdateMaxSessions) {
    return {
      ok: false,
      loi:
        `Chỉ được lùi ngày bắt đầu tối đa ${input.backdateMaxSessions} buổi học của lớp ` +
        `(từ ${vnYmd(ngay)} tới nay đã có ${input.soBuoiTuNgayDauDenNay} buổi).`,
    };
  }
  return { ok: true, startedAt: ngay, soBuoiLui: input.soBuoiTuNgayDauDenNay };
}

/** Ảnh chụp chính sách tại lúc DUYỆT (spec §D: đổi cấu hình KHÔNG áp hồi tố lên hồ sơ đang mở). */
export function taoPolicySnapshot(cs: ChinhSach, now: Date, orgUnitId: string | null) {
  return { ...cs, chupLuc: now.toISOString(), orgUnitId };
}
