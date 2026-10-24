// SRC-39 · SRC-45 · SRC-40 · SRC-41 · SRC-42 · SRC-43 · SRC-44 — CHUẨN BỊ ENGINE HOA HỒNG bằng GIAO DIỆN THẬT trên test (suite `chuan-bi`). Chạy BẰNG TAY, MỘT LẦN, TRƯỚC `t1` / `tich-hop` — KHÔNG nằm trong `tat-ca`.
//
// Vì sao tách thành suite riêng: các ca này GHI cấu hình dùng chung của cả môi trường test (cờ engine, người hưởng, chính sách ACTIVE, mốc cutover) và có một bước KHÔNG hoàn tác được —
// từ lúc engine ghi dòng sổ đầu tiên, MỐC CUTOVER không dời/gỡ được nữa (hành vi sẵn có của engine, `docs/source-commission/13-uat-tay-t1-xu-ly-hang-cho.md`). Nên:
//   · làm theo thứ tự TRONG TỆP: SRC-39 (cờ nguồn) → 45 (cờ Affiliate, tuỳ chọn — mặc định BLOCKED) → 40 (engine) → 41 (người hưởng CS2) → 42 (chính sách chung) → 43 (mốc cutover) → 44 (tab hiện đủ). Đừng đảo. Cutover (43) ĐÒI chính sách chung đã ACTIVE (không thì `CO_CHENH_BAT_NGO`) và lead cũ đã vét (không thì `DI_TRU_CHUA_SAN_SANG`);
//   · MỖI ca idempotent: đã làm rồi thì bước ghi `ALREADY_DONE` (kết quả của ca vẫn là PASS — đây là một giá trị CỦA BƯỚC, không phải loại kết quả thứ năm);
//   · mốc cutover ĐÃ CÓ thì KHÔNG BAO GIỜ dời — kể cả khi khác tháng mà bộ nạp dùng; ca ghi giá trị đang có và dừng;
//   · thiếu tiền đề (còn vấn đề chặn, thiếu quyền…) ⇒ BLOCKED kèm đúng chữ của giao diện, không phải FAIL.
//
// Thứ tự trên TEST (xem `uat-harness.md` §11): nạp UAT SOURCE FINAL lần 1 → vét lead cũ → **chuan-bi (tệp này)** → nạp lần 2 (sinh hàng chờ) → t1 / tich-hop.
// Tài khoản: `uat.admin` (SUPER_ADMIN) — duy nhất có `settings:edit` và `commission_policies:activate` trong seed (checklist 09 §1.2).
import type { Page } from "@playwright/test";
import { expect, test } from "./_lib/fixtures";
import { tenDuLieu } from "./_lib/an-toan";
import { nhanActor } from "./_lib/phien";
import type { NhatKyCa } from "./_lib/nhat-ky";
import { choHydrate, coThay, di, moHopThoai } from "./_lib/thao-tac";

const DOT = process.env.UAT_RUN_CODE ?? "LOCAL";
const LY_DO = (viec: string): string => `${tenDuLieu(DOT, viec)} — nghiệm thu UAT trên test`;
const DUONG_HOA_HONG = "/cau-hinh-van-hanh?tab=hoa-hong";
const DUONG_CUTOVER = "/cau-hinh-van-hanh/chuyen-hoa-hong";
const DUONG_NGUOI_HUONG = "/crm/commission/nguoi-huong";
const DUONG_CHINH_SACH = "/nguon-hoa-hong/chinh-sach?xem=tat-ca";
const MA_CHINH_SACH_CHUNG = "SR.QD.208/HV_MOI";

/** Bấm «Lưu nháp» CHỈ KHI có thay đổi chưa lưu (chạy lại sau lần dở dang thì giá trị đã đúng — không có gì để lưu), rồi ĐỢI máy chủ nói «Đã lưu nháp vN» (toast; chờ toast cũ tắt trước kẻo đọc nhầm). */
async function luuNhap(page: Page): Promise<void> {
  if (!(await coThay(page.getByText(/có thay đổi chưa lưu/), 3_000))) return;
  const toast = page.getByText(/Đã lưu nháp v\d+/);
  await expect(toast).toBeHidden({ timeout: 20_000 });
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(toast.first()).toBeVisible({ timeout: 60_000 });
}

/** Trình soạn chính sách giữ bước hiện tại ở query `buoc` — đi thẳng bằng URL (nút bước đổi nhãn thành «… — đã xong» khi bước đã làm). Đồng thời tải lại trang nên dữ liệu «sớm nhất» là của bản ĐÃ LƯU. */
async function vaoBuoc(page: Page, buoc: string): Promise<void> {
  const u = new URL(page.url());
  u.searchParams.set("buoc", buoc);
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
}

/** Công tắc của một dòng ở Cấu hình vận hành: bật nếu đang tắt (kèm lý do + Lưu), tải lại để xác nhận. Trả `ALREADY_DONE` nếu đã bật sẵn. */
async function batCongTac(ca: NhatKyCa, page: Page, duong: string, id: string, nhan: string, viec: string): Promise<"ALREADY_DONE" | "DA_BAT"> {
  await di(page, duong);
  const c = page.locator(`#${id}`);
  if (!(await coThay(c, 90_000))) ca.biChan(`Không thấy công tắc «${nhan}» (#${id}) ở ${duong}: vai admin không mở được Cấu hình vận hành, hoặc nhãn/tab đổi.`);
  await choHydrate(c);
  if ((await c.getAttribute("aria-checked")) === "true") return "ALREADY_DONE";
  await c.click();
  const oLyDo = page.getByPlaceholder("Vì sao đổi? (bắt buộc)");
  await expect(oLyDo).toBeVisible({ timeout: 30_000 });
  await oLyDo.fill(LY_DO(viec));
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect.poll(async () => {
    await di(page, duong);
    const c2 = page.locator(`#${id}`);
    return (await coThay(c2, 60_000)) ? await c2.getAttribute("aria-checked") : "khong-thay";
  }, { timeout: 120_000, intervals: [2_000, 4_000, 8_000] }).toBe("true");
  return "DA_BAT";
}

const CO_NGUON = [
  { id: "o-nguon-enabled", nhan: "Quản lý nguồn khách (công tắc tổng)" },
  { id: "o-nguon-autoAttribution", nhan: "Tự quy nguồn theo tín hiệu có sẵn" },
  { id: "o-nguon-referral", nhan: "Ghi người giới thiệu và mã giới thiệu" },
  { id: "o-nguon-manualReview", nhan: "Đưa ca không tự quy được vào hàng chờ xem tay" },
  { id: "o-nguon-pageMapping", nhan: "Quy nguồn theo Page Facebook" },
] as const;

test("[SRC-39] Bật các cờ NGUỒN mà checklist 09 §1.3 đòi (tổng · tự quy nguồn · người giới thiệu · xem tay · Page) ở Cấu hình vận hành › Khách hàng (Admin) — idempotent", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const actor = nhanActor("admin");
  for (const co of CO_NGUON) {
    const kq = await batCongTac(ca, ad.page, "/cau-hinh-van-hanh?tab=khach-hang", co.id, co.nhan, `bat ${co.id}`);
    ca.buoc({ actor, action: `${kq === "ALREADY_DONE" ? "ALREADY_DONE — đã bật" : "Bật + lý do + Lưu"}: «${co.nhan}»`, input: co.id, expected: "công tắc đang bật sau khi tải lại", actual: "đang bật", pass: true });
  }
  await ca.chup(ad.page, "co-nguon-sau-bat", { fullPage: false });
});

test("[SRC-45] (tuỳ chọn — chỉ khi UAT_BAT_AFFILIATE=1) Bật «Affiliate / người giới thiệu» để chạy SRC-12/13 (Admin) — idempotent", async ({ ca, moVai }) => {
  if (process.env.UAT_BAT_AFFILIATE !== "1") ca.biChan("Cờ Affiliate KHÔNG tự bật: đây là việc của chủ dự án. Chạy lại suite chuan-bi với ô «bat_affiliate» = true (workflow) / UAT_BAT_AFFILIATE=1 nếu muốn bật nó trên test.");
  const ad = await moVai("admin");
  const kq = await batCongTac(ca, ad.page, "/cau-hinh-van-hanh?tab=khach-hang", "o-affiliate-enabled", "Affiliate / người giới thiệu", "bat affiliate");
  ca.buoc({ actor: nhanActor("admin"), action: `${kq === "ALREADY_DONE" ? "ALREADY_DONE — đã bật" : "Bật + lý do + Lưu"}: «Affiliate / người giới thiệu»`, input: "o-affiliate-enabled", expected: "công tắc đang bật sau khi tải lại", actual: "đang bật", pass: true, screenshots: [await ca.chup(ad.page, "affiliate-sau-bat", { fullPage: false })] });
});

test("[SRC-40] Bật «Engine hoa hồng mới» ở Cấu hình vận hành (Admin) — idempotent", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  await di(page, DUONG_HOA_HONG);
  const congTac = page.locator("#o-hoaHong-engineBat");
  if (!(await coThay(congTac, 90_000))) ca.biChan("Không thấy công tắc «Engine hoa hồng mới» ở tab Hoa hồng: vai admin không mở được Cấu hình vận hành, hoặc tab đổi tên.");
  await choHydrate(congTac);
  const truoc = await congTac.getAttribute("aria-checked");
  ca.thongTin(actor, "Đọc trạng thái công tắc trước khi làm", { ariaChecked: truoc });
  if (truoc === "true") {
    ca.buoc({ actor, action: "ALREADY_DONE — engine hoa hồng đã bật", input: DUONG_HOA_HONG, expected: "công tắc đang bật; không đổi gì", actual: "đang bật", pass: true, screenshots: [await ca.chup(page, "engine-da-bat", { fullPage: false })] });
    return;
  }
  await congTac.click();
  const oLyDo = page.getByPlaceholder("Vì sao đổi? (bắt buộc)");
  await expect(oLyDo).toBeVisible({ timeout: 30_000 });
  await oLyDo.fill(LY_DO("bat engine hoa hong"));
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  // Lưu xong: tải lại và đọc công tắc — không tin toast.
  await expect.poll(async () => {
    await di(page, DUONG_HOA_HONG);
    const c = page.locator("#o-hoaHong-engineBat");
    return (await coThay(c, 60_000)) ? await c.getAttribute("aria-checked") : "khong-thay";
  }, { timeout: 120_000, intervals: [2_000, 4_000, 8_000] }).toBe("true");
  ca.buoc({ actor, action: "Bật engine hoa hồng + lý do + Lưu, rồi tải lại trang", input: { lyDo: LY_DO("bat engine hoa hong") }, expected: "công tắc đang bật sau khi tải lại", actual: "đang bật", pass: true, screenshots: [await ca.chup(page, "engine-sau-bat", { fullPage: false })] });
});

test("[SRC-41] Khai người phụ trách CS2 (QC + Quản lý TT) ở «Người hưởng hoa hồng theo cơ sở» (Admin) — idempotent", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  await di(page, DUONG_NGUOI_HUONG);
  const theCs2 = () => page.locator("div.rounded-lg.border").filter({ hasText: /CS2/ }).first();
  if (!(await coThay(theCs2(), 90_000))) ca.biChan("Không thấy thẻ cơ sở CS2 ở trang «Người hưởng hoa hồng theo cơ sở» (vai admin không mở được, hoặc cơ sở đổi mã).");
  const chu = (await theCs2().innerText()).replace(/\s+/g, " ");
  const thieu = { qc: /Chưa khai:[^]*?QC 1%/.test(chu), ql: /Chưa khai:[^]*?Quản lý TT 2%/.test(chu) };
  ca.thongTin(actor, "Đọc thẻ cơ sở CS2", { thieu, trich: chu.slice(0, 220) });
  if (!thieu.qc && !thieu.ql) {
    ca.buoc({ actor, action: "ALREADY_DONE — CS2 đã khai đủ QC + Quản lý TT", input: DUONG_NGUOI_HUONG, expected: "đã khai đủ; không đổi gì", actual: "Đã khai đủ", pass: /Đã khai đủ/.test(chu), screenshots: [await ca.chup(page, "cs2-da-khai", { fullPage: false })] });
    return;
  }
  // Người nhận là hai tư vấn viên CS2 của bộ UAT (uat.sale6 · uat.sale2) — tài khoản thử, không phải nhân sự thật. Hiệu lực lùi về 01/01/2026 (cùng ngày CS1 đã khai) để KHÔNG chặn
  // điều kiện «người hưởng xác định được tại ngày hiệu lực» của chính sách chung.
  const them = async (vaiNhan: RegExp, vaiHien: string, nguoi: string): Promise<void> => {
    await theCs2().getByRole("button", { name: "Thêm người hưởng" }).click();
    await theCs2().getByRole("combobox").first().click();
    await page.getByRole("option", { name: vaiNhan }).click();
    const o = page.locator("input[role=combobox]");
    await o.click();
    await o.pressSequentially(nguoi, { delay: 40 });
    await page.getByRole("option", { name: new RegExp(nguoi.replace(/\./g, "\\.")) }).first().click();
    await theCs2().locator("input[type=date]").first().fill("2026-01-01");
    await theCs2().getByRole("button", { name: "Lưu", exact: true }).click();
    // Đợi DÒNG đã lưu (`li` bắt đầu bằng huy hiệu vai), KHÔNG đợi chữ «QC»/«QL TT» trần: ô chọn Vai cũng in đúng chữ đó nên chữ trần hiện NGAY, ca đi tiếp trước khi lưu xong và điều hướng làm mất lượt lưu
    // (bản đầu: «Đã khai đủ» trượt ở máy chủ production nhanh hơn dev — đo 20/10/2026).
    await expect(theCs2().getByRole("listitem").filter({ hasText: new RegExp(`^${vaiHien}`) }).first()).toBeVisible({ timeout: 60_000 });
  };
  if (thieu.ql) await them(/Quản lý trung tâm/, "QL TT", "uat.sale6");
  await di(page, DUONG_NGUOI_HUONG);
  if (thieu.qc) await them(/Quảng cáo/, "QC", "uat.sale2");
  await di(page, DUONG_NGUOI_HUONG);
  await coThay(theCs2(), 60_000);
  const sau = (await theCs2().innerText()).replace(/\s+/g, " ");
  ca.buoc({ actor, action: "Khai QL TT = uat.sale6 · QC = uat.sale2 cho CS2, hiệu lực từ 01/01/2026", input: { thieu }, expected: "thẻ CS2 báo «Đã khai đủ»", actual: sau.slice(0, 200), pass: /Đã khai đủ/.test(sau), screenshots: [await ca.chup(page, "cs2-sau-khai", { fullPage: false })] });
});

test("[SRC-42] Kích hoạt chính sách CHUNG (SR.QD.208/HV_MOI) ở màn Chính sách (Admin) — idempotent; nâng trần 9% nếu guardrail chặn", async ({ ca, moVai }) => {
  // Cờ engine vừa bật có hiệu lực ở các tab hoa hồng sau ≤ 300 giây (cache cài đặt TRONG BỘ NHỚ của máy chủ — đo trên bản `next start` 20/10/2026: vừa quá 5 phút mới hiện) nên ca đợi tới 7 phút;
  // trần 4 phút/ca của cấu hình Playwright không đủ cho việc đợi đó.
  test.setTimeout(600_000);
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  // Tab hoa hồng chỉ hiện khi cờ engine đã có hiệu lực (cache ≤ 300 giây): đợi tới khi bảng Chính sách mở được.
  await expect.poll(async () => {
    await di(page, DUONG_CHINH_SACH);
    return await coThay(page.getByRole("row").filter({ hasText: MA_CHINH_SACH_CHUNG }).first(), 30_000);
  }, { timeout: 420_000, intervals: [5_000, 15_000, 30_000], message: `bảng Chính sách chưa có dòng ${MA_CHINH_SACH_CHUNG} (cờ engine còn cache? hay chưa seed chính sách v1 — nút \`chinh-sach-v1-ghi\` của seed-test-data?)` }).toBe(true);
  const hang = () => page.getByRole("row").filter({ hasText: MA_CHINH_SACH_CHUNG }).first();
  const trangThai = (await hang().innerText()).replace(/\s+/g, " ");
  ca.thongTin(actor, `Đọc dòng ${MA_CHINH_SACH_CHUNG}`, trangThai);
  // «Chờ hiệu lực» cũng là ACTIVE (đã kích hoạt, ngày hiệu lực còn ở tương lai — `trang-thai-phien-ban.ts`): kích hoạt lần hai là vô nghĩa.
  if (/Đang áp dụng|Chờ hiệu lực/.test(trangThai)) {
    ca.buoc({ actor, action: `ALREADY_DONE — ${MA_CHINH_SACH_CHUNG} đã kích hoạt (${/Chờ hiệu lực/.test(trangThai) ? "chờ hiệu lực" : "đang áp dụng"})`, input: DUONG_CHINH_SACH, expected: "đã ACTIVE; không đổi gì", actual: trangThai.slice(0, 200), pass: true, screenshots: [await ca.chup(page, "chinh-sach-da-active", { fullPage: false })] });
    return;
  }
  if (!/Nháp/.test(trangThai)) ca.biChan(`Chính sách ${MA_CHINH_SACH_CHUNG} không ở trạng thái Nháp cũng không «Đang áp dụng»: ${trangThai.slice(0, 160)}`);
  // ── Trình soạn: Văn bản → Hiệu lực → Kích hoạt ──
  await hang().getByRole("link").first().click();
  await page.getByRole("link", { name: "Sửa bản nháp" }).click();
  await page.waitForURL(/\/chinh-sach\/[^/]+\/soan/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Văn bản", exact: true }).click();
  const oChonVanBan = page.locator("select").first();
  await choHydrate(oChonVanBan);
  const nhanVanBan = (await oChonVanBan.locator("option").allInnerTexts()).find((t) => t.startsWith("UAT-VB-01"));
  if (!nhanVanBan) ca.biChan("Không có văn bản UAT-VB-01 trong ô «Chọn văn bản» — bộ nạp UAT (uat-nap-ghi) chưa chạy trên môi trường này.");
  await oChonVanBan.selectOption({ label: nhanVanBan });
  await luuNhap(page);
  // Ngày hiệu lực sớm nhất phụ thuộc văn bản ĐÃ LƯU (công bố + 15 ngày làm việc): tải lại để máy chủ tính theo văn bản vừa gắn.
  await vaoBuoc(page, "hieu-luc");
  const gioiHan = await page.getByText(/sớm nhất \d{2}\/\d{2}\/\d{4}/).first().innerText();
  const [, dd, mm, yyyy] = /sớm nhất (\d{2})\/(\d{2})\/(\d{4})/.exec(gioiHan)!;
  ca.thongTin(actor, "Ngày hiệu lực sớm nhất máy chủ tính (theo UAT-VB-01)", gioiHan);
  const oNgay = page.locator("input[type=date]").first();
  await choHydrate(oNgay);
  await oNgay.fill(`${yyyy}-${mm}-${dd}`);
  await expect(oNgay).toHaveValue(`${yyyy}-${mm}-${dd}`);
  await luuNhap(page);
  await vaoBuoc(page, "kich-hoat");
  await expect(page.getByText("Bước 7/7")).toBeVisible({ timeout: 60_000 });
  const chuBuoc = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  ca.thongTin(actor, "Nội dung bước Kích hoạt", chuBuoc.slice(chuBuoc.indexOf("Bước 7/7"), chuBuoc.indexOf("Bước 7/7") + 1400));
  await ca.chup(page, "buoc-kich-hoat");
  const nutKichHoat = page.getByRole("button", { name: "Kích hoạt…" });
  await expect(nutKichHoat).toBeVisible({ timeout: 60_000 });
  if (!(await nutKichHoat.isEnabled())) {
    const dieuKien = chuBuoc.slice(chuBuoc.indexOf("Điều kiện kích hoạt"));
    const vuotTran = /Tổng tỉ lệ ≤ trần[^—]*— chưa đạt/.test(dieuKien) || /VUOT_TRAN/.test(dieuKien);
    if (!vuotTran) ca.biChan(`Chính sách chung chưa kích hoạt được; điều kiện còn thiếu (nguyên văn giao diện): ${dieuKien.slice(0, 500)}`);
    await nangTran(ca, page, actor);
    await vaoBuoc(page, "kich-hoat");
    await expect(page.getByText("Bước 7/7")).toBeVisible({ timeout: 60_000 });
    if (!(await page.getByRole("button", { name: "Kích hoạt…" }).isEnabled())) ca.biChan("Đã nâng trần mà nút «Kích hoạt…» vẫn khoá — xem điều kiện ở ảnh chụp.");
  }
  const hop = await moHopThoai(page, page.getByRole("button", { name: "Kích hoạt…" }));
  const oLyDoXacNhan = hop.locator("#ly-do-xac-nhan");
  if (await coThay(oLyDoXacNhan, 3_000)) await oLyDoXacNhan.fill(LY_DO("kich hoat chinh sach chung"));
  const chuHop = (await hop.innerText()).replace(/\s+/g, " ");
  ca.thongTin(actor, "Hộp thoại «Kích hoạt chính sách này?»", chuHop.slice(0, 700));
  await hop.getByRole("button", { name: /^Kích hoạt từ/ }).click();
  await expect(page.getByText(/Đã kích hoạt — có hiệu lực từ/).first()).toBeVisible({ timeout: 60_000 });
  await di(page, DUONG_CHINH_SACH);
  await coThay(hang(), 60_000);
  const sau = (await hang().innerText()).replace(/\s+/g, " ");
  ca.buoc({ actor, action: `Kích hoạt ${MA_CHINH_SACH_CHUNG} (văn bản UAT-VB-01, hiệu lực sớm nhất hợp lệ)`, input: { ngayHieuLuc: `${dd}/${mm}/${yyyy}` }, expected: "dòng chính sách chuyển sang «Đang áp dụng»", actual: sau.slice(0, 200), pass: /Đang áp dụng/.test(sau), screenshots: [await ca.chup(page, "chinh-sach-sau-kich-hoat", { fullPage: false })] });
});

/** Nâng «Trần tổng hoa hồng» (`crm.commissionMaxTotalRate`) lên 0.10 — CHỈ khi guardrail VUOT_TRAN chặn kích hoạt. Hệ thống không tự nâng/cắt; đây là thao tác của Admin kèm lý do. */
async function nangTran(ca: NhatKyCa, page: Page, actor: string): Promise<void> {
  await di(page, "/cau-hinh-van-hanh?tab=khach-hang");
  const o = page.locator("#o-crm-commissionMaxTotalRate");
  await expect(o).toBeVisible({ timeout: 60_000 });
  await choHydrate(o);
  const truoc = await o.inputValue();
  await o.fill("0.10");
  const oLyDo = page.getByPlaceholder("Vì sao đổi? (bắt buộc)");
  await expect(oLyDo).toBeVisible({ timeout: 15_000 });
  await oLyDo.fill(LY_DO("nang tran hoa hong 10 phan tram"));
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect.poll(async () => {
    await di(page, "/cau-hinh-van-hanh?tab=khach-hang");
    const c = page.locator("#o-crm-commissionMaxTotalRate");
    return (await coThay(c, 60_000)) ? await c.inputValue() : "khong-thay";
  }, { timeout: 90_000, intervals: [2_000, 4_000] }).toBe("0.1");
  ca.buoc({ actor, action: "Nâng trần tổng hoa hồng (guardrail VUOT_TRAN chặn kích hoạt) kèm lý do", input: { truoc, sau: "0.10" }, expected: "ô trần = 0.1 sau khi tải lại", actual: "0.1", pass: true, screenshots: [await ca.chup(page, "tran-sau-nang", { fullPage: false })] });
}

test("[SRC-43] Đặt MỐC CUTOVER ở «Chuyển sang hoa hồng mới» (Admin) — idempotent, KHÔNG BAO GIỜ dời mốc đã có", async ({ ca, moVai }) => {
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  await di(page, DUONG_CUTOVER);
  const oThang = page.locator("#cutover-thang");
  if (!(await coThay(oThang, 90_000))) ca.biChan("Không mở được trang «Chuyển sang hoa hồng mới» (ô tháng không hiện): thiếu `settings:view` hoặc trang lỗi.");
  await choHydrate(oThang);
  const khoiHienTai = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const chuaDat = /Chưa đặt mốc/.test(khoiHienTai);
  const daCoMoc = /Mốc hiện tại[^.]*?(\d{2}\/\d{4})/.exec(khoiHienTai);
  ca.thongTin(actor, "Đọc khối «Mốc hiện tại»", { chuaDat, mocDangCo: daCoMoc?.[1] ?? null, trich: khoiHienTai.slice(khoiHienTai.indexOf("Mốc hiện tại"), khoiHienTai.indexOf("Mốc hiện tại") + 160) });
  if (!chuaDat) {
    ca.buoc({
      actor,
      action: "ALREADY_DONE — mốc cutover đã đặt; KHÔNG dời (mốc không dời được sau khi engine ghi sổ)",
      input: DUONG_CUTOVER,
      expected: "đã có mốc; ca không đổi gì",
      actual: { moc: daCoMoc?.[1] ?? "(không đọc được tháng)" },
      pass: daCoMoc !== null,
      screenshots: [await ca.chup(page, "moc-da-co", { fullPage: false })],
    });
    return;
  }

  // Tháng đề xuất = ô mặc định của trang (tháng SAU tháng hiện tại giờ VN — cùng quy tắc `thangCutoverSomNhat` của bộ nạp, nên hai nơi cùng một kỳ T).
  const thangDeXuat = await oThang.inputValue();
  await page.getByRole("button", { name: "Xem trước tác động" }).click();
  const khoiChan = page.locator("section[aria-label='Vấn đề chặn']");
  await expect(khoiChan).toBeVisible({ timeout: 120_000 });
  const chu = (await khoiChan.innerText()).replace(/\s+/g, " ");
  const khongChan = /Không còn vấn đề chặn/.test(chu);
  const maChan = [...new Set(chu.match(/\b(?:CO_[A-Z_]+|DI_TRU_CHUA_SAN_SANG|THIEU_BANG_CHUNG)\b/g) ?? [])];
  ca.thongTin(actor, "Xem trước tác động của mốc", { thangDeXuat, khongChan, maChan }, thangDeXuat);
  await ca.chup(page, "xem-truoc-moc");
  if (!khongChan) ca.biChan(`Trang báo còn vấn đề chặn khi đặt mốc ${thangDeXuat}: ${maChan.join(", ") || chu.slice(0, 200)} — xử lý theo cột «Sửa ở đâu» của trang (vét lead cũ · kích hoạt chính sách chung SRC-42 · hàng chờ…) rồi chạy lại.`);

  const lyDo = LY_DO(`dat moc ${thangDeXuat}`);
  await page.locator("#cutover-ly-do").fill(lyDo);
  await page.getByRole("button", { name: "Đặt mốc", exact: true }).click();
  await expect.poll(async () => {
    await di(page, DUONG_CUTOVER);
    if (!(await coThay(page.locator("#cutover-thang"), 60_000))) return "khong-thay";
    return /Chưa đặt mốc/.test((await page.locator("main").innerText()).replace(/\s+/g, " ")) ? "chua-dat" : "da-dat";
  }, { timeout: 120_000, intervals: [2_000, 4_000, 8_000] }).toBe("da-dat");
  const sau = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const mocSau = /Mốc hiện tại[^.]*?(\d{2}\/\d{4})/.exec(sau)?.[1] ?? null;
  const [nam, thang] = thangDeXuat.split("-");
  ca.buoc({ actor, action: "Đặt mốc cutover ở tháng mặc định của trang, kèm lý do", input: { thang: thangDeXuat, lyDo }, expected: `«Mốc hiện tại» = ${thang}/${nam}`, actual: mocSau, pass: mocSau === `${thang}/${nam}`, screenshots: [await ca.chup(page, "moc-sau-dat")] });
});

test("[SRC-44] Các tab Chính sách · Sổ · Kỳ · Khiếu nại hiện đủ và mở được khi engine đã bật (đợi cờ có hiệu lực ≤ 5 phút)", async ({ ca, moVai }) => {
  test.setTimeout(600_000); // đợi cờ có hiệu lực (cache cài đặt ≤ 300 giây) dài hơn trần 4 phút/ca mặc định
  const ad = await moVai("admin");
  const page = ad.page;
  const actor = nhanActor("admin");
  const tab = [
    { ten: "Sổ hoa hồng", duong: "/nguon-hoa-hong/so" },
    { ten: "Kỳ", duong: "/nguon-hoa-hong/ky" },
    { ten: "Chính sách", duong: "/nguon-hoa-hong/chinh-sach" },
    { ten: "Khiếu nại & lịch sử", duong: "/nguon-hoa-hong/khieu-nai" },
  ];
  for (const t of tab) {
    // 404 khi cờ chưa có hiệu lực (cache ≤ 300 giây): đọc theo trạng thái trả về, không đoán từ thân trang.
    const ketQua = await expect.poll(async () => {
      const r = await page.goto(t.duong, { waitUntil: "domcontentloaded", timeout: 60_000 });
      return r?.status() ?? 0;
    }, { timeout: 420_000, intervals: [5_000, 15_000, 30_000] }).toBe(200).then(() => 200, () => 0);
    ca.buoc({ actor, action: `Mở tab «${t.ten}»`, input: t.duong, expected: "HTTP 200 (tab hiện khi engine bật)", actual: ketQua, pass: ketQua === 200 });
  }
  await ca.chup(page, "tab-cuoi", { fullPage: false });
});
