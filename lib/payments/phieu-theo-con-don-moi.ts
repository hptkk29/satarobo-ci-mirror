// lib/payments/phieu-theo-con-don-moi.ts — ĐƠN PHẠM VI MỚI: MỖI CON MỘT KHOẢN PHẢI THU ngay lúc tạo đơn [chủ dự án chốt 20–21/10/2026].
//
// Trước đây mọi đơn mới có đúng MỘT phiếu "thu toàn đơn" (`installmentNo = 0`, `orderItemId = NULL`). Tiền về qua đó không biết của bé nào, nên đơn hai con luôn
// rơi vào "chưa gắn con" và quyền học của từng bé phải chờ người gắn tay. Đơn phạm vi từ 2 dòng trở lên nay dựng MỖI DÒNG một phiếu (`orderItemId` = dòng,
// `installmentNo = 1`, `amountDue` = thành tiền thực của dòng sau giảm, `sortOrder = thuTuRot`), KHÔNG có phiếu `installmentNo = 0`. Mỗi lần đóng vẫn là một
// lần thanh toán độc lập; phiếu này chỉ là "bé nào phải đóng bao nhiêu".
//
// ── CHỈ KHI ĐỦ BỐN ĐIỀU KIỆN (`nenTachPhieuTheoCon`) ─────────────────────────────────────────────────────────────────
//  1. đơn là SCOPE — đơn thường giữ phiếu toàn đơn NGUYÊN VĂN (cờ phạm vi TẮT là trạng thái duy nhất đang chạy trên prod);
//  2. thu linh hoạt (`billing.flexV1Enabled`) BẬT cho cơ sở của đơn — phiếu gộp một QR và màn công nợ theo con đều đứng sau cờ này; cờ tắt thì phiếu theo con
//     không có đường thu nào ngoài waterfall;
//  3. từ HAI dòng trở lên — đơn một con giữ phiếu toàn đơn vì nó mang `matchKey` (khoá nội dung CK) còn phiếu theo con thì không: tách ra là QR tĩnh mất khoá
//     mà không được gì (đơn một con không có gì để chia);
//  4. phí vận chuyển = 0 — `Order.totalAmount = Σ thành tiền + shippingFee`; Σ phiếu theo con sẽ hụt đúng phí ship và `isOrderSettled` báo "đủ" khi còn thiếu ship.
//
// ⚠️ Phiếu theo con KHÔNG sinh `matchKey` (xem `ke-hoach-theo-con.ts`): ngân sách nội dung CK 17 ký tự cho khoá, thêm chiều dòng là tràn. Khoá đối khớp nằm trên
// PHIẾU GỘP (`PaymentBill`); tiền đi đường khác (QR tĩnh, chuyển khoản chỉ có số điện thoại) rót theo `sortOrder` và `allocateToOrder` ghi `Payment` THEO CON.
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
import { thuTuRot } from "@/lib/payments/thu-tu-rot";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type DongPhieuTheoCon = { orderItemId: string; thanhTien: number };

export type PhieuTheoConMoi = { orderItemId: string; installmentNo: 1; amountDue: number; sortOrder: number };

/** Có nên dựng phiếu theo con thay cho phiếu toàn đơn không — THUẦN (cờ cơ sở do người gọi đọc). */
export function nenTachPhieuTheoCon(p: { kieu: "SCOPE" | "LEGACY"; soDong: number; phiShip: number; flexBat: boolean }): boolean {
  return p.kieu === "SCOPE" && p.flexBat && p.soDong >= 2 && p.phiShip === 0;
}

/**
 * Phiếu theo con từ các dòng đơn, THUẦN. Dòng 0đ không có gì để thu ⇒ không phiếu. `thuTuDong` là vị trí dòng TRONG ĐƠN (kể cả dòng 0đ) để thứ tự rót ổn định.
 * Ném khi Σ phiếu ≠ `tongDon` — cổng tiền: sai ở đây là phụ huynh bị đòi nhầm số.
 */
export function phieuMotLanTheoCon(dong: readonly DongPhieuTheoCon[], tongDon: number): PhieuTheoConMoi[] {
  const ra: PhieuTheoConMoi[] = [];
  for (const [i, d] of dong.entries()) {
    const tien = Math.round(d.thanhTien);
    if (!Number.isFinite(tien) || tien < 0) throw new Error("Thành tiền dòng hàng không hợp lệ");
    if (tien === 0) continue;
    ra.push({ orderItemId: d.orderItemId, installmentNo: 1, amountDue: tien, sortOrder: thuTuRot({ thuTuDong: i, installmentNo: 1 }) });
  }
  const tong = ra.reduce((s, p) => s + p.amountDue, 0);
  if (tong !== Math.round(tongDon)) {
    throw new Error(`Tổng khoản phải thu theo con (${tong}) không khớp tổng đơn (${Math.round(tongDon)})`);
  }
  return ra;
}

/** Đọc cờ thu linh hoạt rồi quyết định — gọi NGOÀI transaction tạo đơn (một lần hỏi cờ). */
export async function coNenTachPhieuTheoCon(p: { kieu: "SCOPE" | "LEGACY"; soDong: number; phiShip: number; orgUnitId: string | null }): Promise<boolean> {
  // Chưa đủ ba điều kiện còn lại thì không cần hỏi cờ (cờ là truy vấn).
  if (p.kieu !== "SCOPE" || p.soDong < 2 || p.phiShip !== 0) return false;
  // `=== true`: cờ là boolean; một giá trị truthy lạ không được biến thành "bật" (cùng lối `order-create-audit.test.ts`).
  const flexBat = (await laThuTienLinhHoatBat(p.orgUnitId)) === true;
  return nenTachPhieuTheoCon({ ...p, flexBat });
}

/** Ghi phiếu theo con cho đơn vừa tạo, TRONG transaction tạo đơn (có đơn là có phiếu, không nửa vời). */
export async function taoPhieuTheoConChoDonMoi(
  tx: Tx,
  p: { orderId: string; centerId: string | null; tongDon: number; dong: readonly DongPhieuTheoCon[] },
): Promise<number> {
  const phieu = phieuMotLanTheoCon(p.dong, p.tongDon);
  for (const f of phieu) {
    await tx.paymentRequest.create({
      data: {
        orderId: p.orderId,
        orderItemId: f.orderItemId,
        centerId: p.centerId,
        installmentNo: f.installmentNo,
        amountDue: f.amountDue,
        sortOrder: f.sortOrder,
        status: "PENDING",
      },
    });
  }
  return phieu.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIỀN VỀ KHÔNG QUA MÃ PHIẾU GỘP ⇒ `Payment` GHI THEO CON  [chủ dự án chốt 21/10/2026, phương án "chia Payment theo con"]
// ─────────────────────────────────────────────────────────────────────────────
//
// Ví dụ chốt: con A 6.000.000đ, con B 4.000.000đ, mỗi con một phiếu; phụ huynh chuyển 6.000.000đ chỉ ghi số điện thoại. `allocateToOrder` rót theo `sortOrder`
// ⇒ phiếu A đủ. BẤT BIẾN: sổ phân bổ (`PaymentAllocation`) và sổ `Payment` phải nói CÙNG một điều. Bản cũ ghi MỘT `Payment` với `orderItemId = NULL` cho đơn ≥ 2 dòng ⇒
// phiếu nói A đủ trong khi sổ nói "chưa gắn con" ⇒ quyền học của A không cấp được (`chuaXacDinhDuocDong`). Nay: khi MỌI dòng phân bổ rơi vào phiếu có `orderItemId`,
// gộp theo con và ghi MỘT `Payment` mỗi con (cùng lối `thuTheoPhieuGop`). Lẫn một phiếu không `orderItemId` (đơn kiểu cũ) ⇒ `null`, người gọi giữ đường cũ.

/** Gộp các dòng phân bổ theo CON. `null` nếu không có dòng nào, hoặc có dòng rơi vào phiếu không thuộc con nào. */
export function gomTienTheoCon(
  lines: readonly { paymentRequestId: string; amount: number }[],
  conCuaPhieu: ReadonlyMap<string, string | null>,
): Map<string, number> | null {
  if (lines.length === 0) return null;
  const ra = new Map<string, number>();
  for (const l of lines) {
    const con = conCuaPhieu.get(l.paymentRequestId) ?? null;
    if (!con) return null;
    ra.set(con, (ra.get(con) ?? 0) + l.amount);
  }
  return ra;
}

/** Ghi `Payment` mỗi con một dòng. Chỉ gọi khi `gomTienTheoCon` trả bản đồ. Ghi danh suy từ DÒNG HÀNG — điều kiện `confirmPayment` đòi để phát phiếu thu. */
export async function ghiPaymentTheoCon(
  tx: Tx,
  p: {
    orderId: string;
    centerId: string | null;
    congTheoCon: ReadonlyMap<string, number>;
    method: string;
    /** Ngày thu — người gọi quyết (webhook = lúc nhận, thẻ POS = giờ quẹt). Cố ý KHÔNG đặt tên `paidDate` ở chỗ gọi: lưới `[POS-NT-01d]` đếm đúng một `paidDate:` trong `allocateToOrder`. */
    ngayThu: Date;
    note: string;
  },
): Promise<void> {
  const dong = await tx.orderItem.findMany({
    where: { id: { in: [...p.congTheoCon.keys()] } },
    select: { id: true, enrollmentId: true },
  });
  const ghiDanhTheoDong = new Map(dong.map((d) => [d.id, d.enrollmentId]));
  for (const [orderItemId, soTien] of p.congTheoCon) {
    await tx.payment.create({
      data: {
        orderId: p.orderId,
        orderItemId,
        enrollmentId: ghiDanhTheoDong.get(orderItemId) ?? null,
        amount: soTien,
        method: p.method,
        paidDate: p.ngayThu,
        note: p.note,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        recordedById: null,
        centerId: p.centerId,
      },
    });
  }
}
