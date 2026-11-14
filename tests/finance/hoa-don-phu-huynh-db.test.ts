// tests/finance/hoa-don-phu-huynh-db.test.ts — mục «Hoá đơn» của cổng phụ huynh trên POSTGRES THẬT. [HDPH-DB-*]
//
// Chạy:  pnpm test:finance-db   (hoặc  vitest run -c vitest.db.config.ts tests/finance/hoa-don-phu-huynh-db.test.ts)
// Thứ phải đo ở DB chứ không đo bằng mock được: SỞ HỮU (phụ huynh A không thấy / không tải được hoá đơn của con phụ huynh B)
// và LUẬT BẢN (chỉ DA_XAC_NHAN thật; NHAP · THAY_THE · KHONG_XUAT · DANG_PHAT_HANH · LOI_PHAT_HANH · GIA_LAP không lọt).
// Bộ KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

// Cờ hoá đơn và kho tệp là hạ tầng ngoài DB hoá đơn — giả lập; MỌI truy vấn hoá đơn/sở hữu vẫn chạm Postgres thật.
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: async () => true }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: () => true, kyUrlTaiVeHoaDon: async () => "https://kho.test/x" }));

// Lớp đọc thông báo cần danh sách con của phụ huynh — lấy từ DB thật của fixture (không qua phiên/cookie).
vi.mock("@/lib/portal/session", () => ({
  getChildren: async (parentUserId: string) =>
    (await db.student.findMany({ where: { parentUserId, deletedAt: null }, select: { id: true, name: true, studentCode: true, avatarUrl: true, centerId: true, preferredCenterId: true } })),
}));

import { docHoaDonDeTai, docHoaDonMoiChoFeed, docMucHoaDon } from "@/lib/portal/hoa-don-phu-huynh";
import { getParentNotifications } from "@/lib/portal/notifications";

if (!RUN_DB_TESTS) console.warn(`[HDPH-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdph-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const PA = `${T}ph-a`;
const PB = `${T}ph-b`;
const PC = `${T}ph-c`; // phụ huynh KHÔNG khai người mua
const SA1 = `${T}hv-a1`;
const SA2 = `${T}hv-a2`;
const SB = `${T}hv-b`;
const SC = `${T}hv-c`;
const GA1 = `${T}gd-a1`;
const GA2 = `${T}gd-a2`;
const GB = `${T}gd-b`;
const GC = `${T}gd-c`;
const OA1 = `${T}don-a1`; // đơn của con A1 (Order.studentId)
const OA2 = `${T}don-a2`; // đơn KHÔNG có studentId — chỉ nối qua khoản thu → ghi danh của A2
const OB = `${T}don-b`;
const OA3 = `${T}don-a3`; // đơn của A1 nhưng KHÔNG khai người mua
const OC = `${T}don-c`; // đơn của phụ huynh C — không khai người mua
const PAY_A1 = `${T}pay-a1`;
const PAY_A2 = `${T}pay-a2`;
const PAY_B = `${T}pay-b`;
const PAY_C = `${T}pay-c`;
const NT = (k: string) => `${T}nt-${k}`;
const HD = (k: string) => `${T}hd-${k}`;

const HD_KEYS = ["a1", "a2", "b", "nhap", "thaythe", "khongxuat", "dang", "loi", "giamla", "a1-cu", "a3-khong", "c-khong"] as const;
const HD_IDS = HD_KEYS.map(HD);

async function don() {
  await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: { in: HD_IDS } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { in: HD_IDS } } });
  await db.notification.deleteMany({ where: { id: { startsWith: `${T}nt-` } } });
  await db.payment.deleteMany({ where: { id: { in: [PAY_A1, PAY_A2, PAY_B, PAY_C] } } });
  await db.order.deleteMany({ where: { id: { in: [OA1, OA2, OB, OA3, OC] } } });
  await db.enrollment.deleteMany({ where: { id: { in: [GA1, GA2, GB, GC] } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [SA1, SA2, SB, SC] } } });
  await db.user.deleteMany({ where: { id: { in: [PA, PB, PC] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

const hoaDon = (k: (typeof HD_KEYS)[number], orderId: string, o: Record<string, unknown> = {}) =>
  db.hoaDonDienTu.create({
    data: {
      id: HD(k),
      orderId,
      centerId: CS,
      trangThai: "DA_XAC_NHAN",
      nguonPhatHanh: "TAI_LEN",
      kyHieu: "1C26TSR",
      soHoaDon: `S-${k}`,
      ngayPhatHanh: new Date("2026-09-12T00:00:00Z"),
      tongTien: 3_000_000,
      taoBoiId: `${T}kt`,
      tepPdfKey: `hoa-don/CS/${k}.pdf`,
      tepPdfTen: `${k}.pdf`,
      ...o,
    },
  });

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "CS HDPH", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Khoá HDPH", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp HDPH", courseId: KHOA, centerId: CS, status: "ACTIVE" } });
  for (const p of [PA, PB, PC]) await db.user.create({ data: { id: p, name: `PH ${p}`, email: `${p}@example.test`, role: "PARENT", roles: ["PARENT"] } });
  for (const [s, p] of [[SA1, PA], [SA2, PA], [SB, PB], [SC, PC]] as const)
    await db.student.create({ data: { id: s, name: `HV ${s}`, centerId: CS, parentUserId: p } });
  for (const [g, s] of [[GA1, SA1], [GA2, SA2], [GB, SB], [GC, SC]] as const)
    await db.enrollment.create({ data: { id: g, studentId: s, classId: LOP, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  const donMoi = (id: string, code: string, studentId: string | null, nguoiMua: Record<string, string> | null = { invoiceBuyerName: "Phụ huynh đã khai" }) =>
    db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "Phụ huynh fixture",
        customerPhone: "0999000555",
        totalAmount: 3_000_000,
        ...(studentId ? { studentId } : {}),
        ...(nguoiMua ?? {}),
      },
    });
  await donMoi(OA1, "ORD-269908-000021", SA1);
  await donMoi(OA2, "ORD-269908-000022", null, { invoiceEmail: "ketoan@example.test" });
  await donMoi(OB, "ORD-269908-000023", SB);
  // KHÔNG nhu cầu: đơn mang tên/email khách đặt (customer*) và ô học viên điền sẵn nhưng KHÔNG khai người mua riêng cho hoá đơn.
  await donMoi(OA3, "ORD-269908-000024", SA1, null);
  await donMoi(OC, "ORD-269908-000025", SC, null);
  await db.order.updateMany({ where: { id: { in: [OA3, OC] } }, data: { customerEmail: "khach@example.test", invoiceStudentName: "Bé tự điền" } });
  for (const [id, orderId, enr] of [[PAY_A1, OA1, GA1], [PAY_A2, OA2, GA2], [PAY_B, OB, GB], [PAY_C, OC, GC]] as const)
    await db.payment.create({
      data: { id, orderId, enrollmentId: enr, amount: 3_000_000, method: "BANK_TRANSFER", paidDate: new Date("2699-09-01T03:00:00Z") },
    });

  // Hoá đơn CỦA phụ huynh A: a1 (qua Order.studentId + khoản), a2 (CHỈ qua khoản → ghi danh), và một bản chốt cũ hơn.
  await hoaDon("a1", OA1);
  await db.hoaDonKhoan.create({ data: { hoaDonId: HD("a1"), paymentId: PAY_A1, soTien: 3_000_000 } });
  await hoaDon("a2", OA2, { tepXmlKey: "hoa-don/CS/a2.xml", tepXmlTen: "a2.xml", ngayPhatHanh: new Date("2026-10-20T00:00:00Z") });
  await db.hoaDonKhoan.create({ data: { hoaDonId: HD("a2"), paymentId: PAY_A2, soTien: 3_000_000 } });
  await hoaDon("a1-cu", OA1, { ngayPhatHanh: new Date("2026-08-01T00:00:00Z") });
  // CỦA phụ huynh B.
  await hoaDon("b", OB);
  await db.hoaDonKhoan.create({ data: { hoaDonId: HD("b"), paymentId: PAY_B, soTien: 3_000_000 } });
  // Bản KHÔNG được hiện — cùng đơn OA1 của phụ huynh A (nên nếu luật bản hỏng, chúng sẽ lọt vào danh sách của A).
  await hoaDon("nhap", OA1, { trangThai: "NHAP" });
  await hoaDon("thaythe", OA1, { trangThai: "THAY_THE", huyLuc: new Date(), huyBoiId: `${T}kt`, huyLyDo: "Sai thông tin" });
  await hoaDon("khongxuat", OA1, { trangThai: "KHONG_XUAT", lyDo: "Xuất ngoài hệ thống", tepPdfKey: null, tepPdfTen: null });
  await hoaDon("dang", OA1, { trangThai: "DANG_PHAT_HANH", nguonPhatHanh: "MISA_API", misaRefId: `${T}ref-dang` });
  await hoaDon("loi", OA1, { trangThai: "LOI_PHAT_HANH", nguonPhatHanh: "MISA_API", misaRefId: `${T}ref-loi` });
  await hoaDon("giamla", OA1, { nguonPhatHanh: "MISA_GIA_LAP", misaRefId: `${T}ref-gl` });
  // Hoá đơn ĐÃ XUẤT thật nhưng của đơn KHÔNG nhu cầu — không được hiện/tải dù đúng con.
  await hoaDon("a3-khong", OA3);
  await hoaDon("c-khong", OC);
  await db.hoaDonKhoan.create({ data: { hoaDonId: HD("c-khong"), paymentId: PAY_C, soTien: 3_000_000 } });

  // Thông báo (đọc bởi chuông): «học phí cần đóng» do cron ghi, «đã xác nhận thanh toán», và một dòng không dedupeKey.
  const tb = (k: string, title: string, dedupeKey: string | null) =>
    db.notification.create({
      data: { id: NT(k), title, body: title, audience: "STUDENT", studentId: SA1, createdByName: "Hệ thống", dedupeKey, isPublished: true, publishedAt: new Date() },
    });
  await tb("no", "Công nợ quá hạn", `debt.overdue:${NT("no")}:2026-11-03`);
  await tb("ok", "Đã xác nhận thanh toán", `payment.confirmed:${NT("ok")}`);
  await tb("khongkhoa", "Thông báo tự do", null);
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe.skipIf(!RUN_DB_TESTS)("[HDPH-DB] mục Hoá đơn cổng phụ huynh × Postgres thật", () => {
  beforeAll(dung);
  afterAll(don);

  it("[HDPH-DB-01] đối chứng dương: phụ huynh A (con A1) thấy đúng hoá đơn đã xuất của A1 — mới nhất trước, có tên khoá và nút tải", async () => {
    const r = await docMucHoaDon([SA1]);
    expect(r.bat).toBe(true);
    expect(ids(r.items)).toEqual([HD("a1"), HD("a1-cu")].sort()); // KHÔNG có a3-khong (đơn không nhu cầu của cùng con)
    expect(r.items[0].id).toBe(HD("a1")); // 12/09 trước 01/08
    expect(r.items[0].khoa).toBe("Khoá HDPH");
    expect(r.items[0].hrefPdf).toBe(`/portal/hoa-don/${HD("a1")}/tai-ve?loai=pdf`);
    expect(r.items[0].hrefXml).toBeNull(); // không có XML ⇒ không nút
    expect(r.items[0].tongTien).toBe(3_000_000);
  });

  it("[HDPH-DB-02] hoá đơn chỉ nối qua KHOẢN THU → ghi danh (đơn không có studentId) vẫn hiện đúng con, kèm nút XML", async () => {
    const r = await docMucHoaDon([SA2]);
    expect(ids(r.items)).toEqual([HD("a2")]);
    expect(r.items[0].hrefXml).toBe(`/portal/hoa-don/${HD("a2")}/tai-ve?loai=xml`);
  });

  it("[HDPH-DB-03] SỞ HỮU: con của phụ huynh B KHÔNG thấy hoá đơn của A, và ngược lại — danh sách VÀ tra để tải", async () => {
    expect(ids((await docMucHoaDon([SB])).items)).toEqual([HD("b")]);
    for (const khac of [HD("a1"), HD("a2"), HD("a1-cu")]) expect(await docHoaDonDeTai([SB], khac), khac).toBeNull();
    for (const cuaB of [SA1, SA2]) expect(await docHoaDonDeTai([cuaB], HD("b")), cuaB).toBeNull();
    // phụ huynh A có cả hai con: tải được hoá đơn của cả hai, vẫn không của B
    expect((await docHoaDonDeTai([SA1, SA2], HD("a2")))?.id).toBe(HD("a2"));
    expect((await docHoaDonDeTai([SA1, SA2], HD("a1")))?.id).toBe(HD("a1"));
    expect(await docHoaDonDeTai([SA1, SA2], HD("b"))).toBeNull();
  });

  it("[HDPH-DB-04] LUẬT BẢN: NHAP · THAY_THE · KHONG_XUAT · DANG_PHAT_HANH · LOI_PHAT_HANH · GIA_LAP không lọt vào danh sách, và KHÔNG tải được dù đúng chủ", async () => {
    const r = await docMucHoaDon([SA1]);
    for (const k of ["nhap", "thaythe", "khongxuat", "dang", "loi", "giamla"] as const) {
      expect(r.items.map((x) => x.id), k).not.toContain(HD(k));
      expect(await docHoaDonDeTai([SA1], HD(k)), k).toBeNull();
    }
  });

  it("[HDPH-DB-05] khoản thu ĐÃ NHẢ (hieuLuc=false) không còn là cầu sở hữu; hoá đơn không có đường nào khác ⇒ biến mất", async () => {
    await db.hoaDonKhoan.updateMany({ where: { hoaDonId: HD("a2") }, data: { hieuLuc: false } });
    try {
      expect(await docHoaDonDeTai([SA2], HD("a2"))).toBeNull();
      expect((await docMucHoaDon([SA2])).items).toEqual([]);
    } finally {
      await db.hoaDonKhoan.updateMany({ where: { hoaDonId: HD("a2") }, data: { hieuLuc: true } });
    }
    expect((await docHoaDonDeTai([SA2], HD("a2")))?.id).toBe(HD("a2"));
  });

  it("[HDPH-DB-06] đơn bị xoá mềm không còn là cầu sở hữu qua Order.studentId", async () => {
    await db.order.update({ where: { id: OA1 }, data: { deletedAt: new Date() } });
    try {
      // đơn đã xoá mềm ⇒ hoá đơn của nó biến mất ở MỌI đường (danh sách + tải); A1 còn đơn khác nhưng không nhu cầu ⇒ ẩn mục
      expect(await docMucHoaDon([SA1])).toEqual({ bat: false, items: [] });
      expect(await docHoaDonDeTai([SA1], HD("a1"))).toBeNull();
    } finally {
      await db.order.update({ where: { id: OA1 }, data: { deletedAt: null } });
    }
  });

  it("[HDPH-DB-08] NHU CẦU: phụ huynh C (đơn không khai người mua) ⇒ ẩn hẳn mục Hoá đơn dù có hoá đơn đã xuất; không tải được", async () => {
    expect(await docMucHoaDon([SC])).toEqual({ bat: false, items: [] });
    expect(await docHoaDonDeTai([SC], HD("c-khong"))).toBeNull();
    expect(await docHoaDonDeTai([SA1], HD("a3-khong"))).toBeNull(); // cùng con A1 có đơn khác CÓ nhu cầu, nhưng hoá đơn này thuộc đơn không nhu cầu
  });

  it("[HDPH-DB-09] có nhu cầu nhưng CHƯA có hoá đơn đã xuất ⇒ mục hiện, danh sách rỗng", async () => {
    await db.hoaDonDienTu.updateMany({ where: { id: { in: [HD("b")] } }, data: { trangThai: "NHAP" } });
    try {
      expect(await docMucHoaDon([SB])).toEqual({ bat: true, items: [] });
    } finally {
      await db.hoaDonDienTu.updateMany({ where: { id: HD("b") }, data: { trangThai: "DA_XAC_NHAN" } });
    }
  });

  it("[HDPH-DB-10] đơn khai người mua RỒI xoá trắng (về null) ⇒ hết nhu cầu, hoá đơn ẩn/không tải", async () => {
    await db.order.update({ where: { id: OB }, data: { invoiceBuyerName: null } });
    try {
      expect(await docMucHoaDon([SB])).toEqual({ bat: false, items: [] });
      expect(await docHoaDonDeTai([SB], HD("b"))).toBeNull();
    } finally {
      await db.order.update({ where: { id: OB }, data: { invoiceBuyerName: "Phụ huynh đã khai" } });
    }
  });

  it("[HDPH-DB-11] chuông: «Có hoá đơn mới» chỉ cho đơn CÓ nhu cầu, đúng con", async () => {
    const a = await docHoaDonMoiChoFeed([{ id: SA1 }, { id: SA2 }]);
    expect(a.map((x) => x.id).sort()).toEqual([HD("a1"), HD("a1-cu"), HD("a2")].sort());
    expect(a.find((x) => x.id === HD("a2"))?.studentId).toBe(SA2);
    expect(await docHoaDonMoiChoFeed([{ id: SC }])).toEqual([]);
    expect((await docHoaDonMoiChoFeed([{ id: SB }])).map((x) => x.id)).toEqual([HD("b")]);
  });

  it("[HDPH-DB-12] chuông: thông báo «Công nợ quá hạn» (debt.overdue:*) KHÔNG còn hiện; «Đã xác nhận thanh toán» và thông báo không dedupeKey vẫn hiện", async () => {
    const ds = (await getParentNotifications(PA)).filter((n) => n.id.startsWith(`${T}nt-`));
    expect(ds.map((n) => n.id).sort()).toEqual([NT("khongkhoa"), NT("ok")].sort());
  });

  it("[HDPH-DB-07] không có con nào ⇒ không có gì (không rơi về mọi hoá đơn)", async () => {
    expect((await docMucHoaDon([])).items).toEqual([]);
    expect(await docHoaDonDeTai([], HD("a1"))).toBeNull();
  });
});
