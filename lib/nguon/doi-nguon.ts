/**
 * lib/nguon/doi-nguon.ts — QUYẾT ĐỊNH đổi nguồn có kiểm soát (03 §3). THUẦN: chỉ nói ĐƯỢC / KHÔNG, không ghi gì.
 * Phần ghi (transaction, `doiNguon`, AuditLog, DomainEvent) ở `doi-nguon-lead.ts`.
 *
 *  | | trước thực thu | sau thực thu |
 *  | quyền | `leads:overwrite` | `sources:override-after-payment` (KHÔNG chấp nhận quyền thường) |
 *  | lý do | ≥ 10 ký tự sau trim — MỌI lượt đổi lead đã có attribution | như cột trái |
 *  | tiền | không | `canDieuChinh` ⇒ engine tạo Adjustment (event `nguon.da-doi-sau-thanh-toan`) |
 *
 * Cổng chung: nguồn mới ACTIVE + chọn được · người/giải trình theo thuộc tính nhóm · không có cờ gian lận BLOCK ·
 * nguồn đang KHOÁ (page mapping) cần thêm `sources:manage`.
 */
import type { SourceReferrerRequirement } from "@prisma/client";
import type { CoGianLan } from "./gian-lan";
import { kiemGiaiTrinh, kiemThamChieu, type ThamChieuNguon } from "./kiem-nguon";

export type TruongLoi = "quyen" | "lyDo" | "nguon" | "thamChieu" | "giaiTrinh";

/** Mã CHẶN đáng ghi lại thành touchpoint `DOI_NGUON_BI_CHAN` (03 §4): chỉ hai ca — cướp nguồn và đổi sau thực thu thiếu quyền. */
export type MaChanDoiNguon = "TU_CLAIM" | "DOI_SAU_TT";

export type QuyetDinhDoiNguon =
  | { ok: true; canDieuChinh: boolean; action: "DOI_NGUON" | "DOI_NGUON_SAU_THU" }
  | { ok: false; loi: string; truong: TruongLoi; maChan?: MaChanDoiNguon };

export const LY_DO_TOI_THIEU = 10;

/** Tên khoá quyền của đổi nguồn — MỘT bảng, để nút vẽ và cổng server nói cùng một tên (luật 12). */
export const KHOA_QUYEN_DOI_NGUON = {
  truocThuc: "leads:overwrite",
  sauThuc: "sources:override-after-payment",
  khoa: "sources:manage",
} as const;

export type QuyenDoiNguon =
  | { ok: true }
  | {
      ok: false;
      /** Câu lỗi cho người dùng (cổng server trả đúng câu này). */
      loi: string;
      /** Khoá quyền còn THIẾU — để giao diện nêu TÊN thật, không "không có quyền" trần. */
      thieu: readonly string[];
      maChan?: MaChanDoiNguon;
    };

/**
 * Người này có ĐƯỢC đổi nguồn của lead này không — chỉ phần QUYỀN (còn lý do, nhóm mới, gian lận do `quyetDinhDoiNguon`).
 *
 * Vì sao tách: nút "Đổi nguồn" ở giao diện và cổng ở máy chủ phải trả lời bằng CÙNG MỘT hàm; vẽ nút bằng quyền A rồi để
 * action hỏi quyền B là lời hứa suông (luật 12). THUẦN: ba cờ quyền do chỗ gọi hỏi qua `can()` rồi truyền vào.
 */
export function quyenDoiNguon(input: {
  daCoThucThu: boolean;
  nguonDangKhoa: boolean;
  quyen: { overwrite: boolean; overrideSauThanhToan: boolean; quanLyNguon: boolean };
}): QuyenDoiNguon {
  const thieu: string[] = [];
  let loi: string | null = null;
  let maChan: MaChanDoiNguon | undefined;
  if (input.daCoThucThu) {
    if (!input.quyen.overrideSauThanhToan) {
      thieu.push(KHOA_QUYEN_DOI_NGUON.sauThuc);
      loi = "Lead đã có khoản thu: chỉ người có quyền riêng mới đổi được nguồn.";
      maChan = "DOI_SAU_TT";
    }
  } else if (!input.quyen.overwrite) {
    thieu.push(KHOA_QUYEN_DOI_NGUON.truocThuc);
    loi = "Bạn không có quyền đổi nguồn lead.";
  }
  if (input.nguonDangKhoa && !input.quyen.quanLyNguon) {
    thieu.push(KHOA_QUYEN_DOI_NGUON.khoa);
    loi ??= "Nguồn này do hệ thống tự xác định và đã khoá — cần quyền quản lý nguồn để đổi.";
  }
  if (loi === null) return { ok: true };
  return maChan ? { ok: false, loi, thieu, maChan } : { ok: false, loi, thieu };
}

export function quyetDinhDoiNguon(input: {
  daCoThucThu: boolean;
  daCoDongSo: boolean;
  quyen: { overwrite: boolean; overrideSauThanhToan: boolean; quanLyNguon: boolean };
  /** Nguồn hiện hành đang KHOÁ (page mapping tự xác định). */
  nguonDangKhoa: boolean;
  lyDo: string | null;
  nguonMoi: {
    trangThai: string;
    selectable: boolean;
    requiresNote: boolean;
    referrerRequirement: SourceReferrerRequirement;
  };
  thamChieu: ThamChieuNguon | null;
  giaiTrinh: string | null;
  gianLan: readonly CoGianLan[];
}): QuyetDinhDoiNguon {
  const no = (truong: TruongLoi, loi: string, maChan?: MaChanDoiNguon): QuyetDinhDoiNguon =>
    maChan ? { ok: false, loi, truong, maChan } : { ok: false, loi, truong };

  // 1. Quyền — MỘT phép hỏi, dùng chung với nút "Đổi nguồn" (`quyenDoiNguon`, luật 12).
  const q = quyenDoiNguon({ daCoThucThu: input.daCoThucThu, nguonDangKhoa: input.nguonDangKhoa, quyen: input.quyen });
  if (!q.ok) return no("quyen", q.loi, q.maChan);

  // 2. Lý do — ở server, TRƯỚC khi rơi xuống CHECK của DB.
  if ((input.lyDo ?? "").trim().length < LY_DO_TOI_THIEU) {
    return no("lyDo", `Lý do đổi nguồn phải từ ${LY_DO_TOI_THIEU} ký tự.`);
  }

  // 3. Nguồn mới phải chọn được.
  if (input.nguonMoi.trangThai !== "ACTIVE" || !input.nguonMoi.selectable) {
    return no("nguon", "Nguồn mới không còn dùng được — chọn nguồn khác.");
  }

  // 4. Người giới thiệu + giải trình theo thuộc tính nhóm.
  const loiNguoi = kiemThamChieu(input.nguonMoi, input.thamChieu);
  if (loiNguoi) return no("thamChieu", loiNguoi);
  const loiGiaiTrinh = kiemGiaiTrinh(input.nguonMoi, input.giaiTrinh);
  if (loiGiaiTrinh) return no("giaiTrinh", loiGiaiTrinh);

  // 5. Gian lận mức BLOCK. Lời lỗi nói theo NGUYÊN NHÂN và không lộ nhóm/người của nguồn cũ.
  if (input.gianLan.some((g) => g.muc === "BLOCK")) {
    return no("thamChieu", "Người phụ trách lead này không thể đồng thời là người hưởng hoa hồng giới thiệu hoặc phụ trách nguồn của chính lead đó — hãy chọn người khác.", "TU_CLAIM");
  }

  return {
    ok: true,
    canDieuChinh: input.daCoThucThu || input.daCoDongSo,
    action: input.daCoThucThu ? "DOI_NGUON_SAU_THU" : "DOI_NGUON",
  };
}
