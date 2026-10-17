/**
 * R7-05 — Convert v2: guard payment + multi-student + dedupe + consent + mã HV v2.
 * Postgres LOCAL (.env.test). Skeleton theo test plan §8 (RTM AC1..AC6 + rollback).
 *
 * Phần THUẦN (guard / dedupe classify / codegen format) chạy ngay; phần cần seed
 * dữ liệu THẬT (convert end-to-end) để `test.fixme` — bổ sung seed ở bước sau.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { evaluatePaymentGuard, convertLeadV2 } from "../../../lib/crm/convert-lead-v2";
import { ensureOrderPaymentRecorded, confirmPayment } from "../../../lib/finance/payment";
import {
  classifyParentMatch,
  normalizeName,
  normalizePhone,
  studentMatches,
} from "../../../lib/crm/dedupe";
import {
  formatStudentCodeV2,
  randomStudentCodeBody,
  STUDENT_CODE_V2_CHARSET,
} from "../../../lib/codegen";
import { isConvertV2Enabled } from "../../../lib/flags";
import { changeStudentCode } from "../../../lib/students/change-code";

test.describe("[R7-05] Convert v2", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  // ── AC1 / C1-C3 — guard PAYMENT_REQUIRED ──────────────────────────────────
  test("[R7-05-C1] 0 khoản ghi nhận & tổng > 0 → guard FAIL (PAYMENT_REQUIRED)", () => {
    expect(evaluatePaymentGuard({ hasRecordedPayment: false, totalFinalPrice: 5_000_000 }))
      .toEqual({ ok: false });
  });

  test("[R7-05-C2] có khoản Sale ghi nhận (RECORDED) → guard PASS (KT chưa confirm vẫn pass)", () => {
    expect(evaluatePaymentGuard({ hasRecordedPayment: true, totalFinalPrice: 5_000_000 }))
      .toEqual({ ok: true, scholarshipFull: false });
  });

  test("[R7-05-C3] tổng phải-thu = 0 → guard PASS + cờ học bổng toàn phần", () => {
    expect(evaluatePaymentGuard({ hasRecordedPayment: false, totalFinalPrice: 0 }))
      .toEqual({ ok: true, scholarshipFull: true });
  });

  // ── AC3 / C6 — dedupe parent 3 nhánh ──────────────────────────────────────
  test("[R7-05-dedupe] classifyParentMatch: none / reuse / conflict", () => {
    expect(classifyParentMatch(null, null)).toEqual({ kind: "none" });
    expect(classifyParentMatch("u1", null)).toEqual({ kind: "reuse", userId: "u1" });
    expect(classifyParentMatch(null, "u2")).toEqual({ kind: "reuse", userId: "u2" });
    expect(classifyParentMatch("u1", "u1")).toEqual({ kind: "reuse", userId: "u1" });
    expect(classifyParentMatch("uA", "uB")).toEqual({
      kind: "conflict",
      parentAId: "uA",
      parentBId: "uB",
    });
  });

  // ── AC4 / C7 — dedupe student (tên chuẩn hoá + DOB) ───────────────────────
  test("[R7-05-C7] student trùng theo tên chuẩn hoá + DOB", () => {
    expect(normalizeName("  Nguyễn  Văn A ")).toBe("nguyễn văn a");
    expect(normalizePhone("0905.123.456")).toBe("84905123456");
    expect(normalizePhone("+84 905 123 456")).toBe("84905123456");
    const dob = new Date("2015-05-01");
    expect(studentMatches({ name: " nguyễn  văn a ", dob }, { name: "Nguyễn Văn A", dob })).toBe(true);
    expect(studentMatches({ name: "Nguyễn Văn A", dob }, { name: "Nguyễn Văn B", dob })).toBe(false);
  });

  // ── AC6 / C9 — mã HV v2 format + charset ──────────────────────────────────
  test("[R7-05-C9] mã v2 đúng format CS-YY-RANDOM + charset không nhập nhằng", () => {
    const body = randomStudentCodeBody(() => 0); // ký tự đầu charset
    expect(body).toHaveLength(6);
    expect([...body].every((ch) => STUDENT_CODE_V2_CHARSET.includes(ch))).toBe(true);
    const code = formatStudentCodeV2("CS1", "AB3K9P", new Date("2026-01-01"));
    expect(code).toBe("CS1-26-AB3K9P");
    // charset không nhập nhằng CHỈ áp cho thân mã ngẫu nhiên — phần CS code (vd "CS1")
    // do người đặt, có thể chứa số. Kiểm I/L/O/0/1 trên body, không trên cả mã.
    expect(body).not.toMatch(/[ILO01]/); // bỏ ký tự dễ nhầm
  });

  test("[R7-05-C11] flag CONVERT_V2_ENABLED đọc từ env (mặc định ON — entry point duy nhất)", () => {
    const prev = process.env.CONVERT_V2_ENABLED;
    delete process.env.CONVERT_V2_ENABLED;
    expect(isConvertV2Enabled()).toBe(true); // mặc định ON
    process.env.CONVERT_V2_ENABLED = "true";
    expect(isConvertV2Enabled()).toBe(true);
    process.env.CONVERT_V2_ENABLED = "false"; // chỉ tắt khẩn cấp
    expect(isConvertV2Enabled()).toBe(false);
    if (prev === undefined) delete process.env.CONVERT_V2_ENABLED;
    else process.env.CONVERT_V2_ENABLED = prev;
  });

  // ── End-to-end (seed Lead DA_DANG_KY + payment RECORDED + course/class) ────
  // Helper seed cục bộ (KHÔNG đụng tests/e2e/_helpers/seed.ts — tránh xung đột).
  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  async function seedCenter(code = "CS1") {
    return db.center.create({
      data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}-${uniq()}`, address: "x" },
    });
  }

  async function seedCourseClass(centerId: string) {
    const course = await db.course.create({
      data: { name: "Sata 3", slug: `sata3-${uniq()}`, price: 5_000_000 },
    });
    const cls = await db.class.create({
      data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId },
    });
    return { course, cls };
  }

  async function seedRegisteredLead(centerId: string, phone: string) {
    return db.lead.create({
      data: { parentName: "PH Lead", phone, status: "DA_DANG_KY", centerId },
    });
  }

  /** Order + Payment Sale GHI NHẬN (saleStatus=RECORDED, KT CHƯA xác nhận) gắn lead →
   *  guard PAYMENT_REQUIRED pass (R7-05-C2: KT chưa confirm vẫn pass). */
  async function seedRecordedPayment(leadId: string, centerId: string) {
    const order = await db.order.create({
      data: {
        code: `ORD-${uniq()}`,
        type: "COURSE",
        customerName: "PH Lead",
        customerPhone: "0900000000",
        leadId,
        centerId,
      },
    });
    await db.payment.create({
      data: {
        orderId: order.id,
        amount: 5_000_000,
        method: "cash",
        paidDate: new Date(),
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        centerId,
      },
    });
    return order;
  }

  /** Lead ở CHO_QUYET_DINH (chưa DA_DANG_KY) — chứng minh S4 bỏ chặn status. */
  async function seedAwaitingLead(centerId: string, phone: string) {
    return db.lead.create({
      data: { parentName: "PH Lead", phone, status: "CHO_QUYET_DINH", centerId },
    });
  }

  // ── S1 — ensureOrderPaymentRecorded idempotent + auto DA_DANG_KY ──────────
  test("[SPINE-S1] ghi Payment idempotent (orderId+soDot) + auto CHO_QUYET_DINH→DA_DANG_KY", async () => {
    const center = await seedCenter();
    const lead = await seedAwaitingLead(center.id, "0900000020");
    const order = await db.order.create({
      data: {
        code: `ORD-S1-${uniq()}`,
        type: "COURSE",
        customerName: "PH S1",
        customerPhone: "0900000020",
        totalAmount: 5_000_000,
        leadId: lead.id,
        centerId: center.id,
        status: "PENDING_PAYMENT",
      },
    });

    const first = await db.$transaction((tx) =>
      ensureOrderPaymentRecorded(tx, {
        orderId: order.id,
        soDot: 1,
        amount: 5_000_000,
        leadId: lead.id,
        centerId: center.id,
        actor: { id: null, name: "Hệ thống" },
      }),
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.created).toBe(true);

    // Gọi lại cùng (orderId, soDot) → KHÔNG tạo trùng.
    const second = await db.$transaction((tx) =>
      ensureOrderPaymentRecorded(tx, {
        orderId: order.id,
        soDot: 1,
        amount: 5_000_000,
        leadId: lead.id,
        centerId: center.id,
        actor: { id: null, name: "Hệ thống" },
      }),
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.created).toBe(false);

    expect(await db.payment.count({ where: { orderId: order.id, saleStatus: "RECORDED" } })).toBe(1);
    // Payment.centerId không null (suy từ order).
    const pay = await db.payment.findFirst({ where: { orderId: order.id }, select: { centerId: true } });
    expect(pay?.centerId).toBe(center.id);
    // Lead tự lên DA_DANG_KY.
    const after = await db.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
    expect(after?.status).toBe("DA_DANG_KY");
  });

  // ── S4 — convert từ status chưa-kết-thúc (KHÔNG cần DA_DANG_KY), giữ cổng tiền ──
  test("[SPINE-S4] convert từ CHO_QUYET_DINH có Payment RECORDED → OK (bỏ chặn status)", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedAwaitingLead(center.id, "0900000021");
    await seedRecordedPayment(lead.id, center.id); // ≥1 RECORDED → cổng tiền pass
    const actorUser = await seedUser({ email: `sale-s4-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale S4" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale S4" },
      {
        leadId: lead.id,
        parentEmail: "ph-s4@test.com",
        parentName: "PH S4",
        parentPhone: "0905222333",
        parentCccd: "012345678901",
        parentAddress: "123 Đường ABC",
        parentCity: "Đà Nẵng",
        parentWard: "Phường Hòa Cường",
        idempotencyKey: `s4-${uniq()}`,
        students: [{ name: "Bé S4", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false }],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await db.enrollment.count()).toBe(1);
    const after = await db.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
    expect(after?.status).toBe("DA_DANG_KY");
    // C5 — CCCD + địa chỉ ghi vào tài khoản phụ huynh.
    const parent = await db.user.findUnique({ where: { email: "ph-s4@test.com" }, select: { cccd: true, city: true } });
    expect(parent?.cccd).toBe("012345678901");
    expect(parent?.city).toBe("Đà Nẵng");
    // AUTH-SĐT P1 (gom tồn dư 31/07) — ĐƯỜNG GHI phải ra canonical `84…`.
    // Input là "0905222333"; bản cũ `replace(/\D/g,"")` giữ nguyên `0905…` ⇒ mỗi lần
    // convert lại bào mòn kết quả backfill 29/07. Ca này ĐỎ trước khi vá.
    const stu = await db.student.findFirst({ select: { parentPhone: true } });
    expect(stu?.parentPhone, "convert ghi parentPhone không phải canonical").toBe("84905222333");
  });

  // ── AC2 / C4 — đa học viên ATOMIC: lỗi giữa chừng rollback CẢ 2 ───────────
  test("[R7-05-C4] convert 2 con — lỗi giữa chừng rollback cả 2 (tx)", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000010");
    await seedRecordedPayment(lead.id, center.id);
    const actorUser = await seedUser({ email: `sale-c4-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale C4" });
    const actor = { id: actorUser.id, name: "Sale C4" };

    // Con 2 trỏ classId KHÔNG tồn tại → FK fail giữa transaction → rollback toàn bộ.
    await expect(
      convertLeadV2(actor, {
        leadId: lead.id,
        parentEmail: "ph-c4@test.com",
        parentName: "PH C4",
        parentPhone: "0905111222",
        idempotencyKey: `c4-${uniq()}`,
        students: [
          { name: "Bé Một", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
          { name: "Bé Hai", courseId: course.id, listPrice: 5_000_000, classId: "class-khong-ton-tai", consentMedia: false },
        ],
      }),
    ).rejects.toThrow();

    // KHÔNG có student/enrollment/idempotency nào sót lại; lead vẫn DA_DANG_KY.
    expect(await db.student.count()).toBe(0);
    expect(await db.enrollment.count()).toBe(0);
    expect(await db.idempotencyKey.count()).toBe(0);
    const after = await db.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
    expect(after?.status).toBe("DA_DANG_KY");
  });

  // ── AC2 / C5 — double-submit (cùng key) + 2 Sale song song → 1 bộ record ──
  test("[R7-05-C5] double-submit + 2 sale song song → 1 bộ record (idempotency)", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);

    // (a) double-submit cùng idempotencyKey → lần 2 trả kết quả cũ (deduped).
    const lead1 = await seedRegisteredLead(center.id, "0900000011");
    await seedRecordedPayment(lead1.id, center.id);
    const actorUser = await seedUser({ email: `sale-c5-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale C5" });
    const actor = { id: actorUser.id, name: "Sale C5" };
    const input = {
      leadId: lead1.id,
      parentEmail: "ph-c5@test.com",
      parentName: "PH C5",
      parentPhone: "0905333444",
      idempotencyKey: `c5-${uniq()}`,
      students: [{ name: "Bé Năm", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false }],
    };

    const first = await convertLeadV2(actor, input);
    const second = await convertLeadV2(actor, input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.deduped).toBe(true);
      expect(second.studentIds).toEqual(first.studentIds);
      expect(second.enrollmentIds).toEqual(first.enrollmentIds);
    }
    expect(await db.student.count()).toBe(1);
    expect(await db.enrollment.count()).toBe(1);
    expect(await db.idempotencyKey.count({ where: { key: input.idempotencyKey } })).toBe(1);

    // (b) 2 Sale song song (KEY khác nhau) trên 1 lead → CLAIM atomic: chỉ 1 thắng.
    const lead2 = await seedRegisteredLead(center.id, "0900000012");
    await seedRecordedPayment(lead2.id, center.id);
    const mk = (key: string) => ({
      leadId: lead2.id,
      parentEmail: "ph-par@test.com",
      parentName: "PH Par",
      parentPhone: "0905555666",
      idempotencyKey: key,
      students: [{ name: "Bé Song", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false }],
    });
    const results = await Promise.allSettled([
      convertLeadV2(actor, mk(`c5-par-a-${uniq()}`)),
      convertLeadV2(actor, mk(`c5-par-b-${uniq()}`)),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok);
    expect(succeeded.length).toBe(1); // đúng 1 lượt convert thành công

    const parent = await db.user.findUnique({ where: { email: "ph-par@test.com" }, select: { id: true } });
    expect(parent).not.toBeNull();
    expect(await db.student.count({ where: { parentUserId: parent!.id } })).toBe(1);
  });

  // ── AC3 / C6 — email∈A & phone∈B → ConvertConflict OPEN + khoá convert ────
  test("[R7-05-C6] email∈A & phone∈B → ConvertConflict OPEN + khoá convert", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);

    // Parent A khớp theo EMAIL; Parent B khớp theo PHONE (qua Student.parentPhone).
    const parentA = await db.user.create({
      data: { email: "conflict-a@test.com", name: "PA", role: "PARENT", roles: ["PARENT"] },
    });
    const parentB = await db.user.create({
      data: { email: "conflict-b@test.com", name: "PB", role: "PARENT", roles: ["PARENT"] },
    });
    await db.student.create({
      data: { name: "Con cũ", parentUserId: parentB.id, parentPhone: "0907000111", centerId: center.id },
    });

    const lead = await seedRegisteredLead(center.id, "0900000013");
    const actorUser = await seedUser({ email: `sale-c6-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale C6" });
    const actor = { id: actorUser.id, name: "Sale C6" };

    // listPrice 0 → guard PASS (học bổng) nên tới được bước dedupe parent.
    const res = await convertLeadV2(actor, {
      leadId: lead.id,
      parentEmail: "conflict-a@test.com",
      parentName: "PH C6",
      parentPhone: "0907000111",
      idempotencyKey: `c6-${uniq()}`,
      students: [{ name: "Bé Sáu", courseId: course.id, listPrice: 0, classId: cls.id, consentMedia: false }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PARENT_CONFLICT");

    const conflict = await db.convertConflict.findFirst({ where: { leadId: lead.id } });
    expect(conflict?.status).toBe("OPEN");
    expect(conflict?.parentAId).toBe(parentA.id);
    expect(conflict?.parentBId).toBe(parentB.id);

    // Convert bị KHOÁ: lead vẫn DA_DANG_KY, không tạo student mới (chỉ còn "Con cũ").
    const after = await db.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
    expect(after?.status).toBe("DA_DANG_KY");
    expect(await db.student.count()).toBe(1);
  });

  // ── AC5 / C8 — consent per con → StudentConsent + audit actor/time ────────
  test("[R7-05-C8] consent per con → StudentConsent + audit actor/time", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000014");
    await seedRecordedPayment(lead.id, center.id);
    const actorUser = await seedUser({ email: `sale-c8-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale C8" });
    const actor = { id: actorUser.id, name: "Sale C8" };

    const res = await convertLeadV2(actor, {
      leadId: lead.id,
      parentEmail: "ph-c8@test.com",
      parentName: "PH C8",
      parentPhone: "0908000222",
      idempotencyKey: `c8-${uniq()}`,
      students: [
        { name: "Bé Có Consent", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: true },
        { name: "Bé Không Consent", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [s1, s2] = res.studentIds;
    // Consent CHỈ tạo cho con đã tick (per-con), không cho con còn lại.
    const c1 = await db.studentConsent.findUnique({
      where: { studentId_type: { studentId: s1!, type: "CLASS_MEDIA" } },
    });
    expect(c1?.status).toBe("GRANTED");
    expect(
      await db.studentConsent.findUnique({ where: { studentId_type: { studentId: s2!, type: "CLASS_MEDIA" } } }),
    ).toBeNull();
    expect(await db.studentConsent.count()).toBe(1);

    // Audit ghi nhận actor + thời điểm tick consent.
    const audit = await db.auditLog.findFirst({
      where: { entityType: "StudentConsent", entityId: s1!, action: "CONSENT_GRANTED_AT_CONVERT" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(actor.id);
    expect(audit?.createdAt).toBeInstanceOf(Date);
    expect((audit?.newValues as { grantedBy?: string } | null)?.grantedBy).toBe(actor.id);
  });

  // ── BUG-006 / C12 — convert per-child: enrollment lưu đúng leadChildId ────
  test("[R7-06-C12] convert 2 con → 2 enrollment có leadChildId đúng từng con", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000015");
    await seedRecordedPayment(lead.id, center.id);
    const childA = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Con A" }, select: { id: true } });
    const childB = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Con B" }, select: { id: true } });
    const actorUser = await seedUser({ email: `sale-c12-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale C12" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale C12" },
      {
        leadId: lead.id,
        parentEmail: "ph-c12@test.com",
        parentName: "PH C12",
        parentPhone: "0909000333",
        idempotencyKey: `c12-${uniq()}`,
        students: [
          { leadChildId: childA.id, name: "Con A", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
          { leadChildId: childB.id, name: "Con B", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Mỗi con có Student + Enrollment riêng; enrollment.leadChildId trỏ đúng con.
    expect(await db.student.count()).toBe(2);
    const enA = await db.enrollment.findFirst({ where: { leadChildId: childA.id }, select: { id: true } });
    const enB = await db.enrollment.findFirst({ where: { leadChildId: childB.id }, select: { id: true } });
    expect(enA).not.toBeNull();
    expect(enB).not.toBeNull();
    expect(enA!.id).not.toBe(enB!.id);
    // Không enrollment nào thiếu truy vết.
    expect(await db.enrollment.count({ where: { leadChildId: null } })).toBe(0);
  });

  // ── FIN-01 / Q1=A — convert nhiều con: CHIA khoản RECORDED theo finalPrice ──
  test("[FIN-01-Q1A] convert 2 con → khoản đơn CHIA theo finalPrice (bất biến tổng) → confirm → 2 Receipt + nợ=0", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000030");
    // 1 khoản RECORDED = 9.000.000 cho đơn 2 con (chưa gắn ghi danh).
    const order = await db.order.create({
      data: {
        code: `ORD-FIN-${uniq()}`, type: "COURSE", customerName: "PH FIN",
        customerPhone: "0900000030", leadId: lead.id, centerId: center.id,
      },
    });
    await db.payment.create({
      data: {
        orderId: order.id, amount: 9_000_000, method: "cash", paidDate: new Date(),
        saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: center.id,
      },
    });
    const actorUser = await seedUser({ email: `sale-fin-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale FIN" });

    // 2 con: finalPrice 6M / 3M → tỉ lệ 2:1 → chia 9M = 6M + 3M.
    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale FIN" },
      {
        leadId: lead.id, parentEmail: "ph-fin@test.com", parentName: "PH FIN", parentPhone: "0905999888",
        idempotencyKey: `fin-${uniq()}`,
        students: [
          { name: "Con Lớn", courseId: course.id, listPrice: 6_000_000, classId: cls.id, consentMedia: false },
          { name: "Con Nhỏ", courseId: course.id, listPrice: 3_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [enr1, enr2] = res.enrollmentIds;

    // Khoản 9M được CHIA 2:1 → 2 Payment gắn đúng từng ghi danh; TỔNG bất biến = 9M.
    const pays = await db.payment.findMany({
      where: { orderId: order.id, deletedAt: null },
      select: { amount: true, enrollmentId: true, saleStatus: true },
    });
    expect(pays.length).toBe(2); // 1 gốc (cập nhật) + 1 con
    expect(pays.reduce((s, p) => s + p.amount, 0)).toBe(9_000_000);
    const byEnr = Object.fromEntries(pays.map((p) => [p.enrollmentId, p.amount]));
    expect(byEnr[enr1!]).toBe(6_000_000);
    expect(byEnr[enr2!]).toBe(3_000_000);
    // KHÔNG auto-confirm — vẫn chờ kế toán.
    expect(pays.every((p) => p.saleStatus === "RECORDED")).toBe(true);
    expect(await db.receipt.count()).toBe(0);

    // Kế toán xác nhận từng khoản → 2 Receipt riêng (scoped theo Enrollment).
    const payRows = await db.payment.findMany({ where: { orderId: order.id }, select: { id: true } });
    for (const p of payRows) {
      const c = await confirmPayment({ paymentId: p.id, confirmedById: actorUser.id });
      expect(c.ok).toBe(true);
    }
    expect(await db.receipt.count({ where: { enrollmentId: { in: [enr1!, enr2!] } } })).toBe(2);

    // Công nợ mỗi ghi danh = finalPrice − Σ CONFIRMED = 0.
    for (const [enrId, price] of [[enr1!, 6_000_000], [enr2!, 3_000_000]] as const) {
      const enr = await db.enrollment.findUnique({
        where: { id: enrId },
        select: { finalPrice: true, payments: { where: { accountantStatus: "CONFIRMED" }, select: { amount: true } } },
      });
      const paid = enr!.payments.reduce((s, p) => s + p.amount, 0);
      expect((enr!.finalPrice ?? price) - paid).toBe(0);
    }
  });

  // ── AC6 / C10 — sửa mã HV (quyền + audit + reason) ────────────────────────
  test("[R7-05-C10] sửa mã: CENTER_MANAGER chặn / SUPER_ADMIN OK+audit+reason", async () => {
    const student = await db.student.create({
      data: { name: "HV C10", studentCode: "CS1-26-AAAAAA" },
      select: { id: true },
    });

    // CENTER_MANAGER (isSuperAdmin=false) → chặn, mã không đổi.
    const cm = await changeStudentCode({
      actor: { id: "cm-1", name: "CM", isSuperAdmin: false },
      studentId: student.id,
      newCode: "CS1-26-BBBBBB",
      reason: "đổi mã",
    });
    expect(cm.ok).toBe(false);

    // SUPER_ADMIN nhưng thiếu reason → chặn.
    const noReason = await changeStudentCode({
      actor: { id: "sa-1", name: "SA", isSuperAdmin: true },
      studentId: student.id,
      newCode: "CS1-26-BBBBBB",
      reason: "   ",
    });
    expect(noReason.ok).toBe(false);

    // SUPER_ADMIN + reason → OK, mã đổi + audit ghi old→new + actor + reason.
    const ok = await changeStudentCode({
      actor: { id: "sa-1", name: "SA", isSuperAdmin: true },
      studentId: student.id,
      newCode: "CS1-26-BBBBBB",
      reason: "Nhập sai mã lúc convert",
    });
    expect(ok.ok).toBe(true);

    const updated = await db.student.findUnique({
      where: { id: student.id },
      select: { studentCode: true },
    });
    expect(updated?.studentCode).toBe("CS1-26-BBBBBB");

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Student", entityId: student.id, action: "CHANGE_CODE" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe("sa-1");
    expect(audit?.reason).toBe("Nhập sai mã lúc convert");
    expect((audit?.oldValues as { studentCode?: string } | null)?.studentCode).toBe("CS1-26-AAAAAA");
    expect((audit?.newValues as { studentCode?: string } | null)?.studentCode).toBe("CS1-26-BBBBBB");
  });

  // ── 25/09/2026 — LIÊN KẾT HỌC VIÊN ↔ LEAD NGUỒN (`Student.leadId/leadChildId`) ──────
  //
  // Chủ dự án chốt (D1/D2): chốt lead TỰ nối HV về lead gốc, và điền ô TRỐNG của hồ sơ HV
  // từ lead/con qua `dienTuLead` (chỉ ô null, không ghi đè). HV DÙNG LẠI (dedupe) chỉ được
  // nối khi CHƯA nối lead nào — `Student.leadId` là lead GỐC, lượt chốt sau không đè.
  // ⛔ Cột `Enrollment.leadChildId` KHÔNG đổi hành vi (tín hiệu "đã chốt" của báo cáo).

  async function seedLeadDayDu(centerId: string, phone: string) {
    const lead = await db.lead.create({
      data: {
        parentName: "PH LK",
        phone,
        status: "DA_DANG_KY",
        centerId,
        email: "lead-lk@test.com",
        facebookUrl: "https://www.facebook.com/ph.lk",
        parentGender: "FEMALE",
        parentDob: new Date("1987-04-05T00:00:00Z"),
        city: "Thành phố Đà Nẵng",
        ward: "Phường Hải Châu",
        addressLine: "12 Lê Lợi",
      },
    });
    const child = await db.leadChild.create({
      data: {
        leadId: lead.id,
        fullName: "Bé LK",
        dob: new Date("2016-06-07T00:00:00Z"),
        gender: "Nam",
        schoolName: "TH Lê Văn Tám",
        gradeLevel: "Lớp 5",
      },
      select: { id: true },
    });
    return { lead, child };
  }

  test("[CV2-LK-01] HV MỚI: nối lead + con nguồn, điền ô trống từ lead/con", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const { lead, child } = await seedLeadDayDu(center.id, "0900000041");
    await seedRecordedPayment(lead.id, center.id);
    const actorUser = await seedUser({ email: `sale-lk1-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale LK1" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale LK1" },
      {
        leadId: lead.id,
        parentEmail: "ph-lk1@test.com",
        parentName: "PH LK",
        parentPhone: "0905444001",
        idempotencyKey: `lk1-${uniq()}`,
        students: [
          { leadChildId: child.id, name: "Bé LK", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const stu = await db.student.findUniqueOrThrow({ where: { id: res.studentIds[0]! } });
    expect(stu.leadId, "HV mới phải nối về lead vừa chốt").toBe(lead.id);
    expect(stu.leadChildId).toBe(child.id);
    // Ô của CON
    expect(stu.dateOfBirth?.toISOString().slice(0, 10)).toBe("2016-06-07");
    expect(stu.gender).toBe("MALE");
    expect(stu.school).toBe("TH Lê Văn Tám");
    expect(stu.currentGrade).toBe(5);
    // Ô của PHỤ HUYNH — email gõ ở form chốt THẮNG email trên lead (không phải ô trống).
    expect(stu.parentEmail).toBe("ph-lk1@test.com");
    expect(stu.parentGender).toBe("FEMALE");
    expect(stu.parentDob?.toISOString().slice(0, 10)).toBe("1987-04-05");
    expect(stu.parentFacebookUrl).toBe("https://www.facebook.com/ph.lk");
    // Địa chỉ: form chốt KHÔNG gõ ⇒ lấy CẢ CỤM từ lead.
    expect([stu.city, stu.ward, stu.address]).toEqual(["Thành phố Đà Nẵng", "Phường Hải Châu", "12 Lê Lợi"]);
    // Hành vi cũ giữ nguyên: ghi danh vẫn mang leadChildId của con.
    const enr = await db.enrollment.findFirstOrThrow({ where: { studentId: stu.id } });
    expect(enr.leadChildId).toBe(child.id);
  });

  test("[CV2-LK-01b] địa chỉ GÕ ở form chốt thắng CẢ CỤM của lead (không ghép lẻ)", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const { lead, child } = await seedLeadDayDu(center.id, "0900000042");
    await seedRecordedPayment(lead.id, center.id);
    const actorUser = await seedUser({ email: `sale-lk1b-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale LK1b" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale LK1b" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: "PH LK",
        parentPhone: "0905444002",
        parentCity: "Thành phố Huế",
        idempotencyKey: `lk1b-${uniq()}`,
        students: [
          { leadChildId: child.id, name: "Bé LK", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stu = await db.student.findUniqueOrThrow({ where: { id: res.studentIds[0]! } });
    // Chỉ gõ Tỉnh ⇒ Phường/Số nhà KHÔNG được mượn từ lead (đó là nhà khác).
    expect([stu.city, stu.ward, stu.address]).toEqual(["Thành phố Huế", null, null]);
    // Form chốt bỏ trống email ⇒ ô trống ⇒ điền từ lead.
    expect(stu.parentEmail).toBe("lead-lk@test.com");
  });

  test("[CV2-LK-02] HV DÙNG LẠI đã có lead gốc ⇒ lượt chốt sau KHÔNG đè leadId", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const leadGoc = await seedRegisteredLead(center.id, "0900000043");
    const { lead, child } = await seedLeadDayDu(center.id, "0900000044");
    await seedRecordedPayment(lead.id, center.id);
    const parent = await db.user.create({
      data: { phone: "84905444003", name: "PH cũ", role: "PARENT", roles: ["PARENT"] },
    });
    const cu = await db.student.create({
      data: { name: "Bé LK", parentUserId: parent.id, centerId: center.id, leadId: leadGoc.id },
    });
    const actorUser = await seedUser({ email: `sale-lk2-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale LK2" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale LK2" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: "PH LK",
        parentPhone: "0905444003",
        idempotencyKey: `lk2-${uniq()}`,
        students: [
          { leadChildId: child.id, name: "Bé LK", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.studentIds, "phải DÙNG LẠI hồ sơ cũ (dedupe)").toEqual([cu.id]);
    const stu = await db.student.findUniqueOrThrow({ where: { id: cu.id } });
    expect(stu.leadId, "lead GỐC không được đè").toBe(leadGoc.id);
    expect(stu.leadChildId).toBeNull();
    // HV đã có lead gốc ⇒ lượt chốt sau không điền gì vào hồ sơ.
    expect(stu.school).toBeNull();
    expect(stu.parentFacebookUrl).toBeNull();
  });

  test("[CV2-LK-03] HV DÙNG LẠI chưa nối ⇒ nối + CHỈ điền ô trống, ô đã có giữ nguyên", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const { lead, child } = await seedLeadDayDu(center.id, "0900000045");
    await seedRecordedPayment(lead.id, center.id);
    const parent = await db.user.create({
      data: { phone: "84905444004", name: "PH cũ", role: "PARENT", roles: ["PARENT"] },
    });
    const cu = await db.student.create({
      data: {
        name: "Bé LK",
        parentUserId: parent.id,
        centerId: center.id,
        school: "Trường cũ",
        gender: "FEMALE",
        district: "Hải Châu (cũ)",
      },
    });
    const actorUser = await seedUser({ email: `sale-lk3-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale LK3" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale LK3" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: "PH LK",
        parentPhone: "0905444004",
        idempotencyKey: `lk3-${uniq()}`,
        students: [
          { leadChildId: child.id, name: "Bé LK", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.studentIds).toEqual([cu.id]);
    const stu = await db.student.findUniqueOrThrow({ where: { id: cu.id } });
    expect(stu.leadId).toBe(lead.id);
    expect(stu.leadChildId).toBe(child.id);
    // Ô ĐÃ CÓ — giữ nguyên.
    expect(stu.school).toBe("Trường cũ");
    expect(stu.gender).toBe("FEMALE");
    // Ô TRỐNG — điền.
    expect(stu.currentGrade).toBe(5);
    expect(stu.parentFacebookUrl).toBe("https://www.facebook.com/ph.lk");
    // HV đã có một ô địa chỉ (district cũ) ⇒ KHÔNG điền cụm địa chỉ của lead.
    expect([stu.city, stu.ward, stu.address]).toEqual([null, null, null]);
  });

  test("[CV2-LK-04] con của phiếu KHÁC ⇒ không thành Student.leadChildId, không dùng để điền", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000046");
    await seedRecordedPayment(lead.id, center.id);
    const { child: conLa } = await seedLeadDayDu(center.id, "0900000047");
    const actorUser = await seedUser({ email: `sale-lk4-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale LK4" });

    const res = await convertLeadV2(
      { id: actorUser.id, name: "Sale LK4" },
      {
        leadId: lead.id,
        parentEmail: null,
        parentName: "PH LK",
        parentPhone: "0905444005",
        idempotencyKey: `lk4-${uniq()}`,
        students: [
          { leadChildId: conLa.id, name: "Bé Lạ", courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stu = await db.student.findUniqueOrThrow({ where: { id: res.studentIds[0]! } });
    expect(stu.leadId).toBe(lead.id);
    expect(stu.leadChildId).toBeNull();
    expect(stu.school).toBeNull();
    expect(stu.gender).toBeNull();
  });

  // ── BÉ THỨ HAI của lead ĐÃ chuyển đổi (27/09/2026) ───────────────────────────────
  // Sự cố prod: gộp lead Phương Tuyết xong, bé Tuấn Khang (đã có đơn + tiền) KHÔNG thành
  // học viên được — lead đã chuyển đổi cho bé đầu, mà convert khoá theo `Lead.convertedAt`
  // ⇒ mọi gia đình có bé đầu đã vào học đều không chốt được bé thứ hai. Luật chống trùng mới
  // (gộp phiếu bé thứ hai vào lead đã đăng ký) làm ca này thành ca THƯỜNG.
  async function chotBe(
    leadId: string,
    leadChildId: string,
    name: string,
    course: { id: string },
    cls: { id: string },
    actorId: string,
  ) {
    return convertLeadV2(
      { id: actorId, name: "Sale B2" },
      {
        leadId,
        parentEmail: null,
        parentName: "PH B2",
        parentPhone: "0909000777",
        idempotencyKey: `b2-${uniq()}`,
        students: [
          { leadChildId, name, courseId: course.id, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
        ],
      },
    );
  }

  test("[CV2-B2-01] lead đã chốt bé A ⇒ chốt được bé B thêm SAU; mốc chốt của lead GIỮ NGUYÊN", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000071");
    await seedRecordedPayment(lead.id, center.id);
    const a = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé A" } });
    const sale = await seedUser({ email: `sale-b2-1-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale" });

    expect((await chotBe(lead.id, a.id, "Bé A", course, cls, sale.id)).ok).toBe(true);
    const mocChot = (await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedAt;
    expect(mocChot).not.toBeNull();

    const b = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé B" } });
    await seedRecordedPayment(lead.id, center.id);
    const res = await chotBe(lead.id, b.id, "Bé B", course, cls, sale.id);
    expect(res).toMatchObject({ ok: true });

    expect(await db.student.count()).toBe(2);
    expect(await db.enrollment.count({ where: { leadChildId: b.id } })).toBe(1);
    expect((await db.leadChild.findUniqueOrThrow({ where: { id: b.id } })).closedAt).not.toBeNull();
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedAt).toEqual(mocChot);
  });

  test("[CV2-B2-02] chốt LẠI bé đã là học viên ⇒ từ chối, không đẻ học viên trùng", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000072");
    await seedRecordedPayment(lead.id, center.id);
    const a = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé A" } });
    const sale = await seedUser({ email: `sale-b2-2-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale" });
    expect((await chotBe(lead.id, a.id, "Bé A", course, cls, sale.id)).ok).toBe(true);

    const lai = await chotBe(lead.id, a.id, "Bé A", course, cls, sale.id);
    expect(lai).toMatchObject({ ok: false, error: { code: "ALREADY_CONVERTED" } });
    expect(await db.student.count()).toBe(1);
  });

  test("[CV2-B2-03] lead CŨ: bé có trước lần chốt mà thiếu mốc (dữ liệu trước 26/08) ⇒ KHÔNG coi là chưa chốt", async () => {
    // Mốc chốt theo từng bé (`closedAt`) chỉ có từ 26/08 — bé đã vào học trước đó mang
    // mốc trống. Coi "mốc trống" là "chưa chốt" là mở nút chốt lại cho hàng loạt lead cũ.
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000073");
    await seedRecordedPayment(lead.id, center.id);
    const cu = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé cũ" } });
    await db.lead.update({ where: { id: lead.id }, data: { convertedAt: new Date(Date.now() + 60_000) } });
    const sale = await seedUser({ email: `sale-b2-3-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale" });

    const res = await chotBe(lead.id, cu.id, "Bé cũ", course, cls, sale.id);
    expect(res).toMatchObject({ ok: false, error: { code: "ALREADY_CONVERTED" } });
    expect(await db.student.count()).toBe(0);
  });

  test("[CV2-B2-04] tiền đã gắn cho bé A KHÔNG chạy sang bé B khi chốt bé B", async () => {
    const center = await seedCenter();
    const { course, cls } = await seedCourseClass(center.id);
    const lead = await seedRegisteredLead(center.id, "0900000074");
    const donA = await seedRecordedPayment(lead.id, center.id);
    const a = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé A" } });
    const sale = await seedUser({ email: `sale-b2-4-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale" });
    const ra = await chotBe(lead.id, a.id, "Bé A", course, cls, sale.id);
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    const tienA = await db.payment.findMany({ where: { orderId: donA.id }, select: { id: true, enrollmentId: true } });
    expect(tienA.every((p) => p.enrollmentId === ra.enrollmentIds[0])).toBe(true);

    const b = await db.leadChild.create({ data: { leadId: lead.id, fullName: "Bé B" } });
    const donB = await seedRecordedPayment(lead.id, center.id);
    const rb = await chotBe(lead.id, b.id, "Bé B", course, cls, sale.id);
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;

    const sauA = await db.payment.findMany({ where: { orderId: donA.id }, select: { id: true, enrollmentId: true } });
    expect(sauA).toEqual(tienA);
    const tienB = await db.payment.findMany({ where: { orderId: donB.id }, select: { enrollmentId: true } });
    expect(tienB.every((p) => p.enrollmentId === rb.enrollmentIds[0])).toBe(true);
  });
});
