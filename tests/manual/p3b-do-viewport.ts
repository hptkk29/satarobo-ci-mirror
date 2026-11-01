// tests/manual/p3b-do-viewport.ts — ĐO THẬT bố cục P3b ở 320 → 7680px (Control Tower + Công việc của tôi).
// Chạy với `next start` trỏ DB đo riêng (`satarobo_p3b_ui`, đã nạp bằng `p3b-du-lieu-do.ts`):
//   BASE_URL=http://localhost:3200 UAT_PASSWORD=… OUT_DIR=… pnpm exec tsx tests/manual/p3b-do-viewport.ts
// Mật khẩu chỉ đọc từ env — không in ra.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { login } from "../e2e/_helpers/auth";
import { doTranNgang } from "../e2e/_helpers/tran-ngang";

const BASE = process.env.BASE_URL ?? "http://localhost:3200";
const PASS = process.env.UAT_PASSWORD ?? "";
const OUT = process.env.OUT_DIR ?? "p3b-shots";
// WIDTHS / TUAN / TAB_GV đặt qua env để đo lại một phần ma trận (vd. P4b: 375,768,1512,3840 trên tuần có bằng chứng).
const RONG = (process.env.WIDTHS ?? "320,375,768,1280,1920,3840,7680").split(",").map(Number);
const TUAN = process.env.TUAN ?? "2026-11-02";
const TAB_GV = (process.env.TAB_GV ?? "can-xac-nhan,sap-toi").split(",");
// P5d: đo thêm màn khác bằng "tên|đường dẫn" phân cách dấu phẩy — thay HẲN danh sách mặc định của phía đó khi đặt.
const URL_QL = process.env.URL_QL?.split(",").map((x) => x.split("|") as [string, string]) ?? null;
const URL_GV = process.env.URL_GV?.split(",").map((x) => x.split("|") as [string, string]) ?? null;
if (PASS.length < 8) throw new Error("thiếu UAT_PASSWORD");
mkdirSync(OUT, { recursive: true });

type KetQua = { man: string; rong: number; tranPx: number; thuPham: string; soCat: number; cat: string[]; moXuLy?: { tranPx: number } };

async function soCatChu(page: Page, chon: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const ra: string[] = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      for (const c of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
        const cs = getComputedStyle(c);
        if (c.children.length === 0 && c.scrollWidth > c.clientWidth + 1 && (cs.overflow === "hidden" || cs.textOverflow === "ellipsis")) {
          ra.push((c.textContent ?? "").trim().slice(0, 40));
        }
      }
    }
    return ra;
  }, chon);
}

async function do1(page: Page, man: string, url: string, kpi: string | null, moXuLy: boolean): Promise<KetQua[]> {
  const ra: KetQua[] = [];
  for (const w of RONG) {
    await page.setViewportSize({ width: w, height: w >= 3840 ? 2160 : 900 });
    // Không chờ "networkidle": khung admin / GV giữ một luồng SSE thông báo mở liên tục.
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(600);
    const t = await doTranNgang(page);
    const cat = kpi ? await soCatChu(page, kpi) : [];
    const k: KetQua = { man, rong: w, tranPx: t.px, thuPham: t.thuPham, soCat: cat.length, cat };
    await page.screenshot({ path: join(OUT, `${man}-${w}.png`) });
    if (moXuLy) {
      const nut = page.getByRole("button", { name: /^Xử lý/ }).first();
      if (await nut.count()) {
        await nut.click();
        k.moXuLy = { tranPx: (await doTranNgang(page)).px };
        await page.screenshot({ path: join(OUT, `${man}-xuly-${w}.png`) });
      }
    }
    ra.push(k);
    console.log(`${man} ${w}px: tràn ${t.px}px (${t.thuPham}) · chữ bị cắt ${cat.length}${k.moXuLy ? ` · mở Xử lý tràn ${k.moXuLy.tranPx}px` : ""}`);
  }
  return ra;
}

async function main() {
  const browser = await chromium.launch();
  const kq: KetQua[] = [];
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await login(page, { email: "uat.giamdoc@satarobo.vn", password: PASS, callbackUrl: "/admin/cham-cong/phan-cong", timeout: 120_000 });
    if (URL_QL) for (const [ten, url] of URL_QL) kq.push(...(await do1(page, ten, url, null, false)));
    else kq.push(...(await do1(page, "control-tower", `/admin/cham-cong/phan-cong?tuan=${TUAN}`, 'main a[href*="/cham-cong/phan-cong?"]', true)));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await login(page, { email: "uat.giaovien@satarobo.vn", password: PASS, callbackUrl: "/teacher/phan-cong", timeout: 120_000 });
    if (URL_GV) for (const [ten, url] of URL_GV) kq.push(...(await do1(page, ten, url, null, false)));
    else for (const tab of TAB_GV) kq.push(...(await do1(page, `gv-${tab}`, `/teacher/phan-cong?tab=${tab}`, null, false)));
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "ket-qua.json"), JSON.stringify(kq, null, 2));
  const hong = kq.filter((k) => k.tranPx > 0 || k.soCat > 0 || (k.moXuLy?.tranPx ?? 0) > 0);
  console.log(hong.length ? `HỎNG ${hong.length} lượt` : "XANH: không tràn ngang, không cắt số KPI ở mọi bề rộng");
  if (hong.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
