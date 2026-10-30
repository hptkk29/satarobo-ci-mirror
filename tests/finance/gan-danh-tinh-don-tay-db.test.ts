// tests/finance/gan-danh-tinh-don-tay-db.test.ts — [GDMDB-*] «gắn danh tính cho dòng đơn» ở HAI đường ngoài convert, trên Postgres THẬT:
//   (1) `ganDanhTinhDonMoiTao`        — đơn lập TAY cho học viên ĐÃ có ghi danh (gia hạn · anh/chị/em · mua thêm);
//   (2) `ganDongDonMoCoiChoGhiDanh`   — ghi danh sinh SAU đơn (Sale lập đơn trước, giáo vụ xếp lớp sau).
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/gan-danh-tinh-don-tay-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Fixture tiền tố `GDMDB_`; KHÔNG `resetDb()`; dữ liệu tổng hợp (không tên/SĐT thật).
//
// Ánh xạ yêu cầu owner (26/10/2026, mục IX) → ca:
//   ghi danh có sẵn ⇒ [01]   |   ghi danh mới (chưa có) ⇒ [02] [12]   |   anh/chị/em ⇒ [03] [15]   |   nhiều dòng ⇒ [03] [13]   |   ghi danh mơ hồ ⇒ fail-closed ⇒ [04]
//   renewal ⇒ [05]   |   Payment/giá/ghi danh KHÔNG đổi ⇒ [10]   |   idempotent ⇒ [08]   |   không đè ⇒ [09]   |   hai lưới chống chiếm ghi danh của đơn cũ ⇒ [06] [07]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ganDanhTinhDonMoiTao, ganDongDonMoCoiChoGhiDanh } from "@/lib/orders/gan-danh-tinh-don-tay-db";

if (!RUN_DB_TESTS) console.warn(`[GDMDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "GDMDB_";
const CS1 = `${P}cs1`;
const CS2 = `${P}cs2`;
const K3 = `${P}k3`;
const K4 = `${P}k4`;
const L3 = `${P}l3`;
const L3B = `${P}l3b`;
const L4 = `${P}l4`;
const ACTOR = { id: null, name: "GDMDB" } as const;
const id = (k: string) => `${P}${k}`;
let dem = 0;

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }] } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { in: [L3, L3B, L4] } } });
  await db.course.deleteMany({ where: { id: { in: [K3, K4] } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function nen() {
  await don();
  dem = 0;
  await db.center.create({ data: { id: CS1, name: "CS GDMDB 1", slug: `${P}cs-1`, address: "x" } });
  await db.center.create({ data: { id: CS2, name: "CS GDMDB 2", slug: `${P}cs-2`, address: "y" } });
  await db.course.create({ data: { id: K3, name: "Sata3 GDMDB", slug: `${P}k3`, totalSessions: 48 } });
  await db.course.create({ data: { id: K4, name: "Sata4 GDMDB", slug: `${P}k4`, totalSessions: 48 } });
  await db.class.create({ data: { id: L3, name: "Lớp 3 GDMDB", courseId: K3 } });
  await db.class.create({ data: { id: L3B, name: "Lớp 3B GDMDB", courseId: K3 } });
  await db.class.create({ data: { id: L4, name: "Lớp 4 GDMDB", courseId: K4 } });
}

/** Phụ huynh (lead) + bé + học viên. `key` phân biệt gia đình; `be` = số bé (anh/chị/em cùng lead). */
async function giaDinh(key: string, soBe = 1, centerId = CS1) {
  await db.lead.create({ data: { id: id(`l-${key}`), parentName: `PH ${key}`, phone: `09800${String(++dem).padStart(5, "0")}`, status: "DA_DANG_KY", centerId } });
  const hs: { be: string; hv: string }[] = [];
  for (let i = 0; i < soBe; i++) {
    const be = id(`be-${key}${i}`);
    const hv = id(`hv-${key}${i}`);
    await db.leadChild.create({ data: { id: be, leadId: id(`l-${key}`), fullName: `Bé ${key}${i}` } });
    await db.student.create({ data: { id: hv, name: `Bé ${key}${i}`, leadId: id(`l-${key}`), leadChildId: be, centerId } });
    hs.push({ be, hv });
  }
  return hs;
}

async function ghiDanh(eid: string, studentId: string, o: Partial<{ classId: string; courseId: string; status: string; centerId: string | null; leadChildId: string | null }> = {}) {
  await db.enrollment.create({
    data: {
      id: id(eid), studentId, classId: o.classId ?? L3, courseId: o.courseId ?? K3, status: (o.status ?? "ACTIVE") as never, centerId: o.centerId === undefined ? CS1 : o.centerId,
      leadChildId: o.leadChildId ?? null, listPrice: 10_560_000, tuition: 10_560_000, finalPrice: 10_560_000,
    },
  });
}

type Dong = { studentId?: string | null; courseId?: string; leadChildId?: string; enrollmentId?: string | null };
async function donHang(oid: string, o: { leadId?: string | null; leadChildId?: string | null; centerId?: string | null; studentId?: string | null; status?: string; dong: Dong[]; extraMeta?: boolean }) {
  await db.order.create({
    data: {
      id: id(oid), code: id(`ORD-${oid}`), type: "COURSE", status: (o.status ?? "COMPLETED") as never, customerName: `PH ${oid}`, customerPhone: `09811${String(++dem).padStart(5, "0")}`,
      subtotal: 10_560_000 * o.dong.length, totalAmount: 10_560_000 * o.dong.length, leadId: o.leadId ?? null, leadChildId: o.leadChildId ?? null,
      centerId: o.centerId === undefined ? CS1 : o.centerId, studentId: o.studentId ?? null,
    },
  });
  for (const [i, d] of o.dong.entries()) {
    await db.orderItem.create({
      data: {
        id: id(`${oid}-it${i}`), orderId: id(oid), type: "COURSE_ENROLLMENT", itemName: "Khoá", quantity: 1, unitPrice: 10_560_000, totalPrice: 10_560_000,
        metadata: { courseId: d.courseId ?? K3, ...(d.leadChildId ? { leadChildId: d.leadChildId } : {}) }, studentId: d.studentId ?? null, enrollmentId: d.enrollmentId ?? null,
      },
    });
  }
}

const item = (oid: string, i = 0) => db.orderItem.findUniqueOrThrow({ where: { id: id(`${oid}-it${i}`) }, select: { studentId: true, enrollmentId: true } });
const don1 = (oid: string) => db.order.findUniqueOrThrow({ where: { id: id(oid) }, select: { studentId: true, totalAmount: true } });
const tay = (oid: string) => db.$transaction((tx) => ganDanhTinhDonMoiTao(tx, { orderId: id(oid), actor: ACTOR }));
const sau = (eid: string) => db.$transaction((tx) => ganDongDonMoCoiChoGhiDanh(tx, { enrollmentId: id(eid), actor: ACTOR }));
const soAudit = (action: string) => db.auditLog.count({ where: { action, entityId: { startsWith: P } } });

describe.skipIf(!RUN_DB_TESTS)("[GDMDB] gắn danh tính dòng đơn — đường tạo đơn tay + ghi danh sinh sau (Postgres thật)", () => {
  beforeEach(async () => {
    await nen();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[GDMDB-01] GHI DANH CÓ SẴN: đơn tay cho học viên đã có ghi danh cùng khoá/cơ sở ⇒ gắn `OrderItem.enrollmentId`; `Order.studentId` điền khi còn NULL; audit GAN_DANH_TINH_DON nguồn «tao-don-tay»", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    const kq = await tay("o1");
    expect(kq).toMatchObject({ dong: 1, don: 1, dungSom: null });
    expect(await item("o1")).toEqual({ studentId: a!.hv, enrollmentId: id("e-a") });
    expect((await don1("o1")).studentId).toBe(a!.hv);
    const au = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON", entityId: id("o1") } });
    expect(au.newValues).toMatchObject({ nguon: "tao-don-tay" });
  });

  it("[GDMDB-02] GHI DANH MỚI / CHƯA CÓ: học viên chưa có ghi danh ⇒ không ghi gì, KHÔNG audit (đây là trạng thái bình thường — đường «ghi danh sinh sau» sẽ gắn)", async () => {
    const [a] = await giaDinh("a");
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    const kq = await tay("o1");
    expect(kq).toMatchObject({ dong: 0, don: 1, dungSom: null });
    expect(await item("o1")).toEqual({ studentId: a!.hv, enrollmentId: null });
    expect(await soAudit("GAN_DANH_TINH_DON_BO_QUA")).toBe(0);
  });

  it("[GDMDB-03] ANH/CHỊ/EM cùng phụ huynh, cùng khoá trong MỘT đơn hai dòng ⇒ mỗi dòng về ghi danh của ĐÚNG em của nó; `Order.studentId` NULL", async () => {
    const hs = await giaDinh("a", 2);
    await ghiDanh("e-a0", hs[0]!.hv, { leadChildId: hs[0]!.be });
    await ghiDanh("e-a1", hs[1]!.hv, { classId: L3B, leadChildId: hs[1]!.be });
    await donHang("o1", { dong: [{ studentId: hs[0]!.hv }, { studentId: hs[1]!.hv }] });
    await tay("o1");
    expect((await item("o1", 0)).enrollmentId).toBe(id("e-a0"));
    expect((await item("o1", 1)).enrollmentId).toBe(id("e-a1"));
    expect((await don1("o1")).studentId).toBeNull();
  });

  it("[GDMDB-04] GHI DANH MƠ HỒ: học viên có HAI ghi danh còn hiệu lực cùng khoá ⇒ KHÔNG gắn, để dấu vết BO_QUA", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-1", a!.hv, { classId: L3 });
    await ghiDanh("e-2", a!.hv, { classId: L3B });
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    const kq = await tay("o1");
    expect(kq.dong).toBe(0);
    expect((await item("o1")).enrollmentId).toBeNull();
    const au = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON_BO_QUA", entityId: id("o1") } });
    expect(JSON.stringify(au.newValues)).toContain("NHIEU_GHI_DANH");
  });

  it("[GDMDB-05] RENEWAL: ghi danh COMPLETED không nhận lần mua mới cùng khoá; có ghi danh mới (PENDING) thì dòng về ghi danh MỚI; khoá khác thì không liên quan", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-cu", a!.hv, { status: "COMPLETED" });
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    expect((await tay("o1")).dong).toBe(0);
    expect((await item("o1")).enrollmentId).toBeNull();
    await ghiDanh("e-moi", a!.hv, { classId: L3B, status: "PENDING" });
    expect((await tay("o1")).dong).toBe(1);
    expect((await item("o1")).enrollmentId).toBe(id("e-moi"));
    // khoá khác (Sata4) chưa có ghi danh ⇒ dòng Sata4 không bị kéo vào ghi danh Sata3
    await donHang("o2", { dong: [{ studentId: a!.hv, courseId: K4 }] });
    expect((await tay("o2")).dong).toBe(0);
    expect((await item("o2")).enrollmentId).toBeNull();
  });

  it("[GDMDB-06] LƯỚI 1 — ghi danh duy nhất của em đã có KHOẢN THU của đơn KHÁC ⇒ đơn mới KHÔNG chiếm ghi danh (đơn cũ vẫn giữ quyền gắn sau)", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await donHang("cu", { dong: [{ studentId: null, leadChildId: a!.be }], leadId: id("l-a"), leadChildId: a!.be });
    await db.payment.create({
      data: { id: id("p-cu"), orderId: id("cu"), orderItemId: id("cu-it0"), amount: 1_000_000, method: "sepay", paidDate: new Date("2026-09-01T00:00:00Z"), saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: id("e-a") },
    });
    await donHang("moi", { dong: [{ studentId: a!.hv }] });
    expect((await tay("moi")).dong).toBe(0);
    expect((await item("moi")).enrollmentId).toBeNull();
    const au = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DANH_TINH_DON_BO_QUA", entityId: id("moi") } });
    expect(JSON.stringify(au.newValues)).toContain("GHI_DANH_CO_KHOAN_DON_KHAC");
  });

  it("[GDMDB-07] LƯỚI 2 — còn DÒNG ĐỒNG CẤP chưa gắn của đơn cũ (đơn convert cũ: học viên NULL, chỉ có khoá bé trong metadata) ⇒ đơn mới KHÔNG chiếm ghi danh; đơn cũ đã huỷ thì không cản", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await donHang("cu", { dong: [{ studentId: null, leadChildId: a!.be }], leadId: id("l-a"), leadChildId: a!.be });
    await donHang("moi", { dong: [{ studentId: a!.hv }] });
    expect((await tay("moi")).dong).toBe(0);
    expect((await item("moi")).enrollmentId).toBeNull();
    expect((await item("cu")).enrollmentId).toBeNull(); // đơn cũ KHÔNG bị đụng, vẫn gắn được sau này
    await db.order.update({ where: { id: id("cu") }, data: { status: "CANCELLED" } });
    expect((await tay("moi")).dong).toBe(1);
    expect((await item("moi")).enrollmentId).toBe(id("e-a"));
  });

  it("[GDMDB-08] IDEMPOTENT: chạy lại ⇒ không đổi gì, không audit thêm", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv);
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    await tay("o1");
    const truoc = await soAudit("GAN_DANH_TINH_DON");
    const kq = await tay("o1");
    expect(kq).toMatchObject({ dong: 0, don: 0 });
    expect(await soAudit("GAN_DANH_TINH_DON")).toBe(truoc);
  });

  it("[GDMDB-09] KHÔNG ĐÈ: dòng đã trỏ ghi danh khác (và chưa có học viên, nối qua bé) ⇒ giữ nguyên; dòng đã đủ hai cột ⇒ không đụng", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await ghiDanh("e-khac", a!.hv, { classId: L4, courseId: K4 });
    await donHang("o1", { leadId: id("l-a"), leadChildId: a!.be, dong: [{ studentId: null, leadChildId: a!.be, enrollmentId: id("e-khac") }] });
    await tay("o1");
    expect((await item("o1")).enrollmentId).toBe(id("e-khac"));
    await donHang("o2", { dong: [{ studentId: a!.hv, enrollmentId: id("e-khac") }] });
    expect((await tay("o2")).dong).toBe(0);
    expect((await item("o2")).enrollmentId).toBe(id("e-khac"));
  });

  it("[GDMDB-10] CHỈ BA CỘT: Payment · tổng đơn · giá ghi danh · ghi danh · học viên KHÔNG đổi sau khi gắn (so từng dòng)", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv);
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    await db.payment.create({
      data: { id: id("p1"), orderId: id("o1"), orderItemId: id("o1-it0"), amount: 500_000, method: "cash", paidDate: new Date("2026-09-02T00:00:00Z"), saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1 },
    });
    const pay = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const gd = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const sv = await db.student.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const tong = (await don1("o1")).totalAmount;
    await tay("o1");
    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(pay);
    expect(await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(gd);
    expect(await db.student.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(sv);
    expect((await don1("o1")).totalAmount).toBe(tong);
    expect((await item("o1")).enrollmentId).toBe(id("e-a"));
  });

  it("[GDMDB-11] KHÁC CƠ SỞ: ghi danh ở cơ sở khác với đơn ⇒ không gắn", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { centerId: CS2 });
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    expect((await tay("o1")).dong).toBe(0);
    expect((await item("o1")).enrollmentId).toBeNull();
  });

  it("[GDMDB-12] ĐƯỜNG 2 — ghi danh sinh SAU đơn: dòng đơn mồ côi của chính học viên ⇒ gắn `enrollmentId`; đơn nối qua BÉ (đơn convert cũ: học viên NULL) cũng gắn khi cùng lead", async () => {
    const [a] = await giaDinh("a");
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    await donHang("o2", { leadId: id("l-a"), leadChildId: a!.be, dong: [{ studentId: null, leadChildId: a!.be, courseId: K4 }] });
    await ghiDanh("e-a", a!.hv);
    const kq = await sau("e-a");
    expect(kq.dong).toBe(1);
    expect((await item("o1")).enrollmentId).toBe(id("e-a"));
    expect((await item("o2")).enrollmentId).toBeNull(); // khoá khác
    await ghiDanh("e-b", a!.hv, { classId: L4, courseId: K4 });
    await sau("e-b");
    expect(await item("o2")).toEqual({ studentId: a!.hv, enrollmentId: id("e-b") });
  });

  it("[GDMDB-13] ĐƯỜNG 2 — HAI dòng mồ côi cùng học viên + khoá (hai đơn) ⇒ KHÔNG đoán: không dòng nào được gắn; học viên đã có ghi danh khác cùng khoá (học lại) ⇒ dừng sớm", async () => {
    const [a] = await giaDinh("a");
    await donHang("o1", { dong: [{ studentId: a!.hv }] });
    await donHang("o2", { dong: [{ studentId: a!.hv }] });
    await ghiDanh("e-a", a!.hv);
    const kq = await sau("e-a");
    expect(kq.dong).toBe(0);
    expect((await item("o1")).enrollmentId).toBeNull();
    expect((await item("o2")).enrollmentId).toBeNull();
    // học lại: đã có ghi danh khác cùng khoá ⇒ dừng sớm, không gắn dòng nào
    await db.order.delete({ where: { id: id("o2") } }).catch(() => null);
    await ghiDanh("e-moi", a!.hv, { classId: L3B });
    const kq2 = await sau("e-moi");
    expect(kq2.dungSom).toBe("DA_CO_GHI_DANH_KHAC_CUNG_KHOA");
    expect((await item("o1")).enrollmentId).toBeNull();
  });

  it("[GDMDB-14] ĐƯỜNG 2 — KHÔNG tin metadata của lead khác: dòng nối qua bé nhưng đơn thuộc lead KHÁC với học viên ⇒ không gắn; học viên KHÁC không bị đụng", async () => {
    const [a] = await giaDinh("a");
    const [b] = await giaDinh("b");
    // đơn của gia đình B mang metadata trỏ bé của A (dữ liệu bẩn/độc)
    await donHang("o-b", { leadId: id("l-b"), leadChildId: a!.be, dong: [{ studentId: null, leadChildId: a!.be }] });
    await donHang("o-b2", { dong: [{ studentId: b!.hv }] });
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await sau("e-a");
    expect((await item("o-b")).enrollmentId).toBeNull();
    expect((await item("o-b2")).enrollmentId).toBeNull(); // dòng của B chưa có ghi danh của B
  });

  it("[GDMDB-16] ĐƯỜNG 1 — KHÔNG tin bé trong metadata khi bé KHÔNG thuộc lead của đơn (client gửi): dòng không có học viên + bé của gia đình khác ⇒ không gắn ghi danh của bé đó", async () => {
    const [a] = await giaDinh("a");
    const [b] = await giaDinh("b");
    await ghiDanh("e-b", b!.hv, { leadChildId: b!.be });
    await donHang("o1", { leadId: id("l-a"), dong: [{ studentId: null, leadChildId: b!.be }] });
    const kq = await tay("o1");
    expect(kq.dong).toBe(0);
    expect((await item("o1")).enrollmentId).toBeNull();
    expect(a).toBeTruthy();
  });

  it("[GDMDB-17] LƯỚI 1 chỉ tính khoản SỐNG: khoản thu của đơn khác đã XOÁ MỀM không cản đơn mới gắn ghi danh", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await donHang("cu", { dong: [{ studentId: a!.hv, enrollmentId: null }], status: "CANCELLED" });
    await db.payment.create({
      data: { id: id("p-cu"), orderId: id("cu"), orderItemId: id("cu-it0"), amount: 1_000_000, method: "sepay", paidDate: new Date("2026-09-01T00:00:00Z"), saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: id("e-a"), deletedAt: new Date("2026-09-03T00:00:00Z") },
    });
    await donHang("moi", { dong: [{ studentId: a!.hv }] });
    expect((await tay("moi")).dong).toBe(1);
    expect((await item("moi")).enrollmentId).toBe(id("e-a"));
  });

  it("[GDMDB-18] LƯỚI 2 thấy cả đơn CŨ chỉ mang `Order.studentId` (đơn nhập lịch sử/backfill: dòng không có học viên lẫn metadata) ⇒ đơn mới KHÔNG chiếm ghi danh của đơn cũ chưa gắn (review độc lập 26/10)", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-a", a!.hv, { leadChildId: a!.be });
    await donHang("cu", { studentId: a!.hv, dong: [{ studentId: null }] }); // chỉ Order.studentId; dòng trống
    await donHang("moi", { dong: [{ studentId: a!.hv }] });
    expect((await tay("moi")).dong).toBe(0);
    expect((await item("moi")).enrollmentId).toBeNull();
    await db.order.update({ where: { id: id("cu") }, data: { status: "CANCELLED" } }); // đối chứng dương: đơn cũ huỷ ⇒ không còn cản
    expect((await tay("moi")).dong).toBe(1);
    expect((await item("moi")).enrollmentId).toBe(id("e-a"));
  });

  it("[GDMDB-19] dòng đơn KHÔNG khai khoá (như `them-con-vao-don` tạo) ⇒ KHÔNG gắn vào ghi danh duy nhất của học viên dù ghi danh đó là khoá khác", async () => {
    const [a] = await giaDinh("a");
    await ghiDanh("e-k4", a!.hv, { classId: L4, courseId: K4 });
    await db.order.create({ data: { id: id("o-k"), code: id("ORD-o-k"), type: "COURSE", status: "COMPLETED", customerName: "PH", customerPhone: "0981100999", subtotal: 1, totalAmount: 1, centerId: CS1, studentId: a!.hv } });
    await db.orderItem.create({ data: { id: id("o-k-it0"), orderId: id("o-k"), type: "COURSE_ENROLLMENT", itemName: "Khoá", quantity: 1, unitPrice: 1, totalPrice: 1, studentId: a!.hv } }); // KHÔNG metadata
    expect((await tay("o-k")).dong).toBe(0);
    expect((await item("o-k")).enrollmentId).toBeNull();
  });
  it("[GDMDB-15] ĐƯỜNG 2 — ANH/EM: hai em cùng lead, cùng khoá, hai đơn lẻ; ghi danh của em A chỉ gắn dòng của em A", async () => {
    const hs = await giaDinh("a", 2);
    await donHang("oa", { dong: [{ studentId: hs[0]!.hv }] });
    await donHang("ob", { dong: [{ studentId: hs[1]!.hv }] });
    await ghiDanh("e-a0", hs[0]!.hv);
    await sau("e-a0");
    expect((await item("oa")).enrollmentId).toBe(id("e-a0"));
    expect((await item("ob")).enrollmentId).toBeNull();
    await ghiDanh("e-a1", hs[1]!.hv, { classId: L3B });
    await sau("e-a1");
    expect((await item("ob")).enrollmentId).toBe(id("e-a1"));
  });
});
