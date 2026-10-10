// lib/finance/backfill-orderitem.ts — GẮN `Payment.orderItemId` cho khoản cũ của đơn MỘT CON.
//
// ─────────────────────────────────────────────────────────────────────────────
// VIỆC NÀY LÀ GÌ, VÀ VÌ SAO NÓ AN TOÀN
//
// Cột `Payment.orderItemId` ra đời 16/09/2026 (migration `20260916180000_payment_order_item`),
// nên **mọi khoản cũ hơn nó đều NULL theo định nghĩa** — đo prod 17/09: 150 khoản / 120 đơn /
// 892.149.000đ. Trong đó 146 khoản thuộc đơn có ĐÚNG MỘT dòng hàng, tức chỉ có duy nhất một
// chỗ để gắn: không có lựa chọn nào phải đoán.
//
// 4 khoản còn lại thuộc đơn ≥2 con — **KHÔNG backfill**, sale phải tự chia (đó chính là việc
// mà công tắc `billing.flexV1Enabled` sinh ra để làm).
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐIỀU KIỆN CỨNG (chủ dự án chốt 17/09/2026) — không nới thêm một điều kiện nào
//
//   · đơn có ĐÚNG 1 `OrderItem`        → không có gì phải đoán
//   · `Payment.orderItemId IS NULL`    → chỉ điền chỗ trống
//   · đơn KHÔNG xoá mềm
//   · **CHỈ** cập nhật cột `orderItemId`. Không đụng `amount`, `accountantStatus`,
//     `saleStatus`, `enrollmentId`, `paidDate`, `deletedAt`.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỘ LỌC PHẢI GIỐNG HỆT BÁO CÁO — và một cái bẫy tôi đã bước vào
//
// Số 146 mà chủ dự án duyệt đến từ `scripts/bao-cao-doi-soat-tien.ts`, phần B, với đúng bốn
// điều kiện: `orderItemId: null` · `deletedAt: null` · `paymentType: "PAYMENT"` ·
// `order: locDonNhanTien()`. Lệnh backfill phải dùng **cùng** bộ lọc, kẻo hai con số không so
// được với nhau — và một lệnh ghi mà số liệu không đối chiếu được là một lệnh không ai kiểm.
//
// ⚠️ Bản đầu của tệp này lọc thêm `KHOAN_DA_XAC_NHAN` (trục A: `accountantStatus = CONFIRMED`).
// SAI, và sai theo một lối dễ lặp lại: đó là bộ lọc của câu *"đã thu bao nhiêu tiền"*, không
// phải câu *"khoản này của bé nào"*. `orderItemId` chỉ nói **bé nào**, hoàn toàn độc lập với
// việc kế toán đã xác nhận hay chưa; lọc trục A là để lại đúng những khoản đang chờ xác nhận
// ở trạng thái vô hình với công nợ từng con. Đúng luật đã ghi trong `docs/luat-doc-so-va-ket-luan.md`:
// *tập dựng cho mục đích A không dùng cho mục đích B khi chưa kiểm lại định nghĩa.*
//
// Hai điều kiện KHÔNG phải của chủ dự án mà đi theo báo cáo, nói ra để không ai tưởng là gốc:
//   · `paymentType: "PAYMENT"` — bỏ bút toán ĐIỀU CHỈNH/HOÀN. Chúng cũng có thể cần gắn con,
//     nhưng chúng KHÔNG nằm trong số 146 đã duyệt ⇒ để lượt sau, và hàm quét **đếm riêng**
//     chúng (`butToanKhac`) để không ai tưởng chúng không tồn tại.
//   · `Payment.deletedAt IS NULL` — gắn dòng hàng cho khoản đã xoá mềm không sửa được số nào
//     (mọi đường đọc đã lọc `deletedAt`), nên nó chỉ là một lượt ghi vô ích.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG `server-only`
//
// Nó phải import được từ `scripts/**` chạy bằng `tsx` ngoài Next. `lib/finance/ghi-tien-don.ts`
// có `import "server-only"` nên module này **không được** import nó — đã đo: script chết ngay
// với `Cannot find module 'server-only'`.
import type { Prisma, PrismaClient } from "@prisma/client";
// Một chỗ DUY NHẤT định nghĩa "đơn nào không nhận tiền" — đừng chép lại danh sách trạng thái.
import { TRANG_THAI_DON_KHONG_NHAN_TIEN } from "@/lib/payments/don-nhan-tien";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

type Doc = Pick<PrismaClient, "payment" | "order">;
type Tx = Prisma.TransactionClient;

/** Một khoản sẽ được gắn. Không mang dữ liệu cá nhân — cố ý, vì nó đi vào log workflow. */
export type KhoanCanGan = {
  paymentId: string;
  orderId: string;
  orderCode: string;
  /** Dòng hàng DUY NHẤT của đơn. */
  orderItemId: string;
  amount: number;
  centerId: string | null;
};

/** Một khoản bị loại, kèm đủ thứ để người đọc tự tra lại. */
export type KhoanBiLoai = {
  paymentId: string;
  orderCode: string;
  trangThaiDon: string;
  amount: number;
};

export type KetQuaQuet = {
  khoan: KhoanCanGan[];
  /** Σ `amount` của `khoan`. */
  tongTien: number;
  /** Số ĐƠN riêng biệt trong `khoan`. */
  soDon: number;

  // ───────────────────────────────────────────────────────────────────────────
  // BA NHÓM DƯỚI ĐÂY LÀ **TẬP ĐỐI CHIẾU** của chủ dự án (SQL 18/09/2026):
  //   đơn có ĐÚNG 1 `OrderItem` · `Payment.orderItemId IS NULL` · Payment chưa xoá mềm,
  //   **KHÔNG lọc trạng thái đơn, KHÔNG lọc đơn xoá mềm**.
  // Bởi vậy:  khoan + biLoaiTrangThai + biLoaiXoaMem  =  147 khoản / 896.289.000đ.
  // Ba nhóm còn lại (đơn ≥2 con · đơn 0 dòng · bút toán khác) nằm NGOÀI tập ấy.
  // ───────────────────────────────────────────────────────────────────────────
  /** Đơn 1 dòng hàng nhưng trạng thái DRAFT/CANCELLED/REFUNDED. */
  biLoaiTrangThai: { soKhoan: number; tongTien: number; danhSach: KhoanBiLoai[] };
  /** Đơn 1 dòng hàng nhưng đơn đã XOÁ MỀM. */
  biLoaiXoaMem: { soKhoan: number; tongTien: number; danhSach: KhoanBiLoai[] };

  /** Khoản NULL thuộc đơn ≥2 con — KHÔNG backfill, sale tự chia. */
  donNhieuCon: { soKhoan: number; tongTien: number; soDon: number };
  /** Khoản NULL thuộc đơn KHÔNG có dòng hàng nào — không có gì để gắn. */
  donKhongCoDong: { soKhoan: number; tongTien: number };
  /**
   * Bút toán ĐIỀU CHỈNH/HOÀN (`paymentType !== "PAYMENT"`).
   *
   * ⚠️ SQL đối chiếu của chủ dự án KHÔNG lọc `paymentType`. Nếu tổng ba nhóm trên lệch 147
   * đúng bằng con số này thì đây là lý do — không phải dữ liệu đổi.
   */
  butToanKhac: { soKhoan: number; tongTien: number };
};

/**
 * QUÉT — chỉ đọc. Không ghi một dòng nào.
 *
 * Trả về ĐẦY ĐỦ bốn nhóm, kể cả ba nhóm bị loại. "Không có cap im lặng": một bản kê chỉ in
 * nhóm sẽ-gắn đọc như thể phần còn lại không tồn tại.
 */
export async function quetKhoanCanGan(doc: Doc): Promise<KetQuaQuet> {
  // Một câu tra cho TOÀN BỘ khoản NULL, rồi phân nhóm trong bộ nhớ. Tra nhiều câu với điều
  // kiện khác nhau là mở đường cho hai nhóm lệch định nghĩa nhau — đúng lỗi mà `docSoTheoCon`
  // đã ghi chú và tránh bằng cùng cách này.
  const khoanNull = await doc.payment.findMany({
    where: { orderItemId: null, deletedAt: null },
    select: {
      id: true,
      orderId: true,
      amount: true,
      centerId: true,
      paymentType: true,
      order: {
        select: {
          code: true,
          status: true,
          deletedAt: true,
          items: { select: { id: true } },
        },
      },
    },
    orderBy: { paidDate: "asc" },
  });

  const cam = new Set<string>(TRANG_THAI_DON_KHONG_NHAN_TIEN);
  const khoan: KhoanCanGan[] = [];
  const nhieuCon = { soKhoan: 0, tongTien: 0, don: new Set<string>() };
  const khongDong = { soKhoan: 0, tongTien: 0 };
  const khac = { soKhoan: 0, tongTien: 0 };
  const loaiTrangThai: KhoanBiLoai[] = [];
  const loaiXoaMem: KhoanBiLoai[] = [];

  for (const k of khoanNull) {
    const d = k.order;
    if (k.paymentType !== "PAYMENT") {
      khac.soKhoan += 1;
      khac.tongTien += k.amount;
      continue;
    }
    // ⚠️ THỨ TỰ PHÂN NHÓM: số dòng hàng XÉT TRƯỚC trạng thái đơn.
    //
    // Tập đối chiếu của chủ dự án là "đơn có ĐÚNG 1 OrderItem", không lọc trạng thái. Nếu loại
    // theo trạng thái trước thì một đơn CANCELLED có 3 con sẽ rơi vào nhóm `biLoaiTrangThai`,
    // và phép cộng `khoan + biLoaiTrangThai + biLoaiXoaMem` không còn là tập ấy nữa — nó sẽ
    // lệch 147 mà không ai biết vì sao.
    if (d.items.length === 0) {
      khongDong.soKhoan += 1;
      khongDong.tongTien += k.amount;
      continue;
    }
    if (d.items.length > 1) {
      nhieuCon.soKhoan += 1;
      nhieuCon.tongTien += k.amount;
      nhieuCon.don.add(k.orderId);
      continue;
    }
    // Từ đây: đơn có ĐÚNG MỘT dòng hàng ⇒ nằm trong tập đối chiếu.
    const bl: KhoanBiLoai = {
      paymentId: k.id,
      orderCode: d.code,
      trangThaiDon: d.status,
      amount: k.amount,
    };
    if (d.deletedAt !== null) {
      loaiXoaMem.push(bl);
      continue;
    }
    if (cam.has(d.status)) {
      loaiTrangThai.push(bl);
      continue;
    }
    khoan.push({
      paymentId: k.id,
      orderId: k.orderId,
      orderCode: d.code,
      orderItemId: d.items[0]!.id,
      amount: k.amount,
      centerId: k.centerId,
    });
  }

  const gop = (ds: KhoanBiLoai[]) => ({
    soKhoan: ds.length,
    tongTien: ds.reduce((s, x) => s + x.amount, 0),
    danhSach: ds,
  });

  return {
    khoan,
    tongTien: khoan.reduce((s, x) => s + x.amount, 0),
    soDon: new Set(khoan.map((x) => x.orderId)).size,
    biLoaiTrangThai: gop(loaiTrangThai),
    biLoaiXoaMem: gop(loaiXoaMem),
    donNhieuCon: { soKhoan: nhieuCon.soKhoan, tongTien: nhieuCon.tongTien, soDon: nhieuCon.don.size },
    donKhongCoDong: khongDong,
    butToanKhac: khac,
  };
}

/**
 * GHI — MỘT câu `UPDATE` duy nhất cho toàn bộ lô, tự kiểm lại MỌI điều kiện TRONG CÙNG CÂU.
 *
 * Chủ dự án chốt 18/09/2026: *"Một câu UPDATE duy nhất, chỉ đổi cột orderItemId, WHERE kiểm
 * lại TRONG CÙNG CÂU (không tin danh sách từ bước xem trước)."*
 *
 * ⚠️ VÌ SAO KHÔNG TIN DANH SÁCH TỪ BƯỚC XEM TRƯỚC — đây là điểm khác quan trọng nhất so với
 * bản đầu (vòng lặp `updateMany` theo từng `paymentId` đã quét ở bước trước). Giữa lúc quét và
 * lúc ghi, đơn có thể bị huỷ, bị xoá mềm, hoặc được thêm dòng hàng thứ hai. Một danh sách id
 * đọc trước đó là một ẢNH CHỤP; ghi theo ảnh chụp là ghi theo một sự thật đã hết hạn. Câu
 * dưới đây không nhận id nào từ bên ngoài — nó tự tìm lại tập cần gắn ngay tại thời điểm ghi.
 *
 * Năm điều kiện, đúng những gì chủ dự án liệt kê:
 *   1. `Payment.orderItemId IS NULL`
 *   2. `Payment.deletedAt IS NULL`
 *   3. `Order.deletedAt IS NULL`
 *   4. `Order.status NOT IN ('DRAFT','CANCELLED','REFUNDED')`
 *   5. đơn có ĐÚNG 1 `OrderItem`
 * Cộng thêm `Payment.paymentType = 'PAYMENT'` — không phải điều kiện của chủ dự án, mà là điều
 * kiện của con số 146 (báo cáo lọc nó). Bút toán điều chỉnh/hoàn để lượt sau, có chủ đích.
 *
 * ⚠️ `SET "orderItemId" = <dòng hàng duy nhất>` — KHÔNG đụng cột nào khác. Không `amount`,
 * không `accountantStatus`, không `saleStatus`, không `enrollmentId`, không `updatedAt` bằng
 * tay. Đó là toàn bộ lý do lệnh này an toàn, nên nó được viết ra thành SQL để đọc bằng mắt
 * thay vì tin một `data: {}` của ORM.
 *
 * Trả về từng dòng đã đổi (`RETURNING`) để tầng trên ghi AuditLog 1 dòng/đơn — và để so số
 * dòng bị ảnh hưởng với con số đã duyệt. So KHÔNG khớp thì tầng trên NÉM ⇒ rollback.
 */
export async function ganOrderItemMotCau(
  tx: Tx,
): Promise<{ paymentId: string; orderId: string; orderCode: string; orderItemId: string; amount: number }[]> {
  // `$queryRaw` (không phải `$executeRaw`) vì cần `RETURNING`. Tham số hoá bằng Prisma.sql —
  // không nội suy chuỗi, không `$queryRawUnsafe` (bị cấm toàn repo).
  return tx.$queryRaw<
    { paymentId: string; orderId: string; orderCode: string; orderItemId: string; amount: number }[]
  >`
    WITH mot_dong AS (
      SELECT "orderId", MIN("id") AS "itemId"
      FROM "OrderItem"
      GROUP BY "orderId"
      HAVING COUNT(*) = 1
    ),
    can_gan AS (
      SELECT p."id" AS "paymentId", o."id" AS "orderId", o."code" AS "orderCode",
             m."itemId" AS "orderItemId", p."amount" AS "amount"
      FROM "Payment" p
      JOIN "Order" o ON o."id" = p."orderId"
      JOIN mot_dong m ON m."orderId" = o."id"
      WHERE p."orderItemId" IS NULL
        AND p."deletedAt" IS NULL
        AND p."paymentType" = 'PAYMENT'
        AND o."deletedAt" IS NULL
        AND o."status" NOT IN ('DRAFT', 'CANCELLED', 'REFUNDED')
    )
    UPDATE "Payment" p
    SET "orderItemId" = c."orderItemId"
    FROM can_gan c
    WHERE p."id" = c."paymentId"
    RETURNING c."paymentId", c."orderId", c."orderCode", c."orderItemId", c."amount"
  `;
}

/**
 * Ghi AuditLog — MỘT dòng cho MỘT đơn (chủ dự án chốt), không phải một dòng mỗi khoản.
 *
 * Người đọc log sau này muốn biết *"đơn này bị backfill lúc nào"*; chi tiết từng khoản nằm
 * trong `newValues`. Gọi SAU câu UPDATE, TRONG CÙNG transaction — nên nếu audit ném thì cả
 * lượt ghi rollback theo, và không có phép đổi tiền nào tồn tại mà không có dấu.
 */
export async function ghiAuditBackfill(
  tx: Tx,
  input: {
    dong: readonly { paymentId: string; orderId: string; orderCode: string; orderItemId: string; amount: number }[];
    actor: AuditActor;
  },
): Promise<number> {
  const theoDon = new Map<string, { code: string; khoan: { paymentId: string; orderItemId: string; amount: number }[] }>();
  for (const d of input.dong) {
    const cum = theoDon.get(d.orderId) ?? { code: d.orderCode, khoan: [] };
    cum.khoan.push({ paymentId: d.paymentId, orderItemId: d.orderItemId, amount: d.amount });
    theoDon.set(d.orderId, cum);
  }
  for (const [orderId, cum] of theoDon) {
    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: orderId,
      action: "PAYMENT_ORDER_ITEM_BACKFILLED",
      changedFields: ["orderItemId"],
      newValues: { orderCode: cum.code, soKhoan: cum.khoan.length, khoan: cum.khoan },
      reason:
        "Backfill orderItemId cho khoản cũ của đơn MỘT con — cột ra đời 16/09/2026 nên mọi " +
        "khoản cũ hơn đều NULL. Một câu UPDATE, chỉ ghi cột orderItemId.",
    });
  }
  return theoDon.size;
}
