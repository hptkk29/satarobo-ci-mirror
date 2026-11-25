/**
 * LANE C1 «NGUỒN Ở LỚP NHẬP» — màn Nhập khách hàng + Sheet «Gán nguồn / Đổi nguồn» ở BỐN khung 375 · 768 · 1280 · 1920, trình duyệt thật.
 *
 * Chỉ LỖI CHỨC NĂNG mới làm đỏ (CAO của `quetMan`: tràn ngang · phần tử ngoài khung · bị che · vùng chạm < 28px). Chưa đẹp (THẤP) ghi vào đính kèm `quet-375-*`.
 *
 *   [SRC-ENT-15] Nhập khách: ô «Nguồn khách hàng» là hộp chọn có tìm kiếm; mở danh sách; tìm KHÔNG DẤU ra đúng nguồn; chọn nguồn bắt giải trình ⇒ hiện ô «Giải trình nguồn»;
 *                bấm Lưu với giải trình ngắn ⇒ lỗi hiện cạnh ô (role=alert) và máy chủ KHÔNG nhận phiếu
 *   [SRC-ENT-16] Chi tiết lead: nút «Đổi nguồn» mở Sheet «Gán nguồn» dùng được (hộp chọn mở/tìm/đóng bằng Esc, rồi Esc đóng Sheet)
 *
 * Dựng hiện trường bằng `affiliate-hien-truong` (bẫy cờ nằm trong bộ nhớ đệm server + cổng chặn dò mật khẩu 5 lượt/phút/định danh đã xử lý ở đó): MỘT nguồn tuỳ biến `requiresNote`, MỘT lead
 * đã có quy nguồn. Không `mode: "serial"` (một khung hỏng không che khung sau).
 */
import { test, expect, type Page } from "@playwright/test";

import { db } from "../../../lib/db";
import { ADMIN_EMAIL, damBaoNenDuLieu, dangNhapCoNho, datCoTrongDb, datCoVaLamMoi, lamMoiBoNhoCauHinh } from "../_helpers/affiliate-hien-truong";
import { cao, quetMan, thap, type KetQuaMan } from "../_helpers/quet-375";

const KHUNG = [
  { ten: "375", w: 375, h: 812, dienThoai: true },
  { ten: "768", w: 768, h: 1024, dienThoai: false },
  { ten: "1280", w: 1280, h: 800, dienThoai: false },
  { ten: "1920", w: 1920, h: 1080, dienThoai: false },
] as const;

const TEN_NGUON_GIAI_TRINH = "Hội thảo ngoài trung tâm";
let leadId = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await damBaoNenDuLieu();
  const goc = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "PAID_ADS" }, select: { id: true } });
  await db.leadSourceGroup.create({
    data: { code: "E2E_GIAI_TRINH", name: TEN_NGUON_GIAI_TRINH, requiresNote: true, selectable: true, status: "ACTIVE", referrerRequirement: "NONE", sortOrder: 95 },
  });
  const trungTam = await db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const lead = await db.lead.create({ data: { parentName: "E2E Nguồn Lead", phone: "0907300001", centerId: trungTam.id } });
  await db.leadAttribution.create({
    data: { leadId: lead.id, groupId: goc.id, originalGroupId: goc.id, identificationMethod: "MANUAL", matchedRule: "KHAI_TAY", reasonText: "e2e SRC-ENT" },
  });
  leadId = lead.id;
  await datCoVaLamMoi(browser, { nguon: true, affiliate: false });
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await datCoTrongDb({ nguon: false, affiliate: false });
  await lamMoiBoNhoCauHinh(browser);
});

function chot(k: KetQuaMan): void {
  // THẤP (chưa đẹp) không làm đỏ — in ra để người rà thiết kế thấy (đính kèm JSON đầy đủ nằm ở `info.attach` của `quetMan`).
  for (const p of thap(k)) console.log(`[SRC-ENT][THAP] ${k.man}: [${p.loai}] ${p.chiTiet}`);
  const hong = cao(k);
  expect(hong, `${k.man}: ${hong.length} phát hiện CAO\n${hong.map((h) => `  - [${h.loai}] ${h.chiTiet}`).join("\n")}`).toEqual([]);
}

async function vaoAdmin(page: Page, duong: string, cho: () => Promise<unknown>): Promise<void> {
  await dangNhapCoNho(page, ADMIN_EMAIL);
  await page.goto(duong, { timeout: 120_000 });
  await cho();
  await page.waitForTimeout(400); // chờ bố cục ổn định
}

for (const k of KHUNG) {
  test.describe(`khung ${k.ten}px`, () => {
    test.use({ viewport: { width: k.w, height: k.h }, isMobile: k.dienThoai, hasTouch: k.dienThoai, deviceScaleFactor: k.dienThoai ? 2 : 1 });

    test(`[SRC-ENT-15] Nhập khách hàng @${k.ten}: hộp chọn nguồn có tìm kiếm + giải trình + lỗi hiện cạnh ô`, async ({ page }, info) => {
      test.setTimeout(240_000);
      await vaoAdmin(page, "/admin/nhap-khach-hang", () => expect(page.getByRole("combobox", { name: /Nguồn khách hàng/ })).toBeVisible({ timeout: 90_000 }));
      // đối chứng dương: ô gõ tự do cũ KHÔNG còn (module BẬT ⇒ không đường vòng gõ tay)
      await expect(page.getByLabel("Nguồn", { exact: true })).toHaveCount(0);
      chot(await quetMan(page, info, `15a-nhap-khach-${k.ten}`));

      const o = page.getByRole("combobox", { name: /Nguồn khách hàng/ });
      await o.scrollIntoViewIfNeeded();
      await o.focus();
      await page.keyboard.press("ArrowDown"); // bàn phím mở được
      const ds = page.getByRole("listbox", { name: "Danh sách nguồn khách hàng" });
      await expect(ds).toBeVisible();
      await expect(page.getByRole("searchbox", { name: "Tìm nguồn" })).toBeFocused();
      chot(await quetMan(page, info, `15b-mo-danh-sach-${k.ten}`));

      // tìm KHÔNG DẤU ra đúng nguồn bắt giải trình
      await page.keyboard.type("hoi thao");
      await expect(ds.getByRole("option")).toHaveCount(1);
      await page.keyboard.press("Enter");
      await expect(ds).toBeHidden();
      await expect(o).toContainText(TEN_NGUON_GIAI_TRINH);

      const gt = page.getByLabel(/Giải trình nguồn/);
      await expect(gt).toBeVisible();
      await page.getByLabel("SĐT phụ huynh").fill("0907300999");
      await gt.fill("ngắn");
      await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
      const loi = page.getByRole("alert").filter({ hasText: /giải trình từ 10 ký tự/ });
      await expect(loi).toBeVisible();
      await expect(gt).toHaveAttribute("aria-invalid", "true");
      // Toast báo lỗi (sonner) tự tắt sau vài giây; nó phủ thanh trên cùng ở khung hẹp nên đo SAU khi nó tắt — đo lúc nó còn là đo hiện vật tạm, không phải bố cục. Lỗi cạnh ô (role=alert) vẫn còn.
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
      await expect(loi).toBeVisible();
      chot(await quetMan(page, info, `15c-loi-giai-trinh-${k.ten}`));
      // máy chủ KHÔNG nhận phiếu bị chặn ở trình duyệt
      expect(await db.lead.count({ where: { phone: { in: ["0907300999", "84907300999"] } } })).toBe(0);
    });

    test(`[SRC-ENT-16] Sheet «Gán nguồn» @${k.ten}: mở · hộp chọn mở/tìm · Esc đóng hộp rồi Esc đóng Sheet`, async ({ page }, info) => {
      test.setTimeout(240_000);
      await vaoAdmin(page, `/admin/leads/${leadId}`, () => expect(page.getByRole("button", { name: "Đổi nguồn của lead này" })).toBeVisible({ timeout: 90_000 }));
      await page.getByRole("button", { name: "Đổi nguồn của lead này" }).click();
      const sheet = page.getByRole("dialog", { name: /Gán nguồn/ });
      await expect(sheet).toBeVisible();
      const o = sheet.getByRole("combobox", { name: /Nguồn khách hàng/ });
      await expect(o).toBeVisible({ timeout: 60_000 });
      // `quetMan` KHÔNG thấy tràn ngang BÊN TRONG Sheet (Sheet là vùng cuộn riêng nên nó tự hấp thụ chiều rộng thừa) ⇒ đo thẳng: Sheet không cuộn ngang được và hộp chọn nằm trọn trong Sheet.
      const dongKhung = async () => {
        const tran = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
        const s = (await sheet.boundingBox())!;
        const b = (await o.boundingBox())!;
        return { tran, ngoai: Math.round(b.x + b.width - (s.x + s.width)), trai: Math.round(s.x - b.x) };
      };
      const kd = await dongKhung();
      expect(kd.tran, "Sheet «Gán nguồn» kéo ngang được ⇒ có phần tử tràn khỏi khung").toBeLessThanOrEqual(1);
      expect(kd.ngoai, "hộp chọn nguồn thò ra khỏi mép phải Sheet").toBeLessThanOrEqual(1);
      expect(kd.trai, "hộp chọn nguồn thò ra khỏi mép trái Sheet").toBeLessThanOrEqual(1);
      chot(await quetMan(page, info, `16a-sheet-${k.ten}`));

      await o.click();
      const ds = sheet.getByRole("listbox", { name: "Danh sách nguồn khách hàng" });
      await expect(ds).toBeVisible();
      chot(await quetMan(page, info, `16b-sheet-mo-danh-sach-${k.ten}`));
      await page.keyboard.press("Escape");
      await expect(ds).toBeHidden();
      await expect(sheet).toBeVisible(); // Esc đầu chỉ đóng hộp chọn, KHÔNG đóng cả Sheet
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    });
  });
}
