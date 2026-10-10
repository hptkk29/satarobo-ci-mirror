// lib/hoa-hong/phan-loai-giao-dich.ts — PHÂN LOẠI GIAO DỊCH: NEW | RENEWAL | MANUAL_REVIEW.
//
// Nguồn thiết kế: docs/source-commission/04 §5 (luật), 02 §8.3 (`StudentTransaction`), 05 AC-TRX.
// THUẦN — không DB, không đọc đồng hồ (`moc` là tham số BẮT BUỘC, luật 7 + 19). Phần nạp dữ liệu
// nằm ở `phan-loai-giao-dich-db.ts`; hai bên nối nhau bằng kiểu `DauVaoPhanLoai`.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐƠN VỊ PHÂN LOẠI = MỘT LẦN MUA = MỘT `OrderItem` HỌC PHÍ, THEO HỌC VIÊN (không theo phụ huynh).
//
//   1. dòng không phải Học phí                                       → NGOAI_PHAM_VI
//   2. dính đổi khoá · chuyển cơ sở · bảo lưu · dừng học             → PENDING_REGULATION
//      dính chuyển lớp / không rõ chuyển gì                          → MANUAL_REVIEW_REQUIRED
//   3. không ra được học viên                                        → MANUAL_REVIEW_REQUIRED
//   4. ghi danh có `renewedFromEnrollmentId` (cờ tay)                → RENEWAL
//   5. học viên đã có lần mua KHÁC (đơn khác, tạo trước, có thực thu) → RENEWAL
//   6. lịch sử mua MƠ HỒ, hoặc có ghi danh không nối đơn tạo trước   → MANUAL_REVIEW_REQUIRED
//   7. còn lại                                                       → NEW
//
// Mọi đợt thu của CÙNG một `OrderItem` dùng chung kết quả: HĐ 12tr chia 3 đợt ⇒ NEW ×3. Đó là cách
// đọc "kỳ 1 của hợp đồng = NEW, kỳ 2+ = RENEWAL" / "học phần đầu NEW, học phần sau RENEWAL" của bộ
// tài liệu (04 §5.2): "kỳ"/"học phần" là LẦN MUA kế tiếp của học viên chứ không phải đợt thu. Câu
// hỏi mở Q3 (04) vẫn nằm đó; nếu chủ dự án đọc khác thì chỉ phải đổi bước 5 + nâng `BO_LUAT_PHAN_LOAI`
// — dòng đã phân loại giữ nguyên phiên bản bộ luật cũ (02 §8.3), không bị phân loại lại im lặng.
//
// ⚠️ THIẾU DỮ LIỆU ⇒ KHÔNG ĐOÁN. Mọi nhánh không chắc đi vào MANUAL_REVIEW, kèm `maLuat` + bằng
// chứng để người duyệt thấy vì sao.
//
// ⚠️ Bộ phân loại này KHÔNG có nhánh nào ra mã nâng cấp / bán chéo / quay lại — chúng chỉ là dòng
// master TẮT (`loai-giao-dich.ts`). Lưới `[NHH-TRX-05d]` canh điều đó trên chính mã nguồn.
//
// ⚠️ Đơn không có lead / `Student.leadId` NULL KHÔNG đổi NEW/RENEWAL: phân loại đi theo lịch sử mua
// CỦA HỌC VIÊN (`OrderItem.studentId` — bước 1 của 04 §4.4). Lead chỉ cần để dò "phụ huynh hiện hữu"
// (bằng chứng, Q20) và để tìm NGƯỜI HƯỞNG — vế sau là việc của sổ (PR5): 0 dòng cho vai thiếu người
// + hàng chờ mềm `UNRESOLVED_BENEFICIARY`, không phải xem tay phân loại (05 TRX-06).
import type { ThanhPhanDoanhThu } from "./loai-giao-dich";

/**
 * Phiên bản bộ luật phân loại — chụp lên `StudentTransaction.rulesetVersion` (02 §8.3). Đổi luật ⇒
 * nâng hằng này; dòng cũ GIỮ phiên bản cũ.
 */
export const BO_LUAT_PHAN_LOAI = "2026-10-08.v1";

// ── Đầu vào ─────────────────────────────────────────────────────────────────

export type DongPhanLoai = {
  orderItemId: string;
  orderId: string;
  thanhPhan: ThanhPhanDoanhThu;
  /** `OrderItem.status` — `STOPPED` = đã quyết toán dừng học. */
  trangThai: "ACTIVE" | "STOPPED";
  /** `OrderItem.createdAt` — mốc "tạo trước/sau" giữa các lần mua. */
  taoLuc: Date;
};

/** Mối nối chuyển ghi danh (`Enrollment.transferredToId`) nhìn từ một phía. */
export type LienKetChuyen = {
  enrollmentId: string;
  courseId: string;
  centerId: string | null;
};

export type GhiDanhPhanLoai = {
  id: string;
  courseId: string;
  centerId: string | null;
  /** `Enrollment.renewedFromEnrollmentId` — cờ tay "tái tục" (schema:2511). */
  renewedFromEnrollmentId: string | null;
  /** Ghi danh KHÁC đã chuyển SANG ghi danh này. */
  chuyenTu: readonly LienKetChuyen[];
  /** Ghi danh này đã chuyển SANG ghi danh khác. */
  chuyenDen: LienKetChuyen | null;
  /** Các lượt `StudentReserve` của ghi danh này (kể cả đã kết thúc). */
  baoLuu: readonly { batDau: Date; ketThuc: Date | null }[];
};

/** Một lần mua KHÁC của cùng học viên (dòng học phí của đơn khác). */
export type LanMuaTruoc = {
  orderItemId: string;
  orderId: string;
  taoLuc: Date;
  /** Đơn đã huỷ (`Order.status = CANCELLED`) — không tính là lần mua. */
  daHuy: boolean;
  /** Σ thực thu đã quy cho dòng này (CONFIRMED + REFUNDED âm, `WHERE_THUC_THU`). */
  thucThu: number;
  /**
   * Σ thực thu quy được cho dòng = 0 nhưng ĐƠN có khoản chưa gắn dòng nào và đơn có ≥2 dòng học phí
   * ⇒ không biết tiền ấy thuộc dòng nào ⇒ mơ hồ, không đoán (04 §4.3 bước 4).
   */
  moHo: boolean;
};

export type PhuHuynhHienHuu = {
  /** `null` = KHÔNG BIẾT (không có lead lẫn SĐT phụ huynh hợp lệ để dò). */
  hienHuu: boolean | null;
  can: "CUNG_LEAD" | "CUNG_SDT" | null;
};

export type DauVaoPhanLoai = {
  dong: DongPhanLoai;
  /** Học viên đã phân giải (04 §4.4); `null` = không ra được. */
  studentId: string | null;
  /** Ghi danh nối với dòng (`OrderItem.enrollmentId`). */
  ghiDanh: GhiDanhPhanLoai | null;
  /** Mọi dòng học phí KHÁC của cùng học viên (bộ phân loại tự lọc "tạo trước" + "đơn khác"). */
  lanMuaTruoc: readonly LanMuaTruoc[];
  /** Ghi danh của học viên KHÔNG nối `OrderItem` nào (nhập tay / dữ liệu cũ). */
  ghiDanhMoCoi: readonly { enrollmentId: string; taoLuc: Date }[];
  phuHuynh: PhuHuynhHienHuu;
  /** Đơn có `leadId` hoặc học viên có `leadId` — CHỈ là bằng chứng, không đổi kết quả. */
  coLead: boolean;
  /** Mốc thời điểm của khoản thu đang xét (xét bảo lưu hiệu lực). BẮT BUỘC. */
  moc: Date;
};

// ── Đầu ra ──────────────────────────────────────────────────────────────────

export type BangChungPhanLoai = {
  lanMuaTruocIds: string[];
  lanMuaMoHoIds: string[];
  ghiDanhXungDotIds: string[];
  ghiDanhGocTaiTucId: string | null;
  /** Mọi dấu hiệu dính chuyển/bảo lưu/dừng học (kể cả cái không thắng), để ngăn "Vì sao" đủ. */
  dinh: string[];
  phuHuynhHienHuu: PhuHuynhHienHuu;
  coLead: boolean;
};

export type MaLuatPhanLoai =
  | "NGOAI_PHAM_VI"
  | "DOI_KHOA"
  | "CHUYEN_CO_SO"
  | "BAO_LUU"
  | "DUNG_HOC"
  | "CHUYEN_LOP"
  | "CHUYEN_KHONG_RO"
  | "KHONG_RA_HOC_VIEN"
  | "RENEWED_FROM_FLAG"
  | "PRIOR_PURCHASE"
  | "LICH_SU_MO_HO"
  | "GHI_DANH_KHONG_DON"
  | "FIRST_PURCHASE";

export type KetQuaPhanLoai =
  | {
      loai: "NEW" | "RENEWAL";
      trangThai: "CLASSIFIED";
      maLuat: MaLuatPhanLoai;
      lyDo: string;
      bangChung: BangChungPhanLoai;
    }
  | {
      loai: "MANUAL_REVIEW";
      trangThai: "MANUAL_REVIEW_REQUIRED" | "PENDING_REGULATION";
      maLuat: MaLuatPhanLoai;
      lyDo: string;
      bangChung: BangChungPhanLoai;
    }
  | {
      /** Dòng không phải học phí — không phải "phân loại" (04 §5.2 bước 1). */
      loai: "NGOAI_PHAM_VI";
      trangThai: "NGOAI_PHAM_VI";
      maLuat: "NGOAI_PHAM_VI";
      lyDo: string;
      bangChung: BangChungPhanLoai;
    };

// ── Hàm phụ ─────────────────────────────────────────────────────────────────

/** `a` nằm TRƯỚC `b` theo (taoLuc, id) — hoà giờ thì id nhỏ hơn đứng trước, nên luôn đúng một bên. */
function datTruoc(
  a: { taoLuc: Date; orderItemId: string },
  b: { taoLuc: Date; orderItemId: string },
): boolean {
  const ta = a.taoLuc.getTime();
  const tb = b.taoLuc.getTime();
  if (ta !== tb) return ta < tb;
  return a.orderItemId < b.orderItemId;
}

/** Lần mua trước có tính là "lần mua thật" không (không huỷ + thực thu > 0). */
function laLanMuaThat(a: Pick<LanMuaTruoc, "daHuy" | "thucThu">): boolean {
  return !a.daHuy && a.thucThu > 0;
}

/**
 * Phụ huynh đã là khách HIỆN HỮU chưa (04 §5.2 "Bằng chứng PH hiện hữu"): có học viên KHÁC cùng lead
 * hoặc cùng SĐT phụ huynh chuẩn hoá, đã có lần mua thật ở ĐƠN KHÁC, tạo TRƯỚC dòng đang xét.
 *
 * Chỉ là BẰNG CHỨNG (ghi vào `StudentTransaction.evidence`) — không đổi NEW/RENEWAL của bé này.
 * Hệ quả tiền (loại Marketing cho bé 2) nằm ở 04 Q20, chưa áp.
 */
export function tinhPhuHuynhHienHuu(input: {
  dong: Pick<DongPhanLoai, "orderItemId" | "orderId" | "taoLuc">;
  ungVien: readonly {
    studentId: string;
    cungLead: boolean;
    cungSdt: boolean;
    lanMua: readonly LanMuaTruoc[];
  }[];
  /** Có lead hoặc SĐT phụ huynh hợp lệ để dò không. */
  coDinhDanh: boolean;
}): PhuHuynhHienHuu {
  const coBangChung = (u: { lanMua: readonly LanMuaTruoc[] }) =>
    u.lanMua.some((l) => l.orderId !== input.dong.orderId && datTruoc(l, input.dong) && laLanMuaThat(l));

  const cungLead = input.ungVien.some((u) => u.cungLead && coBangChung(u));
  if (cungLead) return { hienHuu: true, can: "CUNG_LEAD" };
  const cungSdt = input.ungVien.some((u) => u.cungSdt && coBangChung(u));
  if (cungSdt) return { hienHuu: true, can: "CUNG_SDT" };
  // Không tìm thấy bằng chứng: chỉ được khẳng định "không" khi CÓ cách dò (lead hoặc SĐT).
  return input.coDinhDanh ? { hienHuu: false, can: null } : { hienHuu: null, can: null };
}

function baoLuuHieuLuc(
  baoLuu: GhiDanhPhanLoai["baoLuu"],
  moc: Date,
): boolean {
  const m = moc.getTime();
  return baoLuu.some((b) => b.batDau.getTime() <= m && (b.ketThuc === null || b.ketThuc.getTime() > m));
}

/** Nhận diện loại chuyển của một mối nối so với ghi danh hiện tại. */
function loaiChuyen(g: GhiDanhPhanLoai, lk: LienKetChuyen): "DOI_KHOA" | "CHUYEN_CO_SO" | "CHUYEN_KHONG_RO" | "CHUYEN_LOP" {
  if (lk.courseId !== g.courseId) return "DOI_KHOA";
  if (lk.centerId === null || g.centerId === null) return "CHUYEN_KHONG_RO";
  if (lk.centerId !== g.centerId) return "CHUYEN_CO_SO";
  return "CHUYEN_LOP";
}

const sapXep = (xs: readonly string[]): string[] => [...xs].sort();

// ── Hàm chính ───────────────────────────────────────────────────────────────

/**
 * Phân loại MỘT lần mua (một `OrderItem`) theo học viên. Hàm THUẦN, tất định, không sửa đầu vào.
 */
export function phanLoaiGiaoDich(d: DauVaoPhanLoai): KetQuaPhanLoai {
  const g = d.ghiDanh;

  // Các lần mua KHÁC, đơn KHÁC, tạo TRƯỚC (cùng đơn = cùng một quyết định mua).
  const truocs = d.lanMuaTruoc.filter((l) => l.orderId !== d.dong.orderId && datTruoc(l, d.dong));
  const chac = truocs.filter(laLanMuaThat);
  const moHo = truocs.filter((l) => !l.daHuy && l.thucThu <= 0 && l.moHo);
  const xungDot = d.ghiDanhMoCoi.filter((e) => e.taoLuc.getTime() < d.dong.taoLuc.getTime());

  // Mọi dấu hiệu dính chuyển / bảo lưu / dừng học.
  const dinh: string[] = [];
  const loaiChuyenGap = new Set<string>();
  if (g) {
    for (const lk of [...g.chuyenTu, ...(g.chuyenDen ? [g.chuyenDen] : [])]) loaiChuyenGap.add(loaiChuyen(g, lk));
    for (const l of sapXep([...loaiChuyenGap])) dinh.push(l);
    if (baoLuuHieuLuc(g.baoLuu, d.moc)) dinh.push("BAO_LUU");
  }
  if (d.dong.trangThai === "STOPPED") dinh.push("DUNG_HOC");

  const bangChung: BangChungPhanLoai = {
    lanMuaTruocIds: sapXep(chac.map((l) => l.orderItemId)),
    lanMuaMoHoIds: sapXep(moHo.map((l) => l.orderItemId)),
    ghiDanhXungDotIds: sapXep(xungDot.map((e) => e.enrollmentId)),
    ghiDanhGocTaiTucId: g?.renewedFromEnrollmentId ?? null,
    dinh,
    phuHuynhHienHuu: d.phuHuynh,
    coLead: d.coLead,
  };

  // 1 — ngoài phạm vi.
  if (d.dong.thanhPhan !== "TUITION") {
    return {
      loai: "NGOAI_PHAM_VI",
      trangThai: "NGOAI_PHAM_VI",
      maLuat: "NGOAI_PHAM_VI",
      lyDo: `Dòng thành phần ${d.dong.thanhPhan} không phải Học phí — không nằm trong cơ sở tính hoa hồng (D17).`,
      bangChung,
    };
  }

  // 2 — ca dính văn bản chưa có: PENDING_REGULATION trước, xem tay sau.
  const pending = (
    ["DOI_KHOA", "CHUYEN_CO_SO", "BAO_LUU", "DUNG_HOC"] as const
  ).find((m) => dinh.includes(m));
  if (pending) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "PENDING_REGULATION",
      maLuat: pending,
      lyDo: LY_DO_PENDING[pending],
      bangChung,
    };
  }
  const xemTayChuyen = (["CHUYEN_KHONG_RO", "CHUYEN_LOP"] as const).find((m) => dinh.includes(m));
  if (xemTayChuyen) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: xemTayChuyen,
      lyDo: LY_DO_XEM_TAY[xemTayChuyen],
      bangChung,
    };
  }

  // 3 — không ra học viên.
  if (d.studentId === null) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "KHONG_RA_HOC_VIEN",
      lyDo: "Không xác định được học viên của dòng học phí này (OrderItem.studentId, ghi danh, con của lead đều không ra).",
      bangChung,
    };
  }

  // 4 — cờ tái tục (tay) trên ghi danh.
  if (g?.renewedFromEnrollmentId) {
    return {
      loai: "RENEWAL",
      trangThai: "CLASSIFIED",
      maLuat: "RENEWED_FROM_FLAG",
      lyDo: `Ghi danh được đánh dấu tái tục từ ghi danh ${g.renewedFromEnrollmentId}.`,
      bangChung,
    };
  }

  // 5 — học viên đã có lần mua khác.
  if (chac.length > 0) {
    return {
      loai: "RENEWAL",
      trangThai: "CLASSIFIED",
      maLuat: "PRIOR_PURCHASE",
      lyDo: `Học viên đã có ${chac.length} lần mua học phí trước đó (đơn khác, có thực thu): ${bangChung.lanMuaTruocIds.join(", ")}.`,
      bangChung,
    };
  }

  // 6 — bằng chứng mơ hồ / xung đột.
  if (moHo.length > 0) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "LICH_SU_MO_HO",
      lyDo: `Lần mua trước (${bangChung.lanMuaMoHoIds.join(", ")}) có khoản thu chưa gắn dòng nào trong đơn nhiều dòng học phí — không biết tiền thuộc dòng nào, không đoán.`,
      bangChung,
    };
  }
  if (xungDot.length > 0) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "GHI_DANH_KHONG_DON",
      lyDo: `Học viên có ghi danh không nối đơn nào, tạo trước dòng này (${bangChung.ghiDanhXungDotIds.join(", ")}) — xung đột bằng chứng giữa "chưa từng mua" và "đã học".`,
      bangChung,
    };
  }

  // 7 — lần mua đầu.
  return {
    loai: "NEW",
    trangThai: "CLASSIFIED",
    maLuat: "FIRST_PURCHASE",
    lyDo: "Lần mua học phí đầu tiên của học viên (không có lần mua thật nào trước đó, không có cờ tái tục).",
    bangChung,
  };
}

const LY_DO_PENDING = {
  DOI_KHOA: "Dòng/ghi danh dính ĐỔI KHOÁ — chưa có văn bản quy định hoa hồng cho trường hợp này (04 §5.2 bước 2).",
  CHUYEN_CO_SO: "Dòng/ghi danh dính CHUYỂN CƠ SỞ — chưa có văn bản quy định (04 §5.2 bước 2).",
  BAO_LUU: "Ghi danh đang BẢO LƯU tại thời điểm thu — chưa có văn bản quy định (04 §5.2 bước 2).",
  DUNG_HOC: "Dòng đã DỪNG HỌC mà vẫn phát sinh khoản thu mới — chưa có văn bản quy định (04 §5.2 bước 2).",
} as const;

const LY_DO_XEM_TAY = {
  CHUYEN_LOP: "Ghi danh dính CHUYỂN LỚP (cùng khoá, cùng cơ sở) — chưa có văn bản nhận diện, người duyệt quyết (04 Q21).",
  CHUYEN_KHONG_RO: "Ghi danh dính chuyển nhưng thiếu cơ sở của một bên — không phân biệt được chuyển lớp với chuyển cơ sở, không đoán.",
} as const;
