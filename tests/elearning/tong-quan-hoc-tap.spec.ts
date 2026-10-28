// @vitest-environment node
/**
 * Giao diện mới (Tổng quan học tập · Tổng quan Đào tạo) — dữ liệu đọc đúng người, đúng cơ sở (Postgres thật).
 *
 * Hai thứ cần chứng minh bằng DB thật, mà test thuần không nói được gì:
 *   1. Trang chủ người học chỉ đọc lượt học CỦA CHÍNH MÌNH — hai nhân viên CÙNG cơ sở không thấy khoá của nhau
 *      (`scopedDb` chặn chéo cơ sở nhưng KHÔNG chặn đồng nghiệp cùng cơ sở; chốt nằm ở `userId` trong `where`).
 *   2. Số đếm của Tổng quan Đào tạo đi qua `scopedDb`: dù cờ quyền truyền vào là `true`, tác nhân cấp cơ sở vẫn CHỈ đếm
 *      cơ sở của mình (cách ly nằm ở tầng dữ liệu, không phụ thuộc việc trang có tính cờ đúng hay không).
 * Mỗi ca âm tính có ĐỐI CHỨNG DƯƠNG cùng fixture (luật 11).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_ELTQ_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import { napTongQuanHocTap } from "../../lib/elearning/dashboard-view";
import { napTongQuanDaoTao } from "../../lib/elearning/dao-tao-overview";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_ELTQ_";
const NOW = new Date("2026-10-25T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let F: { cs1CenterId: string; hv1: string; hv1b: string; hv2: string; qlCs1: string; traHo: string; baiOpenId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { assignment: { title: { startsWith: P } } }] } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnLesson.deleteMany({ where: { module: { course: { code: { startsWith: P } } } } });
  await db.trnModule.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId } });
}

describe.skipIf(!RUN)("Tổng quan học tập / Tổng quan Đào tạo · dữ liệu đúng người, đúng cơ sở (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    process.env.ELEARNING_ENABLED = "true";
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(
      ["HO", "CS1", "CS2"].map((code) =>
        db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true, centerId: true } }),
      ),
    );
    const hv1 = await seedUser({ email: `${P}hv1@ci.test`, name: `${P}HV1`, role: "TEACHER" });
    const hv1b = await seedUser({ email: `${P}hv1b@ci.test`, name: `${P}HV1B`, role: "TEACHER" }); // CÙNG cơ sở với hv1
    const hv2 = await seedUser({ email: `${P}hv2@ci.test`, name: `${P}HV2`, role: "TEACHER" });
    const qlCs1 = await seedUser({ email: `${P}ql1@ci.test`, name: `${P}QL1`, role: "CENTER_MANAGER" });
    const traHo = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    // Mọi nhân viên có vai neo ở cơ sở của mình (đúng dữ liệu thật) — thiếu vai thì `scopedDb` fail-closed và đọc ra rỗng.
    await gan(hv1.id, cs1.id, "TEACHER");
    await gan(hv1b.id, cs1.id, "TEACHER");
    await gan(hv2.id, cs2.id, "TEACHER");
    await gan(qlCs1.id, cs1.id, "CENTER_MANAGER");
    await gan(traHo.id, ho.id, "TRAINING");

    const khoa = await db.trnCourse.create({
      data: {
        code: `${P}KHOA`,
        slug: `${P.toLowerCase()}khoa`,
        title: `${P}Khoá`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const mod = await db.trnModule.create({
      data: { courseId: khoa.id, title: `${P}Chương`, orderIndex: 1 },
      select: { id: true },
    });
    const bai = await db.trnLesson.create({
      data: { moduleId: mod.id, title: `${P}Bài đọc`, kind: "READ", orderIndex: 1, contentMd: "x", minReadSeconds: 5 },
      select: { id: true },
    });

    const giao = (cs: { id: string; centerId: string | null }, ten: string) =>
      db.trnAssignment.create({
        data: {
          title: `${P}${ten}`,
          contentType: "COURSE",
          contentId: khoa.id,
          audienceMode: "STATIC",
          status: "ACTIVE",
          allowLate: true,
          completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" },
          centerId: cs.centerId as string,
          orgUnitId: cs.id,
          createdByUserId: traHo.id,
        },
        select: { id: true },
      });
    const aCs1 = await giao(cs1, "CS1");
    const aCs2 = await giao(cs2, "CS2");

    let cycle = 0;
    const ghiDanh = (
      userId: string,
      assignmentId: string,
      cs: { id: string; centerId: string | null },
      status: "NOT_STARTED" | "IN_PROGRESS" | "OVERDUE",
      dueAt: Date,
    ) =>
      db.trnEnrollment.create({
        data: {
          courseId: khoa.id,
          userId,
          assignmentId,
          cycle: ++cycle,
          status,
          dueAt,
          dueAtOriginal: dueAt,
          centerId: cs.centerId as string,
          orgUnitId: cs.id,
          source: "ASSIGNMENT",
          snapJobTitle: "Nhân viên",
          progressPercent: status === "IN_PROGRESS" ? 30 : 0,
        },
        select: { id: true },
      });
    const e1 = await ghiDanh(hv1.id, aCs1.id, cs1, "IN_PROGRESS", ngay(3));
    await ghiDanh(hv1b.id, aCs1.id, cs1, "OVERDUE", ngay(-4));
    // Hai lượt quá hạn ở CS1 ≠ một lượt đang học: số đếm của từng trạng thái phải KHÁC nhau, nếu không phép đổi trạng thái
    // trong truy vấn đếm không làm ca nào đỏ (đã cấy thử).
    await ghiDanh(hv1b.id, aCs1.id, cs1, "OVERDUE", ngay(-7));
    await ghiDanh(hv2.id, aCs2.id, cs2, "OVERDUE", ngay(-6));
    await ghiDanh(hv2.id, aCs2.id, cs2, "OVERDUE", ngay(-9));
    // hv1 đã chạm bài: "Tiếp tục học" phải trỏ thẳng vào bài này.
    await db.trnLessonProgress.create({
      data: { enrollmentId: e1.id, userId: hv1.id, lessonId: bai.id, status: "IN_PROGRESS" },
    });

    F = { cs1CenterId: cs1.centerId as string, hv1: hv1.id, hv1b: hv1b.id, hv2: hv2.id, qlCs1: qlCs1.id, traHo: traHo.id, baiOpenId: bai.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it(
    "[trang chủ người học] hv1 chỉ thấy lượt của CHÍNH MÌNH — không thấy đồng nghiệp cùng cơ sở (hv1b) lẫn cơ sở khác (hv2)",
    async () => {
      const a = await resolveActorUncached(F.hv1);
      const tq = await napTongQuanHocTap(scopedDb(a), F.hv1, NOW);
      expect(tq.khoa).toHaveLength(1);
      expect(tq.kpi).toMatchObject({ tong: 1, dangHoc: 1, quaHan: 0, sapHan: 1 });
      // ĐỐI CHỨNG DƯƠNG: cùng fixture, hv1b có hai lượt QUÁ HẠN của riêng họ.
      const b = await resolveActorUncached(F.hv1b);
      const tqb = await napTongQuanHocTap(scopedDb(b), F.hv1b, NOW);
      expect(tqb.kpi).toMatchObject({ tong: 2, quaHan: 2 });
      // Và hv2 có hai lượt quá hạn ở cơ sở khác — mỗi người đọc ra số của riêng mình từ MỘT bảng.
      const c = await resolveActorUncached(F.hv2);
      expect((await napTongQuanHocTap(scopedDb(c), F.hv2, NOW)).kpi).toMatchObject({ tong: 2, quaHan: 2 });
    },
    CASE_TIMEOUT,
  );

  it(
    "[tiếp tục học] bài đang dở của khoá được chọn trỏ thẳng vào bài (bài đọc có màn người học)",
    async () => {
      const a = await resolveActorUncached(F.hv1);
      const tq = await napTongQuanHocTap(scopedDb(a), F.hv1, NOW);
      expect(tq.tiepTuc?.bai).toMatchObject({ lessonId: F.baiOpenId, kind: "READ", moDuoc: true });
      expect(tq.tiepTuc?.href).toBe(`/elearning/hoc/${tq.tiepTuc?.khoa.enrollmentId}/${F.baiOpenId}`);
    },
    CASE_TIMEOUT,
  );

  it(
    "[tổng quan Đào tạo] QLCS CS1 dù cờ `baoCao`=true vẫn CHỈ đếm lượt quá hạn của CS1 (cách ly ở tầng dữ liệu)",
    async () => {
      const a = await resolveActorUncached(F.qlCs1);
      const tq = await napTongQuanDaoTao(scopedDb(a), { cham: false, giao: true, soan: false, baoCao: true }, NOW);
      // DB dùng chung có thể đã có dữ liệu khác, nên so với ĐẾM TRỰC TIẾP theo cơ sở CS1 chứ không với con số cứng.
      const cs1 = { centerId: F.cs1CenterId };
      expect(tq.tienDo?.luotQuaHan).toBe(await db.trnEnrollment.count({ where: { status: "OVERDUE", ...cs1 } }));
      expect(tq.tienDo?.luotDangHoc).toBe(await db.trnEnrollment.count({ where: { status: "IN_PROGRESS", ...cs1 } }));
      expect(tq.giao?.luotGiaoDangMo).toBe(await db.trnAssignment.count({ where: { status: "ACTIVE", ...cs1 } }));
      // Và hai lượt quá hạn CS2 của hv2 KHÔNG nằm trong số này: toàn hệ lớn hơn phần CS1 ít nhất 2.
      const toanHe = await db.trnEnrollment.count({ where: { status: "OVERDUE" } });
      expect(toanHe - (tq.tienDo?.luotQuaHan ?? 0)).toBeGreaterThanOrEqual(2);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ĐỐI CHỨNG DƯƠNG] Hội sở (TRAINING) đếm cả hai cơ sở",
    async () => {
      const a = await resolveActorUncached(F.traHo);
      const tq = await napTongQuanDaoTao(scopedDb(a), { cham: false, giao: true, soan: false, baoCao: true }, NOW);
      expect(tq.tienDo?.luotQuaHan).toBe(await db.trnEnrollment.count({ where: { status: "OVERDUE" } }));
      expect(tq.tienDo?.luotQuaHan).toBeGreaterThanOrEqual(4); // hai lượt hv1b (CS1) + hai lượt hv2 (CS2)
      expect(tq.giao?.luotGiaoDangMo).toBe(await db.trnAssignment.count({ where: { status: "ACTIVE" } }));
    },
    CASE_TIMEOUT,
  );

  it(
    "[cờ quyền] không cờ nào ⇒ không khối nào — kể cả với tác nhân Hội sở đầy quyền dữ liệu",
    async () => {
      const a = await resolveActorUncached(F.traHo);
      expect(await napTongQuanDaoTao(scopedDb(a), { cham: false, giao: false, soan: false, baoCao: false }, NOW)).toEqual({});
    },
    CASE_TIMEOUT,
  );
});
