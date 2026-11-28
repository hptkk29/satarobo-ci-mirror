/**
 * [NV-P2-*] Màn nhân viên P2 — HÀNH VI THẬT trong trình duyệt. Chạy ở ba project (desktop · 375px · tối).
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: "không thấy X" luôn đạt nếu trang trắng.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import {
  dungChungNhanTheoTab,
  dungThongBaoTheoTab,
  dungKhoaTheoTab,
  dungVongHoc,
  type BoChungNhan,
  type BoThongBao,
  type BoDuLieu,
  type BoKhoaTheoTab,
} from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
let k: BoKhoaTheoTab;
let cn: BoChungNhan;
let tb: BoThongBao;
let cookieHocVien: Awaited<ReturnType<BrowserContext["cookies"]>>;
let cookieDaoTao: Awaited<ReturnType<BrowserContext["cookies"]>>;

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  k = await dungKhoaTheoTab(d);
  cn = await dungChungNhanTheoTab(d, k);
  tb = await dungThongBaoTheoTab(d);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, { email: d.hocVienEmail, callbackUrl: "/elearning" });
  await expect(p).toHaveURL(/\/elearning/);
  cookieHocVien = await ctx.cookies();
  await ctx.close();
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, { email: d.daoTaoEmail, callbackUrl: "/elearning" });
  await expect(p2).toHaveURL(/\/elearning/);
  cookieDaoTao = await ctx2.cookies();
  await ctx2.close();
});

async function vao(page: Page, duongDan: string, cookies = cookieHocVien) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
  await page.goto(duongDan);
  await expect(page.locator("[data-elearning-theme]")).toBeVisible();
}

const lienKetKhoa = (page: Page, ten: string) => page.getByRole("link", { name: ten, exact: false }).first();

test.describe("[NV-P2-01] Khoá của tôi — ba tab có URL riêng", () => {
  test("?tab=can-lam: có khoá cần làm; KHÔNG có khoá quá hạn / đã xong", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tab=can-lam");
    await expect(lienKetKhoa(page, k.tenCanLam)).toBeVisible(); // đối chứng dương
    await expect(page.getByRole("link", { name: k.tenQuaHan })).toHaveCount(0);
    await expect(page.getByRole("link", { name: k.tenDaXong })).toHaveCount(0);
  });

  test("?tab=qua-han: có khoá quá hạn + dải báo đúng due-lock; KHÔNG có nút 'Học ngay' (Q6 chưa chốt)", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tab=qua-han");
    await expect(lienKetKhoa(page, k.tenQuaHan)).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Đã quá hạn — liên hệ Đào tạo để được gia hạn");
    await expect(page.getByText("Học ngay")).toHaveCount(0);
    await expect(page.getByRole("link", { name: k.tenCanLam })).toHaveCount(0);
  });

  test("?tab=da-xong: có khoá đã xong, cột 'Hoàn thành'", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tab=da-xong");
    await expect(lienKetKhoa(page, k.tenDaXong)).toBeVisible();
    await expect(page.getByRole("link", { name: k.tenQuaHan })).toHaveCount(0);
  });

  test("liên kết CŨ ?tt= vẫn đúng: qua-han → tab quá hạn; hoan-thanh → tab đã xong; tat-ca → cần làm", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tt=qua-han");
    await expect(lienKetKhoa(page, k.tenQuaHan)).toBeVisible();
    await page.goto("/elearning/khoa-cua-toi?tt=hoan-thanh");
    await expect(lienKetKhoa(page, k.tenDaXong)).toBeVisible();
    await page.goto("/elearning/khoa-cua-toi?tt=tat-ca");
    await expect(lienKetKhoa(page, k.tenCanLam)).toBeVisible();
  });

  test("tab 'ma' do người dùng gõ rơi về mặc định, không trang trắng", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tab=khong-co-tab-nay");
    await expect(lienKetKhoa(page, k.tenCanLam)).toBeVisible();
  });

  test("tìm một khoá nằm ở tab KHÁC: tab đang mở trống nhưng nói rõ nó ở tab nào (không phải 'không có')", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tab=can-lam&q=hoan+thanh");
    await expect(page.getByText("nhưng có ở tab khác")).toContainText("Đã xong (1)");
    // đối chứng dương: bấm sang tab đó thì thấy khoá, giữ nguyên ô tìm
    await page.getByRole("link", { name: /Đã xong/ }).first().click();
    await expect(lienKetKhoa(page, k.tenDaXong)).toBeVisible();
  });

  test("không tràn ngang", async ({ page }) => {
    for (const tab of ["can-lam", "qua-han", "da-xong"]) {
      await vao(page, `/elearning/khoa-cua-toi?tab=${tab}`);
      const tran = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(tran, tab).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("[NV-P2-02] Đề cương khoá", () => {
  test("khoá đang học: có thẻ bên (người giao, tiến độ 'n trên m') và mô tả loại bài; KHÔNG có ổ khoá/'Học tuần tự' (Q7 chưa chốt)", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}`);
    const the = page.getByRole("complementary", { name: "Thông tin khoá" });
    await expect(the).toBeVisible();
    await expect(the).toContainText("Người giao");
    await expect(the).toContainText(/\d+ trên \d+ bài bắt buộc/);
    await expect(page.getByText(/Bài đọc · đọc tối thiểu \d+ phút/).first()).toBeVisible();
    await expect(page.getByText("Học tuần tự")).toHaveCount(0);
    await expect(page.getByText("Chưa mở", { exact: true })).toHaveCount(0);
  });

  test("khoá đã xong + có gia hạn: dải 'hoàn thành ngày' và 'đã được gia hạn đến … Lý do'; KHÔNG có câu 'tiến độ không bị tính lại'", async ({ page }) => {
    await vao(page, `/elearning/hoc/${k.enrollmentDaXongId}`);
    await expect(page.getByText(/Bạn đã hoàn thành khoá ngày \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(page.getByText(/đã được gia hạn đến .*Lý do: Sự cố hệ thống ngày 01\/11/)).toBeVisible();
    await expect(page.getByText("không bị tính lại")).toHaveCount(0);
    await expect(page.getByText("Xem lại bài kiểm tra")).toHaveCount(0);
  });

  test("khoá quá hạn: lời khoá đúng due-lock, không 'Học ngay'", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi?tab=qua-han");
    await page.getByRole("link", { name: k.tenQuaHan }).first().click();
    await expect(page.getByText("Khoá đã quá hạn. Liên hệ phòng Đào tạo nếu cần gia hạn.")).toBeVisible();
    await expect(page.getByText("Học ngay")).toHaveCount(0);
  });

  test("🔴 người khác mở lượt của mình ⇒ trang 'Không mở được khoá này' (đối chứng dương: chủ mở được ở ca đầu)", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}`, cookieDaoTao);
    await expect(page.getByText("Không mở được khoá này")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Thông tin khoá" })).toHaveCount(0);
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, `/elearning/hoc/${d.enrollmentId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[NV-P2-03] Chứng nhận của tôi + trang xem", () => {
  test("danh sách: có 'Xem', nhãn 'Hết hạn sau 15 ngày', liên kết 'Khoá học lại đã có'; KHÔNG thấy chứng nhận của người khác", async ({ page }) => {
    await vao(page, "/elearning/chung-nhan-cua-toi");
    await expect(page.getByText(cn.maSapHet)).toBeVisible(); // đối chứng dương
    await expect(page.getByText("Hết hạn sau 15 ngày")).toBeVisible();
    await expect(page.getByRole("link", { name: "Xem", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Khoá học lại đã có trong Khoá của tôi" })).toHaveAttribute(
      "href",
      `/elearning/hoc/${cn.enrollmentHocLaiId}`,
    );
    await expect(page.getByText(cn.maNguoiKhac)).toHaveCount(0);
  });

  test("trang xem chứng nhận của mình: số hiệu, khoá, ngày cấp, QR, nút tải PDF", async ({ page }) => {
    await vao(page, `/elearning/chung-nhan-cua-toi/${encodeURIComponent(cn.maSapHet)}`);
    const the = page.getByRole("article", { name: "Chứng nhận" });
    await expect(the).toContainText(cn.maSapHet);
    await expect(the).toContainText("E2E Khoá đã hoàn thành");
    await expect(the).toContainText("Còn hiệu lực");
    await expect(page.getByRole("img", { name: "Mã QR tra cứu chứng nhận" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tải bản PDF" })).toHaveAttribute("href", /\/api\/elearning\/chung-nhan\?id=/);
  });

  test("🔴 A không xem được chứng nhận của B (số hiệu thật của B) — cùng câu với số hiệu không tồn tại", async ({ page }) => {
    await vao(page, `/elearning/chung-nhan-cua-toi/${encodeURIComponent(cn.maNguoiKhac)}`);
    await expect(page.getByText("Không mở được chứng nhận này")).toBeVisible();
    await expect(page.getByRole("article", { name: "Chứng nhận" })).toHaveCount(0);
    await page.goto("/elearning/chung-nhan-cua-toi/SR.CN.KHONG.TON.TAI");
    await expect(page.getByText("Không mở được chứng nhận này")).toBeVisible();
    // đối chứng dương: chính B mở được số hiệu của mình
    await vao(page, `/elearning/chung-nhan-cua-toi/${encodeURIComponent(cn.maNguoiKhac)}`, cookieDaoTao);
    await expect(page.getByRole("article", { name: "Chứng nhận" })).toContainText(cn.maNguoiKhac);
  });

  test("PDF: chủ tải được (200, application/pdf); người khác tải chứng nhận của B bị từ chối", async ({ page }) => {
    await vao(page, `/elearning/chung-nhan-cua-toi/${encodeURIComponent(cn.maSapHet)}`);
    const href = await page.getByRole("link", { name: "Tải bản PDF" }).getAttribute("href");
    const ok = await page.request.get(href!);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("application/pdf");
    expect(ok.headers()["content-disposition"]).toContain(cn.maSapHet);
    // id chứng nhận của B (lấy từ phiên của B) — người học gọi thẳng route
    await vao(page, `/elearning/chung-nhan-cua-toi/${encodeURIComponent(cn.maNguoiKhac)}`, cookieDaoTao);
    const hrefB = await page.getByRole("link", { name: "Tải bản PDF" }).getAttribute("href");
    await vao(page, "/elearning/chung-nhan-cua-toi");
    const chan = await page.request.get(hrefB!);
    expect(chan.status()).toBeGreaterThanOrEqual(400);
    expect(chan.headers()["content-type"] ?? "").not.toContain("application/pdf");
  });

  test("đề cương khoá đã xong có nút 'Xem chứng nhận' dẫn tới trang xem", async ({ page }) => {
    await vao(page, `/elearning/hoc/${k.enrollmentDaXongId}`);
    await page.getByRole("link", { name: "Xem chứng nhận" }).click();
    await expect(page).toHaveURL((u) => u.pathname.endsWith(encodeURIComponent(cn.maSapHet)));
    await expect(page.getByRole("article", { name: "Chứng nhận" })).toBeVisible();
  });

  test("không tràn ngang (danh sách + trang xem)", async ({ page }) => {
    for (const u of ["/elearning/chung-nhan-cua-toi", `/elearning/chung-nhan-cua-toi/${encodeURIComponent(cn.maSapHet)}`]) {
      await vao(page, u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), u).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("[NV-P2-04] Dữ liệu của tôi + Chính sách", () => {
  test("bảng tiến độ có cột Khoá (tên khoá dưới tên bài), 'đọc … · cuộn …' và dòng tổng; giữ khối 'Yêu cầu về dữ liệu'", async ({ page }) => {
    await vao(page, "/elearning/du-lieu-cua-toi");
    // `visible=true`: bảng (≥721px) và danh sách gọn (≤720px) cùng nằm trong HTML, CSS chỉ hiện một.
    await expect(page.getByText("Đã đọc 2 phút").locator("visible=true").first()).toBeVisible(); // 150 giây ⇒ 2 phút (dòng tổng)
    await expect(page.getByText(`${k.tenDaXong} — bài 1`).locator("visible=true").first()).toBeVisible();
    await expect(page.getByText(k.tenDaXong, { exact: true }).locator("visible=true").first()).toBeVisible(); // tên khoá
    await expect(page.getByText(/đọc 2 phút · cuộn 100%/).locator("visible=true").first()).toBeVisible();
    await expect(page.getByText("Yêu cầu về dữ liệu của bạn")).toBeVisible();
  });

  test("🔴 chỉ thấy dữ liệu của MÌNH: tài khoản khác không thấy bài của người học (đối chứng dương ở ca trên)", async ({ page }) => {
    await vao(page, "/elearning/du-lieu-cua-toi", cookieDaoTao);
    await expect(page.getByRole("heading", { name: "Dữ liệu của tôi" })).toBeVisible();
    await expect(page.getByText(`${k.tenDaXong} — bài 1`)).toHaveCount(0);
  });

  test("liên kết sang trang chính sách; trang chính sách nói phạm vi thu + phiên bản, KHÔNG bịa ngày hiệu lực", async ({ page }) => {
    await vao(page, "/elearning/du-lieu-cua-toi");
    await page.getByRole("link", { name: /^(Xem chính sách|Xem và xác nhận)$/ }).click();
    await expect(page).toHaveURL(/\/elearning\/du-lieu-cua-toi\/chinh-sach/);
    await expect(page.getByRole("heading", { name: "Chính sách theo dõi học tập" })).toBeVisible();
    await expect(page.getByText("Hệ thống ghi nhận những gì")).toBeVisible();
    await expect(page.getByText(/Bản đang hiệu lực: v\d+/)).toBeVisible();
    await expect(page.getByText(/ngày hiệu lực/i)).toHaveCount(0);
    // hoặc đã xác nhận, hoặc có nút xác nhận — luôn đúng MỘT trong hai
    const daXacNhan = page.getByText(/Bạn đã xác nhận bản/);
    const nut = page.getByRole("button", { name: /^Tôi xác nhận bản/ });
    await expect(daXacNhan.or(nut).first()).toBeVisible();
  });

  test("không tràn ngang", async ({ page }) => {
    for (const u of ["/elearning/du-lieu-cua-toi", "/elearning/du-lieu-cua-toi/chinh-sach"]) {
      await vao(page, u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), u).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("[NV-P2-05] Tìm kiếm", () => {
  test("biểu tượng tìm trên thanh trên đưa tới /tim-kiem; tìm KHÔNG DẤU ra khoá có dấu và tô đậm đúng chữ", async ({ page }) => {
    await vao(page, "/elearning");
    // Thiết kế: thanh trên chỉ có BIỂU TƯỢNG tìm (không có ô nhập); ô nhập nằm ở trang Tìm kiếm.
    await page.getByRole("link", { name: "Tìm trong khoá của tôi" }).click();
    await expect(page).toHaveURL(/\/elearning\/tim-kiem$/);
    const o = page.getByRole("searchbox", { name: "Tìm khoá, bài học, chứng nhận" });
    await o.fill("hoan thanh");
    await o.press("Enter");
    await expect(page).toHaveURL(/\/elearning\/tim-kiem\?q=hoan\+thanh/);
    await expect(page.getByRole("link", { name: new RegExp(k.tenDaXong) }).first()).toBeVisible();
    await expect(page.locator("mark").first()).toHaveText(/hoàn thành/i);
  });

  test("tab Bài học có URL riêng và đếm; bài hiện kèm tên khoá; bấm vào mở bài/đề cương", async ({ page }) => {
    await vao(page, "/elearning/tim-kiem?tab=bai&q=bai+1");
    const bai = page.getByRole("link", { name: new RegExp(`${k.tenDaXong} — bài 1`) }).first();
    await expect(bai).toBeVisible();
    await expect(page.getByRole("link", { name: /^Bài học/ }).first()).toHaveAttribute("aria-current", "page");
    await bai.click();
    await expect(page).toHaveURL(new RegExp(`/elearning/hoc/${k.enrollmentDaXongId}`));
  });

  test("tab Chứng nhận tìm theo tên khoá của chứng nhận và dẫn tới trang xem", async ({ page }) => {
    await vao(page, "/elearning/tim-kiem?tab=chung-nhan&q=hoan+thanh");
    await page.getByRole("link", { name: new RegExp(k.tenDaXong) }).first().click();
    await expect(page.getByRole("article", { name: "Chứng nhận" })).toBeVisible();
  });

  test("🔴 chỉ tìm của MÌNH: tài khoản khác tìm 'qua han' không ra khoá quá hạn của người học (đối chứng dương: chính người học tìm ra)", async ({ page }) => {
    // Khoá "quá hạn" chỉ được giao cho người học; tài khoản Đào tạo không có lượt nào của khoá này.
    await vao(page, "/elearning/tim-kiem?q=qua+han");
    await expect(page.getByRole("link", { name: new RegExp(k.tenQuaHan) }).first()).toBeVisible();
    await vao(page, "/elearning/tim-kiem?q=qua+han", cookieDaoTao);
    await expect(page.getByRole("heading", { name: "Tìm kiếm" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(k.tenQuaHan) })).toHaveCount(0);
    await expect(page.getByText(`${k.tenQuaHan} — bài 1`)).toHaveCount(0);
  });

  test("từ khoá rỗng / quá ngắn nói rõ lý do, không liệt kê cả kho; không có kết quả thì nói đúng điều đó", async ({ page }) => {
    await vao(page, "/elearning/tim-kiem?q=a");
    await expect(page.getByText("Từ khoá quá ngắn")).toBeVisible();
    await page.goto("/elearning/tim-kiem?q=zzzkhongcogi");
    await expect(page.getByText("Không có kết quả").first()).toBeVisible();
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, "/elearning/tim-kiem?q=khoa");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test.describe("[NV-P2-06] Đề nghị đào tạo", () => {
  const tieuDe = `E2E đề nghị ${Date.now().toString(36)}`;
  let maPhieu = "";

  test("lối vào THEO NGỮ CẢNH từ Khoá của tôi; KHÔNG phải mục trên thanh điều hướng chính", async ({ page }) => {
    await vao(page, "/elearning/khoa-cua-toi");
    await expect(page.getByRole("link", { name: "Gửi đề nghị đào tạo" }).first()).toBeVisible();
    // Thanh điều hướng đang hiện: thanh trên (≥721px) hoặc thanh dưới (≤720px) — `getByRole` bỏ phần tử ẩn.
    const nav = page.getByRole("navigation", { name: /^Điều hướng chính/ });
    await expect(nav.getByRole("link", { name: "Khoá của tôi", exact: true })).toBeVisible(); // đối chứng dương: thanh có mặt
    await expect(nav.getByRole("link", { name: /Đề nghị/ })).toHaveCount(0);
  });

  test("gửi đề nghị: quý chọn từ danh sách, phiếu hiện trong 'Đề nghị bạn đã gửi' ở trạng thái Chờ duyệt", async ({ page }) => {
    await vao(page, "/elearning/de-nghi");
    const dong = page.getByRole("link", { name: tieuDe }).locator("visible=true").first();
    // Trang tải xong HTML nhưng React chưa chắc đã hydrate (project cuối của lượt chạy dài): hydrate đặt lại ô đã gõ và cú bấm trước đó không gửi gì. Thử lại cả chuỗi
    // gõ → bấm → chờ phiếu hiện; nếu lần trước ĐÃ gửi được thì phiếu hiện ngay và vòng thử dừng (không gửi lần hai).
    await expect(async () => {
      if (await dong.isVisible()) return;
      await page.getByLabel("Bạn muốn được đào tạo về gì").fill(tieuDe);
      await page.getByLabel("Nhóm người cần đào tạo").fill("Nhân viên mới cơ sở 2");
      await page.getByLabel("Lý do").fill("Nhân viên mới chưa quen quy trình an toàn.");
      await page.getByLabel("Kết quả mong đợi").fill("Qua bài kiểm tra an toàn trong tháng đầu.");
      await expect(page.getByLabel("Quý dự kiến").locator("option").first()).toHaveText(/^Q[1-4]\/\d{4}$/);
      await page.getByRole("button", { name: "Gửi đề nghị" }).click();
      await expect(dong).toBeVisible({ timeout: 6000 });
    }).toPass({ timeout: 40_000 });
    await expect(dong).toBeVisible();
    maPhieu = ((await dong.getAttribute("href")) ?? "").split("/").pop() ?? "";
    expect(decodeURIComponent(maPhieu)).toMatch(/^NC\.\d{4}\.\d{3}$/);
    await expect(page.getByText("Chờ duyệt").locator("visible=true").first()).toBeVisible();
  });

  test("chi tiết: đủ 5 trường + tiến trình 'Đã gửi' → 'Chờ phòng Đào tạo xem xét'; KHÔNG có nút Rút/Từ chối (Q14 chưa chốt)", async ({ page }) => {
    await vao(page, `/elearning/de-nghi/${maPhieu}`);
    await expect(page.getByRole("heading", { name: tieuDe })).toBeVisible();
    await expect(page.getByText("Nhân viên mới cơ sở 2")).toBeVisible();
    await expect(page.getByText("Chờ phòng Đào tạo xem xét")).toBeVisible();
    await expect(page.getByRole("button", { name: /Rút|Từ chối/ })).toHaveCount(0);
    await expect(page.getByText("đang xem")).toHaveCount(0);
  });

  test("🔴 người khác mở mã phiếu của mình ⇒ 'Không mở được đề nghị này' (đối chứng dương: chủ mở được ở ca trên)", async ({ page }) => {
    await vao(page, `/elearning/de-nghi/${maPhieu}`, cookieDaoTao);
    await expect(page.getByText("Không mở được đề nghị này")).toBeVisible();
    await expect(page.getByRole("heading", { name: tieuDe })).toHaveCount(0);
    // và danh sách của họ không chứa phiếu này
    await page.goto("/elearning/de-nghi");
    await expect(page.getByRole("link", { name: tieuDe })).toHaveCount(0);
  });

  test("form thiếu/ngắn: máy chủ nói rõ lý do, không mất nội dung đã gõ", async ({ page }) => {
    await vao(page, "/elearning/de-nghi");
    // Trang vừa tải xong HTML nhưng React chưa chắc đã hydrate: lúc máy chậm (dự án cuối của lượt chạy dài), hydrate đặt lại ô đã gõ về rỗng và cú bấm trước đó
    // thành gửi form gốc. Cả chuỗi (gõ → bấm → chờ lời báo) được thử lại cho tới khi hydrate xong — mỗi vòng đều là một lần gửi hợp lệ phía máy chủ.
    await expect(async () => {
      await page.getByLabel("Bạn muốn được đào tạo về gì").fill("X");
      await page.getByLabel("Nhóm người cần đào tạo").fill("Y");
      await page.getByLabel("Lý do").evaluate((e) => ((e as HTMLTextAreaElement).removeAttribute("minlength")));
      await page.getByLabel("Kết quả mong đợi").evaluate((e) => ((e as HTMLTextAreaElement).removeAttribute("minlength")));
      await page.getByLabel("Lý do").fill("ngắn");
      await page.getByLabel("Kết quả mong đợi").fill("ngắn");
      await page.getByRole("button", { name: "Gửi đề nghị" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "ít nhất 10 ký tự" })).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByLabel("Bạn muốn được đào tạo về gì")).toHaveValue("X");
  });

  test("không tràn ngang", async ({ page }) => {
    for (const u of ["/elearning/de-nghi", `/elearning/de-nghi/${maPhieu}`]) {
      await vao(page, u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), u).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("[NV-P2-07] Thông báo — tab Tất cả / Chưa đọc", () => {
  test("tab Tất cả thấy cả hai; tab Chưa đọc (URL riêng, mang status cho 'tải thêm') chỉ thấy chưa đọc kèm số", async ({ page }) => {
    await vao(page, "/elearning/thong-bao");
    await expect(page.getByText(tb.tieuDeChuaDoc).first()).toBeVisible();
    await expect(page.getByText(tb.tieuDeDaDoc).first()).toBeVisible(); // đối chứng dương: thông báo đã đọc CÓ ở tab Tất cả
    const tabChuaDoc = page.getByRole("link", { name: /^Chưa đọc/ });
    await expect(tabChuaDoc).toContainText(/\d+/);
    await tabChuaDoc.click();
    await expect(page).toHaveURL(/tab=chua-doc/);
    await expect(page).toHaveURL(/status=unread/);
    await expect(page.getByText(tb.tieuDeChuaDoc).first()).toBeVisible();
    await expect(page.getByText(tb.tieuDeDaDoc)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Chưa đọc/ })).toHaveAttribute("aria-current", "page");
  });

  test("liên kết CŨ ?status=unread vẫn đúng và sáng tab Chưa đọc; ?tab=chua-doc trần được bổ sung status", async ({ page }) => {
    await vao(page, "/elearning/thong-bao?status=unread");
    await expect(page).toHaveURL(/tab=chua-doc/);
    await expect(page.getByText(tb.tieuDeDaDoc)).toHaveCount(0);
    await page.goto("/elearning/thong-bao?tab=chua-doc");
    await expect(page).toHaveURL(/status=unread/);
    await expect(page.getByText(tb.tieuDeChuaDoc).first()).toBeVisible();
  });

  test("bộ lọc 'Trạng thái' của trang dùng chung bị ẩn (tab thay thế, không có hai điều khiển cho một việc)", async ({ page }) => {
    await vao(page, "/elearning/thong-bao");
    await expect(page.getByText("Nhóm", { exact: true }).first()).toBeVisible(); // đối chứng dương: rail lọc còn
    await expect(page.getByText("Trạng thái", { exact: true })).toBeHidden();
  });

  test("không tràn ngang", async ({ page }) => {
    for (const u of ["/elearning/thong-bao", "/elearning/thong-bao?tab=chua-doc&status=unread"]) {
      await vao(page, u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), u).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("[NV-P2-08] Xác minh chứng nhận (công khai)", () => {
  test("không cần đăng nhập: thấy 'Chứng nhận hợp lệ', số hiệu, thương hiệu; KHÔNG có điều hướng nội bộ; token là của chứng nhận học viên A", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "vi-VN" }); // sạch — không cookie
    const page = await ctx.newPage();
    await page.goto(`/xac-thuc/${cn.tokenCongKhai}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText("Chứng nhận hợp lệ")).toBeVisible();
    await expect(page.getByText(cn.maSapHet)).toBeVisible();
    await expect(page.getByText("Cổng Elearning")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Khoá của tôi" })).toHaveCount(0);
    await ctx.close();
  });

  test("mang token (kem/tím) và theo hệ thống: nền KHÔNG phải trắng thuần; không tràn ngang", async ({ browser }, info) => {
    const ctx = await browser.newContext({
      colorScheme: info.project.name === "elearning-dark" ? "dark" : "light",
      viewport: info.project.name === "elearning-mobile" ? { width: 375, height: 800 } : { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    await page.goto(`/xac-thuc/${cn.tokenCongKhai}`);
    const goc = page.locator("[data-elearning-theme]");
    await expect(goc).toBeVisible();
    const nen = await goc.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(nen).not.toBe("rgb(255, 255, 255)");
    if (info.project.name === "elearning-dark") await expect(goc).toHaveAttribute("data-elearning-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await ctx.close();
  });

  test("mã sai: một câu cho mọi trường hợp (không phân biệt token sai / không tồn tại)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const t of ["khong-dung-dinh-dang", "A".repeat(32)]) {
      await page.goto(`/xac-thuc/${t}`);
      await expect(page.getByText("Không tìm thấy chứng nhận")).toBeVisible();
    }
    await ctx.close();
  });
});

test.describe("[NV-P2-09] Tổng quan", () => {
  test("'Hạn của bạn' hiện n/m bài; khối Chứng nhận có Xem + Tải PDF; KHÔNG vẽ khối 'Lộ trình' (thiếu dữ liệu)", async ({ page }) => {
    await vao(page, "/elearning");
    // khoá chính (NOT_STARTED, 2 bài bắt buộc… tổng số bài do seed) và khoá quá hạn (1 bài): dạng "x/y bài"
    await expect(page.getByText(/^\d+\/\d+ bài · hạn \d{2}\/\d{2}$/).first()).toBeVisible();
    const khoi = page.getByRole("region", { name: "Chứng nhận" });
    await expect(khoi).toBeVisible();
    await expect(khoi.getByRole("link", { name: /^Xem chứng nhận / }).first()).toBeVisible();
    await expect(khoi.getByRole("link", { name: /^Tải PDF chứng nhận / }).first()).toHaveAttribute("href", /\/api\/elearning\/chung-nhan\?id=/);
    await expect(page.getByText("Lộ trình")).toHaveCount(0);
  });

  test("🔴 khối chứng nhận chỉ của MÌNH: tài khoản khác không thấy số hiệu của người học (đối chứng dương: người học thấy)", async ({ page }) => {
    // ⚠️ Phân biệt theo MÃ chứng nhận (đích của liên kết "Xem chứng nhận"), KHÔNG theo tên khoá: fixture CỐ Ý cấp cho Đào tạo
    // một chứng nhận của CHÍNH KHOÁ ĐÓ (`maNguoiKhac`), nên tên khoá không phân biệt được ai là chủ. Bản cũ khẳng định
    // "không có liên kết tên khoá" bằng `toHaveCount(0)` ngay lần thăm dò đầu — xanh khi khối chưa kịp hiện (desktop), đỏ khi
    // khối hiện trước (dark): cả hai đều không nói gì về rò rỉ (điều tra NV-P2-09, 20/11/2026).
    const lienKetMa = (p: Page, ma: string) => p.locator(`a[href$="/elearning/chung-nhan-cua-toi/${encodeURIComponent(ma)}"]`);
    await vao(page, "/elearning");
    await expect(lienKetMa(page, cn.maSapHet)).toHaveCount(1); // đối chứng dương: chủ thấy của mình
    await expect(lienKetMa(page, cn.maNguoiKhac)).toHaveCount(0); // …và KHÔNG thấy của Đào tạo (cùng khoá)
    await vao(page, "/elearning", cookieDaoTao);
    await expect(lienKetMa(page, cn.maNguoiKhac)).toHaveCount(1); // đối chứng dương: Đào tạo thấy của MÌNH — buộc chờ khối hiện xong
    await expect(lienKetMa(page, cn.maSapHet)).toHaveCount(0); // KHÔNG thấy số hiệu của người học
    await expect(lienKetMa(page, cn.maHocLai)).toHaveCount(0);
  });

  test("không tràn ngang", async ({ page }) => {
    await vao(page, "/elearning");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});
