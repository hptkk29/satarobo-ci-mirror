// tests/e2e/_helpers/nap-env.ts — nạp `.env.test` cho MỌI cấu hình Playwright.
//
// 🔴 VÌ SAO CÓ TỆP NÀY — sự cố 20/09/2026, và nó làm một PHÉP ĐO nói dối.
//
// Cả 13 cấu hình Playwright đều gọi:
//     dotenv.config({ path: ".env.test", override: true });
//
// `override: true` nghĩa là **tệp THẮNG biến môi trường truyền vào**. Hệ quả: lệnh
//
//     DATABASE_URL=…/satarobo_vitest pnpm exec playwright test -c playwright.r7.config.ts --shard=2/2
//
// **KHÔNG** chạy trên `satarobo_vitest` — nó vẫn chạy trên DB ghi trong `.env.test`.
// Tôi đã báo cáo "hai shard chạy trên hai database riêng, đúng cấu hình CI" và điều đó
// **SAI**: cả hai shard dùng chung một DB. Đúng thứ `.claude/rules/prisma-db.md` cảnh
// báo là cấu hình CI **không** dùng (`resetDb()` của spec này xoá dữ liệu spec kia).
//
// ⚠️ Cái đắt không phải lượt chạy sai — mà là **một phép đo sai trông y hệt phép đo
// đúng**. Không có dòng nào báo lỗi; chỉ có một câu trong báo cáo không còn đúng.
//
// ── Luật mới, cài trong hàm này ─────────────────────────────────────────────
// `override: false` — **biến truyền vào THẮNG**, tệp chỉ điền chỗ còn trống. Đây là
// ngữ nghĩa mà mọi người vốn đã tưởng nó có, và là ngữ nghĩa mặc định của `dotenv`.
//
// Đổi hành vi này có làm hỏng ai không? KHÔNG:
// · chạy trần (không đặt biến) ⇒ y hệt trước, vì không có gì để "thắng";
// · CI đặt `DATABASE_URL` qua `env:` của job và **không có** `.env.test` ⇒ không đổi;
// · chỉ đổi đúng ca mà người chạy CỐ Ý truyền biến — tức ca trước đây bị nuốt lặng lẽ.
import dotenv from "dotenv";

/**
 * Nạp `.env.test` rồi IN RA database đang thật sự dùng.
 *
 * In ra là phần quan trọng ngang phần nạp: lần sau không ai phải suy đoán, và không ai
 * báo nhầm như tôi vừa làm. Mật khẩu bị che — chuỗi kết nối không bao giờ vào log.
 */
export function napEnvTest(tenBo: string): void {
  // `override: false` là MẶC ĐỊNH của dotenv; viết tường minh để người đọc sau thấy
  // đây là một QUYẾT ĐỊNH, không phải quên.
  dotenv.config({ path: ".env.test", override: false });

  // 🔴 SỬA 21/09/2026 — CHÍNH DÒNG NÀY ĐÃ NÓI DỐI, đúng lỗi tệp này sinh ra để chặn.
  //
  // Bản cũ đọc `TEST_DATABASE_URL ?? DATABASE_URL`. Nhưng thứ QUYẾT ĐỊNH dữ liệu chạy ở
  // đâu là `DATABASE_URL`: `prisma/schema.prisma` khai `url = env("DATABASE_URL")`, và
  // `assertTestDb()` cũng kiểm đúng biến đó.
  //
  // Hệ quả, đo thật: `.env.test` khai sẵn `TEST_DATABASE_URL=…/satarobo_test`. Chạy đúng
  // lệnh mà CLAUDE.md dặn cho hai shard —
  //     DATABASE_URL=…/ci_test pnpm exec playwright test -c playwright.r7.config.ts --shard=2/2
  // — thì Prisma dùng `ci_test`, còn dòng này in ra `satarobo_test`. Người đọc log thấy
  // HAI shard in CÙNG một tên DB và kết luận chúng đang giẫm lên nhau, trong khi thật ra
  // chúng tách đúng. Tức lời khuyên "đọc dòng này để khỏi phải đoán" dẫn thẳng tới một
  // kết luận sai — y hệt lớp lỗi `override: true` ở đầu tệp.
  const url = process.env.DATABASE_URL ?? "";
  // Che mật khẩu. `postgresql://user:MAT_KHAU@host/db` → `postgresql://user:***@host/db`
  const che = url.replace(/:[^:@/]*@/, ":***@") || "(chưa đặt)";
  const ten = url.split("/").pop()?.split("?")[0] || "?";

  // Một dòng, ở đầu mỗi lượt chạy. Rẻ, và nó đúng là thứ đã thiếu.
  console.log(`[${tenBo}] DB: ${ten}   (${che})`);

  // `TEST_DATABASE_URL` KHÔNG chọn DB cho Prisma, nhưng nó chọn cổng SKIP của bộ chạm DB
  // (`tests/_helpers/db-gate.ts` đọc `TEST_DATABASE_URL ?? DATABASE_URL`). Hai biến trỏ
  // hai nơi là một cái bẫy im lặng — nói ra, đừng để người sau tự vấp.
  const urlGate = process.env.TEST_DATABASE_URL;
  if (urlGate && urlGate !== url) {
    const tenGate = urlGate.split("/").pop()?.split("?")[0] || "?";
    console.log(
      `[${tenBo}] ⚠️ TEST_DATABASE_URL trỏ "${tenGate}" — KHÁC DB ở trên. ` +
        `Prisma dùng DATABASE_URL ("${ten}"); TEST_DATABASE_URL chỉ chi phối cổng SKIP ` +
        `của bộ chạm DB. Lệch nhau thường là do .env.test còn khai biến cũ.`,
    );
  }
}
