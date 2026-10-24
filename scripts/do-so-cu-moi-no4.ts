// scripts/do-so-cu-moi-no4.ts — BƯỚC 2 nghiệm thu NỢ-4: số CŨ vs số MỚI trên DỮ LIỆU THẬT.
//
// 🔒 CHỈ ĐỌC. Không `create`, không `update`, không `delete`, không `$executeRaw`. Chạy
// được trên DB test đang dùng chung mà không đụng một dòng nào.
//
// CÁCH CHẠY (thay <URL> bằng TEST_DATABASE_URL của môi trường test trên Vercel):
//   DATABASE_URL='<URL>' DIRECT_URL='<URL>' pnpm exec tsx scripts/do-so-cu-moi-no4.ts
//
// Tên học viên được CHE trước khi in. Không in SĐT, không in email.
//
// Tìm phiếu thật có bút toán HOÀN và có bút toán ĐIỀU CHỈNH,
// rồi tính số CŨ (bộ lọc gộp, trước bản vá NỢ-4) vs số MỚI (sau bản vá).
// Không ghi, không xoá. PII che.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
const che = (s: string | null | undefined) =>
  !s ? "—" : s.length <= 4 ? s[0] + "***" : s.slice(0, 2) + "***" + s.slice(-2);

const ROI_LOP = ["WITHDREW", "TRANSFERRED", "CANCELLED"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const ten = url.split("/").pop()?.split("?")[0] ?? "?";
  console.log("DB:", url.includes("supabase") ? "Supabase " + ten : ten);

  // ── Tìm ghi danh có bút toán HOÀN ────────────────────────────────────────────
  const coHoan = await db.payment.findMany({
    where: { accountantStatus: "REFUNDED", deletedAt: null, enrollmentId: { not: null } },
    select: { enrollmentId: true, amount: true, paidDate: true },
    orderBy: { paidDate: "desc" },
    take: 5,
  });
  // ── Tìm ghi danh có bút toán ĐIỀU CHỈNH ──────────────────────────────────────
  const coDieuChinh = await db.payment.findMany({
    where: { paymentType: "ADJUSTMENT", deletedAt: null, enrollmentId: { not: null } },
    select: { enrollmentId: true, amount: true, adjustmentOfId: true, note: true, paidDate: true },
    orderBy: { paidDate: "desc" },
    take: 5,
  });

  console.log("\nSố bút toán HOÀN (REFUNDED) tìm được:", coHoan.length);
  console.log("Số bút toán ĐIỀU CHỈNH (ADJUSTMENT) tìm được:", coDieuChinh.length);

  const ids = [
    ...new Set([...coHoan, ...coDieuChinh].map((p) => p.enrollmentId!).filter(Boolean)),
  ];
  if (ids.length === 0) {
    console.log("\n⚠️ DB test KHÔNG có bút toán hoàn/điều chỉnh nào — không lập được bảng trên dữ liệu thật.");
    return;
  }

  for (const id of ids) {
    const e = await db.enrollment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        finalPrice: true,
        tuition: true,
        student: { select: { name: true, parentUserId: true } },
        course: { select: { name: true } },
        payments: {
          where: { deletedAt: null },
          select: {
            id: true,
            amount: true,
            accountantStatus: true,
            paymentType: true,
            adjustmentOfId: true,
            paidDate: true,
          },
          orderBy: { paidDate: "asc" },
        },
      },
    });
    if (!e) continue;

    const hocPhi = e.finalPrice ?? e.tuition ?? 0;
    const p = e.payments;

    // CŨ: chỉ CONFIRMED (bộ lọc gộp trước bản vá).
    const cuDaDong = p.filter((x) => x.accountantStatus === "CONFIRMED").reduce((s, x) => s + x.amount, 0);
    // MỚI: CONFIRMED + REFUNDED (ròng).
    const moiDaDong = p
      .filter((x) => ["CONFIRMED", "REFUNDED"].includes(x.accountantStatus))
      .reduce((s, x) => s + x.amount, 0);

    const daRoiLop = ROI_LOP.includes(e.status);
    const moiNoRows = daRoiLop
      ? p.filter((x) => ["CONFIRMED", "REFUNDED"].includes(x.accountantStatus) && x.accountantStatus !== "REFUNDED")
      : p.filter((x) => ["CONFIRMED", "REFUNDED"].includes(x.accountantStatus));
    const moiNo = hocPhi - moiNoRows.reduce((s, x) => s + x.amount, 0);
    const cuNo = hocPhi - cuDaDong;

    console.log("\n" + "=".repeat(78));
    console.log(`GHI DANH ${e.id}`);
    console.log(`  học viên: ${che(e.student?.name)}   khoá: ${e.course?.name ?? "—"}`);
    console.log(`  trạng thái: ${e.status}${daRoiLop ? "  (ĐÃ RỜI LỚP)" : ""}   học phí: ${vnd(hocPhi)}`);
    console.log("  sổ tiền:");
    for (const x of p) {
      const nhan =
        x.accountantStatus === "REFUNDED"
          ? "HOÀN"
          : x.paymentType === "ADJUSTMENT"
            ? "ĐIỀU CHỈNH"
            : x.accountantStatus;
      console.log(
        `    ${x.paidDate.toISOString().slice(0, 10)}  ${String(vnd(x.amount)).padStart(14)}  ${nhan}` +
          (x.adjustmentOfId ? `  → ${x.adjustmentOfId.slice(0, 8)}` : ""),
      );
    }
    console.log("  ──────────────────────────────────────────────");
    console.log(`  Thực thu / PH "đã đóng"   CŨ ${vnd(cuDaDong).padStart(14)}   MỚI ${vnd(moiDaDong).padStart(14)}` +
      (cuDaDong === moiDaDong ? "   (không đổi)" : "   ← ĐỔI"));
    console.log(`  Công nợ ghi danh          CŨ ${vnd(cuNo).padStart(14)}   MỚI ${vnd(moiNo).padStart(14)}` +
      (cuNo === moiNo ? "   (không đổi)" : "   ← ĐỔI"));
  }

  // ── Tổng doanh thu toàn hệ thống: cũ vs mới ──────────────────────────────────
  const cu = await db.payment.aggregate({
    where: { accountantStatus: "CONFIRMED", deletedAt: null },
    _sum: { amount: true },
  });
  const moi = await db.payment.aggregate({
    where: { accountantStatus: { in: ["CONFIRMED", "REFUNDED"] }, deletedAt: null },
    _sum: { amount: true },
  });
  const sauMoc = new Date();
  sauMoc.setMonth(sauMoc.getMonth() - 6);
  const cu6 = await db.payment.aggregate({
    where: { accountantStatus: "CONFIRMED", deletedAt: null, paidDate: { gte: sauMoc } },
    _sum: { amount: true },
  });
  const moi6 = await db.payment.aggregate({
    where: { accountantStatus: { in: ["CONFIRMED", "REFUNDED"] }, deletedAt: null, paidDate: { gte: sauMoc } },
    _sum: { amount: true },
  });
  console.log("\n" + "=".repeat(78));
  console.log("TOÀN HỆ THỐNG (DB test)");
  console.log(`  Báo cáo doanh thu (mọi thời gian)  CŨ ${vnd(cu._sum.amount ?? 0)}   MỚI ${vnd(moi._sum.amount ?? 0)}`);
  console.log(`  Biểu đồ doanh thu 6 tháng          CŨ ${vnd(cu6._sum.amount ?? 0)}   MỚI ${vnd(moi6._sum.amount ?? 0)}`);
}

main()
  .catch((e) => {
    console.error("LỖI:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
