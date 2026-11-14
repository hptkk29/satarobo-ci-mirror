import "server-only";
// lib/payments/pos/the-dang-mo.ts — "THẺ ĐANG MỞ" của một phiếu gộp: phần ĐỌC DB (hai nút QR / Thẻ POS, 09/10/2026).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §1.6. Luật là hàm thuần `kieuTheDangMo` (`phieu-pos-luat.ts`); tệp này
// chỉ nạp hàng thô rồi hỏi nó — để cổng máy chủ của "Huỷ phiếu" và sự thật `PhieuGopView.theDangMo` mà trang đơn
// tính đọc CÙNG một chỗ. Hai nơi tự đọc là hai nơi có ngày cãi nhau (UI vẽ nút mà cổng từ chối).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO `maCoGiaoDichChoTay` / `mocChoTay` NẰM Ở ĐÂY (TỰ QUYẾT V14)
//
// Chúng từng ở `phieu-pos.ts`. Cổng huỷ phiếu nằm trong `lib/finance/phieu-gop.ts`, mà `phieu-pos.ts` đã import
// `phieu-gop.ts` — để cổng gọi được chúng thì phải dời xuống một tệp lá không import ngược. Dời NGUYÊN VĂN,
// không đổi hành vi; `phieu-pos.ts` import lại từ đây.
//
// ⚠️ Người xem KHÔNG cần quyền `payments:pos-check` để hàm này chạy (khác `docPhieuPosTho`): người chỉ có
// `payments:record` vẫn thấy nút QR và nút Huỷ, nên sự thật "có thẻ đang mở" phải tới được họ.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { kieuTheDangMo, type TheDangMo } from "./phieu-pos-luat";
import { tachMaPos } from "./tach-ma-pos";
import { CUA_SO_LUI_MS } from "./provider/doc-du-lieu";

type Tx = Prisma.TransactionClient;

/**
 * T21 THEO MÃ (rà đối kháng 06/10/2026) — mã nào trong `phieu` còn giao dịch thẻ nằm HÀNG CHỜ TAY:
 * dòng POS mang mã (token đứng riêng, qua checksum — `tachMaPos`, D2) có giao dịch UNMATCHED, quẹt
 * từ `tu` trở đi. Gồm cả giao dịch phiếu POS KHÔNG nhận (ghi chú 2 mã; quẹt dưới phiếu cũ đã bị thay
 * trước khi file về). Cổng máy chủ (`taoPhieuPosTrongKhoa`), cổng huỷ phiếu và màn đơn (`choKeToan`) gọi CÙNG hàm.
 *
 * KHÔNG scope (câu tra để CHẶN — CLAUDE.md "PaymentMethod"): quẹt ở máy cơ sở khác vẫn là tiền đã
 * trừ thẻ khách. `tu` = mốc phiếu gộp phát mã (hoặc phiếu POS đầu tiên, lấy cái sớm hơn) − 5 phút —
 * mã có thể được cấp lại cho phiếu gộp sau, giao dịch cũ hơn mốc không phải của phiếu này.
 */
export async function maCoGiaoDichChoTay(
  client: Pick<Tx, "posCardTransaction">,
  phieu: readonly { code5: string; tu: Date }[],
): Promise<Set<string>> {
  if (phieu.length === 0) return new Set();
  const rows = await client.posCardTransaction.findMany({
    where: {
      bankTransaction: { status: "UNMATCHED" },
      OR: phieu.map((x) => ({
        dienGiai: { contains: x.code5, mode: "insensitive" as const },
        thoiGianGiaoDich: { gte: x.tu },
      })),
    },
    select: { dienGiai: true, thoiGianGiaoDich: true },
    take: 200,
  });
  const co = new Set<string>();
  for (const x of phieu) {
    if (rows.some((r) => r.thoiGianGiaoDich.getTime() >= x.tu.getTime() && tachMaPos(r.dienGiai).includes(x.code5))) {
      co.add(x.code5);
    }
  }
  return co;
}

/** Mốc tìm giao dịch chờ tay của MỘT phiếu gộp: sớm hơn của (lúc phát mã, phiếu POS đầu) − 5 phút. */
export function mocChoTay(billTao: Date, phieuPosTao: readonly Date[]): Date {
  const som = Math.min(billTao.getTime(), ...phieuPosTao.map((d) => d.getTime()));
  return new Date(som - CUA_SO_LUI_MS);
}

/**
 * Gom phiếu thẻ theo PHIẾU GỘP rồi tính mốc `tu` của từng mã (`mocChoTay` trên MỌI phiếu thẻ của phiếu gộp) — đầu vào CHUNG của hai câu hỏi phía màn:
 * `maCoGiaoDichChoTay` (`coGiaoDichChoTay`) và `maCoDongTheChuaKetLuan` (`coDongTheChuaKetLuan`). Hai cờ phải đo CÙNG cửa sổ; vòng gom từng được chép ở hai nơi
 * (`phieu-pos.ts` · `dong-the-chua-ket-luan-gan.ts`) — sửa mốc ở một nơi mà quên nơi kia là hai cờ lệch cửa sổ, đúng lớp lỗi `[HN4-W6]` canh ở phía máy chủ.
 * (Rà đối kháng bản ghép 10/10/2026.)
 */
export function cuaSoTheoPhieuGop<T extends { code5: string; createdAt: Date; paymentBillId: string; paymentBill: { createdAt: Date } }>(
  ds: readonly T[],
): { code5: string; tu: Date }[] {
  const theoBill = new Map<string, { code5: string; billTao: Date; tao: Date[] }>();
  for (const p of ds) {
    const g = theoBill.get(p.paymentBillId) ?? { code5: p.code5, billTao: p.paymentBill.createdAt, tao: [] };
    g.tao.push(p.createdAt);
    theoBill.set(p.paymentBillId, g);
  }
  return [...theoBill.values()].map((g) => ({ code5: g.code5, tu: mocChoTay(g.billTao, g.tao) }));
}

/**
 * Phiếu gộp ĐANG MỞ của đơn có thẻ đang mở không (`null` = không).
 *
 * Gọi từ HAI nơi, cố ý cùng một hàm:
 *   · cổng `huyPhieuGop` — truyền `tx` DƯỚI KHOÁ ĐƠN (khoá tạo phiếu thẻ cũng lấy ⇒ không có phiếu thẻ nào chen vào
 *     giữa lúc hỏi và lúc huỷ);
 *   · trang đơn — qua `docTheDangMoCuaDon` bên dưới.
 *
 * Phiếu gộp KHÔNG có phiếu thẻ nào ⇒ `null`, không tra hàng chờ: "thẻ đang mở" là nói về MỘT PHIẾU THẺ. (Giao dịch
 * thẻ mang mã mà chưa từng có phiếu thẻ là chuyện của hàng chờ kế toán; `taoPhieuPosTrongKhoa` vẫn chặn mở phiếu
 * thẻ đầu tiên khi có giao dịch như vậy.) Đọc hết phiếu thẻ của phiếu gộp — mỗi phiếu gộp chỉ có vài phiếu (mỗi
 * lần quá hạn mới đẻ một phiếu), và `mocChoTay` cần phiếu SỚM nhất.
 */
export async function docTheDangMoCuaPhieuGop(
  client: Pick<Tx, "paymentBill" | "posCardTransaction">,
  /**
   * `billId` (tuỳ chọn): chỉ hỏi về ĐÚNG phiếu này. Cổng huỷ truyền nó — người bấm có thể cầm một phiếu cũ đã đóng
   * trong khi đơn đã có phiếu mới đang có thẻ chờ; không thu hẹp thì họ nhận câu "đang chờ quẹt" cho một phiếu
   * mà việc huỷ vốn đã bị từ chối vì lý do khác. Bỏ trống = phiếu ĐANG MỞ của đơn (trang đơn).
   */
  input: { orderId: string; billId?: string; now: Date },
): Promise<TheDangMo | null> {
  const phieu = await client.paymentBill.findFirst({
    where: { orderId: input.orderId, status: "OPEN", ...(input.billId !== undefined ? { id: input.billId } : {}) },
    select: {
      matchKey: true,
      createdAt: true,
      posIntents: {
        select: {
          createdAt: true,
          expiresAt: true,
          status: true,
          // Quá hạn mà lượt kiểm gần nhất chưa kết luận ⇒ vẫn là "thẻ đang mở" (`kieuTheDangMo`, cùng tập với poller).
          lastResultKind: true,
          bankTransaction: { select: { status: true } },
        },
      },
    },
  });
  if (!phieu || phieu.posIntents.length === 0) return null;
  const ma = phieu.matchKey;
  const choTay = ma
    ? await maCoGiaoDichChoTay(client, [{ code5: ma, tu: mocChoTay(phieu.createdAt, phieu.posIntents.map((p) => p.createdAt)) }])
    : new Set<string>();
  return kieuTheDangMo({
    phieu: phieu.posIntents,
    coGiaoDichChoTay: ma !== null && choTay.has(ma),
    now: input.now,
  });
}

/**
 * Bản cho TRANG ĐƠN (`app/(admin)/**` không được import `@/lib/db` trần — cổng DB đã đóng). Đọc bằng `db` trần
 * như `docPhieuPosTho`: người xem đã qua cổng phạm vi của CHÍNH đơn này ở cửa trang.
 */
export function docTheDangMoCuaDon(orderId: string, now: Date): Promise<TheDangMo | null> {
  return docTheDangMoCuaPhieuGop(db, { orderId, now });
}
