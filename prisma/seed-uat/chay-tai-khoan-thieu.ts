// prisma/seed-uat/chay-tai-khoan-thieu.ts — CHỈ TẠO tài khoản UAT còn THIẾU (12/10/2026). Dry-run mặc định.
//
//   UAT_SEED=1 pnpm exec tsx prisma/seed-uat/chay-tai-khoan-thieu.ts           # DRY-RUN: liệt kê tài khoản thiếu
//   UAT_SEED=1 UAT_PASSWORD=… pnpm exec tsx prisma/seed-uat/chay-tai-khoan-thieu.ts --apply   # TẠO tài khoản thiếu
//
// Vì sao không dùng `db:seed:uat`: `index.ts` LUÔN chạy `seedTaiKhoan("TAT_CA")` (ĐẶT LẠI mật khẩu 12 tài khoản uat.*) và `seedNen` (ghi đè giá khoá học, tài khoản ngân hàng
// của phương thức thanh toán, tên bài giáo trình UAT). Bộ nạp hoa hồng (`uat-nap-chay-thu`) cần uat.sale3 / uat.sale5 mà DB test đã seed từ trước khi hai tài khoản đó có trong danh sách.
// Lối này chạy ĐÚNG MỘT việc: tạo tài khoản + hồ sơ nhân sự + vai v2 cho email CHƯA CÓ dòng User (kể cả đã xoá mềm); không chạm tài khoản đang có, không đụng bảng nào khác.
import { assertSeedAllowed, db } from "./_common";
import { docTaiKhoanThieu, seedTaiKhoan } from "./00-tai-khoan";

async function main() {
  assertSeedAllowed();
  const apply = process.argv.includes("--apply");
  const thieu = await docTaiKhoanThieu();
  console.log(`\nTài khoản UAT còn thiếu: ${thieu.length}${thieu.length ? ` — ${thieu.join(", ")}` : ""}`);
  if (!apply) {
    console.log("DRY-RUN — không ghi gì. Thêm --apply để tạo (cần env UAT_PASSWORD ≥ 8 ký tự).");
    return;
  }
  if (thieu.length === 0) {
    console.log("Không có gì để tạo.");
    return;
  }
  await seedTaiKhoan("CHI_TAO_THIEU");
  const con = await docTaiKhoanThieu();
  console.log(`Sau khi tạo, còn thiếu: ${con.length}`);
  if (con.length > 0) process.exit(1);
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("\n  ✗ DỪNG:", e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
