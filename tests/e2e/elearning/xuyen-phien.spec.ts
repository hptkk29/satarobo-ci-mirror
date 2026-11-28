/**
 * [XP-*] V9.4 P0 — điều tra XUYÊN PHIÊN (cross-session / cross-user), có đo.
 *
 * Câu hỏi: khi đổi tài khoản trên cùng trình duyệt, UI/dữ liệu của tài khoản trước có khi nào hiện cho tài khoản sau không — và nếu có thì
 *   A. chỉ giàn test còn cookie cũ (hũ cookie của Playwright bị ghi đè bởi phản hồi muộn),
 *   B. client vẽ UI cũ nhưng máy chủ đã từ chối dữ liệu mới,
 *   C. máy chủ THẬT SỰ trả dữ liệu/thao tác của người khác  ⇒ blocker bảo mật.
 *
 * Cách đo: mọi phản hồi được ghi lại cùng (a) chủ của cookie phiên GỬI ĐI, (b) chủ của từng Set-Cookie phiên TRẢ VỀ, (c) tiêu đề cache.
 * Chủ cookie = giải mã token bằng khoá TEST rồi đổi thành NHÃN fixture. Không bao giờ ghi giá trị cookie/token.
 * Bằng chứng ghi ra `XP_OUT` (mặc định E:/tmp/xuyen-phien) dạng JSON đã che.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { login } from "../_helpers/auth";
import { dungSauVai, EMAIL, emailSangNhan, MOI_NHAN, TEN, tenTheoNhan, type BoSauVai, type Nhan } from "./_helpers/sau-vai";
import { chuHuCookie, danhTinhMayChu, ghiPhienTrenTrang, nhanCuaToken, tenXuatHien, type SuKien } from "./_helpers/xuyen-phien";

test.describe.configure({ mode: "serial" });

const RA = process.env.XP_OUT ?? "E:/tmp/xuyen-phien";
/** Máy chủ đang chạy với SESSION_COOKIE_REFRESH_NAV_ONLY=true (bản vá) — đổi kỳ vọng của các ca "tự nhiên" từ MÔ TẢ LỖI sang CHỨNG MINH BẢN VÁ. */
const CO_VA = process.env.XP_CO_VA === "1";
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.ELEARNING_E2E_PORT ?? "3141"}`;

let hu: BoSauVai["hu"];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  const bo = await dungSauVai(browser);
  hu = bo.hu;
  mkdirSync(RA, { recursive: true });
});

function luu(ten: string, noiDung: unknown) {
  writeFileSync(`${RA}/${ten}.json`, JSON.stringify(noiDung, null, 2), "utf8");
}

async function datHu(page: Page, nhan: Nhan) {
  await page.context().clearCookies();
  await page.context().addCookies(hu.get(nhan)!);
}

function tomTat(ev: SuKien[]) {
  const theo = (f: (e: SuKien) => string) => {
    const m = new Map<string, number>();
    for (const e of ev) m.set(f(e), (m.get(f(e)) ?? 0) + 1);
    return Object.fromEntries(m);
  };
  return {
    tong: ev.length,
    coSetCookiePhien: ev.filter((e) => e.datCookie.length > 0).length,
    setCookieTheoChu: theo((e) => e.datCookie.join("+") || "(không)"),
    guiTheoChu: theo((e) => e.gui),
    loai: theo((e) => e.tai),
  };
}

test("[XP-00] ĐO: máy chủ có đặt lại cookie phiên trên phản hồi thường không (cơ chế 'làm mới phiên')?", async ({ page }) => {
  test.setTimeout(240_000);
  const bo = ghiPhienTrenTrang(page, emailSangNhan);
  await datHu(page, "DAO_TAO");
  await page.goto("/elearning/dao-tao", { waitUntil: "load" });
  await page.waitForTimeout(6_000); // đủ cho một đợt prefetch + thăm dò nền (luồng SSE không bao giờ "im" nên KHÔNG dùng networkidle)
  const ev = await Promise.race([bo.hoiTu(), new Promise<SuKien[]>((ok) => setTimeout(() => ok(bo.suKien), 5_000))]);
  const sau = ev.filter((e) => e.duongDan.startsWith("/elearning") || e.duongDan.startsWith("/api"));
  luu("xp-00-set-cookie-thuong", { tomTat: tomTat(ev), trangElearning: sau.map(({ t, duongDan, trangThai, tai, gui, datCookie, cacheControl, vary }) => ({ t, duongDan, trangThai, tai, gui, datCookie, cacheControl, vary })) });
  console.log("[XP-00]", JSON.stringify(tomTat(ev)));
  expect(ev.length, "phải ghi được phản hồi").toBeGreaterThan(0);
  const coSet = ev.filter((e) => e.datCookie.length > 0).length;
  if (CO_VA) expect(coSet, "có bản vá: yêu cầu nền không còn mang Set-Cookie phiên (chỉ điều hướng cấp cao)").toBeLessThanOrEqual(2);
  else expect(coSet, "đo hiện trạng: nhiều phản hồi nền mang Set-Cookie phiên").toBeGreaterThan(5);
});

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Máy chủ trung gian CHẬM TRỄ: giữ phản hồi của các yêu cầu RSC/prefetch (máy chủ ĐÃ xử lý bằng cookie lúc gửi) cho tới khi `tha()`.
// Mô phỏng đúng "yêu cầu nền còn đang bay" mà không phụ thuộc cách Playwright xử lý Set-Cookie của phản hồi giả.
// ──────────────────────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import type { AddressInfo } from "node:net";

async function dungTrungGian() {
  const cho: Array<() => void> = [];
  let giu = false;
  let dangGiu = 0;
  const srv = http.createServer((req, res) => {
    const goc = new URL(BASE);
    const doRsc = /[?&]_rsc=/.test(req.url ?? "") || req.headers["rsc"] === "1";
    const up = http.request(
      { host: goc.hostname === "localhost" ? "127.0.0.1" : goc.hostname, port: goc.port, path: req.url, method: req.method, headers: req.headers },
      (r) => {
        const chuyen = () => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        };
        // Đọc hết thân rồi mới giữ — để giữ nguyên nghĩa "máy chủ đã xong, mạng chậm".
        if (giu && doRsc && dangGiu < 2) { // ≤2: Chrome chỉ mở 6 kết nối HTTP/1.1/origin, mà mỗi tab đã giữ 1 luồng SSE chat
          dangGiu++;
          const bo: Buffer[] = [];
          r.on("data", (c) => bo.push(c));
          r.on("end", () => {
            cho.push(() => {
              dangGiu--;
              if (res.writableEnded || res.destroyed) return;
              res.writeHead(r.statusCode ?? 502, r.headers);
              res.end(Buffer.concat(bo));
            });
          });
          res.on("close", () => {
            /* trình duyệt huỷ (điều hướng đi nơi khác) — phản hồi không bao giờ tới */
          });
        } else chuyen();
      },
    );
    up.on("error", () => res.destroyed || res.writeHead(502).end());
    req.pipe(up);
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as AddressInfo).port;
  return {
    origin: `http://localhost:${port}`,
    batGiu: () => { giu = true; },
    soDangGiu: () => dangGiu,
    ngungGiuMoi: () => { giu = false; },
    tha: () => { giu = false; for (const f of cho.splice(0)) f(); },
    dong: () => new Promise<void>((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }),
  };
}

async function huCuaCtx(ctx: BrowserContext) {
  return chuHuCookie(ctx, emailSangNhan);
}

const TU_CHOI_QT = "Bạn không có quyền xem tổng quan Đào tạo";
type Cap = [Nhan, Nhan, string];
const CAP: Cap[] = [
  ["DAO_TAO", "HOC_VIEN", "/elearning"],
  ["HOC_VIEN", "DAO_TAO", "/elearning/dao-tao"],
  ["QLCS_CS1", "QLCS_CS2", "/elearning"],
  ["MARKETING", "DAO_TAO", "/elearning/dao-tao"],
  ["KE_TOAN", "DAO_TAO", "/elearning/dao-tao"],
];
/** Mỗi phản hồi: mọi Set-Cookie phiên phải thuộc ĐÚNG người gửi yêu cầu (máy chủ không bao giờ đặt phiên của người khác). */
function viPhamChuCookie(ev: SuKien[]) {
  return ev.filter((e) => e.datCookie.some((c) => c !== "xoa" && c !== e.gui));
}

test("[XP-01] ĐO TỰ NHIÊN: đổi tài khoản KHÔNG chặn yêu cầu nền ⇒ bao nhiêu lần phản hồi muộn ghi đè cookie? máy chủ có bao giờ trả dữ liệu của người khác?", async ({ page }) => {
  test.setTimeout(900_000);
  const bo = ghiPhienTrenTrang(page, emailSangNhan);
  const MOI_CAP = Number(process.env.XP_LAP ?? 3);
  const TRE_MS = (process.env.XP_TRE ?? "0,60,120,200,350").split(",").map(Number); // độ trễ từ lúc trang tải xong tới lúc đổi cookie
  const ketQua: Array<Record<string, unknown>> = [];
  let sauAn = 0, cookieCu = 0, cLeak = 0;
  for (const [a, b, duongB] of CAP) {
    for (const tre of TRE_MS) for (let i = 0; i < MOI_CAP; i++) {
      await datHu(page, a);
      await page.goto("/elearning", { waitUntil: "load" });
      if (tre > 0) await page.waitForTimeout(tre); // cửa sổ prefetch: ngay sau hydration
      const dau = bo.suKien.length;
      const tDoi = Date.now() - bo.t0;
      await datHu(page, b); // KHÔNG about:blank — đúng cách làm của giàn cũ
      await page.goto(duongB, { waitUntil: "load" });
      await page.waitForTimeout(250);
      const ev = (await bo.hoiTu()).slice(dau);
      const nav = ev.find((e) => e.tai === "document" && e.duongDan === duongB);
      const muon = ev.filter((e) => e.t >= tDoi && e.datCookie.some((c) => c !== "xoa" && c !== b));
      const html = await page.content();
      const tenThay = tenXuatHien(html, tenTheoNhan);
      const hoDen = await chuHuCookie(page.context(), emailSangNhan);
      const loai = !nav ? "khong-co-nav" : nav.gui !== b ? "A-giàn-gửi-cookie-cũ" : tenThay.some((n) => n !== b && n !== a) ? "C-DỮ-LIỆU-NGƯỜI-KHÁC" : tenThay.includes(a) && !tenThay.includes(b) ? "C?-vẽ-người-trước" : "ok";
      if (loai.startsWith("A")) cookieCu++;
      if (loai.startsWith("C")) cLeak++;
      sauAn += muon.length;
      ketQua.push({ cap: `${a}→${b}`, i, tre, tDoi, navGui: nav?.gui, trangThaiNav: nav?.trangThai, phanHoiMuonGhiDe: muon.map((m) => ({ dt: m.t - tDoi, duongDan: m.duongDan, chu: m.datCookie })), hoCookieSauCung: hoDen, loai });
    }
  }
  const vp = viPhamChuCookie(await bo.hoiTu());
  luu("xp-01-do-tu-nhien", { moiCap: MOI_CAP, tong: ketQua.length, soLanGiàn_gửi_cookie_cũ: cookieCu, soLanPhanHoiMuonGhiDe: sauAn, soLanDuLieuNguoiKhac: cLeak, viPhamChuCookie: vp.length, ketQua });
  console.log("[XP-01]", JSON.stringify({ tong: ketQua.length, A_cookieCu: cookieCu, muonGhiDe: sauAn, C: cLeak, viPhamChuCookie: vp.length }));
  expect(cLeak, "C: máy chủ trả nội dung của người khác cho yêu cầu mang cookie đúng").toBe(0);
  expect(vp.length, "máy chủ không bao giờ được đặt cookie phiên của người KHÁC người gửi").toBe(0);
  if (CO_VA) {
    expect(cookieCu, "có bản vá: không còn lần nào giàn gửi cookie cũ").toBe(0);
    expect(sauAn, "có bản vá: không phản hồi nền nào được ghi đè cookie phiên").toBe(0);
  }
});

test("[XP-02] DỰNG LẠI TẤT ĐỊNH (trung gian chậm): phản hồi nền của trang cũ về SAU khi đổi cookie ⇒ ghi đè hũ cookie; 'about:blank' chặn được vì huỷ yêu cầu nền", async ({ browser }) => {
  test.setTimeout(240_000);
  const px = await dungTrungGian();
  const kq: Record<string, unknown> = {};
  try {
    for (const cach of ["khong-chan", "about-blank"] as const) {
      const ctx = await browser.newContext({ baseURL: px.origin });
      const page = await ctx.newPage();
      const bo = ghiPhienTrenTrang(page, emailSangNhan);
      await ctx.addCookies(hu.get("DAO_TAO")!);
      px.batGiu();
      await page.goto("/elearning", { waitUntil: "load" });
      await expect.poll(() => px.soDangGiu(), { timeout: 20_000, message: "phải có prefetch đang bay" }).toBeGreaterThan(0);
      const dangBay = px.soDangGiu();
      if (cach === "about-blank") await page.goto("about:blank");
      await ctx.clearCookies();
      await ctx.addCookies(hu.get("HOC_VIEN")!);
      const truoc = await huCuaCtx(ctx);
      px.tha();
      await page.waitForTimeout(1200);
      const sau = await huCuaCtx(ctx);
      await page.goto("/elearning", { waitUntil: "load" });
      const nav = (await bo.hoiTu()).filter((e) => e.tai === "document").pop();
      const html = await page.content();
      kq[cach] = { dangBay, hoTruocKhiTha: truoc, hoSauKhiTha: sau, navGui: nav?.gui, trangVeCho: tenXuatHien(html, tenTheoNhan), tuChoiQT: html.includes(TU_CHOI_QT) };
      await ctx.close();
    }
  } finally {
    await px.dong();
  }
  luu("xp-02-tat-dinh", kq);
  console.log("[XP-02]", JSON.stringify(kq));
  const kb = kq["khong-chan"] as { hoTruocKhiTha: string; hoSauKhiTha: string };
  const ab = kq["about-blank"] as { hoTruocKhiTha: string; hoSauKhiTha: string };
  expect(kb.hoTruocKhiTha, "đối chứng: ngay sau khi đổi, hũ cookie thuộc người học").toBe("HOC_VIEN");
  expect(ab.hoTruocKhiTha).toBe("HOC_VIEN");
  expect(ab.hoSauKhiTha, "rời about:blank ⇒ yêu cầu nền bị huỷ, cookie mới còn nguyên").toBe("HOC_VIEN");
  // Khẳng định cơ chế (A) chỉ khi đo thấy: nếu không ghi đè thì giả thuyết sai và phải sửa kết luận, không sửa test cho đẹp.
  expect(
    kb.hoSauKhiTha,
    CO_VA ? "có bản vá: phản hồi nền về muộn KHÔNG còn ghi đè cookie" : "giả thuyết A: phản hồi muộn ghi đè cookie người học bằng phiên Đào tạo",
  ).toBe(CO_VA ? "HOC_VIEN" : "DAO_TAO");
});

/** `nghiemNgat=false`: không đòi điều hướng về /login (khi tab khác còn sống, chính việc đăng xuất có thể bị huỷ — đó là điều đang đo). */
async function dangXuatBangMenu(page: Page, nghiemNgat = true) {
  await expect(async () => {
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await expect(page.getByRole("menuitem", { name: /Đăng xuất/ })).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  const nhatKy: string[] = [];
  page.on("response", (r) => { if (/signout|dang-xuat|login|\/api\/auth/.test(r.url())) nhatKy.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) nhatKy.push(`nav ${new URL(f.url()).pathname}`); });
  page.on("request", (r) => { if (!/_next\/static|_rsc/.test(r.url())) nhatKy.push(`req ${r.method()} ${new URL(r.url()).pathname}`); });
  page.on("console", (m) => nhatKy.push(`console:${m.type()}:${m.text().slice(0, 120)}`));
  page.on("pageerror", (e) => nhatKy.push(`pageerror:${String(e).slice(0, 160)}`));
  await page.getByRole("menuitem", { name: /Đăng xuất/ }).click();
  await page.waitForURL(/\/login/, { timeout: nghiemNgat ? 20_000 : 6_000 }).catch((e) => {
    console.log("[XP-dang-xuat] nhật ký:", JSON.stringify(nhatKy).slice(0, 600), "url:", page.url());
    if (nghiemNgat) throw e;
  });
}

test("[XP-03] HAI TAB: (a) đăng xuất ở tab khác khi tab cũ còn phản hồi nền, (b) tab cũ còn mở sau khi cookie bị xoá ⇒ phiên cũ có bị hồi sinh không?", async ({ browser }) => {
  test.setTimeout(420_000);
  const px = await dungTrungGian();
  const kq: Record<string, unknown> = {};
  try {
    // (a) đăng xuất ở tab 2 trong khi tab 1 còn phản hồi nền chưa về
    {
      const ctx = await browser.newContext({ baseURL: px.origin });
      await ctx.addCookies(hu.get("HOC_VIEN")!);
      const tab1 = await ctx.newPage();
      px.batGiu();
      await tab1.goto("/elearning", { waitUntil: "load" });
      await expect.poll(() => px.soDangGiu(), { timeout: 20_000 }).toBeGreaterThan(0);
      px.ngungGiuMoi();
      const tab2 = await ctx.newPage();
      await tab2.goto("/elearning", { waitUntil: "load" });
      await dangXuatBangMenu(tab2, false);
      const truoc = await huCuaCtx(ctx); // ngay sau khi tab 2 đăng xuất
      px.tha();
      await tab1.waitForTimeout(1200);
      const sau = await huCuaCtx(ctx);
      await tab2.goto("/elearning", { waitUntil: "load" });
      kq["dang-xuat-roi-tab-cu-ve-muon"] = { hoSauDangXuat: truoc, hoSauKhiTabCuNhanPhanHoi: sau, urlSauKhiMoLai: new URL(tab2.url()).pathname, coVeLaiTrongHeThong: !tab2.url().includes("/login") };
      await ctx.close();
    }
    // (b) TỰ NHIÊN: tab 1 (người học) vẫn mở và tự gọi nền; người dùng đăng xuất/đổi tài khoản (= xoá cookie) rồi CHỜ — phiên cũ có tự bật lại không?
    //     (đây cũng là lý do đăng nhập người khác ở tab 2 bị /login đá về khi tab 1 còn sống: phiên cũ vừa được bật lại)
    {
      const ctx = await browser.newContext({ baseURL: px.origin });
      await ctx.addCookies(hu.get("HOC_VIEN")!);
      const tab1 = await ctx.newPage();
      await tab1.goto("/elearning", { waitUntil: "load" });
      await tab1.waitForTimeout(1500);
      await ctx.clearCookies();
      const t0 = Date.now();
      let tHoiSinh: number | null = null;
      while (Date.now() - t0 < 75_000) {
        if ((await huCuaCtx(ctx)) !== "-") { tHoiSinh = Date.now() - t0; break; }
        await tab1.waitForTimeout(500);
      }
      kq["tab-cu-con-mo-sau-khi-xoa-cookie"] = { hoiSinhSauMs: tHoiSinh, hoCuoi: await huCuaCtx(ctx), choToiDa: 75_000 };
      await ctx.close();
    }
  } finally {
    await px.dong();
  }
  luu("xp-03-hai-tab", kq);
  console.log("[XP-03]", JSON.stringify(kq));
  if (CO_VA) {
    expect((kq["tab-cu-con-mo-sau-khi-xoa-cookie"] as { hoiSinhSauMs: number | null }).hoiSinhSauMs, "có bản vá: tab cũ không được bật lại phiên đã xoá").toBeNull();
    expect((kq["dang-xuat-roi-tab-cu-ve-muon"] as { hoSauKhiTabCuNhanPhanHoi: string }).hoSauKhiTabCuNhanPhanHoi, "có bản vá: phản hồi nền về muộn không hồi sinh phiên").toBe("-");
  }
});

test("[XP-05] ĐO TỰ NHIÊN (không trung gian): bấm Đăng xuất ngay sau khi trang tải ⇒ có lần nào phiên được HỒI SINH bởi Set-Cookie của yêu cầu nền?", async ({ page }) => {
  test.setTimeout(900_000);
  const bo = ghiPhienTrenTrang(page, emailSangNhan);
  const TRE = (process.env.XP_TRE_DX ?? "0,150,400,1000,2500").split(",").map(Number);
  const LAP = Number(process.env.XP_LAP_DX ?? 3);
  const ketQua: Array<Record<string, unknown>> = [];
  let hoiSinh = 0;
  for (const tre of TRE) {
    for (let i = 0; i < LAP; i++) {
      await page.goto("about:blank");
      await datHu(page, "HOC_VIEN");
      await page.goto("/elearning", { waitUntil: "load" });
      if (tre > 0) await page.waitForTimeout(tre);
      const dau = bo.suKien.length;
      const tBam = Date.now() - bo.t0;
      await expect(async () => {
        await page.getByRole("button", { name: "Menu tài khoản" }).click();
        await expect(page.getByRole("menuitem", { name: /Đăng xuất/ })).toBeVisible({ timeout: 1_500 });
      }).toPass({ timeout: 20_000 });
      await page.getByRole("menuitem", { name: /Đăng xuất/ }).click();
      await page.waitForTimeout(3500);
      const ho = await huCuaCtx(page.context());
      const url = new URL(page.url()).pathname;
      const ev = (await bo.hoiTu()).slice(dau);
      const tSignout = ev.find((e) => e.duongDan === "/api/auth/signout" && e.trangThai === 200)?.t;
      const datSauSignout = ev.filter((e) => tSignout !== undefined && e.t > tSignout && e.datCookie.some((c) => c !== "xoa"));
      const hs = ho !== "-" || !url.startsWith("/login");
      if (hs) hoiSinh++;
      ketQua.push({ tre, i, urlSau: url, hoCookieSau: ho, hoiSinh: hs, tSignoutSauBam: tSignout === undefined ? null : tSignout - tBam, datCookieSauSignout: datSauSignout.map((e) => ({ dt: e.t - (tSignout ?? 0), duongDan: e.duongDan, chu: e.datCookie })) });
    }
  }
  luu("xp-05-dang-xuat-tu-nhien", { tong: ketQua.length, hoiSinh, ketQua });
  console.log("[XP-05]", JSON.stringify({ tong: ketQua.length, hoiSinh, theoTre: TRE.map((t) => [t, ketQua.filter((k) => k.tre === t && k.hoiSinh).length]) }));
  if (CO_VA) expect(hoiSinh, "có bản vá: đăng xuất phải BỀN ở mọi độ trễ").toBe(0);
});

const MOI_NGUOI = MOI_NHAN.filter((n) => n !== "QTTC"); // XP-04 đo 6 người (Quản trị tối cao có ca riêng ở sau-vai.spec)

test("[XP-04] MÁY CHỦ (không trình duyệt): 6 người × 5 đường × 4 lượt gửi XEN KẼ song song ⇒ danh tính, nội dung, Set-Cookie, cache đều thuộc đúng người gửi", async () => {
  test.setTimeout(300_000);
  const cookieDe = (n: Nhan) => hu.get(n)!.map((c) => `${c.name}=${c.value}`).join("; ");
  const DUONG: Array<{ p: string; h?: Record<string, string> }> = [
    { p: "/api/auth/session" },
    { p: "/elearning" },
    { p: "/elearning/dao-tao" },
    { p: "/elearning/chuong-trinh?_rsc=xp", h: { rsc: "1", "next-router-prefetch": "1" } },
    { p: "/elearning/dao-tao?_rsc=xp", h: { rsc: "1" } },
  ];
  const ds: Array<{ nhan: Nhan; p: string; h?: Record<string, string> }> = [];
  for (let l = 0; l < 4; l++) for (const nhan of MOI_NGUOI) for (const d of DUONG) ds.push({ nhan, ...d });
  // xáo trộn TẤT ĐỊNH (LCG) — xen kẽ người dùng, nhưng lần chạy nào cũng giống nhau
  let seed = 20261121;
  for (let i = ds.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [ds[i], ds[j]] = [ds[j], ds[i]];
  }
  type Kq = { nhan: Nhan; p: string; trangThai: number; chuSession: string | null; setCookie: string[]; cache: string; ten: string[]; tuChoiQT: boolean; location: string };
  const kq: Kq[] = [];
  const DONG_THOI = 40;
  for (let i = 0; i < ds.length; i += DONG_THOI) {
    const lo = await Promise.all(
      ds.slice(i, i + DONG_THOI).map(async (y): Promise<Kq> => {
        const r = await fetch(BASE + y.p, { headers: { cookie: cookieDe(y.nhan), ...(y.h ?? {}) }, redirect: "manual" });
        const vb = await r.text();
        const setCookie: Kq["setCookie"] = [];
        for (const sc of r.headers.getSetCookie()) {
          const [cap] = sc.split(";");
          const k = cap.indexOf("=");
          const ten = cap.slice(0, k).trim();
          if (!/session-token(\.\d+)?$/.test(ten)) continue;
          const gt = cap.slice(k + 1).trim();
          setCookie.push(gt === "" || /max-age=0/i.test(sc) ? "xoa" : ((await nhanCuaToken(ten, gt, emailSangNhan)) ?? "?"));
        }
        let chuSession: Kq["chuSession"] = null;
        if (y.p === "/api/auth/session") {
          const j = JSON.parse(vb || "null") as { user?: { email?: string } } | null;
          chuSession = j?.user?.email ? (emailSangNhan.get(j.user.email) ?? "?") : "-";
        }
        return { nhan: y.nhan, p: y.p, trangThai: r.status, chuSession, setCookie, cache: r.headers.get("cache-control") ?? "", ten: tenXuatHien(vb, tenTheoNhan), tuChoiQT: vb.includes(TU_CHOI_QT), location: r.headers.get("location") ?? "" };
      }),
    );
    kq.push(...lo);
  }
  const loi: string[] = [];
  for (const k of kq) {
    if (k.chuSession !== null && k.chuSession !== k.nhan) loi.push(`DANH-TINH ${k.nhan}→${k.chuSession}`);
    for (const c of k.setCookie) if (c !== "xoa" && c !== k.nhan) loi.push(`SET-COOKIE ${k.nhan} nhận phiên của ${c} (${k.p})`);
    if (k.p === "/elearning" && k.trangThai === 200 && k.ten.some((n) => n !== k.nhan)) loi.push(`TRANG-/elearning ${k.nhan} thấy tên ${k.ten.join(",")}`);
    if (k.trangThai === 200 && /^\/elearning/.test(k.p) && !/no-store|private/.test(k.cache)) loi.push(`CACHE ${k.p} ${k.cache}`);
  }
  // Mỗi người, mỗi đường: quyết định (trạng thái + bị-từ-chối) PHẢI giống nhau ở cả 4 lượt dù xen kẽ — khác nhau = rò trạng thái giữa các yêu cầu.
  const khoa = new Map<string, Set<string>>();
  for (const k of kq) {
    const key = `${k.nhan}|${k.p}`;
    if (!khoa.has(key)) khoa.set(key, new Set());
    khoa.get(key)!.add(`${k.trangThai}|${k.tuChoiQT}|${k.location}`);
  }
  for (const [key, v] of khoa) if (v.size > 1) loi.push(`KHONG-NHAT-QUAN ${key} → ${[...v].join(" ; ")}`);
  // Đối chứng dương (phép đo không rỗng): người học bị từ chối trang quản trị; Đào tạo thì không; tên người dùng có hiện ít nhất một lần.
  const quyet = (n: Nhan, p: string) => kq.filter((k) => k.nhan === n && k.p === p).map((k) => k.tuChoiQT);
  const dc = {
    hocVienBiTuChoi: quyet("HOC_VIEN", "/elearning/dao-tao").every(Boolean),
    daoTaoKhongBiTuChoi: quyet("DAO_TAO", "/elearning/dao-tao").every((x) => !x),
    tenHienIt1Lan: kq.some((k) => k.p === "/elearning" && k.ten.includes(k.nhan)),
  };
  const theoNguoi = Object.fromEntries(MOI_NGUOI.map((n) => [n, { daoTaoTuChoi: quyet(n, "/elearning/dao-tao")[0], trangThai: [...new Set(kq.filter((k) => k.nhan === n && k.p === "/elearning/dao-tao").map((k) => k.trangThai))] }]));
  luu("xp-04-may-chu-xen-ke", { tong: kq.length, loi, doiChungDuong: dc, theoNguoi, setCookieTheoDuong: Object.fromEntries(DUONG.map((d) => [d.p, kq.filter((k) => k.p === d.p && k.setCookie.some((c) => c !== "xoa")).length])) });
  console.log("[XP-04]", JSON.stringify({ tong: kq.length, loi: loi.length, dc }));
  expect(dc.hocVienBiTuChoi && dc.daoTaoKhongBiTuChoi && dc.tenHienIt1Lan, "đối chứng dương: phép đo phải phân biệt được người").toBe(true);
  expect(loi, "C: máy chủ trộn danh tính/nội dung/cookie giữa các yêu cầu xen kẽ").toEqual([]);
});

test("[XP-06] HAI CONTEXT ĐỘC LẬP xen kẽ: mỗi context luôn là đúng người của nó; hũ cookie không bao giờ đổi chủ", async ({ browser }) => {
  test.setTimeout(300_000);
  const cD = await browser.newContext();
  const cH = await browser.newContext();
  await cD.addCookies(hu.get("DAO_TAO")!);
  await cH.addCookies(hu.get("HOC_VIEN")!);
  const pD = await cD.newPage();
  const pH = await cH.newPage();
  const loi: string[] = [];
  for (let i = 0; i < 8; i++) {
    await Promise.all([pD.goto("/elearning/dao-tao", { waitUntil: "load" }), pH.goto("/elearning", { waitUntil: "load" })]);
    if (i % 2) await Promise.all([pD.goto("/elearning", { waitUntil: "load" }), pH.goto("/elearning/dao-tao", { waitUntil: "load" })]);
    const [idD, idH, hD, hH] = await Promise.all([danhTinhMayChu(pD, emailSangNhan), danhTinhMayChu(pH, emailSangNhan), huCuaCtx(cD), huCuaCtx(cH)]);
    if (idD !== "DAO_TAO") loi.push(`#${i} context Đào tạo có danh tính ${idD}`);
    if (idH !== "HOC_VIEN") loi.push(`#${i} context Người học có danh tính ${idH}`);
    if (hD !== "DAO_TAO") loi.push(`#${i} hũ cookie Đào tạo đổi chủ → ${hD}`);
    if (hH !== "HOC_VIEN") loi.push(`#${i} hũ cookie Người học đổi chủ → ${hH}`);
  }
  // đối chứng dương: người học ở trang quản trị bị từ chối, Đào tạo thì không
  await pH.goto("/elearning/dao-tao", { waitUntil: "load" });
  await pD.goto("/elearning/dao-tao", { waitUntil: "load" });
  const tuChoiH = (await pH.content()).includes(TU_CHOI_QT);
  const tuChoiD = (await pD.content()).includes(TU_CHOI_QT);
  await cD.close();
  await cH.close();
  luu("xp-06-hai-context", { loi, doiChung: { nguoiHocBiTuChoi: tuChoiH, daoTaoKhongBiTuChoi: !tuChoiD } });
  expect(tuChoiH && !tuChoiD, "đối chứng dương").toBe(true);
  expect(loi).toEqual([]);
});

test("[XP-07] DEEP LINK quản trị bằng phiên không đủ quyền: người học · Marketing · Kế toán bị TỪ CHỐI nội dung; Đào tạo (đối chứng) vào được", async ({ page }) => {
  test.setTimeout(300_000);
  const TRANG = ["/elearning/dao-tao", "/elearning/ma-tran", "/elearning/bao-cao-r7", "/elearning/kho-cau-hoi", "/elearning/khung-cham", "/elearning/cham-bai"];
  const bang: Record<string, Record<string, string>> = {};
  for (const nhan of ["DAO_TAO", "HOC_VIEN", "MARKETING", "KE_TOAN", "QLCS_CS1"] as Nhan[]) {
    bang[nhan] = {};
    for (const t of TRANG) {
      await page.goto("about:blank");
      await datHu(page, nhan);
      const res = await page.goto(t, { waitUntil: "load" });
      const html = await page.content();
      const aside = (await page.locator("aside.fixed").count()) > 0;
      bang[nhan][t] = `${res?.status()}|${new URL(page.url()).pathname === t ? "o-lai" : "da-chuyen:" + new URL(page.url()).pathname}|khungQuanTri=${aside}|tuChoi=${/không có quyền/i.test(html)}`;
    }
  }
  luu("xp-07-deep-link", bang);
  console.log("[XP-07]", JSON.stringify(bang));
  // Đối chứng dương: Đào tạo vào được mọi trang (200, khung quản trị, không từ chối). Người học/Marketing/Kế toán: 200 nhưng NỘI DUNG bị từ chối ở mọi trang
  // (Marketing và Kế toán vẫn thấy KHUNG quản trị vì có quyền xem khoá online — khung không phải nội dung đào tạo; nội dung mới là dữ liệu).
  for (const t of TRANG) {
    expect(bang["DAO_TAO"][t], `Đào tạo phải vào được ${t}`).toMatch(/^200\|o-lai\|khungQuanTri=true\|tuChoi=false$/);
    for (const n of ["HOC_VIEN", "MARKETING", "KE_TOAN"]) expect(bang[n][t], `${n} KHÔNG được thấy nội dung ${t}`).toMatch(/\|tuChoi=true$/);
  }
});

test("[XP-08] ĐĂNG XUẤT bền: sau khi đăng xuất (chờ yên) hũ cookie rỗng; Reload · mở lại đường nội bộ · Back không thấy dữ liệu; đăng nhập người khác trên cùng trình duyệt ⇒ đúng người", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("about:blank");
  await datHu(page, "HOC_VIEN");
  await page.goto("/elearning", { waitUntil: "load" });
  await page.goto("/elearning/khoa-cua-toi", { waitUntil: "load" }); // có lịch sử để Back
  await page.waitForTimeout(2500); // để yêu cầu nền lắng — đăng xuất tức thời là ca XP-05
  await dangXuatBangMenu(page);
  await page.waitForTimeout(2500);
  const hoSauDangXuat = await huCuaCtx(page.context());
  const ev = { hoSauDangXuat, reload: "", moLai: "", back: "", dangNhapNguoiKhac: "" };
  await page.reload({ waitUntil: "load" });
  ev.reload = new URL(page.url()).pathname;
  await page.goto("/elearning/khoa-cua-toi", { waitUntil: "load" });
  ev.moLai = new URL(page.url()).pathname;
  await page.goBack({ waitUntil: "load" }).catch(() => {});
  // Sau Back, máy chủ đá về /login qua một chuỗi chuyển hướng — đọc nội dung khi trang đã lắng (không đua với điều hướng).
  let htmlBack = "";
  await expect(async () => {
    htmlBack = await page.content();
  }).toPass({ timeout: 15_000 });
  ev.back = `${new URL(page.url()).pathname}|thấyTênNgườiHọc=${htmlBack.includes(TEN.HOC_VIEN)}`;
  // người khác đăng nhập trên cùng page/context
  await login(page, { email: EMAIL.DAO_TAO, callbackUrl: "/elearning/dao-tao" });
  await page.waitForTimeout(800);
  const idMayChu = await danhTinhMayChu(page, emailSangNhan);
  const htmlMoi = await page.content();
  ev.dangNhapNguoiKhac = `${idMayChu}|tên=${tenXuatHien(htmlMoi, tenTheoNhan).join(",")}|hũ=${await huCuaCtx(page.context())}`;
  luu("xp-08-dang-xuat-ben", ev);
  console.log("[XP-08]", JSON.stringify(ev));
  expect(hoSauDangXuat, "hũ cookie phải rỗng sau đăng xuất").toBe("-");
  expect(ev.reload, "Reload sau đăng xuất").toMatch(/^\/login/);
  expect(ev.moLai, "mở lại đường nội bộ sau đăng xuất").toMatch(/^\/login/);
  expect(ev.back, "Back sau đăng xuất không được cho thấy dữ liệu người cũ").not.toContain("thấyTênNgườiHọc=true");
  expect(ev.dangNhapNguoiKhac).toContain("DAO_TAO|");
  expect(ev.dangNhapNguoiKhac).not.toContain(TEN.HOC_VIEN);
});
