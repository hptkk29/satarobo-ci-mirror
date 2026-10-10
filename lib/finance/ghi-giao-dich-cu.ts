import "server-only";
import type { Prisma } from "@prisma/client";

import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { generateOrderCode } from "@/lib/orders/code";
import { BACKFILL_PAYMENT_MARKER, dauDongSheet } from "@/lib/finance/payment-markers";
import type { GiaoDichSheet } from "@/lib/finance/nhap-giao-dich-sheet";
import { thangCuaSheet } from "@/lib/finance/khop-sale-sheet";

type Tx = Prisma.TransactionClient;

/**
 * lib/finance/ghi-giao-dich-cu.ts — ghi các khoản học phí ĐÃ ĐÓNG TRƯỚC KHI LÊN HỆ THỐNG
 * vào hồ sơ một học viên.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CẦN: học viên chốt trước ngày hệ thống chạy thì không có `Payment` nào, nên cổng
 * phụ huynh — vốn cộng theo `Enrollment.payments` — hiện NỢ NGUYÊN dù nhà đã đóng đủ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BA QUYẾT ĐỊNH THIẾT KẾ, MỖI CÁI CÓ LÝ DO
 *
 * (1) MỘT ĐƠN cho mỗi em, NHIỀU KHOẢN (mỗi dòng sheet một khoản).
 *     Gộp thành một khoản duy nhất là mất ngày đóng của từng đợt — mà ngày đóng chính là
 *     thứ người ta đối chiếu với sao kê ngân hàng khi có tranh cãi.
 *
 * (2) `totalAmount` của đơn = Σ TIỀN ĐÃ THU, không phải học phí hợp đồng.
 *     Đơn này là BIÊN LAI GOM, không phải hợp đồng. Nợ thật (nếu còn) nằm ở
 *     `Enrollment.finalPrice` và cổng phụ huynh đọc từ đó; đặt `totalAmount` bằng giá
 *     niêm yết ở đây là bịa ra một khoản nợ thứ hai cho cùng một việc.
 *
 * (3) IDEMPOTENT THEO TỪNG DÒNG SHEET, không theo em.
 *     Nhập giao dịch cũ là việc người ta chạy nhiều lần: nhập thử, sửa file, nhập lại,
 *     bổ sung tháng mới. Idempotent theo em thì lần sau không bổ sung được; không
 *     idempotent thì mỗi lượt cộng thêm một lần tiền. Khoá đúng là DÒNG
 *     (`dauDongSheet`).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type KetQuaGhiMotEm = {
  hocVienId: string;
  /** Số khoản THẬT SỰ được ghi lượt này. */
  daGhi: number;
  /** Số dòng bỏ qua vì đã nhập ở lượt trước (idempotent). */
  boQuaDaCo: number;
  tongTien: number;
  orderId: string | null;
  /** Không có ghi danh sống nào để gắn — khoản vẫn ghi, nhưng công nợ portal chưa trừ. */
  chuaGanGhiDanh: boolean;
};

export async function ghiGiaoDichCuChoHocVienInTx(
  tx: Tx,
  params: {
    /** NGƯỜI BẤM NÚT — đi vào AuditLog để truy trách nhiệm thao tác. */
    actor: AuditActor;
    hocVienId: string;
    giaoDich: GiaoDichSheet[];
    /**
     * SALE PHỤ TRÁCH lấy từ cột "Sales" của sheet, đã được người nhập map sang tài khoản.
     *
     * ⚠️ Đây là thứ đi vào `Order.createdById`, KHÔNG phải người bấm nút. Chủ dự án chốt
     * 14/09/2026: "người tạo phải gán cho sale". Danh sách đơn và mọi báo cáo đọc
     * `createdById` để biết ai bán — để nguyên người bấm thì 136 đơn đều mang tên một
     * người, và hoa hồng/thành tích của 6 sale biến mất.
     *
     * `null` = chưa map được ⇒ lùi về người bấm, và điều đó phải HIỆN RA trên màn.
     */
    saleUserId: string | null;
  },
): Promise<KetQuaGhiMotEm | { loi: string }> {
  const { actor, hocVienId, giaoDich, saleUserId } = params;

  const hv = await tx.student.findUnique({
    where: { id: hocVienId },
    select: {
      id: true,
      name: true,
      parentName: true,
      parentPhone: true,
      centerId: true,
      deletedAt: true,
    },
  });
  if (!hv || hv.deletedAt) return { loi: "Không tìm thấy học viên" };

  // ── Lọc những dòng ĐÃ nhập ở lượt trước ──────────────────────────────────────
  // Tra MỘT câu cho cả em thay vì mỗi dòng một câu: danh sách dòng ở đây tối đa vài
  // chục, còn số lượt tra thì nhân với số em.
  const dau = giaoDich.map((g) => dauDongSheet(g.sheet, g.dong));
  const daCo = await tx.payment.findMany({
    where: {
      deletedAt: null,
      OR: dau.map((d) => ({ note: { contains: d } })),
    },
    select: { note: true },
  });
  const tapDaCo = new Set<string>();
  for (const p of daCo) {
    for (const d of dau) if (p.note?.includes(d)) tapDaCo.add(d);
  }

  const canGhi = giaoDich.filter((g) => !tapDaCo.has(dauDongSheet(g.sheet, g.dong)));
  if (canGhi.length === 0) {
    return {
      hocVienId,
      daGhi: 0,
      boQuaDaCo: giaoDich.length,
      tongTien: 0,
      orderId: null,
      chuaGanGhiDanh: false,
    };
  }

  // ── Ghi danh để gắn khoản ────────────────────────────────────────────────────
  // Cổng phụ huynh cộng công nợ theo quan hệ `Enrollment.payments`; khoản không gắn ghi
  // danh thì dù kế toán đã xác nhận vẫn KHÔNG trừ vào nợ của em nào — tức là nhập xong
  // mà phụ huynh vẫn thấy nợ nguyên, đúng cái bệnh đang chữa.
  //
  // Chỉ gắn khi KHÔNG MƠ HỒ: đúng một ghi danh còn sống. Em học nhiều lớp thì phải chia
  // theo `finalPrice`, việc đó không làm lén ở đây — để `chuaGanGhiDanh` cho màn hình nói
  // ra và người xử lý tay.
  const ghiDanh = await tx.enrollment.findMany({
    where: { studentId: hv.id, deletedAt: null },
    select: { id: true },
    take: 2,
  });
  const enrollmentId = ghiDanh.length === 1 ? ghiDanh[0]!.id : null;

  const tongTien = canGhi.reduce((s, g) => s + Math.max(0, Math.round(g.hocPhi)), 0);
  const tenKhoa = canGhi.find((g) => g.khoa)?.khoa ?? "Học phí (nhập liệu ban đầu)";
  // Ngày sớm nhất trong lô — đơn phải mang mốc thời gian của tiền, không phải của lượt nhập.
  //
  // ⚠️ MỐC LÙI KHI SHEET BỎ TRỐNG NGÀY (đo thật: 23/136 dòng) là NGÀY 1 CỦA THÁNG TRONG
  // TÊN SHEET, không phải `new Date()`. Báo cáo doanh thu theo tháng và danh sách đơn đều
  // xếp theo `Order.createdAt`; để đồng hồ thật thì học phí tháng 5 hiện thành doanh thu
  // tháng 9. Tháng là dữ liệu CÓ THẬT trong file; ngày trong tháng thì không — nên lấy
  // ngày 1 và để màn nhập nói ra, đừng đoán ngày.
  const ngaySom =
    canGhi
      .map((g) => g.ngay)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ??
    canGhi.map((g) => thangCuaSheet(g.sheet)).find((d): d is Date => d instanceof Date) ??
    new Date();

  const order = await tx.order.create({
    data: {
      code: await generateOrderCode(tx),
      type: "COURSE",
      status: "CONFIRMED",
      customerName: hv.parentName ?? hv.name,
      customerPhone: hv.parentPhone ?? "",
      studentId: hv.id,
      centerId: hv.centerId,
      // SALE phụ trách, không phải người bấm nút. Người bấm nằm ở AuditLog bên dưới.
      createdById: saleUserId ?? actor.id ?? null,
      // ⚠️ NGÀY THẬT TRONG SHEET, không phải lúc bấm nút. Chủ dự án chốt: "lúc tạo phải
      // lấy đúng ngày trong sheet". `Order.createdAt` có `@default(now())` nhưng Prisma
      // cho truyền giá trị — và phải truyền, vì báo cáo doanh thu theo tháng, danh sách
      // đơn và cron đều xếp theo cột này. Để now() là 136 đơn của 5 tháng dồn hết vào
      // hôm nay.
      createdAt: ngaySom,
      subtotal: tongTien,
      discountAmount: 0,
      // Xem chú thích (2) đầu file: đây là BIÊN LAI GOM, không phải hợp đồng.
      totalAmount: tongTien,
      paidAt: ngaySom,
      confirmedByUserId: actor.id,
      confirmedAt: ngaySom,
      items: {
        create: [
          {
            type: "COURSE_ENROLLMENT" as const,
            itemName: tenKhoa,
            quantity: 1,
            unitPrice: tongTien,
            totalPrice: tongTien,
          },
        ],
      },
    },
    select: { id: true, code: true },
  });

  for (const g of canGhi) {
    const soTien = Math.max(0, Math.round(g.hocPhi));
    if (soTien <= 0) continue;
    await tx.payment.create({
      data: {
        orderId: order.id,
        enrollmentId,
        amount: soTien,
        method: "backfill",
        paidDate: g.ngay ?? ngaySom,
        // ⚠️ `BACKFILL_PAYMENT_MARKER` phải còn NGUYÊN VẸN trong chuỗi: nút xác nhận
        // hàng loạt ở /payments tìm nó bằng `contains`. Dấu dòng đứng CẠNH, không lồng.
        note:
          `Nhập liệu ban đầu — ${g.sheet} dòng ${g.dong}` +
          (g.ghiChu ? ` (${g.ghiChu})` : "") +
          ` ${BACKFILL_PAYMENT_MARKER} ${dauDongSheet(g.sheet, g.dong)}`,
        saleStatus: "RECORDED",
        // Cố ý KHÔNG tự xác nhận: đó là việc của kế toán ở /payments, và tự xác nhận ở
        // đây là mở đường ghi CONFIRMED thứ hai.
        accountantStatus: "PENDING",
        recordedById: actor.id,
        centerId: hv.centerId,
      },
      select: { id: true },
    });
  }

  await writeAudit({
    actor,
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "CREATE",
    newValues: {
      source: "nhap-giao-dich-cu",
      orderCode: order.code,
      hocVienId: hv.id,
      soKhoan: canGhi.length,
      tongTien,
      enrollmentId,
      dongSheet: canGhi.map((g) => `${g.sheet}#${g.dong}`),
    },
    orgUnitId: hv.centerId,
    tx,
  });

  return {
    hocVienId,
    daGhi: canGhi.length,
    boQuaDaCo: giaoDich.length - canGhi.length,
    tongTien,
    orderId: order.id,
    chuaGanGhiDanh: enrollmentId == null,
  };
}
