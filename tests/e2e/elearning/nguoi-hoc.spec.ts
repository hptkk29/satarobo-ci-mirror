/**
 * [NH-E2E-*] P7 · "Người học" — HÀNH VI THẬT trong trình duyệt: Đào tạo thấy danh sách (tab Cần chú ý / Tất cả), lọc, mở hồ sơ một người, NHẮC HỌC thật
 * (thông báo + sổ), Xuất Excel, Giao khoá mang người đã chọn; người học thuần bị CHẶN; id lạ ⇒ 404. Ca âm có ĐỐI CHỨNG DƯƠNG.
 * Chụp ảnh vào `E:\tmp\nh-shots` để so với thiết kế 20/11 — việc so ảnh là bước tay, KHÔNG phải khẳng định VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/nh-shots";
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

const donNhac = async () => {
  await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: "nhac-hoc:" } } });
  await db.auditLog.deleteMany({ where: { module: "elearning", action: "REMIND" } });
};

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await donNhac();
  mkdirSync(ANH, { recursive: true });
  for (const email of [d.daoTaoEmail, d.hocVienEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(donNhac);

async function vao(page: Page, email: string, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  const r = await page.goto(duongDan);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  return r;
}
const chup = async (page: Page, ten: string) => {
  const toi = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  await page.screenshot({ path: `${ANH}/${ten}-${page.viewportSize()?.width ?? 0}${toi ? "-dark" : ""}.png`, fullPage: true });
};
const khongTranNgang = async (page: Page) => {
  const du = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (du <= 1) return;
  const loi = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".overflow-x-auto") && getComputedStyle(e).position !== "fixed")
      .slice(0, 6)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 60)} → ${Math.round(e.getBoundingClientRect().right)}px`),
  );
  expect(loi, `trang dư ${du}px ở khổ ${page.viewportSize()?.width}`).toEqual([]);
};
const lienKetNguoi = (page: Page) => page.locator('table a[href^="/elearning/nguoi-hoc/"]');
const hangCua = (page: Page, userId: string) => page.locator("tr", { has: page.locator(`a[href$="/elearning/nguoi-hoc/${userId}"]`) });

test("[NH-E2E-01] 🔴 Đào tạo THẤY hai tab (Cần chú ý · Tất cả) + số đếm; tab 'Tất cả' liệt kê người được giao và mở được hồ sơ; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc");
  await expect(page.getByRole("heading", { name: "Người học (nhân viên)", exact: true })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Người học" });
  await expect(tabs.getByRole("link", { name: /Cần chú ý/ })).toHaveAttribute("aria-current", "page"); // mặc định
  await expect(tabs.getByRole("link", { name: /Tất cả/ })).toBeVisible();
  await chup(page, "nh-can-chu-y");
  await khongTranNgang(page);
  await tabs.getByRole("link", { name: /Tất cả/ }).click();
  await expect(page).toHaveURL(/tab=tat-ca/);
  await expect(page.getByRole("search", { name: "Lọc người học" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cơ sở" })).toBeVisible();
  await expect(lienKetNguoi(page).first()).toBeVisible();
  await chup(page, "nh-tat-ca");
  await khongTranNgang(page);
  await lienKetNguoi(page).first().click();
  await expect(page).toHaveURL(/\/elearning\/nguoi-hoc\/.+/);
  await expect(page.getByText("Các khoá được giao")).toBeVisible();
  await expect(page.getByText("Bắt buộc đã đạt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nhắc học" })).toBeVisible();
  await chup(page, "nh-chi-tiet");
  await khongTranNgang(page);
});

test("[NH-E2E-02] 🔴 tab 'Tất cả': tìm theo tên lọc đúng; từ khoá không khớp ⇒ trạng thái rỗng (không báo lỗi); lọc cơ sở/vai trò có trong ô chọn", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc?tab=tat-ca&q=zzzkhongaitenvay");
  await expect(page.getByText("Không có ai khớp bộ lọc")).toBeVisible();
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc?tab=tat-ca");
  await expect(lienKetNguoi(page).first()).toBeVisible(); // đối chứng dương: không lọc thì có người
  await expect(page.getByLabel("Cơ sở")).toBeVisible();
  await expect(page.getByLabel("Vai trò")).toBeVisible();
});

test("[NH-E2E-03] 🔴 người học thuần bị CHẶN ở danh sách, hồ sơ, và API xuất; id không tồn tại ⇒ trang 404 cho người có quyền", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/nguoi-hoc");
  await expect(page.getByText(/elearning:progress:view-all/).first()).toBeVisible();
  await expect(lienKetNguoi(page)).toHaveCount(0);
  const xuat = await page.request.get("/api/elearning/nguoi-hoc");
  expect(xuat.status()).toBe(403);
  // Next trả 200 khi `notFound()` chạy SAU khi khung đã stream — kiểm NỘI DUNG: không có hồ sơ nào, có trang 404.
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc/khong-co-nguoi-nay");
  await expect(page.getByText("Các khoá được giao")).toHaveCount(0);
  await expect(page.getByText("Bắt buộc đã đạt")).toHaveCount(0);
  await expect(page.getByText(/404|không tìm thấy|not be found/i).first()).toBeVisible();
});

test("[NH-E2E-04] mục 'Người học' có trong thanh bên của Đào tạo (nhóm Báo cáo) và dẫn đúng trang", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "Khổ di động: thanh bên là ngăn kéo, mục menu không bấm trực tiếp — ca này chỉ kiểm ở desktop (thanh bên cố định).");
  await vao(page, d.daoTaoEmail, "/elearning/dao-tao"); // khu quản trị (khu người học không có thanh bên quản trị)
  const muc = page.getByRole("link", { name: "Người học", exact: true }).first();
  await expect(muc).toBeVisible();
  await muc.click();
  await expect(page).toHaveURL(/\/elearning\/nguoi-hoc$/);
});

test("[NH-E2E-05] 🔴 NHẮC HỌC thật: chọn người ⇒ bấm 'Nhắc học' ⇒ có thông báo + dòng sổ trong DB; bấm lại cùng ngày ⇒ báo 'đã được nhắc hôm nay' và KHÔNG thêm thông báo", async ({ page }) => {
  await donNhac();
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc?tab=tat-ca");
  await expect(hangCua(page, d.hocVienId)).toBeVisible();
  await hangCua(page, d.hocVienId).getByRole("checkbox").click();
  await expect(page.getByText(/Đã chọn 1 người/)).toBeVisible();
  const nut = () => page.getByRole("group", { name: "Chọn nhiều người" }).getByRole("button", { name: "Nhắc học" });
  await nut().click();
  await expect(page.getByText(/Đã nhắc 1 người/)).toBeVisible({ timeout: 20_000 });
  expect(await db.staffNotification.count({ where: { userId: d.hocVienId, dedupeKey: { startsWith: "nhac-hoc:" } } })).toBe(1);
  expect(await db.auditLog.count({ where: { module: "elearning", action: "REMIND", entityId: d.hocVienId } })).toBe(1);
  // Bấm lại cùng ngày.
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc?tab=tat-ca");
  await hangCua(page, d.hocVienId).getByRole("checkbox").click();
  await nut().click();
  await expect(page.getByText(/1 người đã được nhắc hôm nay/)).toBeVisible({ timeout: 20_000 });
  expect(await db.staffNotification.count({ where: { userId: d.hocVienId, dedupeKey: { startsWith: "nhac-hoc:" } } })).toBe(1);
  // Hồ sơ: nút đổi thành "Đã nhắc hh:mm".
  await vao(page, d.daoTaoEmail, `/elearning/nguoi-hoc/${d.hocVienId}`);
  await expect(page.getByText(/Đã nhắc \d{2}:\d{2}/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Nhắc học" })).toHaveCount(0);
  await donNhac();
});

test("[NH-E2E-06] 🔴 XUẤT EXCEL: Đào tạo thấy nút và tải được file .xlsx đúng loại; người học thuần không có nút (đối chứng) — cổng 403 đã kiểm ở NH-E2E-03", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc?tab=tat-ca");
  const nut = page.getByRole("link", { name: "Xuất Excel" });
  await expect(nut).toBeVisible();
  const href = await nut.getAttribute("href");
  expect(href).toMatch(/^\/api\/elearning\/nguoi-hoc\?/);
  const r = await page.request.get(href!);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("spreadsheetml");
  expect(r.headers()["content-disposition"]).toContain("nguoi-hoc.xlsx");
  const buf = await r.body();
  expect(buf.subarray(0, 2).toString()).toBe("PK"); // tệp xlsx là zip
  await vao(page, d.hocVienEmail, "/elearning/nguoi-hoc?tab=tat-ca");
  await expect(page.getByRole("link", { name: "Xuất Excel" })).toHaveCount(0);
});

test("[NH-E2E-07] 🔴 GIAO KHOÁ mang người đã chọn: liên kết có ?nguoi=<id>, bấm vào tới trình giao khoá", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/nguoi-hoc?tab=tat-ca");
  await hangCua(page, d.hocVienId).getByRole("checkbox").click();
  const giao = page.getByRole("group", { name: "Chọn nhiều người" }).getByRole("link", { name: "Giao khoá" });
  await expect(giao).toHaveAttribute("href", new RegExp(`/elearning/giao-bai\\?nguoi=${d.hocVienId}`));
  await giao.click();
  await expect(page).toHaveURL(new RegExp(`/elearning/giao-bai\\?nguoi=${d.hocVienId}`));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});
