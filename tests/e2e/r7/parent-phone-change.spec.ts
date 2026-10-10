/**
 * AUTH-SĐT P6-B — đổi SĐT đăng nhập của phụ huynh (OTP `CHANGE_CONTACT`).
 *
 * Sau P5, `User.phone` vừa là định danh đăng nhập vừa là nơi nhận OTP, nên đây là
 * bề mặt dễ mở đường chiếm tài khoản nhất trong cả P6. Hai bất biến phải khoá:
 *   · mã gửi tới **SỐ MỚI** (chứng minh đang cầm số đó) — gửi tới số cũ thì ai
 *     chiếm được phiên là đổi được sang số bất kỳ;
 *   · `User.phone` và `Student.parentPhone` đổi **cùng nhau**, nếu không thì gộp
 *     anh chị em trượt và ZNS điểm danh gửi nhầm người.
 *
 * Gọi thẳng service ở `lib/` (không qua UI) — luồng này nằm sau đăng nhập portal,
 * dựng cả phiên phụ huynh chỉ để bấm 2 nút là đắt mà không kiểm thêm được gì.
 *
 * Ở suite r7 (không phải a0) vì spec gọi thẳng service `lib/` có `import "server-only"`:
 * chỉ r7/fl/crm nạp `tsconfig.playwright.json` (bản stub `server-only`), a0 thì không.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { resetDb } from "../_helpers/seed";
import { db } from "../../../lib/db";
import { OTP_TEST_CODE, forceKnownOtp } from "../_helpers/otp";
import {
  requestParentPhoneChange,
  confirmParentPhoneChange,
} from "../../../lib/parents/phone-change";

const OLD_PHONE = "84905111222";
const NEW_PHONE = "84906333444";
const NEW_PHONE_LOCAL = "0906 333 444";

async function seedParentWithChild(phone: string) {
  const parent = await db.user.create({
    data: {
      phone,
      name: "PH đổi số",
      role: "PARENT",
      roles: ["PARENT"],
      accountStatus: "ACTIVE",
    },
    select: { id: true },
  });
  const student = await db.student.create({
    data: { name: "Con A", parentUserId: parent.id, parentPhone: phone },
    select: { id: true },
  });
  return { parentId: parent.id, studentId: student.id };
}

test.describe("[P6-B] Đổi SĐT đăng nhập của phụ huynh", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[P6-B1] mã gửi tới SỐ MỚI, không phải số cũ", async () => {
    const { parentId } = await seedParentWithChild(OLD_PHONE);

    // KHÔNG khẳng định `res.ok`: môi trường test không có creds Zalo nên khâu GỬI
    // luôn hỏng, và hàm báo thật (người dùng đã đăng nhập — đây không phải đường
    // công khai cần bịt oracle). Điều ca này kiểm là mã được phát cho SỐ NÀO;
    // `requestOtp` tạo `OtpRequest` trước khi gửi nên vẫn kiểm được.
    await requestParentPhoneChange(parentId, NEW_PHONE_LOCAL);

    const rows = await db.otpRequest.findMany({
      where: { purpose: "CHANGE_CONTACT" },
      select: { target: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target).toBe(NEW_PHONE); // canonical, và là SỐ MỚI
    expect(rows[0]?.target).not.toBe(OLD_PHONE);
  });

  test("[P6-B2] xác nhận đúng mã → User.phone và Student.parentPhone đổi CÙNG nhau", async () => {
    const { parentId, studentId } = await seedParentWithChild(OLD_PHONE);

    await requestParentPhoneChange(parentId, NEW_PHONE_LOCAL);
    expect(await forceKnownOtp(NEW_PHONE, "CHANGE_CONTACT")).toBe(1);

    const done = await confirmParentPhoneChange(parentId, NEW_PHONE_LOCAL, OTP_TEST_CODE);
    expect(done.ok).toBe(true);

    const [user, student] = await Promise.all([
      db.user.findUnique({
        where: { id: parentId },
        select: { phone: true, phoneVerifiedAt: true },
      }),
      db.student.findUnique({ where: { id: studentId }, select: { parentPhone: true } }),
    ]);
    expect(user?.phone).toBe(NEW_PHONE);
    expect(user?.phoneVerifiedAt).not.toBeNull();
    // Bất biến "một nguồn sự thật" — hai bảng không được trôi lệch.
    expect(student?.parentPhone).toBe(NEW_PHONE);
  });

  test("[P6-B3] sai mã → KHÔNG đổi gì cả", async () => {
    const { parentId, studentId } = await seedParentWithChild(OLD_PHONE);
    await requestParentPhoneChange(parentId, NEW_PHONE_LOCAL);
    await forceKnownOtp(NEW_PHONE, "CHANGE_CONTACT");

    const res = await confirmParentPhoneChange(parentId, NEW_PHONE_LOCAL, "000000");
    expect(res.ok).toBe(false);

    const [user, student] = await Promise.all([
      db.user.findUnique({ where: { id: parentId }, select: { phone: true } }),
      db.student.findUnique({ where: { id: studentId }, select: { parentPhone: true } }),
    ]);
    expect(user?.phone).toBe(OLD_PHONE);
    expect(student?.parentPhone).toBe(OLD_PHONE);
  });

  test("[P6-B4] số đã thuộc tài khoản khác → chặn TRƯỚC khi tốn tin ZNS", async () => {
    const { parentId } = await seedParentWithChild(OLD_PHONE);
    await db.user.create({
      data: { phone: NEW_PHONE, name: "PH khác", role: "PARENT", roles: ["PARENT"] },
    });

    const res = await requestParentPhoneChange(parentId, NEW_PHONE_LOCAL);
    expect(res.ok).toBe(false);
    // Không có OtpRequest nào ⇒ không gửi tin, không tốn tiền.
    expect(await db.otpRequest.count()).toBe(0);
  });

  test("[P6-B5] số cố định bị từ chối (ZNS không gửi vào số bàn)", async () => {
    const { parentId } = await seedParentWithChild(OLD_PHONE);
    const res = await requestParentPhoneChange(parentId, "02363123456");
    expect(res.ok).toBe(false);
    expect(await db.otpRequest.count()).toBe(0);
  });

  test("[P6-B6] số bị người khác chiếm GIỮA lúc gửi mã và lúc xác nhận → không ghi đè", async () => {
    // Cửa sổ đua thật: đường cấp tài khoản theo SĐT (provision) chạy song song.
    const { parentId } = await seedParentWithChild(OLD_PHONE);
    await requestParentPhoneChange(parentId, NEW_PHONE_LOCAL);
    expect(await forceKnownOtp(NEW_PHONE, "CHANGE_CONTACT")).toBe(1);

    await db.user.create({
      data: { phone: NEW_PHONE, name: "Người nhanh tay", role: "PARENT", roles: ["PARENT"] },
    });

    const res = await confirmParentPhoneChange(parentId, NEW_PHONE_LOCAL, OTP_TEST_CODE);
    expect(res.ok).toBe(false);
    const user = await db.user.findUnique({ where: { id: parentId }, select: { phone: true } });
    expect(user?.phone).toBe(OLD_PHONE);
  });
});
