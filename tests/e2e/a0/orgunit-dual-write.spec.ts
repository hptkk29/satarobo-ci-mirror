/**
 * Nền Hệ thống P1 · US-07 — ghi kép `centerId` → `orgUnitId` (AC2) + đối soát (AC3, TS-07).
 * Chạy trên Postgres LOCAL (job `e2e-a0`).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg } from "../_helpers/seed";
import { __resetCenterBridgeCache } from "../../../lib/org/dual-write";
import {
  ALL_DRIFT_SPECS,
  discoverDualColumnTables,
  findUnclassifiedTables,
  isDrift,
  runDriftReport,
} from "../../../lib/org/drift-report";
import { BACKFILL_SPECS, DUAL_WRITE_MODELS } from "../../../lib/org/center-bridge";

async function seedNen() {
  await db.center.create({ data: { id: "c-cs1", code: "CS1", name: "CS1", slug: "cs1-dw", address: "211", city: "" } });
  await db.center.create({ data: { id: "c-cs2", code: "CS2", name: "CS2", slug: "cs2-dw", address: "114", city: "" } });
  // Center "Hội sở" — MỒ CÔI có chủ đích: không OrgUnit nào trỏ tới (luật V7 cấm HO mang
  // centerId). Cầu ánh xạ phải bắc được qua `code` chứ không qua `OrgUnit.centerId`.
  await db.center.create({ data: { id: "c-ho", code: "HO", name: "Hội sở", slug: "ho-dw", address: "114", city: "" } });
  await seedOrg(["HO", "CS1", "CS2"]);
  __resetCenterBridgeCache();
}

const orgIdOf = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;

/** Một ghi danh hợp lệ ở CS1 — Enrollment thuộc nhóm BAT_BUOC nên dùng được cho đối soát. */
async function seedGhiDanh() {
  await seedNen();
  const course = await db.course.create({ data: { name: "K-gd", slug: "k-gd-dw" } });
  const cls = await db.class.create({ data: { name: "Lớp GD", courseId: course.id, centerId: "c-cs1" } });
  const st = await db.student.create({ data: { name: "HV GD", centerId: "c-cs1" } });
  const enr = await db.enrollment.create({
    data: { studentId: st.id, classId: cls.id, courseId: course.id, status: "STUDYING", centerId: "c-cs1" },
  });
  return { enrollmentId: enr.id, classId: cls.id, studentId: st.id };
}

test.describe("[US-07][AC2] ghi kép centerId → orgUnitId", () => {
  test.beforeEach(async () => {
    await resetDb();
    __resetCenterBridgeCache();
  });

  test("[US-07-IT-01] create có centerId → tự điền orgUnitId", async () => {
    await seedNen();
    const course = await db.course.create({ data: { name: "K", slug: "k-dw" } });
    const cls = await db.class.create({
      data: { name: "Lớp DW", courseId: course.id, centerId: "c-cs1" },
    });
    expect(cls.orgUnitId).toBe(await orgIdOf("CS1"));
  });

  test("[US-07-IT-02] CẦU MỒ CÔI: centerId='c-ho' vẫn ra OrgUnit(HO) nhờ khớp theo code", async () => {
    // Đây là lỗ mà US-05 đã thử vá sai (cho HO mang centerId ⇒ rò quyền qua màn nhân sự).
    // Cầu theo `code` giải đúng bài toán ánh xạ mà KHÔNG nạp thêm nghĩa cho cột centerId.
    await seedNen();
    const u = await db.user.create({
      data: { email: "ho-dw@x.vn", name: "NV Hội sở", role: "HR", centerId: "c-ho" },
    });
    expect(u.orgUnitId).toBe(await orgIdOf("HO"));
    // …và OrgUnit(HO) VẪN không mang centerId — không có đường rò quyền nào mở ra.
    expect((await db.orgUnit.findUnique({ where: { code: "HO" } }))?.centerId).toBeNull();
  });

  test("[US-07-IT-03] người gọi tự set orgUnitId → KHÔNG bị đè", async () => {
    await seedNen();
    const cs2 = await orgIdOf("CS2");
    const course = await db.course.create({ data: { name: "K2", slug: "k2-dw" } });
    const cls = await db.class.create({
      data: { name: "Lớp chỉ định", courseId: course.id, centerId: "c-cs1", orgUnitId: cs2 },
    });
    expect(cls.orgUnitId).toBe(cs2); // tôn trọng ý người gọi, không có nguồn ghi thứ hai
  });

  test("[US-07-IT-04] centerId = null tường minh → KHÔNG đoán", async () => {
    // Ở nhiều bảng null nghĩa là "áp dụng toàn hệ thống"; điền vào là hỏng nghĩa.
    await seedNen();
    const r = await db.revenueTarget.create({
      data: { period: "2026-08", targetAmount: 1000, centerId: null },
    });
    expect(r.orgUnitId).toBeNull();
  });

  test("[US-07-IT-05] createMany điền cho từng phần tử", async () => {
    await seedNen();
    const course = await db.course.create({ data: { name: "K3", slug: "k3-dw" } });
    await db.class.createMany({
      data: [
        { name: "L1", courseId: course.id, centerId: "c-cs1" },
        { name: "L2", courseId: course.id, centerId: "c-cs2" },
      ],
    });
    const rows = await db.class.findMany({ orderBy: { name: "asc" }, select: { name: true, orgUnitId: true } });
    expect(rows.map((r) => r.orgUnitId)).toEqual([await orgIdOf("CS1"), await orgIdOf("CS2")]);
  });

  test("[US-07-IT-06] update đổi cơ sở → orgUnitId theo cùng", async () => {
    await seedNen();
    const course = await db.course.create({ data: { name: "K4", slug: "k4-dw" } });
    const cls = await db.class.create({ data: { name: "L", courseId: course.id, centerId: "c-cs1" } });
    const sau = await db.class.update({ where: { id: cls.id }, data: { centerId: "c-cs2" } });
    expect(sau.orgUnitId).toBe(await orgIdOf("CS2"));
  });

  test("[US-07-IT-07] Center KHÔNG có OrgUnit tương ứng → để null, KHÔNG ném lỗi", async () => {
    // Ném lỗi ở tầng này là biến một cột phụ thành thứ chặn cả nghiệp vụ.
    await seedNen();
    await db.center.create({ data: { id: "c-la", code: "CSLA", name: "Cơ sở lạ", slug: "csla", address: "X", city: "" } });
    __resetCenterBridgeCache();
    const course = await db.course.create({ data: { name: "K5", slug: "k5-dw" } });
    const cls = await db.class.create({ data: { name: "L lạ", courseId: course.id, centerId: "c-la" } });
    expect(cls.orgUnitId).toBeNull();
  });

  test("[US-07-IT-08] mọi bảng khai trong BACKFILL_SPECS đều có mặt trong DUAL_WRITE_MODELS", async () => {
    for (const s of BACKFILL_SPECS) expect(DUAL_WRITE_MODELS.has(s.model)).toBe(true);
  });
});

test.describe("[US-07][AC3][TS-07] đối soát centerId ↔ orgUnitId", () => {
  test.beforeEach(async () => {
    await resetDb();
    __resetCenterBridgeCache();
  });

  test("[US-07-IT-08b] KHÔNG bảng nào có đủ 2 cột mà lọt khỏi bảng phân loại", async () => {
    // Test "độ tươi" kiểu inline-authz: thêm cột orgUnitId cho một bảng mới mà quên khai
    // vào center-bridge.ts thì đối soát đêm lặng lẽ bỏ qua bảng đó. Đỏ ở đây là lời nhắc
    // phải QUYẾT nghĩa của NULL, không phải phiền toái.
    expect(await findUnclassifiedTables()).toEqual([]);
  });

  test("[US-07-IT-08c] bảng phân loại KHÔNG thừa tên — mọi model khai đều có thật trong DB", async () => {
    // Chiều ngược lại: bản danh sách chép tay đầu tiên sai 11 tên, và script đối soát ném
    // lỗi SQL thô thay vì báo lệch. Nếu lỗi đó nổ lần đầu lúc 3h sáng trên prod thì nó chỉ
    // hiện ra là "cron đỏ".
    const thatSu = new Set(await discoverDualColumnTables());
    const thua = ALL_DRIFT_SPECS.map((s) => s.model).filter((m) => !thatSu.has(m));
    expect(thua).toEqual([]);
  });

  test("[US-07-IT-09] mọi bảng đối soát đều TỒN TẠI và có đủ 2 cột", async () => {
    // Bảng phân loại là dữ liệu viết tay — nếu ai đó gõ sai tên model hoặc schema đổi,
    // script đối soát sẽ ném SQL error lúc 3h sáng thay vì báo lệch. Bắt ở đây.
    for (const s of ALL_DRIFT_SPECS) {
      const r = await db.$queryRawUnsafe<Array<{ c: number }>>(
        `SELECT count(*)::int AS c FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name IN ('centerId','orgUnitId')`,
        s.model,
      );
      expect({ model: s.model, cols: Number(r[0]?.c ?? 0) }).toEqual({ model: s.model, cols: 2 });
    }
  });

  test("[US-07-IT-10][TS-07] chèn ĐÚNG 1 dòng lệch → báo ĐÚNG 1 bảng", async () => {
    // Dùng Enrollment (nhóm BAT_BUOC) chứ KHÔNG dùng Class: Class thuộc 28 bảng PR-A còn
    // nhãn CHUA_RA_SOAT nên "thiếu orgUnitId" ở đó cố ý KHÔNG tính là lệch.
    const { enrollmentId } = await seedGhiDanh();

    const sach = await runDriftReport();
    expect(sach.drift.map((d) => d.model)).toEqual([]);

    // Chèn lệch bằng SQL THÔ — đúng đường mà ghi kép KHÔNG bịt được ($executeRaw /
    // migration / script không đi qua Prisma extension). Đây chính là lý do đối soát đêm
    // phải tồn tại chứ không chỉ dựa vào ghi kép.
    await db.$executeRawUnsafe(`UPDATE "Enrollment" SET "orgUnitId" = NULL WHERE "id" = $1`, enrollmentId);

    const lech = await runDriftReport();
    expect(lech.drift.map((d) => d.model)).toEqual(["Enrollment"]);
    const row = lech.drift[0]!;
    expect(row.missingOrgUnit).toBe(1);
    expect(row.mismatched).toBe(0);
    // MẪU SỐ đi kèm — không có nó thì "0 lệch" trên bảng rỗng là xanh giả.
    expect(row.totalRows).toBe(1);
  });

  test("[US-07-IT-11] SAI ánh xạ (orgUnitId trỏ nhầm cơ sở) bị bắt kể cả ở bảng CHƯA RÀ SOÁT", async () => {
    // "Sai ánh xạ" là mâu thuẫn nội tại của một dòng — không có cách đọc nào cho nó là
    // đúng, nên nó báo động ở MỌI nhóm, khác với "thiếu orgUnitId".
    await seedNen();
    // Bảng mẫu phải là một bảng CÒN trong PR_A_MODELS. Trước đây test dùng `Class`,
    // nhưng 12/08 `Class` được rà xong và chuyển sang BACKFILL_SPECS ⇒ test đỏ vì
    // TIẾN BỘ chứ không phải hồi quy. `Holiday` vẫn chưa rà (còn dòng centerId=NULL,
    // chưa ai chốt "nghỉ lễ không gắn cơ sở" nghĩa là toàn hệ thống hay chưa khớp).
    const hol = await db.holiday.create({
      data: { name: "Nghỉ sai ánh xạ", date: new Date("2026-09-02"), centerId: "c-cs1" },
    });
    const cs2 = await orgIdOf("CS2");
    await db.$executeRawUnsafe(`UPDATE "Holiday" SET "orgUnitId" = $1 WHERE "id" = $2`, cs2, hol.id);

    const rep = await runDriftReport();
    const row = rep.drift.find((d) => d.model === "Holiday");
    expect(row?.mismatched).toBe(1);
    expect(row?.missingOrgUnit).toBe(0);
    expect(row?.nullMeaning).toBe("CHUA_RA_SOAT");
  });

  test("[US-07-IT-12] dòng centerId=null KHÔNG bị coi là lệch", async () => {
    await seedNen();
    await db.revenueTarget.create({ data: { period: "2026-09", targetAmount: 5, centerId: null } });
    const rep = await runDriftReport();
    expect(rep.drift.map((d) => d.model)).not.toContain("RevenueTarget");
  });

  test("[US-07-IT-13] nhật ký ghi được + dọn theo hạn 30 ngày", async () => {
    await seedNen();
    const { saveDriftRun, pruneDriftLog } = await import("../../../lib/org/drift-report");
    const rep = await runDriftReport();
    const id = await saveDriftRun(rep, "test");
    expect(await db.orgUnitDriftRun.count()).toBe(1);

    // Đẩy lượt chạy về quá khứ 40 ngày rồi dọn.
    await db.orgUnitDriftRun.update({
      where: { id },
      data: { ranAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
    });
    expect(await pruneDriftLog(30)).toBe(1);
    expect(await db.orgUnitDriftRun.count()).toBe(0);
  });

  test("[US-07-IT-14] isDrift: bảng RỖNG là 'không lệch' nhưng KHÔNG phải bằng chứng", async () => {
    // Ghim ngữ nghĩa: report phải tự nói inconclusive khi mẫu số = 0, chứ không im lặng
    // báo sạch — prod đã dọn sạch dữ liệu 01/08 nên đây là ca xảy ra thật.
    expect(
      isDrift({
        model: "X", nullMeaning: "BAT_BUOC", scoped: false,
        totalRows: 0, withCenter: 0, withOrgUnit: 0, missingOrgUnit: 0, mismatched: 0,
      }),
    ).toBe(false);
    const rep = await runDriftReport();
    expect(rep.totalRows).toBe(0);
  });
});
