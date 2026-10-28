// prisma/seed-uat/chay-dat-lai-mat-khau.ts — CHỈ ĐẶT LẠI MẬT KHẨU tài khoản `uat.*` về UAT_PASSWORD (20/10/2026). Dry-run mặc định.
//
//   UAT_SEED=1 UAT_PASSWORD=… pnpm exec tsx prisma/seed-uat/chay-dat-lai-mat-khau.ts           # DRY-RUN: liệt kê tài khoản sẽ đặt lại (KHÔNG in mật khẩu / băm)
//   UAT_SEED=1 UAT_PASSWORD=… pnpm exec tsx prisma/seed-uat/chay-dat-lai-mat-khau.ts --apply   # GHI: password + mustChangePassword=false, chỉ email thuộc DANH_SACH uat.*
//
// Vì sao không dùng `db:seed:uat` / `chay-tai-khoan-thieu`: xem đoạn "Đặt lại MẬT KHẨU" cuối `00-tai-khoan.ts`. Lối này không tạo tài khoản, không đụng hồ sơ nhân sự / vai / bảng nào khác,
// không "sống lại" tài khoản đã xoá mềm hoặc bị khoá. Chống đăng nhập sai nhiều lần là rate-limit theo phút (Upstash/bộ nhớ), KHÔNG lưu DB — không có bộ đếm nào để xoá ở đây.
import { assertSeedAllowed, db } from "./_common";
import { datLaiMatKhau, docDatLaiMatKhau } from "./00-tai-khoan";

async function main() {
  assertSeedAllowed();
  const apply = process.argv.includes("--apply");
  const p = await docDatLaiMatKhau();
  const ds = (xs: { email: string | null }[]) => (xs.length ? ` — ${xs.map((x) => x.email).join(", ")}` : "");
  console.log(`\nSẽ đặt lại mật khẩu: ${p.datLai.length}${ds(p.datLai)}`);
  console.log(`Đã khớp UAT_PASSWORD (bỏ qua): ${p.daKhop.length}${ds(p.daKhop)}`);
  console.log(`Không đụng (xoá mềm / bị khoá / không ACTIVE): ${p.boQua.length}${p.boQua.length ? ` — ${p.boQua.map((b) => `${b.hang.email} (${b.lyDo})`).join(", ")}` : ""}`);
  if (!apply) {
    console.log("DRY-RUN — không ghi gì. Thêm --apply để đặt lại (cần env UAT_PASSWORD ≥ 8 ký tự).");
    return;
  }
  if (p.datLai.length === 0) {
    console.log("Không có gì để đặt lại.");
    return;
  }
  const n = await datLaiMatKhau(p.datLai);
  console.log(`Đã đặt lại: ${n}/${p.datLai.length}`);
  const sau = await docDatLaiMatKhau();
  console.log(`Sau khi ghi, còn sai mật khẩu: ${sau.datLai.length}`);
  if (sau.datLai.length > 0) process.exit(1);
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
