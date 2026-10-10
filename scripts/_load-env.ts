import { config } from "dotenv";

/**
 * AUTH-SĐT P1 — nạp env cho script chạy bằng `tsx`.
 *
 * Next.js tự nạp `.env*`, nhưng `tsx scripts/x.ts` thì **KHÔNG** — chạy trần sẽ
 * chết ngay ở `DATABASE_URL not found` dù máy có file `.env` đầy đủ. Repo trước
 * đây né bằng cách bắt người dùng gõ `pnpm exec dotenv -e .env -- tsx …`, nhưng
 * mỗi script lại ghi một file khác nhau (`.env` hay `.env.local`) nên rất dễ gõ
 * nhầm rồi tưởng là lỗi kết nối DB.
 *
 * Nạp ở đây một lần, theo đúng thứ tự ưu tiên của Next.js: `.env.local` thắng
 * `.env`. `dotenv` KHÔNG ghi đè biến đã có sẵn trong môi trường, nên biến do CI
 * truyền vào (GitHub Actions) vẫn thắng tất cả — import file này an toàn cả
 * trên máy dev lẫn trong workflow.
 *
 * ⚠️ Phải import ĐẦU TIÊN, trước mọi import chạm `@/lib/db`: Prisma Client đọc
 * `DATABASE_URL` ngay lúc khởi tạo module.
 */
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/** Host của DB đang trỏ tới — in ra để không bao giờ chạy nhầm PROD/local. */
export function currentDbHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  return url.replace(/^.*@/, "").replace(/\/.*$/, "") || "(chưa có DATABASE_URL)";
}
