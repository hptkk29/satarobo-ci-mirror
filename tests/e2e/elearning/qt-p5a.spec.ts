/**
 * [QT-P5A-*] Soạn khoá: danh sách có tab + màn DUYỆT — HÀNH VI THẬT trong trình duyệt (Đào tạo đăng nhập).
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { db } from "../../../lib/db";
import { donKhoaDuyet, donLuotGiaoDaDong, dungKhoaDuyet, dungLuotGiaoDaDong, dungVongHoc, hanCuaGhiDanh, trangThaiBanCuaKhoa, type BoDuLieu, type BoKhoaDuyet } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
let k: BoKhoaDuyet;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  k = await dungKhoaDuyet(d);
  for (const email of [d.daoTaoEmail, d.hocVienEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(async () => {
  await donKhoaDuyet();
  await donLuotGiaoDaDong();
});

async function vao(page: Page, email: string, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  await page.goto(duongDan);
  await expect(page.locator("[data-elearning-theme]")).toBeVisible();
  // `nextjs-portal` = chỉ báo công cụ của `next dev` ("N · 1 Insight"), nổi đè lên nút ở khung 375px và chặn con trỏ. Chỉ có ở máy dev (CI chạy `next start`) — ẩn để ca kiểm ứng dụng, không kiểm công cụ dev.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

test.describe("[QT-P5A-01] Danh sách Soạn khoá có tab", () => {
  test("🔴 khoá có bản CHỜ DUYỆT hiện ở tab 'Chờ duyệt' (có nút 'Duyệt') và KHÔNG hiện ở 'Nháp'; khoá nháp hiện ở 'Nháp'", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/soan-khoa?tab=cho-duyet");
    await expect(page.getByRole("link", { name: k.tenDuyet })).toBeVisible();
    await expect(page.getByRole("link", { name: "Duyệt", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: k.tenNhap })).toHaveCount(0);
    await vao(page, d.daoTaoEmail, "/elearning/soan-khoa?tab=nhap");
    await expect(page.getByRole("link", { name: k.tenNhap })).toBeVisible();
    await expect(page.getByRole("link", { name: k.tenDuyet })).toHaveCount(0);
  });

  test("tab lạ ⇒ rơi về 'Tất cả' (không trang trắng); khoá đang phát hành có ở tab 'Đang phát hành'", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/soan-khoa?tab=khong-co");
    await expect(page.getByRole("link", { name: k.tenNhap })).toBeVisible();
    await vao(page, d.daoTaoEmail, "/elearning/soan-khoa?tab=phat-hanh");
    await expect(page.getByRole("link", { name: k.tenDuyet })).toBeVisible();
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/soan-khoa?tab=cho-duyet");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[QT-P5A-02] Màn duyệt", () => {
  test("hiện người gửi, bản, bài thêm / bài sửa so với bản đang phát hành; bài giữ nguyên KHÔNG bị liệt kê", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}/duyet`);
    await expect(page.getByRole("heading", { name: /E2E Khoá chờ duyệt — bản v1\.1/ })).toBeVisible();
    await expect(page.getByText("Người gửi duyệt")).toBeVisible();
    const khoiKhac = page.getByRole("region", { name: /So với bản đang phát hành/ });
    await expect(khoiKhac.getByText("E2E Bài mới thêm")).toBeVisible();
    await expect(khoiKhac.getByText("E2E Bài đã sửa")).toBeVisible();
    await expect(khoiKhac.getByText("E2E Bài giữ nguyên")).toHaveCount(0);
    // Bố cục theo thiết kế: nhãn loại thay đổi ở đầu dòng; "giữ nguyên" chỉ ĐẾM; có "Kiểm tra tự động" và khung "Quyết định" riêng.
    await expect(khoiKhac.getByText("thêm", { exact: true })).toBeVisible();
    await expect(khoiKhac.getByText("sửa", { exact: true })).toBeVisible();
    await expect(khoiKhac.getByText(/1 bài giữ nguyên/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Kiểm tra tự động" }).getByText(/Dàn bài hợp lệ/)).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Quyết định" }).getByRole("button", { name: "Duyệt", exact: true })).toBeVisible();
    await expect(page.getByText(/chưa tự xuất bản/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("🔴 MỞ TRÌNH SOẠN khi khoá đang chờ duyệt KHÔNG đẻ bản nháp; quay lại màn duyệt vẫn là bản chờ duyệt, còn nút Duyệt", async ({ page }) => {
    const truoc = (await trangThaiBanCuaKhoa(k.duyetId)).length;
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect((await trangThaiBanCuaKhoa(k.duyetId)).length).toBe(truoc);
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}/duyet`);
    await expect(page.getByRole("button", { name: "Duyệt", exact: true })).toBeVisible();
    await expect(page.getByText("Bản này còn là nháp")).toHaveCount(0);
  });

  test("🔴 Duyệt cần lý do (nút khoá tới khi có chữ); duyệt xong ⇒ APPROVED có approvedAt; rồi Xuất bản ⇒ PUBLISHED, không đẻ bản rỗng", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}/duyet`);
    const nutDuyet = page.getByRole("button", { name: "Duyệt", exact: true });
    await expect(nutDuyet).toBeDisabled();
    await page.getByLabel(/Lý do/).fill("Nội dung đã rà, đúng.");
    await expect(nutDuyet).toBeEnabled();
    await nutDuyet.click();
    await expect(async () => {
      const v = await trangThaiBanCuaKhoa(k.duyetId);
      expect(v.find((x) => x.minor === 1)?.status).toBe("APPROVED");
      expect(v.find((x) => x.minor === 1)?.approvedAt).not.toBeNull();
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Xuất bản" })).toBeVisible();
    await page.getByLabel(/Lý do/).fill("Phát hành đợt 18/11.");
    await page.getByRole("button", { name: "Xuất bản" }).click();
    await expect(async () => {
      const v = await trangThaiBanCuaKhoa(k.duyetId);
      expect(v.find((x) => x.minor === 1)?.status).toBe("PUBLISHED");
      expect(v.length).toBe(2);
    }).toPass({ timeout: 20_000 });
  });

  test("🔴 người học (không có quyền soạn) bị từ chối ở màn duyệt, không có nút Duyệt", async ({ page }) => {
    await vao(page, d.hocVienEmail, `/elearning/soan-khoa/${k.duyetId}/duyet`);
    await expect(page.getByText(/không có quyền|Không có quyền/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Duyệt", exact: true })).toHaveCount(0);
  });

  test("khoá không còn bản đang làm việc ⇒ nói rõ, không trang trắng", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k.duyetId}/duyet`); // v1.1 đã PUBLISHED ở ca trên
    await expect(page.getByText("Không có bản nào để duyệt")).toBeVisible();
  });
});

test.describe("[QT-P5B-01] Chi tiết lượt giao: chọn nhiều → gia hạn hàng loạt", () => {
  test("🔴 chọn tất cả → Gia hạn cần lý do ≥10 ký tự (nút khoá tới khi đủ); gia hạn xong hạn của người nhận LÙI ra sau", async ({ page }) => {
    const truoc = await hanCuaGhiDanh(d.enrollmentId);
    expect(truoc).not.toBeNull();
    await vao(page, d.daoTaoEmail, `/elearning/giao-bai/${d.assignmentId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("checkbox", { name: "Chọn tất cả người nhận đang hiển thị" }).click();
    await expect(page.getByText(/Đã chọn \d+ người nhận/)).toBeVisible();
    await page.getByRole("button", { name: "Gia hạn đã chọn" }).click();
    const nut = page.getByRole("button", { name: "Gia hạn", exact: true });
    await expect(nut).toBeDisabled();
    await page.getByLabel(/Lý do/).fill("ngắn");
    await expect(nut).toBeDisabled();
    await page.getByLabel(/Lý do/).fill("Sự cố hạ tầng kéo dài hai ngày");
    await expect(nut).toBeEnabled();
    await nut.click();
    await expect(async () => {
      expect(await hanCuaGhiDanh(d.enrollmentId)).toBeGreaterThan(truoc!);
    }).toPass({ timeout: 20_000 });
  });

  test("bố cục theo thiết kế: tên khoá ở dòng phụ, ba ô thống kê khớp bảng, avatar + thanh tiến độ từng người, 'Gia hạn cả lượt' chọn hết và mở form gia hạn", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/giao-bai/${d.assignmentId}`);
    const tk = page.getByRole("group", { name: "Thống kê lượt giao" }).or(page.locator('dl[aria-label="Thống kê lượt giao"]'));
    await expect(tk).toBeVisible();
    await expect(tk.getByText("Đã xong")).toBeVisible();
    await expect(tk.getByText("Trễ", { exact: true })).toBeVisible();
    await expect(tk.getByText("Đã thu hồi")).toBeVisible();
    // Người nhận duy nhất của lượt chưa học ⇒ Đã xong 0 · Trễ 0 · Thu hồi 0 (ba số khớp một dòng NOT_STARTED).
    await expect(tk.locator("dd")).toHaveText(["0", "0", "0"]);
    await expect(page.getByRole("progressbar").first()).toBeVisible();
    await page.getByRole("button", { name: "Gia hạn cả lượt" }).click();
    await expect(page.getByRole("group", { name: "Gia hạn đã chọn" })).toBeVisible();
    await expect(page.getByText(/Đã chọn \d+ người nhận/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("🔴 người học (không có quyền giao khoá) bị từ chối ở màn chi tiết lượt giao", async ({ page }) => {
    await vao(page, d.hocVienEmail, `/elearning/giao-bai/${d.assignmentId}`);
    await expect(page.getByText(/không có quyền|Không có quyền/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Gia hạn đã chọn" })).toHaveCount(0);
  });

  test("lượt giao không tồn tại ⇒ nói rõ, không trang trắng; không tràn ngang", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/giao-bai/khong-ton-tai");
    await expect(page.getByText("Không tìm thấy lượt giao")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[QT-P5B-02] Lượt giao: tab Đang mở / Đã đóng (suy từ ghi danh)", () => {
  test("🔴 lượt giao mà MỌI người đã xong nằm ở 'Đã đóng' kèm đạt/trễ và KHÔNG ở 'Đang mở'; lượt giao còn người đang học thì ngược lại", async ({ page }) => {
    const dong = await dungLuotGiaoDaDong(d);
    await vao(page, d.daoTaoEmail, "/elearning/luot-giao?tab=da-dong");
    await expect(page.getByRole("link", { name: dong.ten })).toBeVisible();
    await expect(page.getByText("Mọi người đã xong: 1 đạt · 0 trễ")).toBeVisible();
    await expect(page.getByRole("link", { name: /Giao khoá an toàn/ })).toHaveCount(0);
    await vao(page, d.daoTaoEmail, "/elearning/luot-giao?tab=dang-mo");
    await expect(page.getByRole("link", { name: /Giao khoá an toàn/ })).toBeVisible();
    await expect(page.getByRole("link", { name: dong.ten })).toHaveCount(0);
  });
});

test.describe("[QT-P5A-06] Trình soạn khoá (QtSoanKhoa) theo thiết kế — chỉ ĐỌC", () => {
  // Khoá RIÊNG của nhóm này: nhóm [QT-P5A-02] ở trên Duyệt + Xuất bản khoá dùng chung (đổi trạng thái), nên không thể dựa vào trạng thái của nó (luật 18: mỗi ca đứng một mình).
  let k2: BoKhoaDuyet;
  test.beforeAll(async () => {
    k2 = await dungKhoaDuyet(d);
  });

  test("hai cột: dàn bài có số thứ tự + mô tả + chip; 'Vòng đời khoá' đánh dấu ĐÚNG bước hiện tại (Chờ duyệt) và các bước khác không", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k2.duyetId}`);
    await expect(page.getByRole("heading", { name: /E2E Khoá chờ duyệt/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chương 1 · E2E Chương duyệt" })).toBeVisible();
    const dan = page.getByRole("region", { name: /Chương 1/ });
    const dong = dan.getByRole("listitem");
    await expect(dong).toHaveCount(3);
    await expect(dong.nth(0)).toContainText("E2E Bài giữ nguyên");
    await expect(dong.nth(0)).toContainText(/Bài đọc · ngưỡng đọc 1 phút/);
    await expect(dong.nth(0).getByLabel("bắt buộc")).toBeChecked();
    // Mỗi dòng có Lên/Xuống có nhãn (đường bàn phím); dòng đầu khoá "Lên", dòng cuối khoá "Xuống".
    await expect(dong.nth(0).getByRole("button", { name: "Đưa bài lên trên" })).toBeDisabled();
    await expect(dong.nth(2).getByRole("button", { name: "Đưa bài xuống dưới" })).toBeDisabled();
    await expect(dong.nth(1).getByRole("button", { name: "Đưa bài lên trên" })).toBeEnabled();

    const vongDoi = page.getByRole("complementary", { name: "Vòng đời khoá" });
    await expect(vongDoi.getByRole("listitem")).toHaveCount(4);
    await expect(vongDoi.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(vongDoi.locator('[aria-current="step"]')).toContainText("Chờ duyệt");
    // Đối chứng: bước khác KHÔNG được đánh dấu.
    await expect(vongDoi.getByRole("listitem").filter({ hasText: "Nháp" })).not.toHaveAttribute("aria-current", "step");
    // Khoá chờ duyệt ⇒ có Duyệt / Trả lại nháp, KHÔNG có Gửi duyệt (nút chỉ hiện khi trạng thái cho phép).
    await expect(vongDoi.getByRole("button", { name: "Duyệt", exact: true })).toBeVisible();
    await expect(vongDoi.getByRole("button", { name: "Gửi duyệt" })).toHaveCount(0);
    // Chưa nhập ghi chú ⇒ khoá (mọi thao tác vòng đời đòi ghi chú).
    await expect(vongDoi.getByRole("button", { name: "Duyệt", exact: true })).toBeDisabled();
    // Không có nút "Xem như người học" (chưa có route xem trước — không vẽ lời hứa suông).
    await expect(page.getByText("Xem như người học")).toHaveCount(0);
  });

  test("khoá nháp (chưa có bản): bước hiện tại là Nháp; không tràn ngang", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan-khoa/${k2.nhapId}`);
    const vongDoi = page.getByRole("complementary", { name: "Vòng đời khoá" });
    await expect(vongDoi.locator('[aria-current="step"]')).toContainText("Nháp");
    await expect(vongDoi.locator('[aria-current="step"]')).toContainText("đang ở đây");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[QT-P5A-07] Trình soạn bài đọc (QtSoanDoc) theo thiết kế — chỉ ĐỌC", () => {
  let k3: BoKhoaDuyet;
  let baiId = "";
  test.beforeAll(async () => {
    k3 = await dungKhoaDuyet(d);
    baiId = (await db.trnLesson.findFirstOrThrow({ where: { title: "E2E Bài giữ nguyên", module: { courseId: k3.duyetId } }, select: { id: true } })).id;
  });

  test("đầu trang (đường về 'Dàn bài' · tên bài · nút Lưu bài), hai khối Soạn / Xem trước, thanh định dạng 7 nút, dòng báo B-11 vì bài nằm trong bản đã xuất bản", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan/${baiId}`);
    await expect(page.getByRole("heading", { level: 1, name: "E2E Bài giữ nguyên" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dàn bài" })).toHaveAttribute("href", `/elearning/soan-khoa/${k3.duyetId}`);
    await expect(page.getByRole("button", { name: "Lưu bài" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Soạn" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Xem trước — đúng cách người học sẽ thấy" })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Định dạng Markdown" }).getByRole("button")).toHaveCount(7);
    await expect(page.getByText("Lưu sẽ tạo bản nháp mới")).toBeVisible();
    await expect(page.getByText(/Ngưỡng đọc của bài này:/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("🔴 thanh định dạng chèn đúng cú pháp vào ô soạn (không chỉ vẽ nút)", async ({ page }) => {
    await vao(page, d.daoTaoEmail, `/elearning/soan/${baiId}`);
    const o = page.getByLabel("Nội dung bài, định dạng Markdown");
    // Chờ HYDRATION thật: bản xem trước vẽ từ state React; `fill` trước hydration ghi vào DOM mà state vẫn giữ giá trị cũ (đã gặp ở b11-soan).
    await expect(async () => {
      await o.fill("abc");
      await expect(o).toHaveValue("abc", { timeout: 1_000 });
      await expect(page.getByRole("article")).toHaveText("abc", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    // Con trỏ ở cuối sau khi gõ ⇒ nút Đậm chèn cặp dấu ** tại đó.
    await page.getByRole("button", { name: "Đậm" }).click();
    await expect(o).toHaveValue("abc****");
    // Bản xem trước phản ánh nội dung (cùng bộ render với trang học).
    // Chờ giá trị CHÍNH XÁC trong ô rồi mới đọc xem trước: ngay sau `fill` có khoảnh khắc React vẽ bản xem trước của giá trị trung gian (thẻ `strong` lồng nhau — đã gặp ở cổng v5e).
    await expect(async () => {
      await o.fill("Xin **chào**");
      await expect(o).toHaveValue("Xin **chào**", { timeout: 1_000 });
      await expect(page.getByRole("article").locator("strong")).toHaveText("chào", { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("[QT-P5B-03] Giao khoá nội bộ — trình 4 bước theo thiết kế (KHÔNG bấm Xác nhận giao: không tạo dữ liệu)", () => {
  test("bước 1 → 2 → 3 → 4: đầu trang + Tóm tắt cập nhật theo lựa chọn; 'Tiếp' khoá khi thiếu khoá/hạn; Quay lại giữ lựa chọn", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/giao-bai");
    await expect(page.getByRole("heading", { level: 1, name: "Giao khoá nội bộ" })).toBeVisible();
    await expect(page.getByText("Bước 1 — chọn nội dung")).toBeVisible();
    const tomTat = page.getByRole("complementary", { name: "Tóm tắt" });
    // Chưa chọn khoá ⇒ Tiếp khoá (đối chứng của bước sau).
    await expect(tomTat.getByRole("button", { name: "Tiếp" })).toBeDisabled();
    await expect(tomTat.getByText("chọn ở bước 1")).toBeVisible();

    // Chờ hydration thật: chọn radio rồi chờ Tóm tắt (vẽ từ state React) hiện tên khoá.
    const khoa = page.getByRole("radio", { name: /E2E Khoá an toàn lao động/ });
    await expect(async () => {
      await khoa.check();
      await expect(tomTat.getByText("E2E Khoá an toàn lao động").first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(tomTat.getByRole("button", { name: "Tiếp" })).toBeEnabled();
    await tomTat.getByRole("button", { name: "Tiếp" }).click();

    await expect(page.getByText("Bước 2 — chọn người học")).toBeVisible();
    await tomTat.getByRole("button", { name: "Tiếp" }).click();
    await expect(page.getByText("Bước 3 — thời hạn")).toBeVisible();
    // Bước 3: kiểu hạn mặc định "ngày cụ thể" mà chưa chọn ngày ⇒ Tiếp khoá; chọn ngày ⇒ mở.
    await expect(tomTat.getByRole("button", { name: "Tiếp" })).toBeDisabled();
    await expect(tomTat.getByText("chọn ở bước 3")).toBeVisible();
    await page.getByLabel("Ngày giờ hạn chót").fill("2027-01-15T10:00");
    await expect(tomTat.getByRole("button", { name: "Tiếp" })).toBeEnabled();
    await tomTat.getByRole("button", { name: "Tiếp" }).click();

    await expect(page.getByText("Bước 4 — xác nhận")).toBeVisible();
    await expect(tomTat.getByRole("button", { name: "Xác nhận giao" })).toBeVisible();
    await expect(tomTat.getByText(/15\/0?1\/2027/)).toBeVisible();
    // Quay lại không mất lựa chọn.
    await tomTat.getByRole("button", { name: "Quay lại" }).click();
    await tomTat.getByRole("button", { name: "Quay lại" }).click();
    await tomTat.getByRole("button", { name: "Quay lại" }).click();
    await expect(page.getByText("Bước 1 — chọn nội dung")).toBeVisible();
    await expect(khoa).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("nút 'Lượt giao đã tạo' dẫn tới trang Lượt giao riêng (QtLuotGiao): đầu trang + hai tab + nút 'Giao khoá mới' quay lại trình giao", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/giao-bai");
    const lien = page.getByRole("link", { name: "Lượt giao đã tạo" });
    await expect(lien).toHaveAttribute("href", "/elearning/luot-giao");
    await lien.click();
    await expect(page).toHaveURL(/\/elearning\/luot-giao$/);
    await expect(page.getByRole("heading", { level: 1, name: "Lượt giao" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Giao khoá mới" })).toHaveAttribute("href", "/elearning/giao-bai");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("🔴 bước 2: xem trước liệt kê người khớp có ô chọn; bỏ chọn một người ⇒ 'đã chọn' giảm 1 và Tóm tắt đổi theo; 'Chọn tất cả' trả lại (KHÔNG giao: không tạo dữ liệu)", async ({ page }) => {
    await vao(page, d.daoTaoEmail, "/elearning/giao-bai");
    const tomTat = page.getByRole("complementary", { name: "Tóm tắt" });
    const khoa = page.getByRole("radio", { name: /E2E Khoá an toàn lao động/ });
    await expect(async () => {
      await khoa.check();
      await expect(tomTat.getByText("E2E Khoá an toàn lao động").first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await tomTat.getByRole("button", { name: "Tiếp" }).click();
    await expect(page.getByText("Bước 2 — chọn người học")).toBeVisible();
    // Chưa xem trước ⇒ nói thẳng.
    await expect(page.getByText("Chưa xem trước")).toBeVisible();
    // Luật rỗng = "chưa chọn điều kiện nào" ⇒ không có ai. Chọn "Đang làm" (chờ hydration thật bằng toPass: tick rồi thấy ô được tick).
    const dangLam = page.getByRole("checkbox", { name: "Đang làm" });
    await expect(async () => {
      await dangLam.check();
      await expect(dangLam).toBeChecked({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("button", { name: "Xem trước danh sách" }).click();
    const tieuDe = page.getByText(/^Xem trước · \d+ người khớp$/);
    await expect(tieuDe).toBeVisible({ timeout: 15_000 });
    const n = Number((await tieuDe.textContent())!.match(/\d+/)![0]);
    expect(n).toBeGreaterThan(0);
    await expect(page.getByText(`đã chọn ${n}`)).toBeVisible();
    // Bỏ chọn người đầu tiên.
    await page.getByRole("checkbox", { name: /^Bỏ / }).first().uncheck();
    await expect(page.getByText(`đã chọn ${n - 1}`)).toBeVisible();
    await expect(tomTat.getByText(new RegExp(`^${n - 1} người · tập tĩnh$`))).toBeVisible();
    await page.getByRole("button", { name: `Chọn tất cả ${n} người` }).click();
    await expect(page.getByText(`đã chọn ${n}`)).toBeVisible();
  });
});
