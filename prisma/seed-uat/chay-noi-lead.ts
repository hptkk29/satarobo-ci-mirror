// prisma/seed-uat/chay-noi-lead.ts — CHỈ chạy bước "nối học viên ↔ lead nguồn" (26/09/2026).
//
//   UAT_SEED=1 pnpm exec tsx prisma/seed-uat/chay-noi-lead.ts
//
// Vì sao không dùng `UAT_ONLY=noilead pnpm db:seed:uat`: `index.ts` LUÔN chạy `seedTaiKhoan`
// (ĐẶT LẠI mật khẩu 12 tài khoản uat.*) và `seedNen` (ghi đè giá khoá học, tài khoản ngân hàng
// của phương thức thanh toán, tên bài của giáo trình UAT) trước mọi nhóm. Trên DB test đang có
// người nghiệm thu, đó là sửa dữ liệu dưới chân họ chỉ để nối lead. Lối này chỉ ĐỌC cơ sở + tài
// khoản sale rồi làm đúng một việc.
import { assertSeedAllowed, db, layCoSo, layUat } from "./_common";
import { seedNoiLead } from "./08-noi-lead";

async function main() {
  assertSeedAllowed();
  const coSo = await layCoSo();
  const uat = await layUat();
  await seedNoiLead(coSo, uat);
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("\n  ✗ SEED DỪNG:", e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
