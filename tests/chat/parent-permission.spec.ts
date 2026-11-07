// @vitest-environment node
/**
 * MẮT XÍCH ĐÃ ĐỨT MÀ KHÔNG CỔNG NÀO CANH: "một tài khoản PHỤ HUYNH THẬT có quyền gửi
 * tin không?"
 *
 * Sự cố đo được 10/08/2026 trên test VÀ prod: phụ huynh không gửi được tin nào, chữ lẫn
 * ảnh — `sendChatMessageAction` trả PERMISSION_DENIED, trong khi `permissions.md` ghi
 * "PH ✅ Gửi CHAT". Đo trên DB: **114 tài khoản PARENT / 0 dòng UserOrgRole**. RBAC v2
 * lấy quyền DUY NHẤT từ `UserOrgRole` ⇒ `actor.permissions` rỗng ⇒ không có gì để khớp
 * scope. Lỗi ẩn kỹ vì đường ĐỌC chat kiểm theo tư cách thành viên hội thoại, không qua
 * `can()` — phụ huynh vào đọc bình thường, chỉ không gửi được.
 *
 * VÌ SAO MỌI TEST CŨ ĐỀU XANH: `chat-permissions.test.ts` dựng actor v2 bằng cách ĐƯA
 * THẲNG hàng permission của ROLE_SEED vào `buildActor`. Nó kiểm "nếu PH có vai PARENT
 * thì được gửi" — đúng, và vô dụng, vì ngoài đời chẳng phụ huynh nào có vai đó. Không
 * test nào đi từ `User` THẬT trong DB ra tới `can()`.
 *
 * File này đóng đúng khoảng trống đó: tạo User role=PARENT **không hề tạo UserOrgRole**,
 * rồi chạy chuỗi thật `resolveActorUncached → can()` với đúng khuôn target mà
 * `sendTargetOf` dựng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";

import { RUN_DB_TESTS as RUN_DB_TESTS_CHUNG } from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db` / `test:nen-db`.
const RUN_DB_TESTS = RUN_DB_TESTS_CHUNG;

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 120_000;

const P = "CI_CHATPERM_";
const PARENT_EMAIL = `${P}ph@example.test`;
const STAFF_EMAIL = `${P}staff@example.test`;

async function cleanup() {
  await db.user.deleteMany({ where: { email: { in: [PARENT_EMAIL, STAFF_EMAIL] } } });
}

describe.skipIf(!RUN_DB_TESTS)("Chat · phụ huynh THẬT có quyền gửi tin", () => {
  beforeAll(async () => {
    // Quyền v2 nằm ở DỮ LIỆU. Thiếu RoleDef PARENT thì bài test này vô nghĩa — và một
    // bài test vô nghĩa mà vẫn xanh chính là cách lỗ hổng trước sống sót. Nên FAIL TO,
    // kèm chỉ dẫn, thay vì lặng lẽ bỏ qua. (CI đã có bước seed trước khi chạy job này.)
    const parentDef = await db.roleDef.findUnique({ where: { code: "PARENT" } });
    if (!parentDef) {
      throw new Error(
        "Thiếu RoleDef PARENT trong DB test — chạy `pnpm db:seed:roles` trước khi chạy tests/chat.",
      );
    }
    await cleanup();
    await db.user.create({
      data: {
        email: PARENT_EMAIL,
        name: `${P}Phụ huynh`,
        role: "PARENT",
        roles: ["PARENT"],
        isActive: true,
      },
    });
    // Đối chứng: nhân viên KHÔNG có UserOrgRole thì vẫn phải trắng tay — bản vá không
    // được vô tình phát quyền cho mọi người.
    await db.user.create({
      data: {
        email: STAFF_EMAIL,
        name: `${P}Nhân viên`,
        role: "TEACHER",
        roles: ["TEACHER"],
        isActive: true,
      },
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db.$disconnect();
    }
  }, HOOK_TIMEOUT);

  it(
    "PARENT không có dòng UserOrgRole nào vẫn gửi được tin trong hội thoại MÌNH là thành viên",
    async () => {
      const user = await db.user.findUniqueOrThrow({ where: { email: PARENT_EMAIL } });

      // Điều kiện của bài test: đúng là KHÔNG có UserOrgRole (y như 114 phụ huynh thật).
      const orgRoles = await db.userOrgRole.count({ where: { userId: user.id } });
      expect(orgRoles, "fixture phải giống đời thật: phụ huynh KHÔNG có UserOrgRole").toBe(0);

      const actor = await resolveActorUncached(user.id);

      // Khuôn target y hệt `sendTargetOf` (lib/chat/messages.ts): là thành viên hội thoại
      // ⇒ `createdById` = chính mình ⇒ scope OWN khớp.
      const asParticipant = { createdById: user.id, classId: null, centerId: null };
      expect(can(actor, "chat:send", asParticipant)).toBe(true);
      expect(can(actor, "chat:read", asParticipant)).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "…nhưng KHÔNG gửi được vào hội thoại mình không phải thành viên",
    async () => {
      const user = await db.user.findUniqueOrThrow({ where: { email: PARENT_EMAIL } });
      const actor = await resolveActorUncached(user.id);
      // Không phải thành viên ⇒ `sendTargetOf` giữ `createdById` của người tạo hội thoại.
      const notParticipant = { createdById: "nguoi-khac", classId: null, centerId: null };
      expect(can(actor, "chat:send", notParticipant)).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "PARENT không được nới quyền: không HO-level, không thấy cơ sở nào, không có quyền quản trị",
    async () => {
      const user = await db.user.findUniqueOrThrow({ where: { email: PARENT_EMAIL } });
      const actor = await resolveActorUncached(user.id);
      expect(actor.isSuperAdmin).toBe(false);
      expect(actor.isHoLevel).toBe(false);
      expect(actor.visibleCenterIds).toEqual([]);
      expect(actor.visibleOrgUnitIds).toEqual([]);
      expect(can(actor, "chat:announce", { classId: "lop-1", centerId: "c1" })).toBe(false);
      expect(can(actor, "chat:admin", null)).toBe(false);
      expect(can(actor, "leads:view-all", { centerId: "c1" })).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "đối chứng: nhân viên KHÔNG có UserOrgRole vẫn trắng tay (bản vá không phát quyền đại trà)",
    async () => {
      const user = await db.user.findUniqueOrThrow({ where: { email: STAFF_EMAIL } });
      const actor = await resolveActorUncached(user.id);
      expect(actor.permissions).toEqual([]);
      expect(can(actor, "chat:send", { createdById: user.id })).toBe(false);
    },
    CASE_TIMEOUT,
  );
});
