// tests/manual/ctx-bam-thu.ts — BẤM THỬ THẬT màn "Chấm công" có ngữ cảnh Parttime trên trình duyệt: chụp thẻ trước khi bấm, BẤM
// nút, chụp màn "Đã ghi", rồi đối chiếu DB (hướng ghi = hướng dự đoán). Chỉ chạy trên DB đo local `satarobo_p3b_ui` (đã nạp
// `ctx-du-lieu-do.ts`), `next start` ở BASE_URL.
//   DATABASE_URL=…/satarobo_p3b_ui BASE_URL=http://localhost:3200 UAT_PASSWORD=… Q=<w=…&t=…> OUT_DIR=… CANH=ten|email|site,…
//     pnpm exec tsx tests/manual/ctx-bam-thu.ts
// `site` = gv (/teacher) | ql (/admin). BAM=0 ⇒ chỉ chụp, không bấm. Mật khẩu / vé chỉ đọc từ env — không in ra.
import "../../scripts/_cho-phep-server-only";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { db } from "@/lib/db";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";
import { login } from "../e2e/_helpers/auth";
import { doTranNgang } from "../e2e/_helpers/tran-ngang";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");
const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const PASS = process.env.UAT_PASSWORD ?? "";
const Q = process.env.Q ?? "";
const OUT = process.env.OUT_DIR ?? "ctx-shots";
const BAM = process.env.BAM !== "0";
const RONG = (process.env.WIDTHS ?? "375").split(",").map(Number);
if (PASS.length < 8 || !Q) throw new Error("thiếu UAT_PASSWORD / Q");
mkdirSync(OUT, { recursive: true });
const CANH = (process.env.CANH ?? "").split(",").filter(Boolean).map((x) => x.split("|") as [string, string, "gv" | "ql"]);

async function main() {
  const browser = await chromium.launch();
  let hong = 0;
  for (const [ten, email, site] of CANH) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: RONG[0], height: 900 }, permissions: ["geolocation"], geolocation: { latitude: 16.04, longitude: 108.22, accuracy: 20 } });
    const page = await ctx.newPage();
    const duong = `${site === "gv" ? "/teacher" : "/admin"}/cham-cong/checkin?${Q}`;
    await login(page, { email, password: PASS, callbackUrl: site === "gv" ? "/teacher" : "/admin/dashboard", timeout: 120_000 });
    for (const w of RONG) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(duong, { waitUntil: "load" });
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(500);
      const t = await doTranNgang(page);
      await page.screenshot({ path: join(OUT, `${ten}-${w}.png`), fullPage: true });
      const nut = await page.getByRole("button", { name: "Chấm công", exact: true }).count();
      const duDoan = (await page.getByText(/^(Dự đoán:|Bạn vừa chấm)/).first().textContent()) ?? "";
      console.log(`${ten} ${w}px: tràn ${t.px}px · nút "Chấm công" ×${nut} · ${duDoan.trim()}`);
      if (t.px > 0 || nut !== 1) hong++;
    }
    if (BAM) {
      const u = await db.user.findFirstOrThrow({ where: { email }, select: { id: true } });
      const truoc = await db.staffTimeLog.count({ where: { userId: u.id } });
      const duDoan = (await page.getByText(/^(Dự đoán:|Bạn vừa chấm)/).first().textContent()) ?? "";
      await page.getByRole("button", { name: "Chấm công", exact: true }).click();
      await page.getByText(/^Đã ghi /).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${ten}-da-ghi-${RONG[RONG.length - 1]}.png`), fullPage: true });
      const moi = await db.staffTimeLog.findFirstOrThrow({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { direction: true } });
      const sau = await db.staffTimeLog.count({ where: { userId: u.id } });
      const khop = (moi.direction === "CHECK_IN") === /ghi VÀO/.test(duDoan);
      console.log(`${ten} BẤM: +${sau - truoc} lượt · ghi ${moi.direction} · dự đoán "${duDoan.trim()}" ⇒ ${khop ? "KHỚP" : "LỆCH"}`);
      if (!khop || sau - truoc !== 1) hong++;
    }
    await ctx.close();
  }
  await browser.close();
  console.log(hong ? `HỎNG ${hong}` : "XANH");
  if (hong) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
