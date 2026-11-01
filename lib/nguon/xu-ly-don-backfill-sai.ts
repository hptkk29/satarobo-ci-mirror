/**
 * lib/nguon/xu-ly-don-backfill-sai.ts — LÕI THUẦN của «PHASE X · xử lý đơn backfill SAI ORD-260913-000041» (27/10/2026).
 *
 * ── Vì sao có lệnh này ──────────────────────────────────────────────────────────────────────────────────────
 * PHASE C-C dừng cả lô ở `ORD-260910-000007` (`GHI_DANH_CO_PAYMENT_NGOAI`): ghi danh đích đang bị 2 Payment SỐNG của MỘT ĐƠN KHÁC gắn vào — `ORD-260913-000041`
 * (nhập backfill 14/09: kế toán PENDING, `method = backfill`, 1.000.000 + 9.424.000). Owner chốt 27/10/2026: `ORD-260910-000007` = ĐÚNG, `ORD-260913-000041` = SAI,
 * phải loại khỏi dữ liệu nghiệp vụ SỐNG. Guard của C-C KHÔNG được nới — gỡ nguyên nhân bằng lệnh riêng này (chữ ký owner riêng).
 *
 * ── Chế độ xử lý: HUỶ ĐƠN + XOÁ MỀM KHOẢN — KHÔNG xoá cứng, KHÔNG `Order.deletedAt` ───────────────────────
 * · `lib/orders/xoa-don-huy.ts` (chủ dự án chốt 02/10/2026) chỉ cho XOÁ CỨNG đơn `CANCELLED` KHÔNG còn bất kỳ `Payment` nào — kể cả khoản đã xoá mềm. Đơn này có 2 Payment ⇒ xoá cứng bị
 *   chính quy tắc của repo cấm.
 * · `Order.deletedAt` cũng bị loại: cùng tệp đo «84 nơi đọc `Order`, chỉ 25 nơi lọc `deletedAt`» ⇒ ghi nó rồi dừng là đơn biến khỏi danh sách nhưng còn trong công nợ/báo cáo.
 * · `Order.status = CANCELLED` là tín hiệu «ngoài nghiệp vụ» mà các nơi đọc THẬT sự tôn trọng (`lib/finance/debt.ts` loại `CANCELLED`/`REFUNDED`; hoa hồng `status <> 'CANCELLED'`; thứ tự lần mua).
 *   Đường huỷ chuẩn của app (`updateOrderStatusAction`) chỉ đổi `status` + ghi `OrderStatusHistory` (còn lại là VOID phiếu thu/mã QR + sự kiện `order.voided`, mà đơn này KHÔNG có phiếu/mã/dòng
 *   khoá để xử lý) — lệnh này ghi đúng hai thứ đó, không gọi action (action còn gửi thông báo).
 * · Hai khoản: `Payment.deletedAt` (xoá mềm, đúng kiểu repo đã dùng cho 24 khoản trên PROD) VÀ gỡ `enrollmentId` (owner: «xoá liên kết sai khỏi Enrollment»).
 *
 * ── Phép ghi (đúng 3 dòng owner ký) ─────────────────────────────────────────────────────────────────────────
 *   2 × Payment: `deletedAt` NULL → mốc lượt chạy · `enrollmentId` ghi danh-của-đơn-đúng → NULL.   1 × Order: `status` CONFIRMED → CANCELLED (+ 1 dòng `OrderStatusHistory`).
 *   KHÔNG đổi: số tiền · trạng thái kế toán · ngày thu · ghi chú · OrderItem · Enrollment · BankTransaction · allocation · Receipt · hoá đơn · hoa hồng · NÀO của `ORD-260910-000007`.
 *
 * ── Điều kiện an toàn (mọi lệch ⇒ DỪNG CẢ LÔ, không ghi gì) ─────────────────────────────────────────────────
 *   đơn đúng mã · CONFIRMED · chưa xoá mềm · COURSE · tổng 10.424.000 · cùng học viên + cùng lead với đơn đúng · đúng MỘT dòng đơn chưa gắn học viên/ghi danh ·
 *   đúng 2 khoản (1.000.000 + 9.424.000) PAYMENT/RECORDED/PENDING/backfill, sống, không bút toán, đang gắn ĐÚNG ghi danh của đơn đúng ·
 *   MỌI phụ thuộc = 0 (phiếu thu · phân bổ ngân hàng · mã QR · phiếu gộp · trả góp · voucher · giao dịch học viên · hoá đơn · Receipt · hoa hồng · hoàn tiền · kho · số dư · học bù).
 *
 * ── KHÔNG có định danh tài chính thật trong mã nguồn ────────────────────────────────────────────────────────
 * Chỉ giữ MÃ ĐƠN (kinh doanh) + số tiền + số đếm. Id khoản / dòng đơn / ghi danh được ĐỌC TỪ DB lúc chạy và in vào dòng ký (artifact riêng tư).
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { shaDongWaveC } from "./wave-c-chung";

export const NGUON_GHI_XU_LY_DON_SAI = "wave-x-xu-ly-don-backfill-sai";
export const HANH_DONG_XU_LY_DON_SAI_LUOT = "WAVE_X_XU_LY_DON_SAI_LUOT_CHAY";
export const LY_DO_XU_LY_DON_SAI =
  "PHASE X: đơn backfill SAI do owner xác nhận (27/10/2026) — huỷ đơn + xoá mềm 2 khoản PENDING backfill + gỡ liên kết ghi danh của đơn đúng; không đổi tiền thật, không Receipt/hoa hồng";

/** PHẠM VI CỨNG: đúng MỘT mã đơn sai + MỘT mã đơn đúng (chỉ để ĐỌC, không bao giờ ghi). Không tham số dòng lệnh / ô workflow nào đổi được (lưới `[XDS-W*]`). */
export const MA_DON_SAI = "ORD-260913-000041";
export const MA_DON_DUNG = "ORD-260910-000007";
export const TONG_DON_SAI = 10_424_000;
/** Số tiền của đúng 2 khoản backfill sai, tăng dần. */
export const SO_TIEN_KHOAN_SAI: readonly number[] = [1_000_000, 9_424_000];

/** Hình dạng đã audit của đơn ĐÚNG (chỉ để KIỂM SAU: lệnh này không được làm mất khoản thật nào): 2 khoản sống + 1 khoản đã xoá mềm từ trước (04/10). */
export const SO_KHOAN_DUNG_SONG = 2;
export const SO_KHOAN_DUNG_XOA_MEM = 1;

export const KHUON_DONG_XU_LY_DON_SAI = "xu-ly-don-sai/v1";

export const MA_LOI_XU_LY = {
  DON_SAI_KHONG_THAY: "DON_SAI_KHONG_THAY",
  DON_DUNG_KHONG_THAY: "DON_DUNG_KHONG_THAY",
  DON_DUNG_KHONG_CO_GHI_DANH: "DON_DUNG_KHONG_CO_GHI_DANH",
  DON_SAI_TRANG_THAI: "DON_SAI_TRANG_THAI",
  DON_SAI_DA_XOA_MEM: "DON_SAI_DA_XOA_MEM",
  DON_SAI_LOAI: "DON_SAI_LOAI",
  DON_SAI_TONG_LECH: "DON_SAI_TONG_LECH",
  DON_SAI_KHAC_HOC_VIEN: "DON_SAI_KHAC_HOC_VIEN",
  DON_SAI_KHAC_LEAD: "DON_SAI_KHAC_LEAD",
  DONG_DON_LECH: "DONG_DON_LECH",
  TAP_KHOAN_LECH: "TAP_KHOAN_LECH",
  KHOAN_KHONG_PHAI_BACKFILL: "KHOAN_KHONG_PHAI_BACKFILL",
  KHOAN_GAN_SAI: "KHOAN_GAN_SAI",
  CO_PHU_THUOC: "CO_PHU_THUOC",
  LICH_SU_TRANG_THAI_LECH: "LICH_SU_TRANG_THAI_LECH",
  TRANG_THAI_LAI: "TRANG_THAI_LAI",
} as const;
export type MaLoiXuLy = (typeof MA_LOI_XU_LY)[keyof typeof MA_LOI_XU_LY];
export type LoiXuLy = { ma: MaLoiXuLy; chiTiet: string };

/** Các bảng/cột mà đơn sai hoặc khoản sai KHÔNG được có dòng nào trỏ vào — tên hiển thị của từng phép đếm (thứ tự = thứ tự in). */
export const TEN_PHU_THUOC: readonly string[] = [
  "PaymentRequest",
  "PaymentAllocation",
  "QrSession",
  "PaymentBill",
  "PaymentBillLine",
  "OrderInstallment",
  "VoucherRedemption",
  "StudentTransaction",
  "HoaDonDienTu",
  "HoaDonKhoan",
  "Receipt",
  "CommissionTransaction",
  "CommissionHold",
  "CommissionDispute",
  "CommissionCalcSlot",
  "CommissionAdjustmentRequest",
  "CommissionExplainLine",
  "RefundRequest",
  "Payment.adjustmentOf",
  "CreditBalance",
  "ProductMovement",
  "MakeupNeed.feeOrderItem",
];

export type DonDoc = {
  id: string;
  code: string;
  type: string;
  status: string;
  deletedAt: Date | null;
  studentId: string | null;
  leadId: string | null;
  totalAmount: number;
};
export type DongDonDoc = { id: string; type: string; quantity: number; totalPrice: number; studentId: string | null; enrollmentId: string | null };
export type KhoanDoc = {
  id: string;
  amount: number;
  paymentType: string;
  saleStatus: string;
  accountantStatus: string;
  method: string;
  enrollmentId: string | null;
  orderItemId: string | null;
  adjustmentOfId: string | null;
  refundRequestId: string | null;
  deletedAt: Date | null;
};
/** Đơn ĐÚNG — chỉ để lấy ghi danh đích + học viên + lead đối chiếu. */
export type DonDungDoc = { id: string; code: string; studentId: string | null; leadId: string | null; enrollmentId: string | null };

export type DuLieuXuLy = {
  donSai: DonDoc | null;
  dongDonSai: readonly DongDonDoc[];
  /** MỌI khoản của đơn sai, KỂ CẢ đã xoá mềm. */
  khoanSai: readonly KhoanDoc[];
  donDung: DonDungDoc | null;
  /** tên phụ thuộc → số dòng; phải có đủ `TEN_PHU_THUOC`. */
  phuThuoc: Readonly<Record<string, number>>;
  /** `OrderStatusHistory` của đơn sai: CHƯA xử lý = 0; ĐÃ xử lý = đúng 1 dòng CONFIRMED→CANCELLED. */
  lichSu: readonly { fromStatus: string; toStatus: string }[];
};

export type DongGhiKhoan = { loai: "KHOAN"; paymentId: string; orderId: string; orderItemId: string; amount: number; enrollmentId: string };
export type DongGhiDon = { loai: "DON"; orderId: string; code: string; tongDon: number; tuTrangThai: "CONFIRMED"; denTrangThai: "CANCELLED" };
export type DongGhi = DongGhiKhoan | DongGhiDon;

export type TrangThaiXuLy = "CHUA_XU_LY" | "DA_XU_LY" | "LECH";

export type KeHoachXuLy = {
  trangThai: TrangThaiXuLy;
  loi: readonly LoiXuLy[];
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  /** Cả lô đã ở trạng thái «đã xử lý» (chạy lại) ⇒ 0 dòng ghi. */
  daXuLy: boolean;
  /** Khoản trước, đơn sau (thứ tự ghi). */
  ghi: readonly DongGhi[];
  dongDauRa: readonly string[];
  sha: string;
  /** Số dòng phụ thuộc khác 0 (để in). */
  soPhuThuocKhac0: number;
  /** Ghi danh đích (của đơn đúng) mà 2 khoản đang bị gắn nhầm — null nếu không xác định. */
  enrollmentDich: string | null;
};

const loi = (ma: MaLoiXuLy, chiTiet: string): LoiXuLy => ({ ma, chiTiet });

/** MỘT dòng/khoản-hay-đơn: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Không chứa tên/SĐT/email. */
export function dongDauRaXuLyDonSai(ghi: readonly DongGhi[]): string[] {
  return ghi.map((g) =>
    g.loai === "KHOAN"
      ? [KHUON_DONG_XU_LY_DON_SAI, "KHOAN", MA_DON_SAI, g.paymentId, g.amount, g.enrollmentId, "XOA_MEM+GO_GHI_DANH"].join("|")
      : [KHUON_DONG_XU_LY_DON_SAI, "DON", g.code, g.orderId, g.tongDon, `${g.tuTrangThai}>${g.denTrangThai}`, "HUY_DON"].join("|"),
  );
}

const soSanhId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const chuoiSo = (a: readonly number[]) => a.join("+");

/**
 * Kế hoạch. Ba trạng thái:
 *  · CHƯA_XỬ_LÝ — đơn sai còn nguyên (CONFIRMED, 2 khoản sống gắn nhầm) ⇒ phát 3 dòng ghi nếu mọi điều kiện đạt.
 *  · ĐÃ_XỬ_LÝ — đơn CANCELLED + đúng 1 dòng lịch sử CONFIRMED→CANCELLED + cả 2 khoản đã xoá mềm và đã gỡ liên kết ⇒ 0 dòng ghi.
 *  · LỆCH — mọi thứ khác (kể cả trạng thái LAI: xử lý dở một nửa) ⇒ DỪNG, không ghi.
 */
export function lapKeHoachXuLy(d: DuLieuXuLy): KeHoachXuLy {
  const ds: LoiXuLy[] = [];
  const don = d.donSai;
  const dung = d.donDung;
  if (don === null) ds.push(loi("DON_SAI_KHONG_THAY", `không thấy đơn ${MA_DON_SAI}`));
  if (dung === null) ds.push(loi("DON_DUNG_KHONG_THAY", `không thấy đơn ${MA_DON_DUNG}`));
  else if (dung.enrollmentId === null) ds.push(loi("DON_DUNG_KHONG_CO_GHI_DANH", `${MA_DON_DUNG} chưa có dòng đơn trỏ tới ghi danh (C-A chưa xong?)`));
  const enrollmentDich = dung?.enrollmentId ?? null;

  // ── nhận diện trạng thái (chỉ khi có đơn sai) ──
  let trangThai: TrangThaiXuLy = "LECH";
  if (don !== null) {
    const khoanSong = d.khoanSai.filter((k) => k.deletedAt === null);
    const khoanXoa = d.khoanSai.filter((k) => k.deletedAt !== null);
    const lichSuHuy = d.lichSu.length === 1 && d.lichSu[0]!.fromStatus === "CONFIRMED" && d.lichSu[0]!.toStatus === "CANCELLED";
    const chua = don.status === "CONFIRMED" && khoanXoa.length === 0 && d.lichSu.length === 0;
    const da = don.status === "CANCELLED" && khoanSong.length === 0 && khoanXoa.length === SO_TIEN_KHOAN_SAI.length && lichSuHuy && khoanXoa.every((k) => k.enrollmentId === null);
    if (chua) trangThai = "CHUA_XU_LY";
    else if (da) trangThai = "DA_XU_LY";
    else if (don.status === "CONFIRMED" && d.lichSu.length > 0) ds.push(loi("LICH_SU_TRANG_THAI_LECH", `đơn còn CONFIRMED nhưng đã có ${d.lichSu.length} dòng lịch sử trạng thái`));
    else if (don.status === "CANCELLED" || khoanXoa.length > 0) {
      ds.push(loi("TRANG_THAI_LAI", `đơn ${don.status} · ${khoanSong.length} khoản sống / ${khoanXoa.length} khoản xoá mềm / ${d.lichSu.length} dòng lịch sử — xử lý dở hoặc lệch, không ghi`));
    } else ds.push(loi("DON_SAI_TRANG_THAI", `trạng thái đơn ${don.status} (cần CONFIRMED)`));
  }

  // ── điều kiện bất biến của ĐƠN SAI (áp cho cả hai trạng thái, trừ vế chỉ có ở CHƯA XỬ LÝ) ──
  if (don !== null) {
    if (don.code !== MA_DON_SAI) ds.push(loi("DON_SAI_KHONG_THAY", `mã đơn đọc ra ${don.code} ≠ ${MA_DON_SAI}`));
    if (don.deletedAt !== null) ds.push(loi("DON_SAI_DA_XOA_MEM", "đơn đã bị xoá mềm (lệnh này KHÔNG dùng Order.deletedAt)"));
    if (don.type !== "COURSE") ds.push(loi("DON_SAI_LOAI", `loại đơn ${don.type} (cần COURSE)`));
    if (don.totalAmount !== TONG_DON_SAI) ds.push(loi("DON_SAI_TONG_LECH", `tổng đơn ${don.totalAmount} ≠ ${TONG_DON_SAI} đã audit`));
    if (dung !== null) {
      if (don.studentId === null || don.studentId !== dung.studentId) ds.push(loi("DON_SAI_KHAC_HOC_VIEN", "đơn sai không cùng học viên với đơn đúng"));
      if (don.leadId === null || don.leadId !== dung.leadId) ds.push(loi("DON_SAI_KHAC_LEAD", "đơn sai không cùng lead với đơn đúng"));
    }
    const dong = d.dongDonSai;
    const dongOk = dong.length === 1 && dong[0]!.type === "COURSE_ENROLLMENT" && dong[0]!.quantity === 1 && dong[0]!.totalPrice === TONG_DON_SAI && dong[0]!.studentId === null && dong[0]!.enrollmentId === null;
    if (!dongOk) ds.push(loi("DONG_DON_LECH", `${dong.length} dòng đơn ≠ đúng 1 dòng COURSE_ENROLLMENT ${TONG_DON_SAI} chưa gắn học viên/ghi danh`));
    const tien = d.khoanSai.map((k) => k.amount).sort((a, b) => a - b);
    if (tien.length !== SO_TIEN_KHOAN_SAI.length || tien.some((x, i) => x !== SO_TIEN_KHOAN_SAI[i])) {
      ds.push(loi("TAP_KHOAN_LECH", `tập khoản [${chuoiSo(tien)}] ≠ [${chuoiSo(SO_TIEN_KHOAN_SAI)}] đã audit (kể cả khoản xoá mềm)`));
    }
    for (const k of d.khoanSai) {
      const dungLoai = k.paymentType === "PAYMENT" && k.saleStatus === "RECORDED" && k.accountantStatus === "PENDING" && k.method === "backfill" && k.adjustmentOfId === null && k.refundRequestId === null;
      if (!dungLoai) ds.push(loi("KHOAN_KHONG_PHAI_BACKFILL", `khoản ${k.id}: ${k.paymentType}/${k.saleStatus}/${k.accountantStatus}/${k.method} không phải PAYMENT/RECORDED/PENDING/backfill thuần`));
      if (dong.length === 1 && k.orderItemId !== dong[0]!.id) ds.push(loi("KHOAN_KHONG_PHAI_BACKFILL", `khoản ${k.id} không trỏ vào dòng đơn của đơn sai`));
    }
  }
  const khac0 = Object.entries(d.phuThuoc).filter(([, n]) => n !== 0);
  const thieu = TEN_PHU_THUOC.filter((t) => !(t in d.phuThuoc));
  if (thieu.length > 0) ds.push(loi("CO_PHU_THUOC", `thiếu phép đếm phụ thuộc: ${thieu.join(", ")} — coi là KHÔNG an toàn`));
  if (khac0.length > 0) ds.push(loi("CO_PHU_THUOC", `còn dòng trỏ vào đơn/khoản sai: ${khac0.map(([t, n]) => `${t}=${n}`).join(" · ")} — cần xử lý riêng`));

  // ── điều kiện riêng của trạng thái CHƯA XỬ LÝ: hai khoản sống, đang gắn ĐÚNG ghi danh của đơn đúng ──
  if (trangThai === "CHUA_XU_LY" && don !== null) {
    for (const k of d.khoanSai) {
      if (k.deletedAt !== null) continue;
      if (enrollmentDich === null || k.enrollmentId !== enrollmentDich) ds.push(loi("KHOAN_GAN_SAI", `khoản ${k.id} không gắn ghi danh của ${MA_DON_DUNG} (đang gắn ${k.enrollmentId ?? "NULL"})`));
    }
  }

  const dungLo = ds.length > 0;
  let ghi: DongGhi[] = [];
  if (!dungLo && trangThai === "CHUA_XU_LY" && don !== null && enrollmentDich !== null) {
    const item = d.dongDonSai[0]!;
    const khoan: DongGhiKhoan[] = [...d.khoanSai]
      .sort((a, b) => soSanhId(a.id, b.id))
      .map((k) => ({ loai: "KHOAN", paymentId: k.id, orderId: don.id, orderItemId: item.id, amount: k.amount, enrollmentId: enrollmentDich }));
    ghi = [...khoan, { loai: "DON", orderId: don.id, code: don.code, tongDon: don.totalAmount, tuTrangThai: "CONFIRMED", denTrangThai: "CANCELLED" }];
  }
  const dongDauRa = dongDauRaXuLyDonSai(ghi);
  return {
    trangThai: dungLo ? "LECH" : trangThai,
    loi: ds,
    dung: dungLo,
    daXuLy: !dungLo && trangThai === "DA_XU_LY",
    ghi,
    dongDauRa,
    sha: shaDongWaveC(dongDauRa),
    soPhuThuocKhac0: khac0.length,
    enrollmentDich,
  };
}
