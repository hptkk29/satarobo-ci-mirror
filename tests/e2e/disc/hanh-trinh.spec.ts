/**
 * [DISC-E2E-HT-*] HÀNH TRÌNH ĐẦU-CUỐI trên TRÌNH DUYỆT THẬT với ENGINE THẬT (chạy với DISC_E2E_FLAG=on, dev server có DISC_ENABLED=true
 * và Postgres `satarobo_test`; OTP/email/ZNS không gửi gì ra ngoài). Dữ liệu 100% GIẢ (tên tiền tố "DISCDB").
 *   K01/K05/K14 /disc → hồ sơ (≥1 PH + ≥1 HS) → làm bài thật → lưu → thành công (mã nhận) ở 320 · 375 · 768 · 1440
 *   K-PDF       nút "Tải kết quả (PDF)" tải được PDF thật (%PDF), tên tệp trung tính
 *   K16/K17     refresh giữa bài ⇒ bản nháp, "Làm tiếp" giữ nguyên câu đã trả lời; URL/tiêu đề không mang dữ liệu trẻ
 *   K18/K19     mất mạng khi lưu ⇒ lỗi thật + thử lại được (cùng khoá idempotency ⇒ không tạo hai bài); 429 / 503 nói đúng
 *   Loading     bộ đề chậm ⇒ nút ở trạng thái đang tải (aria-busy), không bấm đúp được
 *   K08/K09     không email ⇒ không nói "sẽ gửi liên kết"; có email ⇒ nói "xác nhận email", không hứa đã gửi báo cáo
 * Ảnh chụp: docs/disc-tich-hop/ui-evidence/hanh-trinh/.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CO_DISC, tranNgangPx } from "./_khung";

test.skip(CO_DISC !== "on", "Cần DISC_E2E_FLAG=on (cờ BẬT)");

// Mỗi ca một IP giả (RFC 5737) để KHÔNG dính trần tần suất theo IP của /api/disc/luu (10 lượt/10 phút) — trần đó là thật và đã được thấy hoạt động
// (lần chạy đầu: 429 "thử quá nhiều lần" hiện đúng ở màn lưu). Spec 429 ở dưới tự giả lập bằng route.fulfill.
let ipSeqE2e = Math.floor(Math.random() * 200);
test.beforeEach(async ({ context }) => {
  ipSeqE2e = (ipSeqE2e % 250) + 1;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${ipSeqE2e}` });
  // Popup học thử (z-110, bật sau 20s ở mọi trang public) chặn bấm ở các ca dài — lỗi ĐÃ GHIM riêng ở popup-hoc-thu.spec.ts; đóng sẵn để ca này đo đúng thứ nó đo.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("satarobo-popup-hoc-thu-da-gui", "1");
    } catch {
      /* bỏ qua */
    }
  });
});

const ANH = path.join(process.cwd(), "docs", "disc-tich-hop", "ui-evidence", "hanh-trinh");
const NAM = new Date().getFullYear();
let seq = 0;
const sdtMoi = () => `0905${String((Date.now() % 900_000) + 100_000 + (seq += 7)).slice(-6)}`;

type Chup = (ten: string) => Promise<void>;
const chupCua = (page: Page, w: number): Chup => async (ten) => {
  fs.mkdirSync(ANH, { recursive: true });
  // Ảnh là BẰNG CHỨNG chứ không phải khẳng định: chờ font ngoài có thể treo (đo 02/11: 1 lần treo 150s) ⇒ giới hạn 20s, không làm đỏ ca.
  await page.screenshot({ path: path.join(ANH, `${ten}-${w}.png`), fullPage: true, timeout: 20_000 }).catch(() => {});
};

async function dienHoSo(page: Page, o: { bac?: string; namBe?: number } = {}) {
  await page.getByLabel("Họ và tên").fill("DISCDB Nguyễn Thị Hạnh");
  await page.getByLabel("Năm sinh", { exact: true }).fill("1988");
  await page.getByText("Mẹ", { exact: true }).first().click();
  await page.getByLabel("Tên của bé").fill("Lê Minh Bảo");
  await page.getByLabel("Năm sinh của bé").fill(String(o.namBe ?? NAM - 10));
  await page.getByLabel("Lớp / bậc học hiện tại").selectOption(o.bac ?? "4");
}

/** Trả lời hết một bộ đề: chu kỳ qua MỌI mức của thang đang hiện (đi qua hàng rào "trả lời phẳng"). */
async function lamBoDe(page: Page, tuCau = 0, dung?: number): Promise<number> {
  let i = tuCau;
  for (let guard = 0; guard < 80; guard++) {
    const vung = page.getByTestId("disc-lam-bai");
    await expect(vung).toBeVisible();
    const nhan = vung.locator("fieldset label");
    const n = await nhan.count();
    await nhan.nth(i % n).click();
    i++;
    if (dung !== undefined && i >= dung) return i;
    const xong = page.getByTestId("disc-cau-xong");
    if (await xong.isVisible().catch(() => false)) {
      if (await xong.isEnabled()) {
        await xong.click();
        return i;
      }
    }
    await page.getByTestId("disc-cau-tiep").click();
  }
  throw new Error("không kết thúc được bộ đề");
}

async function luuVaoThanhCong(page: Page, sdt: string, email?: string) {
  await expect(page.getByTestId("disc-hoan-thanh")).toBeVisible();
  await page.getByLabel(/Số điện thoại/).fill(sdt);
  if (email) await page.getByLabel(/Email/).fill(email);
  await page.getByRole("checkbox").first().check();
  await page.getByTestId("disc-luu-gui").click();
}

for (const kn of [
  { w: 320, h: 640 },
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
]) {
  test.describe(`[DISC-E2E-HT] hành trình đầy đủ ${kn.w}x${kn.h}`, () => {
    test.use({ viewport: { width: kn.w, height: kn.h } });

    test("/disc → hồ sơ → bài PH → bài HS → lưu → thành công → tải PDF thật", async ({ page }) => {
      test.setTimeout(150_000);
      const chup = chupCua(page, kn.w);
      const loiConsole: string[] = [];
      page.on("pageerror", (e) => loiConsole.push(String(e)));

      await page.goto("/disc");
      await chup("00-landing");
      await page.getByRole("link", { name: /bắt đầu|làm bài/i }).first().click();
      await expect(page).toHaveURL(/\/disc\/bat-dau$/);
      await expect(page.getByTestId("disc-ho-so")).toBeVisible();
      await chup("01-ho-so");

      await dienHoSo(page);
      await page.getByTestId("disc-ho-so-tiep").click();
      await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
      await chup("02-lam-bai-ph");
      // Bộ thật của bé lớp 4 (TH): thang 3 mức ⇒ đúng 3 lựa chọn ở phần bé. Phần PH 5 mức.
      expect(await page.getByTestId("disc-lam-bai").locator("fieldset label").count()).toBe(5);
      await lamBoDe(page);

      await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
      expect(await page.getByTestId("disc-lam-bai").locator("fieldset label").count()).toBe(3); // thang 3 mức của bộ Tiểu học (lỗi tích hợp đã sửa)
      await expect(page.getByTestId("disc-cau-dan")).toContainText(/giống em nhất/);
      await chup("03-lam-bai-hs");
      await lamBoDe(page);

      await expect(page.getByTestId("disc-hoan-thanh")).toBeVisible();
      await chup("04-hoan-thanh");
      const sdt = sdtMoi();
      await luuVaoThanhCong(page, sdt);
      await expect(page.getByTestId("disc-thanh-cong")).toBeVisible({ timeout: 20_000 });
      await chup("05-thanh-cong");
      await expect(page.getByTestId("disc-ma-nhan")).toHaveText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      await expect(page.getByTestId("disc-tb-email")).toHaveCount(0); // không email ⇒ không hứa gửi gì

      // PDF thật
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("disc-tai-pdf").click()]);
      expect(dl.suggestedFilename()).toBe("ket-qua-disc.pdf");
      const file = path.join(ANH, `ket-qua-${kn.w}.pdf`);
      await dl.saveAs(file);
      const bytes = fs.readFileSync(file);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(3_000);
      await expect(page.getByTestId("disc-tai-pdf-tt")).toContainText("Đã tải về");

      // Không lộ dữ liệu trẻ/SĐT qua URL · tiêu đề · localStorage · thân trang
      expect(page.url()).toMatch(/\/disc\/bat-dau$/);
      const tieuDe = await page.title();
      expect(tieuDe).not.toMatch(/Bảo|Hạnh|DISCDB/);
      const kho = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      expect(kho).not.toContain(sdt);
      expect(kho).not.toContain(sdt.slice(1));
      expect(await tranNgangPx(page)).toBeLessThanOrEqual(1);
      expect(loiConsole).toEqual([]);
    });
  });
}

test.describe("[DISC-E2E-HT] trạng thái & lỗi", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("bộ đề chậm ⇒ nút ở trạng thái đang tải, không bấm đúp được (loading)", async ({ page }) => {
    const chup = chupCua(page, 375);
    let dem = 0;
    await page.route("**/api/disc/bo-de", async (r) => {
      dem++;
      await new Promise((x) => setTimeout(x, 1_500));
      await r.continue();
    });
    await page.goto("/disc/bat-dau");
    await dienHoSo(page);
    const nut = page.getByTestId("disc-ho-so-tiep");
    await nut.click();
    await expect(page.getByTestId("disc-ho-so")).toHaveAttribute("aria-busy", "true");
    await expect(nut).toBeDisabled();
    await chup("10-dang-tai-bo-de");
    await expect(page.getByTestId("disc-lam-bai")).toBeVisible({ timeout: 15_000 });
    expect(dem).toBe(2); // PH + HS, mỗi người một lần — không có lượt thừa do bấm đúp
  });

  test("bộ đề lỗi 503 ENGINE_CHUA_SAN_SANG / 429 ⇒ nói đúng, ở lại hồ sơ", async ({ page }) => {
    const chup = chupCua(page, 375);
    await page.route("**/api/disc/bo-de", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }) }));
    await page.goto("/disc/bat-dau");
    await dienHoSo(page);
    await page.getByTestId("disc-ho-so-tiep").click();
    const canhBao = page.getByTestId("disc-ho-so").getByRole("alert");
    await expect(canhBao).toBeVisible();
    await expect(canhBao).toContainText(/nhiều lần|thử lại/i);
    await chup("11-bo-de-429");
    await page.unroute("**/api/disc/bo-de");
    await page.route("**/api/disc/bo-de", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" }) }));
    await page.getByTestId("disc-ho-so-tiep").click();
    await expect(page.getByTestId("disc-dang-hoan-thien")).toBeVisible();
    await chup("12-bo-de-503-dang-hoan-thien");
  });

  test("refresh giữa bài ⇒ bản nháp: 'Làm tiếp' giữ câu đã trả lời; URL/tiêu đề trung tính", async ({ page }) => {
    const chup = chupCua(page, 375);
    await page.goto("/disc/bat-dau");
    await dienHoSo(page);
    await page.getByTestId("disc-ho-so-tiep").click();
    await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
    await lamBoDe(page, 0, 4); // trả lời 4 câu đầu rồi dừng
    await expect(page.getByTestId("disc-lam-bai")).toContainText("Câu 4 /");
    await page.reload();
    await expect(page.getByTestId("disc-ban-nhap")).toBeVisible();
    await chup("13-ban-nhap-sau-refresh");
    expect(page.url()).toMatch(/\/disc\/bat-dau$/);
    expect(await page.title()).not.toMatch(/Bảo|Hạnh|DISCDB/);
    await page.getByTestId("disc-ban-nhap-tiep").click();
    // Riêng tư: họ tên KHÔNG được giữ — hai ô tên trống, năm sinh còn; gõ lại tên rồi quay đúng chặng đang dở.
    await expect(page.getByTestId("disc-da-khoi-phuc")).toBeVisible();
    await expect(page.getByLabel("Họ và tên")).toHaveValue("");
    await expect(page.getByLabel("Tên của bé")).toHaveValue("");
    await expect(page.getByLabel("Năm sinh", { exact: true })).toHaveValue("1988");
    await chup("13b-sau-lam-tiep-nhap-lai-ten");
    await page.getByLabel("Họ và tên").fill("DISCDB Nguyễn Thị Hạnh");
    await page.getByLabel("Tên của bé").fill("Lê Minh Bảo");
    await page.getByTestId("disc-ho-so-tiep").click();
    await expect(page.getByTestId("disc-lam-bai")).toBeVisible();
    await expect(page.getByTestId("disc-lam-bai")).toContainText("Câu 4 /");
    // Quay lại: câu 1 vẫn còn lựa chọn đã chọn
    const dau = page.getByTestId("disc-lam-bai");
    for (let k = 0; k < 3; k++) {
      const truoc = page.getByTestId("disc-cau-truoc");
      if (await truoc.isVisible()) await truoc.click();
    }
    await expect(dau).toContainText("Câu 1");
    expect(await dau.locator("input[type=radio]:checked").count()).toBe(1);
    // Bản nháp nằm trong sessionStorage (chết khi đóng tab), KHÔNG localStorage, KHÔNG chứa tên/SĐT/điểm
    const phien = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(phien).toContain("ban-nhap:v2");
    expect(phien).not.toMatch(/soDienThoai|"diem"|email|Hạnh|Bảo|DISCDB|hoTen/);
    expect(local).not.toContain("ban-nhap");
  });

  test("mất mạng khi lưu ⇒ lỗi thật, thử lại được, KHÔNG nói 'đã lưu' sai; 503 cũng vậy", async ({ page }) => {
    test.setTimeout(150_000);
    const chup = chupCua(page, 375);
    await page.goto("/disc/bat-dau");
    await dienHoSo(page);
    await page.getByTestId("disc-ho-so-tiep").click();
    await lamBoDe(page);
    await lamBoDe(page);
    await page.route("**/api/disc/luu", (r) => r.abort("connectionreset"));
    await luuVaoThanhCong(page, sdtMoi());
    await expect(page.getByTestId("disc-loi-luu")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("disc-thanh-cong")).toHaveCount(0);
    await chup("14-mat-mang-khi-luu");
    await page.unroute("**/api/disc/luu");
    await page.route("**/api/disc/luu", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, loi: "LUU_THAT_BAI" }) }));
    await page.getByTestId("disc-luu-gui").click();
    await expect(page.getByTestId("disc-loi-luu")).toBeVisible();
    await expect(page.getByTestId("disc-thanh-cong")).toHaveCount(0);
    await page.unroute("**/api/disc/luu");
    await page.route("**/api/disc/luu", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }) }));
    await page.getByTestId("disc-luu-gui").click();
    await expect(page.getByTestId("disc-loi-luu")).toContainText(/nhiều lần|thử lại/i);
    await chup("15-luu-429");
    // Hết lỗi ⇒ lưu được
    await page.unroute("**/api/disc/luu");
    await page.getByTestId("disc-luu-gui").click();
    await expect(page.getByTestId("disc-thanh-cong")).toBeVisible({ timeout: 20_000 });
  });

  test("có email ⇒ nói 'xác nhận email', không hứa đã gửi báo cáo", async ({ page }) => {
    test.setTimeout(150_000);
    const chup = chupCua(page, 375);
    await page.goto("/disc/bat-dau");
    await dienHoSo(page, { bac: "7", namBe: NAM - 13 });
    await page.getByTestId("disc-ho-so-tiep").click();
    await lamBoDe(page);
    await lamBoDe(page);
    await luuVaoThanhCong(page, sdtMoi(), `khach-${Date.now().toString(36)}@example.test`);
    await expect(page.getByTestId("disc-thanh-cong")).toBeVisible({ timeout: 20_000 });
    const tb = page.getByTestId("disc-tb-email");
    await expect(tb).toBeVisible();
    await expect(tb).not.toContainText(/đã gửi (báo cáo|kết quả)/i);
    await chup("16-thanh-cong-co-email");
  });

  test("bé nhỏ (6 tuổi, lớp 1) ⇒ ba/mẹ trả lời hộ, bộ quan sát", async ({ page }) => {
    const chup = chupCua(page, 375);
    await page.goto("/disc/bat-dau");
    await dienHoSo(page, { bac: "1", namBe: NAM - 6 });
    await page.getByTestId("disc-ho-so-tiep").click();
    await lamBoDe(page);
    await expect(page.getByTestId("disc-nguoi-lon-tra-loi-ho")).toBeVisible();
    await expect(page.getByTestId("disc-cau-dan")).toBeVisible();
    await chup("17-be-nho-nguoi-lon-tra-loi-ho");
  });
});
