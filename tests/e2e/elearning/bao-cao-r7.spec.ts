/**
 * [R7-E2E-*] P8 · Hiệu quả đào tạo (thiết kế `QtHieuQua`): bố cục hai cột, "Đánh giá theo từng ca" dạng MA TRẬN người × L1–L4 từ phiếu THẬT (DB: lấy phiếu mới nhất),
 * ô chưa có phiếu là "—" (không phải 0), "Khai ngân sách" KHÔNG được vẽ (chưa có nơi lưu ngân sách — chờ Owner), quyền. Ảnh `E:\tmp\r7-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { seedUser } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/r7-shots";
const P = "e2e-el-r7-";
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  const ct = await db.trnProgram.findMany({ where: { title: { startsWith: "E2E_EL_R7_" } }, select: { id: true } });
  await db.trnEvaluationResult.deleteMany({ where: { programId: { in: ct.map((x) => x.id) } } });
  await db.trnProgram.deleteMany({ where: { id: { in: ct.map((x) => x.id) } } });
  const u = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  await db.user.deleteMany({ where: { id: { in: u.map((x) => x.id) } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  const cs = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const ct = await db.trnProgram.create({
    data: { code: "HR-2026-R7", year: 2026, seq: 9171, title: "E2E_EL_R7_CT", primaryFunctionTag: "HR", stageTag: "IN_SERVICE", durationTag: "S", natureTag: "OPTIONAL", formatTag: "ELEARNING", ownerUserId: d.daoTaoId, centerId: cs.centerId as string },
    select: { id: true },
  });
  const an = await seedUser({ email: `${P}an@satarobo.vn`, name: "E2E R7 An", role: "TEACHER" });
  const binh = await seedUser({ email: `${P}binh@satarobo.vn`, name: "E2E R7 Binh", role: "TEACHER" });
  const ghi = (userId: string, level: "L1" | "L2" | "L3" | "L4", ref: string, score: string | null, ngay: number) =>
    db.trnEvaluationResult.create({
      data: { programId: ct.id, level, subjectUserId: userId, sourceRef: ref, score, payloadJson: {}, recordedAt: new Date(Date.now() - ngay * 86_400_000), centerId: cs.centerId as string },
    });
  await ghi(an.id, "L2", "kt-cu", "9", 10); // cũ
  await ghi(an.id, "L2", "kt-moi", "11", 2); // mới nhất ⇒ ô L2 = 11
  await ghi(an.id, "L1", "ph-1", "4", 3);
  await ghi(an.id, "L3", "ql-1", null, 1); // phiếu KHÔNG có điểm ⇒ ô L3 vẫn "—"
  await ghi(binh.id, "L2", "kt-1", "0", 5); // điểm 0 là điểm thật
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

test("[R7-E2E-01] 🔴 ma trận 'Đánh giá theo từng ca': An (L1 4 · L2 11 là phiếu MỚI NHẤT · L3 '—' vì phiếu không có điểm · L4 '—') và Bình (L2 0 là điểm thật); không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r7");
  await expect(page.getByRole("heading", { name: "Hiệu quả đào tạo", exact: true })).toBeVisible();
  const an = page.getByRole("row", { name: /E2E R7 An/ });
  await expect(an).toBeVisible();
  const o = an.getByRole("cell");
  await expect(o.nth(0)).toContainText("4 phiếu");
  await expect(o.nth(1)).toHaveText("4"); // L1
  await expect(o.nth(2)).toHaveText("11"); // L2 mới nhất, không phải 9
  await expect(o.nth(3)).toHaveText("—"); // L3: phiếu không điểm
  await expect(o.nth(4)).toHaveText("—"); // L4: chưa có
  const binh = page.getByRole("row", { name: /E2E R7 Binh/ }).getByRole("cell");
  await expect(binh.nth(2)).toHaveText("0");
  await expect(binh.nth(1)).toHaveText("—");
  await expect(page.getByRole("columnheader", { name: "L3 quản lý" })).toBeVisible();
  await chup(page, "r7-hieu-qua");
  await khongTranNgang(page);
});

test("[R7-E2E-02] 🔴 chi phí: chưa khai ngân sách ⇒ MỘT DÒNG CHỮ (không phải 0đ); nút 'Khai ngân sách' KHÔNG được vẽ vì chưa có nơi lưu; không có câu so sánh nhóm", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/bao-cao-r7");
  await expect(page.getByText("Chưa khai ngân sách — không tính được chi phí/lượt.")).toBeVisible();
  await expect(page.getByText(/^0\s?đ$/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Khai ngân sách" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Khai ngân sách" })).toHaveCount(0);
  await expect(page.getByText(/nhóm đã học|chưa học/i)).toHaveCount(0);
});

test("[R7-E2E-03] 🔴 người học thuần bị CHẶN (không thấy phiếu của ai)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/bao-cao-r7");
  await expect(page.getByText(/elearning:progress:view-all/).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E R7 An/ })).toHaveCount(0);
});
