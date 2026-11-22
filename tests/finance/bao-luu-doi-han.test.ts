// tests/finance/bao-luu-doi-han.test.ts — F2 · US-18 AC2 trên Postgres THẬT.
//
// Chạy: `pnpm test:finance-db`. `pnpm test:unit` trần sẽ SKIP (thiếu `ALLOW_DB_RESET=1`).
//
// Số lấy từ TS-39 (`docs/thanh-toan-linh-hoat/05-TestScenarios…`):
//   *"Bình bảo lưu 30 ngày khi Đợt 2 còn 10 ngày tới hạn … hạn Đợt 2 dời 30 ngày; ngày 15
//   không QUA_HAN; ưu đãi An giữ nguyên"*.
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ BỘ NÀY KIỂM MÀ TEST THUẦN KHÔNG KIỂM ĐƯỢC
//
//   · phép chọn dòng hàng đi qua `orderItem → enrollment → student` có đúng bé không —
//     và vế `reserve.enrollmentId` có thật sự tha bé đang học khoá khác không;
//   · cờ `billing.flexV1Enabled` có CHẶN được phép dời hạn không (luật chung mọi phiên:
//     cờ tắt ⇒ đường cũ y nguyên);
//   · gọi LẠI có dời thêm lần nữa không (khoá `pauseShiftReserveId`);
//   · và AC3: bảo lưu có chạm vào ưu đãi anh em không — câu này chỉ trả lời được bằng cách
//     đọc lại `discountAmount` trên DB sau lượt ghi.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { apDungDoiHanBaoLuu, docBaoLuuCuaDon, locDotCuaConDangBaoLuu } from "@/lib/finance/bao-luu-tien";
import { KHOA_CONG_TAC } from "@/lib/finance/feature";

if (!RUN_DB_TESTS) console.warn(`[BLD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bld-";
const ACTOR = { id: `${T}actor`, name: "Sale fixture BLD" };
const CENTER = `${T}center`;
const KHOA = `${T}khoa`;
const KHOA2 = `${T}khoa2`;
const LOP = `${T}lop`;
const LOP2 = `${T}lop2`;
const HS_BINH = `${T}hs-binh`;
const HS_AN = `${T}hs-an`;
/** Ghi danh của Bình ở khoá CHÍNH và ở khoá THỨ HAI (bé học 2 lớp — ca thật, 77/170 HV). */
const GD_BINH = `${T}gd-binh`;
const GD_BINH_2 = `${T}gd-binh-2`;
const GD_AN = `${T}gd-an`;
const DON = `${T}don`;
const OI_BINH = `${T}oi-binh`;
const OI_BINH_2 = `${T}oi-binh-2`;
const OI_AN = `${T}oi-an`;
/** Dòng CHƯA NỐI GHI DANH — `enrollmentId = null`. Hình dạng thật của đơn bán trước khi xếp lớp. */
const OI_CHUA_GD = `${T}oi-chua-gd`;
const RESERVE = `${T}reserve`;

const HOC_PHI = 12_000_000;
/** Ưu đãi anh em của An — con số phải KHÔNG đổi sau khi Bình bảo lưu (AC3). */
const GIAM_AN = 960_000;

/** Mốc bảo lưu — chiều 22/09 giờ VN. */
const BAT_DAU = new Date("2699-09-22T03:00:00Z");
/** Dự kiến học lại 22/10 ⇒ ĐÚNG 30 ngày. */
const QUAY_LAI = new Date("2699-10-22T00:00:00Z");
/** Đợt 2 còn 10 ngày tới hạn tính từ mốc bảo lưu. */
const HAN_DOT_2 = new Date("2699-10-02T00:00:00Z");
/** Đợt 1 đã quá hạn TỪ TRƯỚC khi bảo lưu — không được dời. */
const HAN_DOT_1 = new Date("2699-09-10T00:00:00Z");

async function don() {
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.studentReserve.deleteMany({ where: { studentId: { in: [HS_BINH, HS_AN] } } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD_BINH, GD_BINH_2, GD_AN] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA2] } } });
  await db.student.deleteMany({ where: { id: { in: [HS_BINH, HS_AN] } } });
  await db.center.deleteMany({ where: { id: CENTER } });
  await db.systemSetting.deleteMany({ where: { key: KHOA_CONG_TAC } });
}

/** Bật/tắt công tắc thu học phí linh hoạt cho TOÀN HỆ. */
async function datCongTac(bat: boolean) {
  await db.systemSetting.upsert({
    where: { key: KHOA_CONG_TAC },
    create: { key: KHOA_CONG_TAC, valueJson: bat },
    update: { valueJson: bat },
  });
}

async function dungFixture(opts: { reserveEnrollmentId?: string | null } = {}) {
  await don();
  await datCongTac(true);
  await db.center.create({
    data: { id: CENTER, name: "Cơ sở fixture BLD", slug: `${T}cs`, address: "114 Hoàng Diệu" },
  });
  await db.course.create({
    data: { id: KHOA, name: "Sata 3 fixture BLD", slug: `${T}sata-3`, totalSessions: 48 },
  });
  await db.course.create({
    data: { id: KHOA2, name: "RoboSim fixture BLD", slug: `${T}robosim`, totalSessions: 12 },
  });
  await db.class.create({ data: { id: LOP, name: "Lớp BLD 1", courseId: KHOA } });
  await db.class.create({ data: { id: LOP2, name: "Lớp BLD 2", courseId: KHOA2 } });
  await db.student.create({ data: { id: HS_BINH, name: "Bé Bình BLD", centerId: CENTER } });
  await db.student.create({ data: { id: HS_AN, name: "Bé An BLD", centerId: CENTER } });
  await db.enrollment.create({
    data: { id: GD_BINH, studentId: HS_BINH, classId: LOP, courseId: KHOA, status: "ACTIVE" },
  });
  await db.enrollment.create({
    data: { id: GD_BINH_2, studentId: HS_BINH, classId: LOP2, courseId: KHOA2, status: "ACTIVE" },
  });
  await db.enrollment.create({
    data: { id: GD_AN, studentId: HS_AN, classId: LOP, courseId: KHOA, status: "ACTIVE" },
  });

  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269922-000002",
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture BLD",
      customerPhone: "0999000923",
      totalAmount: HOC_PHI * 3 - GIAM_AN,
      centerId: CENTER,
    },
  });
  for (const [id, ten, gd, giam] of [
    [OI_BINH, "Bé Bình BLD", GD_BINH, 0],
    [OI_BINH_2, "Bé Bình BLD — RoboSim", GD_BINH_2, 0],
    [OI_AN, "Bé An BLD", GD_AN, GIAM_AN],
    [OI_CHUA_GD, "Bé chưa xếp lớp BLD", null, 0],
  ] as const) {
    await db.orderItem.create({
      data: {
        id,
        orderId: DON,
        type: "COURSE_ENROLLMENT",
        itemName: ten,
        quantity: 1,
        unitPrice: HOC_PHI,
        totalPrice: HOC_PHI,
        discountAmount: giam,
        discountReason: giam > 0 ? "Ưu đãi anh em (SIBLING_ACTIVE)" : null,
        enrollmentId: gd,
      },
    });
  }

  // Đợt của BÌNH ở khoá chính: đợt 1 đã quá hạn, đợt 2 chưa tới hạn.
  await db.paymentRequest.createMany({
    data: [
      { id: `${T}pr-b1`, orderId: DON, orderItemId: OI_BINH, centerId: CENTER, installmentNo: 1, amountDue: 6_000_000, dueDate: HAN_DOT_1, status: "PENDING" },
      { id: `${T}pr-b2`, orderId: DON, orderItemId: OI_BINH, centerId: CENTER, installmentNo: 2, amountDue: 6_000_000, dueDate: HAN_DOT_2, status: "PENDING" },
      // Đợt của khoá THỨ HAI của Bình — dùng để kiểm vế `reserve.enrollmentId`.
      { id: `${T}pr-b2-k2`, orderId: DON, orderItemId: OI_BINH_2, centerId: CENTER, installmentNo: 1, amountDue: 12_000_000, dueDate: HAN_DOT_2, status: "PENDING" },
      // Đợt của AN — không bao giờ được chạm.
      { id: `${T}pr-a1`, orderId: DON, orderItemId: OI_AN, centerId: CENTER, installmentNo: 1, amountDue: 11_040_000, dueDate: HAN_DOT_2, status: "PENDING" },
      // Đợt của dòng CHƯA NỐI GHI DANH — không suy được nó thuộc bé nào ⇒ không bao giờ tha.
      { id: `${T}pr-chua-gd`, orderId: DON, orderItemId: OI_CHUA_GD, centerId: CENTER, installmentNo: 1, amountDue: 12_000_000, dueDate: HAN_DOT_2, status: "PENDING" },
    ],
  });

  await db.studentReserve.create({
    data: {
      id: RESERVE,
      studentId: HS_BINH,
      enrollmentId: opts.reserveEnrollmentId ?? null,
      reason: "Gia đình về quê 1 tháng",
      startedAt: BAT_DAU,
      expectedEndAt: QUAY_LAI,
      createdByUserId: ACTOR.id,
      createdByName: ACTOR.name,
      isActive: true,
    },
  });
}

const han = async (id: string) =>
  (await db.paymentRequest.findUniqueOrThrow({ where: { id }, select: { dueDate: true } })).dueDate;

const ap = () => apDungDoiHanBaoLuu({ reserveId: RESERVE, actor: ACTOR, now: BAT_DAU });

describe.skipIf(!RUN_DB_TESTS)("[BLD] bảo lưu — dời hạn đợt chưa tới hạn", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[BLD-00] fixture đúng hình dạng: 4 đợt, một đã quá hạn, An có ưu đãi", async () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh vì không có đợt nào để dời.
    expect(await db.paymentRequest.count({ where: { orderId: DON } })).toBe(5);
    // Dòng chưa nối ghi danh PHẢI có mặt: nó là đầu vào duy nhất của cổng `!d.studentId`.
    const chuaGd = await db.orderItem.findUniqueOrThrow({ where: { id: OI_CHUA_GD } });
    expect(chuaGd.enrollmentId).toBeNull();
    expect((await han(`${T}pr-b1`))!.getTime()).toBe(HAN_DOT_1.getTime());
    expect((await han(`${T}pr-b2`))!.getTime()).toBe(HAN_DOT_2.getTime());
    const an = await db.orderItem.findUniqueOrThrow({ where: { id: OI_AN } });
    expect(an.discountAmount).toBe(GIAM_AN);
  });

  it("[BLD-01] TS-39: đợt 2 dời ĐÚNG 30 ngày; đợt 1 (đã quá hạn) KHÔNG dời; An không bị chạm", async () => {
    const r = await ap();
    expect(r.ok, `ok=false: ${!r.ok ? r.error : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.soNgay).toBe(30);

    expect((await han(`${T}pr-b2`))!.toISOString()).toBe("2699-11-01T00:00:00.000Z");
    // Đợt 1 đã quá hạn TỪ TRƯỚC — bảo lưu giữ đồng hồ lại từ hôm nay, không xoá việc đã trễ.
    expect((await han(`${T}pr-b1`))!.getTime()).toBe(HAN_DOT_1.getTime());
    // Đợt của bé KHÁC không bao giờ được chạm, dù cùng đơn và cùng ngày hạn.
    expect((await han(`${T}pr-a1`))!.getTime()).toBe(HAN_DOT_2.getTime());

    const dot2 = await db.paymentRequest.findUniqueOrThrow({ where: { id: `${T}pr-b2` } });
    expect(dot2.pauseShiftReserveId).toBe(RESERVE);
    expect(dot2.pauseShiftDays).toBe(30);
  });

  it("[BLD-02] AC3 — bảo lưu KHÔNG chạm một đồng ưu đãi anh em nào", async () => {
    // ⚠️ Ca này canh một thứ KHÔNG có mã: PHIÊN E chốt *"mất ưu đãi: KHÔNG làm, thay bằng
    // CẢNH BÁO"*, nên AC3 đúng SẴN. Ghim lại vì "đúng vì không ai viết mã" là trạng thái dễ
    // mất nhất — người sau thêm một phép quét ưu đãi vào đường bảo lưu thì ca này đỏ.
    const truoc = await db.orderItem.findMany({
      where: { orderId: DON },
      select: { id: true, discountAmount: true, discountReason: true, totalPrice: true },
      orderBy: { id: "asc" },
    });
    expect((await ap()).ok).toBe(true);
    const sau = await db.orderItem.findMany({
      where: { orderId: DON },
      select: { id: true, discountAmount: true, discountReason: true, totalPrice: true },
      orderBy: { id: "asc" },
    });
    expect(sau).toEqual(truoc);
  });

  it("[BLD-03] GỌI LẠI không dời thêm lần nữa (khoá `pauseShiftReserveId`)", async () => {
    expect((await ap()).ok).toBe(true);
    const sauLan1 = (await han(`${T}pr-b2`))!.getTime();

    const lan2 = await ap();
    expect(lan2.ok).toBe(true);
    if (!lan2.ok) return;
    expect(lan2.soDotDaDoi, "lượt hai không dời đợt nào").toBe(0);
    expect((await han(`${T}pr-b2`))!.getTime()).toBe(sauLan1);
  });

  it("[BLD-04] CỜ TẮT ⇒ KHÔNG dời hạn đợt nào, đường cũ y nguyên", async () => {
    await datCongTac(false);
    const r = await ap();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soDotDaDoi).toBe(0);
    expect(r.donCoChuaBatCo).toBe(1);
    expect((await han(`${T}pr-b2`))!.getTime()).toBe(HAN_DOT_2.getTime());
  });

  it("[BLD-05] lượt bảo lưu đã KẾT THÚC ⇒ từ chối, không ghi gì", async () => {
    await db.studentReserve.update({
      where: { id: RESERVE },
      data: { isActive: false, endedAt: new Date("2699-10-01T00:00:00Z") },
    });
    const r = await ap();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Lượt bảo lưu không còn hiệu lực");
    expect((await han(`${T}pr-b2`))!.getTime()).toBe(HAN_DOT_2.getTime());
  });

  it("[BLD-06] bảo lưu MỘT ghi danh ⇒ khoá kia của CHÍNH bé đó KHÔNG bị dời", async () => {
    // ⚠️ Vế dễ quên nhất của F2, và nó đắt: Bình học 2 lớp, bảo lưu lớp Sata3, nhưng lớp
    // RoboSim vẫn học và vẫn phải đóng tiền đúng hạn.
    await dungFixture({ reserveEnrollmentId: GD_BINH });
    expect((await ap()).ok).toBe(true);
    expect((await han(`${T}pr-b2`))!.toISOString()).toBe("2699-11-01T00:00:00.000Z");
    expect((await han(`${T}pr-b2-k2`))!.getTime()).toBe(HAN_DOT_2.getTime());
  });

  it("[BLD-07] KHÔNG khai ngày học lại ⇒ không dời gì, và KHÔNG ghi nhật ký giả", async () => {
    await db.studentReserve.update({ where: { id: RESERVE }, data: { expectedEndAt: null } });
    const r = await ap();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soNgay).toBe(0);
    expect(r.soDotDaDoi).toBe(0);
    expect((await han(`${T}pr-b2`))!.getTime()).toBe(HAN_DOT_2.getTime());
    // Không có gì xảy ra thì KHÔNG được để lại dòng nhật ký nói rằng có dời hạn.
    expect(
      await db.auditLog.count({
        where: { entityType: "Order", entityId: DON, action: "DOI_HAN_DOT_BAO_LUU" },
      }),
    ).toBe(0);
  });

  it("[BLD-08] nhật ký giữ HẠN CŨ của từng đợt — chỗ duy nhất nhớ nó", async () => {
    expect((await ap()).ok).toBe(true);
    const vet = await db.auditLog.findFirst({
      where: { entityType: "Order", entityId: DON, action: "DOI_HAN_DOT_BAO_LUU" },
    });
    expect(vet, "phải ghi AuditLog").not.toBeNull();
    const cu = (vet!.oldValues as { dot: { id: string; hanCu: string }[] }).dot;
    // HAI đợt được dời: đợt 2 của khoá chính + đợt của khoá thứ hai (lượt bảo lưu này nhắm
    // CẢ HỌC VIÊN nên mọi ghi danh của Bình đều vào). Đợt 1 đã quá hạn nên không có ở đây.
    expect(cu.map((d) => d.id).sort()).toEqual([`${T}pr-b2`, `${T}pr-b2-k2`].sort());
    for (const d of cu) expect(d.hanCu).toBe(HAN_DOT_2.toISOString());
    // Và lý do BỎ QUA cũng phải có mặt — "không dời" khác "không có gì để dời".
    const moi = vet!.newValues as { soNgay: number; boQua: { vi: string }[] };
    expect(moi.soNgay).toBe(30);
    expect(moi.boQua.map((b) => b.vi)).toContain("DA_QUA_HAN_TRUOC");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BLD] tha quá hạn trong lúc bảo lưu (AC2 vế hai)", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[BLD-09] đợt của bé ĐANG BẢO LƯU bị LOẠI khỏi danh sách quá hạn; đợt bé khác thì KHÔNG", async () => {
    const phieu = await db.paymentRequest.findMany({
      where: { orderId: DON },
      select: { id: true, orderItemId: true },
    });
    const loai = await locDotCuaConDangBaoLuu(db, phieu);
    // Bình bảo lưu CẢ HỌC VIÊN ⇒ cả 3 đợt của Bình (2 khoá chính + 1 khoá hai) được tha.
    expect([...loai].sort()).toEqual([`${T}pr-b1`, `${T}pr-b2`, `${T}pr-b2-k2`].sort());
    expect(loai.has(`${T}pr-a1`), "đợt của An KHÔNG được tha").toBe(false);
    expect(loai.has(`${T}pr-chua-gd`), "đợt của dòng chưa nối ghi danh KHÔNG được tha").toBe(false);
  });

  it("[BLD-10] HỌC LẠI (kết thúc bảo lưu) ⇒ THÔI tha ngay, không cần ghi gì", async () => {
    // Đây là cái lợi thẳng của việc KHÔNG chép trạng thái bảo lưu xuống sổ tiền: nguồn sự
    // thật đổi một dòng, mọi người đọc đều thấy ngay.
    await db.studentReserve.update({
      where: { id: RESERVE },
      data: { isActive: false, endedAt: new Date("2699-10-20T00:00:00Z") },
    });
    const phieu = await db.paymentRequest.findMany({
      where: { orderId: DON },
      select: { id: true, orderItemId: true },
    });
    expect((await locDotCuaConDangBaoLuu(db, phieu)).size).toBe(0);
  });

  it("[BLD-11] phiếu `orderItemId = NULL` (luồng CŨ) KHÔNG bao giờ được tha", async () => {
    // Fail-closed đúng chiều: phiếu thu toàn đơn không thuộc con nào, nên không suy được con
    // nào đang bảo lưu. Nhầm thành "đang bảo lưu" là tha quá hạn cho khoản không ai xin tha.
    await db.paymentRequest.create({
      data: {
        id: `${T}pr-cu`,
        orderId: DON,
        orderItemId: null,
        centerId: CENTER,
        installmentNo: 0,
        amountDue: 1_000_000,
        dueDate: HAN_DOT_1,
        status: "PARTIAL",
      },
    });
    // Đo CẢ HAI hình dạng "không suy được bé nào", trong CÙNG một lô để phép lọc không
    // thoát bằng đường `orderItemIds.length === 0`:
    //   · phiếu thu toàn đơn (`orderItemId = NULL`);
    //   · phiếu của một DÒNG chưa nối ghi danh (`orderItem.enrollmentId = NULL`).
    //
    // ⚠️ Lô CÓ KÈM một phiếu được tha THẬT (`pr-b2` của Bình). Bản đầu của ca này chỉ đưa hai
    // phiếu "không suy được bé nào", và nó XANH vì một lý do KHÁC hẳn: `studentIds` rỗng nên
    // hàm ngắt sớm ở `luot.length === 0` và không bao giờ chạy tới cổng cần kiểm. Đo bằng
    // phép cấy mới lộ ra (phép 8 không làm ca này đỏ). Kèm một phiếu được tha thì phép lọc
    // buộc phải chạy đủ, và ca này đo đúng thứ nó nói.
    const loai = await locDotCuaConDangBaoLuu(db, [
      { id: `${T}pr-cu`, orderItemId: null },
      { id: `${T}pr-chua-gd`, orderItemId: OI_CHUA_GD },
      { id: `${T}pr-b2`, orderItemId: OI_BINH },
    ]);
    expect([...loai]).toEqual([`${T}pr-b2`]);
  });

  it("[BLD-12] bảo lưu MỘT ghi danh ⇒ chỉ đợt của ghi danh ấy được tha", async () => {
    await dungFixture({ reserveEnrollmentId: GD_BINH });
    const phieu = await db.paymentRequest.findMany({
      where: { orderId: DON },
      select: { id: true, orderItemId: true },
    });
    const loai = await locDotCuaConDangBaoLuu(db, phieu);
    expect([...loai].sort()).toEqual([`${T}pr-b1`, `${T}pr-b2`].sort());
    expect(loai.has(`${T}pr-b2-k2`), "khoá bé VẪN ĐANG HỌC không được tha").toBe(false);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BLD] đọc để hiển thị", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[BLD-13] màn công nợ đọc được: con nào bảo lưu, tới ngày nào, hạn đã dời mấy ngày", async () => {
    expect((await ap()).ok).toBe(true);
    const m = await docBaoLuuCuaDon(DON);
    expect([...m.keys()].sort()).toEqual([OI_BINH, OI_BINH_2].sort());
    const b = m.get(OI_BINH)!;
    expect(b.reserveId).toBe(RESERVE);
    expect(b.expectedEndAt!.toISOString()).toBe(QUAY_LAI.toISOString());
    expect(b.soNgayDaDoiHan).toBe(30);
    // Khoá thứ hai của Bình cũng bảo lưu (lượt bảo lưu nhắm CẢ HỌC VIÊN) nhưng đợt của nó
    // không dời được vì... nó dời được thật. Kiểm cho chắc là số đọc theo ĐỢT, không suy lại.
    expect(m.get(OI_BINH_2)!.soNgayDaDoiHan).toBe(30);
  });

  it("[BLD-14] CHƯA áp dời hạn ⇒ vẫn hiện 'đang bảo lưu', nhưng số ngày dời là NULL", async () => {
    // ⚠️ Hai câu hỏi khác nhau: "bảo lưu bao lâu" và "hạn đã bị dời bao nhiêu". Chúng LỆCH
    // khi phép dời hỏng nửa đường — và màn hình phải nói đúng câu thứ hai, kẻo người vận
    // hành tin rằng không còn việc gì phải làm.
    const m = await docBaoLuuCuaDon(DON);
    expect(m.get(OI_BINH)!.soNgayDaDoiHan).toBeNull();
  });
});
