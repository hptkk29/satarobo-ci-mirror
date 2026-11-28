/**
 * [MG-E2E-*] P8 · Mức gắn đánh giá master-detail (thiết kế `QtMucDanhGia`): bảng chương trình trái / bảng đổi phải, chọn bằng ?id=, lỗi thiếu điều kiện nói TRƯỚC,
 * LƯU THẬT (DB), quyền, id lạ. Cần cờ ELEARNING_EVAL_LINK_ENABLED=true cho server e2e (đã bơm ở `playwright.elearning.config.ts`).
 * Ảnh ở `E:\tmp\mg-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/mg-shots";
const P = "E2E_EL_MG_";
let d: BoDuLieu;
let idA = ""; // chưa có cấu hình ⇒ Chỉ báo cáo
let idB = ""; // đã LINKED 60/40
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const ct = await db.trnProgram.findMany({ where: { title: { startsWith: P } }, select: { id: true } });
  const ids = ct.map((x) => x.id);
  await db.trnEvalLinkConfig.deleteMany({ where: { programId: { in: ids } } });
  await db.trnProgram.deleteMany({ where: { id: { in: ids } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  const cs = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const mk = (seq: number, ten: string) =>
    db.trnProgram.create({
      data: { code: `HR-2026-MG${seq}`, year: 2026, seq, title: `${P}${ten}`, primaryFunctionTag: "HR", stageTag: "IN_SERVICE", durationTag: "S", natureTag: "OPTIONAL", formatTag: "ELEARNING", ownerUserId: d.daoTaoId, centerId: cs.centerId as string },
      select: { id: true },
    });
  idA = (await mk(9101, "An toàn lao động 2026")).id;
  idB = (await mk(9102, "Tư vấn tuyển sinh")).id;
  await db.trnEvalLinkConfig.create({
    data: {
      programId: idB,
      mode: "LINKED",
      criteria: ["ON_TIME", "EXAM_SCORE"],
      weightOnTime: 60,
      weightExamScore: 40,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      decisionDocCode: "SR.QD.231/PL-01",
      decisionDocEffectiveAt: new Date("2025-12-01T00:00:00.000Z"),
      hrApprovedByUserId: d.daoTaoId,
      centerId: cs.centerId as string,
    },
  });
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
const khongTranNgang = async (page: Page) => {
  const du = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(du, `trang dư ${du}px ở khổ ${page.viewportSize()?.width}`).toBeLessThanOrEqual(1);
};
const bang = (page: Page) => page.getByRole("region", { name: "Chương trình và mức gắn" });
const doi = (page: Page) => page.getByRole("region", { name: "Đổi mức gắn" });
const dong = (page: Page, ten: string) => bang(page).getByRole("row", { name: new RegExp(ten) });

test("[MG-E2E-01] 🔴 bảng bên trái: tên + mã, chế độ (Chỉ báo cáo / Có liên kết), trọng số '60 / 40' hoặc '—'; chưa chọn thì bên phải nói 'Chọn một chương trình'; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/muc-danh-gia");
  await expect(page.getByRole("heading", { name: "Mức gắn đánh giá", exact: true })).toBeVisible();
  await expect(dong(page, "An toàn lao động 2026")).toContainText("Chỉ báo cáo");
  await expect(dong(page, "An toàn lao động 2026")).toContainText("—");
  await expect(dong(page, "Tư vấn tuyển sinh")).toContainText("Có liên kết");
  await expect(dong(page, "Tư vấn tuyển sinh")).toContainText("60 / 40");
  await expect(doi(page).getByText("Chọn một chương trình")).toBeVisible();
  await expect(doi(page).getByRole("radio")).toHaveCount(0);
  await chup(page, "mg-danh-sach");
  await khongTranNgang(page);
});

test("[MG-E2E-02] 🔴 bấm 'Đổi' ⇒ ?id=, bảng bên phải MỞ SẴN đúng giá trị DB (radio 'Có liên kết', trọng số 60/40, số hiệu quyết định); 'Thôi' ⇒ về danh sách", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/muc-danh-gia");
  await bang(page).getByRole("link", { name: "Đổi mức gắn của E2E_EL_MG_Tư vấn tuyển sinh" }).click();
  await expect(page).toHaveURL(new RegExp(`id=${idB}`));
  await expect(doi(page).getByRole("heading", { name: /Đổi mức gắn · .*Tư vấn tuyển sinh/ })).toBeVisible();
  await expect(doi(page).getByRole("radio", { name: "Có liên kết với đánh giá tháng" })).toBeChecked();
  await expect(doi(page).getByLabel("Trọng số của tiêu chí hoàn thành đúng hạn")).toHaveValue("60");
  await expect(doi(page).getByLabel("Trọng số của tiêu chí điểm kiểm tra")).toHaveValue("40");
  await expect(doi(page).getByPlaceholder("vd: SR.QD.231/PL-01")).toHaveValue("SR.QD.231/PL-01");
  await expect(dong(page, "Tư vấn tuyển sinh")).toHaveAttribute("aria-current", "true");
  await chup(page, "mg-doi-lien-ket");
  await khongTranNgang(page);
  await doi(page).getByRole("button", { name: "Thôi" }).click();
  await expect(page).toHaveURL(/\/elearning\/muc-danh-gia$/);
  await expect(doi(page).getByText("Chọn một chương trình")).toBeVisible();
});

test("[MG-E2E-03] 🔴 chọn 'Có liên kết' cho chương trình chưa cấu hình: NÓI TRƯỚC còn thiếu gì (sáu điều kiện), Lưu khoá; chuyển về 'Chỉ báo cáo' thì chỉ còn thiếu lý do", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/muc-danh-gia?id=${idA}`);
  await expect(doi(page).getByRole("radio", { name: "Chỉ báo cáo (mặc định)" })).toBeChecked();
  await doi(page).getByRole("radio", { name: "Có liên kết với đánh giá tháng" }).check();
  await expect(doi(page).getByText(/Còn thiếu: .*số hiệu quyết định/)).toBeVisible();
  await expect(doi(page).getByText(/tổng trọng số phải bằng 100/)).toBeVisible();
  await doi(page).getByLabel(/Lý do/).fill("Thử lý do đủ dài để kiểm");
  await expect(doi(page).getByRole("button", { name: "Lưu", exact: true })).toBeDisabled(); // còn thiếu điều kiện dù đã có lý do
  await doi(page).getByRole("radio", { name: "Chỉ báo cáo (mặc định)" }).check();
  await expect(doi(page).getByText(/Còn thiếu:/)).toHaveCount(0);
  await expect(doi(page).getByRole("button", { name: "Lưu", exact: true })).toBeEnabled();
});

test("[MG-E2E-04] 🔴 LƯU THẬT: đặt chương trình B về 'Chỉ báo cáo' kèm lý do ⇒ DB đổi mode, bảng bên trái hiện 'Chỉ báo cáo' và '—'; lý do ngắn (<10) bị chặn", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/muc-danh-gia?id=${idB}`);
  await doi(page).getByRole("radio", { name: "Chỉ báo cáo (mặc định)" }).check();
  await doi(page).getByLabel(/Lý do/).fill("ngắn");
  await expect(doi(page).getByRole("button", { name: "Lưu", exact: true })).toBeDisabled(); // lý do < 10 ký tự
  await doi(page).getByLabel(/Lý do/).fill("Tạm dừng gắn lương để rà soát lại tiêu chí");
  await doi(page).getByRole("button", { name: "Lưu", exact: true }).click();
  await expect.poll(async () => (await db.trnEvalLinkConfig.findUniqueOrThrow({ where: { programId: idB }, select: { mode: true } })).mode, { timeout: 30_000 }).toBe("REPORT_ONLY");
  await expect(page).toHaveURL(/\/elearning\/muc-danh-gia$/, { timeout: 20_000 });
  await expect(dong(page, "Tư vấn tuyển sinh")).toContainText("Chỉ báo cáo", { timeout: 20_000 });
  await expect(dong(page, "Tư vấn tuyển sinh")).toContainText("—");
});

test("[MG-E2E-05] 🔴 người học thuần bị CHẶN (không thấy bảng, không có bảng đổi); id lạ ⇒ 'Không tìm thấy chương trình này' và KHÔNG dựng form", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/muc-danh-gia");
  await expect(page.getByText(/elearning:program:manage/).first()).toBeVisible();
  await expect(bang(page)).toHaveCount(0);
  await expect(doi(page)).toHaveCount(0);
  await vao(page, d.daoTaoEmail, "/elearning/muc-danh-gia?id=khong-co-chuong-trinh-nay");
  await expect(doi(page).getByText("Không tìm thấy chương trình này")).toBeVisible();
  await expect(doi(page).getByRole("radio")).toHaveCount(0);
});
