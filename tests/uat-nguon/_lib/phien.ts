// tests/uat-nguon/_lib/phien.ts — ĐĂNG NHẬP THEO VAI + giữ nhiều phiên cùng lúc (mỗi vai một browser context).
//
// ── Những điều KHÔNG được sai ───────────────────────────────────────────────────────────────────────────────────────
// 1. Mật khẩu chỉ đến từ env `UAT_PASSWORD` (secret của workflow) — không có mặc định, trống ⇒ dừng. Không bao giờ được in.
// 2. ĐĂNG NHẬP XẢY RA Ở CONTEXT CHƯA BẬT TRACE. Trace của Playwright ghi lại giá trị `fill()` và thân request (kể cả POST đăng
//    nhập) — bật trace trước khi gõ mật khẩu là đưa mật khẩu vào tệp artifact. Chỉ SAU khi đăng nhập xong mới `tracing.start`.
//    (Trace sau đó vẫn mang cookie phiên trong header ⇒ chỉ GIỮ trace của ca đỏ, và workflow đặt retention ngắn.)
// 3. Tới host nào cũng đi qua cổng `phanLoaiRequest`: chuyển trang sang prod/host lạ bị CHẶN và ghi thành lỗi.
// 4. Giới hạn đăng nhập của app: 10 lượt/phút theo IP, 5/phút theo tài khoản (`lib/auth.ts`). Trên VPS header `x-e2e-client-ip`
//    KHÔNG có tác dụng, nên (a) mỗi vai đăng nhập MỘT lần/lượt chạy rồi cất `storageState`, (b) hai lần đăng nhập cách nhau ≥ 15 giây,
//    (c) một lần đăng nhập thất bại ⇒ cắm cờ HUỶ cả lượt, không thử lại, không thử vai khác (sai mật khẩu × 12 vai = khoá IP).
// 5. `storageState` nằm ở `UAT_PHIEN_DIR` (workflow: `$RUNNER_TEMP`), KHÔNG nằm trong thư mục bằng chứng được upload.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { phanLoaiRequest, type MoiTruongUat } from "./an-toan";
import { VAI, emailCuaVai, type KhoaVai } from "./vai";

const TUOI_PHIEN_TOI_DA_MS = 25 * 60_000;
// 15 giây (≈ 4 lượt/phút) thay cho 8 giây: đo trên test 20/10/2026 — với 8 giây, ba lượt chạy trong ngày thỉnh thoảng bị form báo lỗi đăng nhập ở vai THỨ 5–6 của một lượt (uat.giamdoc, uat.saleho) dù mật khẩu
// đúng (cùng tài khoản đăng nhập được ở lượt khác). Hạn mức IP 10/phút còn dùng chung với mọi thứ khác ra từ cùng địa chỉ chạy máy; 15 giây chừa phần lớn hạn mức.
const GIAN_CACH_DANG_NHAP_MS_MAC_DINH = 15_000;

export type Phien = {
  vai: KhoaVai;
  email: string;
  context: BrowserContext;
  page: Page;
  /** Mở thêm một tab cùng phiên (cùng cookie). */
  moTab(): Promise<Page>;
  /** Đóng phiên. `luuTrace` = đường dẫn tệp .zip để giữ trace (ca đỏ), `null` = bỏ trace. */
  dong(luuTrace: string | null): Promise<void>;
};

export type TuyChonPhien = {
  env: MoiTruongUat;
  thuMucPhien: string;
  matKhau: string;
  /** Gọi khi một request bị cổng host chặn. */
  khiViPham: (msg: string) => void;
  /** `false` = không ghi trace (mặc định của local khi muốn nhanh). */
  ghiTrace: boolean;
};

const duoiCo = (dir: string) => join(dir, "HUY-LUOT-CHAY.flag");
const tepPhien = (dir: string, vai: KhoaVai) => join(dir, `${vai}.json`);
const tepLanCuoi = (dir: string) => join(dir, "lan-dang-nhap-cuoi.txt");

function ganDirPhien(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const nguQua = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Đợi cho tới khi cách lần đăng nhập trước ≥ giãn cách (đọc từ tệp — worker Playwright có thể bị khởi động lại giữa các ca). */
async function dungGianCach(dir: string): Promise<void> {
  const gian = Number(process.env.UAT_GIAN_CACH_DANG_NHAP_MS ?? GIAN_CACH_DANG_NHAP_MS_MAC_DINH);
  let truoc = 0;
  try {
    truoc = Number(readFileSync(tepLanCuoi(dir), "utf8"));
  } catch {
    /* chưa có lần nào */
  }
  const cho = truoc + gian - Date.now();
  if (Number.isFinite(cho) && cho > 0) await nguQua(cho);
  writeFileSync(tepLanCuoi(dir), String(Date.now()), "utf8");
}

async function ganCongHost(context: BrowserContext, o: TuyChonPhien): Promise<void> {
  await context.route("**/*", async (route) => {
    const req = route.request();
    if (phanLoaiRequest(req.url(), req.isNavigationRequest(), o.env) === "chan") {
      o.khiViPham(`${req.method()} ${req.url().slice(0, 160)}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

function taoContext(browser: Browser, o: TuyChonPhien, storageState?: string): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: o.env.origin,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1280, height: 800 },
    ...(storageState ? { storageState } : {}),
  });
}

/**
 * Phiên đã cất còn dùng được không. Hỏi một trang CÓ cổng phiên ở tầng layout (`/dashboard`: GV/PH được proxy đá sang site của họ) — KHÔNG hỏi `/login`:
 * proxy chỉ kiểm có JWT hay chưa, nên với JWT cũ (DB đã dựng lại, đổi mật khẩu/vai) `/login` vẫn đá đi như thể còn sống, còn layout mới đá về /login?reason=session-*.
 */
async function phienConSong(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Layout đá phiên hỏng về /login có thể chậm hơn lúc `domcontentloaded` — đợi đứng yên một nhịp rồi mới kết luận.
    await page.waitForTimeout(2_500);
    return !/^\/login/.test(new URL(page.url()).pathname);
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

async function dangNhapMoi(browser: Browser, vai: KhoaVai, o: TuyChonPhien): Promise<void> {
  const email = emailCuaVai(vai);
  await dungGianCach(o.thuMucPhien);
  const context = await taoContext(browser, o); // ⚠️ KHÔNG trace ở đây — xem đầu tệp.
  try {
    await ganCongHost(context, o);
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 45_000 });
    // Cổng cuối trước khi gõ mật khẩu: trang đang đứng phải đúng host test.
    const host = new URL(page.url()).host;
    if (host !== o.env.host) throw new Error(`[UAT-NGUON] Trang đăng nhập đang ở host «${host}», không phải ${o.env.host} — dừng, không gõ mật khẩu.`);

    const idInput = page.locator("#identifier");
    const mkInput = page.locator("#password");
    // Form "Waves" là controlled input: điền trước khi React hydrate xong sẽ bị xoá trắng ⇒ điền lại tới khi giá trị còn dính.
    await expect(async () => {
      await idInput.fill(email);
      await mkInput.fill(o.matKhau);
      await expect(idInput).toHaveValue(email, { timeout: 1_000 });
    }).toPass({ timeout: 25_000 });
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    try {
      await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 60_000 });
    } catch {
      // Có thông báo lỗi của form ⇒ máy chủ ĐÃ trả lời "không" (sai mật khẩu / tài khoản không có / bị giới hạn tần suất): cắm cờ HUỶ, vì thử tiếp vai khác chỉ đốt thêm lượt đăng nhập.
      // Không có thông báo ⇒ chỉ là chậm/chưa trả lời: ca này đỏ nhưng KHÔNG cắm cờ (không kết luận sai mật khẩu từ một lần trả lời chậm).
      const coThongBaoLoi = await page.locator(".password-error.visible").isVisible().catch(() => false);
      if (coThongBaoLoi) {
        writeFileSync(duoiCo(o.thuMucPhien), `đăng nhập ${vai} thất bại`, "utf8");
        throw new Error(`[UAT-NGUON] Đăng nhập ${email} KHÔNG thành công (form báo lỗi). Đã cắm cờ HUỶ cả lượt — không thử vai khác. Kiểm tra secret UAT_PASSWORD đã khớp mật khẩu seed UAT trên test chưa, tài khoản có tồn tại không, và đăng nhập không đang bị giới hạn tần suất.`);
      }
      throw new Error(`[UAT-NGUON] Đăng nhập ${email}: sau 60 giây vẫn ở /login và form KHÔNG báo lỗi (máy chủ chậm/không trả lời). Không cắm cờ HUỶ; ca này đỏ.`);
    }
    await context.storageState({ path: tepPhien(o.thuMucPhien, vai) });
  } finally {
    await context.close();
  }
}

/** Mở một phiên cho vai. Đăng nhập nếu chưa có phiên cất còn sống. */
export async function moPhien(browser: Browser, vai: KhoaVai, o: TuyChonPhien): Promise<Phien> {
  if (!o.matKhau) throw new Error("[UAT-NGUON] UAT_PASSWORD trống — dừng (không có mật khẩu mặc định).");
  ganDirPhien(o.thuMucPhien);
  if (existsSync(duoiCo(o.thuMucPhien))) {
    throw new Error("[UAT-NGUON] Lượt chạy đã bị HUỶ vì một lần đăng nhập thất bại trước đó (cờ HUY-LUOT-CHAY). Không thử đăng nhập nữa.");
  }
  const tep = tepPhien(o.thuMucPhien, vai);
  let dung = false;
  if (existsSync(tep) && Date.now() - statSync(tep).mtimeMs < TUOI_PHIEN_TOI_DA_MS) {
    const thu = await taoContext(browser, o, tep);
    try {
      await ganCongHost(thu, o);
      dung = await phienConSong(thu);
    } finally {
      await thu.close();
    }
  }
  if (!dung) await dangNhapMoi(browser, vai, o);

  const context = await taoContext(browser, o, tep);
  await ganCongHost(context, o);
  if (o.ghiTrace) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  return {
    vai,
    email: emailCuaVai(vai),
    context,
    page,
    moTab: () => context.newPage(),
    dong: async (luuTrace) => {
      try {
        if (o.ghiTrace) await context.tracing.stop(luuTrace ? { path: luuTrace } : undefined);
      } finally {
        await context.close();
      }
    },
  };
}

/** Nhãn người đọc của một vai, in vào bằng chứng: `uat.marketing (Marketing Hội sở)`. */
export const nhanActor = (k: KhoaVai): string => `${VAI[k].local} (${VAI[k].nhan})`;
