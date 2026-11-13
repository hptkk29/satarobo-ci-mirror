/**
 * lib/nguon/gan-payment-ghi-danh.ts — LÕI THUẦN của «gắn `Payment.enrollmentId` cho 9 khoản thu của 6 đơn sống» (Wave 1, PHASE B.2, 24/10/2026).
 *
 * ── Bối cảnh ────────────────────────────────────────────────────────────────────────────────────────────────
 * PHASE A đã gắn học viên + ghi danh vào Order/OrderItem; PHASE B.1 đã chuẩn hoá giá 6 ghi danh (đóng full giảm 15%). Còn thiếu mắt xích cuối: 9 `Payment` (CONFIRMED,
 * đã đối soát với 9 giao dịch ngân hàng) vẫn `enrollmentId = NULL`, nên công nợ (`finalPrice − Σ khoản đã xác nhận gắn ghi danh`) và cổng phụ huynh chưa thấy tiền đã đóng.
 *
 * ── Phép ghi: MỘT cột của MỘT bảng ──────────────────────────────────────────────────────────────────────────
 * `Payment.enrollmentId` (NULL → ghi danh đích). KHÔNG đổi amount / status / paidDate / note / orderItemId / method; KHÔNG Order, OrderItem, Enrollment, BankTransaction, Receipt,
 * hoa hồng, hoá đơn. Số tiền KHÔNG BAO GIỜ bị tách: chỉ nhận kế hoạch «GAN một mảnh đúng số cũ».
 *
 * ── KHÔNG có định danh tài chính thật trong mã nguồn (quyết định owner 24/10/2026) ───────────────────────────
 * `lib/` và `tests/` lên gương CI CÔNG KHAI. Bảng cứng chỉ giữ thứ không phải định danh: mã đơn (kinh doanh, đã lộ ở PHASE B.1), giá đích và SỐ ĐẾM (khoản sống · khoản xoá mềm · khoản trong hoá đơn).
 * Mọi định danh thật — id khoản, id ghi danh, id dòng đơn, id hoá đơn, mã giao dịch ngân hàng — được ĐỌC TỪ DB lúc chạy, in ra trong dòng ký (artifact riêng tư của owner). Chữ ký của owner trên
 * các dòng đó ràng buộc ĐÚNG chín khoản; còn mã nguồn chỉ ràng buộc hình dạng (6 đơn · 2·1·1·1·1·3 khoản · giá đích).
 *   · ghi danh đích = ghi danh mà PHASE A đã gắn vào dòng đơn COURSE_ENROLLMENT duy nhất của đơn (phải sống · ACTIVE · cùng học viên · cùng cơ sở · đúng giá B.1);
 *   · giao dịch ngân hàng của từng khoản = ỨNG VIÊN suy từ DỮ LIỆU: giao dịch có phân bổ vào phiếu yêu cầu của CHÍNH đơn, đang MATCHED, cùng số tiền với khoản. 0 hoặc >1 ứng viên ⇒ INVALID, dừng cả lô.
 *     `Payment.note` chỉ là TÍN HIỆU PHỤ (đối chiếu chéo): nếu ghi chú mang mã giao dịch khác với ứng viên ⇒ dừng; ghi chú không mang mã nào thì không phải căn cứ quyết định.
 *
 * ── Dùng ĐƯỜNG CHUẨN, không viết lại vòng gắn ───────────────────────────────────────────────────────────────
 * Planner chuẩn `lapKeHoachGanGhiDanh` (lib/finance/ke-hoach-gan-ghi-danh.ts) được CHẠY TRÊN DỮ LIỆU THẬT ở tầng DB và kết quả của nó là một đầu vào bắt buộc của lõi này:
 * mọi khoản chưa gắn phải ra `GAN`, đúng MỘT mảnh, đúng số cũ (`giuNguyenTien`), trỏ đúng ghi danh đích. Phép ghi thực hiện theo CÙNG giao thức với `thucHienKeHoachGan` (payment.ts).
 * Cờ `chan` («có khoản ĐÃ XÁC NHẬN mà chưa gắn») của planner bị BỎ QUA CÓ CHỦ ĐÍCH ở đây, và chỉ ở đây: `chan` sinh ra để chặn nhánh TÁCH (sửa `amount` của tiền đã đối soát).
 * Lõi này đòi mọi dòng là GAN một mảnh giữ nguyên tiền ⇒ nhánh TÁCH không bao giờ chạy ⇒ lý do của `chan` không còn áp dụng. Bất kỳ dòng TACH / BO_QUA / MO_HO ⇒ dừng cả lô.
 *
 * ── Fail-closed ─────────────────────────────────────────────────────────────────────────────────────────────
 * Trạng thái hợp lệ duy nhất của cả lô: «9/9 chưa gắn, đủ điều kiện» (ghi 9) hoặc «9/9 đã gắn ĐÚNG ghi danh đích» (chạy lại — ghi 0). Lô lai ⇒ dừng.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { createHash } from "node:crypto";
import { computeDebt } from "@/lib/finance/debt-pure";
import { tinhThucThu } from "@/lib/finance/thuc-thu";
import type { NguonChayDiTru } from "./di-tru-nguon-chay";

export const KHUON_DONG_GAN_PAYMENT = "gan-payment-ghi-danh/v1";
export const LY_DO_GAN_PAYMENT = "Gắn khoản thu vào ghi danh theo đơn đã duyệt — chỉ đổi Payment.enrollmentId, không đổi số tiền / trạng thái / ngày thu";
export const NGUON_GHI_GAN_PAYMENT = "wave1-gan-payment-ghi-danh";

/**
 * PHẠM VI CỨNG — chỉ những thứ KHÔNG phải định danh tài chính: mã đơn, giá đích và SỐ ĐẾM. Không có id khoản / ghi danh / dòng đơn / hoá đơn, không có mã giao dịch ngân hàng,
 * không có số tiền từng khoản (xem đầu tệp).
 */
export type MucGanPayment = {
  /** `finalPrice` đích của ghi danh (kết quả PHASE B.1) = `Order.totalAmount` = Σ khoản sống. */
  giaDich: number;
  /** ĐÚNG số khoản SỐNG của đơn (không hơn không kém). Từng khoản được xác minh bằng giao dịch ngân hàng của CHÍNH nó lúc chạy. */
  soKhoan: number;
  /** Số khoản đã xoá mềm của đơn: phải GIỮ xoá mềm và KHÔNG gắn. */
  soKhoanDaXoa: number;
  /** Số khoản đang bị hoá đơn điện tử còn hiệu lực giữ (cùng MỘT hoá đơn). Chỉ GẮN, không đổi tiền ⇒ được phép; lệch số ⇒ dừng. */
  soKhoanTrongHoaDon: number;
};

/**
 * PHẠM VI CỨNG: đúng 9 khoản của 6 đơn (đo trên PROD 24/10/2026): 2·1·1·1·1·3. Script truyền hằng này; không có tham số dòng lệnh / ô workflow nào thêm, bớt hay đổi (lưới `[GPG-W*]`).
 * Thứ tự = thứ tự báo cáo/ghi.
 */
export const BANG_GAN_PAYMENT: Readonly<Record<string, MucGanPayment>> = {
  "ORD-260831-000001": { giaDich: 8_976_000, soKhoan: 2, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 2 },
  "ORD-260908-000003": { giaDich: 8_976_000, soKhoan: 1, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 0 },
  // Một bản ghi nhận tự động trùng số tiền (PENDING) đã xoá mềm 04/10 — PHẢI GIỮ xoá, không gắn.
  "ORD-260910-000002": { giaDich: 8_976_000, soKhoan: 1, soKhoanDaXoa: 1, soKhoanTrongHoaDon: 0 },
  "ORD-260910-000005": { giaDich: 8_976_000, soKhoan: 1, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 0 },
  "ORD-260910-000006": { giaDich: 9_792_000, soKhoan: 1, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 0 },
  "ORD-260910-000008": { giaDich: 8_976_000, soKhoan: 3, soKhoanDaXoa: 0, soKhoanTrongHoaDon: 0 },
};
export const MA_DON_GAN_PAYMENT: readonly string[] = Object.keys(BANG_GAN_PAYMENT);

export const MA_LOI_GAN_PAYMENT = {
  THIEU_DON: "THIEU_DON",
  KHONG_CO_MUC_TIEU: "KHONG_CO_MUC_TIEU",
  DON_DA_XOA: "DON_DA_XOA",
  DON_KHONG_PHAI_KHOA_HOC: "DON_KHONG_PHAI_KHOA_HOC",
  SO_DONG_KHONG_DUNG: "SO_DONG_KHONG_DUNG",
  DON_CHUA_GAN_DANH_TINH: "DON_CHUA_GAN_DANH_TINH",
  GHI_DANH_LECH_DICH: "GHI_DANH_LECH_DICH",
  GHI_DANH_DA_XOA: "GHI_DANH_DA_XOA",
  GHI_DANH_KHONG_ACTIVE: "GHI_DANH_KHONG_ACTIVE",
  GHI_DANH_LECH_HOC_VIEN: "GHI_DANH_LECH_HOC_VIEN",
  GHI_DANH_LECH_CO_SO: "GHI_DANH_LECH_CO_SO",
  GIA_GHI_DANH_CHUA_CHUAN: "GIA_GHI_DANH_CHUA_CHUAN",
  TONG_DON_LECH: "TONG_DON_LECH",
  TAP_PAYMENT_LECH: "TAP_PAYMENT_LECH",
  PAYMENT_KHONG_PHAI_THU: "PAYMENT_KHONG_PHAI_THU",
  PAYMENT_KHONG_GHI_NHAN: "PAYMENT_KHONG_GHI_NHAN",
  PAYMENT_KHONG_XAC_NHAN: "PAYMENT_KHONG_XAC_NHAN",
  PAYMENT_LA_BUT_TOAN_DIEU_CHINH: "PAYMENT_LA_BUT_TOAN_DIEU_CHINH",
  PAYMENT_LECH_CO_SO: "PAYMENT_LECH_CO_SO",
  PAYMENT_LECH_DONG_DON: "PAYMENT_LECH_DONG_DON",
  PAYMENT_GAN_SAI_GHI_DANH: "PAYMENT_GAN_SAI_GHI_DANH",
  TIEN_PAYMENT_LECH: "TIEN_PAYMENT_LECH",
  TIEN_PHAN_BO_LECH: "TIEN_PHAN_BO_LECH",
  // ── giao dịch ngân hàng: MỖI điều kiện một mã riêng (để mã này không nuốt mã kia) ──
  GIAO_DICH_KHONG_UNG_VIEN: "GIAO_DICH_KHONG_UNG_VIEN",
  GIAO_DICH_NHIEU_UNG_VIEN: "GIAO_DICH_NHIEU_UNG_VIEN",
  GIAO_DICH_LECH_SO_TIEN: "GIAO_DICH_LECH_SO_TIEN",
  GIAO_DICH_PHAN_BO_LECH: "GIAO_DICH_PHAN_BO_LECH",
  GIAO_DICH_KHONG_MATCHED: "GIAO_DICH_KHONG_MATCHED",
  GIAO_DICH_LECH_CO_SO: "GIAO_DICH_LECH_CO_SO",
  GIAO_DICH_THUA: "GIAO_DICH_THUA",
  GIAO_DICH_GHI_CHU_LECH: "GIAO_DICH_GHI_CHU_LECH",
  TRUNG_GIAO_DICH: "TRUNG_GIAO_DICH",
  PAYMENT_XOA_LECH: "PAYMENT_XOA_LECH",
  HOA_DON_LECH: "HOA_DON_LECH",
  CO_TAC_DUNG_PHU: "CO_TAC_DUNG_PHU",
  GHI_DANH_CO_PAYMENT_NGOAI: "GHI_DANH_CO_PAYMENT_NGOAI",
  KE_HOACH_CHUAN_LECH: "KE_HOACH_CHUAN_LECH",
  NO_DU_KIEN_KHAC_0: "NO_DU_KIEN_KHAC_0",
  TRUNG_GHI_DANH: "TRUNG_GHI_DANH",
  LO_HON_HOP: "LO_HON_HOP",
} as const;
export type MaLoiGanPayment = (typeof MA_LOI_GAN_PAYMENT)[keyof typeof MA_LOI_GAN_PAYMENT];
export type LoiGanPayment = { code: string; ma: MaLoiGanPayment; chiTiet: string };

export type PaymentSong = {
  id: string;
  amount: number;
  paymentType: string;
  saleStatus: string;
  accountantStatus: string;
  enrollmentId: string | null;
  orderItemId: string | null;
  adjustmentOfId: string | null;
  centerId: string | null;
  note: string | null;
};

/** Một giao dịch ngân hàng có phân bổ vào phiếu yêu cầu của đơn (ỨNG VIÊN — suy từ dữ liệu, không từ mã nguồn). */
export type GiaoDichNganHang = {
  id: string;
  provider: string;
  providerTxnId: string;
  amount: number;
  status: string;
  centerId: string | null;
  /** Σ `PaymentAllocation.amount` của giao dịch này (mọi nơi). */
  tongPhanBo: number;
  /** Phần của Σ trên đã phân bổ vào phiếu yêu cầu của CHÍNH đơn này. */
  phanBoVaoDon: number;
};

/** Kết quả CỦA PLANNER CHUẨN `lapKeHoachGanGhiDanh` cho một khoản chưa gắn (tầng DB chạy planner thật, lõi chỉ đánh giá). */
export type KetQuaPlannerChuan = {
  paymentId: string;
  ketQua: "GAN" | "TACH" | "BO_QUA";
  /** Số mảnh của phép chia (GAN = 1). */
  soPhan: number;
  enrollmentId: string | null;
  amount: number | null;
  /** `giuNguyenTien(phan, soTienCu)` của planner. */
  giuNguyenTien: boolean;
  maBoQua: string | null;
};

export type DuLieuGanPayment = {
  don: {
    id: string;
    code: string;
    type: string;
    deletedAt: Date | null;
    studentId: string | null;
    centerId: string | null;
    totalAmount: number;
    items: readonly { id: string; type: string; studentId: string | null; enrollmentId: string | null }[];
  };
  ghiDanh: {
    id: string;
    studentId: string;
    status: string;
    centerId: string | null;
    deletedAt: Date | null;
    discountType: string | null;
    tuition: number | null;
    finalPrice: number | null;
  } | null;
  /** Payment SỐNG (deletedAt = null) của đơn. */
  paymentSong: readonly PaymentSong[];
  /** Payment ĐÃ XOÁ MỀM của đơn. */
  paymentDaXoa: readonly { id: string; enrollmentId: string | null }[];
  /** MỌI giao dịch ngân hàng có phân bổ vào phiếu yêu cầu của đơn (mọi trạng thái, mọi số tiền) — nguồn ứng viên. */
  nganHang: readonly GiaoDichNganHang[];
  /** Σ phân bổ ngân hàng ĐÃ KHỚP vào các phiếu thu của đơn. */
  tongPhanBoDon: number;
  /** Khoản (id) → hoá đơn (id) đang giữ khoản (còn hiệu lực). */
  trongHoaDon: Readonly<Record<string, string>>;
  /** Số dòng phụ tham chiếu khoản/đơn/ghi danh/học viên: Receipt · hoa hồng (mọi loại) · StudentTransaction · hoàn tiền · bút toán trỏ vào khoản. PHẢI = 0. */
  tacDungPhu: number;
  /** Payment sống KHÔNG thuộc đơn này mà đang gắn ghi danh đích. PHẢI = 0. */
  paymentNgoaiGanGhiDanh: number;
  /** Planner chuẩn chạy trên khoản chưa gắn (rỗng nếu cả đơn đã gắn). */
  plannerChuan: readonly KetQuaPlannerChuan[];
};

export type TrangThaiGanPayment = "CHUA_GAN" | "DA_GAN" | "LECH";

export type DongGanPayment = {
  orderId: string;
  code: string;
  paymentId: string;
  amount: number;
  enrollmentId: string;
  /** Dòng đơn COURSE_ENROLLMENT của đơn (điều kiện `where` của phép ghi). */
  orderItemId: string;
  /** Mã giao dịch ngân hàng của ỨNG VIÊN DUY NHẤT (đọc từ DB). */
  providerTxnId: string;
  /** Hoá đơn điện tử đang giữ khoản; `null` = không. */
  hoaDonId: string | null;
};

export type MucKeHoachGanPayment = {
  code: string;
  trangThai: TrangThaiGanPayment;
  enrollmentId: string | null;
  soKhoan: number;
  /** Số khoản sống còn `enrollmentId = NULL`. */
  soChuaGan: number;
  tongKhoan: number | null;
  tongDon: number | null;
  tongPhanBo: number | null;
  /** Công nợ dự kiến SAU khi gắn = `computeDebt(finalPrice, tinhThucThu(khoản))` — chính hàm của repo. 0 là đích. */
  noDuKien: number | null;
  loi: readonly LoiGanPayment[];
};

export type KeHoachGanPayment = {
  muc: readonly MucKeHoachGanPayment[];
  loi: readonly LoiGanPayment[];
  /** `true` ⇒ KHÔNG có dòng ghi nào (lô lệch). */
  dung: boolean;
  ghi: readonly DongGanPayment[];
  /** Cả lô đã gắn ĐÚNG (chạy lại) ⇒ 0 dòng ghi. */
  daGanHet: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

/** MỘT dòng/khoản: định dạng owner ký VÀ lõi ghi tự dựng lại — cùng hàm. Không chứa tên/SĐT/email. */
export function dongDauRaGanPayment(ghi: readonly DongGanPayment[]): string[] {
  return ghi.map((g) => [KHUON_DONG_GAN_PAYMENT, g.orderId, g.code, g.paymentId, g.amount, g.enrollmentId, g.providerTxnId, g.hoaDonId ?? "-"].join("|"));
}
export const shaKeHoachGanPayment = (dong: readonly string[]) => createHash("sha256").update(dong.join("\n"), "utf8").digest("hex");

const loi = (code: string, ma: MaLoiGanPayment, chiTiet: string): LoiGanPayment => ({ code, ma, chiTiet });
const soSanhId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Mã giao dịch ngân hàng mà `Payment.note` KHAI (tín hiệu phụ): đúng hai họ marker của repo (`lib/finance/payment-markers.ts`) — `[auto:<provider>:<mã>]` của cổng thanh toán
 * và `[ma-gd:<mã>]` của khoản gõ tay. Ghi chú không mang marker nào ⇒ mảng rỗng (không phải căn cứ quyết định).
 */
export function maGiaoDichTrongGhiChu(note: string | null, provider: string): string[] {
  if (note === null) return [];
  const ra: string[] = [];
  for (const tienTo of [`[auto:${provider.toLowerCase()}:`, "[ma-gd:"]) {
    let tu = 0;
    for (;;) {
      const i = note.indexOf(tienTo, tu);
      if (i < 0) break;
      const dau = i + tienTo.length;
      const cuoi = note.indexOf("]", dau);
      if (cuoi < 0) break;
      ra.push(note.slice(dau, cuoi));
      tu = cuoi + 1;
    }
  }
  return ra;
}

type KetQuaMotDon = { muc: MucKeHoachGanPayment; ghi: DongGanPayment[]; giaoDichDung: string[] };

function kiemMotDon(d: DuLieuGanPayment, muc: MucGanPayment): KetQuaMotDon {
  const { don } = d;
  const code = don.code;
  const l: LoiGanPayment[] = [];
  const them = (ma: MaLoiGanPayment, chiTiet: string) => l.push(loi(code, ma, chiTiet));

  // ── đơn ──
  if (don.deletedAt !== null) them("DON_DA_XOA", "đơn đã bị xoá mềm");
  if (don.type !== "COURSE") them("DON_KHONG_PHAI_KHOA_HOC", `loại đơn «${don.type}» ≠ COURSE`);
  const dongKhoa = don.items.filter((x) => x.type === "COURSE_ENROLLMENT");
  if (don.items.length !== 1 || dongKhoa.length !== 1) {
    them("SO_DONG_KHONG_DUNG", `đơn phải có ĐÚNG 1 dòng và dòng đó là COURSE_ENROLLMENT (đang có ${don.items.length} dòng, ${dongKhoa.length} dòng COURSE_ENROLLMENT)`);
  }
  const dong = dongKhoa.length === 1 ? dongKhoa[0]! : null;
  if (don.totalAmount !== muc.giaDich) them("TONG_DON_LECH", `Order.totalAmount ${don.totalAmount} ≠ giá đích ${muc.giaDich}`);

  // ── PHASE A + B.1 phải xong; ghi danh đích = ghi danh PHASE A đã gắn vào dòng đơn ──
  const ge = d.ghiDanh;
  const dich = dong?.enrollmentId ?? null;
  if (dong === null || dich === null || dong.studentId === null || don.studentId === null || ge === null) {
    them("DON_CHUA_GAN_DANH_TINH", "đơn / dòng đơn chưa gắn học viên + ghi danh từ PHASE A (hoặc không đọc được ghi danh)");
  } else {
    if (ge.id !== dich) them("GHI_DANH_LECH_DICH", `ghi danh đọc được ${ge.id} ≠ ghi danh mà dòng đơn trỏ tới ${dich}`);
    if (ge.deletedAt !== null) them("GHI_DANH_DA_XOA", "ghi danh đã xoá mềm");
    if (ge.status !== "ACTIVE") them("GHI_DANH_KHONG_ACTIVE", `ghi danh ở trạng thái «${ge.status}»`);
    if (ge.studentId !== don.studentId || ge.studentId !== dong.studentId) them("GHI_DANH_LECH_HOC_VIEN", "Enrollment.studentId ≠ Order.studentId / OrderItem.studentId");
    if (ge.centerId === null || ge.centerId !== don.centerId) them("GHI_DANH_LECH_CO_SO", `ghi danh khác cơ sở với đơn (${ge.centerId ?? "NULL"} ≠ ${don.centerId ?? "NULL"})`);
    if (ge.finalPrice !== muc.giaDich || ge.tuition !== muc.giaDich || ge.discountType !== "PERCENT") {
      them("GIA_GHI_DANH_CHUA_CHUAN", `giá ghi danh (${ge.discountType ?? "NULL"} · tuition ${ge.tuition ?? "NULL"} · final ${ge.finalPrice ?? "NULL"}) chưa ở giá đích PHASE B.1 (PERCENT · ${muc.giaDich})`);
    }
  }

  // ── tập khoản sống: đúng SỐ ĐẾM của bảng; từng khoản ──
  const song = [...d.paymentSong].sort((a, b) => soSanhId(a.id, b.id));
  if (song.length !== muc.soKhoan) them("TAP_PAYMENT_LECH", `đơn có ${song.length} khoản sống ≠ ${muc.soKhoan} khoản đã audit`);
  for (const p of song) {
    if (p.paymentType !== "PAYMENT") them("PAYMENT_KHONG_PHAI_THU", `khoản ${p.id}: loại «${p.paymentType}» ≠ PAYMENT`);
    if (p.saleStatus !== "RECORDED") them("PAYMENT_KHONG_GHI_NHAN", `khoản ${p.id}: saleStatus «${p.saleStatus}» ≠ RECORDED`);
    if (p.accountantStatus !== "CONFIRMED") them("PAYMENT_KHONG_XAC_NHAN", `khoản ${p.id}: accountantStatus «${p.accountantStatus}» ≠ CONFIRMED`);
    if (p.adjustmentOfId !== null) them("PAYMENT_LA_BUT_TOAN_DIEU_CHINH", `khoản ${p.id}: là bút toán điều chỉnh của ${p.adjustmentOfId}`);
    if (p.centerId === null || p.centerId !== don.centerId) them("PAYMENT_LECH_CO_SO", `khoản ${p.id}: cơ sở ${p.centerId ?? "NULL"} ≠ cơ sở đơn ${don.centerId ?? "NULL"}`);
    if (dong === null || p.orderItemId !== dong.id) them("PAYMENT_LECH_DONG_DON", `khoản ${p.id}: orderItemId ${p.orderItemId ?? "NULL"} ≠ dòng đơn ${dong?.id ?? "NULL"}`);
    if (p.enrollmentId !== null && p.enrollmentId !== dich) them("PAYMENT_GAN_SAI_GHI_DANH", `khoản ${p.id}: đã gắn ghi danh ${p.enrollmentId} ≠ đích ${dich ?? "NULL"}`);
  }

  // ── giao dịch ngân hàng: ỨNG VIÊN suy từ dữ liệu (phân bổ vào phiếu yêu cầu của CHÍNH đơn). Mỗi điều kiện một mã lỗi riêng. ──
  const nh = [...d.nganHang].sort((a, b) => soSanhId(a.id, b.id));
  for (const g of nh) if (g.status !== "MATCHED") them("GIAO_DICH_KHONG_MATCHED", `giao dịch ${g.id} có phân bổ vào đơn nhưng ở trạng thái «${g.status}» ≠ MATCHED`);
  const matched = nh.filter((g) => g.status === "MATCHED");
  const giaoDichDung: string[] = [];
  const chon = new Map<string, GiaoDichNganHang>();
  for (const p of song) {
    const ungVien = matched.filter((g) => g.amount === p.amount);
    if (ungVien.length === 0) them("GIAO_DICH_KHONG_UNG_VIEN", `khoản ${p.id}: KHÔNG có giao dịch ngân hàng MATCHED nào cùng số tiền, có phân bổ vào đơn (0 ứng viên)`);
    else if (ungVien.length > 1) them("GIAO_DICH_NHIEU_UNG_VIEN", `khoản ${p.id}: ${ungVien.length} giao dịch ngân hàng MATCHED cùng số tiền, có phân bổ vào đơn (phải đúng 1)`);
    else {
      const g = ungVien[0]!;
      chon.set(p.id, g);
      giaoDichDung.push(g.id);
      if (g.tongPhanBo !== p.amount || g.phanBoVaoDon !== p.amount) {
        them("GIAO_DICH_PHAN_BO_LECH", `khoản ${p.id}: phân bổ của giao dịch (tổng ${g.tongPhanBo} · vào đơn ${g.phanBoVaoDon}) ≠ số tiền khoản ${p.amount}`);
      }
      if (g.centerId !== p.centerId) them("GIAO_DICH_LECH_CO_SO", `khoản ${p.id}: giao dịch khác cơ sở (${g.centerId ?? "NULL"} ≠ ${p.centerId ?? "NULL"})`);
      const khai = maGiaoDichTrongGhiChu(p.note, g.provider);
      if (khai.length > 0 && !khai.includes(g.providerTxnId)) {
        them("GIAO_DICH_GHI_CHU_LECH", `khoản ${p.id}: ghi chú khai mã giao dịch khác với ứng viên duy nhất (tín hiệu phụ không khớp)`);
      }
    }
  }
  // Số tiền lệch (cùng số lượng nhưng khác tập số tiền) và giao dịch thừa là hai điều kiện RIÊNG, không để «0 ứng viên» nuốt.
  const tapTienKhoan = song.map((p) => p.amount).sort((a, b) => a - b).join(",");
  const tapTienGiaoDich = matched.map((g) => g.amount).sort((a, b) => a - b).join(",");
  if (matched.length === song.length && tapTienKhoan !== tapTienGiaoDich) them("GIAO_DICH_LECH_SO_TIEN", `tập số tiền giao dịch ngân hàng [${tapTienGiaoDich}] ≠ tập số tiền khoản [${tapTienKhoan}]`);
  if (matched.length > song.length) them("GIAO_DICH_THUA", `${matched.length} giao dịch MATCHED có phân bổ vào đơn > ${song.length} khoản sống`);
  if (new Set(giaoDichDung).size !== giaoDichDung.length) them("TRUNG_GIAO_DICH", "hai khoản của đơn cùng chọn MỘT giao dịch ngân hàng");

  // ── tiền ──
  const tongKhoan = song.reduce((s, p) => s + p.amount, 0);
  if (tongKhoan !== muc.giaDich) them("TIEN_PAYMENT_LECH", `Σ Payment sống ${tongKhoan} ≠ giá đích ${muc.giaDich}`);
  if (d.tongPhanBoDon !== muc.giaDich) them("TIEN_PHAN_BO_LECH", `Σ phân bổ ngân hàng ${d.tongPhanBoDon} ≠ giá đích ${muc.giaDich}`);

  // ── khoản đã xoá mềm: giữ nguyên, không gắn ──
  if (d.paymentDaXoa.length !== muc.soKhoanDaXoa || d.paymentDaXoa.some((x) => x.enrollmentId !== null)) {
    them("PAYMENT_XOA_LECH", `${d.paymentDaXoa.length} khoản đã xoá mềm ≠ ${muc.soKhoanDaXoa} đã audit, hoặc có khoản xoá đã gắn ghi danh`);
  }

  // ── hoá đơn điện tử: số khoản bị giữ phải đúng bảng, và cùng MỘT hoá đơn (chỉ GẮN, không đổi tiền ⇒ được phép) ──
  const hdCuaKhoan = song.flatMap((p) => (d.trongHoaDon[p.id] !== undefined ? [d.trongHoaDon[p.id]!] : []));
  if (hdCuaKhoan.length !== muc.soKhoanTrongHoaDon || new Set(hdCuaKhoan).size > 1) {
    them("HOA_DON_LECH", `${hdCuaKhoan.length} khoản trong ${new Set(hdCuaKhoan).size} hoá đơn ≠ ${muc.soKhoanTrongHoaDon} khoản trong tối đa 1 hoá đơn đã audit`);
  }

  // ── tác dụng phụ ──
  if (d.tacDungPhu !== 0) them("CO_TAC_DUNG_PHU", `${d.tacDungPhu} dòng Receipt / hoa hồng / StudentTransaction / hoàn tiền / bút toán trỏ vào khoản-đơn-ghi danh này — cần xử lý riêng`);
  if (d.paymentNgoaiGanGhiDanh !== 0) them("GHI_DANH_CO_PAYMENT_NGOAI", `${d.paymentNgoaiGanGhiDanh} Payment sống ngoài đơn đã gắn ghi danh đích`);

  // ── trạng thái gắn: toàn đơn hoặc chưa gắn, hoặc gắn đúng ──
  const soGan = song.filter((p) => p.enrollmentId !== null).length;
  const trangThai: TrangThaiGanPayment = soGan === 0 ? "CHUA_GAN" : soGan === song.length ? "DA_GAN" : "LECH";
  if (trangThai === "LECH") them("LO_HON_HOP", `${soGan}/${song.length} khoản của đơn đã gắn ghi danh — đơn lai, không ghi`);

  // ── planner chuẩn: mọi khoản CHƯA gắn phải là GAN một mảnh, giữ nguyên tiền, trỏ đúng đích ──
  if (trangThai === "CHUA_GAN") {
    for (const p of song) {
      const r = d.plannerChuan.find((x) => x.paymentId === p.id);
      if (!r) them("KE_HOACH_CHUAN_LECH", `planner chuẩn không trả dòng cho khoản ${p.id}`);
      else if (r.ketQua !== "GAN" || r.soPhan !== 1 || !r.giuNguyenTien || dich === null || r.enrollmentId !== dich || r.amount !== p.amount) {
        them("KE_HOACH_CHUAN_LECH", `planner chuẩn cho khoản ${p.id}: ${r.ketQua}${r.maBoQua ? `/${r.maBoQua}` : ""} · ${r.soPhan} mảnh · giữ tiền=${r.giuNguyenTien} · → ${r.enrollmentId ?? "NULL"} (${r.amount ?? "NULL"}) — đòi GAN 1 mảnh → ghi danh đích (${p.amount})`);
      }
    }
  }

  // ── nợ dự kiến SAU khi gắn: chính hàm của repo (thực thu − finalPrice) ──
  const noDuKien = ge === null ? null : computeDebt(ge.finalPrice ?? 0, tinhThucThu(song.map((p) => ({ id: p.id, amount: p.amount, accountantStatus: p.accountantStatus, adjustmentOfId: p.adjustmentOfId }))));
  if (noDuKien !== null && noDuKien !== 0) them("NO_DU_KIEN_KHAC_0", `nợ dự kiến sau khi gắn = ${noDuKien} ≠ 0`);

  const ghi: DongGanPayment[] = [];
  if (l.length === 0 && trangThai === "CHUA_GAN" && dich !== null && dong !== null) {
    for (const p of song) {
      ghi.push({ orderId: don.id, code, paymentId: p.id, amount: p.amount, enrollmentId: dich, orderItemId: dong.id, providerTxnId: chon.get(p.id)!.providerTxnId, hoaDonId: d.trongHoaDon[p.id] ?? null });
    }
  }
  return {
    muc: {
      code,
      trangThai: l.length > 0 ? "LECH" : trangThai,
      enrollmentId: ge?.id ?? null,
      soKhoan: song.length,
      soChuaGan: song.length - soGan,
      tongKhoan,
      tongDon: don.totalAmount,
      tongPhanBo: d.tongPhanBoDon,
      noDuKien,
      loi: l,
    },
    ghi,
    giaoDichDung,
  };
}

/**
 * Lập kế hoạch cho cả lô. `bang` là phạm vi CỨNG. Mọi mã phải có đúng một đơn trong dữ liệu. Fail-closed: bất kỳ lỗi nào ⇒ `dung` và `ghi = []`.
 */
export function lapKeHoachGanPayment(input: { bang: Readonly<Record<string, MucGanPayment>>; du: readonly DuLieuGanPayment[] }): KeHoachGanPayment {
  const loiLo: LoiGanPayment[] = [];
  const muc: MucKeHoachGanPayment[] = [];
  const dong: DongGanPayment[] = [];
  const ma = Object.keys(input.bang);
  const ghiDanhDich = new Map<string, string[]>();
  const giaoDichDaChon = new Map<string, string[]>();
  for (const code of ma) {
    const cac = input.du.filter((x) => x.don.code === code);
    if (cac.length !== 1) {
      loiLo.push(loi(code, "THIEU_DON", cac.length === 0 ? "không có đơn mang mã này" : `${cac.length} đơn cùng mã`));
      muc.push({ code, trangThai: "LECH", enrollmentId: null, soKhoan: 0, soChuaGan: 0, tongKhoan: null, tongDon: null, tongPhanBo: null, noDuKien: null, loi: [loi(code, "THIEU_DON", `đọc được ${cac.length} đơn`)] });
      continue;
    }
    const d = cac[0]!;
    const k = kiemMotDon(d, input.bang[code]!);
    muc.push(k.muc);
    dong.push(...k.ghi);
    const dich = d.don.items.find((i) => i.type === "COURSE_ENROLLMENT")?.enrollmentId ?? null;
    if (dich !== null) ghiDanhDich.set(dich, [...(ghiDanhDich.get(dich) ?? []), code]);
    for (const id of new Set(k.giaoDichDung)) giaoDichDaChon.set(id, [...(giaoDichDaChon.get(id) ?? []), code]);
  }
  for (const x of input.du) if (!(x.don.code in input.bang)) loiLo.push(loi(x.don.code, "KHONG_CO_MUC_TIEU", "đơn nằm NGOÀI phạm vi cứng"));

  // Hai đơn cùng ghi danh đích (đọc từ DỮ LIỆU, không từ mã nguồn); một giao dịch ngân hàng được hai đơn cùng chọn.
  for (const [id, codes] of ghiDanhDich) if (codes.length > 1) loiLo.push(loi(codes.join(","), "TRUNG_GHI_DANH", `ghi danh ${id} là đích của ${codes.length} đơn`));
  for (const [id, codes] of giaoDichDaChon) if (codes.length > 1) loiLo.push(loi(codes.join(","), "TRUNG_GIAO_DICH", `giao dịch ngân hàng ${id} được ${codes.length} đơn cùng chọn`));

  const loiTungDon = muc.flatMap((x) => x.loi);
  const chua = muc.filter((x) => x.trangThai === "CHUA_GAN").length;
  const da = muc.filter((x) => x.trangThai === "DA_GAN").length;
  if (loiTungDon.length === 0 && loiLo.length === 0 && chua > 0 && da > 0) {
    loiLo.push(loi(ma.join(","), "LO_HON_HOP", `${chua} đơn chưa gắn + ${da} đơn đã gắn — lô lai, không ghi`));
  }
  const tatCaLoi = [...loiTungDon, ...loiLo];
  const dung = tatCaLoi.length > 0;
  const ghi = dung ? [] : dong;
  const dongDauRa = dongDauRaGanPayment(ghi);
  return { muc, loi: tatCaLoi, dung, ghi, daGanHet: !dung && muc.length > 0 && da === muc.length, dongDauRa, sha: shaKeHoachGanPayment(dongDauRa) };
}

/** Cổng số duyệt `--expect=<N>`: N = số KHOẢN sẽ gắn. `null` nếu qua; ngược lại câu lỗi. */
export function quyetDinhGhiGanPayment(i: { soDuyet: number | null; keHoach: KeHoachGanPayment; ghiDuoc: boolean | null }): string | null {
  if (i.soDuyet === null) return "--ghi đòi --expect=<N> (số KHOẢN SẼ GẮN của lượt chạy thử đã được duyệt).";
  if (Number.isNaN(i.soDuyet)) return "--expect phải là số nguyên không dấu (chỉ chữ số thập phân).";
  if (i.keHoach.dung) return `Kế hoạch DỪNG (${i.keHoach.loi.length} lỗi) — không ghi gì: ${i.keHoach.loi.map((x) => `${x.code}:${x.ma}`).join(" · ")}`;
  if (i.ghiDuoc !== true) return i.ghiDuoc === false ? "User kết nối không có quyền UPDATE trên Payment — không ghi." : "Không kiểm được quyền UPDATE trên Payment — không ghi.";
  if (i.soDuyet !== i.keHoach.ghi.length) return `Số duyệt ${i.soDuyet} ≠ kế hoạch lúc chạy ${i.keHoach.ghi.length} — không ghi.`;
  return null;
}

/** `--expect=` chặt: chỉ chữ số thập phân thuần; sai khuôn ⇒ `NaN` (KHÔNG `Number()`). */
export function phanTichSoDuyetGanPayment(argv: readonly string[]): number | null {
  const a = argv.find((x) => x.startsWith("--expect="));
  if (a === undefined) return null;
  const raw = a.slice("--expect=".length);
  if (!/^[0-9]+$/.test(raw)) return Number.NaN;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

// ─── Audit mức lượt chạy ───────────────────────────────────────────────────────────────────────────────

export const HANH_DONG_GAN_PAYMENT_LUOT = "GAN_PAYMENT_GHI_DANH_LUOT_CHAY";
export type LuotChayGanPayment = { batDauLuc: Date; nguonChay: NguonChayDiTru };
export const khoaLuotChayGanPayment = (n: NguonChayDiTru) => `luot:${n.runId ?? "khong-co-run"}:${n.runAttempt ?? "1"}`;

export function dungBanGhiLuotGanPayment(i: { luot: LuotChayGanPayment; soDuyet: number; keHoach: KeHoachGanPayment; daGhi: number }): Record<string, unknown> {
  if (!(i.luot.batDauLuc instanceof Date) || Number.isNaN(i.luot.batDauLuc.getTime())) {
    throw new Error("dungBanGhiLuotGanPayment: batDauLuc phải là mốc thời gian hợp lệ (nơi gọi truyền vào; lõi không đọc đồng hồ).");
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
    khoanDaGan: i.keHoach.ghi.map((g) => g.paymentId),
    lyDo: LY_DO_GAN_PAYMENT,
    nguonChay: { actor: n.actor, triggeringActor: n.triggeringActor, runId: n.runId, runAttempt: n.runAttempt },
  };
}
