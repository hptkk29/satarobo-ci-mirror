// @vitest-environment node
/**
 * BẢNG NICK ZALOCRM — cách ly cơ sở, ở TẦNG DB THẬT.
 *
 * `nick-admin.test.ts` (mock `@/lib/db`) chứng minh được là ta GỬI ĐI mảnh `where` nào.
 * Nó KHÔNG chứng minh được mảnh đó có thật sự lọc đúng khi Postgres chạy nó — mà đấy
 * mới là câu hỏi. Hai chỗ dễ sai và chỉ lộ ở đây:
 *
 *   · `OR: [{ centerId: { in: [] } }, { centerId: null }]` — trong SQL, `centerId IN ()`
 *     và `centerId = NULL` đều KHÔNG khớp gì theo lối nghĩ thông thường; phải đo mới
 *     biết Prisma dịch ra `IS NULL` chứ không phải `= NULL`.
 *   · `deletedAt: null` — `ZaloCrmNick` có cột xoá mềm nhưng KHÔNG nằm trong
 *     `SOFT_DELETE_MODELS`, nên tầng base KHÔNG chèn hộ. Ca dưới đây đo cả chiều
 *     ngược: bỏ điều kiện ra thì nick đã gỡ hiện lại thật.
 *
 * Và ca [ZC-NA-DB-02] ghim bằng chứng cho câu hay bị hiểu ngược nhất của lô này:
 * `scopedDb` KHÔNG cách ly bảng này chút nào (nó nằm trong `SCOPE_EXEMPT`). Nếu một
 * ngày ai đó xoá `whereNickTheoActor` vì "scopedDb lo rồi", ca đó sẽ vẫn xanh — nên nó
 * cố ý được viết như một lời khai, không như một tấm khiên.
 *
 * ⚠️ Bộ này TỰ SKIP khi không có Postgres local. Thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 * KHÔNG `resetDb()` — dọn theo TIỀN TỐ riêng (`tests/inbox` chạy tuần tự chung một DB).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import { whereNickTheoActor } from "@/lib/integrations/zalocrm/nick-admin";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
// 16/09/2026 — dùng CỔNG DUY NHẤT `RUN_DB_TESTS` (tests/_helpers/db-gate.ts) thay cho
// biểu thức chép tay. Bản chép tay chỉ hỏi "URL có trỏ Postgres cục bộ không" nên BỎ MẤT
// cờ `ALLOW_DB_RESET` — đúng cái chốt dựng sau sự cố mất DB 04/09/2026. Hệ quả đo được:
// trên máy dev (DATABASE_URL = 127.0.0.1/satarobo_local) các bộ này CHẠY THẬT trên DB
// đang làm việc, nên `pnpm test:unit` lúc xanh lúc đỏ tuỳ thứ tự, còn `assertTestDb()`
// thì từ chối dọn ⇒ đỏ câm không liên quan gì tới mã.
const RUN = RUN_DB_TESTS;

if (!RUN) {
  console.warn("[zalocrm-nick] SKIP: DATABASE_URL không trỏ Postgres local.");
}

const db = new PrismaClient();

/** Bảng chưa có ⇒ SKIP kèm câu chỉ việc, đừng đổ một đống `P2021`. */
const CO_BANG =
  RUN &&
  (await db.zaloCrmNick
    .count()
    .then(() => true)
    .catch(() => {
      console.warn(
        "[zalocrm-nick] SKIP: chưa có bảng ZaloCrmNick. Chạy `prisma migrate deploy` " +
          "trên DB test trước (migration zalocrm_bang_nick_thread).",
      );
      return false;
    }));

/** Tiền tố RIÊNG — dùng lại `ZCRM_` của `zalocrm.spec.ts` là hai file dọn dữ liệu của nhau. */
const P = "ZCNA_";
const ORG1 = `${P}org1`;
const ORG2 = `${P}org2`;
const ORG0 = `${P}org0`;
// `centerId` trên bảng này là cột TRẦN, KHÔNG có khoá ngoại (khuôn `FacebookPageMapping`)
// ⇒ không cần dựng `Center` thật, và cũng không được dựng: bộ này không sở hữu bảng đó.
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;

async function purge() {
  await db.zaloCrmNick.deleteMany({ where: { orgCode: { startsWith: P } } });
}

beforeAll(async () => {
  if (!CO_BANG) return;
  await purge();
  await db.zaloCrmNick.createMany({
    data: [
      { zcrmAccountId: `${P}acc-cs1`, orgCode: ORG1, centerId: CS1, displayName: "Nick CS1" },
      { zcrmAccountId: `${P}acc-cs2`, orgCode: ORG2, centerId: CS2, displayName: "Nick CS2" },
      // Chưa ánh xạ cơ sở: orgCode chưa có mục trong `zalocrm.orgCodes`.
      { zcrmAccountId: `${P}acc-mo-coi`, orgCode: ORG0, centerId: null, displayName: "Nick mồ côi" },
      // Đã gỡ tay.
      {
        zcrmAccountId: `${P}acc-da-go`,
        orgCode: ORG1,
        centerId: CS1,
        displayName: "Nick đã gỡ",
        deletedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ],
  });
});

afterAll(async () => {
  if (CO_BANG) await purge();
  await db.$disconnect();
});

const QLCS1 = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [CS1] };
const HO = { isSuperAdmin: false, isHoLevel: true, visibleCenterIds: [CS1, CS2] };
const KHONG_CO_SO = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [] };

/** Chỉ lấy dòng của bộ này — DB test dùng chung với các file khác trong `tests/inbox`. */
function cuaBoNay(where: Record<string, unknown>) {
  return { AND: [where, { orgCode: { startsWith: P } }] };
}

describe.skipIf(!CO_BANG)("whereNickTheoActor trên Postgres thật", () => {
  it("[ZC-NA-DB-01] QLCS CS1 đọc được nick CS1 + nick chưa ánh xạ, KHÔNG thấy nick CS2", async () => {
    const rows = await db.zaloCrmNick.findMany({
      where: cuaBoNay(whereNickTheoActor(QLCS1)),
      select: { zcrmAccountId: true },
    });
    const ids = rows.map((r) => r.zcrmAccountId).sort();
    expect(ids).toEqual([`${P}acc-cs1`, `${P}acc-mo-coi`]);
  });

  it("[ZC-NA-DB-02] scopedDb KHÔNG cách ly bảng này — where của ta là lưới DUY NHẤT", async () => {
    // Truy vấn KHÔNG có điều kiện cơ sở: nếu có bất kỳ lưới nào ở tầng dưới thì nick
    // CS2 đã phải biến mất. Nó không biến mất — đó chính là lý do `whereNickTheoActor`
    // tồn tại, và là lý do xoá nó đi sẽ không làm test nào khác đỏ.
    const rows = await db.zaloCrmNick.findMany({
      where: { orgCode: { startsWith: P }, deletedAt: null },
      select: { zcrmAccountId: true },
    });
    expect(rows.map((r) => r.zcrmAccountId)).toContain(`${P}acc-cs2`);
  });

  it("[ZC-NA-DB-03] nick đã xoá mềm không lọt — và tầng base KHÔNG lọc hộ", async () => {
    const rows = await db.zaloCrmNick.findMany({
      where: cuaBoNay(whereNickTheoActor(HO)),
      select: { zcrmAccountId: true },
    });
    expect(rows.map((r) => r.zcrmAccountId)).not.toContain(`${P}acc-da-go`);

    // Chiều ngược: bỏ `deletedAt: null` ra thì nó hiện lại. `ZaloCrmNick` KHÔNG nằm
    // trong `SOFT_DELETE_MODELS` nên không ai chèn điều kiện đó hộ mình.
    const tatCa = await db.zaloCrmNick.findMany({
      where: { orgCode: { startsWith: P } },
      select: { zcrmAccountId: true },
    });
    expect(tatCa.map((r) => r.zcrmAccountId)).toContain(`${P}acc-da-go`);
  });

  it("[ZC-NA-DB-04] chưa được gán cơ sở nào ⇒ chỉ còn nhóm chưa ánh xạ, không rơi về thấy-hết", async () => {
    // `centerId IN ()` là chỗ dễ sai nhất: nếu Prisma (hoặc một lần "tối ưu" sau này)
    // bỏ hẳn điều kiện khi mảng rỗng thì đây là ca duy nhất bắt được.
    const rows = await db.zaloCrmNick.findMany({
      where: cuaBoNay(whereNickTheoActor(KHONG_CO_SO)),
      select: { zcrmAccountId: true },
    });
    expect(rows.map((r) => r.zcrmAccountId)).toEqual([`${P}acc-mo-coi`]);
  });

  it("[ZC-NA-DB-05] hội sở thấy nick của mọi cơ sở", async () => {
    const rows = await db.zaloCrmNick.findMany({
      where: cuaBoNay(whereNickTheoActor(HO)),
      select: { zcrmAccountId: true },
    });
    expect(rows.map((r) => r.zcrmAccountId).sort()).toEqual([
      `${P}acc-cs1`,
      `${P}acc-cs2`,
      `${P}acc-mo-coi`,
    ]);
  });
});
