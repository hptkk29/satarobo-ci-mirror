/**
 * scripts/kiem-hoc-bu.ts — KIỂM TOÀN VẸN DỮ LIỆU HỌC BÙ (T01, 07/10/2026). CHỈ ĐỌC.
 *
 *   DATABASE_URL=<chuỗi chỉ-đọc> pnpm exec tsx scripts/kiem-hoc-bu.ts
 *     --tu=YYYY-MM-DD   chỉ xét buổi vắng / case từ ngày này (giờ VN); mặc định = mốc `HOC_BU_TU_NGAY`
 *     --toi-da=N        số dòng tối đa MỖI LUẬT trong bản markdown (mặc định 40; bản JSON luôn đủ)
 *     --strict          thoát mã 1 nếu có phát hiện CRITICAL (dùng làm cổng; mặc định luôn mã 0)
 *
 * Ghi hai tệp ở thư mục hiện tại:
 *   bao-cao-hoc-bu-toan-ven.md    — đọc được; workflow đưa lên job summary
 *   bao-cao-hoc-bu-toan-ven.json  — đủ mọi phát hiện; script vá (T15) đọc nó, KHÔNG đọc markdown
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN TOÀN — hai lớp, và lớp thứ hai là lớp có giá trị:
 *   1. Chạy bằng user chỉ-đọc của prod khi chạm prod — workflow lo (tên user: xem docs/VPS-VAN-HANH.md).
 *   2. Mọi câu chạy trong MỘT transaction `READ ONLY` + `REPEATABLE READ` (một ảnh chụp nhất quán — ở
 *      READ COMMITTED mỗi câu thấy một ảnh khác, nên một lượt điểm danh bù commit giữa chừng sẽ cho ra
 *      bản ghi xé đôi và luật diễn giải thành lỗi CRITICAL giả). Script TỰ KIỂM cả hai cờ rồi mới đọc;
 *      không đúng thì DỪNG, không đọc gì. Lớp 1 chỉ đúng khi ai đó cấu hình đúng; lớp 2 đúng kể cả
 *      khi họ dán nhầm chuỗi kết nối đầy quyền.
 *
 * KHÔNG ghi gì, KHÔNG sửa gì, KHÔNG "tiện tay vá". Phát hiện nào AUTO_FIXABLE cũng chỉ là LỜI ĐỀ XUẤT.
 */
import "./_cho-phep-server-only";
import { writeFileSync } from "node:fs";

const arg = (ten: string) => process.argv.find((a) => a.startsWith(`--${ten}=`))?.split("=")[1];
const STRICT = process.argv.includes("--strict");
const TOI_DA = Math.max(1, Number(arg("toi-da") ?? 40) || 40);

async function main() {
  // Nhập ĐỘNG: các module này có `import "server-only"`, mà bản vá phải chạy TRƯỚC (xem tệp shim).
  const { db } = await import("../lib/db");
  const { docSnapshot } = await import("../lib/hoc-bu/toan-ven-db");
  const { chayToanVen, dungBaoCao } = await import("../lib/hoc-bu/toan-ven");
  const { HOC_BU_TU_NGAY } = await import("../lib/hoc-bu/danh-sach-db");
  const { vnYmd } = await import("../lib/time/vn");

  const now = new Date();
  const tuNgayYmd = arg("tu") ?? vnYmd(HOC_BU_TU_NGAY);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tuNgayYmd)) throw new Error(`--tu sai dạng: ${tuNgayYmd}`);

  const { tu, snapshot } = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [tu] = await tx.$queryRaw<{ ro: string; iso: string; db: string; usr: string; ghi: boolean }[]>`
        select current_setting('transaction_read_only') as ro,
               current_setting('transaction_isolation') as iso,
               current_database() as db,
               current_user as usr,
               has_table_privilege(current_user, 'public."MakeupNeed"', 'UPDATE') as ghi
      `;
      if (!tu || tu.ro !== "on") throw new Error(`transaction_read_only = ${tu?.ro} — KHÔNG đọc. Checker chỉ chạy trong transaction chỉ-đọc.`);
      if (tu.iso !== "repeatable read") throw new Error(`transaction_isolation = ${tu.iso} — KHÔNG đọc. Cần repeatable read để các câu đọc thấy CÙNG một ảnh chụp.`);
      return { tu, snapshot: await docSnapshot(tx, { now, tuNgayYmd }) };
    },
    // Runner ở xa DB (tunnel): trần 5 giây mặc định của Prisma cắt giữa chừng (P2028).
    { timeout: 180_000, maxWait: 20_000, isolationLevel: "RepeatableRead" },
  );

  const ketQua = chayToanVen(snapshot, { now, tuNgayYmd });
  const meta = {
    db: tu.db,
    nguoiDung: tu.usr,
    coQuyenGhi: tu.ghi,
    nhanh: process.env.GITHUB_REF_NAME ?? "(máy dev)",
    luc: now.toISOString(),
    tuNgayYmd,
  };
  const md = dungBaoCao(ketQua, meta, TOI_DA);
  console.log(md.split("\n").slice(0, 60).join("\n"));
  writeFileSync("bao-cao-hoc-bu-toan-ven.md", md + "\n");
  writeFileSync("bao-cao-hoc-bu-toan-ven.json", JSON.stringify({ meta, ...ketQua }, null, 2) + "\n");

  const nghiemTrong = ketQua.findings.filter((f) => f.nghiemTrong === "CRITICAL").length;
  console.log(`\n[xong] ${ketQua.findings.length} phát hiện (${nghiemTrong} CRITICAL) — bao-cao-hoc-bu-toan-ven.{md,json}`);
  if (STRICT && nghiemTrong > 0) process.exitCode = 1;
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
