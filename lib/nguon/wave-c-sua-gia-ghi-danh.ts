/**
 * lib/nguon/wave-c-sua-gia-ghi-danh.ts — LÕI THUẦN của «PHASE C-B · chuẩn hoá GIÁ GHI DANH cho 16 đơn khoá học legacy» (26/10/2026).
 *
 * ── Việc này làm gì ──────────────────────────────────────────────────────────────────────────────────────────
 * 16 đơn nhóm B + C của audit C0 đã đóng ĐỦ tiền theo giá giảm (15% «đóng full»; một đơn 25% chính sách cũ) nhưng ghi danh vẫn mang GIÁ NIÊM YẾT (`finalPrice = listPrice`, `discountType` NULL) ⇒ công nợ hiện
 * nợ giả (đóng 8.976.000 / ghi danh đòi 10.560.000) hoặc, với 2 đơn nhóm C chưa gắn khoản, nợ cả học phí. Lệnh này đưa ghi danh về ĐÚNG giá đơn đã duyệt, bằng CHÍNH `computeEnrollmentPrice`:
 *     finalPrice = listPrice − discountAmount        và        tuition = finalPrice        (quy ước của `convertLeadV2`)
 *
 * ── CHỈ BỐN CỘT (`listPrice` ĐỌC-CHỈ theo mặc định) ─────────────────────────────────────────────────────────
 * `Enrollment.discountType` (NULL → PERCENT) · `discountAmount` · `finalPrice` · `tuition`. `listPrice` KHÔNG ghi: ghi danh phải đã mang đúng giá niêm yết đã audit, lệch ⇒ dừng.
 * NGOẠI LỆ DUY NHẤT, khai cứng bằng cờ `ghiListPrice` trên MỘT mã đơn (owner uỷ quyền 26/10/2026, «audit riêng»): ghi danh của đơn đó có CẢ NĂM cột giá NULL. `listPrice` chỉ được ghi nếu có đủ
 * nguồn duy nhất, bất biến, không mâu thuẫn: giá niêm yết = `Order.subtotal` = `OrderItem.unitPrice` (số lượng 1) = `Course.price` HIỆN TẠI, và `Course.updatedAt` TRƯỚC thời điểm tạo đơn
 * (giá khoá chưa đổi từ lúc bán). Thiếu một trong các điều kiện ⇒ dừng cả lô (đơn đó chuyển sang MANUAL REVIEW, lô còn 15).
 *
 * ── Bằng chứng giảm giá: HIGH hay không làm — hai nguồn, mỗi đơn khai MỘT, và phải khớp nhau ─────────────────────
 *   · ORDER — `Order.discountPercent` = % khai + `discountApprovalStatus = APPROVED` + `Order.discountAmount` = số tiền giảm tính bằng `computeEnrollmentPrice`.
 *   · ITEM  — `OrderItem.discounts` có ĐÚNG MỘT bản ghi có cấu trúc `kieu = PHAN_TRAM`, `phanTram` = % khai, `giam` = số tiền giảm tính được, `vuotTran = false`; `Order.discountPercent` NULL hoặc = %;
 *             `discountApprovalStatus` NULL hoặc APPROVED (thời kỳ đó mô hình KHÔNG dùng trường duyệt — owner chốt 26/10/2026: không đòi APPROVED).
 *   Cả hai nguồn: `Order.subtotal` = giá niêm yết · `Order.totalAmount` = giá đích · `Order.discountAmount` = số tiền giảm · Σ Payment sống = giá đích (đóng đủ) · mọi khoản RECORDED + CONFIRMED + PAYMENT, không bút toán điều chỉnh ·
 *   Σ phân bổ ngân hàng ĐÃ KHỚP = giá đích · khoản đã gắn ghi danh nào thì phải gắn ĐÚNG ghi danh này. Học bổng / chỉnh tay (`discountType` khác NULL ở snapshot) ⇒ GIA_TROI ⇒ dừng.
 *
 * ── Tiền đề: C-A đã xong ──────────────────────────────────────────────────────────────────────────────────────
 * Đơn + dòng đơn đã gắn học viên + ghi danh (`Order.studentId` = `OrderItem.studentId` = `Enrollment.studentId`), ghi danh còn hiệu lực, đúng khoá + cơ sở. Chưa xong ⇒ DON_CHUA_GAN_DANH_TINH ⇒ dừng.
 *
 * ── Fail-closed ───────────────────────────────────────────────────────────────────────────────────────────────
 * MỘT ghi danh lệch bất kỳ điều kiện nào ⇒ dừng CẢ LÔ. Hai trạng thái hợp lệ: «cả lô còn đúng snapshot legacy đã audit» (ghi N) hoặc «cả lô đã ĐÚNG giá đích» (chạy lại — ghi 0). Lô lai ⇒ dừng.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { computeDebt } from "@/lib/finance/debt-pure";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";
import { tinhThucThu } from "@/lib/finance/thuc-thu";
import { docKhoaTrenDongWaveC, shaDongWaveC } from "./wave-c-chung";
import { TRANG_THAI_GHI_DANH_LOAI_WAVE_C } from "./wave-c-gan-danh-tinh";
import type { GiaGhiDanh } from "./sua-gia-ghi-danh";

export type { GiaGhiDanh };

export const KHUON_DONG_WAVE_C_B = "wave-c-sua-gia/v1";
export const LY_DO_WAVE_C_B = "PHASE C-B: chuẩn hóa giá ghi danh legacy theo đơn đã duyệt — chỉ đổi discountType / discountAmount / finalPrice / tuition (listPrice chỉ đọc)";
export const HANH_DONG_WAVE_C_B = "CHUAN_HOA_GIA_GHI_DANH_WAVE_C";
export const HANH_DONG_WAVE_C_B_LUOT = "CHUAN_HOA_GIA_GHI_DANH_WAVE_C_LUOT_CHAY";

export type NguonBangChungWaveCB = "ORDER" | "ITEM";

export type MucWaveCB = {
  /** Giá niêm yết ĐÚNG của khoá (cũng phải bằng `Order.subtotal`). */
  listPrice: number;
  /** Phần trăm giảm đã duyệt (15 hoặc 25). */
  phanTram: number;
  /** Nguồn bằng chứng giảm giá của đơn (xem đầu tệp). */
  nguon: NguonBangChungWaveCB;
  /** Giá đích đã audit (= `Order.totalAmount`) — điều kiện «đơn chưa trôi». PHẢI bằng giá tính từ `listPrice` + `phanTram`. */
  tongDon: number;
  /** Snapshot giá legacy ĐÃ AUDIT — điều kiện «chưa sửa». Khác snapshot này và khác giá đích ⇒ trôi ⇒ dừng. */
  truoc: GiaGhiDanh;
  /** Ngoại lệ DUY NHẤT được ghi `listPrice` (xem đầu tệp). */
  ghiListPrice?: true;
};

const LEGACY = (list: number): GiaGhiDanh => ({ listPrice: list, discountType: null, discountAmount: 0, tuition: list, finalPrice: list });
const TRONG: GiaGhiDanh = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };

/**
 * PHẠM VI CỨNG: đúng 15 mã đơn (nhóm B + C, audit C0 25/10/2026, trừ ORD-261013-000001 — chuyển lớp sau C-A, xem chú thích trong bảng). KHÔNG id học viên / ghi danh / khoản thu trong mã (gương CI công khai). Giá là con số niêm yết của khoá, không phải định danh.
 * Không có tham số dòng lệnh / ô workflow nào thêm, bớt hay đổi mã (lưới `[WCB-W*]`). Thứ tự = thứ tự báo cáo/ghi.
 */
export const BANG_WAVE_C_B: Readonly<Record<string, MucWaveCB>> = {
  "ORD-260908-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ORDER", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  "ORD-260908-000002": { listPrice: 10_560_000, phanTram: 15, nguon: "ORDER", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  // Nhóm C — chính sách cũ 25%.
  "ORD-260910-000004": { listPrice: 11_520_000, phanTram: 25, nguon: "ORDER", tongDon: 8_640_000, truoc: LEGACY(11_520_000) },
  "ORD-260910-000007": { listPrice: 13_440_000, phanTram: 15, nguon: "ORDER", tongDon: 11_424_000, truoc: LEGACY(13_440_000) },
  "ORD-260910-000009": { listPrice: 10_560_000, phanTram: 15, nguon: "ORDER", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  "ORD-260911-000001": { listPrice: 13_440_000, phanTram: 15, nguon: "ORDER", tongDon: 11_424_000, truoc: LEGACY(13_440_000) },
  "ORD-260912-000001": { listPrice: 11_520_000, phanTram: 15, nguon: "ORDER", tongDon: 9_792_000, truoc: LEGACY(11_520_000) },
  "ORD-260912-000002": { listPrice: 10_560_000, phanTram: 15, nguon: "ORDER", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  "ORD-260913-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ORDER", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  // Bảy đơn mà bằng chứng giảm giá nằm ở OrderItem.discounts (structured, PHAN_TRAM).
  "ORD-260920-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ITEM", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  "ORD-260929-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ITEM", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  "ORD-261001-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ITEM", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  "ORD-261004-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ITEM", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  // ORD-261013-000001 ĐÃ LOẠI khỏi phạm vi (owner chốt 27/10/2026): sau C-A đơn này phát sinh chuyển lớp thật — ghi danh được gắn nay TRANSFERRED, có ghi danh STUDYING mới. Ghi danh nào mang
  // nghĩa vụ tài chính là quyết định riêng ⇒ MANUAL_REVIEW (POST_APPLY_TRANSFER_ENROLLMENT_DECISION). KHÔNG thêm lại và KHÔNG nới `TRANG_THAI_GHI_DANH_LOAI_WAVE_C` để cho nó qua.
  "ORD-261016-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ITEM", tongDon: 8_976_000, truoc: LEGACY(10_560_000) },
  // Ghi danh mang CẢ NĂM cột giá NULL (STUDYING): ngoại lệ duy nhất được ghi cả `listPrice`, kèm bằng chứng nguồn giá riêng (xem đầu tệp).
  "ORD-261017-000001": { listPrice: 10_560_000, phanTram: 15, nguon: "ITEM", tongDon: 8_976_000, truoc: TRONG, ghiListPrice: true },
};
export const MA_DON_WAVE_C_B: readonly string[] = Object.keys(BANG_WAVE_C_B);

/** Giá ĐÍCH từ giá niêm yết — qua hàm chuẩn của hệ thống (`computeEnrollmentPrice`), cộng quy ước `tuition = finalPrice`. */
export function giaDichWaveCB(listPrice: number, phanTram: number): GiaGhiDanh {
  const g = computeEnrollmentPrice({ listPrice, discount: { type: "PERCENT", value: phanTram } });
  return { listPrice: g.listPrice, discountType: g.discountType, discountAmount: g.discountAmount, tuition: g.finalPrice, finalPrice: g.finalPrice };
}

export const MA_LOI_WAVE_C_B = {
  THIEU_DON: "THIEU_DON",
  KHONG_CO_MUC_TIEU: "KHONG_CO_MUC_TIEU",
  BANG_KHONG_NHAT_QUAN: "BANG_KHONG_NHAT_QUAN",
  DON_DA_XOA: "DON_DA_XOA",
  DON_KHONG_PHAI_KHOA_HOC: "DON_KHONG_PHAI_KHOA_HOC",
  SO_DONG_KHONG_DUNG: "SO_DONG_KHONG_DUNG",
  DON_CHUA_GAN_DANH_TINH: "DON_CHUA_GAN_DANH_TINH",
  GHI_DANH_DA_XOA: "GHI_DANH_DA_XOA",
  GHI_DANH_KHONG_HIEU_LUC: "GHI_DANH_KHONG_HIEU_LUC",
  GHI_DANH_LECH_HOC_VIEN: "GHI_DANH_LECH_HOC_VIEN",
  GHI_DANH_LECH_KHOA: "GHI_DANH_LECH_KHOA",
  GHI_DANH_LECH_CO_SO: "GHI_DANH_LECH_CO_SO",
  NIEM_YET_LECH: "NIEM_YET_LECH",
  TONG_DON_LECH: "TONG_DON_LECH",
  GIAM_GIA_DON_LECH: "GIAM_GIA_DON_LECH",
  PHAN_TRAM_DON_LECH: "PHAN_TRAM_DON_LECH",
  GIAM_GIA_BI_TU_CHOI: "GIAM_GIA_BI_TU_CHOI",
  GIAM_GIA_CHUA_DUYET: "GIAM_GIA_CHUA_DUYET",
  BANG_CHUNG_ITEM_LECH: "BANG_CHUNG_ITEM_LECH",
  KHONG_CO_PAYMENT: "KHONG_CO_PAYMENT",
  PAYMENT_KHONG_HOP_LE: "PAYMENT_KHONG_HOP_LE",
  PAYMENT_GAN_SAI_GHI_DANH: "PAYMENT_GAN_SAI_GHI_DANH",
  TIEN_PAYMENT_LECH: "TIEN_PAYMENT_LECH",
  TIEN_PHAN_BO_LECH: "TIEN_PHAN_BO_LECH",
  NGUON_NIEM_YET_KHONG_DU: "NGUON_NIEM_YET_KHONG_DU",
  GIA_TROI: "GIA_TROI",
  TRUNG_GHI_DANH: "TRUNG_GHI_DANH",
  LO_HON_HOP: "LO_HON_HOP",
} as const;
export type MaLoiWaveCB = (typeof MA_LOI_WAVE_C_B)[keyof typeof MA_LOI_WAVE_C_B];
export type LoiWaveCB = { code: string; ma: MaLoiWaveCB; chiTiet: string };

export type DuLieuWaveCB = {
  don: {
    id: string;
    code: string;
    type: string;
    deletedAt: Date | null;
    createdAt: Date;
    studentId: string | null;
    centerId: string | null;
    subtotal: number;
    discountAmount: number;
    discountPercent: number | null;
    totalAmount: number;
    discountApprovalStatus: string | null;
    items: readonly {
      id: string;
      type: string;
      studentId: string | null;
      enrollmentId: string | null;
      metadata: unknown;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      discountAmount: number | null;
      discountPercent: number | null;
      discounts: unknown;
    }[];
  };
  /** Ghi danh mà dòng đơn trỏ tới (kết quả C-A); `null` = dòng đơn chưa trỏ / không đọc được. */
  ghiDanh: {
    id: string;
    studentId: string;
    courseId: string | null;
    status: string;
    centerId: string | null;
    deletedAt: Date | null;
    gia: GiaGhiDanh;
  } | null;
  /** Khoá học của dòng đơn (để chứng minh nguồn `listPrice` của ngoại lệ). */
  khoa: { id: string; price: number | null; updatedAt: Date } | null;
  /** Payment SỐNG (deletedAt = null) của đơn. */
  paymentSong: readonly {
    id: string;
    amount: number;
    paymentType: string;
    saleStatus: string;
    accountantStatus: string;
    adjustmentOfId: string | null;
    enrollmentId: string | null;
    centerId: string | null;
  }[];
  /** Σ phân bổ ngân hàng ĐÃ KHỚP (MATCHED) vào các phiếu thu của đơn. */
  tongPhanBoNganHang: number;
};

export type TrangThaiWaveCB = "CHUA_SUA" | "DA_SUA" | "LECH";

export type DongGhiWaveCB = {
  orderId: string;
  code: string;
  enrollmentId: string;
  truoc: GiaGhiDanh;
  sau: GiaGhiDanh;
  ghiListPrice: boolean;
};

export type MucKeHoachWaveCB = {
  code: string;
  trangThai: TrangThaiWaveCB;
  dong: DongGhiWaveCB | null;
  tongDon: number | null;
  tongPayment: number | null;
  tongPhanBo: number | null;
  /** Nợ hiện tại của ghi danh theo hàm công nợ của repo trên khoản ĐÃ GẮN ghi danh này (nợ giả cần xoá). */
  noHienTai: number | null;
  /** Nợ SAU C-B (giá đích, khoản đã gắn như hiện tại): 0 cho đơn đã gắn đủ khoản; đơn nhóm C còn nợ cho tới khi C-C gắn khoản. */
  noSauSua: number | null;
  /** Nợ dự kiến NẾU mọi khoản sống của đơn được gắn ghi danh này, với giá đích (0 là đích). */
  noDuKien: number | null;
  loi: readonly LoiWaveCB[];
};

export type KeHoachWaveCB = {
  muc: readonly MucKeHoachWaveCB[];
  loi: readonly LoiWaveCB[];
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  ghi: readonly DongGhiWaveCB[];
  /** Cả lô đã ở giá đích (chạy lại) ⇒ 0 dòng ghi. */
  daSuaHet: boolean;
  dongDauRa: readonly string[];
  sha: string;
  /** Σ nợ giả TRƯỚC (tính trên khoản đã gắn) — báo cáo `FAKE_DEBT_BEFORE`. */
  noGiaTruoc: number;
  /** Σ nợ giả SAU (với giá đích, khoản đã gắn) — báo cáo `FAKE_DEBT_AFTER`. */
  noGiaSau: number;
};

const cungGia = (a: GiaGhiDanh, b: GiaGhiDanh) =>
  a.listPrice === b.listPrice && a.discountType === b.discountType && a.discountAmount === b.discountAmount && a.tuition === b.tuition && a.finalPrice === b.finalPrice;

export const chuoiGiaWaveCB = (g: GiaGhiDanh) => [g.listPrice ?? "NULL", g.discountType ?? "NULL", g.discountAmount ?? "NULL", g.tuition ?? "NULL", g.finalPrice ?? "NULL"].join("/");

/** MỘT dòng/ghi danh: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Ràng cả giá TRƯỚC lẫn SAU. Không chứa tên/SĐT/email. */
export function dongDauRaWaveCB(ghi: readonly DongGhiWaveCB[]): string[] {
  return ghi.map((g) => [KHUON_DONG_WAVE_C_B, g.orderId, g.code, g.enrollmentId, chuoiGiaWaveCB(g.truoc), chuoiGiaWaveCB(g.sau), g.ghiListPrice ? "GHI_LIST" : "CHI_DOC_LIST"].join("|"));
}

const loi = (code: string, ma: MaLoiWaveCB, chiTiet: string): LoiWaveCB => ({ code, ma, chiTiet });

/** `OrderItem.discounts` (Json) → mảng bản ghi; không phải mảng ⇒ rỗng. */
function docBanGhiGiam(discounts: unknown): Record<string, unknown>[] {
  if (!Array.isArray(discounts)) return [];
  return discounts.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x));
}

function kiemMotGhiDanh(d: DuLieuWaveCB, muc: MucWaveCB, code: string): MucKeHoachWaveCB {
  const { don } = d;
  const l: LoiWaveCB[] = [];
  const them = (ma: MaLoiWaveCB, chiTiet: string) => l.push(loi(code, ma, chiTiet));
  const dich = giaDichWaveCB(muc.listPrice, muc.phanTram);

  // ── bảng tự nhất quán (lỗi cấu hình, không phải lỗi dữ liệu) ──
  if (dich.finalPrice !== muc.tongDon) them("BANG_KHONG_NHAT_QUAN", `giá đích tính được ${dich.finalPrice} ≠ tongDon ${muc.tongDon} của bảng`);
  if (muc.ghiListPrice !== true && muc.truoc.listPrice !== muc.listPrice) them("BANG_KHONG_NHAT_QUAN", "đơn không thuộc ngoại lệ ghi listPrice nhưng snapshot legacy mang listPrice khác giá niêm yết");

  // ── đơn ──
  if (don.deletedAt !== null) them("DON_DA_XOA", "đơn đã bị xoá mềm");
  if (don.type !== "COURSE") them("DON_KHONG_PHAI_KHOA_HOC", `loại đơn «${don.type}» ≠ COURSE`);
  const dongKhoa = don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (don.items.length !== 1 || dongKhoa.length !== 1) {
    them("SO_DONG_KHONG_DUNG", `đơn phải có ĐÚNG 1 dòng và dòng đó là COURSE_ENROLLMENT (đang có ${don.items.length} dòng, ${dongKhoa.length} dòng COURSE_ENROLLMENT)`);
  }
  const dong = dongKhoa.length === 1 ? dongKhoa[0]! : null;

  // ── C-A đã gắn đúng ──
  const ge = d.ghiDanh;
  if (dong === null || dong.enrollmentId === null || dong.studentId === null || don.studentId === null || ge === null || ge.id !== dong.enrollmentId) {
    them("DON_CHUA_GAN_DANH_TINH", "đơn / dòng đơn chưa gắn học viên + ghi danh từ C-A (hoặc không đọc được ghi danh)");
  } else {
    if (ge.deletedAt !== null) them("GHI_DANH_DA_XOA", "ghi danh đã xoá mềm");
    if ((TRANG_THAI_GHI_DANH_LOAI_WAVE_C as readonly string[]).includes(ge.status)) them("GHI_DANH_KHONG_HIEU_LUC", `ghi danh ở trạng thái «${ge.status}»`);
    if (ge.studentId !== don.studentId || ge.studentId !== dong.studentId) them("GHI_DANH_LECH_HOC_VIEN", "Enrollment.studentId ≠ Order.studentId / OrderItem.studentId");
    const khoa = docKhoaTrenDongWaveC(dong.metadata);
    if (khoa === null || ge.courseId !== khoa) them("GHI_DANH_LECH_KHOA", `ghi danh khoá ${ge.courseId ?? "NULL"} ≠ khoá trên dòng đơn ${khoa ?? "NULL"}`);
    if (ge.centerId === null || ge.centerId !== don.centerId) them("GHI_DANH_LECH_CO_SO", `ghi danh khác cơ sở với đơn (${ge.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
  }

  // ── đơn phải ĐÚNG giá đích ──
  if (don.subtotal !== muc.listPrice) them("NIEM_YET_LECH", `Order.subtotal ${don.subtotal} ≠ giá niêm yết ${muc.listPrice}`);
  if (don.totalAmount !== muc.tongDon) them("TONG_DON_LECH", `Order.totalAmount ${don.totalAmount} ≠ giá đích ${muc.tongDon}`);
  if (don.discountAmount !== dich.discountAmount) them("GIAM_GIA_DON_LECH", `Order.discountAmount ${don.discountAmount} ≠ giảm đích ${dich.discountAmount}`);
  if (don.discountApprovalStatus === "REJECTED") them("GIAM_GIA_BI_TU_CHOI", "giảm giá của đơn đã bị TỪ CHỐI");

  // ── bằng chứng giảm giá theo nguồn đã khai ──
  if (muc.nguon === "ORDER") {
    if (don.discountPercent !== muc.phanTram) them("PHAN_TRAM_DON_LECH", `Order.discountPercent ${don.discountPercent ?? "NULL"} ≠ ${muc.phanTram}`);
    if (don.discountApprovalStatus !== "APPROVED") them("GIAM_GIA_CHUA_DUYET", `giảm giá của đơn ở trạng thái «${don.discountApprovalStatus ?? "NULL"}» ≠ APPROVED`);
  } else {
    if (don.discountPercent !== null && don.discountPercent !== muc.phanTram) them("PHAN_TRAM_DON_LECH", `Order.discountPercent ${don.discountPercent} ≠ ${muc.phanTram}`);
    if (don.discountApprovalStatus !== null && don.discountApprovalStatus !== "APPROVED") them("GIAM_GIA_CHUA_DUYET", `giảm giá của đơn ở trạng thái «${don.discountApprovalStatus}» (chỉ chấp nhận NULL hoặc APPROVED)`);
    const bg = dong === null ? [] : docBanGhiGiam(dong.discounts);
    const b = bg.length === 1 ? bg[0]! : null;
    if (
      dong === null ||
      b === null ||
      b.kieu !== "PHAN_TRAM" ||
      b.phanTram !== muc.phanTram ||
      b.giam !== dich.discountAmount ||
      b.vuotTran !== false ||
      dong.discountAmount !== dich.discountAmount ||
      dong.discountPercent !== muc.phanTram
    ) {
      them(
        "BANG_CHUNG_ITEM_LECH",
        `OrderItem.discounts phải có ĐÚNG 1 bản ghi PHAN_TRAM ${muc.phanTram}% giảm ${dich.discountAmount}, không vượt trần; dòng đơn giảm ${dich.discountAmount} (${muc.phanTram}%) — đang có ${bg.length} bản ghi`,
      );
    }
  }

  // ── tiền: đóng đủ đúng giá đích, mọi khoản hợp lệ, khoản đã gắn thì gắn ĐÚNG ghi danh ──
  const song = d.paymentSong;
  if (song.length === 0) them("KHONG_CO_PAYMENT", "đơn không có Payment sống");
  for (const p of song) {
    if (p.paymentType !== "PAYMENT" || p.saleStatus !== "RECORDED" || p.accountantStatus !== "CONFIRMED" || p.adjustmentOfId !== null) {
      them("PAYMENT_KHONG_HOP_LE", `khoản ${p.id}: ${p.paymentType}/${p.saleStatus}/${p.accountantStatus}${p.adjustmentOfId ? " (bút toán điều chỉnh)" : ""} — đòi PAYMENT/RECORDED/CONFIRMED, không điều chỉnh`);
    }
    if (p.enrollmentId !== null && ge !== null && p.enrollmentId !== ge.id) them("PAYMENT_GAN_SAI_GHI_DANH", `khoản ${p.id} đã gắn ghi danh KHÁC ghi danh của đơn`);
  }
  const tongKhoan = song.reduce((s, p) => s + p.amount, 0);
  if (tongKhoan !== dich.finalPrice) them("TIEN_PAYMENT_LECH", `Σ Payment sống ${tongKhoan} ≠ giá đích ${dich.finalPrice} (đơn phải đóng ĐỦ)`);
  if (d.tongPhanBoNganHang !== dich.finalPrice) them("TIEN_PHAN_BO_LECH", `Σ phân bổ ngân hàng ${d.tongPhanBoNganHang} ≠ giá đích ${dich.finalPrice}`);

  // ── ngoại lệ listPrice: nguồn giá DUY NHẤT, bất biến, không mâu thuẫn ──
  if (muc.ghiListPrice === true) {
    const ct = d.khoa;
    const ok =
      dong !== null &&
      ct !== null &&
      ct.price === muc.listPrice &&
      ct.updatedAt.getTime() < don.createdAt.getTime() &&
      dong.unitPrice === muc.listPrice &&
      dong.quantity === 1 &&
      dong.totalPrice === muc.listPrice &&
      don.subtotal === muc.listPrice;
    if (!ok) {
      them(
        "NGUON_NIEM_YET_KHONG_DU",
        `không chứng minh được giá niêm yết ${muc.listPrice} từ nguồn duy nhất (đòi Course.price = Order.subtotal = OrderItem.unitPrice = giá, số lượng 1, và Course.updatedAt TRƯỚC thời điểm tạo đơn) — chuyển MANUAL REVIEW`,
      );
    }
  }

  // ── nợ: hiện tại (khoản đã gắn) và dự kiến (nếu mọi khoản sống gắn ghi danh này) ──
  const tt = (ds: typeof song) => tinhThucThu(ds.map((p) => ({ id: p.id, amount: p.amount, accountantStatus: p.accountantStatus, adjustmentOfId: p.adjustmentOfId })));
  const daGan = ge === null ? [] : song.filter((p) => p.enrollmentId === ge.id);
  const noHienTai = ge === null ? null : computeDebt(ge.gia.finalPrice ?? 0, tt(daGan));
  const noSauSua = ge === null ? null : computeDebt(dich.finalPrice ?? 0, tt(daGan));
  const noDuKien = computeDebt(dich.finalPrice ?? 0, tt(song));

  // ── giá hiện tại: đúng snapshot legacy đã audit HOẶC đúng giá đích ──
  let trangThai: TrangThaiWaveCB = "LECH";
  let dongKq: DongGhiWaveCB | null = null;
  if (ge !== null) {
    const hienTai = ge.gia;
    const sau: GiaGhiDanh = muc.ghiListPrice === true ? dich : { ...dich, listPrice: hienTai.listPrice };
    if (cungGia(hienTai, muc.truoc)) trangThai = "CHUA_SUA";
    else if (cungGia(hienTai, dich)) trangThai = "DA_SUA";
    else them("GIA_TROI", `giá ghi danh hiện tại (${chuoiGiaWaveCB(hienTai)}) không phải snapshot legacy đã audit (${chuoiGiaWaveCB(muc.truoc)}) cũng không phải giá đích (${chuoiGiaWaveCB(dich)})`);
    dongKq = { orderId: don.id, code, enrollmentId: ge.id, truoc: hienTai, sau, ghiListPrice: muc.ghiListPrice === true };
  }
  return {
    code,
    trangThai: l.length > 0 ? "LECH" : trangThai,
    dong: dongKq,
    tongDon: don.totalAmount,
    tongPayment: tongKhoan,
    tongPhanBo: d.tongPhanBoNganHang,
    noHienTai,
    noSauSua,
    noDuKien,
    loi: l,
  };
}

/**
 * Lập kế hoạch cho cả lô. `bang` là phạm vi CỨNG (thứ tự = thứ tự báo cáo/ghi). Mọi mã phải có đúng một đơn trong dữ liệu.
 * Fail-closed: bất kỳ lỗi nào ⇒ `dung` và `ghi = []`.
 */
export function lapKeHoachWaveCB(input: { bang: Readonly<Record<string, MucWaveCB>>; du: readonly DuLieuWaveCB[] }): KeHoachWaveCB {
  const loiLo: LoiWaveCB[] = [];
  const muc: MucKeHoachWaveCB[] = [];
  const ma = Object.keys(input.bang);
  for (const code of ma) {
    const cac = input.du.filter((x) => x.don.code === code);
    if (cac.length !== 1) {
      loiLo.push(loi(code, "THIEU_DON", cac.length === 0 ? "không có đơn mang mã này" : `${cac.length} đơn cùng mã`));
      muc.push({ code, trangThai: "LECH", dong: null, tongDon: null, tongPayment: null, tongPhanBo: null, noHienTai: null, noSauSua: null, noDuKien: null, loi: [loi(code, "THIEU_DON", `đọc được ${cac.length} đơn`)] });
      continue;
    }
    muc.push(kiemMotGhiDanh(cac[0]!, input.bang[code]!, code));
  }
  for (const x of input.du) if (!(x.don.code in input.bang)) loiLo.push(loi(x.don.code, "KHONG_CO_MUC_TIEU", "đơn nằm NGOÀI phạm vi cứng"));

  // Hai đơn trỏ cùng một ghi danh.
  const dem = new Map<string, string[]>();
  for (const m of muc) if (m.dong) dem.set(m.dong.enrollmentId, [...(dem.get(m.dong.enrollmentId) ?? []), m.code]);
  for (const [id, codes] of dem) if (codes.length > 1) loiLo.push(loi(codes.join(","), "TRUNG_GHI_DANH", `ghi danh ${id} là đích của ${codes.length} đơn`));

  const loiTungDon = muc.flatMap((m) => m.loi);
  const chua = muc.filter((m) => m.trangThai === "CHUA_SUA").length;
  const da = muc.filter((m) => m.trangThai === "DA_SUA").length;
  if (loiTungDon.length === 0 && loiLo.length === 0 && chua > 0 && da > 0) {
    loiLo.push(loi(ma.join(","), "LO_HON_HOP", `${chua} ghi danh chưa sửa + ${da} đã ở giá đích — lô lai, không ghi`));
  }
  const tatCaLoi = [...loiTungDon, ...loiLo];
  const dung = tatCaLoi.length > 0;
  const ghi = dung ? [] : muc.filter((m) => m.trangThai === "CHUA_SUA").map((m) => m.dong!);
  const dongDauRa = dongDauRaWaveCB(ghi);
  const noGiaTruoc = muc.reduce((s, m) => s + (m.noHienTai ?? 0), 0);
  const noGiaSau = muc.reduce((s, m) => s + (m.noSauSua ?? 0), 0);
  return { muc, loi: tatCaLoi, dung, ghi, daSuaHet: !dung && muc.length > 0 && da === muc.length, dongDauRa, sha: shaDongWaveC(dongDauRa), noGiaTruoc, noGiaSau };
}
