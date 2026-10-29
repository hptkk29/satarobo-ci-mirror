/**
 * lib/nguon/sua-gia-ghi-danh.ts — LÕI THUẦN của «chuẩn hoá GIÁ GHI DANH cho 6 đơn sống» (Wave 1, PHASE B.1, 24/10/2026).
 *
 * ── Quyết định của owner (24/10/2026) ───────────────────────────────────────────────────────────────────────
 * Chính sách áp dụng cho cả 6 đơn: «Đóng full khóa học giảm 15%». Ghi danh lưu `discountType = PERCENT`; số tiền giảm TÍNH từ giá niêm yết
 * bằng CHÍNH `computeEnrollmentPrice` (`lib/finance/pricing.ts`) — không tự nhân % ở đây. Sau ghi luôn có:
 *     finalPrice = listPrice − discountAmount        và        tuition = finalPrice   (quy ước của `convertLeadV2`)
 *   5 đơn Sata3:  10.560.000 − 1.584.000 = 8.976.000
 *   ORD-260910-000006 (Sata4): 11.520.000 − 1.728.000 = 9.792.000; `SCHOLARSHIP_FULL` hiện tại được coi là DỮ LIỆU LEGACY SAI (không phải học bổng 100%).
 *
 * ── Schema thật (đã kiểm trên PROD 24/10/2026) ──────────────────────────────────────────────────────────────
 * `Enrollment` có đúng NĂM cột giá: `listPrice` · `discountType` (text) · `discountAmount` · `tuition` · `finalPrice`. KHÔNG có cột `discountPercent`
 * (15% sống ở `Order.discountPercent`; ghi danh chỉ lưu PERCENT + số tiền) và KHÔNG có cột học bổng riêng: «học bổng» CHỈ là `discountType = 'SCHOLARSHIP'`
 * cộng `discountAmount`. Vậy «bỏ nghĩa học bổng» = đổi `discountType` sang PERCENT và đặt lại `discountAmount` — hai cột này nằm sẵn trong bộ cột được ghi.
 * Ràng buộc DB duy nhất: `finalPrice ≥ 0`. Không trigger.
 *
 * ── Phép ghi: BỐN cột, mỗi ghi danh ────────────────────────────────────────────────────────────────────────
 * `discountType` · `discountAmount` · `finalPrice` · `tuition`. `listPrice` KHÔNG ghi (phải đã đúng giá niêm yết — lõi từ chối nếu khác). Không đụng Order,
 * Payment, BankTransaction, `leadId`, hoa hồng, `Payment.enrollmentId`, Receipt.
 *
 * ── Fail-closed ────────────────────────────────────────────────────────────────────────────────────────────
 * Một ghi danh lệch bất kỳ điều kiện nào ⇒ dừng CẢ LÔ. Trạng thái hợp lệ duy nhất của cả lô: «cả 6 còn đúng snapshot legacy đã audit» (ghi 6)
 * hoặc «cả 6 đã ĐÚNG giá đích» (chạy lại — ghi 0). Lô lai ⇒ dừng. Snapshot legacy là giá trị đã audit; khác đi (ai đó sửa giữa chừng) ⇒ dừng.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { createHash } from "node:crypto";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

export const PHAN_TRAM_GIAM = 15;
export const LY_DO_SUA_GIA = "Chuẩn hóa giá legacy theo đơn đã duyệt — đóng full khóa học giảm 15%";
export const KHUON_DONG_SUA_GIA = "sua-gia-ghi-danh/v1";

/** Năm cột giá của `Enrollment` (null = cột đang NULL). */
export type GiaGhiDanh = {
  listPrice: number | null;
  discountType: string | null;
  discountAmount: number | null;
  tuition: number | null;
  finalPrice: number | null;
};

export type MucTieuSuaGia = {
  /** Giá niêm yết ĐÚNG của khoá (cũng phải bằng `Order.subtotal`). */
  listPrice: number;
  /** Snapshot giá legacy ĐÃ AUDIT (24/10/2026) — điều kiện «chưa sửa». Khác snapshot này và khác giá đích ⇒ trôi ⇒ dừng. */
  truoc: GiaGhiDanh;
};

const LEGACY_SATA3: GiaGhiDanh = { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };

/**
 * PHẠM VI CỨNG: đúng sáu mã đơn chủ dự án chốt. Script truyền hằng này; không có tham số dòng lệnh / ô workflow nào thêm, bớt hay đổi mã (lưới `[SGG-W*]`).
 * Thứ tự = thứ tự báo cáo/ghi.
 */
export const BANG_SUA_GIA: Readonly<Record<string, MucTieuSuaGia>> = {
  "ORD-260831-000001": { listPrice: 10_560_000, truoc: LEGACY_SATA3 },
  "ORD-260908-000003": { listPrice: 10_560_000, truoc: LEGACY_SATA3 },
  "ORD-260910-000002": { listPrice: 10_560_000, truoc: LEGACY_SATA3 },
  "ORD-260910-000005": { listPrice: 10_560_000, truoc: LEGACY_SATA3 },
  // Sata4: ghi danh đang mang «học bổng toàn phần» legacy (SCHOLARSHIP / giảm 100% / tuition 0 / finalPrice 0).
  "ORD-260910-000006": { listPrice: 11_520_000, truoc: { listPrice: 11_520_000, discountType: "SCHOLARSHIP", discountAmount: 11_520_000, tuition: 0, finalPrice: 0 } },
  "ORD-260910-000008": { listPrice: 10_560_000, truoc: LEGACY_SATA3 },
};
export const MA_DON_SUA_GIA: readonly string[] = Object.keys(BANG_SUA_GIA);

/** Giá ĐÍCH từ giá niêm yết — qua hàm chuẩn của hệ thống (`computeEnrollmentPrice`), cộng quy ước `tuition = finalPrice`. */
export function giaDichTuNiemYet(listPrice: number): GiaGhiDanh {
  const g = computeEnrollmentPrice({ listPrice, discount: { type: "PERCENT", value: PHAN_TRAM_GIAM } });
  return { listPrice: g.listPrice, discountType: g.discountType, discountAmount: g.discountAmount, tuition: g.finalPrice, finalPrice: g.finalPrice };
}

export const MA_LOI_SUA_GIA = {
  THIEU_DON: "THIEU_DON",
  KHONG_CO_MUC_TIEU: "KHONG_CO_MUC_TIEU",
  DON_DA_XOA: "DON_DA_XOA",
  DON_KHONG_PHAI_KHOA_HOC: "DON_KHONG_PHAI_KHOA_HOC",
  SO_DONG_KHONG_DUNG: "SO_DONG_KHONG_DUNG",
  DON_CHUA_GAN_DANH_TINH: "DON_CHUA_GAN_DANH_TINH",
  KHONG_CO_GHI_DANH: "KHONG_CO_GHI_DANH",
  GHI_DANH_DA_XOA: "GHI_DANH_DA_XOA",
  GHI_DANH_KHONG_ACTIVE: "GHI_DANH_KHONG_ACTIVE",
  GHI_DANH_LECH_HOC_VIEN: "GHI_DANH_LECH_HOC_VIEN",
  GHI_DANH_LECH_KHOA: "GHI_DANH_LECH_KHOA",
  GHI_DANH_LECH_BE: "GHI_DANH_LECH_BE",
  GHI_DANH_LECH_CO_SO: "GHI_DANH_LECH_CO_SO",
  NIEM_YET_LECH: "NIEM_YET_LECH",
  TONG_DON_LECH: "TONG_DON_LECH",
  GIAM_GIA_DON_LECH: "GIAM_GIA_DON_LECH",
  GIAM_GIA_CHUA_DUYET: "GIAM_GIA_CHUA_DUYET",
  PHAN_TRAM_DON_LECH: "PHAN_TRAM_DON_LECH",
  KHONG_CO_PAYMENT: "KHONG_CO_PAYMENT",
  TIEN_PAYMENT_LECH: "TIEN_PAYMENT_LECH",
  TIEN_PHAN_BO_LECH: "TIEN_PHAN_BO_LECH",
  PAYMENT_DA_GAN_GHI_DANH: "PAYMENT_DA_GAN_GHI_DANH",
  CO_HOA_HONG_LIEN_QUAN: "CO_HOA_HONG_LIEN_QUAN",
  GIA_TROI: "GIA_TROI",
  LO_HON_HOP: "LO_HON_HOP",
  TRUNG_GHI_DANH: "TRUNG_GHI_DANH",
} as const;
export type MaLoiSuaGia = (typeof MA_LOI_SUA_GIA)[keyof typeof MA_LOI_SUA_GIA];
export type LoiSuaGia = { code: string; ma: MaLoiSuaGia; chiTiet: string };

export type DuLieuSuaGia = {
  don: {
    id: string;
    code: string;
    type: string;
    deletedAt: Date | null;
    studentId: string | null;
    leadChildId: string | null;
    centerId: string | null;
    subtotal: number;
    discountAmount: number;
    discountPercent: number | null;
    totalAmount: number;
    discountApprovalStatus: string | null;
    items: readonly { id: string; type: string; studentId: string | null; enrollmentId: string | null; metadata: unknown }[];
  };
  /** Ghi danh mà dòng đơn trỏ tới (kết quả PHASE A); `null` = dòng đơn chưa trỏ / không đọc được. */
  ghiDanh: {
    id: string;
    studentId: string;
    courseId: string | null;
    status: string;
    leadChildId: string | null;
    centerId: string | null;
    deletedAt: Date | null;
    gia: GiaGhiDanh;
  } | null;
  soPaymentSong: number;
  tongPaymentSong: number;
  /** Σ phân bổ ngân hàng ĐÃ KHỚP (MATCHED) vào các phiếu thu của đơn. */
  tongPhanBoNganHang: number;
  /** Số Payment sống của đơn ĐÃ có `enrollmentId` (PHASE B.2 chưa làm ⇒ phải = 0). */
  soPaymentDaGanGhiDanh: number;
  /** Số dòng hoa hồng (CommissionLine + CommissionTransaction) tham chiếu đơn / ghi danh / học viên / lead này. */
  soHoaHongLienQuan: number;
};

export type TrangThaiSuaGia = "CHUA_SUA" | "DA_SUA" | "LECH";

export type DongSuaGia = {
  orderId: string;
  code: string;
  enrollmentId: string;
  truoc: GiaGhiDanh;
  sau: GiaGhiDanh;
};

export type MucKeHoachSuaGia = {
  code: string;
  trangThai: TrangThaiSuaGia;
  /** `null` nếu chưa dựng được. */
  dong: DongSuaGia | null;
  /** Số liệu để báo cáo (có cả khi lỗi, nếu đọc được). */
  tongDon: number | null;
  tongPayment: number | null;
  tongPhanBo: number | null;
  /** Công nợ dự kiến NẾU sau này gắn Payment (PHASE B.2) = finalPrice đích − Σ Payment. 0 là đích mong muốn. */
  noDuKienSauGan: number | null;
  loi: readonly LoiSuaGia[];
};

export type KeHoachSuaGia = {
  muc: readonly MucKeHoachSuaGia[];
  loi: readonly LoiSuaGia[];
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  ghi: readonly DongSuaGia[];
  /** Cả lô đã ở giá đích (chạy lại) ⇒ 0 dòng ghi. */
  daSuaHet: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

const cungGia = (a: GiaGhiDanh, b: GiaGhiDanh) =>
  a.listPrice === b.listPrice && a.discountType === b.discountType && a.discountAmount === b.discountAmount && a.tuition === b.tuition && a.finalPrice === b.finalPrice;

const chuoiGia = (g: GiaGhiDanh) => [g.listPrice ?? "NULL", g.discountType ?? "NULL", g.discountAmount ?? "NULL", g.tuition ?? "NULL", g.finalPrice ?? "NULL"].join("/");

/** MỘT dòng/ghi danh: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Ràng cả giá TRƯỚC lẫn SAU. Không chứa tên/SĐT/email. */
export function dongDauRaSuaGia(ghi: readonly DongSuaGia[]): string[] {
  return ghi.map((g) => [KHUON_DONG_SUA_GIA, g.orderId, g.code, g.enrollmentId, chuoiGia(g.truoc), chuoiGia(g.sau)].join("|"));
}
export const shaKeHoachSuaGia = (dong: readonly string[]) => createHash("sha256").update(dong.join("\n"), "utf8").digest("hex");

/** `metadata.courseId` của dòng đơn; không có / không phải chuỗi ⇒ `null`. */
export function docKhoaTrenDongSuaGia(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).courseId;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

const loi = (code: string, ma: MaLoiSuaGia, chiTiet: string): LoiSuaGia => ({ code, ma, chiTiet });

function kiemMotGhiDanh(d: DuLieuSuaGia, muc: MucTieuSuaGia): MucKeHoachSuaGia {
  const { don } = d;
  const code = don.code;
  const l: LoiSuaGia[] = [];
  const them = (ma: MaLoiSuaGia, chiTiet: string) => l.push(loi(code, ma, chiTiet));
  const dich = giaDichTuNiemYet(muc.listPrice);

  // ── đơn ──
  if (don.deletedAt !== null) them("DON_DA_XOA", "đơn đã bị xoá mềm");
  if (don.type !== "COURSE") them("DON_KHONG_PHAI_KHOA_HOC", `loại đơn «${don.type}» ≠ COURSE`);
  const dongKhoa = don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (don.items.length !== 1 || dongKhoa.length !== 1) {
    them("SO_DONG_KHONG_DUNG", `đơn phải có ĐÚNG 1 dòng và dòng đó là COURSE_ENROLLMENT (đang có ${don.items.length} dòng, ${dongKhoa.length} dòng COURSE_ENROLLMENT)`);
  }
  const dong = dongKhoa.length === 1 ? dongKhoa[0]! : null;

  // ── PHASE A đã gắn đúng ──
  const ge = d.ghiDanh;
  if (dong === null || dong.enrollmentId === null || dong.studentId === null || don.studentId === null || ge === null || ge.id !== dong.enrollmentId) {
    them("DON_CHUA_GAN_DANH_TINH", "đơn / dòng đơn chưa gắn học viên + ghi danh từ PHASE A (hoặc không đọc được ghi danh)");
  } else {
    if (ge.deletedAt !== null) them("GHI_DANH_DA_XOA", "ghi danh đã xoá mềm");
    if (ge.status !== "ACTIVE") them("GHI_DANH_KHONG_ACTIVE", `ghi danh ở trạng thái «${ge.status}»`);
    if (ge.studentId !== don.studentId || ge.studentId !== dong.studentId) them("GHI_DANH_LECH_HOC_VIEN", "Enrollment.studentId ≠ Order.studentId / OrderItem.studentId");
    const khoa = docKhoaTrenDongSuaGia(dong.metadata);
    if (khoa === null || ge.courseId !== khoa) them("GHI_DANH_LECH_KHOA", `ghi danh khoá ${ge.courseId ?? "NULL"} ≠ khoá trên dòng đơn ${khoa ?? "NULL"}`);
    if (ge.leadChildId !== don.leadChildId) them("GHI_DANH_LECH_BE", "Enrollment.leadChildId ≠ Order.leadChildId");
    if (ge.centerId === null || ge.centerId !== don.centerId) them("GHI_DANH_LECH_CO_SO", `ghi danh khác cơ sở với đơn (${ge.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
  }

  // ── đơn phải ĐÚNG giá đích + giảm 15% đã duyệt ──
  if (don.subtotal !== muc.listPrice) them("NIEM_YET_LECH", `Order.subtotal ${don.subtotal} ≠ giá niêm yết ${muc.listPrice}`);
  if (don.totalAmount !== dich.finalPrice) them("TONG_DON_LECH", `Order.totalAmount ${don.totalAmount} ≠ giá đích ${dich.finalPrice}`);
  if (don.discountAmount !== dich.discountAmount) them("GIAM_GIA_DON_LECH", `Order.discountAmount ${don.discountAmount} ≠ giảm đích ${dich.discountAmount}`);
  if (don.discountPercent !== PHAN_TRAM_GIAM) them("PHAN_TRAM_DON_LECH", `Order.discountPercent ${don.discountPercent ?? "NULL"} ≠ ${PHAN_TRAM_GIAM}`);
  if (don.discountApprovalStatus !== "APPROVED") them("GIAM_GIA_CHUA_DUYET", `giảm giá của đơn ở trạng thái «${don.discountApprovalStatus ?? "NULL"}» ≠ APPROVED`);

  // ── tiền: Payment sống = tổng đơn = phân bổ ngân hàng MATCHED; chưa gắn Payment ──
  if (d.soPaymentSong === 0) them("KHONG_CO_PAYMENT", "đơn không có Payment sống");
  if (d.tongPaymentSong !== don.totalAmount) them("TIEN_PAYMENT_LECH", `Σ Payment sống ${d.tongPaymentSong} ≠ tổng đơn ${don.totalAmount}`);
  if (d.tongPhanBoNganHang !== don.totalAmount) them("TIEN_PHAN_BO_LECH", `Σ phân bổ ngân hàng ${d.tongPhanBoNganHang} ≠ tổng đơn ${don.totalAmount}`);
  if (d.soPaymentDaGanGhiDanh !== 0) them("PAYMENT_DA_GAN_GHI_DANH", `${d.soPaymentDaGanGhiDanh} Payment sống đã có enrollmentId (PHASE B.2 chưa được phép)`);
  if (d.soHoaHongLienQuan !== 0) them("CO_HOA_HONG_LIEN_QUAN", `${d.soHoaHongLienQuan} dòng hoa hồng tham chiếu đơn/ghi danh/học viên/lead này — cần xử lý riêng, không sửa giá`);

  // ── giá hiện tại: đúng snapshot legacy đã audit HOẶC đúng giá đích ──
  let trangThai: TrangThaiSuaGia = "LECH";
  let dongKq: DongSuaGia | null = null;
  if (ge !== null) {
    const hienTai = ge.gia;
    if (cungGia(hienTai, muc.truoc)) trangThai = "CHUA_SUA";
    else if (cungGia(hienTai, dich)) trangThai = "DA_SUA";
    else them("GIA_TROI", `giá ghi danh hiện tại (${chuoiGia(hienTai)}) không phải snapshot legacy đã audit (${chuoiGia(muc.truoc)}) cũng không phải giá đích (${chuoiGia(dich)})`);
    dongKq = { orderId: don.id, code, enrollmentId: ge.id, truoc: hienTai, sau: dich };
  }
  return {
    code,
    trangThai: l.length > 0 ? "LECH" : trangThai,
    dong: dongKq,
    tongDon: don.totalAmount,
    tongPayment: d.tongPaymentSong,
    tongPhanBo: d.tongPhanBoNganHang,
    noDuKienSauGan: dich.finalPrice === null ? null : dich.finalPrice - d.tongPaymentSong,
    loi: l,
  };
}

/**
 * Lập kế hoạch cho cả lô. `bang` là phạm vi CỨNG (thứ tự = thứ tự báo cáo/ghi). Mọi mã phải có đúng một đơn trong dữ liệu.
 * Fail-closed: bất kỳ lỗi nào ⇒ `dung` và `ghi = []`.
 */
export function lapKeHoachSuaGia(input: { bang: Readonly<Record<string, MucTieuSuaGia>>; du: readonly DuLieuSuaGia[] }): KeHoachSuaGia {
  const loiLo: LoiSuaGia[] = [];
  const muc: MucKeHoachSuaGia[] = [];
  const ma = Object.keys(input.bang);
  for (const code of ma) {
    const cac = input.du.filter((x) => x.don.code === code);
    if (cac.length !== 1) {
      loiLo.push(loi(code, "THIEU_DON", cac.length === 0 ? "không có đơn mang mã này" : `${cac.length} đơn cùng mã`));
      muc.push({ code, trangThai: "LECH", dong: null, tongDon: null, tongPayment: null, tongPhanBo: null, noDuKienSauGan: null, loi: [loi(code, "THIEU_DON", `đọc được ${cac.length} đơn`)] });
      continue;
    }
    muc.push(kiemMotGhiDanh(cac[0]!, input.bang[code]!));
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
  const dongDauRa = dongDauRaSuaGia(ghi);
  return { muc, loi: tatCaLoi, dung, ghi, daSuaHet: !dung && muc.length > 0 && da === muc.length, dongDauRa, sha: shaKeHoachSuaGia(dongDauRa) };
}

/** Cổng số duyệt `--expect=<N>`: N = số GHI DANH sẽ sửa. `null` nếu qua; ngược lại câu lỗi. */
export function quyetDinhGhiSuaGia(i: { soDuyet: number | null; keHoach: KeHoachSuaGia; ghiDuoc: boolean | null }): string | null {
  if (i.soDuyet === null) return "--ghi đòi --expect=<N> (số ghi danh SẼ SỬA của lượt chạy thử đã được duyệt).";
  if (Number.isNaN(i.soDuyet)) return "--expect phải là số nguyên không dấu (chỉ chữ số thập phân).";
  if (i.keHoach.dung) return `Kế hoạch DỪNG (${i.keHoach.loi.length} lỗi) — không ghi gì: ${i.keHoach.loi.map((x) => `${x.code}:${x.ma}`).join(" · ")}`;
  if (i.ghiDuoc !== true) return i.ghiDuoc === false ? "User kết nối không có quyền UPDATE trên Enrollment — không ghi." : "Không kiểm được quyền UPDATE trên Enrollment — không ghi.";
  if (i.soDuyet !== i.keHoach.ghi.length) return `Số duyệt ${i.soDuyet} ≠ kế hoạch lúc chạy ${i.keHoach.ghi.length} — không ghi.`;
  return null;
}

/** `--expect=` chặt: chỉ chữ số thập phân thuần; sai khuôn ⇒ `NaN` (KHÔNG `Number()`). */
export function phanTichSoDuyetSuaGia(argv: readonly string[]): number | null {
  const a = argv.find((x) => x.startsWith("--expect="));
  if (a === undefined) return null;
  const raw = a.slice("--expect=".length);
  if (!/^[0-9]+$/.test(raw)) return Number.NaN;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

// ─── Audit mức lượt chạy ───────────────────────────────────────────────────────────────────────────────

export const HANH_DONG_SUA_GIA = "CHUAN_HOA_GIA_GHI_DANH";
export const HANH_DONG_SUA_GIA_LUOT = "CHUAN_HOA_GIA_GHI_DANH_LUOT_CHAY";
export type LuotChaySuaGia = { batDauLuc: Date; nguonChay: NguonChayDiTru };
export const khoaLuotChaySuaGia = (n: NguonChayDiTru) => `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;

export function dungBanGhiLuotSuaGia(i: { luot: LuotChaySuaGia; soDuyet: number; keHoach: KeHoachSuaGia; daGhi: number }): Record<string, unknown> {
  if (!(i.luot.batDauLuc instanceof Date) || Number.isNaN(i.luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotSuaGia: batDauLuc phải là mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
  }
  const n = i.luot.nguonChay;
  return {
    cheDo: "APPLY",
    dryRun: false,
    batDauLuc: i.luot.batDauLuc.toISOString(),
    expectedCount: i.soDuyet,
    soKeHoach: i.keHoach.ghi.length,
    actualCount: i.daGhi,
    khop: i.daGhi === i.soDuyet,
    keHoachSha: i.keHoach.sha,
    donDaSua: i.keHoach.ghi.map((g) => g.code),
    phanTramGiam: PHAN_TRAM_GIAM,
    nguonChay: { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt },
  };
}
