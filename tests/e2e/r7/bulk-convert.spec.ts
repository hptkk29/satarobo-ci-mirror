/**
 * BULK-CONVERT — chốt hàng loạt lead "đã đăng ký" (nhập liệu ban đầu CS1/CS2).
 * Postgres LOCAL (.env.test). Test service-level (mẫu import-registered-isolation):
 * gọi thẳng convertOneLeadBackfill / ensureBackfillOrderPayment, không dựng HTTP.
 *
 * Phủ: happy path có tiền backfill (Order+Payment RECORDED lùi ngày, link vào
 * enrollment), nhánh không tiền (allowNoPayment + audit BACKFILL), idempotent
 * re-run, SĐT không canonical, lớp khác cơ sở, lead đã có khoản RECORDED.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import {
  convertOneLeadBackfill,
  bulkConvertIdempotencyKey,
  BACKFILL_PAYMENT_MARKER,
} from "../../../lib/crm/bulk-convert";
import { convertLeadV2 } from "../../../lib/crm/convert-lead-v2";

test.describe("[BULK] Chốt hàng loạt lead đã đăng ký", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  /**
   * SĐT test 10 chữ số.
   *
   * ⚠️ Bản cũ ghép thẳng phần dư `Date.now() % 100000000` vào sau "09" để lấy 8 chữ
   * số cuối của mốc thời gian. NHƯNG số nguyên JS nuốt số 0 đứng đầu: mốc kết thúc
   * bằng 01846000 cho ra `1846000` ⇒ SĐT chỉ còn 9 chữ số ⇒ `canonicalPhone` từ
   * chối ⇒ convert trả `PHONE_INVALID` ⇒ `res.ok` false.
   *
   * Hỏng ~10% số lần chạy và TÙY GIỜ CHẠY CI chứ không tùy code, nên cùng một
   * commit lúc xanh lúc đỏ (4ee0fb2a: 02:14 xanh, 09:11 đỏ). `padStart` giữ đủ 8
   * chữ số nên độ dài luôn là 10.
   */
  const uniqPhone = () => `09${String(Date.now() % 100000000).padStart(8, "0")}`;

  async function seedCenter(code = "CS1") {
    return db.center.create({
      data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}-${uniq()}`, address: "x" },
    });
  }

  async function seedCourseClass(centerId: string, price = 5_000_000) {
    const course = await db.course.create({
      data: { name: `Sata ${uniq()}`, slug: `sata-${uniq()}`, price },
    });
    const cls = await db.class.create({
      data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId },
    });
    return { course, cls };
  }

  async function seedRegisteredLeadWithChildren(
    centerId: string,
    phone: string,
    childNames: string[],
  ) {
    const lead = await db.lead.create({
      data: { parentName: "PH Bulk", phone, status: "DA_DANG_KY", centerId },
    });
    const children = [];
    for (const name of childNames) {
      children.push(
        await db.leadChild.create({ data: { leadId: lead.id, fullName: name } }),
      );
    }
    return { lead, children };
  }

  async function seedActor() {
    const u = await seedUser({
      email: `qlcs-${uniq()}@test.com`,
      role: "CENTER_MANAGER",
      name: "QL Bulk",
    });
    return { id: u.id, name: "QL Bulk" };
  }

  test("[BULK-01] có tiền backfill → Order+Payment RECORDED lùi ngày, 2 HV vào lớp, TK PH chờ kích hoạt, khoản link vào enrollment", async () => {
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id, 4_000_000);
    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "0905000001", [
      "Bé Một",
      "Bé Hai",
    ]);
    const actor = await seedActor();
    const paidDate = new Date("2026-05-15T05:00:00Z"); // khách đóng từ 15/05 — trước khi có hệ thống

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: children.map((c) => ({
        leadChildId: c.id,
        name: c.fullName,
        classId: cls.id,
        consentMedia: true,
      })),
      paid: { amount: 8_000_000, paidDate },
    });

    expect(res.ok).toBe(true);
    expect(res.studentIds).toHaveLength(2);
    expect(res.enrollmentIds).toHaveLength(2);

    // Lead đã CHỐT. GĐ5 gộp ENROLLED vào DA_DANG_KY, mà lead ở đây được gieo sẵn
    // DA_DANG_KY ⇒ riêng status không còn chứng minh được điều gì. Mốc "đã chốt"
    // thật nằm ở `convertedAt` (chỉ chính lượt convert ghi), nên phải soi thêm nó.
    const leadAfter = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(leadAfter.status).toBe("DA_DANG_KY");
    expect(leadAfter.convertedAt).not.toBeNull();

    // TK phụ huynh: khoá SĐT canonical, chờ kích hoạt.
    const parent = await db.user.findUnique({ where: { phone: "84905000001" } });
    expect(parent).not.toBeNull();
    expect(parent!.role).toBe("PARENT");
    expect(parent!.accountStatus).toBe("PENDING_ACTIVATION");

    // Order backfill: CONFIRMED, đúng tổng niêm yết, paidAt lùi ngày.
    const order = await db.order.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(order.status).toBe("CONFIRMED");
    expect(order.totalAmount).toBe(8_000_000);
    expect(order.paidAt?.toISOString()).toBe(paidDate.toISOString());

    // Payment RECORDED mang marker, paidDate lùi ngày, và ĐÃ link vào enrollment
    // (FIN-01 chia theo finalPrice — 2 ghi danh bằng giá → 2 khoản 4tr).
    const payments = await db.payment.findMany({ where: { orderId: order.id } });
    expect(payments.length).toBe(2); // khoản gốc + khoản tách
    expect(payments.every((p) => p.saleStatus === "RECORDED")).toBe(true);
    expect(payments.every((p) => p.enrollmentId !== null)).toBe(true);
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(8_000_000);
    expect(payments.some((p) => (p.note ?? "").includes(BACKFILL_PAYMENT_MARKER))).toBe(true);
    expect(payments.every((p) => p.paidDate.toISOString() === paidDate.toISOString())).toBe(true);

    // Enrollment vào đúng lớp + đúng cơ sở; consent ảnh đã ghi.
    const enrollments = await db.enrollment.findMany({ where: { id: { in: res.enrollmentIds! } } });
    expect(enrollments.every((e) => e.classId === cls.id && e.centerId === center.id)).toBe(true);
    expect(await db.studentConsent.count({ where: { status: "GRANTED" } })).toBe(2);
  });

  test("[BULK-02] không nhập tiền → vẫn chốt được (allowNoPayment), KHÔNG bịa khoản thu, audit mang lý do BACKFILL", async () => {
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id);
    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "0905000002", ["Bé Ba"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Ba", classId: cls.id, consentMedia: false }],
      paid: null,
    });

    expect(res.ok).toBe(true);
    expect(await db.payment.count()).toBe(0);
    expect(await db.order.count()).toBe(0);

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Lead", entityId: lead.id, action: "STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason ?? "").toContain("BACKFILL_IMPORT");
  });

  test("[BULK-03] chạy lại cùng payload → idempotent (deduped, không nhân đôi HV/khoản)", async () => {
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id);
    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "0905000003", ["Bé Tư"]);
    const actor = await seedActor();
    const input = {
      leadId: lead.id,
      students: [
        { leadChildId: children[0]!.id, name: "Bé Tư", classId: cls.id, consentMedia: false },
      ],
      paid: { amount: 5_000_000, paidDate: new Date("2026-06-01T05:00:00Z") },
    };

    const first = await convertOneLeadBackfill(actor, input);
    expect(first.ok).toBe(true);

    const second = await convertOneLeadBackfill(actor, input);
    // Lượt 2: lead đã có `convertedAt` → chặn ngay từ guard (không đụng DB ghi).
    // GĐ5 đổi mốc chặn từ status ENROLLED sang `convertedAt` vì status "đã chốt" và
    // "đã đăng ký" nay là CÙNG một giá trị DA_DANG_KY.
    expect(second.ok).toBe(false);
    expect(second.code).toBe("ALREADY_CONVERTED");

    expect(await db.student.count()).toBe(1);
    expect(await db.enrollment.count()).toBe(1);
    // Payment: chỉ 1 khoản backfill (marker idempotent).
    expect(
      await db.payment.count({ where: { note: { contains: BACKFILL_PAYMENT_MARKER } } }),
    ).toBe(1);
  });

  test("[BULK-04] SĐT lead không canonical hoá được (số bàn) → PHONE_INVALID, không ghi gì", async () => {
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id);
    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "02363123456", ["Bé Năm"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Năm", classId: cls.id, consentMedia: false }],
      paid: null,
    });

    expect(res.ok).toBe(false);
    expect(res.code).toBe("PHONE_INVALID");
    expect(await db.student.count()).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("DA_DANG_KY");
  });

  test("[BULK-05] lớp khác cơ sở với lead → CLASS_WRONG_CENTER (chặn ghi danh chéo cơ sở)", async () => {
    const cs1 = await seedCenter("CS1");
    const cs2 = await seedCenter("CS2");
    const { cls: clsCs2 } = await seedCourseClass(cs2.id);
    const { lead, children } = await seedRegisteredLeadWithChildren(cs1.id, "0905000005", ["Bé Sáu"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Sáu", classId: clsCs2.id, consentMedia: false }],
      paid: null,
    });

    expect(res.ok).toBe(false);
    expect(res.code).toBe("CLASS_WRONG_CENTER");
    expect(await db.enrollment.count()).toBe(0);
  });

  test("[BULK-06] lead ĐÃ có khoản RECORDED + vẫn nhập tiền → cảnh báo, KHÔNG ghi khoản đôi", async () => {
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id);
    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "0905000006", ["Bé Bảy"]);
    const actor = await seedActor();

    // Khoản RECORDED có sẵn (Sale đã ghi nhận trong hệ thống).
    const order = await db.order.create({
      data: {
        code: `ORD-${uniq()}`,
        type: "COURSE",
        customerName: "PH Bulk",
        customerPhone: "0905000006",
        leadId: lead.id,
        centerId: center.id,
      },
    });
    await db.payment.create({
      data: {
        orderId: order.id,
        amount: 2_000_000,
        method: "cash",
        paidDate: new Date(),
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        centerId: center.id,
      },
    });

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Bảy", classId: cls.id, consentMedia: false }],
      paid: { amount: 5_000_000, paidDate: new Date() },
    });

    expect(res.ok).toBe(true);
    expect(res.warning).toBeTruthy();
    // Không có khoản backfill mới — chỉ khoản RECORDED cũ (đã được link vào enrollment).
    expect(await db.payment.count({ where: { note: { contains: BACKFILL_PAYMENT_MARKER } } })).toBe(0);
    expect(await db.payment.count()).toBe(1);
  });

  test("[BULK-07] tiền backfill NẰM TRONG tx convert — convert vỡ giữa chừng là Order/Payment rollback theo (không có khoản ma)", async () => {
    // Review 02/08: bản đầu tạo Order CONFIRMED + Payment RECORDED TRƯỚC rồi mới
    // convert — convert fail để lại khoản tiền treo vĩnh viễn. Nay tiền tạo trong
    // chính transaction convert. Ca này ép fail Ở TRONG tx (FK classId không tồn
    // tại — gọi thẳng convertLeadV2, lách validate của service) và khẳng định
    // KHÔNG còn Order/Payment/Student nào sót lại.
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id);
    const { lead } = await seedRegisteredLeadWithChildren(center.id, "0905000007", ["Bé Tám"]);
    const actor = await seedActor();

    await expect(
      convertLeadV2(actor, {
        leadId: lead.id,
        parentEmail: null,
        parentName: "PH Bulk",
        parentPhone: "84905000007",
        idempotencyKey: bulkConvertIdempotencyKey(lead.id, [
          { name: "Bé Tám", classId: cls.id },
          { name: "Bé Chín", classId: "class-khong-ton-tai" },
        ]),
        students: [
          { name: "Bé Tám", courseId: cls.courseId, listPrice: 5_000_000, classId: cls.id, consentMedia: false },
          { name: "Bé Chín", courseId: cls.courseId, listPrice: 5_000_000, classId: "class-khong-ton-tai", consentMedia: false },
        ],
        backfillPayment: {
          amount: 10_000_000,
          paidDate: new Date("2026-04-01T05:00:00Z"),
          items: [{ itemName: "Sata X — Bé Tám", unitPrice: 5_000_000 }],
        },
      }),
    ).rejects.toThrow();

    // Rollback SẠCH: không tiền ma, không học viên mồ côi, lead còn nguyên DA_DANG_KY.
    expect(await db.order.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect(await db.student.count()).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("DA_DANG_KY");
  });

  test("[BULK-09] lead gắn HỘI SỞ → LEAD_HEAD_OFFICE, KHÔNG tạo học viên nào", async () => {
    // Chủ dự án chốt 04/08: HO là cơ quan đầu não, KHÔNG phải nơi dạy học.
    // Học viên chỉ thuộc cơ sở dạy học (CS1/CS2/…), không bao giờ thuộc HO.
    const ho = await db.center.create({
      data: { code: `HO${uniq()}`, name: "Hội sở", slug: `ho-${uniq()}`, address: "x" },
    });
    const cs1 = await seedCenter();
    // Cây OrgUnit: CHỈ cs1 là type=CENTER ⇒ ho là cơ sở không nhận học viên.
    const root = await db.orgUnit.create({
      data: { code: `ROOT${uniq()}`, name: "Sata", type: "ROOT" },
    });
    await db.orgUnit.create({
      data: { code: `HOU${uniq()}`, name: "Hội sở", type: "HO", parentId: root.id },
    });
    await db.orgUnit.create({
      data: { code: `C${uniq()}`, name: "CS1", type: "CENTER", parentId: root.id, centerId: cs1.id },
    });

    const { cls } = await seedCourseClass(cs1.id);
    const { lead, children } = await seedRegisteredLeadWithChildren(ho.id, uniqPhone(), ["Bé HO"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé HO", classId: cls.id, consentMedia: false }],
      paid: null,
    });

    expect(res.ok).toBe(false);
    expect(res.code).toBe("LEAD_HEAD_OFFICE");
    expect(await db.student.count({ where: { name: "Bé HO" } })).toBe(0);
  });

  test("[BULK-10] có khuyến mãi → đơn ghi subtotal/discountAmount/totalAmount đúng, công nợ trừ đủ", async () => {
    const cs1 = await seedCenter();
    const { cls } = await seedCourseClass(cs1.id, 10_000_000);
    const { lead, children } = await seedRegisteredLeadWithChildren(cs1.id, uniqPhone(), ["Bé Giảm"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [
        {
          leadChildId: children[0]!.id,
          name: "Bé Giảm",
          classId: cls.id,
          consentMedia: false,
          discount: { type: "PERCENT", value: 10 }, // 10% của 10tr = 1tr
        },
      ],
      discountReason: "Con quý đối tác",
      paid: { amount: 9_000_000, paidDate: new Date("2026-06-01"), note: null },
    });
    expect(res.ok).toBe(true);

    const order = await db.order.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(order.subtotal).toBe(10_000_000);
    expect(order.discountAmount).toBe(1_000_000);
    expect(order.totalAmount).toBe(9_000_000); // đã trừ khuyến mãi
    expect(order.discountReason).toBe("Con quý đối tác");
    // Đóng đủ phần phải nộp ⇒ không còn nợ.
    const paid = await db.payment.aggregate({
      where: { orderId: order.id, deletedAt: null },
      _sum: { amount: true },
    });
    expect(paid._sum.amount).toBe(9_000_000);
    expect(order.totalAmount - (paid._sum.amount ?? 0)).toBe(0);

    // Enrollment phản ánh đúng giá sau giảm.
    const en = await db.enrollment.findFirstOrThrow({ where: { classId: cls.id } });
    expect(en.finalPrice).toBe(9_000_000);
  });

  test("[BULK-11] tick 2 đợt + có hạn → dựng kế hoạch 2 đợt; phiếu thu đợt 1 bị HUỶ (không đòi lại tiền đã đóng)", async () => {
    const cs1 = await seedCenter();
    const { cls } = await seedCourseClass(cs1.id, 10_000_000);
    const { lead, children } = await seedRegisteredLeadWithChildren(cs1.id, uniqPhone(), ["Bé 2 Đợt"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé 2 Đợt", classId: cls.id, consentMedia: false }],
      paid: { amount: 5_000_000, paidDate: new Date("2026-06-01"), note: null },
      dueDate2: new Date("2026-09-15"),
    });
    expect(res.ok).toBe(true);

    const order = await db.order.findFirstOrThrow({ where: { leadId: lead.id } });
    const dots = await db.orderInstallment.findMany({
      where: { orderId: order.id },
      orderBy: { soDot: "asc" },
    });
    expect(dots.map((d) => [d.soDot, d.amount, d.status])).toEqual([
      [1, 5_000_000, "PAID"],
      [2, 5_000_000, "PENDING"],
    ]);
    expect(dots[1]!.dueDate?.toISOString().slice(0, 10)).toBe("2026-09-15");
    // Kế hoạch backfill = đã thoả thuận từ trước ⇒ duyệt sẵn, không bắt duyệt lại.
    expect(order.installmentApprovalStatus).toBe("APPROVED");
    // Còn nợ ⇒ đơn KHÔNG được coi là đã thu xong.
    expect(order.paidAt).toBeNull();

    const reqs = await db.paymentRequest.findMany({
      where: { orderId: order.id },
      orderBy: { installmentNo: "asc" },
    });
    const dot1 = reqs.find((r) => r.installmentNo === 1)!;
    const dot2 = reqs.find((r) => r.installmentNo === 2)!;
    // ⚠️ Bất biến quan trọng: tiền đợt 1 đã thu NGOÀI hệ thống nên phiếu đợt 1 phải
    // VOID — để nguyên "chờ thu" là sale xuất QR đòi lại khoản khách đã đóng.
    expect(dot1.status).toBe("VOID");
    expect(dot2.status).toBe("PENDING");
    expect(dot2.amountDue).toBe(5_000_000);
    expect(dot2.matchKey).toContain("D2");
  });

  test("[BULK-12] tick 2 đợt nhưng KHÔNG có hạn → không dựng kế hoạch, đơn vẫn đúng tiền", async () => {
    const cs1 = await seedCenter();
    const { cls } = await seedCourseClass(cs1.id, 10_000_000);
    const { lead, children } = await seedRegisteredLeadWithChildren(cs1.id, uniqPhone(), ["Bé Không Hạn"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Không Hạn", classId: cls.id, consentMedia: false }],
      paid: { amount: 5_000_000, paidDate: new Date("2026-06-01"), note: null },
      dueDate2: null,
    });
    expect(res.ok).toBe(true);
    const order = await db.order.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(await db.orderInstallment.count({ where: { orderId: order.id } })).toBe(0);
    expect(order.totalAmount).toBe(10_000_000);
  });

  test("[BULK-08] khoá học chưa cấu hình giá (null/0) → COURSE_NO_PRICE, không chốt", async () => {
    const center = await seedCenter();
    const course = await db.course.create({ data: { name: "Sata rỗng giá", slug: `sata-nogia-${uniq()}` } });
    const cls = await db.class.create({ data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId: center.id } });
    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "0905000008", ["Bé Mười"]);
    const actor = await seedActor();

    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Mười", classId: cls.id, consentMedia: false }],
      paid: null,
    });

    expect(res.ok).toBe(false);
    expect(res.code).toBe("COURSE_NO_PRICE");
    expect(await db.enrollment.count()).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("DA_DANG_KY");
  });

  test("[BULK-09] consent ảnh đã THU HỒI của học viên dedupe KHÔNG bị lật lại khi chốt", async () => {
    const center = await seedCenter();
    const { cls } = await seedCourseClass(center.id);
    const actor = await seedActor();

    // Học viên cũ cùng phụ huynh (dedupe theo tên + parentUserId), consent REVOKED.
    const parent = await db.user.create({
      data: { phone: "84905000009", name: "PH Cũ", role: "PARENT", roles: ["PARENT"], centerId: center.id },
    });
    const student = await db.student.create({
      data: {
        name: "Bé Cũ",
        studentCode: `CS1-26-${uniq().slice(0, 6).toUpperCase()}`,
        parentUserId: parent.id,
        centerId: center.id,
        parentName: "PH Cũ",
        parentPhone: "84905000009",
      },
    });
    await db.studentConsent.create({
      data: { studentId: student.id, type: "CLASS_MEDIA", status: "REVOKED", revokedAt: new Date() },
    });

    const { lead, children } = await seedRegisteredLeadWithChildren(center.id, "0905000009", ["Bé Cũ"]);
    const res = await convertOneLeadBackfill(actor, {
      leadId: lead.id,
      students: [{ leadChildId: children[0]!.id, name: "Bé Cũ", classId: cls.id, consentMedia: true }],
      paid: null,
    });

    expect(res.ok).toBe(true);
    expect(res.studentIds).toEqual([student.id]); // dedupe dùng lại hồ sơ cũ
    const consent = await db.studentConsent.findUniqueOrThrow({
      where: { studentId_type: { studentId: student.id, type: "CLASS_MEDIA" } },
    });
    expect(consent.status).toBe("REVOKED"); // tick ở bulk KHÔNG phải re-grant tường minh
  });
});
