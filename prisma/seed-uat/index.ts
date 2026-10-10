// prisma/seed-uat/index.ts — bộ seed dữ liệu UAT cho 12 tài khoản `uat.*`.
//
//   UAT_SEED=1 pnpm db:seed:uat            # chạy tất cả
//   UAT_SEED=1 UAT_ONLY=nen pnpm db:seed:uat   # chạy đúng một nhóm
//   UAT_SEED=1 UAT_N=100 pnpm db:seed:uat      # đổi số dòng mỗi cơ sở
//
// Cách ly cơ sở là trục chính: CS1 và CS2 mỗi bên một bộ dữ liệu riêng, nên
// sale CS1 thấy ~50 dòng, sale CS2 thấy ~50 dòng, còn tài khoản Hội sở /
// Super Admin nhìn thấy hợp của cả hai (~100).
//
// CHỈ THÊM/CẬP NHẬT — không có một câu xoá nào. Xem đầu `_common.ts`.
import { db, assertSeedAllowed, layCoSo, layUat, MOI_CO_SO } from "./_common";
import { seedTaiKhoan } from "./00-tai-khoan";
import { seedNen } from "./01-nen";
import { seedCrm } from "./02-crm";
import { seedHocVu } from "./03-hoc-vu";
import { seedTaiChinh } from "./04-tai-chinh";
import { seedLms } from "./05-lms";
import { seedCskhNhanSu } from "./06-cskh-nhansu";
import { seedKhoWebHeThong } from "./07-kho-web-hethong";
import { seedNoiLead } from "./08-noi-lead";

const ONLY = (process.env.UAT_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const chay = (ten: string) => ONLY.length === 0 || ONLY.includes(ten);

async function main() {
  assertSeedAllowed();

  const coSo = await layCoSo();
  // LUÔN chạy trước layUat(): DB test đã bị xoá sạch 3 lần, và mỗi lần xoá là mất
  // luôn 12 tài khoản mà mọi bước sau trỏ vào. Bước này idempotent (upsert theo
  // email) nên chạy lại trên DB còn nguyên cũng không sinh gì thêm.
  await seedTaiKhoan();
  const uat = await layUat();
  console.log(`  Cơ sở  : ${coSo.map((c) => c.code).join(", ")}`);
  console.log(`  Số dòng: ${MOI_CO_SO} mỗi cơ sở`);
  if (ONLY.length) console.log(`  Chỉ chạy: ${ONLY.join(", ")}`);

  const t0 = Date.now();
  // Bước nền LUÔN chạy: các bước sau cần danh sách khoá + bài học nó trả về.
  const nen = await seedNen(coSo);
  if (chay("crm")) await seedCrm(coSo, uat, nen.courses);
  if (chay("hocvu")) await seedHocVu(coSo, uat, nen);
  // 26/09 — mỗi học viên đến từ một phiếu lead đã chốt (Student.leadId + vết chốt ghi danh).
  // PHẢI sau hocvu. Chạy riêng trên DB đang nghiệm thu: prisma/seed-uat/chay-noi-lead.ts.
  if (chay("noilead")) await seedNoiLead(coSo, uat);
  if (chay("taichinh")) await seedTaiChinh(coSo, uat);
  if (chay("lms")) await seedLms(coSo, uat);
  if (chay("cskh")) await seedCskhNhanSu(coSo, uat);
  if (chay("kho")) await seedKhoWebHeThong(coSo, uat);

  console.log(`\n  Xong sau ${Math.round((Date.now() - t0) / 1000)}s.`);
  void uat;
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("\n  ✗ SEED DỪNG:", e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) console.error(e.stack.split("\n").slice(1, 6).join("\n"));
    await db.$disconnect();
    process.exit(1);
  });
