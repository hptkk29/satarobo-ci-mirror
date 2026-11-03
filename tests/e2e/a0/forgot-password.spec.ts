/**
 * AUTH-SĐT P6 — quên mật khẩu qua OTP (`/quen-mat-khau`, purpose RESET).
 *
 * Trước P6 enum `OtpPurpose.RESET` có mà KHÔNG có call-site nào. Sau P5 (tài khoản
 * khoá SĐT, email không bắt buộc) thiếu màn này là mất hẳn đường vào: phụ huynh
 * quên mật khẩu, không có email ⇒ không ai cứu được ngoài gọi trung tâm.
 *
 * Ca quan trọng nhất KHÔNG phải "đặt lại được mật khẩu" mà là **[P6-C2]: phiên cũ
 * bị đá ra**. Không có `tokenVersion++`, JWT cũ sống tới 30 ngày (lib/auth.ts:60
 * không đặt maxAge) — nghĩa là người dùng đổi mật khẩu vì nghi bị chiếm tài khoản
 * mà kẻ kia vẫn ngồi nguyên trong đó.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import bcrypt from "bcryptjs";
import { test, expect, type Page } from "@playwright/test";
import { resetDb, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { testEmail, TEST_PASSWORD } from "../_helpers/fixtures";
import { db } from "../../../lib/db";
import { OTP_TEST_CODE, forceKnownOtp, hashOtp } from "../_helpers/otp";

// ⚠️ KHÔNG `import()` Server Action hay lib có `server-only` vào tiến trình
// Playwright — chúng là module của Next, nạp thẳng sẽ ném "Cannot use import
// statement outside a module". Mọi thao tác ở đây đi qua UI hoặc qua `db`.

const PHONE = "84905888333";
const PHONE_LOCAL = "0905 888 333";
const NEW_PASSWORD = "MatKhauMoi@2026";

/**
 * Mỗi ca test đứng từ một "IP" riêng.
 *
 * Đường xin mã công khai bị chặn **5 lần/IP/giờ** (`otp.ipMaxPerHour`), bộ đếm
 * nằm trong bộ nhớ tiến trình server nên `resetDb()` KHÔNG xoá được. Để chung
 * một IP thì các ca sau tự bị chính rate-limit của các ca trước chặn (đã dính:
 * C2/C4/C5 đỏ trong khi C1/C3 xanh). Tách IP là mô phỏng đúng thực tế nhiều
 * người dùng khác nhau; riêng ca [P6-C6] cố tình dùng CHUNG một IP để khẳng định
 * cái trần đó vẫn hoạt động.
 */
async function requestReset(page: Page, value: string, ipIndex: number) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.9.0.${ipIndex}` });
  await page.goto("/quen-mat-khau");
  const field = page.getByLabel("Số điện thoại hoặc Email");
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Gửi mã đặt lại" }).click();
}

async function submitNewPassword(page: Page, code: string, password: string) {
  await page.getByLabel("Mã OTP (6 số gửi qua Zalo hoặc email)").fill(code);
  await page.getByLabel("Mật khẩu mới (≥ 8 ký tự)").fill(password);
  await page.getByRole("button", { name: "Đặt lại mật khẩu" }).click();
}

test.describe("[P6] Quên mật khẩu", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[P6-C1] phụ huynh chỉ có SĐT đặt lại được mật khẩu rồi đăng nhập bằng mật khẩu mới", async ({
    page,
  }) => {
    const parent = await db.user.create({
      data: {
        phone: PHONE,
        email: null,
        name: "PH quên MK",
        role: "PARENT",
        roles: ["PARENT"],
        accountStatus: "ACTIVE",
        // seedUser khoá theo email nên không dùng được cho user chỉ có SĐT.
        password: bcrypt.hashSync(TEST_PASSWORD, 10),
      },
      select: { id: true, tokenVersion: true },
    });

    await requestReset(page, PHONE_LOCAL, 1);
    // Target phải là canonical dù người dùng gõ `0905…`.
    expect(await forceKnownOtp(PHONE, "RESET")).toBe(1);

    await submitNewPassword(page, OTP_TEST_CODE, NEW_PASSWORD);
    await expect(page.getByRole("button", { name: "Đến trang đăng nhập" })).toBeVisible({
      timeout: 15_000,
    });

    const after = await db.user.findUnique({
      where: { id: parent.id },
      select: { tokenVersion: true, mustChangePassword: true },
    });
    // Người dùng TỰ đặt mật khẩu này → không bắt đổi lại lần đăng nhập kế tiếp.
    expect(after?.mustChangePassword).toBe(false);
    expect(after?.tokenVersion).toBe(parent.tokenVersion + 1);

    await page.goto("/login");
    const idField = page.getByLabel("Số điện thoại hoặc Email");
    await expect(async () => {
      await idField.fill(PHONE_LOCAL);
      await page.getByLabel("Mật khẩu").fill(NEW_PASSWORD);
      await expect(idField).toHaveValue(PHONE_LOCAL, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("[P6-C2] đặt lại mật khẩu ĐÁ phiên đang đăng nhập ở thiết bị khác", async ({
    page,
    browser,
  }) => {
    // Đây là lý do tồn tại của tokenVersion++. Nếu ai đó gỡ dòng đó, ca này đỏ.
    const email = testEmail("p6-reset");
    await seedUser({ email, role: "SUPER_ADMIN", phone: null });

    // Thiết bị 1: đang đăng nhập.
    await login(page, { email });
    await expect(page).not.toHaveURL(/\/login/);

    // Thiết bị 2 (context riêng, không chung cookie): chạy luồng quên mật khẩu.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await requestReset(otherPage, email, 2);
    expect(await forceKnownOtp(email, "RESET")).toBe(1);
    await submitNewPassword(otherPage, OTP_TEST_CODE, NEW_PASSWORD);
    await expect(otherPage.getByRole("button", { name: "Đến trang đăng nhập" })).toBeVisible({
      timeout: 15_000,
    });
    await other.close();

    // Phiên của thiết bị 1 phải chết ở lần điều hướng kế tiếp.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("[P6-C3] định danh không tồn tại → trả lời y hệt, KHÔNG tạo OtpRequest", async ({
    page,
  }) => {
    await requestReset(page, "0905000777", 3);
    await expect(page.getByLabel("Mã OTP (6 số gửi qua Zalo hoặc email)")).toBeVisible({
      timeout: 15_000,
    });
    expect(await db.otpRequest.count()).toBe(0);
  });

  test("[P6-C4] tài khoản CHƯA kích hoạt không đặt lại được (và không lộ điều đó)", async ({
    page,
  }) => {
    await db.user.create({
      data: {
        phone: PHONE,
        name: "PH chưa kích hoạt",
        role: "PARENT",
        roles: ["PARENT"],
        accountStatus: "PENDING_ACTIVATION",
        password: null,
      },
    });

    await requestReset(page, PHONE_LOCAL, 4);
    // Giao diện chuyển bước như thường (bịt oracle)...
    await expect(page.getByLabel("Mã OTP (6 số gửi qua Zalo hoặc email)")).toBeVisible({
      timeout: 15_000,
    });
    // ...nhưng không có mã nào được phát: tài khoản chưa có mật khẩu để "đặt lại",
    // đường đúng của họ là /kich-hoat.
    expect(await db.otpRequest.count()).toBe(0);
  });

  test("[P6-C5] mã của luồng KÍCH HOẠT không mở được luồng ĐẶT LẠI", async ({ page }) => {
    // `purpose` là một phần khoá tra cứu. Nếu ai đó bỏ nó khỏi where, một mã kích
    // hoạt (đường ai cũng xin được) sẽ mở luôn được đường đổi mật khẩu.
    const oldHash = bcrypt.hashSync(TEST_PASSWORD, 10);
    const user = await db.user.create({
      data: {
        phone: PHONE,
        name: "PH",
        role: "PARENT",
        roles: ["PARENT"],
        accountStatus: "ACTIVE",
        password: oldHash,
      },
      select: { id: true },
    });

    // Mã ACTIVATION hợp lệ, biết trước — nằm sẵn trong DB.
    await db.otpRequest.create({
      data: {
        target: PHONE,
        channel: "ZALO",
        purpose: "ACTIVATION",
        codeHash: hashOtp(OTP_TEST_CODE),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        maxAttempts: 5,
        userId: user.id,
      },
    });

    // Đi đúng luồng quên mật khẩu (sinh ra một OtpRequest RESET với mã NGẪU NHIÊN
    // mà test không biết), rồi nộp mã ACTIVATION ở trên.
    await requestReset(page, PHONE_LOCAL, 5);
    await submitNewPassword(page, OTP_TEST_CODE, NEW_PASSWORD);

    // Không được sang bước "done", và mật khẩu phải nguyên vẹn.
    await expect(page.getByRole("button", { name: "Đến trang đăng nhập" })).toBeHidden();
    const after = await db.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    expect(after?.password).toBe(oldHash);
  });

  test("[P6-C6] một IP xin mã quá nhiều lần → bị chặn (trần otp.ipMaxPerHour)", async ({
    page,
  }) => {
    // Màn quên mật khẩu là nơi tự nhiên nhất để dò xem một SĐT có phải khách của
    // trung tâm hay không, nên trần theo IP là tuyến phòng thủ chính. Ca này cố
    // tình giữ NGUYÊN một IP qua nhiều lần gửi (khác các ca trên).
    const IP = 99;
    // Bất biến cần khoá là "một IP KHÔNG xin mã được vô hạn", không phải con số 5
    // chính xác: `otp.ipMaxPerHour` chỉnh được ở SystemSetting, và bộ đếm nằm
    // trong bộ nhớ server nên khi Playwright retry ca này nó đã đếm dở từ lượt
    // trước. Vì vậy: bấm tối đa TRẦN+1 lượt, khẳng định thông báo chặn xuất hiện
    // — không ép nó rơi vào đúng lượt nào.
    const MAX_TRIES = 6;
    const blocked = page.getByText("Bạn đã yêu cầu mã quá nhiều lần", { exact: false }).first();

    for (let i = 0; i < MAX_TRIES; i++) {
      await requestReset(page, `090500${String(i).padStart(4, "0")}`, IP);
      if (await blocked.isVisible().catch(() => false)) break;
    }

    // Lỗi này KHÔNG phụ thuộc target nên được phép nói thật (không dựng lại oracle).
    await expect(blocked).toBeVisible({ timeout: 10_000 });
  });
});
