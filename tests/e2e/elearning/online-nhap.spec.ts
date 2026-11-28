/**
 * [QO-06] QoImport — nhập câu hỏi Online từ Excel, trình duyệt THẬT + Postgres thật.
 * Tải mẫu · chọn tệp · kết quả kiểm theo dòng (hợp lệ/lỗi/dạng chưa hỗ trợ) · nhập · câu vào đúng khoá · người không có quyền bị từ chối (đối chứng dương: Đào tạo vào được).
 */
import { mkdirSync } from "node:fs";
import * as XLSX from "xlsx";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { taoKhoa } from "../../../lib/elearning-online/khoa-hoc";
import { donBangOnl } from "../../elearning/_onl-don";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/onl-shots";
let d: BoDuLieu;
let courseId = "";
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  d = await dungVongHoc();
  await donBangOnl(db);
  const t = await taoKhoa(db, { code: `E2E-NCH-${Date.now().toString(36).toUpperCase()}`, name: "E2E Nhập câu hỏi", listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
  if (!t.ok) throw new Error(t.thongBao);
  courseId = t.courseId;
  mkdirSync(ANH, { recursive: true });
  for (const email of [d.daoTaoEmail, d.hocVienEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(async () => {
  await donBangOnl(db);
});

async function vao(page: Page, email: string, duongDan: string) {
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

/** Tệp thử: 3 dòng chọn một (1 hợp lệ · 1 một-lựa-chọn · 1 đáp án lạ) + 2 đúng/sai (1 hợp lệ · 1 sai giá trị) + sheet "Dạng lạ" (tên không thuộc dạng nào ⇒ bỏ qua) + HUONG-DAN. */
function taoTepThu(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Đề bài", "A", "B", "C", "D", "E", "F", "Đáp án đúng", "Điểm", "Giải thích"],
    ["Thuật toán bám tường trái chọn hướng nào?", "Rẽ trái", "Rẽ phải", "", "", "", "", "A", "2", "Bám tường trái"],
    ["Chỉ một lựa chọn", "Chỉ A", "", "", "", "", "", "A", "", ""],
    ["Đáp án lạ", "X", "Y", "", "", "", "", "C", "", ""],
  ]), "Chọn một đáp án");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Đề bài", "Đáp án", "Điểm", "Giải thích"], ["Robot rẽ khi cách tường 5 cm", "Đúng", "", ""], ["Robot rẽ khi cách tường 9 cm", "Có", "", ""]]), "Đúng sai");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Đề bài", "Vế trái 1"], ["Ghép cảm biến", "x"]]), "Dạng lạ");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Quy tắc"]]), "HUONG-DAN");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("[QO-06a] Đào tạo: trang nhập mở được, nút 'Nhập từ Excel' có ở tab Kiểm tra & thi, bộ mẫu tải được", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/online/khoa/${courseId}?tab=kiem-tra`);
  const lien = page.getByRole("link", { name: "Nhập từ Excel" });
  await expect(lien).toBeVisible();
  await lien.click();
  await expect(page).toHaveURL(/\/nhap-cau-hoi$/);
  await expect(page.getByRole("heading", { level: 1, name: "Import câu hỏi từ Excel" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Các bước" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("row", { name: /Chọn một đáp án/ })).toBeVisible(); // dạng hỗ trợ
  await expect(page.getByText(/ghép cặp/i).first()).toBeVisible(); // dạng mở rộng cũng có hàng trong bảng
  // Bộ mẫu: tải thật qua cùng phiên, là .xlsx hợp lệ có đủ 13 sheet dạng câu + HUONG-DAN.
  const r = await page.request.get("/api/elearning/online/mau-nhap-cau-hoi");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("spreadsheetml");
  const wb = XLSX.read(await r.body(), { type: "buffer" });
  expect(wb.SheetNames).toEqual(["Chọn một đáp án", "Chọn nhiều đáp án", "Đúng sai", "Trả lời ngắn", "Tự luận", "Điền vào chỗ trống", "Ghép cặp", "Sắp xếp thứ tự", "Phân loại", "Chọn trên hình", "Nhập số", "Nộp sản phẩm", "Kéo thả khối lệnh", "HUONG-DAN"]);
  await chup(page, "qo-import-trang");
});

test("[QO-06b] chọn tệp ⇒ kiểm theo dòng: 2 hợp lệ · 3 lỗi (đúng thông báo, đúng số dòng) · sheet tên lạ báo BỎ QUA · chưa nhập gì vào DB", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/online/khoa/${courseId}/nhap-cau-hoi`);
  // Chờ hydration thật: chọn tệp bằng toPass cho tới khi kết quả hiện.
  await expect(async () => {
    await page.locator("#nch-tep").setInputFiles({ name: "cau-hoi-thu.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: taoTepThu() });
    await expect(page.getByTestId("nch-tong")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("nch-tong")).toHaveText("5");
  await expect(page.getByTestId("nch-hop-le")).toHaveText("2");
  await expect(page.getByTestId("nch-loi")).toHaveText("3");
  // Bảng (≥ sm) hoặc danh sách thẻ (< sm): chỉ MỘT trong hai đang hiện — kiểm phần tử HIỆN.
  const hien = (t: string) => page.getByText(t, { exact: true }).locator("visible=true");
  await expect(hien("● Câu chọn một cần ít nhất 2 lựa chọn")).toBeVisible();
  await expect(hien("● Chọn đúng MỘT đáp án thuộc các lựa chọn")).toBeVisible();
  await expect(hien("● Đáp án phải là Đúng hoặc Sai")).toBeVisible();
  await expect(hien("● Hợp lệ").first()).toBeVisible(); // đối chứng dương: dòng hợp lệ cũng hiện
  await expect(page.getByRole("note")).toContainText("Dạng lạ"); // sheet không đúng tên dạng nào ⇒ nói thẳng là bỏ qua
  await expect(page.getByRole("button", { name: "Nhập 2 câu hợp lệ" })).toBeEnabled();
  expect(await db.onlQuestion.count({ where: { courseId } }), "bước kiểm KHÔNG ghi gì").toBe(0);
  await chup(page, "qo-import-ket-qua");
});

test("[QO-06c] bỏ chọn 'bỏ qua dòng lỗi' ⇒ nút Nhập khoá (còn lỗi); chọn lại ⇒ nhập 2 câu hợp lệ vào ĐÚNG khoá; câu hiện ở ngân hàng câu hỏi", async ({ page }) => {
  await vao(page, d.daoTaoEmail, `/elearning/online/khoa/${courseId}/nhap-cau-hoi`);
  await expect(async () => {
    await page.locator("#nch-tep").setInputFiles({ name: "cau-hoi-thu.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: taoTepThu() });
    await expect(page.getByTestId("nch-tong")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  const nut = page.getByRole("button", { name: /^Nhập \d+ câu hợp lệ$/ });
  await page.getByLabel(/Bỏ qua dòng lỗi/).uncheck();
  await expect(nut).toBeDisabled(); // còn 3 dòng lỗi mà không cho bỏ qua
  await page.getByLabel(/Bỏ qua dòng lỗi/).check();
  await expect(nut).toBeEnabled(); // đối chứng dương: cùng trạng thái, chọn bỏ qua ⇒ nhập được
  await nut.click();
  await expect(page.getByRole("status").filter({ hasText: "Đã nhập 2 câu" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "bỏ qua 3 dòng lỗi" })).toBeVisible();
  const ds = await db.onlQuestion.findMany({ where: { courseId }, orderBy: { createdAt: "asc" } });
  expect(ds.map((c) => c.type).sort()).toEqual(["SINGLE_CHOICE", "TRUE_FALSE"]);
  expect(ds.find((c) => c.type === "SINGLE_CHOICE")!.answerKeyJson).toEqual({ correct: "A" });
  expect(ds.find((c) => c.type === "TRUE_FALSE")!.answerKeyJson).toEqual({ correct: true });
  const nhatKy = await db.auditLog.findFirst({ where: { entityId: courseId, action: "CREATE", entityType: "OnlQuestion" }, orderBy: { createdAt: "desc" } });
  expect(nhatKy, "việc nhập có nhật ký").not.toBeNull();
  expect(JSON.stringify(nhatKy!.newValues ?? {}), "nhật ký không chép đáp án").not.toContain("Bám tường");
  await chup(page, "qo-import-xong");
  // câu hiện ở ngân hàng câu hỏi của khoá
  await page.goto(`/elearning/online/khoa/${courseId}?tab=kiem-tra`);
  await expect(page.getByText("Thuật toán bám tường trái chọn hướng nào?")).toBeVisible();
});

test("[QO-06d] 🔴 ranh giới: người học không vào được trang nhập và không tải được mẫu; Đào tạo (đối chứng) vào được cả hai", async ({ page }) => {
  await vao(page, d.hocVienEmail, `/elearning/online/khoa/${courseId}/nhap-cau-hoi`);
  await expect(page.getByText(/không có quyền/i).first()).toBeVisible();
  await expect(page.locator("#nch-tep")).toHaveCount(0);
  const r = await page.request.get("/api/elearning/online/mau-nhap-cau-hoi");
  expect(r.status()).toBe(403);
  await vao(page, d.daoTaoEmail, `/elearning/online/khoa/${courseId}/nhap-cau-hoi`);
  await expect(page.locator("#nch-tep")).toBeVisible();
  expect((await page.request.get("/api/elearning/online/mau-nhap-cau-hoi")).status()).toBe(200);
});
