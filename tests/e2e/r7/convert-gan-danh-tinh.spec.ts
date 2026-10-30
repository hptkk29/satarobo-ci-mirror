/**
 * [CVG] CONVERT LEAD GẮN DANH TÍNH CHO ĐƠN [25/10/2026] — chạy `convertLeadV2` THẬT trên Postgres LOCAL.
 *
 * Gốc rễ (đo PROD 25/10): đơn khoá học lập từ lead ra đời TRƯỚC học viên nên `Order.studentId` ·
 * `OrderItem.studentId` · `OrderItem.enrollmentId` đều NULL, và `convertLeadV2` chưa bao giờ quay lại gắn
 * chúng (nó chỉ gắn TIỀN). Bộ này chứng minh đường convert nay để lại đơn CÓ danh tính — và, quan trọng không
 * kém, rằng nó KHÔNG đoán khi mơ hồ, KHÔNG gắn chéo anh/chị/em, và KHÔNG làm đổi chỗ khoản thu được gắn.
 *
 * Luật thuần: `lib/orders/gan-danh-tinh-dong-don.ts` (có test riêng). Ở đây là bằng chứng ở tầng DB.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { convertLeadV2 } from "../../../lib/crm/convert-lead-v2";
import { ganDanhTinhDongDonCuaLead } from "../../../lib/orders/gan-danh-tinh-dong-don-db";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

async function seedCenter(code = "CS1") {
  return db.center.create({
    data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}-${uniq()}`, address: "x" },
  });
}
async function seedCourseClass(centerId: string, price = 10_000_000) {
  const course = await db.course.create({ data: { name: "Sata 3", slug: `sata3-${uniq()}`, price } });
  const cls = await db.class.create({ data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId } });
  return { course, cls };
}
async function seedLead(centerId: string, phone: string) {
  return db.lead.create({ data: { parentName: "PH Lead", phone, status: "DA_DANG_KY", centerId } });
}
const seedChild = (leadId: string, fullName: string) =>
  db.leadChild.create({ data: { leadId, fullName } });

type DongSeed = { leadChildId: string | null; courseId: string; unit: number; boMetadata?: boolean };
/** Đơn khoá học còn nhận tiền + MỘT khoản RECORDED/PENDING bằng tổng đơn (đúng hình dạng đơn lập từ lead). */
async function seedOrder(
  leadId: string,
  centerId: string,
  dong: DongSeed[],
  over: { status?: "PENDING_PAYMENT" | "CANCELLED"; orderLeadChildId?: string | null } = {},
) {
  const tong = dong.reduce((s, d) => s + d.unit, 0);
  const order = await db.order.create({
    data: {
      code: `ORD-${uniq()}`,
      type: "COURSE",
      status: over.status ?? "PENDING_PAYMENT",
      customerName: "PH Lead",
      customerPhone: "0900000000",
      leadId,
      leadChildId: over.orderLeadChildId ?? null,
      centerId,
      subtotal: tong,
      totalAmount: tong,
      items: {
        create: dong.map((d) => ({
          type: "COURSE_ENROLLMENT" as const,
          itemName: "Sata 3",
          quantity: 1,
          unitPrice: d.unit,
          totalPrice: d.unit,
          metadata: d.boMetadata
            ? undefined
            : { courseId: d.courseId, ...(d.leadChildId ? { leadChildId: d.leadChildId } : {}) },
        })),
      },
    },
    select: { id: true, items: { select: { id: true }, orderBy: { createdAt: "asc" } } },
  });
  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      amount: tong,
      method: "cash",
      paidDate: new Date(),
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      centerId,
    },
    select: { id: true },
  });
  return { orderId: order.id, itemIds: order.items.map((i) => i.id), paymentId: payment.id, tong };
}

async function actor() {
  const u = await seedUser({ email: `sale-cgd-${uniq()}@test.com`, role: "SALES_CSM", name: "Sale CGD" });
  return { id: u.id, name: "Sale CGD" };
}

const hocVien = (name: string, courseId: string, classId: string, leadChildId?: string, listPrice = 10_000_000) => ({
  name,
  courseId,
  listPrice,
  classId,
  consentMedia: false,
  ...(leadChildId ? { leadChildId } : {}),
});

const convertInput = (leadId: string, students: ReturnType<typeof hocVien>[], phone = "0905123456") => ({
  leadId,
  parentEmail: `ph-${uniq()}@test.com`,
  parentName: "PH Lead",
  parentPhone: phone,
  idempotencyKey: `cgd-${uniq()}`,
  students,
});

test.describe("[CVG] convert lead gắn danh tính cho đơn", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[CVG-01] một bé, một đơn: đơn + dòng đơn có đủ học viên/ghi danh; tiền, giá, Receipt KHÔNG đổi", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000101");
    const be = await seedChild(lead.id, "Bé Một");
    const o = await seedOrder(lead.id, cs.id, [{ leadChildId: be.id, courseId: course.id, unit: 10_000_000 }]);

    const res = await convertLeadV2(await actor(), convertInput(lead.id, [hocVien("Bé Một", course.id, cls.id, be.id)]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const don = await db.order.findUnique({ where: { id: o.orderId }, select: { studentId: true } });
    const dong = await db.orderItem.findUnique({ where: { id: o.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(don?.studentId).toBe(res.studentIds[0]);
    expect(dong).toEqual({ studentId: res.studentIds[0], enrollmentId: res.enrollmentIds[0] });

    // Tiền: KHÔNG đổi hành vi — vẫn đúng một khoản, nguyên số tiền, gắn đúng ghi danh (bất biến có sẵn của convert).
    const tien = await db.payment.findMany({ where: { orderId: o.orderId }, select: { id: true, amount: true, enrollmentId: true, accountantStatus: true } });
    expect(tien).toEqual([{ id: o.paymentId, amount: o.tong, enrollmentId: res.enrollmentIds[0], accountantStatus: "PENDING" }]);
    // Giá ghi danh vẫn do luật giá có sẵn quyết (giá dòng đơn), và KHÔNG sinh Receipt.
    const gd = await db.enrollment.findUnique({ where: { id: res.enrollmentIds[0]! }, select: { listPrice: true, finalPrice: true } });
    expect(gd).toEqual({ listPrice: 10_000_000, finalPrice: 10_000_000 });
    expect(await db.receipt.count()).toBe(0);
  });

  test("[CVG-02] ANH/CHỊ/EM cùng phụ huynh, cùng khoá, hai đơn: mỗi đơn về ĐÚNG bé; Payment cũng về đúng bé", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000102");
    const beA = await seedChild(lead.id, "Bé Anh");
    const beB = await seedChild(lead.id, "Bé Em");
    const oA = await seedOrder(lead.id, cs.id, [{ leadChildId: beA.id, courseId: course.id, unit: 10_000_000 }]);
    const oB = await seedOrder(lead.id, cs.id, [{ leadChildId: beB.id, courseId: course.id, unit: 9_000_000 }]);

    const res = await convertLeadV2(
      await actor(),
      convertInput(lead.id, [
        hocVien("Bé Anh", course.id, cls.id, beA.id),
        hocVien("Bé Em", course.id, cls.id, beB.id, 9_000_000),
      ]),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [stA, stB] = res.studentIds;
    const [enA, enB] = res.enrollmentIds;

    const dA = await db.orderItem.findUnique({ where: { id: oA.itemIds[0]! }, select: { studentId: true, enrollmentId: true, order: { select: { studentId: true } } } });
    const dB = await db.orderItem.findUnique({ where: { id: oB.itemIds[0]! }, select: { studentId: true, enrollmentId: true, order: { select: { studentId: true } } } });
    expect(dA).toEqual({ studentId: stA, enrollmentId: enA, order: { studentId: stA } });
    expect(dB).toEqual({ studentId: stB, enrollmentId: enB, order: { studentId: stB } });
    // Tiền không gắn chéo.
    expect((await db.payment.findUnique({ where: { id: oA.paymentId }, select: { enrollmentId: true } }))?.enrollmentId).toBe(enA);
    expect((await db.payment.findUnique({ where: { id: oB.paymentId }, select: { enrollmentId: true } }))?.enrollmentId).toBe(enB);
  });

  test("[CVG-03] MỘT đơn hai dòng hai bé: mỗi dòng về đúng bé, Order.studentId để NULL, tiền vẫn bất biến tổng", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000103");
    const beA = await seedChild(lead.id, "Bé Anh");
    const beB = await seedChild(lead.id, "Bé Em");
    const o = await seedOrder(lead.id, cs.id, [
      { leadChildId: beA.id, courseId: course.id, unit: 10_000_000 },
      { leadChildId: beB.id, courseId: course.id, unit: 10_000_000 },
    ]);

    const res = await convertLeadV2(
      await actor(),
      convertInput(lead.id, [
        hocVien("Bé Anh", course.id, cls.id, beA.id),
        hocVien("Bé Em", course.id, cls.id, beB.id),
      ]),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const dong = await db.orderItem.findMany({ where: { orderId: o.orderId }, select: { id: true, studentId: true, enrollmentId: true, metadata: true } });
    for (const d of dong) {
      const con = (d.metadata as { leadChildId?: string }).leadChildId;
      const i = con === beA.id ? 0 : 1;
      expect({ studentId: d.studentId, enrollmentId: d.enrollmentId }, `dòng của ${con}`).toEqual({
        studentId: res.studentIds[i],
        enrollmentId: res.enrollmentIds[i],
      });
    }
    expect((await db.order.findUnique({ where: { id: o.orderId }, select: { studentId: true } }))?.studentId).toBeNull();
    const tien = await db.payment.findMany({ where: { orderId: o.orderId }, select: { amount: true, enrollmentId: true } });
    expect(tien.reduce((s, p) => s + p.amount, 0)).toBe(o.tong);
    expect(tien.every((p) => p.enrollmentId && res.enrollmentIds.includes(p.enrollmentId))).toBe(true);
  });

  test("[CVG-04] ghi danh KHÔNG duy nhất (bé đã có ghi danh sống cùng khoá từ trước) ⇒ FAIL CLOSED: không gắn, ghi audit, convert vẫn thành công", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000104");
    const be = await seedChild(lead.id, "Bé Một");
    // Ghi danh sống có sẵn của CHÍNH bé này, cùng khoá, cùng cơ sở (hồ sơ học viên khác tên để không bị dedupe).
    const cu = await db.student.create({ data: { name: "Hồ sơ cũ", studentCode: `HS-${uniq()}`, centerId: cs.id } });
    await db.enrollment.create({
      data: { studentId: cu.id, classId: cls.id, courseId: course.id, centerId: cs.id, leadChildId: be.id, status: "ACTIVE" },
    });
    const o = await seedOrder(lead.id, cs.id, [{ leadChildId: be.id, courseId: course.id, unit: 10_000_000 }]);

    const res = await convertLeadV2(await actor(), convertInput(lead.id, [hocVien("Bé Một", course.id, cls.id, be.id)]));
    expect(res.ok).toBe(true);

    const dong = await db.orderItem.findUnique({ where: { id: o.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(dong).toEqual({ studentId: null, enrollmentId: null });
    expect((await db.order.findUnique({ where: { id: o.orderId }, select: { studentId: true } }))?.studentId).toBeNull();
    const vet = await db.auditLog.findMany({ where: { action: "GAN_DANH_TINH_DON_BO_QUA", entityId: lead.id }, select: { newValues: true } });
    expect(vet).toHaveLength(1);
    expect(JSON.stringify(vet[0]!.newValues)).toContain("NHIEU_GHI_DANH");
  });

  test("[CVG-05] bé trên dòng đơn KHÔNG thuộc lead này (metadata do client gửi) ⇒ không gắn vào ghi danh của bé nhà khác", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000105");
    const beNhaKhac = await db.leadChild.create({
      data: { fullName: "Bé nhà khác", lead: { create: { parentName: "PH Khác", phone: "0900000999", status: "DA_DANG_KY", centerId: cs.id } } },
      select: { id: true },
    });
    const stKhac = await db.student.create({ data: { name: "Bé nhà khác", studentCode: `HS-${uniq()}`, centerId: cs.id } });
    const enKhac = await db.enrollment.create({
      data: { studentId: stKhac.id, classId: cls.id, courseId: course.id, centerId: cs.id, leadChildId: beNhaKhac.id, status: "ACTIVE" },
    });
    const be = await seedChild(lead.id, "Bé Một");
    // Dòng đơn của lead này nhưng metadata trỏ bé nhà khác.
    const o = await seedOrder(lead.id, cs.id, [{ leadChildId: beNhaKhac.id, courseId: course.id, unit: 10_000_000 }]);

    const res = await convertLeadV2(await actor(), convertInput(lead.id, [hocVien("Bé Một", course.id, cls.id, be.id)]));
    expect(res.ok).toBe(true);
    const dong = await db.orderItem.findUnique({ where: { id: o.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(dong).toEqual({ studentId: null, enrollmentId: null });
    expect(await db.orderItem.count({ where: { enrollmentId: enKhac.id } })).toBe(0);
  });

  test("[CVG-06] KHÔNG ĐÈ liên kết có sẵn; đơn đã HUỶ không bị đụng", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000106");
    const be = await seedChild(lead.id, "Bé Một");
    const huy = await seedOrder(lead.id, cs.id, [{ leadChildId: be.id, courseId: course.id, unit: 10_000_000 }], { status: "CANCELLED" });
    const coSan = await seedOrder(lead.id, cs.id, [{ leadChildId: be.id, courseId: course.id, unit: 10_000_000 }]);
    // SĐT phụ huynh khớp SĐT đơn — nếu không, cổng "đơn nhiễm dữ liệu" (bước A3) chặn cả lượt convert.
    const stLa = await db.student.create({
      data: { name: "Học viên lạ", studentCode: `HS-${uniq()}`, centerId: cs.id, parentPhone: "84900000000" },
    });
    await db.orderItem.update({ where: { id: coSan.itemIds[0]! }, data: { studentId: stLa.id } });

    const res = await convertLeadV2(await actor(), convertInput(lead.id, [hocVien("Bé Một", course.id, cls.id, be.id)]));
    expect(res.ok).toBe(true);

    const huyDong = await db.orderItem.findUnique({ where: { id: huy.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(huyDong).toEqual({ studentId: null, enrollmentId: null });
    const sanDong = await db.orderItem.findUnique({ where: { id: coSan.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(sanDong).toEqual({ studentId: stLa.id, enrollmentId: null }); // giữ nguyên học viên có sẵn, không gắn ghi danh mâu thuẫn
  });

  test("[CVG-07] IDEMPOTENT: chạy lại bước gắn không đổi byte nào", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000107");
    const be = await seedChild(lead.id, "Bé Một");
    const o = await seedOrder(lead.id, cs.id, [{ leadChildId: be.id, courseId: course.id, unit: 10_000_000 }]);
    const a = await actor();
    const res = await convertLeadV2(a, convertInput(lead.id, [hocVien("Bé Một", course.id, cls.id, be.id)]));
    expect(res.ok).toBe(true);

    const truoc = await db.orderItem.findUnique({ where: { id: o.itemIds[0]! } });
    const donTruoc = await db.order.findUnique({ where: { id: o.orderId } });
    const kq = await db.$transaction((tx) => ganDanhTinhDongDonCuaLead(tx, { leadId: lead.id, actor: a }));
    expect(kq).toEqual({ dong: 0, don: 0, boQua: [] });
    expect(await db.orderItem.findUnique({ where: { id: o.itemIds[0]! } })).toEqual(truoc);
    expect(await db.order.findUnique({ where: { id: o.orderId } })).toEqual(donTruoc);
  });

  test("[CVG-08] đơn kiểu backfill (dòng KHÔNG có metadata, `Order.leadChildId` + một dòng) vẫn gắn được khi bé có đúng một ghi danh", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000108");
    const be = await seedChild(lead.id, "Bé Một");
    const o = await seedOrder(lead.id, cs.id, [{ leadChildId: null, courseId: course.id, unit: 10_000_000, boMetadata: true }], {
      orderLeadChildId: be.id,
    });
    const res = await convertLeadV2(await actor(), convertInput(lead.id, [hocVien("Bé Một", course.id, cls.id, be.id)]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const dong = await db.orderItem.findUnique({ where: { id: o.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(dong).toEqual({ studentId: res.studentIds[0], enrollmentId: res.enrollmentIds[0] });
  });

  test("[CVG-09] dòng KHÔNG có cầu nối bé (đơn walk-in) ⇒ không đoán theo tên/thứ tự: để NULL", async () => {
    const cs = await seedCenter();
    const { course, cls } = await seedCourseClass(cs.id);
    const lead = await seedLead(cs.id, "0900000109");
    const o = await seedOrder(lead.id, cs.id, [{ leadChildId: null, courseId: course.id, unit: 10_000_000 }]);
    const res = await convertLeadV2(await actor(), convertInput(lead.id, [hocVien("Bé Vãng Lai", course.id, cls.id)]));
    expect(res.ok).toBe(true);
    const dong = await db.orderItem.findUnique({ where: { id: o.itemIds[0]! }, select: { studentId: true, enrollmentId: true } });
    expect(dong).toEqual({ studentId: null, enrollmentId: null });
  });
});
