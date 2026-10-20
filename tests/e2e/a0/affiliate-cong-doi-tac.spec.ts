/**
 * AFF-L4 — CỔNG ĐỐI TÁC `/portal/gioi-thieu` qua TRÌNH DUYỆT THẬT + PHẢN HỒI MÁY CHỦ (yêu cầu §17 + §18).
 *
 * Bộ vitest `tests/hoa-hong/affiliate-portal.spec.ts` ([AFR-PT-DB-*]) đã khoá cách ly và PII ở TẦNG TRUY VẤN và ở HTML dựng bằng `renderToStaticMarkup`. Bộ này khoá thứ mà chúng không với tới:
 * phiên đăng nhập THẬT → layout portal → trang → thứ RỜI MÁY CHỦ (HTML đầy đủ gồm `self.__next_f`, và luồng RSC thuần `RSC: 1`) — cùng đường `/r/<token>` và `/intake` mà khách thật đi.
 *
 *   [APC-01] đối tác đăng nhập, thấy campaign + link của mình + mục menu «Giới thiệu»
 *   [APC-02] luồng thật: `/r/<token>` ⇒ 302 kèm aff/cmp/clk ⇒ `/intake` bằng token đó ⇒ 200 ⇒ referral (mã rút gọn, không PII) hiện ở cổng, lượt bấm +1
 *   [APC-03] hoa hồng ⇔ `partnerCanViewAmount`: ẨN (null) / HIỆN (true) / ẨN tường minh (false) — số tiền vắng khỏi HTML lẫn RSC khi ẩn; đủ bốn trạng thái chi khi hiện
 *   [APC-04] CROSS-USER: A không thấy token / tên / mã hồ sơ / tiền của B (cả HTML lẫn RSC, kể cả khi ép tham số URL); B cũng không thấy A
 *   [APC-05] PII trong PHẢN HỒI MÁY CHỦ: không tên / SĐT (0… lẫn 84…) / email khách, không học phí, không ghi chú nội bộ của Sale, không id lead, không SĐT / email đối tác
 *   [APC-06] cờ tắt (cả hai chiều) ⇒ cổng 404 + không mục menu; `/r` chuyển trang sạch, `/intake` 200 vẫn lưu khách (không referral); bật lại ⇒ có lại
 *   [APC-07] tài khoản bị TẠM NGỪNG cổng ⇒ 404 + không menu (đối chứng: đối tác kia vẫn vào); mở lại ⇒ vào được
 *   [APC-08] tài khoản đối tác CHƯA có học viên ⇒ không mục menu, không dữ liệu (đối chứng: có học viên ⇒ có)
 *
 * ── Môi trường ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Đi ké job CI `a0` (Postgres LOCAL `ci_test_a0`, `next start`). Cờ nằm trong BỘ NHỚ ĐỆM CỦA SERVER (300 giây) nên đổi cờ phải đi đường Server Action thật — xem `affiliate-hien-truong.ts`.
 * Shell cổng: CI để `PORTAL_V2_ENABLED` trống ⇒ shell v1 (`PortalNav`); chạy với `PORTAL_V2_ENABLED=true` thì là shell v2 (`v2-shell`) — mục menu soi bằng `a[href="/portal/gioi-thieu"]` nên đúng ở cả hai.
 * LUẬT 18: mỗi ca tự đặt lại thứ nó cần (cờ · trạng thái cổng · cờ hiện tiền) rồi trả về mặc định; có thể chạy riêng bằng `-g`.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

import { db } from "../../../lib/db";
import { maRutGonPhieu } from "../../../lib/affiliate/ghi-referral-dau-vao";
import { NHAN_CHI_DOI_TAC, NHAN_REFERRAL_DOI_TAC } from "../../../lib/affiliate/cua-toi";
import { dinhDangDong } from "../../../lib/hoa-hong/vi-sao";
import { HEADER_IP_E2E } from "../../../lib/security/client-ip";
import { KHACH } from "../../hoa-hong/_affiliate-so-fx";
import {
  KHACH_THEM,
  TIEN_A,
  TIEN_B,
  damBaoNenDuLieu,
  dangNhapCoNho,
  datCoTrongDb,
  datCoVaLamMoi,
  datHienTien,
  datTrangThaiCong,
  dungHienTruongDoiTac,
  layPhanHoiCong,
  lamMoiBoNhoCauHinh,
  lienKet,
  taoPhuHuynh,
  themSoCuaA,
  type HienTruong,
} from "../_helpers/affiliate-hien-truong";

// KHÔNG dùng mode "serial": mỗi ca tự đặt lại thứ nó cần (luật 18) nên một ca đỏ không được che các ca sau (serial bỏ qua phần còn lại ⇒ phép cấy lỗi chỉ thấy MỘT ca đỏ đầu tiên).
// Ca đỏ làm Playwright dựng lại worker ⇒ `beforeAll` chạy lại (đặt lại DB + cờ) nên trạng thái ca trước để lại không lan sang ca sau.

let f: HienTruong;
let soDaThem = false;
let ipDem = 0;
/** Mỗi lượt gọi công khai một IP riêng (`/r` và `/intake` có giới hạn tần suất theo IP). Dải 10.88.x.y là địa chỉ riêng (RFC 1918). */
const ipMoi = () => `10.88.${Math.floor(ipDem / 250)}.${(ipDem++ % 250) + 1}`;

const MENU = 'a[href="/portal/gioi-thieu"]';

async function dangNhapVaoCong(page: Page, email: string): Promise<void> {
  await dangNhapCoNho(page, email);
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
}

/**
 * Mục menu nằm ở LAYOUT portal, mà trang 404 do `app/not-found.tsx` (cấp gốc) vẽ thì layout KHÔNG dựng — nên soi menu trên chính trang 404 là soi một trang không có menu nào (xanh giả).
 * Soi trên một trang portal BÌNH THƯỜNG (`/portal`): `gioiThieu` = số link «Giới thiệu», `khac` = số link menu khác (đối chứng: nav có thật).
 */
async function soMucMenu(page: Page): Promise<{ gioiThieu: number; khac: number }> {
  await page.goto("/portal", { timeout: 120_000 });
  await expect(page.locator("a[href^='/portal']").first()).toBeAttached({ timeout: 60_000 });
  return {
    gioiThieu: await page.locator(MENU).count(),
    khac: await page.locator("a[href^='/portal/']:not([href='/portal/gioi-thieu'])").count(),
  };
}

/** 404 thật của Next: trang `app/not-found.tsx` («Không tìm thấy trang») và KHÔNG có khối nội dung của cổng. */
async function khangDinhKhongTimThay(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Không tìm thấy trang" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("main [data-gioi-thieu]")).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await damBaoNenDuLieu();
  f = await dungHienTruongDoiTac();
  await datCoVaLamMoi(browser, { nguon: true, affiliate: true });
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(180_000);
  // Trả cờ về mặc định (TẮT) cả trong DB lẫn ở bộ nhớ đệm của server, kẻo spec a0 chạy sau thừa hưởng cờ BẬT trong tối đa 5 phút.
  await datCoTrongDb({ nguon: false, affiliate: false });
  await db.systemSetting.deleteMany({ where: { key: { in: ["affiliate.enabled"] } } });
  await lamMoiBoNhoCauHinh(browser);
});

/** Đặt cờ cho ca rồi buộc server nhận (chỉ tốn một lượt Server Action khi cờ thật sự khác `dangCo`). */
let dangCo = { nguon: true, affiliate: true };
async function dam(browser: Browser, c: { nguon: boolean; affiliate: boolean }): Promise<void> {
  if (dangCo.nguon === c.nguon && dangCo.affiliate === c.affiliate) return;
  await datCoVaLamMoi(browser, c);
  dangCo = c;
}

test("[APC-01] đối tác đăng nhập ⇒ thấy campaign + link của mình + mục menu «Giới thiệu»; không thấy gì của đối tác kia", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await dam(browser, { nguon: true, affiliate: true });
  await dangNhapVaoCong(page, f.ua.email);

  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Giới thiệu bạn bè" })).toBeVisible();
  await expect(page.getByText(`Hồ sơ: ${f.x.doiTac.name}`)).toBeVisible();
  // thấy campaign mình tham gia + link riêng (địa chỉ ngắn mang token của A)
  const dongLink = page.locator("main [data-link]");
  await expect(dongLink).toHaveCount(1);
  await expect(dongLink).toContainText(f.x.campaign.name);
  await expect(dongLink.locator("[data-dia-chi]")).toContainText(`/r/${f.x.token}`);
  await expect(page.getByRole("button", { name: /sao chép/i }).first()).toBeVisible();
  // lượt bấm = 5 hợp lệ + 1 lỗi của A (không phải 7 của B)
  await expect(page.locator('main [data-so="luot-bam"]')).toHaveText("5");
  // menu
  // đối chứng ÂM: token / tên của B không có trên trang
  await expect(page.locator("body")).not.toContainText(f.pb.doiTac.name);
  expect(await page.content()).not.toContain(f.pb.token);
  // mục menu (ở layout, soi trên một trang portal thường)
  const menu = await soMucMenu(page);
  expect(menu.gioiThieu, "mục menu «Giới thiệu» phải có trong DOM của đối tác").toBeGreaterThan(0);
  expect(menu.khac, "đối chứng: nav có các mục khác").toBeGreaterThan(0);
});

test("[APC-02] luồng thật: /r/<token> ⇒ 302 kèm aff/cmp/clk ⇒ /intake bằng token đó ⇒ 200 ⇒ referral (mã rút gọn, không PII) hiện ở cổng và lượt bấm +1", async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await dam(browser, { nguon: true, affiliate: true });
  await dangNhapVaoCong(page, f.ua.email);
  await expect(page.locator('main [data-so="luot-bam"]')).toBeVisible({ timeout: 60_000 });
  const truoc = Number(await page.locator('main [data-so="luot-bam"]').innerText());
  const truocDaGhiNhan = Number(await page.locator('main [data-so="da-ghi-nhan"]').innerText());

  // (c) khách bấm link của đối tác
  const bam = await request.get(`/r/${f.x.token}`, { maxRedirects: 0, headers: { [HEADER_IP_E2E]: ipMoi() } });
  expect(bam.status()).toBe(302);
  const dich = new URL(bam.headers()["location"] ?? "");
  expect(dich.host).toBe(new URL(f.x.site.baseUrl).host);
  expect(dich.pathname).toBe("/khoa-robot");
  expect(dich.searchParams.get("aff")).toBe(f.x.token);
  expect(dich.searchParams.get("cmp")).toBe(f.x.campaign.code);
  const clk = dich.searchParams.get("clk");
  expect(clk, "clk (id lượt bấm) phải có dạng cuid").toMatch(/^c[a-z0-9]{20,}$/);
  expect(bam.headersArray().some((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sr_aff="))).toBe(true);
  expect(dich.toString()).not.toContain(f.x.doiTac.id); // địa chỉ đích không mang id nội bộ

  // (d) khách gửi biểu mẫu trên website đối tác (text/plain, Origin ∈ tên miền được phép của website)
  const sdt = `0905${String(Date.now()).slice(-6)}`;
  const gui = await request.post("/api/public/affiliate/v1/intake", {
    headers: { "content-type": "text/plain", origin: `https://${dich.host}`, [HEADER_IP_E2E]: ipMoi() },
    data: JSON.stringify({
      v: 1,
      token: f.x.token,
      idempotencyKey: `apc-02-${Date.now().toString(36)}`,
      parentName: "Lê Văn ApcKhachMoi",
      phone: sdt,
      email: "apc.khach.moi@example.com",
      clickId: clk,
      children: [{ fullName: "Bé ApcKhachMoi" }],
      consentMarketing: true,
    }),
  });
  expect(gui.status(), await gui.text()).toBe(200);
  expect((await gui.json()).ok).toBe(true);

  // referral thật đã được ghi: VALID, đúng đối tác A
  const lead = await db.lead.findFirstOrThrow({ where: { phone: { in: [sdt, `84${sdt.slice(1)}`] }, deletedAt: null }, select: { id: true } });
  const rf = await db.affiliateReferral.findFirstOrThrow({ where: { leadId: lead.id }, select: { status: true, partyId: true, campaignId: true } });
  expect(rf).toMatchObject({ status: "VALID", partyId: f.x.doiTac.id, campaignId: f.x.campaign.id });
  const ma = maRutGonPhieu(lead.id);

  // (e) cổng của A: referral xuất hiện bằng MÃ RÚT GỌN, lượt bấm +1, KHÔNG PII của khách vừa gửi
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  const dong = page.locator("main [data-referral]", { hasText: ma });
  await expect(dong).toHaveCount(1);
  await expect(dong).toContainText(NHAN_REFERRAL_DOI_TAC.VALID);
  await expect(dong).toContainText(f.x.campaign.name);
  await expect(page.locator('main [data-so="luot-bam"]')).toHaveText(String(truoc + 1));
  await expect(page.locator('main [data-so="da-ghi-nhan"]')).toHaveText(String(truocDaGhiNhan + 1));
  const { html, rsc } = await layPhanHoiCong(page);
  for (const [ten, than] of [["HTML", html], ["RSC", rsc]] as const) {
    expect(than, `${ten} phải có mã hồ sơ của referral mới (đối chứng dương)`).toContain(ma);
    for (const cam of [sdt, `84${sdt.slice(1)}`, "apc.khach.moi@example.com", "ApcKhachMoi", lead.id]) expect(than, `${ten} chứa ${cam}`).not.toContain(cam);
  }
  // B không thấy referral của A
  const ctxB = await browser.newContext();
  try {
    const pb = await ctxB.newPage();
    await dangNhapVaoCong(pb, f.ub.email);
    await expect(pb.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
    expect(await pb.content()).not.toContain(ma);
  } finally {
    await ctxB.close();
  }
});

test("[APC-03] hoa hồng ⇔ partnerCanViewAmount: ẨN (mặc định) · HIỆN · ẨN tường minh — số tiền vắng khỏi HTML lẫn RSC khi ẩn; đủ bốn trạng thái chi khi hiện", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await dam(browser, { nguon: true, affiliate: true });
  if (!soDaThem) {
    await themSoCuaA(f);
    soDaThem = true;
  }
  await dangNhapCoNho(page, f.ua.email);
  const cacChuoiTien = (): string[] => [
    ...Object.values(TIEN_A).flatMap((n) => [dinhDangDong(n), String(n)]),
    dinhDangDong(TIEN_B),
    String(TIEN_B),
  ];
  const khangDinhAn = async (nhan: string) => {
    await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
    await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
    // giao diện: có lời giải thích «không hiển thị», không thẻ tiền, không bảng hoa hồng
    await expect(page.locator("main [data-khong-hien-tien]")).toBeVisible();
    await expect(page.locator('main [data-so="cho-chi"]')).toHaveCount(0);
    await expect(page.locator("main [data-chi]")).toHaveCount(0);
    await expect(page.locator("main [data-hoa-hong]")).toHaveCount(0);
    // MÁY CHỦ: không số tiền nào rời máy chủ, cả HTML lẫn RSC
    const { html, rsc } = await layPhanHoiCong(page);
    for (const [ten, than] of [["HTML", html], ["RSC", rsc]] as const) {
      expect(than.length, `${ten} (${nhan}) phải có nội dung thật`).toBeGreaterThan(2000);
      expect(than, `${ten} (${nhan}) phải còn trang của A (đối chứng dương)`).toContain(f.x.token);
      for (const cam of cacChuoiTien()) expect(than, `${ten} (${nhan}) lộ ${cam}`).not.toContain(cam);
      expect(than, `${ten} (${nhan}) lộ nhãn «Hoa hồng chờ chi»`).not.toContain("Hoa hồng chờ chi");
    }
  };

  // 1. campaign để NULL ⇒ mặc định ẨN (fail-closed)
  await datHienTien(f.x.campaign.id, null);
  await khangDinhAn("mặc định null");

  // 2. HIỆN tường minh ⇒ đủ bốn trạng thái chi + số tiền đúng, và VẪN không có tiền của B
  await datHienTien(f.x.campaign.id, true);
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  await expect(page.locator("main [data-khong-hien-tien]")).toHaveCount(0);
  const choChi = TIEN_A.PENDING + TIEN_A.APPROVED + TIEN_A.EXPORTED; // «chờ chi» = mọi dòng chưa PAID
  await expect(page.locator('main [data-so="cho-chi"]')).toHaveText(dinhDangDong(choChi));
  await expect(page.locator('main [data-so="cho-chi"]').locator("xpath=..")).toContainText(`Đã chi ${dinhDangDong(TIEN_A.PAID)}`);
  for (const t of ["PENDING", "APPROVED", "EXPORTED", "PAID"] as const) {
    await expect(page.locator(`main [data-chi="${t}"]`)).toHaveText(dinhDangDong(TIEN_A[t]));
    const dong = page.locator("main [data-hoa-hong]", { hasText: NHAN_CHI_DOI_TAC[t] }).filter({ hasText: dinhDangDong(TIEN_A[t]) });
    await expect(dong, `dòng hoa hồng trạng thái ${t}`).toHaveCount(1);
  }
  const hien = await layPhanHoiCong(page);
  for (const [ten, than] of [["HTML", hien.html], ["RSC", hien.rsc]] as const) {
    expect(than, `${ten} (hiện) phải có số tiền của A`).toContain(dinhDangDong(TIEN_A.PENDING));
    expect(than, `${ten} (hiện) lộ tiền của B`).not.toContain(dinhDangDong(TIEN_B));
    expect(than, `${ten} (hiện) lộ tiền thô của B`).not.toContain(String(TIEN_B));
  }

  // 3. ẨN tường minh (false) ⇒ lại ẩn hoàn toàn — đảo chiều, cùng phiên
  await datHienTien(f.x.campaign.id, false);
  await khangDinhAn("false tường minh");

  await datHienTien(f.x.campaign.id, null); // trả về mặc định
});

test("[APC-04] CROSS-USER: A không thấy token / tên / mã hồ sơ / tiền của B (HTML + RSC, kể cả ép tham số URL); B cũng không thấy gì của A", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await dam(browser, { nguon: true, affiliate: true });
  if (!soDaThem) {
    await themSoCuaA(f);
    soDaThem = true;
  }
  await datHienTien(f.x.campaign.id, true); // bật hiện tiền ⇒ nếu có rò sẽ rò CẢ tiền
  try {
    const maA1 = maRutGonPhieu(f.leadA1.id);
    const maB = maRutGonPhieu(f.leadB.id);
    expect(maA1, "ma hồ sơ của A và B phải khác nhau để phép so có nghĩa").not.toBe(maB);

    await dangNhapVaoCong(page, f.ua.email);
    const duongEp = `/portal/gioi-thieu?partyId=${f.pb.doiTac.id}&party=${f.pb.doiTac.id}&token=${f.pb.token}&userId=${f.ub.id}&campaign=${f.x.campaign.code}`;
    for (const duong of ["/portal/gioi-thieu", duongEp]) {
      const { trangThai, html, rsc } = await layPhanHoiCong(page, duong);
      expect(trangThai).toBe(200);
      for (const [ten, than] of [["HTML", html], ["RSC", rsc]] as const) {
        // đối chứng dương trước — nếu thiếu thì mọi khẳng định vắng mặt dưới đây vô nghĩa
        for (const co of [f.x.token, f.x.doiTac.name, f.x.campaign.name, maA1, dinhDangDong(TIEN_A.PENDING), `HV AFFL4 a`]) expect(than, `${ten} ${duong.slice(0, 40)} thiếu ${co}`).toContain(co);
        // Biến thể ÉP THAM SỐ: máy chủ lặp lại địa chỉ yêu cầu trong payload, nên chuỗi do CHÍNH TA gõ vào URL (token / id của B) tự xuất hiện — không phải rò. Gỡ đúng các chuỗi đó khỏi thân rồi mới soi;
        // phần còn lại (tên · mã · mã hồ sơ · tiền · học viên của B) không nằm trong URL nên vẫn phải VẮNG.
        const chuoiTrongUrl = duong === "/portal/gioi-thieu" ? [] : [f.pb.token, f.pb.doiTac.id, f.ub.id];
        const sach = chuoiTrongUrl.reduce((acc, c) => acc.split(c).join(""), than);
        for (const cam of [f.pb.token, f.pb.doiTac.name, f.pb.doiTac.code, f.pb.doiTac.id, f.ub.id, f.ub.email, "HV AFFL4 b", maB, dinhDangDong(TIEN_B), String(TIEN_B)]) {
          expect(sach, `${ten} ${duong.slice(0, 40)} của A chứa ${cam}`).not.toContain(cam);
        }
      }
    }

    const ctxB = await browser.newContext();
    try {
      const pb = await ctxB.newPage();
      await dangNhapVaoCong(pb, f.ub.email);
      await expect(pb.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
      const { html, rsc } = await layPhanHoiCong(pb);
      for (const [ten, than] of [["HTML", html], ["RSC", rsc]] as const) {
        for (const co of [f.pb.token, f.pb.doiTac.name, maB, dinhDangDong(TIEN_B)]) expect(than, `${ten} của B thiếu ${co}`).toContain(co);
        for (const cam of [f.x.token, f.x.doiTac.name, f.x.doiTac.code, f.x.doiTac.id, f.ua.id, f.ua.email, "HV AFFL4 a", maA1, dinhDangDong(TIEN_A.PENDING), String(TIEN_A.PAID)]) {
          expect(than, `${ten} của B chứa ${cam}`).not.toContain(cam);
        }
      }
    } finally {
      await ctxB.close();
    }
  } finally {
    await datHienTien(f.x.campaign.id, null);
  }
});

test("[APC-05] PII trong PHẢN HỒI MÁY CHỦ: không tên / SĐT (0… lẫn 84…) / email khách, không học phí, không ghi chú nội bộ của Sale, không id lead, không SĐT / email đối tác", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await dam(browser, { nguon: true, affiliate: true });
  if (!soDaThem) {
    await themSoCuaA(f);
    soDaThem = true;
  }
  // chính dữ liệu cần giấu PHẢI có thật trong DB (kẻo "vắng mặt" chỉ vì fixture không dựng được)
  const lead = await db.lead.findUniqueOrThrow({ where: { id: f.leadA1.id }, select: { note: true, parentName: true, phone: true, email: true, convertedAt: true } });
  expect(lead).toMatchObject({ note: KHACH_THEM.ghiChuSale, parentName: KHACH.ten, phone: KHACH.sdt, email: KHACH.email });
  expect(lead.convertedAt).not.toBeNull();
  const don = await db.order.findFirstOrThrow({ where: { leadId: f.leadA1.id }, select: { totalAmount: true } });
  expect(don.totalAmount).toBe(KHACH_THEM.hocPhi);

  await datHienTien(f.x.campaign.id, true); // đường tiền MỞ ⇒ nếu học phí có chỗ lọt thì lọt ở đây
  try {
    await dangNhapVaoCong(page, f.ua.email);
    await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
    // đối chứng dương: dòng referral của lead đó CÓ mặt dưới dạng mã rút gọn và là phiếu "đã đăng ký"
    const ma = maRutGonPhieu(f.leadA1.id);
    await expect(page.locator("main [data-referral]", { hasText: ma })).toHaveCount(1);
    await expect(page.locator('main [data-so="da-dang-ky"]')).not.toHaveText("0");

    const { html, rsc } = await layPhanHoiCong(page);
    const cam = [
      KHACH.ten,
      KHACH.sdt,
      KHACH.sdt84,
      KHACH.sdt.slice(1), // 907555123 — dạng bỏ số 0 đầu
      KHACH.email,
      KHACH_THEM.ghiChuSale,
      String(KHACH_THEM.hocPhi),
      "7.654.321",
      f.leadA1.id,
      f.leadA2.id,
      f.leadB.id,
      "0988777666", // SĐT đối tác (fixture)
      "afrx.example.com", // email đối tác (fixture)
    ];
    for (const [ten, than] of [["HTML", html], ["RSC", rsc]] as const) {
      expect(than, `${ten} phải có mã hồ sơ (đối chứng dương)`).toContain(ma);
      for (const c of cam) expect(than, `${ten} chứa ${c}`).not.toContain(c);
      // không khoá nhạy cảm nào trong payload nhúng
      const khoaNhayCam = /"(phone|leadId|orderId|studentId|paymentId|sourceSnapshot|resolutionReason|evidence|totalAmount)"\s*:/.exec(than);
      expect(khoaNhayCam, `${ten} có khoá nhạy cảm: …${khoaNhayCam ? than.slice(Math.max(0, khoaNhayCam.index - 100), khoaNhayCam.index + 160) : ""}…`).toBeNull();
    }
  } finally {
    await datHienTien(f.x.campaign.id, null);
  }
});

test("[APC-06] cờ tắt (affiliate tắt · nguồn tắt) ⇒ cổng 404 + không mục menu; /r chuyển trang sạch + /intake vẫn LƯU khách (không referral — R5 13/10/2026); bật lại ⇒ có lại", async ({ page, request, browser }) => {
  test.setTimeout(420_000);
  await dam(browser, { nguon: true, affiliate: true });
  await dangNhapVaoCong(page, f.ua.email);
  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
  const menuBat = await soMucMenu(page);
  expect(menuBat.gioiThieu, "đối chứng dương: cờ bật ⇒ có mục menu").toBeGreaterThan(0);
  expect(menuBat.khac, "đối chứng: portal có các mục menu khác").toBeGreaterThan(0);

  const cuocGoi = async () => {
    const bam = await request.get(`/r/${f.x.token}`, { maxRedirects: 0, headers: { [HEADER_IP_E2E]: ipMoi() } });
    const gui = await request.post("/api/public/affiliate/v1/intake", {
      headers: { "content-type": "text/plain", origin: `https://${new URL(f.x.site.baseUrl).host}`, [HEADER_IP_E2E]: ipMoi() },
      data: JSON.stringify({ v: 1, token: f.x.token, idempotencyKey: `apc-06-${Date.now().toString(36)}-${ipDem}`, parentName: "Khách cờ tắt", phone: "0905000111", children: [{ fullName: "Bé" }], consentMarketing: true }),
    });
    return { bam: bam.status(), gui: gui.status(), loc: bam.headers()["location"] ?? "" };
  };
  const soLead = () => db.lead.count({ where: { phone: { in: ["0905000111", "84905000111"] } } });
  const batDau = await cuocGoi();
  expect({ bam: batDau.bam, gui: batDau.gui }, "đối chứng dương: cờ bật ⇒ /r 302 và /intake 200").toEqual({ bam: 302, gui: 200 });
  expect(batDau.loc, "đối chứng dương: cờ bật ⇒ link đích mang aff=").toMatch(/[?&]aff=/);
  const leadKhiBat = await soLead();
  expect(leadKhiBat, "đối chứng dương: cờ bật ⇒ /intake ghi lead").toBe(1);

  const referralKhiBat = await db.affiliateReferral.count();
  for (const c of [{ nguon: true, affiliate: false }, { nguon: false, affiliate: true }]) {
    await dam(browser, c);
    await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
    await khangDinhKhongTimThay(page);
    const menuTat = await soMucMenu(page);
    expect(menuTat.gioiThieu, `${JSON.stringify(c)}: mục menu phải biến mất`).toBe(0);
    expect(menuTat.khac, `${JSON.stringify(c)}: các mục menu khác vẫn còn (nav có mặt, không phải trang trống)`).toBeGreaterThan(0);
    const { html, rsc } = await layPhanHoiCong(page);
    // Trang 404 của Next đến SAU khi phần đầu phản hồi đã gửi (streaming) nên mã HTTP vẫn là 200 — khẳng định bằng NỘI DUNG, không bằng mã trạng thái.
    expect(html, "thân phản hồi phải là trang 404").toContain("Không tìm thấy trang");
    expect(html).not.toContain("data-gioi-thieu");
    for (const than of [html, rsc]) {
      expect(than).not.toContain(f.x.token);
      expect(than).not.toContain(f.x.campaign.name);
    }
    // R5: cờ tắt KHÔNG làm mất khách bấm QR / điền biểu mẫu: /r chuyển trang đích SẠCH (không aff=), /intake 200 và vẫn lưu lead.
    const tat = await cuocGoi();
    expect({ bam: tat.bam, gui: tat.gui }, `${JSON.stringify(c)}: /r 302 và /intake 200 (không 404)`).toEqual({ bam: 302, gui: 200 });
    expect(tat.loc, `${JSON.stringify(c)}: link đích SẠCH`).not.toMatch(/[?&](aff|cmp|clk)=/);
  }
  // khách vẫn được lưu (không mất), nhưng KHÔNG referral nào sinh thêm từ các cuộc gọi lúc cờ tắt
  expect(await soLead(), "cờ tắt ⇒ /intake vẫn lưu khách (không mất)").toBeGreaterThanOrEqual(leadKhiBat);
  expect(await db.affiliateReferral.count(), "cờ tắt ⇒ không referral mới").toBe(referralKhiBat);

  await dam(browser, { nguon: true, affiliate: true });
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
  expect((await soMucMenu(page)).gioiThieu, "bật lại ⇒ mục menu có lại").toBeGreaterThan(0);
});

test("[APC-07] tài khoản bị TẠM NGỪNG cổng ⇒ 404 + không menu (đối chứng: đối tác kia vẫn vào); mở lại ⇒ vào được", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await dam(browser, { nguon: true, affiliate: true });
  await dangNhapVaoCong(page, f.ua.email);
  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
  expect((await soMucMenu(page)).gioiThieu).toBeGreaterThan(0);

  await datTrangThaiCong(f.x.doiTac.id, f.ua.id, "SUSPENDED");
  try {
    await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
    await khangDinhKhongTimThay(page);
    const menuNgung = await soMucMenu(page);
    expect(menuNgung.gioiThieu, "tạm ngừng ⇒ mục menu biến mất").toBe(0);
    expect(menuNgung.khac, "đối chứng: nav có mặt").toBeGreaterThan(0);
    await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
    const { html, rsc } = await layPhanHoiCong(page);
    // Trang 404 của Next đến SAU khi phần đầu phản hồi đã gửi (streaming) nên mã HTTP vẫn là 200 — khẳng định bằng NỘI DUNG, không bằng mã trạng thái.
    expect(html, "thân phản hồi phải là trang 404").toContain("Không tìm thấy trang");
    expect(html).not.toContain("data-gioi-thieu");
    for (const than of [html, rsc]) expect(than).not.toContain(f.x.token);

    // đối chứng dương: B (không bị tạm ngừng) vẫn vào bình thường
    const ctxB = await browser.newContext();
    try {
      const pb = await ctxB.newPage();
      await dangNhapVaoCong(pb, f.ub.email);
      await expect(pb.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
      expect((await soMucMenu(pb)).gioiThieu).toBeGreaterThan(0);
    } finally {
      await ctxB.close();
    }
  } finally {
    await datTrangThaiCong(f.x.doiTac.id, f.ua.id, "ACTIVE");
  }
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
  expect((await soMucMenu(page)).gioiThieu, "mở lại ⇒ mục menu có lại").toBeGreaterThan(0);
});

test("[APC-08] tài khoản đối tác CHƯA có học viên ⇒ không mục menu, không hiện dữ liệu của đối tác (đối chứng: có học viên ⇒ có)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await dam(browser, { nguon: true, affiliate: true });
  const uc = await taoPhuHuynh("c", { coHocVien: false });
  await lienKet(f.x.doiTac.id, uc.id, "MEMBER"); // đang ACTIVE ở bảng nối — nhưng chưa có con
  await dangNhapCoNho(page, uc.email);
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  await expect(page.getByText("chưa được liên kết với học viên nào")).toBeVisible({ timeout: 60_000 });
  expect((await soMucMenu(page)).gioiThieu, "chưa có học viên ⇒ không có mục «Giới thiệu» (bấm vào chỉ gặp thông báo)").toBe(0);
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  // Trang KHÔNG được hiện: layout thay thân bằng thông báo «chưa liên kết học viên». (Ghi chú đo được: Next vẫn nhúng RSC của trang vào phản hồi dù layout không vẽ `children` — nên soi
  // thứ NGƯỜI DÙNG THẤY, không soi payload. Không phải rò chéo: tài khoản này là thành viên ACTIVE của đúng đối tác đó, payload chỉ chứa dữ liệu của đối tác mình được phép vào.)
  await expect(page.locator("main [data-gioi-thieu]")).toHaveCount(0);
  const chuHienRa = await page.locator("body").innerText();
  expect(chuHienRa).not.toContain(f.x.token);
  expect(chuHienRa).not.toContain(f.x.doiTac.name);

  // đối chứng dương: cùng tài khoản, cùng liên kết, THÊM một học viên ⇒ vào được
  await db.student.create({ data: { name: "HV AFFL4 c", parentUserId: uc.id } });
  await page.goto("/portal/gioi-thieu", { timeout: 120_000 });
  await expect(page.locator("main [data-gioi-thieu]")).toBeVisible({ timeout: 60_000 });
  expect((await soMucMenu(page)).gioiThieu).toBeGreaterThan(0);
});
