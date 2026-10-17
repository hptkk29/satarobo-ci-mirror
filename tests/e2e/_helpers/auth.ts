/**
 * A0-00 → AUTH-SĐT P2 — Auth helpers cho Playwright (login thật qua form /login).
 *
 * Dùng đường đăng nhập THẬT (Credentials provider) thay vì test-only route →
 * test sát production, không mở backdoor. seedUser tạo user (password đã hash),
 * loginAs đăng nhập qua form.
 *
 * P2: đây là BẢN DUY NHẤT của logic login — tests/manual/* và mọi suite import
 * từ đây, đừng chép lại khối fill/click ra spec. `login` thuần Playwright
 * (không đụng DB) nên import được từ mọi chỗ kể cả tests/manual (chạy trên dev
 * DB, không có .env.test); `seed` chỉ được nạp lười bên trong `loginAs` để
 * import file này không kéo Prisma client vào process.
 */
import { expect, type Page } from "@playwright/test";
import { HEADER_IP_E2E } from "../../../lib/security/client-ip";
import type { SeedUserInput } from "./seed";
import { TEST_PASSWORD } from "./fixtures";

/**
 * Đăng nhập qua form /login với email + password đã biết.
 *
 * KHÔNG fill "mộc" một lần: form Waves là controlled input — fill trước khi
 * React hydrate xong sẽ bị hydration XOÁ TRẮNG giá trị → validation "Email
 * không hợp lệ" chặn, signIn không bao giờ bắn (fail câm). Điền rồi xác nhận
 * giá trị CÒN DÍNH (hydration muộn vẫn có thể wipe sau "load") — bị wipe thì
 * toPass() điền lại tới khi ổn định.
 */
/**
 * Một IP khác nhau cho mỗi lượt gọi `login`.
 *
 * Dải `10.90.x.y` là địa chỉ RIÊNG (RFC 1918) nên không đụng gì thật. Bộ đếm chỉ quan tâm
 * chuỗi key, nên chỉ cần KHÁC nhau — không cần hợp lệ về định tuyến.
 */
let demLuotDangNhap = 0;
function ipRiengChoLuotDangNhap(): string {
  demLuotDangNhap += 1;
  // Bọc vòng ở 255×255 — quá con số đó thì trùng lại, nhưng 65.025 lượt đăng nhập trong
  // MỘT phút là con số không bộ test nào chạm tới.
  const a = 1 + Math.floor(demLuotDangNhap / 255) % 255;
  const b = 1 + (demLuotDangNhap % 255);
  return `10.90.${a}.${b}`;
}

export async function login(
  page: Page,
  creds: {
    email: string;
    password?: string;
    callbackUrl?: string;
    /** Trần chờ rời /login sau khi bấm Đăng nhập — dev server cold-compile chậm thì nới lên (tests/manual dùng 120_000). */
    timeout?: number;
  },
): Promise<void> {
  // ── MỖI LƯỢT ĐĂNG NHẬP MỘT IP RIÊNG  [21/09/2026] ────────────────────────
  //
  // `lib/auth.ts:132` chặn brute-force: **10 lượt/phút theo IP**, 5 lượt/phút theo định
  // danh. Bộ đếm nằm trong BỘ NHỚ TIẾN TRÌNH của server (`rateLimit` fail-soft về memory
  // khi không có Upstash), nên `resetDb()` KHÔNG xoá được nó.
  //
  // Hệ quả đo được 21/09: bộ E2E qua trình duyệt đăng nhập bằng CHUNG một IP (localhost),
  // nên từ lượt thứ 11 trong một phút, `authorize()` trả `null` — trang **ở lại `/login`**,
  // không một lỗi nào được ném, và mỗi ca sau đó hết 30 giây rồi mới chịu thua. Với 26 ca
  // × retry, job chạm trần thời gian và bị GIẾT. Đó là lý do bốn job cần trình duyệt treo
  // suốt từ 21/09 — không phải mã hỏng, không phải runner.
  //
  // Cách chữa đi theo đúng TIỀN LỆ ĐÃ CÓ trong repo: `forgot-password.spec.ts` gặp y hệt
  // (cùng một câu "bộ đếm nằm trong bộ nhớ tiến trình… các ca sau bị rate-limit của các ca
  // trước chặn") và giải bằng cách TÁCH IP. Ở đây cũng vậy, chỉ khác là làm một lần cho
  // MỌI suite thay vì từng spec.
  //
  // ⚠️ KHÔNG tắt cổng chặn (`LOGIN_RATELIMIT_DISABLED=1`). Tắt là bỏ một lưới an ninh thật
  // khỏi môi trường test để chữa một vấn đề của giàn thử. Tách IP mô phỏng đúng thực tế —
  // nhiều người dùng khác nhau — và **giữ cổng sống**: ca nào muốn khẳng định cái trần ấy
  // vẫn hoạt động thì cứ cố tình dùng chung một IP, y như `[P6-C6]` đang làm.
  //
  // ⚠️ Vế thứ hai (`login:id:` — 5 lượt/phút theo ĐỊNH DANH) KHÔNG chữa được bằng IP. Spec
  // nào đăng nhập hơn 5 lần/phút bằng CÙNG một email vẫn dính, và đó là hành vi ĐÚNG. Cách
  // đi đúng của spec ấy là mỗi ca một email, không phải nới trần.
  // ⚠️ `x-e2e-client-ip`, KHÔNG phải `x-forwarded-for` [sửa 21/09/2026 sau rà bảo mật].
  //
  // Bản đầu của tôi đặt `x-forwarded-for` — chạy được, nhưng nó DỰA VÀO chính cái lỗ đang
  // phải vá: server tin một header mà client gửi được. Vá xong `ipChoRateLimit` (lấy phần
  // tử CUỐI thay vì ĐẦU) thì mẹo ấy hết tác dụng — và đúng ra là phải hết.
  //
  // Cửa cho test nay là một header RIÊNG, **chỉ tồn tại ngoài production**
  // (`laProductionThat`). Trên prod, đặt header này KHÔNG đổi được khoá chặn tần suất; ca
  // `[CIP-05]` ghim điều đó.
  await page.setExtraHTTPHeaders({ [HEADER_IP_E2E]: ipRiengChoLuotDangNhap() });

  const url = creds.callbackUrl
    ? `/login?callbackUrl=${encodeURIComponent(creds.callbackUrl)}`
    : "/login";
  await page.goto(url);
  const email = page.getByLabel("Email");
  await expect(async () => {
    await email.fill(creds.email);
    await page.getByLabel("Mật khẩu").fill(creds.password ?? TEST_PASSWORD);
    await expect(email).toHaveValue(creds.email, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  // Đăng nhập thành công → rời khỏi /login (router.push(callbackUrl)).
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: creds.timeout ?? 30_000 });
}

/**
 * Seed 1 user theo spec rồi đăng nhập luôn. Trả về user đã tạo.
 * Tiện cho AC1/AC4: `await loginAs(page, { email, role: "SUPER_ADMIN" })`.
 */
export async function loginAs(
  page: Page,
  spec: SeedUserInput & { callbackUrl?: string },
): Promise<{ id: string; email: string }> {
  // Nạp lười: seed.ts import lib/db (Prisma) lúc load — chỉ kéo vào khi thật sự seed.
  const { seedUser } = await import("./seed");
  const user = await seedUser(spec);
  await login(page, {
    email: spec.email,
    password: spec.password,
    callbackUrl: spec.callbackUrl,
  });
  return user;
}
