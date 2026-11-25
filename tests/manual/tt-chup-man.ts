// tests/manual/tt-chup-man.ts — CHỤP + ĐO giao diện hồ sơ buổi (tuân thủ buổi dạy) trên trình duyệt thật: thẻ Chấm công (site GV),
// Công việc của tôi (tab Hôm nay + Đã qua), Control Tower tuần trước (QLCS), Công parttime tháng (QLCS) — ở mọi bề ngang trong WIDTHS.
// Chỉ chạy trên DB đo local `satarobo_p3b_ui` (đã nạp `ctx-du-lieu-do.ts` + `tt-du-lieu-do.ts`), `next start` ở BASE_URL.
//   DATABASE_URL=…/satarobo_p3b_ui BASE_URL=http://localhost:3200 UAT_PASSWORD=… Q=<w=…&t=…> OUT_DIR=… TUAN=YYYY-MM-DD THANG=YYYY-MM
//     pnpm exec tsx tests/manual/tt-chup-man.ts
// Mật khẩu / vé chỉ đọc từ env — không in ra. KHÔNG bấm gì ghi dữ liệu (chỉ mở màn).
import "../../scripts/_cho-phep-server-only";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { laDbCucBo } from "@/lib/security/url-db-cuc-bo";
import { login } from "../e2e/_helpers/auth";
import { doTranNgang } from "../e2e/_helpers/tran-ngang";

const URL = process.env.DATABASE_URL ?? "";
if (!laDbCucBo(URL) || !URL.includes("satarobo_p3b_ui")) throw new Error("Chỉ chạy trên DB đo local satarobo_p3b_ui");
const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const PASS = process.env.UAT_PASSWORD ?? "";
const Q = process.env.Q ?? "";
const OUT = process.env.OUT_DIR ?? "tt-shots";
const TUAN = process.env.TUAN ?? "";
const THANG = process.env.THANG ?? "";
const RONG = (process.env.WIDTHS ?? "375,768,1512").split(",").map(Number);
if (PASS.length < 8 || !Q || !TUAN || !THANG) throw new Error("thiếu UAT_PASSWORD / Q / TUAN / THANG");
mkdirSync(OUT, { recursive: true });

type Man = { ten: string; duong: string; cho: (p: Page) => Promise<unknown>; mong: RegExp[]; cam?: RegExp[] };

async function chup(page: Page, ds: Man[]): Promise<number> {
  let hong = 0;
  for (const m of ds) {
    for (const w of RONG) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(m.duong, { waitUntil: "load" });
      await m.cho(page);
      await page.waitForTimeout(400);
      const t = await doTranNgang(page);
      await page.screenshot({ path: join(OUT, `${m.ten}-${w}.png`), fullPage: true });
      const chu = (await page.locator("main").first().innerText().catch(() => "")) || (await page.locator("body").innerText());
      const thieu = m.mong.filter((r) => !r.test(chu)).map(String);
      const lo = (m.cam ?? []).filter((r) => r.test(chu)).map(String);
      console.log(`${m.ten} ${w}px: tràn ${t.px}px${t.px ? ` (${t.thuPham})` : ""} · thiếu [${thieu.join(" | ")}] · cấm-lộ [${lo.join(" | ")}]`);
      if (t.px > 0 || thieu.length || lo.length) hong++;
    }
  }
  return hong;
}

const h1 = (p: Page) => p.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
const TIEN = [/\d{1,3}\.\d{3}\s?đ/, /phạt/i];

async function main() {
  const browser = await chromium.launch();
  let hong = 0;
  const ctxGv = await browser.newContext({ baseURL: BASE, viewport: { width: RONG[0], height: 900 }, permissions: ["geolocation"], geolocation: { latitude: 16.04, longitude: 108.22, accuracy: 20 } });
  const gv = await ctxGv.newPage();
  await login(gv, { email: "uat.giaovien@satarobo.vn", password: PASS, callbackUrl: "/teacher", timeout: 120_000 });
  hong += await chup(gv, [
    {
      ten: "gv-cham-cong",
      duong: `/teacher/cham-cong/checkin?${Q}`,
      cho: h1,
      mong: [/Cần điểm danh học viên/, /Điểm danh học viên: 0\/9/, /Điểm danh lớp/],
      cam: [/Chấm vào lớp|Chấm ra lớp/, ...TIEN],
    },
    { ten: "gv-hom-nay", duong: "/teacher/phan-cong?tab=hom-nay", cho: h1, mong: [/Điểm danh 0\/9/, /Điểm danh lớp/, /Hồ sơ buổi/], cam: TIEN },
    { ten: "gv-da-qua", duong: "/teacher/phan-cong?tab=da-qua", cho: h1, mong: [/Điểm danh 8\/9/, /Nhận xét 5\/7/, /Nhận xét học viên/], cam: TIEN },
  ]);
  await gv.goto(`/teacher/cham-cong/checkin?${Q}`, { waitUntil: "load" });
  await h1(gv);
  const nut = await gv.getByRole("button", { name: "Chấm công", exact: true }).count();
  console.log(`thẻ chấm công: nút "Chấm công" ×${nut}`);
  if (nut !== 1) hong++;
  await ctxGv.close();

  const ctxQl = await browser.newContext({ baseURL: BASE, viewport: { width: RONG[0], height: 900 } });
  const ql = await ctxQl.newPage();
  await login(ql, { email: "uat.giamdoc@satarobo.vn", password: PASS, callbackUrl: "/admin/dashboard", timeout: 120_000 });
  hong += await chup(ql, [
    {
      ten: "ql-control-tower",
      duong: `/admin/cham-cong/phan-cong?tuan=${TUAN}`,
      cho: h1,
      mong: [/Điểm danh 8\/9/, /Nhận xét 5\/7/, /Tuân thủ buổi dạy trong tuần/],
      // QLCS không điểm danh / nhận xét hộ ⇒ không có lối tắt.
      cam: [/Điểm danh lớp/, /Nhận xét học viên$/m, ...TIEN],
    },
    { ten: "ql-thang", duong: `/admin/cham-cong/phan-cong/thang?thang=${THANG}`, cho: h1, mong: [/Tuân thủ buổi dạy trong tháng/, /Mẫu số điểm danh/] },
  ]);
  await ctxQl.close();
  await browser.close();
  console.log(hong ? `HỎNG ${hong}` : "XANH");
  if (hong) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
