/**
 * [TDH-E2E-*] P7 · Tự động hoá theo thiết kế 20/11: danh sách (bảng Khi/Thì + nhật ký) → trang Khai luật mới (chạy thử CHỈ ĐỌC, lưu luôn ở trạng thái TẮT)
 * → trang Soạn lộ trình. Người học thuần bị chặn (đối chứng dương: Đào tạo thấy). Chụp ảnh vào `E:\tmp\td-shots` để so thiết kế — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/td-shots";
const MA_LUAT = "E2E-TD-LUAT";
const MA_LO = "E2E-TD-LOTRINH";
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

const don = async () => {
  await db.trnAutomationRule.deleteMany({ where: { code: MA_LUAT } });
  await db.trnLearningPath.deleteMany({ where: { code: MA_LO } });
};

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
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
test.afterAll(don);

async function vao(page: Page, email: string, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  await page.goto(duongDan);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}
const chup = async (page: Page, ten: string) => {
  const toi = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  await page.screenshot({ path: `${ANH}/${ten}-${page.viewportSize()?.width ?? 0}${toi ? "-dark" : ""}.png`, fullPage: true });
};

test("[TDH-E2E-01] 🔴 danh sách: Đào tạo THẤY hai nút (Khai luật mới · Soạn lộ trình) dẫn tới trang riêng; người học thuần bị CHẶN và không có nút", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/tu-dong-hoa");
  await expect(page.getByRole("heading", { name: "Tự động hoá", exact: true })).toBeVisible();
  await expect(page.getByText("Luật mới luôn lưu ở trạng thái tắt")).toBeVisible();
  await chup(page, "td-danh-sach");
  await expect(page.getByRole("link", { name: "Khai luật mới" })).toHaveAttribute("href", "/elearning/tu-dong-hoa/luat");
  await expect(page.getByRole("link", { name: "Soạn lộ trình" })).toHaveAttribute("href", "/elearning/tu-dong-hoa/lo-trinh");
  await vao(page, d.hocVienEmail, "/elearning/tu-dong-hoa");
  await expect(page.getByRole("link", { name: "Khai luật mới" })).toHaveCount(0);
  await vao(page, d.hocVienEmail, "/elearning/tu-dong-hoa/luat");
  await expect(page.getByText(/elearning:program:manage/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Lưu luật/ })).toHaveCount(0);
});

test("[TDH-E2E-02] 🔴 KHAI LUẬT thật: chạy thử (chỉ đọc) hiện kết quả; lưu ⇒ luật có trong DB ở trạng thái TẮT, về danh sách thấy Đang tắt", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/tu-dong-hoa/luat");
  await expect(page.getByRole("heading", { name: "Khai luật mới", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Kết quả chạy thử" })).toBeVisible();
  const truocNhatKy = await db.trnAutomationLog.count();
  await page.getByRole("button", { name: /Chạy thử trên dữ liệu 7 ngày/ }).click();
  await expect(page.getByRole("complementary", { name: "Kết quả chạy thử" }).getByText(/sẽ thi hành|Không có ai thuộc mốc/)).toBeVisible({ timeout: 20_000 });
  expect(await db.trnAutomationLog.count()).toBe(truocNhatKy); // chạy thử KHÔNG ghi nhật ký
  await chup(page, "td-luat-moi");
  await page.getByLabel("Mã luật").fill(MA_LUAT);
  await page.getByLabel("Tên luật").fill("E2E nhân sự mới → giao khoá");
  await page.getByLabel("Khoá cần giao").selectOption({ value: d.courseId });
  await page.getByLabel(/Lý do khai luật/).fill("Kiểm thử e2e: khai luật qua trang riêng");
  await page.getByRole("button", { name: /Lưu luật/ }).click();
  await expect(page).toHaveURL(/\/elearning\/tu-dong-hoa$/, { timeout: 20_000 });
  const r = await db.trnAutomationRule.findFirstOrThrow({ where: { code: MA_LUAT }, select: { enabled: true, trigger: true } });
  expect(r.enabled).toBe(false);
  await expect(page.getByRole("row", { name: new RegExp(MA_LUAT) })).toContainText("Đang tắt");
  await expect(page.getByRole("row", { name: new RegExp(MA_LUAT) })).toContainText("Nhân sự mới vào làm");
});

test("[TDH-E2E-03] 🔴 SOẠN LỘ TRÌNH thật: thêm khoá, lưu ⇒ có trong DB với một bước, về danh sách thấy lộ trình", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/tu-dong-hoa/lo-trinh");
  await expect(page.getByRole("heading", { name: "Soạn lộ trình", exact: true })).toBeVisible();
  await page.getByLabel("Mã lộ trình").fill(MA_LO);
  await page.getByLabel("Tên lộ trình").fill("E2E lộ trình");
  await page.getByLabel("Chọn khoá để thêm vào lộ trình").selectOption({ value: d.courseId });
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await page.getByLabel(/Lý do soạn/).fill("Kiểm thử e2e: soạn lộ trình qua trang riêng");
  await chup(page, "td-lo-trinh");
  await page.getByRole("button", { name: "Lưu lộ trình" }).click();
  await expect(page).toHaveURL(/\/elearning\/tu-dong-hoa$/, { timeout: 20_000 });
  const lt = await db.trnLearningPath.findFirstOrThrow({ where: { code: MA_LO }, select: { _count: { select: { steps: true } } } });
  expect(lt._count.steps).toBe(1);
  await expect(page.getByText("E2E lộ trình")).toBeVisible();
});
