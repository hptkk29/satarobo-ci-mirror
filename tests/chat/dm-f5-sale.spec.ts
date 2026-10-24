// @vitest-environment node
/**
 * F5 — Nhắn riêng 1-1 SALE↔PHỤ HUYNH: TẦNG DB THẬT (`lib/chat/dm.ts` trên Postgres).
 *
 * Song sinh với `dm-us13.spec.ts` (kênh GV↔PH) nhưng KHÔNG phải bản chép: quan hệ nền
 * khác hẳn (`Enrollment.saleId` thay vì `Class.teacherId`), và có hai chỗ **cố ý ngược**
 * với kênh dạy học — mỗi chỗ có một ca đối chứng ở dưới:
 *
 *   1. Kênh tư vấn **KHÔNG ràng `Class.status = 'ACTIVE'`**. Nó sống theo PHÂN CÔNG CHĂM
 *      SÓC, không theo việc lớp đã khai giảng chưa: ghi danh `PENDING`/`CONFIRMED` chính
 *      là lúc phụ huynh cần hỏi sale nhất.
 *   2. `dmKey` mang **tiền tố loại** (`TP:` / `SP:`) nên CÙNG một cặp user có thể có hai
 *      kênh độc lập. Đây là lý do tiền tố tồn tại — xem nhóm "hai kênh độc lập".
 *
 * ⚠️ FIXTURE RIÊNG, tiền tố `CI_DMS_`. Mỗi ca deny dùng CẶP user RIÊNG: hội thoại 1-1 là
 * trạng thái dính theo cặp (mở rồi tồn tại mãi), dùng chung một cặp cho nhiều ca là để ca
 * trước quyết định kết quả ca sau.
 *
 * ⚠️ BẪY RATE LIMIT của bộ này (kênh GV↔PH không dính): `OPEN_DM_RATE_MAX = 20` lượt/phút
 * khoá theo **userId người bấm**, và bộ đếm sống suốt tiến trình test. Ở kênh GV↔PH mỗi ca
 * một phụ huynh bấm nên trải đều; ở đây nếu để MỘT sale bấm mọi ca thì quá 20 là cả loạt
 * ca cuối đỏ vì `RATE_LIMITED` — trông y hệt lỗi quyền. Vì vậy mỗi nhóm ca dùng một sale
 * riêng, và ca nào bấm nhiều thì để PHÍA PHỤ HUYNH bấm.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. `assertTestDb()` + dọn theo tiền tố ở
 * `beforeAll` VÀ `afterAll`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { EnrollmentStatus } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: async () => true,
  conversationBroadcast: (
    conversationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => ({ topic: `conv:${conversationId}`, event, payload, private: true }),
  userBumpBroadcasts: () => [],
}));

import { db } from "../../lib/db";
import {
  assertTestDb,
  disconnectDb,
  seedOrg,
  seedRoles,
  seedUser,
} from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import {
  dmKeyOf,
  findSaleAssignedEnrollmentIds,
  listSalesForParent,
  openDmAsActor,
  reconcileDmConversations,
  resolveSaleParentRelation,
} from "../../lib/chat/dm";
import { sendChatMessageAsActor } from "../../lib/chat/messages";

import {
  DB_URL_CHE,
  LY_DO_BO_QUA,
  RUN_DB_TESTS as RUN_DB_TESTS_CHUNG,
} from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db` / `test:nen-db`.
const RUN = RUN_DB_TESTS_CHUNG;

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;
const P = "CI_DMS_";

if (!RUN) {
  console.warn(
    `[dm-f5-sale] SKIP: ${LY_DO_BO_QUA} (DB=${DB_URL_CHE}). ` +
      "Chạy `pnpm test:chat-db` với .env.test, hoặc để job CI chat-db-tests chạy.",
  );
}

// ── Fixture ─────────────────────────────────────────────────────────────────

type World = {
  centerId: string;
  courseId: string;
  classId: string;
  /** Lớp KHÔNG ACTIVE — dùng cho ca "kênh tư vấn không phụ thuộc trạng thái lớp". */
  classPlannedId: string;
  users: Record<string, string>;
};

let W: World;

async function mkUser(key: string, name: string, role: "PARENT" | "TEACHER" = "TEACHER"): Promise<string> {
  const u = await seedUser({ email: `${P}${key}@ci-dms.test`, name: `${P}${name}`, role });
  return u.id;
}

async function grantOrgRole(userId: string, orgCode: string, roleCode: string, by: string) {
  const org = await db.orgUnit.findUniqueOrThrow({ where: { code: orgCode }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
  await db.userOrgRole.upsert({
    where: { userId_orgUnitId_roleId: { userId, orgUnitId: org.id, roleId: role.id } },
    update: { status: "ACTIVE", effectiveTo: null },
    create: { userId, orgUnitId: org.id, roleId: role.id, grantedById: by, status: "ACTIVE" },
  });
}

async function mkStudent(key: string, parentUserId: string, deleted = false): Promise<string> {
  const s = await db.student.upsert({
    where: { studentCode: `${P}HV_${key}` },
    update: { parentUserId, centerId: W.centerId, deletedAt: deleted ? new Date() : null },
    create: {
      studentCode: `${P}HV_${key}`,
      name: `${P}con ${key}`,
      parentUserId,
      centerId: W.centerId,
      parentName: `${P}PH ${key}`,
      parentPhone: "0900000000",
      deletedAt: deleted ? new Date() : null,
    },
    select: { id: true },
  });
  return s.id;
}

/** `saleId: null` để dựng ca "hết phân công". Enrollment ∈ SCOPED_MODELS ⇒ phải set centerId. */
async function mkEnrollment(input: {
  studentId: string;
  classId?: string;
  saleId: string | null;
  status: EnrollmentStatus;
  deleted?: boolean;
}): Promise<string> {
  const classId = input.classId ?? W.classId;
  const existing = await db.enrollment.findFirst({
    where: { studentId: input.studentId, classId },
    select: { id: true },
  });
  const data = {
    status: input.status,
    saleId: input.saleId,
    centerId: W.centerId,
    deletedAt: input.deleted ? new Date() : null,
  };
  if (existing) {
    await db.enrollment.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await db.enrollment.create({
    data: { studentId: input.studentId, classId, courseId: W.courseId, ...data },
    select: { id: true },
  });
  return created.id;
}

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { startsWith: P } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    // Dọn CẢ HAI loại 1-1: bản gốc của kênh GV↔PH lọc cứng `DM_TEACHER_PARENT` nên nếu
    // chép nguyên sẽ để lại rác DM_SALE_PARENT và làm ca "đếm hội thoại" lần sau đỏ oan.
    const convs = await db.conversation.findMany({
      where: {
        type: { in: ["DM_TEACHER_PARENT", "DM_SALE_PARENT"] },
        participants: { some: { userId: { in: ids } } },
      },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);
    if (convIds.length > 0) {
      await db.message.deleteMany({ where: { conversationId: { in: convIds } } });
      await db.conversationParticipant.deleteMany({ where: { conversationId: { in: convIds } } });
      await db.conversation.deleteMany({ where: { id: { in: convIds } } });
    }
  }
  const students = await db.student.findMany({
    where: { studentCode: { startsWith: `${P}HV_` } },
    select: { id: true },
  });
  const sIds = students.map((s) => s.id);
  if (sIds.length > 0) await db.enrollment.deleteMany({ where: { studentId: { in: sIds } } });
  await db.student.deleteMany({ where: { studentCode: { startsWith: `${P}HV_` } } });
  await db.class.deleteMany({ where: { classCode: { startsWith: P } } });
  await db.course.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
  await db.center.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function buildWorld(): Promise<World> {
  assertTestDb();
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();

  const center = await db.center.upsert({
    where: { slug: `${P.toLowerCase()}center` },
    update: {},
    create: { name: `${P}Center`, slug: `${P.toLowerCase()}center`, address: "CI", city: "" },
    select: { id: true },
  });
  const course = await db.course.upsert({
    where: { slug: `${P.toLowerCase()}course` },
    update: {},
    create: { name: `${P}Course`, slug: `${P.toLowerCase()}course` },
    select: { id: true },
  });
  const world: World = {
    centerId: center.id,
    courseId: course.id,
    classId: "",
    classPlannedId: "",
    users: {},
  };
  W = world;

  const cls = await db.class.upsert({
    where: { classCode: `${P}LOP` },
    update: { status: "ACTIVE", centerId: center.id },
    create: {
      classCode: `${P}LOP`,
      name: `${P}Lop`,
      courseId: course.id,
      centerId: center.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const clsPlanned = await db.class.upsert({
    where: { classCode: `${P}LOP_PLANNED` },
    update: { status: "PLANNED", centerId: center.id },
    create: {
      classCode: `${P}LOP_PLANNED`,
      name: `${P}LopChuaKhaiGiang`,
      courseId: course.id,
      centerId: center.id,
      status: "PLANNED",
    },
    select: { id: true },
  });
  world.classId = cls.id;
  world.classPlannedId = clsPlanned.id;

  const keys = ["sale1", "sale2", "sale3", "ph1", "ph2", "ph3", "ph4", "ph5", "gvsale"];
  for (const k of keys) {
    world.users[k] = await mkUser(k, k, k.startsWith("ph") ? "PARENT" : "TEACHER");
  }
  for (const k of ["sale1", "sale2", "sale3", "gvsale"]) {
    await grantOrgRole(world.users[k] as string, "CS1", "CENTER_SALES_CSM", world.users.sale1 as string);
  }
  for (const k of ["ph1", "ph2", "ph3", "ph4", "ph5"]) {
    await db.user.update({
      where: { id: world.users[k] as string },
      data: { role: "PARENT", roles: ["PARENT"] },
    });
  }
  return world;
}

const openDm = async (from: string, peer: string) => {
  const actor = await resolveActorUncached(from);
  return openDmAsActor(actor, `ci-dms:${from}`, { peerUserId: peer, kind: "SALE_PARENT" });
};

const convIdOf = (res: Awaited<ReturnType<typeof openDm>>): string => {
  if (!res.ok) throw new Error(`openDm thất bại: ${res.error.code} ${res.error.message}`);
  return res.data.conversationId;
};

const sendAs = async (userId: string, conversationId: string, body: string) => {
  const actor = await resolveActorUncached(userId);
  return sendChatMessageAsActor(actor, `ci-dms:${userId}`, {
    conversationId,
    body,
    clientMsgId: crypto.randomUUID(),
  });
};

// ── Ca ──────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)("F5 · kênh 1-1 sale ↔ phụ huynh (Postgres thật)", () => {
  beforeAll(async () => {
    await cleanup();
    await buildWorld();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  describe("phân công quyết định cửa mở", () => {
    it(
      "sale được gán → tạo được 1-1: đúng type, centerId NULL, khoá có tiền tố SP, 2 thành viên",
      async () => {
        const st = await mkStudent("ph1", W.users.ph1 as string);
        await mkEnrollment({ studentId: st, saleId: W.users.sale1 as string, status: "STUDYING" });

        const res = await openDm(W.users.sale1 as string, W.users.ph1 as string);
        const id = convIdOf(res);
        const conv = await db.conversation.findUniqueOrThrow({
          where: { id },
          select: { type: true, centerId: true, dmKey: true, status: true, subjectType: true },
        });
        expect(conv.type).toBe("DM_SALE_PARENT");
        // centerId NULL là cơ chế chặn QLCS (scope CENTER trượt trên null) — đừng "gán cho
        // tiện truy vấn admin".
        expect(conv.centerId).toBeNull();
        expect(conv.subjectType).toBe("NONE");
        expect(conv.dmKey).toBe(
          dmKeyOf(W.users.sale1 as string, W.users.ph1 as string, "SALE_PARENT"),
        );
        expect(conv.dmKey?.startsWith("SP:")).toBe(true);

        const parts = await db.conversationParticipant.findMany({
          where: { conversationId: id },
          select: { userId: true, source: true, leftAt: true },
        });
        expect(parts).toHaveLength(2);
        expect(parts.every((p) => p.source === "MANUAL" && p.leftAt === null)).toBe(true);
      },
      CASE_TIMEOUT,
    );

    it(
      "mở xong là NHẮN ĐƯỢC CẢ HAI CHIỀU — không phải hộp câm một chiều",
      async () => {
        const id = convIdOf(await openDm(W.users.ph1 as string, W.users.sale1 as string));
        expect((await sendAs(W.users.sale1 as string, id, "sale chào")).ok).toBe(true);
        expect((await sendAs(W.users.ph1 as string, id, "PH chào lại")).ok).toBe(true);
      },
      CASE_TIMEOUT,
    );

    it(
      "sale KHÁC (không được gán) → deny, kèm đối chứng dương cho sale đúng",
      async () => {
        const st = await mkStudent("ph2", W.users.ph2 as string);
        await mkEnrollment({ studentId: st, saleId: W.users.sale1 as string, status: "STUDYING" });

        const saiSale = await openDm(W.users.sale2 as string, W.users.ph2 as string);
        expect(saiSale.ok).toBe(false);
        if (!saiSale.ok) expect(saiSale.error.code).toBe("PERMISSION_DENIED");

        // Đối chứng dương: cùng phụ huynh đó, sale ĐÚNG mở được ⇒ ca deny ở trên không
        // phải do fixture hỏng.
        expect((await openDm(W.users.sale1 as string, W.users.ph2 as string)).ok).toBe(true);
      },
      CASE_TIMEOUT,
    );

    it(
      "ghi danh huỷ / xoá mềm / học viên xoá mềm → deny (mỗi ca một cặp riêng)",
      async () => {
        const st3 = await mkStudent("ph3", W.users.ph3 as string);
        await mkEnrollment({ studentId: st3, saleId: W.users.sale3 as string, status: "CANCELLED" });
        const r1 = await openDm(W.users.sale3 as string, W.users.ph3 as string);
        expect(r1.ok, "ghi danh CANCELLED không phải phân công còn hiệu lực").toBe(false);

        const st4 = await mkStudent("ph4", W.users.ph4 as string);
        await mkEnrollment({
          studentId: st4,
          saleId: W.users.sale3 as string,
          status: "STUDYING",
          deleted: true,
        });
        expect((await openDm(W.users.sale3 as string, W.users.ph4 as string)).ok).toBe(false);

        const st5 = await mkStudent("ph5", W.users.ph5 as string, true); // học viên xoá mềm
        await mkEnrollment({ studentId: st5, saleId: W.users.sale3 as string, status: "STUDYING" });
        expect((await openDm(W.users.sale3 as string, W.users.ph5 as string)).ok).toBe(false);
      },
      CASE_TIMEOUT,
    );

    it(
      "CỐ Ý NGƯỢC với kênh dạy học: lớp CHƯA khai giảng vẫn mở được kênh tư vấn",
      async () => {
        // Đây là lúc phụ huynh cần hỏi sale nhất (chờ xếp lớp / đã xếp chưa học). Nếu ai đó
        // "cho nhất quán" mà thêm điều kiện `Class.status = 'ACTIVE'` vào
        // findSaleAssignedEnrollmentIds thì ca này ĐỎ — đúng mục đích.
        const st = await mkStudent("ph2b", W.users.ph2 as string);
        await mkEnrollment({
          studentId: st,
          classId: W.classPlannedId,
          saleId: W.users.sale2 as string,
          status: "CONFIRMED",
        });
        const ids = await findSaleAssignedEnrollmentIds(
          W.users.sale2 as string,
          W.users.ph2 as string,
        );
        expect(ids.length).toBeGreaterThan(0);
        expect(
          await resolveSaleParentRelation(W.users.sale2 as string, W.users.ph2 as string),
        ).not.toBeNull();
      },
      CASE_TIMEOUT,
    );
  });

  describe("chiều phụ huynh → sale (lối vào portal)", () => {
    it(
      "listSalesForParent trả DANH SÁCH, gộp theo sale và kèm tên các con",
      async () => {
        const sales = await listSalesForParent(W.users.ph2 as string);
        const codes = sales.map((s) => s.saleUserId);
        // ph2 có 2 ghi danh: một với sale1 (ca trên), một với sale2 (lớp chưa khai giảng).
        expect(codes).toContain(W.users.sale1 as string);
        expect(codes).toContain(W.users.sale2 as string);
        for (const s of sales) expect(s.childNames.length).toBeGreaterThan(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "phụ huynh KHÔNG có phân công nào → danh sách rỗng (không hiện nút chết)",
      async () => {
        expect(await listSalesForParent(W.users.ph5 as string)).toEqual([]);
      },
      CASE_TIMEOUT,
    );
  });

  describe("hết phân công thì đóng kênh", () => {
    it(
      "gỡ saleId → job đối soát chuyển ARCHIVED + ghi tin SYSTEM ĐÚNG LÝ DO",
      async () => {
        const st = await mkStudent("ph1", W.users.ph1 as string);
        const id = convIdOf(await openDm(W.users.ph1 as string, W.users.sale1 as string));

        await db.enrollment.updateMany({ where: { studentId: st }, data: { saleId: null } });
        const sum = await reconcileDmConversations({ onlyConversationIds: [id] });
        expect(sum.dmArchived).toBe(1);

        const conv = await db.conversation.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        });
        expect(conv.status).toBe("ARCHIVED");

        const sys = await db.message.findFirst({
          where: { conversationId: id, kind: "SYSTEM" },
          orderBy: { createdAt: "desc" },
          select: { body: true },
        });
        // Câu phải nói về PHÂN CÔNG, không phải "quan hệ dạy học" — phụ huynh đọc câu sai
        // sự thật thì tưởng con mình bị nghỉ học.
        expect(sys?.body).toContain("phụ trách");
        expect(sys?.body).not.toContain("dạy học");

        // Đọc được, KHÔNG gửi được.
        expect((await sendAs(W.users.sale1 as string, id, "cố gửi")).ok).toBe(false);
      },
      CASE_TIMEOUT,
    );
  });

  describe("hai kênh độc lập — lý do tồn tại của tiền tố khoá", () => {
    it(
      "cùng một cặp user vừa có kênh dạy học vừa có kênh tư vấn ⇒ HAI hội thoại, archive cái này không đụng cái kia",
      async () => {
        // gvsale: một nhân sự vừa dạy lớp, vừa là sale được gán của chính phụ huynh đó.
        // Repo cho phép đa vai nên đây KHÔNG phải tình huống bịa.
        const gvsale = W.users.gvsale as string;
        const ph = W.users.ph3 as string;
        await grantOrgRole(gvsale, "CS1", "TEACHER", gvsale);
        await db.class.update({ where: { id: W.classId }, data: { teacherId: gvsale } });

        const st = await mkStudent("ph3", ph);
        await mkEnrollment({ studentId: st, saleId: gvsale, status: "STUDYING" });

        const actor = await resolveActorUncached(ph);
        const tp = await openDmAsActor(actor, "ci-dms:ph", {
          peerUserId: gvsale,
          kind: "TEACHER_PARENT",
        });
        const sp = await openDmAsActor(actor, "ci-dms:ph", {
          peerUserId: gvsale,
          kind: "SALE_PARENT",
        });
        expect(tp.ok, "kênh dạy học phải mở được").toBe(true);
        expect(sp.ok, "kênh tư vấn phải mở được").toBe(true);
        if (!tp.ok || !sp.ok) return;

        // HAI hội thoại khác nhau — đây là điều mà bản không-tiền-tố KHÔNG làm được.
        expect(sp.data.conversationId).not.toBe(tp.data.conversationId);

        // Cắt quan hệ DẠY HỌC (gỡ khỏi lớp) rồi chạy đối soát trên CẢ HAI.
        await db.class.update({ where: { id: W.classId }, data: { teacherId: null } });
        await reconcileDmConversations({
          onlyConversationIds: [tp.data.conversationId, sp.data.conversationId],
        });

        const sau = await db.conversation.findMany({
          where: { id: { in: [tp.data.conversationId, sp.data.conversationId] } },
          select: { id: true, status: true, type: true },
        });
        const kenhDayHoc = sau.find((c) => c.id === tp.data.conversationId);
        const kenhTuVan = sau.find((c) => c.id === sp.data.conversationId);
        expect(kenhDayHoc?.status, "hết dạy học ⇒ kênh dạy học đóng").toBe("ARCHIVED");
        expect(
          kenhTuVan?.status,
          "phân công chăm sóc CÒN ⇒ kênh tư vấn phải SỐNG. Đây chính là thứ bản không-tiền-tố làm hỏng.",
        ).toBe("ACTIVE");
      },
      CASE_TIMEOUT,
    );
  });
});
