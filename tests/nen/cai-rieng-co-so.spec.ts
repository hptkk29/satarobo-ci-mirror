// @vitest-environment node
/**
 * PHIÊN H — BA TRẠNG THÁI CỦA MỘT THAM SỐ TẠI MỘT CƠ SỞ, đo trên Postgres thật.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO BỘ NÀY TỒN TẠI
 *
 * `setCenterSetting` có trong repo từ R6-A và **0 giao diện nào gọi** (đo 22/09/2026). Cả
 * đường ghi lẫn đường đọc đều chạy được, nhưng chưa ai đi hết một vòng ĐẦY ĐỦ: bật riêng →
 * đọc lại → tắt riêng → đọc lại → GỠ → đọc lại. PHIÊN H dựng giao diện cho đường ấy, nên
 * đây là lượt đầu tiên vòng ấy được đo.
 *
 * Thứ bộ này canh, và test thuần KHÔNG canh được:
 *
 *   · **Ba trạng thái là BA.** `theo toàn hệ` (không có dòng) · `bật riêng` (dòng `true`) ·
 *     `tắt riêng` (dòng `false`). Hai cái sau đều có dòng; cái đầu chỉ diễn đạt được bằng
 *     việc KHÔNG có dòng. `[CRC-03]` đo đúng chỗ dễ gộp nhầm thành hai.
 *   · **Gỡ ≠ tắt.** `[CRC-05]` đo ca gắt nhất: toàn hệ đang BẬT, cơ sở TẮT RIÊNG, rồi gỡ ⇒
 *     cơ sở phải quay về BẬT. Ai hiện thực "gỡ" bằng cách ghi `false` sẽ xanh mọi ca khác và
 *     đỏ đúng ca này.
 *   · **Cổng đứng TRƯỚC phép xoá.** `[CRC-07]`/`[CRC-08]` đo dòng CÓ CÒN KHÔNG sau khi bị từ
 *     chối — không chỉ đo câu trả lời. Một cổng nằm sau `delete` vẫn trả `ok:false` rất
 *     thuyết phục (luật rollback, CLAUDE.md).
 *
 * ⚠️ LUẬT 18 — mỗi ca DỰNG LẠI HIỆN TRƯỜNG CỦA CHÍNH NÓ ở dòng đầu (`datHienTruong`), không
 * ca nào mượn trạng thái ca trước. Bản đầu của bộ này viết theo lối kể chuyện (ca 4 nói
 * "trạng thái dựng từ hai ca trên") — chạy đủ bộ thì xanh, chạy riêng một ca thì đỏ, và đó
 * đúng là hình dạng mà luật 18 bảo phải diệt.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. `assertTestDb()` chặn chạy ngoài Postgres
 * local; dọn theo tiền tố `CI_CRC_` ở beforeAll VÀ afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import {
  getSetting,
  setCenterSetting,
  clearCenterSetting,
  clearSettingsCache,
} from "../../lib/settings/service";
import { docCaiRiengTheoCoSo } from "../../lib/settings/co-so-cau-hinh";

import { RUN_DB_TESTS } from "../_helpers/db-gate";
const RUN = RUN_DB_TESTS;

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;
const P = "CI_CRC_";

/**
 * Khoá đem ra thử: công tắc THẬT của module thu học phí linh hoạt.
 *
 * Cố ý KHÔNG bịa một khoá riêng cho test. Khoá này là thứ runbook pilot đang bật bằng SQL tay
 * cho CS2 (`docs/runbook-bat-thu-linh-hoat-cs2.md`), tức đúng đường mà PHIÊN H thay thế —
 * và nó `centerOverridable: true`, mặc định TẮT.
 */
const KHOA = "billing.flexV1Enabled";

/**
 * Khoá của CẤP CƠ SỞ — khoá DUY NHẤT loại mà Quản lý cơ sở được tự đặt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ VÌ SAO PHẢI CÓ KHOÁ THỨ HAI TRONG SPEC NÀY [27/09/2026]
 *
 * `KHOA` ở trên `centerOverridable: true` nhưng **không** khai `qlcsSuaDuoc`. Từ bản vá
 * 25/09, `setCenterSetting`/`clearCenterSetting` có **vế thứ hai**: đúng cơ sở chưa đủ,
 * còn phải đúng KHOÁ (`duocSuaKhoaCuaCoSo`). Chốt 22/09 của chủ dự án cho cấp cơ sở đúng
 * HAI khoá — trần số đợt và trần số ưu đãi; `billing.flexV1Enabled` là công tắc module,
 * quản trị hệ thống đặt.
 *
 * Nên `[CRC-09]` (đối chứng DƯƠNG cho `[CRC-08]`) phải đổi sang khoá này. **Mục đích của
 * nó không đổi một chữ**: nếu `clearCenterSetting` trả `FORBIDDEN` cho MỌI người thì
 * `[CRC-08]` vẫn xanh, và chỉ đối chứng dương mới phát hiện — đúng luật 11.
 *
 * ⚠️ Đừng "sửa" bằng cách khai `qlcsSuaDuoc: true` cho `billing.flexV1Enabled` để ca cũ
 * xanh lại: đó là nới quyền thật cho vừa một ca test.
 */
const KHOA_QLCS = "orders.maxInstallments";

/** Giá trị hợp lệ cho `KHOA_QLCS` (schema là số nguyên, không phải boolean như `KHOA`). */
const QLCS_TOAN_HE = 4;
const QLCS_RIENG = 3;

if (!RUN) {
  console.warn("[cai-rieng-co-so] SKIP: DATABASE_URL không trỏ Postgres local.");
}

let W: {
  cs1: string;
  cs2: string;
  quanTriId: string;
  qlcs1Id: string;
};

async function cleanup() {
  await db.centerSetting.deleteMany({ where: { key: { in: [KHOA, KHOA_QLCS] } } });
  await db.systemSetting.deleteMany({ where: { key: { in: [KHOA, KHOA_QLCS] } } });
  const users = await db.user.findMany({
    where: { email: { startsWith: P } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  clearSettingsCache();
}

/**
 * Dựng hiện trường cho MỘT ca — ghi thẳng bằng Prisma, không qua `setGlobalSetting`/
 * `setCenterSetting`.
 *
 * Cố ý không dùng đường service để dựng: hiện trường phải độc lập với thứ đang được kiểm,
 * kẻo một bản vá làm hỏng đường ghi sẽ hỏng luôn phần dựng và ca đỏ vì lý do sai chỗ.
 *
 * `rieng` nhận `undefined` nghĩa là **không có dòng** (cơ sở theo toàn hệ) — đúng cách ba
 * trạng thái được diễn đạt trong dữ liệu.
 */
async function datHienTruong(opts: {
  toanHe: boolean;
  rieng?: Partial<Record<"cs1" | "cs2", boolean>>;
}) {
  await db.systemSetting.upsert({
    where: { key: KHOA },
    create: { key: KHOA, valueJson: opts.toanHe },
    update: { valueJson: opts.toanHe },
  });
  await db.centerSetting.deleteMany({ where: { key: KHOA } });
  const dong = (["cs1", "cs2"] as const)
    .filter((k) => opts.rieng?.[k] !== undefined)
    .map((k) => ({ orgUnitId: W[k], key: KHOA, valueJson: opts.rieng![k]! }));
  if (dong.length > 0) await db.centerSetting.createMany({ data: dong });
  clearSettingsCache();
}

/** Số dòng `CenterSetting` đang tồn tại cho khoá thử — dùng để đo "có xoá hay không". */
async function demDong(orgUnitId: string): Promise<number> {
  return db.centerSetting.count({ where: { orgUnitId, key: KHOA } });
}

/** Cùng lối với `datHienTruong`, nhưng cho `KHOA_QLCS` (giá trị SỐ). */
async function datHienTruongQlcs(rieng?: Partial<Record<"cs1" | "cs2", number>>) {
  await db.systemSetting.upsert({
    where: { key: KHOA_QLCS },
    create: { key: KHOA_QLCS, valueJson: QLCS_TOAN_HE },
    update: { valueJson: QLCS_TOAN_HE },
  });
  await db.centerSetting.deleteMany({ where: { key: KHOA_QLCS } });
  const dong = (["cs1", "cs2"] as const)
    .filter((k) => rieng?.[k] !== undefined)
    .map((k) => ({ orgUnitId: W[k], key: KHOA_QLCS, valueJson: rieng![k]! }));
  if (dong.length > 0) await db.centerSetting.createMany({ data: dong });
  clearSettingsCache();
}

async function demDongQlcs(orgUnitId: string): Promise<number> {
  return db.centerSetting.count({ where: { orgUnitId, key: KHOA_QLCS } });
}

/** Hàng của một cơ sở trong map mà giao diện nhận. */
async function hangCuaCoSo(orgUnitId: string) {
  const map = await docCaiRiengTheoCoSo([KHOA], "TAT_CA");
  return (map[KHOA] ?? []).find((c) => c.orgUnitId === orgUnitId);
}

describe.skipIf(!RUN)("PHIÊN H · ba trạng thái cài riêng theo cơ sở (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();

    const cs1 = await db.orgUnit.findUniqueOrThrow({
      where: { code: "CS1" },
      select: { id: true },
    });
    const cs2 = await db.orgUnit.findUniqueOrThrow({
      where: { code: "CS2" },
      select: { id: true },
    });
    const goc = await db.orgUnit.findFirstOrThrow({
      where: { type: { in: ["ROOT", "HO"] } },
      orderBy: { depth: "asc" },
      select: { id: true },
    });

    const vaiSuper = await db.roleDef.findUniqueOrThrow({
      where: { code: "SUPER_ADMIN" },
      select: { id: true },
    });
    const vaiQlcs = await db.roleDef.findUniqueOrThrow({
      where: { code: "CENTER_MANAGER" },
      select: { id: true },
    });

    const quanTri = await seedUser({
      email: `${P}admin@ci.test`,
      name: `${P}Quản trị`,
      role: "SUPER_ADMIN",
    });
    const qlcs1 = await seedUser({
      email: `${P}qlcs1@ci.test`,
      name: `${P}QLCS1`,
      role: "CENTER_MANAGER",
    });

    await db.userOrgRole.createMany({
      data: [
        { userId: quanTri.id, orgUnitId: goc.id, roleId: vaiSuper.id, grantedById: quanTri.id },
        { userId: qlcs1.id, orgUnitId: cs1.id, roleId: vaiQlcs.id, grantedById: quanTri.id },
      ],
      skipDuplicates: true,
    });

    W = { cs1: cs1.id, cs2: cs2.id, quanTriId: quanTri.id, qlcs1Id: qlcs1.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanup();
    await disconnectDb();
  }, HOOK_TIMEOUT);

  it(
    "[CRC-01] chưa cài gì ⇒ cơ sở THEO TOÀN HỆ, và map không mang giá trị riêng",
    async () => {
      await datHienTruong({ toanHe: false });

      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(false);
      expect(await demDong(W.cs1)).toBe(0);

      const cs1 = await hangCuaCoSo(W.cs1);
      expect(cs1).toBeTruthy();
      // ⚠️ `"giaTriRieng" in cs1` chứ không `cs1.giaTriRieng === undefined`: giao diện phân
      // biệt ba trạng thái bằng SỰ CÓ MẶT của trường này, nên ca phải đo đúng thứ đó.
      expect("giaTriRieng" in cs1!).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-02] BẬT RIÊNG một cơ sở khi toàn hệ đang TẮT ⇒ chỉ cơ sở đó bật",
    async () => {
      await datHienTruong({ toanHe: false });

      const actor = await resolveActorUncached(W.quanTriId);
      const r = await setCenterSetting(actor, {
        orgUnitId: W.cs2,
        key: KHOA,
        value: true,
        reason: "pilot CS2",
        actorName: "ci",
      });
      expect(r.ok).toBe(true);

      expect(await getSetting(KHOA, { orgUnitId: W.cs2 })).toBe(true);
      // Cơ sở KHÁC và mức toàn hệ không được nhúc nhích — đây là cả lý do tồn tại của pilot.
      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(false);
      expect(await getSetting(KHOA)).toBe(false);

      expect((await hangCuaCoSo(W.cs2))?.giaTriRieng).toBe(true);
      expect("giaTriRieng" in (await hangCuaCoSo(W.cs1))!).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-03] TẮT RIÊNG khi toàn hệ đang BẬT ⇒ dòng `false` CÓ THẬT, không phải vắng mặt",
    async () => {
      await datHienTruong({ toanHe: true });

      const actor = await resolveActorUncached(W.quanTriId);
      const r = await setCenterSetting(actor, {
        orgUnitId: W.cs1,
        key: KHOA,
        value: false,
        reason: "CS1 đang có sự cố, gỡ ra",
        actorName: "ci",
      });
      expect(r.ok).toBe(true);

      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(false);
      expect(await getSetting(KHOA, { orgUnitId: W.cs2 })).toBe(true);
      expect(await getSetting(KHOA)).toBe(true);

      // Chỗ dễ sai nhất: `false` là một GIÁ TRỊ ĐÃ CÀI, không phải "chưa cài". Bộ nạp phải
      // mang nó ra, kẻo giao diện vẽ "theo toàn hệ (đang bật)" cho một cơ sở đang TẮT.
      const cs1 = await hangCuaCoSo(W.cs1);
      expect("giaTriRieng" in cs1!).toBe(true);
      expect(cs1?.giaTriRieng).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-04] BA cơ sở ở BA trạng thái đọc đúng trong CÙNG một lượt",
    async () => {
      await datHienTruong({ toanHe: true, rieng: { cs1: false, cs2: true } });

      const map = await docCaiRiengTheoCoSo([KHOA], "TAT_CA");
      const hang = map[KHOA] ?? [];
      expect(hang.find((c) => c.orgUnitId === W.cs1)?.giaTriRieng).toBe(false);
      expect(hang.find((c) => c.orgUnitId === W.cs2)?.giaTriRieng).toBe(true);
      // Mọi cơ sở KHÁC hai cái trên phải là "theo toàn hệ" — một bộ nạp gán nhầm giá trị
      // sang cơ sở khác sẽ lộ ra ở đây chứ không ở hai ca trên (chúng chỉ hỏi về một cơ sở).
      for (const c of hang) {
        if (c.orgUnitId === W.cs1 || c.orgUnitId === W.cs2) continue;
        expect("giaTriRieng" in c).toBe(false);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-05] GỠ ≠ TẮT — gỡ mức riêng `false` khi toàn hệ BẬT ⇒ cơ sở quay về BẬT",
    async () => {
      // Ca gắt nhất của PHIÊN H. Ai hiện thực "Trả về theo toàn hệ" bằng cách ghi `false`
      // sẽ xanh mọi ca khác và đỏ đúng ở đây: cơ sở vẫn TẮT trong khi toàn hệ đang BẬT.
      await datHienTruong({ toanHe: true, rieng: { cs1: false } });
      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(false);

      const actor = await resolveActorUncached(W.quanTriId);
      const r = await clearCenterSetting(actor, {
        orgUnitId: W.cs1,
        key: KHOA,
        reason: "CS1 đã khắc phục xong, trả về theo toàn hệ",
        actorName: "ci",
      });
      expect(r.ok).toBe(true);

      expect(await demDong(W.cs1)).toBe(0);
      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(true);
      expect("giaTriRieng" in (await hangCuaCoSo(W.cs1))!).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-06] gỡ có ghi AuditLog kèm giá trị CŨ và lý do",
    async () => {
      // Nhật ký là thứ duy nhất trả lời "ai gỡ, lúc nào, vì sao" khi một cơ sở đột nhiên
      // chạy theo mức toàn hệ. Không có nó thì việc gỡ là một thay đổi vô danh.
      await datHienTruong({ toanHe: true, rieng: { cs1: false } });
      await db.auditLog.deleteMany({
        where: { entityType: "CenterSetting", entityId: `${W.cs1}:${KHOA}` },
      });

      const actor = await resolveActorUncached(W.quanTriId);
      await clearCenterSetting(actor, {
        orgUnitId: W.cs1,
        key: KHOA,
        reason: "CS1 đã khắc phục xong, trả về theo toàn hệ",
        actorName: "ci",
      });

      const dong = await db.auditLog.findFirst({
        where: {
          entityType: "CenterSetting",
          entityId: `${W.cs1}:${KHOA}`,
          action: "DELETE",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(dong).toBeTruthy();
      expect(dong?.reason).toContain("trả về theo toàn hệ");
      // Giá trị CŨ phải còn trong nhật ký: đó là thứ duy nhất dựng lại được trạng thái trước
      // khi gỡ, vì dòng `CenterSetting` đã không còn.
      expect(dong?.oldValues).toEqual({ value: false });
      expect(dong?.orgUnitId).toBe(W.cs1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-07] thiếu lý do ⇒ TỪ CHỐI, và dòng VẪN CÒN NGUYÊN",
    async () => {
      await datHienTruong({ toanHe: false, rieng: { cs2: true } });

      const actor = await resolveActorUncached(W.quanTriId);
      const r = await clearCenterSetting(actor, {
        orgUnitId: W.cs2,
        key: KHOA,
        reason: "   ",
        actorName: "ci",
      });
      expect(r.ok).toBe(false);

      // ⚠️ Vế thứ hai mới là vế đáng tiền: một cổng đứng SAU `delete` cũng trả `ok:false`,
      // và người vận hành đọc câu từ chối rồi yên tâm rằng không có gì đổi — trong khi dòng
      // đã bay (luật rollback, CLAUDE.md).
      expect(await demDong(W.cs2)).toBe(1);
      expect(await getSetting(KHOA, { orgUnitId: W.cs2 })).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-08] quản lý CS1 KHÔNG gỡ được mức riêng của CS2 — và dòng vẫn còn",
    async () => {
      await datHienTruong({ toanHe: false, rieng: { cs2: true } });

      const actor = await resolveActorUncached(W.qlcs1Id);
      const r = await clearCenterSetting(actor, {
        orgUnitId: W.cs2,
        key: KHOA,
        reason: "thử vượt quyền",
        actorName: "ci",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
      expect(await demDong(W.cs2)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-09] quản lý CS1 gỡ được mức riêng CỦA CHÍNH CS1 — trên khoá CẤP CƠ SỞ",
    async () => {
      // Đối chứng DƯƠNG cho ca ngay trên. Một ca chỉ khẳng định SỰ TỪ CHỐI luôn ĐẠT khi
      // tính năng hỏng hoàn toàn (CLAUDE.md luật 11) — thiếu ca này thì `clearCenterSetting`
      // trả `FORBIDDEN` cho MỌI người vẫn xanh.
      //
      // ⚠️ ĐỔI KHOÁ 27/09/2026 (xem chú thích của `KHOA_QLCS`). Bản cũ dùng `KHOA`, mà từ
      // bản vá 25/09 khoá ấy là khoá của QUẢN TRỊ — QLCS không gỡ được, đúng chính sách chủ
      // dự án ký 22/09. Mục đích của ca KHÔNG đổi; chỉ đổi khoá cho khớp chính sách đang
      // chạy, kẻo "đối chứng dương" lại khẳng định một quyền mà hệ thống cố ý không cấp.
      await datHienTruongQlcs({ cs1: QLCS_RIENG });

      const qlcs = await resolveActorUncached(W.qlcs1Id);
      const r = await clearCenterSetting(qlcs, {
        orgUnitId: W.cs1,
        key: KHOA_QLCS,
        reason: "quản lý cơ sở tự trả về toàn hệ",
        actorName: "ci",
      });
      expect(r.ok).toBe(true);
      expect(await demDongQlcs(W.cs1)).toBe(0);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-09b] quản lý CS1 KHÔNG gỡ được khoá của QUẢN TRỊ, kể cả ở CHÍNH cơ sở mình",
    async () => {
      // 🔴 LUẬT MỚI 25/09/2026, và đây là chỗ nó sống ở tầng DB.
      //
      // `[QCS-*]` kiểm hàm thuần `duocSuaKhoaCuaCoSo`; ca này kiểm ĐƯỜNG THẬT — vì phép
      // kiểm nằm trong `clearCenterSetting`, và gỡ hàm ấy khỏi đường gỡ thì không ca thuần
      // nào đỏ (đúng bẫy "vá một hàm quên hàm kia" mà `[QCS-03]` sinh ra để canh).
      //
      // ⚠️ Ca này khẳng định SỰ TỪ CHỐI ⇒ nó ĐẠT cả khi `clearCenterSetting` hỏng hoàn
      // toàn. Đối chứng dương của nó là `[CRC-09]` ngay trên: cùng người, cùng cơ sở, cùng
      // lời gọi — chỉ khác KHOÁ. Đừng gỡ một trong hai.
      await datHienTruong({ toanHe: false, rieng: { cs1: true } });

      const qlcs = await resolveActorUncached(W.qlcs1Id);
      const r = await clearCenterSetting(qlcs, {
        orgUnitId: W.cs1,
        key: KHOA,
        reason: "thử gỡ công tắc module",
        actorName: "ci",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
      // Và dòng vẫn còn — từ chối mà vẫn xoá là kiểu hỏng tệ nhất.
      expect(await demDong(W.cs1)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-10] gỡ khi KHÔNG có dòng ⇒ coi là XONG, và KHÔNG bịa một dòng nhật ký",
    async () => {
      // Hai người cùng bấm "Trả về theo toàn hệ" thì người sau không được nhận một câu lỗi
      // cho một trạng thái đã đúng ý họ. Nhưng cũng không được ghi một dòng DELETE cho một
      // việc không xảy ra — nhật ký kiểm toán mà có dòng khống thì tra cứu về sau thành đoán.
      await datHienTruong({ toanHe: false });
      await db.auditLog.deleteMany({
        where: { entityType: "CenterSetting", entityId: `${W.cs1}:${KHOA}` },
      });

      const actor = await resolveActorUncached(W.quanTriId);
      const r = await clearCenterSetting(actor, {
        orgUnitId: W.cs1,
        key: KHOA,
        reason: "bấm lần hai",
        actorName: "ci",
      });
      expect(r.ok).toBe(true);

      const sau = await db.auditLog.count({
        where: { entityType: "CenterSetting", entityId: `${W.cs1}:${KHOA}` },
      });
      expect(sau).toBe(0);
    },
    CASE_TIMEOUT,
  );

  // ── PHIÊN I · PHẠM VI CƠ SỞ (24/09/2026) ───────────────────────────────────────────
  //
  // ⚠️ ĐẶT TRONG CÙNG `describe` CHỨ KHÔNG TÁCH KHỐI MỚI, và đó không phải để gọn: khối
  // riêng sẽ mượn `W` do `beforeAll` của khối này nạp, tức mỗi ca chỉ xanh khi chạy SAU
  // khối trên. Đúng lớp lỗi luật 18 — "chạy 1 ca ĐỎ, cả bộ XANH".
  //
  // Lỗ ba ca dưới canh: trước 24/09 `docCaiRiengTheoCoSo` trả MỌI cơ sở, vì chỉ Quản trị
  // tối cao mở được màn và họ quản lý mọi cơ sở nên không ai thấy. Từ lúc Quản lý cơ sở
  // vào được, bày đủ danh sách là hiện ô của CS khác dưới dạng MỞ, rồi lần bấm Lưu nhận
  // "Không có quyền sửa cấu hình cơ sở này" — lời hứa suông, luật 12.
  //
  // Ở tầng DB chứ không test thuần: phép lọc nằm trong `where` của câu Prisma, và một
  // `where` sai vẫn trả về mảng hợp lệ. Chỉ Postgres thật nói được "đúng cơ sở nào đi ra".

  it(
    "[CRC-11] phạm vi HẸP chỉ trả đúng cơ sở trong phạm vi",
    async () => {
      await datHienTruong({ toanHe: true, rieng: { cs1: false, cs2: true } });

      const map = await docCaiRiengTheoCoSo([KHOA], [W.cs1]);
      const hang = map[KHOA] ?? [];
      expect(hang.map((c) => c.orgUnitId)).toEqual([W.cs1]);
      // Giá trị riêng của cơ sở TRONG phạm vi vẫn phải đọc đúng — lọc không được làm mất dữ liệu.
      expect(hang[0]?.giaTriRieng).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[CRC-12] phạm vi RỖNG trả RỖNG — fail-closed, không rơi về 'không lọc'",
    async () => {
      // Đây là nhánh nguy hiểm nhất: `[]` và "không truyền gì" trông giống nhau ở chỗ gọi,
      // nhưng một cái phải là "không cơ sở nào" còn cái kia trước đây là "mọi cơ sở".
      const map = await docCaiRiengTheoCoSo([KHOA], []);
      expect(map).toEqual({});
    },
    CASE_TIMEOUT,
  );

  it(
    '[CRC-13] "TAT_CA" vẫn trả đủ — đối chứng, không thì một bản vá "lọc hết cho chắc" vẫn xanh',
    async () => {
      await datHienTruong({ toanHe: true, rieng: { cs1: false, cs2: true } });
      const hang = (await docCaiRiengTheoCoSo([KHOA], "TAT_CA"))[KHOA] ?? [];
      expect(hang.map((c) => c.orgUnitId)).toEqual(expect.arrayContaining([W.cs1, W.cs2]));
    },
    CASE_TIMEOUT,
  );
});
