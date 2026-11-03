// prisma/seed-uat/04-tai-chinh.ts — đơn hàng, thu tiền, công nợ, đối soát ngân hàng.
//
// Màn được nuôi: /orders · /payments · /cong-no · /hoan-tien · /bien-dong-so-du ·
// /bao-cao/doanh-thu · /crm/commission · /payment-methods
//
// TIỀN LÀ CHỖ DỄ SAI NHẤT nên bộ này bám đúng một quy ước: MỖI GHI DANH có tối đa
// MỘT đơn hàng, và tiền đã thu chỉ nằm ở `Payment`. Không tự dựng thêm sổ thứ hai
// (`OrderInstallment`) — hai sổ song song từng đẻ ra tiền ghi hai lần.
//
// CA BIÊN CỐ Ý
//  · đơn CHỜ THANH TOÁN quá hạn → màn Công nợ có dòng đỏ;
//  · đơn thu THIẾU (trả góp dở dang) → công nợ còn dư;
//  · khoản thu CHỜ KẾ TOÁN XÁC NHẬN → `uat.ketoan` có việc để duyệt;
//  · giao dịch ngân hàng CHƯA KHỚP đơn (`centerId` null) → màn đối soát có việc.
import {
  db, buoc, xong, chance, int, makeRng, ngay, pick, taoThieu, uid,
  type CoId, type CoSo, type Uat,
} from "./_common";
import type { Prisma } from "@prisma/client";

export async function seedTaiChinh(coSo: CoSo[], uat: Uat) {
  const rng = makeRng(4004);

  // Đọc lại ghi danh vừa seed — không truyền qua tham số để bước này chạy độc lập
  // được (`UAT_ONLY=taichinh`).
  const gds = await db.enrollment.findMany({
    where: { id: { startsWith: "uat-gd-" } },
    select: {
      id: true, studentId: true, classId: true, centerId: true,
      finalPrice: true, status: true, enrolledAt: true,
      student: { select: { name: true, parentName: true, parentPhone: true } },
    },
  });
  if (gds.length === 0) throw new Error("Chưa có ghi danh UAT — chạy bước hocvu trước.");

  const donHang: CoId<Prisma.OrderCreateManyInput>[] = [];
  const dongDon: CoId<Prisma.OrderItemCreateManyInput>[] = [];
  const thuTien: CoId<Prisma.PaymentCreateManyInput>[] = [];

  buoc("Đơn hàng + khoản thu");
  for (const gd of gds) {
    // Ghi danh chưa xác nhận thì chưa có đơn — đúng đời thật.
    if (gd.status === "PENDING") continue;
    const gia = gd.finalPrice ?? 4_400_000;
    const csKey = coSo.find((c) => c.centerId === gd.centerId)?.key ?? "CS1";
    const ketoan = uat.ketoan;
    const sale = csKey === "CS1" ? uat.sale1 : uat.sale2;

    // Phân bố: đa số đã thu đủ; phần còn lại là các ca cần xử lý.
    const r = rng();
    const daThuDu = r < 0.62;
    const thuThieu = !daThuDu && r < 0.8;   // trả góp dở dang → còn công nợ
    const chuaThu = !daThuDu && !thuThieu;  // chờ thanh toán, có ca quá hạn

    const orderId = uid("don", gd.id.replace("uat-gd-", ""));
    const ngayDat = gd.enrolledAt;
    const soNgay = Math.round((ngayDat.getTime() - ngay(0).getTime()) / 86_400_000);
    const quaHan = chuaThu && chance(rng, 0.45);

    donHang.push({
      id: orderId,
      code: `ORD-${orderId.slice(-10).toUpperCase()}`,
      type: "COURSE",
      status: daThuDu ? "COMPLETED" : thuThieu ? "CONFIRMED" : "PENDING_PAYMENT",
      customerName: gd.student?.parentName ?? "Phụ huynh",
      customerPhone: gd.student?.parentPhone ?? "84900000000",
      studentId: gd.studentId,
      centerId: gd.centerId,
      subtotal: gia,
      totalAmount: gia,
      paidAt: daThuDu ? ngay(soNgay + 1) : null,
      confirmedAt: chuaThu ? null : ngay(soNgay + 1),
      confirmedByUserId: chuaThu ? null : ketoan.id,
      internalNote: quaHan ? "Phụ huynh hẹn chuyển khoản, đã quá hạn — cần nhắc." : null,
      createdAt: ngayDat,
    });

    dongDon.push({
      id: uid("dondong", gd.id.replace("uat-gd-", "")),
      orderId,
      type: "COURSE_ENROLLMENT",
      enrollmentId: gd.id,
      // ⚠️ `itemName` là TÊN DÒNG ĐƠN, KHÔNG phải tên khoá dùng cho nội dung chuyển
      // khoản — trần 25 ký tự của EMVCo nằm ở chỗ khác, đừng lấy chuỗi này nhét vào.
      itemName: `Học phí — ${gd.student?.name ?? "học viên"}`,
      quantity: 1,
      unitPrice: gia,
      totalPrice: gia,
    });

    if (daThuDu || thuThieu) {
      const soTien = daThuDu ? gia : Math.round(gia * pick(rng, [0.3, 0.5, 0.6]));
      // ~12% khoản thu CỐ Ý còn chờ kế toán xác nhận → `uat.ketoan` có việc.
      const choDuyet = chance(rng, 0.12);
      thuTien.push({
        id: uid("thu", gd.id.replace("uat-gd-", "")),
        orderId,
        enrollmentId: gd.id,
        amount: soTien,
        method: pick(rng, ["CASH", "BANK_CS1", "BANK_CS2", "QR_SEPAY"]),
        paidDate: ngay(soNgay + 1),
        saleStatus: "COLLECT_CONFIRMED",
        accountantStatus: choDuyet ? "PENDING" : "CONFIRMED",
        confirmedById: choDuyet ? null : ketoan.id,
        confirmedAt: choDuyet ? null : ngay(soNgay + 2),
        recordedById: sale.id,
        centerId: gd.centerId,
        note: thuThieu ? "Đóng đợt 1, hẹn đóng nốt sau buổi 5." : null,
        createdAt: ngay(soNgay + 1),
      });
    }
  }

  const nDon = await taoThieu(
    donHang,
    (ids) => db.order.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.order.createMany({ data, skipDuplicates: true }),
  );
  const nDong = await taoThieu(
    dongDon,
    (ids) => db.orderItem.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.orderItem.createMany({ data, skipDuplicates: true }),
  );
  const nThu = await taoThieu(
    thuTien,
    (ids) => db.payment.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.payment.createMany({ data, skipDuplicates: true }),
  );
  xong("Tài chính", { đơn: nDon, dòng_đơn: nDong, khoản_thu: nThu });

  // ── Giao dịch ngân hàng về (đối soát) ──────────────────────────────────────
  buoc("Giao dịch ngân hàng + tiền thừa");
  const gdnh: CoId<Prisma.BankTransactionCreateManyInput>[] = [];
  for (const [i, t] of thuTien.slice(0, 60).entries()) {
    if (!String(t.method).startsWith("BANK") && t.method !== "QR_SEPAY") continue;
    // ~20% giao dịch CHƯA KHỚP được về cơ sở nào (centerId null) — đúng nghĩa
    // "tiền vừa về, chưa biết của đơn nào", và là việc của màn đối soát.
    const chuaKhop = chance(rng, 0.2);
    gdnh.push({
      id: uid("gdnh", i),
      provider: "SEPAY",
      providerTxnId: `SEPAY-UAT-${String(i).padStart(6, "0")}`,
      amount: Number(t.amount),
      transferredAt: t.paidDate as Date,
      centerId: chuaKhop ? null : (t.centerId as string),
      content: chuaKhop
        ? `CK ${int(rng, 100000, 999999)} khong ro noi dung`
        : `Hoc phi ${String(i).padStart(4, "0")}`,
      rawPayload: { nguon: "seed-uat", ghiChu: "dữ liệu UAT, không phải giao dịch thật" },
      unmatchedNote: chuaKhop ? "Nội dung không khớp mẫu, cần đối soát tay." : null,
      createdAt: t.paidDate as Date,
    });
  }
  const nGdnh = await taoThieu(
    gdnh,
    (ids) => db.bankTransaction.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.bankTransaction.createMany({ data, skipDuplicates: true }),
  );

  // Tiền thừa (nộp dư, giữ lại cho đợt sau).
  const duHv = await db.student.findMany({
    where: { id: { startsWith: "uat-hv-" } },
    select: { id: true, centerId: true },
    take: 24,
  });
  const duNo: CoId<Prisma.CreditBalanceCreateManyInput>[] = duHv.map((s, i) => ({
    id: uid("credit", i),
    studentId: s.id,
    centerId: s.centerId,
    amount: pick(rng, [50_000, 100_000, 200_000, 350_000]),
    note: "Phụ huynh chuyển dư, giữ lại cho đợt sau.",
  }));
  const nDu = await taoThieu(
    duNo,
    (ids) => db.creditBalance.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.creditBalance.createMany({ data, skipDuplicates: true }),
  );
  xong("Đối soát", { giao_dịch_NH: nGdnh, tiền_thừa: nDu });

  // ── Chỉ tiêu doanh thu ─────────────────────────────────────────────────────
  buoc("Chỉ tiêu doanh thu");
  const chiTieu: CoId<Prisma.RevenueTargetCreateManyInput>[] = [];
  for (const cs of coSo) {
    for (let m = 1; m <= 12; m++) {
      chiTieu.push({
        id: uid("rvt", cs.code, m),
        period: `2026-${String(m).padStart(2, "0")}`,
        centerId: cs.centerId,
        targetAmount: pick(rng, [150, 180, 200, 240, 300]) * 1_000_000,
      });
    }
  }
  const nCt = await taoThieu(
    chiTieu,
    (ids) => db.revenueTarget.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.revenueTarget.createMany({ data, skipDuplicates: true }),
  );
  xong("Chỉ tiêu doanh thu", nCt);
}
