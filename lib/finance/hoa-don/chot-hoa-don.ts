import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { LoiXacNhanKhoan, xacNhanKhoanTrongTx } from "@/lib/finance/payment";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";
import { publishEvent } from "@/lib/events/publish";
import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import { soTienRong } from "./nguon-khoan";
import { donCoKhoanNganHang, TRANG_THAI_DON_DA_HUY } from "./du-dieu-kien";
import { nguonGiaoDich } from "./nguon-khoan";
import { nguoiMuaChoDon } from "./nguoi-mua";
import { COT_NGUOI_MUA } from "./ghi-hoa-don";
import { chuanEmail } from "./trang-thai-email";
import { lanThuCuaHoaDon, type LanThu } from "./lan-thu";
import { chuaKhopTheoSdt } from "./chua-khop";
import { canonicalPhone } from "@/lib/phone";
import { coQuyenKeToanTaiCoSo } from "./quyen";
import {
  CAU_HOAN_CHAN_XAC_NHAN,
  chonHoanCuaDon,
  dieuKienHoanCuaDon,
  hoanTheoDon,
  lyDoHoanChanXacNhan,
  TRANG_THAI_HOAN_CAN_NAP,
} from "./hoan-tien-don";

// lib/finance/hoa-don/chot-hoa-don.ts — bước ⑤ "Xác nhận" của màn Hoá đơn điện tử
// (docs/ke-toan-hoa-don/PLAN.md §4 ⑤ + §0.1 phương án (b) + "Điều chỉnh sau GĐ 0" mục 1).
//
// Nút = CHỐT HOÁ ĐƠN. Xác nhận KHOẢN THU chỉ là phần đi kèm: khoản nào còn CHỜ và ĐỦ điều kiện (có
// ghi danh, không phải chính người bấm ghi nhận — AC5, tiền ròng > 0) thì xác nhận + cấp RCP trong
// CÙNG transaction; khoản nào không thì GIỮ CHỜ và trả về lý do. Không khoản nào chặn việc chốt
// hoá đơn — hoá đơn đã xuất ở MISA rồi (chủ dự án 26/09), đo prod 22/31 khoản chờ thiếu ghi danh.
//
// Thứ tự trong transaction — MỌI cổng đứng TRƯỚC phép ghi đầu tiên, từ chối = NÉM:
//   khoá đơn (advisory) → đọc hoá đơn NHÁP → đơn còn sống → khoá HÀNG các khoản (FOR UPDATE) →
//   không có yêu cầu hoàn CHỜ / ĐÃ DUYỆT / ĐÃ CHI chạm khoản của hoá đơn →
//   mọi khoản thuộc phạm vi KẾ TOÁN của người bấm (theo `Payment.centerId`) →
//   tiền ròng từng khoản == số đã chụp lúc lưu nháp → lần thu DỰNG LẠI còn đủ (đợt không huỷ; thiếu thì
//   phải có "xuất theo số đã thu") → nghi trùng → email → [ghi #1] NHAP→DA_XAC_NHAN có điều kiện (chụp
//   lại email + tiền tha) → xác nhận từng khoản còn chờ → nhật ký.
// ⚠️ Người gọi (action) đã: kiểm quyền kế toán ĐÚNG cơ sở, dựng lại dòng bằng loader của màn và thấy
// nút Xác nhận SÁNG (lần thu đủ / đã chọn xuất theo số đã thu, có PDF + ký hiệu + số + ngày), và
// HEAD kho tệp thấy PDF còn đó. Ở đây là phần phải NGUYÊN TỬ — kể cả KIỂM LẠI dưới khoá những gì đổi
// được giữa lúc tải màn và lúc bấm (đợt bị sửa / huỷ, khoản mang cơ sở khác).

export type MaLoiChot =
  | "DA_DOI"
  | "THIEU_THONG_TIN"
  | "DON_DA_HUY"
  | "TIEN_DA_DOI"
  | "NGHI_TRUNG"
  | "EMAIL_DA_DOI"
  | "NGOAI_PHAM_VI"
  | "LAN_THU_THIEU"
  | "DOT_DA_HUY"
  | "CO_YEU_CAU_HOAN";

const CAU_LOI: Record<MaLoiChot, string> = {
  DA_DOI: "Hoá đơn vừa được người khác xác nhận, sửa hoặc gỡ — tải lại màn",
  THIEU_THONG_TIN: "Hoá đơn chưa đủ tệp PDF, ký hiệu, số và ngày phát hành",
  DON_DA_HUY: "Đơn đã huỷ / hoàn — không chốt hoá đơn cho đơn này",
  TIEN_DA_DOI: "Số tiền của lần thu đã đổi sau khi lưu nháp (hoàn / điều chỉnh / gỡ) — kiểm lại rồi lưu lại hoá đơn",
  NGOAI_PHAM_VI:
    "Hoá đơn có khoản thu thuộc cơ sở ngoài phạm vi kế toán của bạn — nhờ kế toán của cơ sở đó (hoặc kế toán Hội sở) xác nhận",
  LAN_THU_THIEU:
    'Lần thu không còn đủ tiền so với đợt (đợt vừa bị sửa số hoặc tiền vừa bị gỡ) — tải lại màn; phụ huynh không trả nốt thì chọn "Xuất theo số đã thu"',
  DOT_DA_HUY: "Đợt của lần thu này vừa bị huỷ — không chốt hoá đơn: gỡ bản nháp rồi chọn 'Không xuất' hoặc xử lý hoàn tiền",
  NGHI_TRUNG:
    'Khoản khai tay trong hoá đơn có thể trùng tiền chuyển khoản của đơn (hoặc một giao dịch chưa khớp cùng SĐT, cùng số tiền) — bấm "Không trùng — vẫn xuất" (kèm lý do) trước khi xác nhận',
  EMAIL_DA_DOI: "Email nhận hoá đơn vừa đổi trên đơn — tải lại màn, xem lại nút rồi bấm lại",
  // CÙNG câu với nút Xác nhận tắt trên màn (`hanhDongChoDong`) — một hằng, một hàm quyết.
  CO_YEU_CAU_HOAN: CAU_HOAN_CHAN_XAC_NHAN,
};

/** So email theo nghĩa nhận thư: bỏ khoảng trắng, không phân biệt hoa thường; rỗng ⇒ null. */

export class LoiChotHoaDon extends Error {
  constructor(readonly ma: MaLoiChot) {
    super(CAU_LOI[ma]);
    this.name = "LoiChotHoaDon";
  }
}

/** Câu cho người dùng nếu `e` là lỗi nghiệp vụ đã biết; `null` ⇒ lỗi lạ, người gọi ném tiếp. */
export function thongDiepLoiChot(e: unknown): string | null {
  return e instanceof LoiChotHoaDon || e instanceof LoiXacNhanKhoan ? e.message : null;
}

export type KetQuaChot = {
  /** Đã giành lượt gửi email hoá đơn cho khách (tầng email gửi sau commit). */
  coGuiEmail: boolean;
  /** Khoản vừa được xác nhận trong lượt này (có phiếu RCP). */
  daXacNhan: { paymentId: string; receiptCode: string | null }[];
  /** Khoản vẫn CHỜ kế toán — kèm lý do để màn nói ra. */
  conCho: { paymentId: string; lyDo: string }[];
};

/** Khoản của hoá đơn / lần thu đem ra kiểm: số RÒNG đã chụp (lúc lưu nháp, hoặc lúc bấm phát hành). */
export type KhoanKiem = { paymentId: string; soTien: number };

/** Một dòng `Payment` của đơn như cổng chốt đọc (cột đủ cho nghi trùng, phạm vi, xác nhận khoản). */
type DongKhoanChot = {
  id: string;
  amount: number;
  adjustmentOfId: string | null;
  deletedAt: Date | null;
  accountantStatus: string;
  enrollmentId: string | null;
  orderItemId: string | null;
  recordedById: string | null;
  note: string | null;
  paymentType: string;
  method: string;
  centerId: string | null;
  paidDate: Date;
};

type DonChot = { status: string; deletedAt: Date | null; centerId: string | null; type: string } & {
  [K in keyof typeof COT_NGUOI_MUA]: string | null;
};

export type KetQuaCongChot = {
  don: DonChot;
  theoIdDong: Map<string, DongKhoanChot>;
  rong: Map<string, number>;
  lanThu: LanThu;
};

/**
 * CÁC CỔNG CỦA BƯỚC CHỐT, dùng chung cho `chotHoaDon` (luồng tay, bản NHÁP) VÀ `batDauPhatHanh`
 * (bước 1 MISA, 30/09 — chưa có bản ghi nào). MỘT hàm, không hai bản chép: một cổng thêm ở đây là thêm
 * cho cả hai đường, và phát hành qua MISA không bao giờ lỏng hơn xác nhận bằng tay.
 *
 * Người gọi PHẢI đã `khoaDonTrongTx(tx, orderId)`. Không ghi gì — từ chối = NÉM `LoiChotHoaDon`.
 * Thứ tự: đơn còn sống → khoá HÀNG các khoản → yêu cầu hoàn chạm khoản → phạm vi kế toán TỪNG khoản →
 * tiền ròng == số đã chụp → dựng lại lần thu (đợt huỷ / thiếu) → nghi trùng.
 */
export async function kiemCongChotTrongTx(
  tx: Prisma.TransactionClient,
  input: {
    actor: ActionScopeActor;
    orderId: string;
    /** Cơ sở của hoá đơn (= cơ sở của đơn lúc tạo) — khoản chưa có cơ sở tính theo cơ sở này. */
    centerId: string;
    khoan: readonly KhoanKiem[];
    /** Lối ra "không trùng — vẫn xuất" đã ghi (lý do) — `null` = chưa. */
    khongTrungLyDo: string | null;
    xuatTheoSoDaThu: boolean;
    xuatTheoSoDaThuLyDo: string | null;
  },
): Promise<KetQuaCongChot> {
  const { orderId } = input;
  if (input.khoan.length === 0) throw new LoiChotHoaDon("DA_DOI");
  const don = await tx.order.findUnique({
    where: { id: orderId },
    // `type` — đơn KIT / THI không có ghi danh ⇒ khoản xác nhận được không cần gắn (`can-ghi-danh.ts`).
    select: { status: true, deletedAt: true, centerId: true, type: true, ...COT_NGUOI_MUA },
  });
  if (!don || don.deletedAt || (TRANG_THAI_DON_DA_HUY as readonly string[]).includes(don.status)) {
    throw new LoiChotHoaDon("DON_DA_HUY");
  }

  const ids = input.khoan.map((k) => k.paymentId);
  // Khoá HÀNG các khoản — không đổi cột nào, chỉ chặn người khác sửa song song.
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
  // Tiền RÒNG cần MỌI dòng của đơn (bút toán đảo trỏ `adjustmentOfId` về khoản gốc).
  const cacDong = await tx.payment.findMany({
    where: { orderId, deletedAt: null },
    select: {
      id: true,
      amount: true,
      adjustmentOfId: true,
      deletedAt: true,
      accountantStatus: true,
      enrollmentId: true,
      // 29/09 — móc con của khoản: cổng yêu cầu hoàn chỉ tính yêu cầu CHẠM khoản của hoá đơn này.
      orderItemId: true,
      recordedById: true,
      // GĐ 8 — nguồn tiền (marker) + loại dòng: cổng nghi trùng dưới đây cần. Thiếu `note` thì mọi
      // khoản đọc thành tiền mặt và cổng không bao giờ bắn (phép cấy ghim đúng chỗ này).
      note: true,
      paymentType: true,
      method: true,
      // Cổng phạm vi (theo cơ sở của TỪNG khoản) + ngày thu của lần thu dựng lại bên dưới.
      centerId: true,
      paidDate: true,
    },
  });
  const theoIdDong = new Map<string, DongKhoanChot>(cacDong.map((p) => [p.id, p]));

  // 29/09 (Q1b) — yêu cầu hoàn học phí CHỜ / ĐÃ DUYỆT / ĐÃ CHI CHẠM khoản của hoá đơn này ⇒ số trên tờ chưa
  // chắc đúng: từ chối, TRƯỚC phép ghi đầu tiên. CÙNG hàm + CÙNG đường nạp với nút trên màn
  // (`chonHoanCuaDon` → `hoanTheoDon` → `lyDoHoanChanXacNhan`) — nạp đủ trạng thái rồi để hàm quyết, không
  // lọc trạng thái ở câu tra (lọc ở đây là viết luật lần thứ hai). Chỉ tính yêu cầu chạm khoản của hoá đơn
  // (hoàn cho bé khác cùng đơn không chặn); mơ hồ ⇒ theo cả đơn. Không sửa sổ tiền.
  const hoan = await tx.refundRequest.findMany({
    where: dieuKienHoanCuaDon([orderId], TRANG_THAI_HOAN_CAN_NAP),
    select: chonHoanCuaDon([orderId]),
  });
  const phamViKhoan = input.khoan.map((k) => {
    const p = theoIdDong.get(k.paymentId);
    return { orderItemId: p?.orderItemId ?? null, enrollmentId: p?.enrollmentId ?? null };
  });
  if (lyDoHoanChanXacNhan(hoanTheoDon(hoan).get(orderId) ?? [], phamViKhoan)) {
    throw new LoiChotHoaDon("CO_YEU_CAU_HOAN");
  }

  // PLAN §4 ⑤ + §9 — MỌI khoản của hoá đơn phải thuộc tập cơ sở KẾ TOÁN của người bấm, đo theo
  // `Payment.centerId`: cổng action chỉ hỏi cơ sở của ĐƠN, mà đơn CS1 có thể mang khoản ghi cho CS2.
  // Khoản chưa có cơ sở (NULL — dữ liệu cũ) tính theo cơ sở của hoá đơn: đúng cơ sở cổng action đã
  // hỏi, không nới thêm ai.
  for (const k of input.khoan) {
    const coSo = theoIdDong.get(k.paymentId)?.centerId ?? input.centerId;
    if (!coQuyenKeToanTaiCoSo(input.actor, coSo)) throw new LoiChotHoaDon("NGOAI_PHAM_VI");
  }

  const rong = soTienRong(cacDong);
  for (const k of input.khoan) {
    if ((rong.get(k.paymentId) ?? 0) !== k.soTien) throw new LoiChotHoaDon("TIEN_DA_DOI");
  }

  // PLAN §4 ⑤ "nhóm vẫn DU" — dựng LẠI lần thu dưới khoá đơn bằng CHÍNH hàm màn dùng
  // (`lanThuCuaHoaDon`), trên đợt + phân bổ + giao dịch đọc trong transaction. Đợt bị NÂNG số / bị HUỶ
  // giữa lúc lưu nháp và lúc bấm thì số ròng từng khoản không đổi (cổng trên không thấy) mà tờ hoá đơn
  // thành nói "đủ" cho một đợt không còn đủ. Giao dịch CHƯA KHỚP nạp HẸP (chỉ đúng số tiền khai tay) ngay
  // dưới — vế nghi trùng 13a.
  const dotDon = await tx.paymentRequest.findMany({
    where: { orderId },
    select: {
      id: true,
      installmentNo: true,
      amountDue: true,
      status: true,
      allocations: { select: { bankTransactionId: true, paymentRequestId: true, amount: true, roundingWaived: true } },
    },
  });
  const phanBo = dotDon.flatMap((r) => r.allocations);
  const btIds = new Set(phanBo.map((a) => a.bankTransactionId));
  const txnIds = new Set<string>();
  for (const p of cacDong) {
    const n = nguonGiaoDich(p.note);
    if (n.loai === "GAN_TAY") btIds.add(n.bankTransactionId);
    else if (n.loai === "WEBHOOK") txnIds.add(n.providerTxnId);
  }
  const giaoDich =
    btIds.size + txnIds.size === 0
      ? []
      : await tx.bankTransaction.findMany({
          where: { OR: [{ id: { in: [...btIds] } }, { providerTxnId: { in: [...txnIds] } }] },
          select: { id: true, provider: true, providerTxnId: true, transferredAt: true, amount: true },
        });
  const coCK = donCoKhoanNganHang(cacDong, don, rong);
  const khoanLanThu = input.khoan
    .map((k) => theoIdDong.get(k.paymentId))
    .filter((p): p is DongKhoanChot => p != null)
    .map((p) => ({ id: p.id, rong: rong.get(p.id) ?? 0, nguon: nguonGiaoDich(p.note), paidDate: p.paidDate }));
  // PLAN GĐ 8 mục 13a — vế "giao dịch CHƯA KHỚP cùng SĐT, cùng số tiền" của nghi trùng, kiểm LẠI trong
  // transaction. Không quét cả hệ thống: chỉ giao dịch UNMATCHED có SỐ TIỀN bằng một khoản khai tay của
  // hoá đơn (vế này chỉ so đúng số đó), trong cơ sở của đơn hoặc chưa về cơ sở nào — đúng tập kế toán cơ
  // sở thấy trên màn. Rồi bóc SĐT bằng CÙNG luật với loader (`chuaKhopTheoSdt`).
  const soLoiKhai = [...new Set(khoanLanThu.filter((k) => k.nguon.loai === "LOI_KHAI").map((k) => k.rong))];
  const sdtDon = canonicalPhone(don.customerPhone);
  const chuaKhop =
    sdtDon && soLoiKhai.length > 0
      ? (chuaKhopTheoSdt(
          await tx.bankTransaction.findMany({
            where: {
              status: "UNMATCHED",
              amount: { in: soLoiKhai },
              OR: [{ centerId: null }, ...(don.centerId ? [{ centerId: don.centerId }] : [])],
            },
            select: { provider: true, amount: true, content: true },
          }),
        ).get(sdtDon) ?? [])
      : [];
  const lanThu = lanThuCuaHoaDon({
    khoan: khoanLanThu,
    giaoDich,
    phanBo,
    dot: dotDon.map(({ id, installmentNo, amountDue, status }) => ({ id, installmentNo, amountDue, status })),
    giaoDichChuaKhop: chuaKhop,
    donCoKhoanNganHang: coCK,
  });
  if (!lanThu) throw new LoiChotHoaDon("DA_DOI");
  if (lanThu.trangThai === "DOT_HUY") throw new LoiChotHoaDon("DOT_DA_HUY");
  // Ngoại lệ "xuất theo số đã thu" (Q-mở 1) chỉ mở được lần thu THIẾU, và chỉ khi mang lý do — cùng
  // luật CHECK ở DB (`HoaDonDienTu_xuatTheoSoDaThu_lyDo_check`, NOT VALID nên dòng cũ không được tin).
  const theoSoHopLe = input.xuatTheoSoDaThu && Boolean(input.xuatTheoSoDaThuLyDo?.trim());
  if (lanThu.trangThai === "THIEU" && !theoSoHopLe) throw new LoiChotHoaDon("LAN_THU_THIEU");

  // GĐ 8 — NGHI TRÙNG kiểm LẠI trong transaction, theo CẢ ĐƠN: hoá đơn giữ khoản KHAI TAY trong khi đơn
  // có khoản chuyển khoản còn là tiền thật ⇒ phải có "không trùng" (kèm lý do) mới chốt. Màn đã tắt nút
  // cho ca này, nhưng tập khoản đổi được giữa lúc tải màn và lúc bấm.
  // 13a — cả vế "giao dịch chưa khớp cùng số" (`nghiTrungVi` của CHÍNH hàm màn dùng).
  const coLoiKhai = input.khoan.some((k) => nguonGiaoDich(theoIdDong.get(k.paymentId)?.note).loai === "LOI_KHAI");
  if (coLoiKhai && input.khongTrungLyDo == null && (coCK || lanThu.nghiTrungVi.includes("CHUA_KHOP_CUNG_SO"))) {
    throw new LoiChotHoaDon("NGHI_TRUNG");
  }
  return { don, theoIdDong, rong, lanThu };
}

/**
 * HỆ QUẢ SAU-XÁC-NHẬN, dùng chung cho `chotHoaDon` (NHAP → DA_XAC_NHAN) VÀ bước hoàn tất phát hành MISA
 * (DANG_PHAT_HANH → DA_XAC_NHAN): [ghi #1] chuyển trạng thái CÓ ĐIỀU KIỆN (0 dòng ⇒ ném DA_DOI) → giành
 * lượt email đầu tiên (hoặc báo "khách không có email") → xác nhận từng khoản còn chờ đủ điều kiện (RCP)
 * → nhật ký. Người gọi đã khoá đơn và đã qua mọi cổng — hàm này không từ chối vì nghiệp vụ.
 */
export async function hoanTatChotTrongTx(
  tx: Prisma.TransactionClient,
  input: {
    nguoiChot: AuditActor & { id: string };
    orderId: string;
    hoaDonId: string;
    /** Trạng thái NGUỒN của phép ghi có điều kiện. */
    tu: "NHAP" | "DANG_PHAT_HANH";
    /** Phiên bản đã đọc trong transaction — ghi có điều kiện theo nó (chống bấm đôi / sửa chồng). */
    updatedAt: Date;
    now: Date;
    don: DonChot;
    theoIdDong: ReadonlyMap<string, Pick<DongKhoanChot, "accountantStatus" | "enrollmentId" | "recordedById">>;
    rong: ReadonlyMap<string, number>;
    paymentIds: readonly string[];
    guiEmailKhach: boolean;
    /** Tiền tha làm tròn CHỤP LẠI lúc chốt (Q-mở 4). */
    tienTha: number;
    centerId: string;
    /** Phần riêng của nhật ký (số, ký hiệu, tổng, nguồn…) — gộp vào `newValues`. */
    nhatKy: Record<string, string | number | boolean | null>;
  },
): Promise<KetQuaChot> {
  const { nguoiChot, orderId, hoaDonId, now, don } = input;
  // GĐ 8 — email CHỤP LẠI lúc chốt từ đơn (nhãn nút đã hứa đúng địa chỉ này).
  const emailHienTai = nguoiMuaChoDon(don).email;

  // ── Ghi #1 — có điều kiện (chống bấm đôi / hai kế toán cùng chốt): 0 dòng ⇒ ném.
  // Tiền tha làm tròn (Q-mở 4 — hiện RIÊNG, không cộng vào tổng) CHỤP LẠI từ lần thu vừa dựng, cùng
  // luật với email: tờ đã chốt nói đúng trạng thái tiền LÚC CHỐT, không phải lúc lưu nháp.
  const upd = await tx.hoaDonDienTu.updateMany({
    where: { id: hoaDonId, trangThai: input.tu, updatedAt: input.updatedAt },
    data: {
      trangThai: "DA_XAC_NHAN",
      xacNhanBoiId: nguoiChot.id,
      xacNhanLuc: now,
      emailNhan: emailHienTai,
      tienThaLamTron: input.tienTha,
    },
  });
  if (upd.count !== 1) throw new LoiChotHoaDon("DA_DOI");

  // Lượt gửi email ĐẦU TIÊN — giành chỗ trong CÙNG transaction (PLAN §7): chốt mà quên ghi là
  // khách không bao giờ nhận; ghi ngoài transaction là chốt hỏng vẫn có lượt gửi. Việc GỬI do
  // tầng email làm sau commit; `@@unique([hoaDonId, lanGui])` chặn giành chỗ hai lần.
  // Không email / kế toán bỏ tick (MISA đã gửi rồi) ⇒ không có lượt nào — sale gửi Zalo.
  const toi = input.guiEmailKhach ? emailHienTai : null;
  const coGuiEmail = Boolean(toi);
  if (toi) {
    const gui = await tx.hoaDonGuiEmail.create({
      data: { hoaDonId, lanGui: 1, toi, trangThai: "CHO", guiBoiId: nguoiChot.id },
      select: { id: true },
    });
    // Tên sự kiện viết LITERAL — lưới `lib/events/khop-phat-nghe.test.ts` chỉ đọc được chuỗi literal.
    await publishEvent("hoa-don.gui", { guiId: gui.id }, { tx, dedupeKey: `hoa-don.gui:${gui.id}` });
  } else if (input.guiEmailKhach) {
    // Muốn gửi mà khách KHÔNG có email ⇒ báo sale tải hoá đơn trên trang đơn để gửi Zalo.
    // Bỏ tick (MISA đã gửi rồi) thì không báo ai — không có việc gì phải làm.
    await publishEvent("hoa-don.khong-email", { hoaDonId }, { tx, dedupeKey: `hoa-don.khong-email:${hoaDonId}` });
  }

  const kq: KetQuaChot = { coGuiEmail, daXacNhan: [], conCho: [] };
  for (const id of input.paymentIds) {
    const p = input.theoIdDong.get(id);
    if (!p || p.accountantStatus !== "PENDING") continue;
    // Hai lý do giữ CHỜ nói trước bằng câu của nghiệp vụ; lý do khác do lõi quyết (và NÉM nếu
    // trạng thái đổi giữa chừng — không nuốt).
    // Đơn KIT / THI không có ghi danh ⇒ không giữ CHỜ vì lý do này — lõi xác nhận như khoản thường.
    if (thieuGhiDanh(p, don.type)) {
      kq.conCho.push({
        paymentId: id,
        // GĐ 8b — đường gắn ở màn Thanh toán từ chối đơn lập từ lead ⇒ trỏ về mục trên CHÍNH dòng này.
        lyDo: "Khoản chưa gắn ghi danh — gắn ở mục 'Gắn ghi danh' trên dòng này rồi xác nhận khoản ở màn Thanh toán",
      });
      continue;
    }
    if (p.recordedById && p.recordedById === nguoiChot.id) {
      kq.conCho.push({ paymentId: id, lyDo: "Khoản do chính bạn ghi nhận — cần một kế toán khác xác nhận" });
      continue;
    }
    // Bước 1 MISA — tiền ròng không còn dương (bị đảo hết giữa lúc gửi và lúc MISA trả số) thì lõi sẽ NÉM
    // và kéo đổ cả việc GHI NHẬN một hoá đơn MISA đã phát hành thật. Giữ CHỜ, nói ra. Ở luồng tay cổng
    // TIEN_DA_DOI đã chặn trước nên nhánh này không chạy ở đó.
    if ((input.rong.get(id) ?? 0) <= 0) {
      kq.conCho.push({ paymentId: id, lyDo: "Tiền ròng của khoản không còn dương — kiểm lại ở màn Thanh toán" });
      continue;
    }
    const r = await xacNhanKhoanTrongTx(tx, { paymentId: id, confirmedById: nguoiChot.id, actor: nguoiChot, now });
    kq.daXacNhan.push({ paymentId: id, receiptCode: r.receiptCode ?? null });
  }

  await writeAudit({
    tx,
    actor: nguoiChot,
    module: "finance",
    entityType: "HoaDonDienTu",
    entityId: hoaDonId,
    action: "XAC_NHAN_HOA_DON",
    oldValues: { trangThai: input.tu },
    newValues: {
      trangThai: "DA_XAC_NHAN",
      orderId,
      ...input.nhatKy,
      tienThaLamTron: input.tienTha,
      khoanDaXacNhan: kq.daXacNhan.map((x) => x.paymentId),
      khoanConCho: kq.conCho.map((x) => x.paymentId),
      coGuiEmail,
      emailNhan: emailHienTai,
    },
    orgUnitId: input.centerId,
  });
  return kq;
}

export async function chotHoaDon(input: {
  nguoiChot: AuditActor & { id: string };
  /**
   * Actor ĐÃ GIẢI của người bấm — phạm vi kế toán (`payments:confirm`) đo lại trên TỪNG khoản theo
   * `Payment.centerId`. BẮT BUỘC (luật 7): cổng action chỉ hỏi cơ sở của ĐƠN.
   */
  actor: ActionScopeActor;
  orderId: string;
  hoaDonId: string;
  now: Date;
  /**
   * GĐ 8 — phiên bản (`updatedAt`) của bản nháp mà người bấm ĐÃ THẤY. Ai sửa bản nháp sau lúc tải màn
   * ⇒ không khớp ⇒ DA_DOI, không ghi gì: chốt đúng tờ người ta đã soát, không phải tờ vừa bị đổi.
   */
  phienBan: Date;
  /**
   * GĐ 8 — email mà NHÃN NÚT đã hứa (email HIỆN TẠI của đơn lúc tải màn). Bước chốt đọc lại email của
   * đơn TRONG transaction; khác ⇒ EMAIL_DA_DOI (nút đã hứa sai địa chỉ). Không gửi (bỏ tick) ⇒ không so.
   */
  emailDuKien: string | null;
}): Promise<KetQuaChot> {
  const { nguoiChot, orderId, hoaDonId, now } = input;
  return db.$transaction(async (tx) => {
    // Cùng khoá với mọi đường ghi tiền của đơn (gắn / gỡ / tách / webhook) ⇒ không ai đổi tiền của
    // đơn này giữa lúc kiểm và lúc chốt.
    await khoaDonTrongTx(tx, orderId);

    const hd = await tx.hoaDonDienTu.findFirst({
      where: { id: hoaDonId, orderId, trangThai: "NHAP", updatedAt: input.phienBan },
      select: {
        updatedAt: true,
        khongTrungLyDo: true,
        xuatTheoSoDaThu: true,
        xuatTheoSoDaThuLyDo: true,
        centerId: true,
        tepPdfKey: true,
        kyHieu: true,
        soHoaDon: true,
        ngayPhatHanh: true,
        tongTien: true,
        emailNhan: true,
        guiEmailKhach: true,
        khoan: { where: { hieuLuc: true }, select: { paymentId: true, soTien: true } },
      },
    });
    if (!hd || hd.khoan.length === 0) throw new LoiChotHoaDon("DA_DOI");
    if (!hd.tepPdfKey || !hd.kyHieu || !hd.soHoaDon || !hd.ngayPhatHanh) throw new LoiChotHoaDon("THIEU_THONG_TIN");

    // Mọi cổng — DÙNG CHUNG với phát hành qua MISA (`kiemCongChotTrongTx`), đứng TRƯỚC phép ghi đầu tiên.
    const cong = await kiemCongChotTrongTx(tx, {
      actor: input.actor,
      orderId,
      centerId: hd.centerId,
      khoan: hd.khoan,
      khongTrungLyDo: hd.khongTrungLyDo,
      xuatTheoSoDaThu: hd.xuatTheoSoDaThu,
      xuatTheoSoDaThuLyDo: hd.xuatTheoSoDaThuLyDo,
    });

    // GĐ 8 — email CHỤP LẠI lúc chốt từ đơn: khác địa chỉ nhãn nút đã hứa ⇒ dừng.
    if (hd.guiEmailKhach && chuanEmail(nguoiMuaChoDon(cong.don).email) !== chuanEmail(input.emailDuKien)) {
      throw new LoiChotHoaDon("EMAIL_DA_DOI");
    }

    return hoanTatChotTrongTx(tx, {
      nguoiChot,
      orderId,
      hoaDonId,
      tu: "NHAP",
      updatedAt: hd.updatedAt,
      now,
      don: cong.don,
      theoIdDong: cong.theoIdDong,
      rong: cong.rong,
      paymentIds: hd.khoan.map((k) => k.paymentId),
      guiEmailKhach: hd.guiEmailKhach,
      tienTha: cong.lanThu.tienTha,
      centerId: hd.centerId,
      nhatKy: {
        kyHieu: hd.kyHieu,
        soHoaDon: hd.soHoaDon,
        tongTien: hd.tongTien,
        khongTrung: hd.khongTrungLyDo != null,
        xuatTheoSoDaThu: hd.xuatTheoSoDaThu,
      },
    });
  });
}
