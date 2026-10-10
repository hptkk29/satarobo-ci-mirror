// tests/cham-cong/generate.spec.ts — sinh lưới tháng, tầng DB THẬT.
//
// 🔴 Vì sao file này tồn tại: trước 13/09/2026 `generateMonthAssignments` có **0 ca test**.
// Tầng thuần (`lib/cham-cong/generate.test.ts`) kiểm được phép QUYẾT ĐỊNH, nhưng không kiểm
// được thứ quan trọng nhất ở đây: *có câu lệnh ghi nào chạy vào ngày đã qua không*. Chỉ tầng
// DB trả lời được, vì chỉ ở đó mới có dòng thật để so trước/sau.
//
// Postgres LOCAL (satarobo_test); tự SKIP nếu không có.
import { PrismaClient } from "@prisma/client";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import { loadCenterMap } from "../../lib/cham-cong/home-center";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal =
  laDbCucBo(DB_URL) && laTenDbTest(DB_URL) /* từ chối cả tunnel VPS (CONG_TUNNEL_VPS) */;
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn("[cham-cong/generate] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test");

const TAG = "cc-generate";
/** Tháng test — CỐ ĐỊNH (luật 19). Mọi mốc dưới đây nằm trong tháng này. */
const KY = "2026-09";
const ngay = (d: number) => new Date(Date.UTC(2026, 8, d));
/** "Hôm nay" giả: 15/09/2026. Trước nó = quá khứ, sau nó = tương lai. */
const HOM_NAY = ngay(15);

d("generateMonthAssignments — DB thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let generate: typeof import("../../lib/cham-cong/generate-db");
  let cs1 = "";
  let userId = "";
  let actorId = "";
  let centerMap: Awaited<ReturnType<typeof loadCenterMap>>;

  const donDep = async () => {
    const us = await db.user.findMany({
      where: { email: { endsWith: `@${TAG}.test` } },
      select: { id: true },
    });
    const ids = us.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftWeeklyPattern.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  };

  beforeAll(async () => {
    generate = await import("../../lib/cham-cong/generate-db");
    await seedShiftTemplates(db);
    await donDep();
    cs1 = (
      await db.center.upsert({
        where: { slug: `${TAG}-cs1` },
        update: {},
        create: { slug: `${TAG}-cs1`, name: "CS1 generate", address: "x", code: "GEN1" },
        select: { id: true },
      })
    ).id;
    const u = await db.user.create({
      data: { email: `nv@${TAG}.test`, name: "NV generate", role: "HR", roles: ["HR"], password: "x", centerId: cs1 },
      select: { id: true },
    });
    userId = u.id;
    actorId = userId;
    centerMap = await loadCenterMap();

    // Khung ca tuần: MỌI thứ đều là "S" — nên mọi ngày trong tháng đều có mã sắp xếp.
    const tplS = await db.shiftTemplate.findFirstOrThrow({
      where: { code: "S", centerId: null },
      select: { id: true },
    });
    for (let wd = 0; wd < 7; wd += 1) {
      await db.shiftWeeklyPattern.create({
        data: {
          userId, centerId: cs1, weekday: wd,
          templateId: tplS.id, templateCode: "S",
          sheetName: "NV generate", effectiveFrom: new Date(Date.UTC(2000, 0, 1)),
        },
      });
    }
  });

  // 🔴 LUẬT 18 — mỗi ca phải XANH khi chạy MỘT MÌNH.
  // Bản đầu của file này chain trạng thái: ca 2/3/4 dựa vào lượt `chay()` của ca 1. Chạy
  // riêng ca 3 là đỏ. Nay mỗi ca tự dọn ô ca rồi tự gọi `chay()`; NGƯỜI và KHUNG CA TUẦN
  // giữ nguyên vì chúng là bối cảnh CHỈ ĐỌC, không phải thứ ca nào sửa.
  beforeEach(async () => {
    await db.staffTimeLog.deleteMany({ where: { userId } });
    await db.shiftAssignment.deleteMany({ where: { userId } });
    // `DomainEvent` cũng phải dọn: ca "xem trước không xếp hàng tính lại" đếm bảng này, và
    // 15 sự kiện do ca TRƯỚC để lại trông y hệt một lượt rò. (Đo thật: ca ấy đỏ với
    // "expected 15 to be +0" trước khi thêm dòng dưới — luật 18, ngay trong file của chính mình.)
    await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: userId } } });
  });

  afterAll(async () => {
    await donDep();
    await db.$disconnect();
  });

  /** Ô ca có sẵn, mã KHÁC hẳn khung ("CG" vs "S") ⇒ không chặn thì chắc chắn bị REPLACE. */
  async function dungOCu(d: number) {
    const tplCG = await db.shiftTemplate.findFirstOrThrow({
      where: { code: "CG", centerId: null },
      select: { id: true },
    });
    return db.shiftAssignment.create({
      data: {
        userId, centerId: cs1, workDate: ngay(d),
        templateId: tplCG.id, templateCode: "CG",
        segments: [{ start: "09:00", end: "11:30", kind: "WORK", orgUnitIds: [] }],
        placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source: "PATTERN",
      },
    });
  }

  const goi = (ghiThat: boolean) =>
    generate.generateMonthAssignments({
      db: db as unknown as Parameters<typeof generate.generateMonthAssignments>[0]["db"],
      periodKey: KY,
      centerMap,
      canWriteCenter: () => true,
      actorUserId: actorId,
      onlyUserIds: [userId],
      homNay: HOM_NAY,
      ghiThat,
    });

  const chay = () => goi(true);
  const xemTruoc = () => goi(false);

  // ── vế CHẶN: ngày hôm qua và HÔM NAY không đổi MỘT FIELD NÀO ────────────────────────
  it("ngày HÔM QUA (14/9) và HÔM NAY (15/9): không một field nào đổi, không dòng nào thêm", async () => {
    await dungOCu(14);
    await dungOCu(15);
    // Lượt quét thật của ngày hôm qua — thứ khiến việc ghi đè trở thành mất dữ liệu.
    await db.staffTimeLog.create({
      data: {
        userId, centerId: cs1, direction: "CHECK_IN",
        loggedAt: new Date("2026-09-14T02:00:00Z"), workDate: ngay(14),
        source: "TICKET", result: "ACCEPTED",
      },
    });

    const truoc = await db.shiftAssignment.findMany({
      where: { userId, workDate: { in: [ngay(14), ngay(15)] } },
      orderBy: { workDate: "asc" },
    });
    expect(truoc).toHaveLength(2);

    const r = await chay();
    expect(r.skippedPast, "phải đếm số ngày bị chừa").toBeGreaterThan(0);

    const sau = await db.shiftAssignment.findMany({
      where: { userId, workDate: { in: [ngay(14), ngay(15)] } },
      orderBy: { workDate: "asc" },
    });
    // So NGUYÊN DÒNG: id, status, templateCode, segments, updatedAt… tất cả.
    expect(sau, "không một field nào của ngày ≤ hôm nay được đổi").toEqual(truoc);
    // Và KHÔNG đẻ dòng CANCELLED nào cho hai ngày đó.
    expect(
      await db.shiftAssignment.count({
        where: { userId, workDate: { in: [ngay(14), ngay(15)] }, status: "CANCELLED" },
      }),
    ).toBe(0);
  });

  it("ngày quá khứ CHƯA có ô ⇒ không đẻ ca mới cho ngày đã trôi qua", async () => {
    await chay(); // ARRANGE của chính ca này — bảng ô ca đang RỖNG
    expect(
      await db.shiftAssignment.count({ where: { userId, workDate: { lte: HOM_NAY } } }),
      "ngày 1..15 không được có ô nào",
    ).toBe(0);
  });

  // ── vế CHO QUA (luật 16) ───────────────────────────────────────────────────────────
  it("NGÀY MAI trở đi VẪN được sinh đúng", async () => {
    await chay();
    const mai = await db.shiftAssignment.findFirst({
      where: { userId, workDate: ngay(16), status: "ACTIVE" },
      select: { templateCode: true, source: true },
    });
    expect(mai, "ngày mai phải có ca").not.toBeNull();
    expect(mai).toMatchObject({ templateCode: "S", source: "PATTERN" });

    const cuoiThang = await db.shiftAssignment.count({
      where: { userId, workDate: { gt: HOM_NAY }, status: "ACTIVE" },
    });
    expect(cuoiThang, "16..30/9 = 15 ngày").toBe(15);
  });

  it("ô PROTECTED ở ngày TƯƠNG LAI vẫn được giữ — bản vá không nuốt luật cũ", async () => {
    const tplP = await db.shiftTemplate.findFirstOrThrow({
      where: { code: "P", centerId: null },
      select: { id: true },
    });
    const donNghi = await db.shiftAssignment.create({
      data: {
        userId, centerId: cs1, workDate: ngay(20),
        templateId: tplP.id, templateCode: "P",
        segments: [], placeMode: "ANYWHERE", attendanceMode: "NONE",
        dayCredit: 0, isLeave: true, source: "LEAVE",
      },
    });

    const r = await chay();
    expect(r.skippedProtected).toBeGreaterThan(0);

    const sau = await db.shiftAssignment.findUniqueOrThrow({ where: { id: donNghi.id } });
    expect(sau).toEqual(donNghi);
  });

  // ── XEM TRƯỚC: đếm đủ, KHÔNG ghi gì ────────────────────────────────────────────────
  describe("ghiThat: false — xem trước", () => {
    it("KHÔNG ghi một dòng nào, nhưng đếm ĐÚNG BẰNG lượt ghi thật", async () => {
      await dungOCu(14); // ngày QUÁ KHỨ  → nhánh SKIP_QUA_KHU
      // ⚠️ PHẢI có cả ô ở ngày TƯƠNG LAI: đó là ô duy nhất đi vào nhánh REPLACE, tức nhánh
      // có câu `updateMany … status: CANCELLED`. Bản đầu của ca này chỉ dựng ngày 14, nên
      // phép cấy "bỏ chặn `updateMany` của nhánh REPLACE" vẫn XANH — ca test không chạm tới
      // câu lệnh ghi mà nó tưởng đang canh. (Luật 8: lượt cấy không đỏ phải hỏi có cấy trúng
      // không — ở đây là ca test sai, không phải phép cấy sai.)
      await dungOCu(20); // ngày TƯƠNG LAI → nhánh REPLACE
      const truoc = await db.shiftAssignment.findMany({ where: { userId }, orderBy: { workDate: "asc" } });

      const xem = await xemTruoc();

      // 1. Không dấu vết nào trên bảng ô ca.
      const sau = await db.shiftAssignment.findMany({ where: { userId }, orderBy: { workDate: "asc" } });
      expect(sau, "xem trước KHÔNG được đổi một dòng nào").toEqual(truoc);

      // 2. …cũng không để lại việc cho cron: `markAttendanceDaysDirtyMany` phải im.
      //    Một dòng DomainEvent lọt ra là cron nhặt lên rồi tính lại một thứ chưa đổi.
      expect(
        await db.domainEvent.count({
          where: { type: "hr.attendance_day_dirty", dedupeKey: { contains: userId } },
        }),
        "xem trước không được xếp hàng tính lại",
      ).toBe(0);

      // 3. Con số phải TRÙNG KHỚP lượt ghi thật ngay sau đó — nếu lệch thì bảng xem trước
      //    đang hứa một chuyện và hệ thống làm một chuyện khác (luật 12).
      const that = await chay();
      expect(
        { created: that.created, replaced: that.replaced, cleared: that.cleared, skippedPast: that.skippedPast, skippedProtected: that.skippedProtected },
        "xem trước và ghi thật phải ra cùng bảy con số",
      ).toEqual(
        { created: xem.created, replaced: xem.replaced, cleared: xem.cleared, skippedPast: xem.skippedPast, skippedProtected: xem.skippedProtected },
      );
    });

    it("`chiTiet` nói được ngày nào TẠO / BỎ QUA VÌ QUÁ KHỨ / BỎ QUA VÌ PROTECTED", async () => {
      await dungOCu(14);
      const xem = await xemTruoc();
      const theoNgay = new Map(xem.chiTiet.map((c) => [c.ngay, c]));

      expect(theoNgay.get("2026-09-14")).toMatchObject({ action: "SKIP_QUA_KHU", maCu: "CG", maMoi: "" });
      expect(theoNgay.get("2026-09-16")).toMatchObject({ action: "CREATE", maCu: "", maMoi: "S" });
      // Ngày quá khứ KHÔNG có ô thì không có dòng nào — không bày ra thứ chẳng xảy ra.
      expect(theoNgay.has("2026-09-01")).toBe(false);
    });
  });
});
