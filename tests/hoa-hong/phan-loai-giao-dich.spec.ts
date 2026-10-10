// @vitest-environment node
/**
 * [NHH-TRX-D*] — bộ NẠP dữ liệu của phân loại giao dịch, trên Postgres THẬT (04 §4.4, §5.2).
 *
 * Hàm quyết định đã có lưới thuần ở `lib/hoa-hong/phan-loai-giao-dich.test.ts`. Thứ chỉ DB mới chứng
 * minh được: đầu vào được dựng ĐÚNG từ cột thật (`OrderItem.studentId`, `Enrollment.transferredToId`,
 * `StudentReserve`, `Payment` qua `WHERE_THUC_THU`…) — một lời gọi Prisma sai cột làm hàm thuần xanh
 * mà phân loại sai.
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE — dữ liệu mang tiền tố `fx-nhh-pl-` và được dọn
 * theo tiền tố. Mỗi ca tự dựng fixture riêng (luật 18); ngày là ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import { PrismaClient } from "@prisma/client";

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { phanLoaiDongDon } from "../../lib/hoa-hong/phan-loai-giao-dich-db";

if (!RUN_DB_TESTS) console.warn(`[NHH-TRX-D] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-nhh-pl-";
const MOC = new Date("2026-09-15T03:00:00.000Z");
const D = (s: string) => new Date(`${s}T03:00:00.000Z`);
let seq = 0;

type Nen = {
  p: string;
  cs1: string;
  cs2: string;
  khoa: string;
  khoa2: string;
  lop: string;
  lop2: string;
  lopCs2: string;
  lop3: string;
};

/** Mỗi ca một nền riêng (cơ sở, khoá, lớp) — không mượn trạng thái ca trước. */
async function nen(): Promise<Nen> {
  const p = `${P}${(seq += 1)}-`;
  const n: Nen = {
    p,
    cs1: `${p}cs1`,
    cs2: `${p}cs2`,
    khoa: `${p}khoa`,
    khoa2: `${p}khoa2`,
    lop: `${p}lop`,
    lop2: `${p}lop2`,
    lopCs2: `${p}lop-cs2`,
    lop3: `${p}lop3`,
  };
  await db.center.create({ data: { id: n.cs1, name: `CS1 ${p}`, slug: `${p}cs1`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: n.cs2, name: `CS2 ${p}`, slug: `${p}cs2`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: n.khoa, name: `Sata 3 ${p}`, slug: `${p}sata3`, totalSessions: 48 } });
  await db.course.create({ data: { id: n.khoa2, name: `Sata 4 ${p}`, slug: `${p}sata4`, totalSessions: 48 } });
  await db.class.create({ data: { id: n.lop, name: `Lớp ${p}`, courseId: n.khoa, centerId: n.cs1 } });
  await db.class.create({ data: { id: n.lop2, name: `Lớp 2 ${p}`, courseId: n.khoa2, centerId: n.cs1 } });
  await db.class.create({ data: { id: n.lopCs2, name: `Lớp CS2 ${p}`, courseId: n.khoa, centerId: n.cs2 } });
  await db.class.create({ data: { id: n.lop3, name: `Lớp 3 ${p}`, courseId: n.khoa, centerId: n.cs1 } });
  return n;
}

async function hocVien(n: Nen, ma: string, extra: Record<string, unknown> = {}) {
  const id = `${n.p}hv-${ma}`;
  await db.student.create({ data: { id, name: `Bé ${ma} ${n.p}`, centerId: n.cs1, ...extra } });
  return id;
}

async function ghiDanh(
  n: Nen,
  ma: string,
  studentId: string,
  p: { classId?: string; courseId?: string; centerId?: string | null; createdAt?: Date; renewedFromEnrollmentId?: string } = {},
) {
  const id = `${n.p}gd-${ma}`;
  await db.enrollment.create({
    data: {
      id,
      studentId,
      classId: p.classId ?? n.lop,
      courseId: p.courseId ?? n.khoa,
      centerId: p.centerId === undefined ? n.cs1 : p.centerId,
      status: "ACTIVE",
      createdAt: p.createdAt ?? D("2026-01-05"),
      renewedFromEnrollmentId: p.renewedFromEnrollmentId ?? null,
    },
  });
  return id;
}

async function don(n: Nen, ma: string, p: { createdAt?: Date; status?: "CONFIRMED" | "CANCELLED"; leadId?: string; leadChildId?: string } = {}) {
  const id = `${n.p}don-${ma}`;
  await db.order.create({
    data: {
      id,
      code: `${n.p}${ma}`.toUpperCase(),
      type: "COURSE",
      status: p.status ?? "CONFIRMED",
      customerName: `PH ${n.p}`,
      customerPhone: "0999000111",
      totalAmount: 10_000_000,
      centerId: n.cs1,
      createdAt: p.createdAt ?? D("2026-01-05"),
      leadId: p.leadId ?? null,
      leadChildId: p.leadChildId ?? null,
    },
  });
  return id;
}

async function dong(
  n: Nen,
  ma: string,
  orderId: string,
  p: {
    studentId?: string | null;
    enrollmentId?: string | null;
    type?: "COURSE_ENROLLMENT" | "PRODUCT" | "COURSE_PACKAGE" | "MAKEUP_FEE";
    createdAt?: Date;
    status?: "ACTIVE" | "STOPPED";
  } = {},
) {
  const id = `${n.p}oi-${ma}`;
  await db.orderItem.create({
    data: {
      id,
      orderId,
      type: p.type ?? "COURSE_ENROLLMENT",
      itemName: `Dòng ${ma}`,
      quantity: 1,
      unitPrice: 10_000_000,
      totalPrice: 10_000_000,
      studentId: p.studentId ?? null,
      enrollmentId: p.enrollmentId ?? null,
      status: p.status ?? "ACTIVE",
      createdAt: p.createdAt ?? D("2026-01-05"),
    },
  });
  return id;
}

async function thu(
  n: Nen,
  ma: string,
  orderId: string,
  amount: number,
  p: {
    orderItemId?: string | null;
    enrollmentId?: string | null;
    trangThai?: "CONFIRMED" | "PENDING" | "REJECTED" | "REFUNDED";
    paidDate?: Date;
  } = {},
) {
  await db.payment.create({
    data: {
      id: `${n.p}pay-${ma}`,
      orderId,
      orderItemId: p.orderItemId ?? null,
      enrollmentId: p.enrollmentId ?? null,
      amount,
      method: "BANK_TRANSFER",
      accountantStatus: p.trangThai ?? "CONFIRMED",
      paidDate: p.paidDate ?? D("2026-01-06"),
      centerId: n.cs1,
    },
  });
}

/**
 * Client THÔ (không qua tầng nền của `lib/db.ts`): trong `$transaction` hay client khongTang, bộ lọc xoá mềm
 * KHÔNG tự áp — bộ nạp phải tự khai `deletedAt: null`. Ca dùng nó để chứng minh điều đó.
 */
const khongTang = new PrismaClient();

async function phanLoai(orderItemId: string, client: Parameters<typeof phanLoaiDongDon>[0] = db) {
  const r = await phanLoaiDongDon(client, { orderItemId, moc: MOC });
  if (!r) throw new Error(`Không có dòng đơn ${orderItemId}`);
  return r;
}

async function donDep() {
  const donIds = (await db.order.findMany({ where: { id: { startsWith: P } }, select: { id: true } })).map((o) => o.id);
  await db.payment.deleteMany({ where: { orderId: { in: donIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: donIds } } });
  await db.order.deleteMany({ where: { id: { in: donIds } } });
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: P } } });
  await db.enrollment.updateMany({ where: { id: { startsWith: P } }, data: { transferredToId: null, renewedFromEnrollmentId: null } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { startsWith: P } } });
  await db.course.deleteMany({ where: { id: { startsWith: P } } });
  await db.center.deleteMany({ where: { id: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-TRX-D] phân loại giao dịch — nạp dữ liệu thật", () => {
  beforeAll(donDep, 60_000);
  afterAll(async () => {
    await donDep();
    await khongTang.$disconnect();
  }, 60_000);

  it("[NHH-TRX-D01] lần mua đầu: học viên đi qua OrderItem.studentId ⇒ NEW; ba đợt thu không đổi kết quả", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const o = await don(n, "o1");
    const oi = await dong(n, "i1", o, { studentId: hv });
    for (const [i, soTien] of [4_000_000, 3_000_000, 3_000_000].entries()) {
      await thu(n, `d${i}`, o, soTien, { orderItemId: oi, paidDate: D(`2026-02-0${i + 1}`) });
    }
    const a = await phanLoai(oi);
    const b = await phanLoai(oi);
    expect(a.loai).toBe("NEW");
    expect(a.maLuat).toBe("FIRST_PURCHASE");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("[NHH-TRX-D02] lần mua sau (đơn khác, tạo sau, có thực thu) ⇒ RENEWAL; đối chứng: lần trước chưa có tiền / mới PENDING / bị REJECTED / hoàn sạch ⇒ NEW", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const o1 = await don(n, "o1", { createdAt: D("2026-01-05") });
    const oi1 = await dong(n, "i1", o1, { studentId: hv, createdAt: D("2026-01-05") });
    const o2 = await don(n, "o2", { createdAt: D("2026-06-01") });
    const oi2 = await dong(n, "i2", o2, { studentId: hv, createdAt: D("2026-06-01") });

    // chưa có đồng nào ở lần mua 1
    expect((await phanLoai(oi2)).loai).toBe("NEW");
    // PENDING / REJECTED không phải thực thu
    await thu(n, "p", o1, 5_000_000, { orderItemId: oi1, trangThai: "PENDING" });
    await thu(n, "r", o1, 5_000_000, { orderItemId: oi1, trangThai: "REJECTED" });
    expect((await phanLoai(oi2)).loai).toBe("NEW");
    // CONFIRMED ⇒ lần mua thật
    await thu(n, "c", o1, 5_000_000, { orderItemId: oi1 });
    const sau = await phanLoai(oi2);
    expect(sau.loai).toBe("RENEWAL");
    expect(sau.maLuat).toBe("PRIOR_PURCHASE");
    // hoàn sạch (REFUNDED âm cùng dòng) ⇒ không còn là lần mua
    await thu(n, "h", o1, -5_000_000, { orderItemId: oi1, trangThai: "REFUNDED" });
    expect((await phanLoai(oi2)).loai).toBe("NEW");
    // và lần mua 1 nhìn từ phía nó vẫn NEW
    expect((await phanLoai(oi1)).loai).toBe("NEW");
  });

  it("[NHH-TRX-D03] đơn đã HUỶ không tính là lần mua", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const o1 = await don(n, "o1", { createdAt: D("2026-01-05"), status: "CANCELLED" });
    const oi1 = await dong(n, "i1", o1, { studentId: hv, createdAt: D("2026-01-05") });
    await thu(n, "c", o1, 5_000_000, { orderItemId: oi1 });
    const o2 = await don(n, "o2", { createdAt: D("2026-06-01") });
    const oi2 = await dong(n, "i2", o2, { studentId: hv, createdAt: D("2026-06-01") });
    expect((await phanLoai(oi2)).loai).toBe("NEW");
  });

  it("[NHH-TRX-D17] thứ tự 'lần mua trước/sau' theo NGÀY CỦA ĐƠN, không theo lúc dòng đơn được GHI: đơn nhập tay lịch sử có Order.createdAt = ngày thật trong sheet nhưng OrderItem.createdAt = lúc nhập", async () => {
    // Cấy 08/10 (review): đường `ghi-giao-dich-cu` chỉ truyền `createdAt` cho ORDER, còn `items.create` lồng trong không truyền
    // ⇒ OrderItem.createdAt = lúc bấm nhập. Xếp theo mốc của DÒNG thì đơn lịch sử (01/2026 thật, nhập 10/2026) bị coi là SAU đơn
    // thật 06/2026: đơn thật ra NEW và đơn lịch sử ra RENEWAL — đảo ngược.
    const n = await nen();
    const hv = await hocVien(n, "a");
    const oCu = await don(n, "cu", { createdAt: D("2026-01-05") });
    const oiCu = await dong(n, "cu", oCu, { studentId: hv, createdAt: D("2026-10-08") }); // nhập muộn
    await thu(n, "cu", oCu, 5_000_000, { orderItemId: oiCu });
    const oMoi = await don(n, "moi", { createdAt: D("2026-06-01") });
    const oiMoi = await dong(n, "moi", oMoi, { studentId: hv, createdAt: D("2026-06-01") });
    await thu(n, "moi", oMoi, 5_000_000, { orderItemId: oiMoi });
    const moi = await phanLoai(oiMoi);
    expect([moi.loai, moi.maLuat]).toEqual(["RENEWAL", "PRIOR_PURCHASE"]); // đơn thật SAU đơn lịch sử
    const cu = await phanLoai(oiCu);
    expect([cu.loai, cu.maLuat]).toEqual(["NEW", "FIRST_PURCHASE"]); // đơn lịch sử là lần đầu
  });

  it("[NHH-TRX-D04] học viên của dòng: studentId → ghi danh → con của lead (khớp ĐÚNG MỘT); hai học viên cùng con ⇒ xem tay", async () => {
    const n = await nen();
    const hvGd = await hocVien(n, "gd");
    const gd = await ghiDanh(n, "gd", hvGd);
    const o = await don(n, "o1");
    const oiGd = await dong(n, "gd", o, { enrollmentId: gd });
    const r1 = await phanLoai(oiGd);
    expect(r1.loai).toBe("NEW");

    // qua leadChild
    const lead = await db.lead.create({ data: { id: `${n.p}lead`, parentName: "PH", phone: "0905000001", status: "DA_DANG_KY" } });
    const con = await db.leadChild.create({ data: { id: `${n.p}con`, leadId: lead.id, fullName: "Bé con" } });
    const hvCon = await hocVien(n, "con", { leadChildId: con.id });
    const oCon = await don(n, "o2", { leadChildId: con.id, leadId: lead.id });
    const oiCon = await dong(n, "con", oCon);
    const rCon = await phanLoai(oiCon);
    expect(rCon.loai).toBe("NEW");
    expect(rCon.bangChung.coLead).toBe(true);
    expect(hvCon).toBeTruthy();

    // hai học viên cùng một leadChild ⇒ mơ hồ
    await hocVien(n, "con2", { leadChildId: con.id });
    const rMo = await phanLoai(oiCon);
    expect(rMo.loai).toBe("MANUAL_REVIEW");
    expect(rMo.maLuat).toBe("KHONG_RA_HOC_VIEN");
  });

  it("[NHH-TRX-D05] cờ tái tục renewedFromEnrollmentId ⇒ RENEWAL dù không có lần mua nào trước", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const gdCu = await ghiDanh(n, "cu", hv, { createdAt: D("2025-01-05") });
    const gdMoi = await ghiDanh(n, "moi", hv, { classId: n.lop2, courseId: n.khoa2, renewedFromEnrollmentId: gdCu });
    const o = await don(n, "o1");
    const oi = await dong(n, "i1", o, { enrollmentId: gdMoi });
    const r = await phanLoai(oi);
    expect(r.loai).toBe("RENEWAL");
    expect(r.maLuat).toBe("RENEWED_FROM_FLAG");
  });

  it("[NHH-TRX-D06] chuyển ghi danh: khác khoá ⇒ PENDING (đổi khoá) · khác cơ sở ⇒ PENDING (chuyển cơ sở) · cùng cả hai ⇒ xem tay (chuyển lớp)", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");

    // đổi khoá: ghi danh cũ (khoá 1) → mới (khoá 2); dòng đơn gắn ghi danh MỚI
    const cu1 = await ghiDanh(n, "cu1", hv, { classId: n.lop, courseId: n.khoa });
    const moi1 = await ghiDanh(n, "moi1", hv, { classId: n.lop2, courseId: n.khoa2 });
    await db.enrollment.update({ where: { id: cu1 }, data: { status: "TRANSFERRED", transferredToId: moi1 } });
    const o1 = await don(n, "o1");
    const oiMoi = await dong(n, "moi1", o1, { enrollmentId: moi1 });
    const rKhoa = await phanLoai(oiMoi);
    expect([rKhoa.trangThai, rKhoa.maLuat]).toEqual(["PENDING_REGULATION", "DOI_KHOA"]);
    // cùng ghi danh nhìn từ phía dòng cũ (đã chuyển đi) cũng dính
    const oiCu = await dong(n, "cu1", o1, { enrollmentId: cu1 });
    expect((await phanLoai(oiCu)).maLuat).toBe("DOI_KHOA");

    // chuyển cơ sở: cùng khoá, khác cơ sở
    const hv2 = await hocVien(n, "b");
    const cu2 = await ghiDanh(n, "cu2", hv2, { classId: n.lop, courseId: n.khoa, centerId: n.cs1 });
    const moi2 = await ghiDanh(n, "moi2", hv2, { classId: n.lopCs2, courseId: n.khoa, centerId: n.cs2 });
    await db.enrollment.update({ where: { id: cu2 }, data: { status: "TRANSFERRED", transferredToId: moi2 } });
    const o2 = await don(n, "o2");
    const oiCs = await dong(n, "moi2", o2, { enrollmentId: moi2 });
    const rCs = await phanLoai(oiCs);
    expect([rCs.trangThai, rCs.maLuat]).toEqual(["PENDING_REGULATION", "CHUYEN_CO_SO"]);

    // chuyển lớp: cùng khoá, cùng cơ sở
    const hv3 = await hocVien(n, "c");
    const cu3 = await ghiDanh(n, "cu3", hv3);
    const moi3 = await ghiDanh(n, "moi3", hv3, { classId: n.lop3 });
    await db.enrollment.update({ where: { id: cu3 }, data: { status: "TRANSFERRED", transferredToId: moi3 } });
    const o3 = await don(n, "o3");
    const oiLop = await dong(n, "cu3", o3, { enrollmentId: cu3 });
    const rLop = await phanLoai(oiLop);
    expect([rLop.trangThai, rLop.maLuat]).toEqual(["MANUAL_REVIEW_REQUIRED", "CHUYEN_LOP"]);

    // đối chứng dương: ghi danh không chuyển gì ⇒ NEW
    const hv4 = await hocVien(n, "d");
    const gd4 = await ghiDanh(n, "gd4", hv4);
    const o4 = await don(n, "o4");
    const oi4 = await dong(n, "gd4", o4, { enrollmentId: gd4 });
    expect((await phanLoai(oi4)).loai).toBe("NEW");
  });

  it("[NHH-TRX-D07] bảo lưu: đang hiệu lực tại mốc ⇒ PENDING; đã kết thúc ⇒ không dính; dừng học (STOPPED) ⇒ PENDING", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const gd = await ghiDanh(n, "a", hv);
    const o = await don(n, "o1");
    const oi = await dong(n, "i1", o, { enrollmentId: gd });
    expect((await phanLoai(oi)).loai).toBe("NEW");

    const rs = await db.studentReserve.create({
      data: { studentId: hv, enrollmentId: gd, reason: "ốm", startedAt: D("2026-09-01"), createdByName: "fx", isActive: true },
      select: { id: true },
    });
    const dang = await phanLoai(oi);
    expect([dang.trangThai, dang.maLuat]).toEqual(["PENDING_REGULATION", "BAO_LUU"]);

    await db.studentReserve.update({ where: { id: rs.id }, data: { endedAt: D("2026-09-10"), isActive: false } });
    expect((await phanLoai(oi)).loai).toBe("NEW");

    await db.orderItem.update({ where: { id: oi }, data: { status: "STOPPED", stoppedAt: D("2026-09-12") } });
    const dung = await phanLoai(oi);
    expect([dung.trangThai, dung.maLuat]).toEqual(["PENDING_REGULATION", "DUNG_HOC"]);
  });

  it("[NHH-TRX-D08] con thứ 2: anh/chị cùng lead đã mua ⇒ bé 2 vẫn NEW + phuHuynhHienHuu = true; bé 1 ⇒ false; cùng SĐT khác dạng viết cũng tính", async () => {
    const n = await nen();
    const lead = await db.lead.create({ data: { id: `${n.p}lead`, parentName: "PH", phone: "0905000002", status: "DA_DANG_KY" } });
    const anh = await hocVien(n, "anh", { leadId: lead.id, parentPhone: "0905000002" });
    const em = await hocVien(n, "em", { leadId: lead.id, parentPhone: "+84 905 000 002" });
    const oAnh = await don(n, "anh", { createdAt: D("2026-01-05"), leadId: lead.id });
    const oiAnh = await dong(n, "anh", oAnh, { studentId: anh, createdAt: D("2026-01-05") });
    await thu(n, "anh", oAnh, 8_000_000, { orderItemId: oiAnh });
    const oEm = await don(n, "em", { createdAt: D("2026-06-01"), leadId: lead.id });
    const oiEm = await dong(n, "em", oEm, { studentId: em, createdAt: D("2026-06-01") });

    const be2 = await phanLoai(oiEm);
    expect(be2.loai).toBe("NEW");
    expect(be2.bangChung.phuHuynhHienHuu).toEqual({ hienHuu: true, can: "CUNG_LEAD" });
    const be1 = await phanLoai(oiAnh);
    expect(be1.bangChung.phuHuynhHienHuu.hienHuu).toBe(false);

    // chỉ cùng SĐT (không cùng lead): bỏ liên kết lead của em
    await db.student.update({ where: { id: em }, data: { leadId: null } });
    await db.order.update({ where: { id: oEm }, data: { leadId: null } });
    const cungSdt = await phanLoai(oiEm);
    expect(cungSdt.bangChung.phuHuynhHienHuu).toEqual({ hienHuu: true, can: "CUNG_SDT" });

    // không còn lead lẫn SĐT hợp lệ ⇒ KHÔNG BIẾT
    await db.student.update({ where: { id: em }, data: { parentPhone: null } });
    const khongBiet = await phanLoai(oiEm);
    expect(khongBiet.loai).toBe("NEW");
    expect(khongBiet.bangChung.phuHuynhHienHuu).toEqual({ hienHuu: null, can: null });
    expect(khongBiet.bangChung.coLead).toBe(false);
  });

  it("[NHH-TRX-D09] tiền chưa gắn dòng: đơn 1 dòng ⇒ thuộc dòng đó (RENEWAL); đơn nhiều dòng học phí ⇒ mơ hồ ⇒ xem tay; dòng đã có tiền chắc thì RENEWAL thắng", async () => {
    const n = await nen();
    // đơn 1 dòng
    const hv1 = await hocVien(n, "a");
    const o1 = await don(n, "o1", { createdAt: D("2026-01-05") });
    await dong(n, "i1", o1, { studentId: hv1, createdAt: D("2026-01-05") });
    await thu(n, "u1", o1, 6_000_000); // không gắn dòng nào
    const o1b = await don(n, "o1b", { createdAt: D("2026-06-01") });
    const oi1b = await dong(n, "i1b", o1b, { studentId: hv1, createdAt: D("2026-06-01") });
    expect((await phanLoai(oi1b)).loai).toBe("RENEWAL");

    // đơn 2 dòng học phí cho hai bé, khoản chưa gắn
    const hvA = await hocVien(n, "ba");
    const hvB = await hocVien(n, "bb");
    const o2 = await don(n, "o2", { createdAt: D("2026-01-05") });
    const oiA = await dong(n, "ia", o2, { studentId: hvA, createdAt: D("2026-01-05") });
    await dong(n, "ib", o2, { studentId: hvB, createdAt: D("2026-01-05") });
    await thu(n, "u2", o2, 6_000_000);
    const o2b = await don(n, "o2b", { createdAt: D("2026-06-01") });
    const oiB2 = await dong(n, "ib2", o2b, { studentId: hvB, createdAt: D("2026-06-01") });
    const mo = await phanLoai(oiB2);
    expect([mo.loai, mo.maLuat]).toEqual(["MANUAL_REVIEW", "LICH_SU_MO_HO"]);

    // gắn tiền chắc cho dòng của bé B ⇒ RENEWAL
    await thu(n, "chac", o2, 1_000, { orderItemId: `${n.p}oi-ib` });
    expect((await phanLoai(oiB2)).loai).toBe("RENEWAL");
    expect(oiA).toBeTruthy();
  });

  it("[NHH-TRX-D10] ghi danh KHÔNG nối đơn, tạo trước ⇒ xem tay; tạo SAU thì bỏ qua; ghi danh đã xoá mềm bỏ qua; ghi danh CÓ nối đơn không phải mồ côi", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const gdDon = await ghiDanh(n, "don", hv, { createdAt: D("2026-05-01") });
    await ghiDanh(n, "tay", hv, { classId: n.lop2, courseId: n.khoa2, createdAt: D("2026-01-01") });
    const o = await don(n, "o1", { createdAt: D("2026-06-01") });
    const oi = await dong(n, "i1", o, { enrollmentId: gdDon, createdAt: D("2026-06-01") });
    const r = await phanLoai(oi);
    expect([r.loai, r.maLuat]).toEqual(["MANUAL_REVIEW", "GHI_DANH_KHONG_DON"]);
    // chỉ ghi danh KHÔNG nối đơn mới là bằng chứng xung đột — ghi danh của chính dòng này thì không
    expect(r.bangChung.ghiDanhXungDotIds).toEqual([`${n.p}gd-tay`]);

    // đối chứng 1: ghi danh mồ côi tạo SAU dòng ⇒ bỏ qua
    await db.enrollment.update({ where: { id: `${n.p}gd-tay` }, data: { createdAt: D("2026-08-01") } });
    expect((await phanLoai(oi)).loai).toBe("NEW");

    // đối chứng 2: ghi danh mồ côi nhưng đã XOÁ MỀM ⇒ bỏ qua
    await db.enrollment.update({ where: { id: `${n.p}gd-tay` }, data: { createdAt: D("2026-01-01"), deletedAt: D("2026-02-01") } });
    expect((await phanLoai(oi)).loai).toBe("NEW");
    expect((await phanLoai(oi, khongTang)).loai).toBe("NEW"); // client khongTang: bộ nạp tự khai deletedAt

    // đối chứng 3: hết xoá mềm ⇒ lại xung đột (chứng minh hai đối chứng trên bắt đúng lý do)
    await db.enrollment.update({ where: { id: `${n.p}gd-tay` }, data: { deletedAt: null } });
    expect((await phanLoai(oi)).maLuat).toBe("GHI_DANH_KHONG_DON");
  });

  it("[NHH-TRX-D11] dòng học cụ / phí học bù / lệ phí ⇒ NGOAI_PHAM_VI; dòng không tồn tại ⇒ null", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const o = await don(n, "o1");
    const oiKit = await dong(n, "kit", o, { studentId: hv, type: "PRODUCT" });
    const oiBu = await dong(n, "bu", o, { studentId: hv, type: "MAKEUP_FEE" });
    expect((await phanLoai(oiKit)).loai).toBe("NGOAI_PHAM_VI");
    expect((await phanLoai(oiBu)).loai).toBe("NGOAI_PHAM_VI");
    expect(await phanLoaiDongDon(db, { orderItemId: `${n.p}khong-co`, moc: MOC })).toBeNull();
  });

  it("[NHH-TRX-D12] hai dòng học phí của CÙNG bé trong CÙNG đơn ⇒ cả hai NEW (một quyết định mua); dòng học cụ trong đơn không tạo lần mua", async () => {
    const n = await nen();
    const hv = await hocVien(n, "a");
    const o = await don(n, "o1");
    const a = await dong(n, "a", o, { studentId: hv });
    const b = await dong(n, "b", o, { studentId: hv });
    await dong(n, "kit", o, { studentId: hv, type: "PRODUCT" });
    await thu(n, "x", o, 7_000_000, { orderItemId: a });
    expect((await phanLoai(a)).loai).toBe("NEW");
    expect((await phanLoai(b)).loai).toBe("NEW");
  });

  it("[NHH-TRX-D13] học viên khác trong hệ thống không làm bé này thành RENEWAL (phân loại theo HỌC VIÊN, không theo phụ huynh / SĐT đơn)", async () => {
    const n = await nen();
    const hvA = await hocVien(n, "a");
    const hvB = await hocVien(n, "b");
    const oA = await don(n, "oa", { createdAt: D("2026-01-05") });
    const oiA = await dong(n, "ia", oA, { studentId: hvA, createdAt: D("2026-01-05") });
    await thu(n, "a", oA, 9_000_000, { orderItemId: oiA });
    // đơn của B cùng SĐT khách (0999000111) với A — vẫn NEW cho B
    const oB = await don(n, "ob", { createdAt: D("2026-06-01") });
    const oiB = await dong(n, "ib", oB, { studentId: hvB, createdAt: D("2026-06-01") });
    expect((await phanLoai(oiB)).loai).toBe("NEW");
  });

  it("[NHH-TRX-D14] học viên đã tự mua nhiều lần (RENEWAL) mà KHÔNG có anh/chị: phụ huynh KHÔNG bị coi là 'hiện hữu' chỉ vì lần mua trước của chính bé", async () => {
    // Cấy 08/10 (C10, bỏ `id: { not: studentId }` khỏi ứng viên anh/chị): 0 ca đỏ — D08 chỉ thử 'bé 1' tại LẦN MUA ĐẦU,
    // lúc ấy chính bé chưa có lần mua trước nào nên tự-làm-ứng-viên vô hại. Ở lần mua THỨ HAI bé tự khớp lead/SĐT của mình.
    const n = await nen();
    const lead = await db.lead.create({ data: { id: `${n.p}lead`, parentName: "PH", phone: "0905000014", status: "DA_DANG_KY" } });
    const hv = await hocVien(n, "a", { leadId: lead.id, parentPhone: "0905000014" });
    const o1 = await don(n, "o1", { createdAt: D("2026-01-05"), leadId: lead.id });
    const oi1 = await dong(n, "i1", o1, { studentId: hv, createdAt: D("2026-01-05") });
    await thu(n, "c", o1, 5_000_000, { orderItemId: oi1 });
    const o2 = await don(n, "o2", { createdAt: D("2026-06-01"), leadId: lead.id });
    const oi2 = await dong(n, "i2", o2, { studentId: hv, createdAt: D("2026-06-01") });
    const r = await phanLoai(oi2);
    expect(r.loai).toBe("RENEWAL"); // đối chứng: lần mua trước của chính bé có tính ở NEW/RENEWAL
    expect(r.bangChung.phuHuynhHienHuu).toEqual({ hienHuu: false, can: null });
  });

  it("[NHH-TRX-D15] học cụ (PRODUCT) đã mua và thu tiền TRƯỚC không làm lần mua khoá đầu tiên thành RENEWAL", async () => {
    // Cấy 08/10 (C11, thêm PRODUCT vào LOAI_DONG_HOC_PHI): 0 ca đỏ — D11/D12 chỉ thử dòng học cụ làm CHÍNH dòng đang xét hoặc
    // nằm CÙNG đơn, không thử nó như một 'lần mua trước' ở đơn khác. D17 (04 §4.3): học cụ nằm NGOÀI cơ sở tính hoa hồng.
    const n = await nen();
    const hv = await hocVien(n, "a");
    const oKit = await don(n, "kit", { createdAt: D("2026-01-05") });
    const oiKit = await dong(n, "kit", oKit, { studentId: hv, type: "PRODUCT", createdAt: D("2026-01-05") });
    await thu(n, "kit", oKit, 1_500_000, { orderItemId: oiKit });
    const o2 = await don(n, "o2", { createdAt: D("2026-06-01") });
    const oi2 = await dong(n, "i2", o2, { studentId: hv, createdAt: D("2026-06-01") });
    const r = await phanLoai(oi2);
    expect(r.loai).toBe("NEW");
    expect(r.bangChung.lanMuaTruocIds).toEqual([]);
  });

  it("[NHH-TRX-D16] học viên đã XOÁ MỀM cùng leadChild không làm 'hai học viên' mơ hồ — kể cả trên client không có tầng xoá mềm tự động", async () => {
    // Cấy 08/10 (C12, bỏ `deletedAt: null` khỏi tra học viên theo leadChild): 0 ca đỏ vì `db` có tầng xoá mềm tự áp; trên
    // `$transaction`/client thô (đường mà PR5 sẽ dùng) thì không — D10 đã dùng `khongTang` để chứng minh đúng điều này cho ghi danh.
    const n = await nen();
    const lead = await db.lead.create({ data: { id: `${n.p}lead`, parentName: "PH", phone: "0905000016", status: "DA_DANG_KY" } });
    const con = await db.leadChild.create({ data: { id: `${n.p}con`, leadId: lead.id, fullName: "Bé con" } });
    const hvSong = await hocVien(n, "song", { leadChildId: con.id });
    const hvXoa = await hocVien(n, "xoa", { leadChildId: con.id });
    await db.student.update({ where: { id: hvXoa }, data: { deletedAt: D("2026-02-01") } });
    const o = await don(n, "o1", { leadChildId: con.id, leadId: lead.id });
    const oi = await dong(n, "i1", o);
    for (const client of [db, khongTang] as const) {
      const r = await phanLoai(oi, client);
      expect([r.loai, r.maLuat], client === db ? "db" : "khongTang").toEqual(["NEW", "FIRST_PURCHASE"]);
    }
    // đối chứng dương: hồi sinh bản xoá mềm ⇒ lại hai học viên ⇒ mơ hồ (chứng minh ca bắt đúng lý do)
    await db.student.update({ where: { id: hvXoa }, data: { deletedAt: null } });
    expect((await phanLoai(oi)).maLuat).toBe("KHONG_RA_HOC_VIEN");
    expect(hvSong).toBeTruthy();
  });
});
