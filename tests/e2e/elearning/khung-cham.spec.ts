/**
 * [KC-E2E-*] P8 · Khung chấm master-detail (thiết kế `QtKhungCham`): danh sách khung trái / trình dựng phải, chuyển khung, quyền, KÍCH HOẠT THẬT (DB).
 * Ảnh ở `E:\tmp\kc-shots` để so thiết kế — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/kc-shots";
const MA_A = "E2E-KC-NHAP";
const MA_B = "E2E-KC-ACTIVE";
let d: BoDuLieu;
let idA = "";
let idB = "";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

async function don() {
  await db.trnRubricCriterion.deleteMany({ where: { rubric: { code: { in: [MA_A, MA_B] } } } });
  await db.trnRubric.deleteMany({ where: { code: { in: [MA_A, MA_B] } } });
}

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await don();
  mkdirSync(ANH, { recursive: true });
  // Khung mang cơ sở của người học e2e: khung KHÔNG có cơ sở là bản ghi DÙNG CHUNG — chỉ quyền toàn cục mới kích hoạt được (`chanGhiBanGhiChung`).
  const cs = await db.trnEnrollment.findUniqueOrThrow({ where: { id: d.enrollmentId }, select: { centerId: true, orgUnitId: true } });
  const C = { centerId: cs.centerId as string, orgUnitId: cs.orgUnitId as string };
  const muc = [{ points: 0, label: "Chưa đạt" }, { points: 4, label: "Đạt" }];
  const a = await db.trnRubric.create({ data: { code: MA_A, title: "E2E Khung nháp", totalPoints: 4, passPoints: 4, status: "DRAFT", ownerUserId: d.daoTaoId, ...C }, select: { id: true } });
  await db.trnRubricCriterion.create({ data: { rubricId: a.id, label: "Mở đầu đúng kịch bản", weight: 100, orderIndex: 0, levelsJson: muc } });
  const b = await db.trnRubric.create({ data: { code: MA_B, title: "E2E Khung đã kích hoạt", totalPoints: 4, passPoints: 4, status: "ACTIVE", ownerUserId: d.daoTaoId, ...C }, select: { id: true } });
  await db.trnRubricCriterion.create({ data: { rubricId: b.id, label: "Ngôn ngữ phù hợp", weight: 100, orderIndex: 0, levelsJson: muc } });
  idA = a.id;
  idB = b.id;
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
const ds = (page: Page) => page.getByRole("region", { name: "Các khung chấm" });
const dung = (page: Page) => page.getByRole("region", { name: "Trình dựng khung" });

test("[KC-E2E-01] 🔴 master-detail: danh sách khung bên trái (mã + trạng thái Nháp/Kích hoạt), khung được chọn dựng bên phải; không tràn ngang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idA}`);
  await expect(page.getByRole("heading", { name: "Khung chấm", exact: true })).toBeVisible();
  await expect(ds(page).getByRole("link", { name: new RegExp(MA_A) })).toHaveAttribute("aria-current", "true");
  await expect(ds(page).getByRole("link", { name: new RegExp(MA_A) })).toContainText("Nháp");
  await expect(ds(page).getByRole("link", { name: new RegExp(MA_B) })).toContainText("Kích hoạt");
  await expect(dung(page).getByRole("textbox", { name: "Tên tiêu chí 1" })).toHaveValue("Mở đầu đúng kịch bản"); // bản nháp: tên tiêu chí là ô nhập mở sẵn
  await chup(page, "kc-master-detail");
  await khongTranNgang(page);
});

test("[KC-E2E-02] chuyển khung: bấm khung đã kích hoạt ⇒ URL ?id=, bên phải đổi sang tiêu chí của khung đó (đã đóng băng: không còn nút Kích hoạt)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idA}`);
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeVisible();
  await ds(page).getByRole("link", { name: new RegExp(MA_B) }).click();
  await expect(page).toHaveURL(new RegExp(`id=${idB}`));
  await expect(dung(page).getByText("Ngôn ngữ phù hợp")).toBeVisible();
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toHaveCount(0);
});

test("[KC-E2E-03] 🔴 người không có quyền soạn bị CHẶN (không thấy khung, không có trình dựng); id lạ ⇒ rơi về khung đầu, không lộ khung ngoài phạm vi", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/khung-cham");
  await expect(page.getByText(/elearning:content:author/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Trình dựng khung" })).toHaveCount(0);
  await vao(page, d.daoTaoEmail, "/elearning/khung-cham?id=khong-co-khung-nay");
  await expect(dung(page)).toBeVisible();
});

const tc = (page: Page, n: number) => dung(page).getByRole("region", { name: `Tiêu chí ${n}` });
const mucDb = async (rubricId: string) =>
  (await db.trnRubricCriterion.findMany({ where: { rubricId }, orderBy: { orderIndex: "asc" }, select: { label: true, levelsJson: true } })).map((c) => ({
    label: c.label,
    levels: c.levelsJson as { label: string; points: number }[],
  }));

test("[KC-E2E-03b] 🔴 trình dựng bản nháp: Ô NHẬP MỞ SẴN (không cần bấm 'Sửa'), đúng giá trị DB, dòng tổng 'khớp thang điểm', chưa sửa thì KHÔNG có nút Lưu", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idA}`);
  await expect(dung(page).getByLabel("Mã khung")).toHaveValue(MA_A);
  await expect(dung(page).getByLabel("Tên khung")).toHaveValue("E2E Khung nháp");
  await expect(dung(page).getByLabel("Thang điểm")).toHaveValue("4");
  await expect(tc(page, 1).getByRole("textbox", { name: "Tên tiêu chí 1" })).toHaveValue("Mở đầu đúng kịch bản");
  await expect(tc(page, 1).getByRole("textbox", { name: "Tên mức 2 (tiêu chí 1)" })).toHaveValue("Đạt");
  await expect(tc(page, 1).getByRole("textbox", { name: "Điểm của mức 2 (tiêu chí 1)" })).toHaveValue("4");
  await expect(dung(page).getByText("Tổng điểm các tiêu chí 4/4 — khớp thang điểm")).toBeVisible();
  await expect(dung(page).getByRole("button", { name: "Lưu tiêu chí" })).toHaveCount(0);
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeEnabled();
  await chup(page, "kc-nhap-mo-san");
  await khongTranNgang(page);
});

test("[KC-E2E-03c] 🔴 sửa tại ô: lỗi hiện NGAY tại ô (điểm không phải số nguyên · không tăng dần), tổng lệch nói bao nhiêu, 'Kích hoạt' khoá kèm LÝ DO; sửa đúng + Lưu ⇒ DB đổi, nút Lưu biến mất", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idA}`);
  const diem = tc(page, 1).getByRole("textbox", { name: "Điểm của mức 2 (tiêu chí 1)" });
  const ten = tc(page, 1).getByRole("textbox", { name: "Tên mức 2 (tiêu chí 1)" });
  await diem.fill("1.5");
  await expect(tc(page, 1).getByText(/số nguyên/)).toBeVisible();
  await expect(tc(page, 1).getByRole("button", { name: "Lưu tiêu chí" })).toBeDisabled();
  await diem.fill("0"); // bằng mức trước ⇒ không tăng dần
  await expect(tc(page, 1).getByText(/tăng dần/)).toBeVisible();
  await expect(tc(page, 1).getByRole("button", { name: "Lưu tiêu chí" })).toBeDisabled();
  await diem.fill("6");
  await expect(dung(page).getByText(/thừa 2 so với thang/)).toBeVisible();
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeDisabled();
  await expect(dung(page).getByText(/Còn thay đổi chưa lưu/)).toBeVisible();
  await diem.fill("4");
  await ten.fill("Đạt tốt");
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeDisabled(); // vẫn còn chưa lưu
  await tc(page, 1).getByRole("button", { name: "Lưu tiêu chí" }).click();
  // Chờ DB đổi THẬT trước: nút đổi nhãn thành "Đang lưu…" ngay khi bấm nên "đếm 0 nút Lưu tiêu chí" sẽ đạt quá sớm (khẳng định vắng mặt vội).
  await expect.poll(async () => (await mucDb(idA))[0]!.levels.map((m) => `${m.points}:${m.label}`), { timeout: 30_000 }).toEqual(["0:Chưa đạt", "4:Đạt tốt"]);
  await expect(tc(page, 1).getByRole("button", { name: "Lưu tiêu chí" })).toHaveCount(0, { timeout: 20_000 });
  await expect(tc(page, 1).getByRole("button", { name: "Hoàn tác" })).toHaveCount(0);
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeEnabled({ timeout: 20_000 });
});

test("[KC-E2E-03d] 🔴 thêm tiêu chí MỚI (lưu thật) ⇒ tổng lệch thang nên KHÔNG kích hoạt được; xoá bằng hai lần bấm ⇒ DB về 1 tiêu chí", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idA}`);
  await dung(page).getByRole("button", { name: "Thêm tiêu chí", exact: true }).click();
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeDisabled(); // còn khối mới chưa lưu
  await tc(page, 2).getByRole("textbox", { name: "Tên tiêu chí 2" }).fill("Tiêu chí thứ hai");
  await tc(page, 2).getByRole("button", { name: "Thêm tiêu chí vào khung" }).click();
  await expect.poll(async () => (await mucDb(idA)).length, { timeout: 20_000 }).toBe(2);
  expect((await mucDb(idA))[1]!.label).toBe("Tiêu chí thứ hai");
  await expect(dung(page).getByText(/thừa 10 so với thang/)).toBeVisible({ timeout: 20_000 });
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeDisabled();
  await expect(dung(page).getByText(/chưa khớp thang điểm/)).toBeVisible();
  await chup(page, "kc-them-tieu-chi");
  await tc(page, 2).getByRole("button", { name: "Xoá tiêu chí 2" }).click();
  await tc(page, 2).getByRole("button", { name: "Bấm lần nữa để xoá tiêu chí 2" }).click();
  await expect.poll(async () => (await mucDb(idA)).length, { timeout: 20_000 }).toBe(1);
  await expect(dung(page).getByRole("button", { name: "Kích hoạt khung" })).toBeEnabled({ timeout: 20_000 });
});

test("[KC-E2E-03e] 🔴 khung ĐÃ KÍCH HOẠT: không có ô nhập, không nút Lưu/Thêm/Xoá (đối chứng dương: tiêu chí vẫn được hiện)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idB}`);
  await expect(dung(page).getByText("Ngôn ngữ phù hợp")).toBeVisible();
  await expect(dung(page).getByText(/chỉ đọc/)).toBeVisible();
  await expect(dung(page).getByRole("textbox")).toHaveCount(0);
  await expect(dung(page).getByRole("button", { name: /Lưu|Thêm tiêu chí|Xoá/ })).toHaveCount(0);
});

test("[KC-E2E-04] 🔴 KÍCH HOẠT thật: bấm 'Kích hoạt khung' trên khung nháp ⇒ DB đổi sang ACTIVE và danh sách hiện 'Kích hoạt'", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/khung-cham?id=${idA}`);
  await dung(page).getByRole("button", { name: "Kích hoạt khung" }).click();
  await expect.poll(async () => (await db.trnRubric.findUniqueOrThrow({ where: { id: idA }, select: { status: true } })).status, { timeout: 20_000 }).toBe("ACTIVE");
  await expect(ds(page).getByRole("link", { name: new RegExp(MA_A) })).toContainText("Kích hoạt", { timeout: 20_000 });
});
