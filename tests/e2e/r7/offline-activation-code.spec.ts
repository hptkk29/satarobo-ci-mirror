/**
 * AUTH-SĐT P6-C — cấp mã kích hoạt TẠI QUẦY (break-glass khi ZNS chết).
 *
 * Đây là đường DUY NHẤT trong hệ thống trả mã OTP ra dạng chữ, nên nó phải chặt:
 * mã không được rơi vào audit, phải đi kèm lý do, và không được đếm là "tin đã
 * gửi" (nếu không, cảnh báo SLO kêu oan đúng lúc ZNS hỏng — chính là lúc đường
 * này được dùng nhiều nhất).
 *
 * Gọi thẳng service `lib/otp/service.ts` (có `server-only`) nên spec sống ở r7 —
 * chỉ r7/fl/crm nạp tsconfig.playwright.json (bản stub). Tầng Server Action
 * (quyền + scope cơ sở + audit) đã có lưới riêng ở a0/rbac.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { resetDb } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { issueOfflineOtp, verifyAndConsumeOtp } from "../../../lib/otp/service";

const PHONE = "84905222111";

async function seedPendingParent() {
  return db.user.create({
    data: {
      phone: PHONE,
      name: "PH chờ kích hoạt",
      role: "PARENT",
      roles: ["PARENT"],
      accountStatus: "PENDING_ACTIVATION",
      password: null,
    },
    select: { id: true },
  });
}

test.describe("[P6-C] Mã kích hoạt cấp tại quầy", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[P6-C1] mã trả về dùng verify được THẬT (đi đúng đường sản xuất)", async () => {
    const parent = await seedPendingParent();
    const issued = await issueOfflineOtp({
      target: PHONE,
      purpose: "ACTIVATION",
      userId: parent.id,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.code).toMatch(/^\d{6}$/);

    const v = await verifyAndConsumeOtp({
      target: PHONE,
      purpose: "ACTIVATION",
      code: issued.code,
    });
    expect(v.ok).toBe(true);
  });

  test("[P6-C2] ghi channel OFFLINE — KHÔNG đội sổ 'tin đã gửi' của SLO", async () => {
    const parent = await seedPendingParent();
    await issueOfflineOtp({ target: PHONE, purpose: "ACTIVATION", userId: parent.id });

    const req = await db.otpRequest.findFirst({
      where: { target: PHONE },
      select: { channel: true },
    });
    expect(req?.channel).toBe("OFFLINE");

    // Đây chính là phép đếm của metric `otpSentToday` (lib/observability/slo.ts):
    // loại OFFLINE ra thì mã cấp tay không làm cảnh báo chi phí/số lượng kêu oan.
    const countedAsSent = await db.otpDeliveryLog.count({
      where: { status: "SENT", channel: { not: "OFFLINE" } },
    });
    expect(countedAsSent).toBe(0);
  });

  test("[P6-C3] mã KHÔNG bao giờ được gọi API Zalo (không tốn tin)", async () => {
    const parent = await seedPendingParent();
    await issueOfflineOtp({ target: PHONE, purpose: "ACTIVATION", userId: parent.id });

    const zaloLogs = await db.otpDeliveryLog.count({ where: { channel: "ZALO" } });
    expect(zaloLogs).toBe(0);
  });

  test("[P6-C4] vẫn chịu cooldown — cấp tay không phải cửa phát mã vô hạn", async () => {
    const parent = await seedPendingParent();
    const first = await issueOfflineOtp({
      target: PHONE,
      purpose: "ACTIVATION",
      userId: parent.id,
    });
    expect(first.ok).toBe(true);

    const second = await issueOfflineOtp({
      target: PHONE,
      purpose: "ACTIVATION",
      userId: parent.id,
    });
    expect(second.ok).toBe(false);
  });

  test("[P6-C5] mã KHÔNG nằm trong AuditLog (chỉ lý do được ghi)", async () => {
    const parent = await seedPendingParent();
    const issued = await issueOfflineOtp({
      target: PHONE,
      purpose: "ACTIVATION",
      userId: parent.id,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    // Service không tự ghi audit (Server Action mới ghi), nhưng khoá bất biến ở
    // đây để ai đó thêm audit vào service sau này không vô tình nhét cả mã vào.
    const rows = await db.auditLog.findMany({ select: { newValues: true, reason: true } });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(issued.code);
  });
});
