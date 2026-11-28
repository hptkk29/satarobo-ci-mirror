import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import { collectMatchKeyCandidates } from "@/lib/payments/ung-vien-ma-khop";
import { TRANG_THAI_DON_KHONG_NHAN_TIEN } from "@/lib/payments/don-nhan-tien";

/**
 * TIỀN VỀ KHI ĐƠN ONLINE KHÔNG CÒN NHẬN TIỀN (vừa bị huỷ / đã huỷ / đã hoàn) — M8 P0 mục 3.
 *
 * Luật: giao dịch Ở NGUYÊN hàng chờ đối soát (`BankTransaction` `UNMATCHED`, tab «Cần xử lý» của `/admin/bien-dong-so-du`) kèm ghi chú nêu đơn. KHÔNG phân bổ, KHÔNG
 * tiền dư, KHÔNG `Payment` ⇒ không quyền học nào được cấp và không đồng nào tự đi ra: con người quyết. Đơn KHÔNG phải Online không đi qua tệp này.
 *
 * LIÊN KẾT TỚI ĐƠN không cần cột mới: `PaymentRequest.matchKey` (phiếu của đơn, bất biến) ↔ nội dung/tham chiếu GỐC của giao dịch, so bằng đúng phép tách của đường
 * tiền vào. Ghi chú chỉ để NGƯỜI đọc — máy không đọc ngược ghi chú (ai đó sửa ghi chú thì dấu nối vẫn còn).
 *
 * Ba thời điểm, cùng một kết cục:
 *   · huỷ đã commit rồi tiền mới về ⇒ tra đích trượt ⇒ `resolvePaymentTargetDetailed` hỏi tệp này TRƯỚC khi đoán theo SĐT (nội dung đã nói đích là đơn nào, đoán sang đơn khác là sai);
 *   · ĐUA (tra đích xong lúc đơn còn sống, rót sau khi huỷ commit) ⇒ `allocateToOrder` đọc lại đơn DƯỚI KHOÁ và dừng trước phép ghi đầu tiên;
 *   · tiền về trước khi huỷ ⇒ ghi vào đơn như thường, lượt huỷ thấy tiền và từ chối (`DA_CO_TIEN`) — không đi qua đây.
 */

/**
 * Mảnh có mặt trong MỌI `matchKey` của đơn Online (mã đơn `INV-ONL-…` bỏ gạch). Chỉ để lọc thô trước khi hỏi DB: nội dung không chứa mảnh này thì không thể mang khoá của
 * đơn Online ⇒ đường offline không tốn thêm câu tra nào. Lưới `[TVD-01]` giữ nó khớp với `MA_CO_SO_DON_ONLINE`.
 */
export const MANH_MA_DON_ONLINE = "INVONL";

export type DonOnlineHetNhanTien = { orderId: string; maDon: string; trangThai: OrderStatus };

type Cli = PrismaClient | Prisma.TransactionClient;

/** Câu ghi chú của giao dịch bị giữ. MỘT hàm cho mọi đường ⇒ cổng gửi lại không đổi câu chữ. */
export function ghiChuTienVeDonOnlineHetNhanTien(don: { maDon: string; trangThai: OrderStatus }): string {
  const tinhTrang = don.trangThai === "CANCELLED" ? "đã huỷ" : don.trangThai === "REFUNDED" ? "đã hoàn tiền" : "không còn nhận tiền";
  return `Đơn Online ${don.maDon} ${tinhTrang} — tiền về KHÔNG tự rót vào đơn, không cấp quyền học, không tự hoàn. Cần kế toán đối soát.`;
}

/** Nội dung có mang khoá của một đơn Online đã huỷ/hoàn không. Trả `null` ⇒ để đường tra đích đi tiếp như cũ. */
export async function timDonOnlineHetNhanTienTheoMa(cli: Cli, ungVien: readonly string[]): Promise<DonOnlineHetNhanTien | null> {
  const loc = ungVien.filter((u) => u.includes(MANH_MA_DON_ONLINE));
  if (loc.length === 0) return null;
  const phieu = await cli.paymentRequest.findFirst({
    where: { matchKey: { in: loc }, order: { type: "ONLINE", status: { in: [...TRANG_THAI_DON_KHONG_NHAN_TIEN] } } },
    select: { orderId: true, order: { select: { code: true, status: true } } },
  });
  return phieu ? { orderId: phieu.orderId, maDon: phieu.order.code, trangThai: phieu.order.status } : null;
}

/**
 * Số tiền CÒN CHỜ đối soát của từng đơn Online ĐÃ HUỶ: giao dịch còn `UNMATCHED` mang khoá của đơn. FIN-11: `UNMATCHED` có thể đã gắn một phần ⇒ lấy `amount − Σ phân bổ`.
 * `gioiHan` = số giao dịch chờ (mang mảnh mã đơn Online) mới nhất được xét. Giao dịch kế toán đã xử lý (gắn / bỏ qua) rời `UNMATCHED` nên tự rời số này.
 */
export async function docTienChoDoiSoatCuaDonOnlineDaHuy(cli: Cli, opts: { gioiHan: number }): Promise<Map<string, number>> {
  const cho = await cli.bankTransaction.findMany({
    where: { status: "UNMATCHED", content: { contains: MANH_MA_DON_ONLINE } },
    orderBy: { createdAt: "desc" },
    take: opts.gioiHan,
    select: { amount: true, content: true, referenceCode: true, allocations: { select: { amount: true } } },
  });
  const kq = new Map<string, number>();
  if (cho.length === 0) return kq;
  const dong = cho.map((g) => ({
    conCho: g.amount - g.allocations.reduce((s, a) => s + a.amount, 0),
    ungVien: collectMatchKeyCandidates({ reference: g.referenceCode ?? undefined, description: g.content ?? undefined }),
  }));
  const phieu = await cli.paymentRequest.findMany({
    where: { matchKey: { in: [...new Set(dong.flatMap((d) => d.ungVien))] }, order: { type: "ONLINE", status: "CANCELLED" } },
    select: { orderId: true, matchKey: true },
  });
  const donTheoKhoa = new Map(phieu.map((p) => [p.matchKey!, p.orderId]));
  for (const d of dong) {
    const khoa = d.ungVien.find((u) => donTheoKhoa.has(u));
    if (!khoa || d.conCho <= 0) continue;
    const orderId = donTheoKhoa.get(khoa)!;
    kq.set(orderId, (kq.get(orderId) ?? 0) + d.conCho);
  }
  return kq;
}
