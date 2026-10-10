// EL-07 · AC8 / EL-07-T10-06 — plugin `elearning/no-bare-next-response`.
//
// Plugin không có test sẽ hỏng CÂM khi nâng ESLint (đúng bài học của 3 plugin đang có
// trong thư mục này). Test viết TRƯỚC khi nối vào `eslint.config.mjs` — luật Nền Hệ
// thống #5.
//
// Dùng ESLint Node API với filePath giả, theo mẫu `db-restriction.test.ts` /
// `inline-authz.test.ts`.
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

const RULE = "elearning/no-bare-next-response";
const eslint = new ESLint();

async function loi(filePath: string, code: string) {
  const [res] = await eslint.lintText(code, { filePath });
  return (res?.messages ?? []).filter((m) => m.ruleId === RULE);
}

const BARE = `
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ hello: "world" });
}
`;

describe("[EL-07-T10-06] cấm NextResponse.json trần trong route e-learning", () => {
  // Trần 60s như `db-restriction.test.ts` / `inline-authz.test.ts` — cùng lý do:
  // lượt `lintText` ĐẦU TIÊN phải nạp cấu hình + plugin, nên nó gánh toàn bộ chi phí
  // khởi động của ESLint. Chạy riêng file này mất 2,8s, nhưng trong cả bộ (351 file
  // chạy song song) mất 10,6s ⇒ vượt trần mặc định 5s và đỏ THẤT THƯỜNG. Đã đỏ hai
  // lượt rồi xanh lượt sau — đúng dạng flake dễ bị đổ oan cho code vừa sửa.
  it("app/api/elearning/** → BÁO LỖI", { timeout: 60_000 }, async () => {
    const ms = await loi("app/api/elearning/khoa-hoc/route.ts", BARE);
    expect(ms.length).toBe(1);
    expect(ms[0]?.message).toContain("lib/api/response");
  });

  it("app/api/cron/elearning-*/** → BÁO LỖI", async () => {
    const ms = await loi("app/api/cron/elearning-dem/route.ts", BARE);
    expect(ms.length).toBe(1);
  });

  it('bắt cả dạng computed NextResponse["json"]', async () => {
    const ms = await loi(
      "app/api/elearning/x/route.ts",
      `
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse["json"]({ a: 1 });
}
`,
    );
    expect(ms.length).toBe(1);
  });

  it("KHÔNG bắt redirect/next/new NextResponse — ba cái đó hợp lệ", async () => {
    const ms = await loi(
      "app/api/elearning/x/route.ts",
      `
import { NextResponse } from "next/server";
export function GET() {
  if (Math.random() > 0.5) return NextResponse.redirect("https://satarobo.vn");
  if (Math.random() > 0.5) return NextResponse.next();
  return new NextResponse("ok", { status: 200 });
}
`,
    );
    expect(ms.length).toBe(0);
  });

  it("route NGOÀI phạm vi e-learning → KHÔNG bắt (phạm vi hẹp có chủ đích)", async () => {
    // 69 route cũ đang chạy 3 hình dạng lỗi khác nhau; sửa chúng là việc riêng,
    // không phải việc của PR nền. Bắt cả repo ở đây thì PR này không merge được.
    for (const p of [
      "app/api/leads/route.ts",
      "app/api/admin/upload-url/route.ts",
      "app/api/cron/email-queue/route.ts",
    ]) {
      expect((await loi(p, BARE)).length).toBe(0);
    }
  });
});
