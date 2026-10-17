/**
 * AFF-L4 — SMOKE 375px (yêu cầu §34): các màn Affiliate dùng được trên điện thoại không?
 *
 * Trình duyệt thật, khung nhìn 375×812, `isMobile` + `hasTouch` (nên các biến thể `pointer-coarse:` của CSS có hiệu lực — đúng thứ người dùng điện thoại nhận), dữ liệu seed thật
 * (hiện trường của `affiliate-hien-truong.ts`: 2 đối tác · 1 campaign · link · lượt bấm · referral · dòng sổ).
 *
 * Mỗi màn đo bằng `quetMan` (xem `_helpers/quet-375.ts`): TRÀN NGANG · phần tử NGOÀI KHUNG · phần tử BỊ CHE · VÙNG CHẠM nhỏ. CAO = không dùng được ⇒ ca ĐỎ. THẤP = ghi vào đính kèm
 * `quet-375-*` của từng ca (không làm đỏ) và vào notes `docs/source-commission/closeout/l4-e2e-portal-375.md`.
 * Ảnh chụp từng màn nằm ở `test-results/**` (thư mục artifact của Playwright, KHÔNG commit).
 *
 *   [A375-01] Nhập khách hàng — ô «Nguồn khách hàng» (mở danh sách tìm)
 *   [A375-02] Affiliate — danh sách + chi tiết đối tác
 *   [A375-03] Campaign — danh sách + chi tiết (khối «Hiệu quả»)
 *   [A375-04] Link / QR / Mã — danh sách + sheet «Phát link» + hộp thoại QR (mở / đóng được)
 *   [A375-05] Referral — danh sách + chi tiết. Panel xử lý / sheet khai tay thuộc nhánh L3b (chưa vào `test`): ca này CHỈ NHẬN RA sự có mặt của chúng và ghi annotation — KHÔNG mở, KHÔNG đo.
 *   [A375-06] Portal `/portal/gioi-thieu`
 */
import { test, expect, type Page } from "@playwright/test";

import { db } from "../../../lib/db";
import {
  ADMIN_EMAIL,
  damBaoNenDuLieu,
  dangNhapCoNho,
  datCoTrongDb,
  datCoVaLamMoi,
  datHienTien,
  dungHienTruongDoiTac,
  lamMoiBoNhoCauHinh,
  themSoCuaA,
  type HienTruong,
} from "../_helpers/affiliate-hien-truong";
import { cao, quetMan, type KetQuaMan } from "../_helpers/quet-375";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
// Các ca độc lập (đăng nhập có nhớ phiên; mỗi ca tự vào màn của mình) — một màn hỏng không được che các màn sau, nên KHÔNG dùng chế độ serial.
// (Worker duy nhất theo cấu hình a0 nên hiện trường dựng ở beforeAll dùng chung an toàn.)

let f: HienTruong;
const tatCa: KetQuaMan[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await damBaoNenDuLieu();
  f = await dungHienTruongDoiTac();
  await themSoCuaA(f);
  await datHienTien(f.x.campaign.id, true);
  await datCoVaLamMoi(browser, { nguon: true, affiliate: true });
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await datCoTrongDb({ nguon: false, affiliate: false });
  await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
  await lamMoiBoNhoCauHinh(browser);
});

/** Ghi kết quả + làm đỏ khi có phát hiện CAO (liệt kê hết, không dừng ở cái đầu tiên). */
function chot(k: KetQuaMan): void {
  tatCa.push(k);
  const hong = cao(k);
  expect(hong, `${k.man}: ${hong.length} phát hiện CAO ở 375px\n${hong.map((h) => `  - [${h.loai}] ${h.chiTiet}`).join("\n")}`).toEqual([]);
}

async function vaoAdmin(page: Page, duong: string, cho: () => Promise<unknown>): Promise<void> {
  await dangNhapCoNho(page, ADMIN_EMAIL);
  await page.goto(duong, { timeout: 120_000 });
  await cho();
  await page.waitForTimeout(400); // chờ bố cục ổn định (font · skeleton · sidebar đóng)
}

test("[A375-01] Nhập khách hàng — ô «Nguồn khách hàng» (mở danh sách tìm)", async ({ page }, info) => {
  test.setTimeout(240_000);
  // cờ nguồn BẬT ⇒ ô «Nguồn khách hàng» dạng hộp chọn tìm được hiện ra
  await vaoAdmin(page, "/admin/nhap-khach-hang", () => expect(page.getByRole("combobox", { name: /Nguồn khách hàng/ })).toBeVisible({ timeout: 90_000 }));
  chot(await quetMan(page, info, "01a-nhap-khach-hang"));

  const o = page.getByRole("combobox", { name: /Nguồn khách hàng/ });
  await o.scrollIntoViewIfNeeded();
  await o.click();
  const danhSach = page.getByRole("listbox").first();
  await expect(danhSach).toBeVisible();
  chot(await quetMan(page, info, "01b-nhap-khach-hang-mo-danh-sach-nguon"));
  // gõ để tìm, chọn được một dòng, đóng được
  await page.keyboard.type("a");
  const muc = danhSach.getByRole("option");
  await expect(muc.first()).toBeVisible();
  const ten = (await muc.first().innerText()).replace(/s+/g, " ").trim();
  await muc.first().click();
  await expect(danhSach).toBeHidden();
  // chọn xong thì ô hiện nguồn đã chọn (không còn trống)
  await expect(o).toContainText(ten.slice(0, 12));
});

test("[A375-02] Affiliate — danh sách + chi tiết đối tác", async ({ page }, info) => {
  test.setTimeout(240_000);
  await vaoAdmin(page, "/admin/nguon-hoa-hong/affiliate", () => expect(page.getByText(f.x.doiTac.name).first()).toBeVisible({ timeout: 90_000 }));
  chot(await quetMan(page, info, "02a-affiliate-danh-sach"));
  await vaoAdmin(page, `/admin/nguon-hoa-hong/affiliate/${f.x.doiTac.id}`, () => expect(page.getByText(f.x.doiTac.name).first()).toBeVisible({ timeout: 90_000 }));
  chot(await quetMan(page, info, "02b-affiliate-chi-tiet"));
});

test("[A375-03] Campaign — danh sách + chi tiết (khối «Hiệu quả»)", async ({ page }, info) => {
  test.setTimeout(240_000);
  await vaoAdmin(page, "/admin/nguon-hoa-hong/campaign", () => expect(page.getByText(f.x.campaign.name).first()).toBeVisible({ timeout: 90_000 }));
  chot(await quetMan(page, info, "03a-campaign-danh-sach"));
  await vaoAdmin(page, `/admin/nguon-hoa-hong/campaign/${f.x.campaign.code}`, () => expect(page.getByText(f.x.campaign.name).first()).toBeVisible({ timeout: 90_000 }));
  await expect(page.getByText("Hiệu quả").first()).toBeVisible();
  // (Bảng thành viên ở màn này có hàng cao ~200px: do câu giải thích «vì sao không làm được» dưới nút (`basis-full`, chủ ý) bị bẻ nhiều dòng trong cột hẹp — nội dung, không phải lỗi bố cục;
  // KHÔNG đổi `flex-wrap` ở `nut-membership.tsx` vì chính nó giữ dòng giải thích xuống hàng riêng. Ghi ở notes, hiện ở danh sách THẤP.)
  chot(await quetMan(page, info, "03b-campaign-chi-tiet"));
});

test("[A375-04] Link / QR / Mã — danh sách + sheet «Phát link» + hộp thoại QR (mở / đóng được)", async ({ page }, info) => {
  test.setTimeout(240_000);
  await vaoAdmin(page, "/admin/nguon-hoa-hong/link", () => expect(page.getByRole("button", { name: `Xem mã QR của ${f.x.doiTac.name}` }).first()).toBeVisible({ timeout: 90_000 }));
  const danhSachLink = await quetMan(page, info, "04a-link-danh-sach");
  chot(danhSachLink);
  // Hồi quy (phát hiện bằng MẮT, không cảm biến nào khác bắt được): cột «Thao tác» có `flex-wrap` nên ở bảng rộng hơn khung, ô thao tác co về bề rộng MỘT nút và bẻ năm nút thành cột dọc ⇒
  // mỗi hàng cao ~260px, một màn chỉ thấy hai link. Hàng bình thường ~80px.
  expect(danhSachLink.hangBangCaoNhat, "hàng bảng link phình cao vì nút thao tác bị bẻ thành cột dọc ở 375px").toBeLessThan(150);

  // sheet «Phát link»
  await page.getByRole("button", { name: "Phát link", exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: /Phát link/ });
  await expect(sheet).toBeVisible();
  chot(await quetMan(page, info, "04b-link-sheet-phat-link"));
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // hộp thoại QR
  await page.getByRole("button", { name: `Xem mã QR của ${f.x.doiTac.name}` }).first().click();
  const qr = page.getByRole("dialog", { name: /Mã QR giới thiệu/ });
  await expect(qr).toBeVisible({ timeout: 60_000 });
  chot(await quetMan(page, info, "04c-link-hop-thoai-qr"));
  await page.keyboard.press("Escape");
  await expect(qr).toBeHidden();
});

test("[A375-05] Referral — danh sách + chi tiết", async ({ page }, info) => {
  test.setTimeout(240_000);
  await vaoAdmin(page, "/admin/nguon-hoa-hong/referral", () => expect(page.getByRole("link", { name: /Xem chi tiết referral/ }).first()).toBeVisible({ timeout: 90_000 }));
  chot(await quetMan(page, info, "05a-referral-danh-sach"));
  const rf = await db.affiliateReferral.findFirstOrThrow({ where: { partyId: f.x.doiTac.id }, select: { id: true } });
  await vaoAdmin(page, `/admin/nguon-hoa-hong/referral/${rf.id}`, () => expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 90_000 }));
  chot(await quetMan(page, info, "05b-referral-chi-tiet"));

  // Panel xử lý tay + sheet khai tay là việc của lane L3b (nhánh hptkk29/aff-l3b-referral-xem-tay) — CHƯA có trong `test`.
  // ⚠️ Ca này KHÔNG đo chúng ở bất cứ trường hợp nào: chỉ nhận ra nút có mặt và ghi annotation để người merge L3b biết còn thiếu bước. Khi L3b vào `test`, PHẢI thêm bước mở/đóng + `quetMan` cho hai thứ đó
  // (annotation nói «CHƯA đo» chứ không nói «đã đo» — một annotation hứa suông là luật 12).
  const coXuLy = (await page.getByRole("button", { name: /xử lý|duyệt|từ chối/i }).count()) > 0;
  const coKhaiTay = (await page.getByRole("button", { name: /khai tay|khai referral|khai thủ công/i }).count()) > 0;
  test.info().annotations.push({ type: "L3b", description: `panel xử lý: ${coXuLy ? "có trong bản dựng — CHƯA đo, cần thêm bước mở/đóng + quetMan" : "chưa có trong bản dựng này"}; sheet khai tay: ${coKhaiTay ? "có trong bản dựng — CHƯA đo, cần thêm bước mở/đóng + quetMan" : "chưa có trong bản dựng này"}` });
});

test("[A375-06] Portal /portal/gioi-thieu", async ({ page }, info) => {
  test.setTimeout(240_000);
  await dangNhapCoNho(page, f.ua.email);
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(400);
  // Hồi quy (phát hiện bằng MẮT ở lượt đo đầu): hai bảng của cổng giữ `min-w-[480px]/[520px]` nên ở 375px cột «Trạng thái» và «Số tiền» nằm NGOÀI màn hình, bị cắt dở chữ («Đã g…», «123…»),
  // không dấu hiệu cuộn ngang. Không cảm biến chung nào bắt được (vùng cuộn ngang được coi là hợp lệ) ⇒ khẳng định THẲNG: ô quan trọng nằm trọn trong khung và không bị cắt chữ.
  const ngoaiKhung = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const loi: string[] = [];
    for (const sel of ["main [data-referral] [data-nhan='Trạng thái']", "main [data-referral] [data-nhan='Mã hồ sơ']", "main [data-hoa-hong] [data-nhan='Số tiền']", "main [data-hoa-hong] [data-nhan='Chi trả']"]) {
      const cacO = Array.from(document.querySelectorAll<HTMLElement>(sel));
      if (cacO.length === 0) loi.push(`không có ô nào khớp ${sel}`);
      for (const o of cacO) {
        const r = o.getBoundingClientRect();
        if (r.left < 0 || r.right > vw + 1) loi.push(`${sel}: left=${Math.round(r.left)} right=${Math.round(r.right)} (khung ${vw})`);
        if (o.scrollWidth > o.clientWidth + 1) loi.push(`${sel}: chữ bị cắt (scrollWidth ${o.scrollWidth} > ${o.clientWidth})`);
      }
    }
    return loi;
  });
  expect(ngoaiKhung, `ô quan trọng của cổng nằm ngoài khung / bị cắt ở 375px: ${ngoaiKhung.join(" | ")}`).toEqual([]);
  chot(await quetMan(page, info, "06-portal-gioi-thieu"));
});

test.afterAll(() => {
  const tong = tatCa.flatMap((k) => k.phatHien.filter((p) => p.muc === "THAP").map((p) => `${k.man}: [${p.loai}] ${p.chiTiet}`));
  if (tong.length) console.log(`[A375] ${tong.length} phát hiện THẤP:\n${tong.map((t) => `  - ${t}`).join("\n")}`);
});
