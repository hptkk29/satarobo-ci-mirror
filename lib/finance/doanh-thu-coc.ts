// lib/finance/doanh-thu-coc.ts — TIỀN CỌC KHÔNG PHẢI DOANH THU cho tới khi khách trả ĐỦ (07/11/2026).
//
// ── QUYẾT ĐỊNH [chủ dự án, 07/11/2026, trong chat; khớp ghi chú BGĐ 01–02/11 "cọc không phải doanh thu, ghi vào ngày trả đủ"] ──────────
// Đơn có cọc (nút «Thu trước (cọc)» trên trang đơn, `lib/orders/thu-truoc.ts`): cọc LOẠI khỏi doanh thu; tới khi khách thanh toán đủ thì gom cọc +
// phần đóng sau lại và cho ra thành doanh thu.
//
// ── CÁCH ĐỌC ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   · CỜ CỌC: đơn có nhật ký `THU_TRUOC_TAO` (`thuTruocChoDon` ghi SAU `recordInstallmentPlan`, ngoài transaction của nó) VÀ còn phiếu đợt 1 chưa
//     huỷ (`installmentNo = 1`, status ≠ VOID) có `amountDue` ĐÚNG BẰNG `soTien` trong nhật ký. Nhật ký mà không còn phiếu khớp (kế hoạch bị
//     từ chối / huỷ phiếu / sửa số) thì KHÔNG phải cọc — hai nguồn lệch nhau thì tin nguồn nói «không», để tiền không bị giữ oan.
//     Đơn theo kế hoạch ĐỢT CŨ (hai phiếu trở lên, không có nhật ký) KHÔNG phải cọc: vẫn là doanh thu theo từng khoản (BGĐ 02/11).
//   · TRẢ ĐỦ: `Order.paidAt` có giá trị và đơn ở CONFIRMED / COMPLETED — đúng mốc `recomputeRequestStatuses` (`lib/payments/payment-request.ts`) đặt khi MỌI
//     phiếu đã thu đủ, và `confirmSettledOrder`. Không tự dựng một phép «đủ tiền» thứ hai: báo cáo và trạng thái đơn không bao giờ được nói khác nhau.
//   · NGÀY DOANH THU của đơn cọc đã trả đủ = `Order.paidAt` (ngày trả đủ), KHÔNG phải ngày thu từng khoản.
//
// ── PHẠM VI GIỮ TIỀN: CẢ ĐƠN ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Đơn cọc chưa trả đủ: MỌI khoản của đơn đều chưa vào doanh thu (không chỉ khoản cọc). Lý do: không có khoá ngoại từ `Payment` tới phiếu đợt
// (nối qua marker trong ghi chú), nên «khoản nào là cọc» chỉ suy được bằng cách đoán; giữ cả đơn là quy tắc giải thích được trong một câu và chỉ
// ĐẾM THIẾU. Hệ quả cần biết: phần «còn lại» nếu khách đóng làm nhiều lần thì các lần chưa đủ cũng chờ tới lúc đủ.
//
// ── ĐỌC KHÔNG QUA SCOPE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `docDonCoc` nhận client TRẦN, không `scopedDb`: đây là điều kiện để LOẠI tiền. Nhật ký cọc không mang `orgUnitId`; đọc qua scope thì người cấp
// cơ sở không thấy nhật ký, đếm cọc là doanh thu, còn HO thì không ⇒ hai người xem hai số (cùng bài học `lib/payments/method-lookup.ts`).
import type { Prisma, PrismaClient } from "@prisma/client";
import { WHERE_DOANH_THU } from "./thuc-thu";

export const HANH_DONG_THU_TRUOC_TAO = "THU_TRUOC_TAO";
const TRANG_THAI_DON_DA_CHOT = ["CONFIRMED", "COMPLETED"] as const;

export type NhatKyCoc = { orderId: string; soTien: number | null; createdAt: Date };
export type PhieuDot = { orderId: string; installmentNo: number; amountDue: number; status: string };
export type DonVaoCoc = { id: string; status: string; paidAt: Date | null; deletedAt: Date | null };

export type DonCoc = {
  orderId: string;
  daTraDu: boolean;
  /** `Order.paidAt` khi đã trả đủ; `null` khi chưa. */
  ngayTraDu: Date | null;
};

/** THUẦN — đơn nào là đơn CỌC và đã trả đủ chưa. Đơn không phải cọc KHÔNG có mặt trong kết quả. */
export function phanLoaiDonCoc(i: {
  nhatKy: readonly NhatKyCoc[];
  phieu: readonly PhieuDot[];
  don: readonly DonVaoCoc[];
}): Map<string, DonCoc> {
  // Lần bấm MỚI NHẤT của mỗi đơn (huỷ kế hoạch rồi thu trước lại thì số cọc cũ không còn nghĩa).
  const moiNhat = new Map<string, NhatKyCoc>();
  for (const n of i.nhatKy) {
    const cu = moiNhat.get(n.orderId);
    if (!cu || n.createdAt.getTime() >= cu.createdAt.getTime()) moiNhat.set(n.orderId, n);
  }
  const donTheoId = new Map(i.don.map((d) => [d.id, d]));
  const ket = new Map<string, DonCoc>();
  for (const [orderId, nk] of moiNhat) {
    const don = donTheoId.get(orderId);
    if (!don || don.deletedAt !== null) continue; // đơn đã xoá: không còn khoản nào để xét
    if (nk.soTien === null || !Number.isInteger(nk.soTien) || nk.soTien <= 0) continue; // nhật ký hỏng ⇒ không phải cọc
    const coPhieuKhop = i.phieu.some((p) => p.orderId === orderId && p.installmentNo === 1 && p.status !== "VOID" && p.amountDue === nk.soTien);
    if (!coPhieuKhop) continue;
    const daTraDu = don.paidAt !== null && (TRANG_THAI_DON_DA_CHOT as readonly string[]).includes(don.status);
    ket.set(orderId, { orderId, daTraDu, ngayTraDu: daTraDu ? don.paidAt : null });
  }
  return ket;
}

type Khach = PrismaClient | Prisma.TransactionClient;

/**
 * ĐỌC các đơn cọc (khối «ĐỌC KHÔNG QUA SCOPE» ở đầu file). Ba câu cố định, không theo số đơn.
 * `client` PHẢI là client trần — không truyền `scopedDb(actor)`.
 */
export async function docDonCoc(client: Khach): Promise<Map<string, DonCoc>> {
  const nhatKyTho = await client.auditLog.findMany({
    where: { entityType: "Order", action: HANH_DONG_THU_TRUOC_TAO },
    select: { entityId: true, newValues: true, createdAt: true },
  });
  if (nhatKyTho.length === 0) return new Map();
  const nhatKy: NhatKyCoc[] = nhatKyTho.map((n) => {
    const v = (n.newValues ?? null) as { soTien?: unknown } | null;
    return { orderId: n.entityId, soTien: typeof v?.soTien === "number" ? v.soTien : null, createdAt: n.createdAt };
  });
  const ids = [...new Set(nhatKy.map((n) => n.orderId))];
  const [phieu, don] = await Promise.all([
    client.paymentRequest.findMany({ where: { orderId: { in: ids }, installmentNo: 1 }, select: { orderId: true, installmentNo: true, amountDue: true, status: true } }),
    client.order.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, paidAt: true, deletedAt: true } }),
  ]);
  return phanLoaiDonCoc({ nhatKy, phieu: phieu.map((p) => ({ ...p, status: p.status as string })), don: don.map((d) => ({ ...d, status: d.status as string })) });
}

/**
 * Điều kiện `where` của MỘT truy vấn DOANH THU có tính cọc (thay cho `WHERE_DOANH_THU` trần).
 *   · `khoang` = có khoảng ngày: tiền thường lọc theo `paidDate` trong khoảng, LOẠI MỌI đơn cọc; đơn cọc ĐÃ trả đủ có `paidAt` trong khoảng thì
 *     vào bằng nhánh riêng theo `orderId` (KHÔNG lọc ngày thu — cọc đóng tháng 10, đơn trả đủ tháng 11 chỉ hiện ở tháng 11, đủ số tiền).
 *   · `khoang = null` (không cửa sổ ngày — ROAS): chỉ loại đơn cọc CHƯA trả đủ.
 * `ngayTraDuTheoDon`: ngày để GOM tiền của đơn cọc vào (báo cáo theo ngày phải dùng thay cho `paidDate` của từng khoản).
 */
export function dieuKienDoanhThu(
  coc: ReadonlyMap<string, DonCoc>,
  khoang: { tu: Date; den: Date } | null,
): { where: Prisma.PaymentWhereInput; ngayTraDuTheoDon: ReadonlyMap<string, Date> } {
  const tatCa = [...coc.keys()];
  const ngayTraDuTheoDon = new Map<string, Date>();
  for (const d of coc.values()) if (d.daTraDu && d.ngayTraDu) ngayTraDuTheoDon.set(d.orderId, d.ngayTraDu);

  if (khoang === null) {
    const dangGiu = [...coc.values()].filter((d) => !d.daTraDu).map((d) => d.orderId);
    return { where: { AND: [WHERE_DOANH_THU, { orderId: { notIn: dangGiu } }] }, ngayTraDuTheoDon };
  }
  const traDuTrongKhoang = [...ngayTraDuTheoDon].filter(([, ngay]) => ngay.getTime() >= khoang.tu.getTime() && ngay.getTime() <= khoang.den.getTime()).map(([id]) => id);
  return {
    where: {
      AND: [
        WHERE_DOANH_THU,
        {
          OR: [
            { paidDate: { gte: khoang.tu, lte: khoang.den }, orderId: { notIn: tatCa } },
            { orderId: { in: traDuTrongKhoang } },
          ],
        },
      ],
    },
    ngayTraDuTheoDon,
  };
}
