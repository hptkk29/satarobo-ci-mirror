// Ca [HN3-MIG-01..05] · [HN3-SC-01..02] — bảng YÊU CẦU XÁC NHẬN GIAO DỊCH NHẬP SAI MÃ (`PosSaiMaYeuCau`) trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Vì sao phải đo ở DB (F5 GĐ1): Prisma 5.22 `migrate diff` KHÔNG in CHECK lẫn UNIQUE từng phần ⇒ kiểm drift "0 dòng" không chứng
// minh chúng tồn tại; lưới `[HN3-DECL-04]` chỉ chứng minh câu SQL còn nằm trong tệp. Một biểu thức CHECK/WHERE viết sai vẫn khớp
// regex mà không chặn gì — bộ này đo HÀNH VI, và mỗi ca chặn kèm một đối chứng dương (cùng cảnh, đổi đúng một yếu tố thì ghi được).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[HN3-SCHEMA] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos3sc-";
const SALE = `${T}sale`;
const KT = `${T}kt`;
const KT_XOA = `${T}kt-xoa`;
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const BILL1 = `${T}bill1`;
const BILL2 = `${T}bill2`;
const INT1 = `${T}intent1`;
const INT2 = `${T}intent2`;
const INT3 = `${T}intent3`;
const BILL3 = `${T}bill3`;
const BT1 = `${T}bt1`;
const BT2 = `${T}bt2`;
const BT3 = `${T}bt3`;
const PFX = "FXPOS3SC";

/** Đồng hồ ĐÓNG BĂNG (luật 19). */
const LUC = new Date("2026-10-09T03:15:00Z");
const HAN = new Date("2026-10-10T03:15:00Z");

async function don() {
  await db.posSaiMaYeuCau.deleteMany({ where: { intentId: { in: [INT1, INT2, INT3] } } });
  await db.posPaymentIntent.deleteMany({ where: { id: { in: [INT1, INT2, INT3] } } });
  await db.bankTransaction.deleteMany({ where: { id: { in: [BT1, BT2, BT3] } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: [DON1, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON1, DON2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.user.deleteMany({ where: { id: { in: [SALE, KT, KT_XOA] } } });
}

async function dungFixture() {
  await don();
  for (const id of [SALE, KT, KT_XOA]) {
    await db.user.create({ data: { id, name: "Người fixture HN3", email: `${id}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"] } });
  }
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS3SC"],
    [CS2, "CS2 fixture POS3SC"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  // CS1 có đơn vị ⇒ ghi kép phải tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture POS3SC", centerId: CS1 } });
  for (const [id, cs, ma, sdt] of [
    [DON1, CS1, "ORD-269962-000031", "0328545231"],
    [DON2, CS2, "ORD-269962-000032", "0905123431"],
  ] as const) {
    await db.order.create({
      data: { id, code: ma, type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH fixture POS3SC", customerPhone: sdt, totalAmount: 3_168_000, centerId: cs },
    });
  }
  await db.paymentBill.create({ data: { id: BILL1, orderId: DON1, centerId: CS1, amountDue: 3_168_000, matchKey: "K7M2N" } });
  await db.paymentBill.create({ data: { id: BILL2, orderId: DON2, centerId: CS2, amountDue: 3_168_000, matchKey: "Q4W8R" } });
  // Phiếu thẻ thứ ba cùng phiếu gộp thứ nhất? Không: chỉ mục từng phần "một phiếu MỞ mỗi phiếu gộp" cấm — dùng phiếu gộp riêng.
  await db.paymentBill.create({ data: { id: BILL3, orderId: DON1, centerId: CS1, amountDue: 3_168_000, matchKey: "T3S3T", status: "VOID" } });
  await db.posPaymentIntent.create({
    data: { id: INT1, paymentBillId: BILL1, code5: "K7M2N", amount: 3_168_000, centerId: CS1, createdById: SALE, createdAt: LUC, expiresAt: HAN, status: "CAN_XU_LY" },
  });
  await db.posPaymentIntent.create({
    data: { id: INT2, paymentBillId: BILL2, code5: "Q4W8R", amount: 3_168_000, centerId: CS2, createdById: SALE, createdAt: LUC, expiresAt: HAN, status: "CAN_XU_LY" },
  });
  await db.posPaymentIntent.create({
    data: { id: INT3, paymentBillId: BILL3, code5: "T3S3T", amount: 3_168_000, centerId: CS1, createdById: SALE, createdAt: LUC, expiresAt: HAN, status: "CAN_XU_LY" },
  });
  for (const [id, m] of [
    [BT1, 1],
    [BT2, 2],
    [BT3, 3],
  ] as const) {
    await db.bankTransaction.create({
      data: { id, provider: "CARD_POS", providerTxnId: `${PFX}${m}0000000`, amount: 3_168_000, transferredAt: LUC, status: "UNMATCHED" },
    });
  }
}

type DongYC = Partial<Prisma.PosSaiMaYeuCauUncheckedCreateInput>;
function ghiYc(o: DongYC = {}) {
  return db.posSaiMaYeuCau.create({
    data: {
      intentId: INT1,
      bankTransactionId: BT1,
      centerId: CS1,
      kieu: "CHO_KE_TOAN",
      trangThai: "CHO_DUYET",
      lyDo: "NHIEU_UNG_VIEN",
      nguoiGuiId: SALE,
      createdAt: LUC,
      ...o,
    },
  });
}

const CHI_GIAO_DICH = /Unique constraint failed on the fields: \(`bankTransactionId`\)/;
const CHI_PHIEU = /Unique constraint failed on the fields: \(`intentId`\)/;
const CHI_CAP = /Unique constraint failed on the fields: \(`intentId`,`bankTransactionId`\)/;

/** Toàn văn lỗi — để hỏi TÊN ràng buộc (Prisma không có mã riêng cho CHECK / RESTRICT 23001). */
async function loiDayDu(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function actorCoSo(centerId: string): Actor {
  return {
    userId: KT,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:manage", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] }],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

function actorHo(): Actor {
  return {
    userId: KT,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:manage", scopeType: "GLOBAL", orgUnitId: "ou-ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [CS1, CS2],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[HN3-MIG-01..04] PosSaiMaYeuCau — các khoá mã ứng dụng DỰA VÀO", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HN3-MIG-01a] RLS BẬT, không FORCE; hai enum đủ giá trị đúng thứ tự", async () => {
    const r = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'PosSaiMaYeuCau' AND relkind = 'r'`;
    expect(r).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const e = await db.$queryRaw<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname IN ('PosSaiMaKieu', 'PosSaiMaTrangThai') ORDER BY t.typname, e.enumsortorder`;
    const theo = (ten: string) => e.filter((x) => x.typname === ten).map((x) => x.enumlabel);
    expect(theo("PosSaiMaKieu")).toEqual(["TU_GHI_NHAN", "CHO_KE_TOAN"]);
    expect(theo("PosSaiMaTrangThai")).toEqual(["CHO_DUYET", "DANG_GHI", "DA_GHI_NHAN", "TU_CHOI"]);
  });

  it("[HN3-MIG-01b] NĂM CHECK tồn tại trong pg_constraint (contype = 'c')", async () => {
    const r = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"PosSaiMaYeuCau"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(r.map((x) => x.conname)).toEqual([
      "PosSaiMaYeuCau_dang_ghi_check",
      "PosSaiMaYeuCau_khac_nguoi_check",
      "PosSaiMaYeuCau_ly_do_check",
      "PosSaiMaYeuCau_nguoi_duyet_check",
      "PosSaiMaYeuCau_tu_choi_check",
    ]);
  });

  it("[HN3-MIG-01c] createdAt là giá trị APP đặt (không default); ghi kép centerId → orgUnitId tự chạy (CS1 có đơn vị, CS2 không ⇒ trống)", async () => {
    const a = await ghiYc();
    expect(a.createdAt.toISOString()).toBe(LUC.toISOString());
    expect(a.orgUnitId).toBe(OU1);
    const b = await ghiYc({ intentId: INT2, bankTransactionId: BT2, centerId: CS2 });
    expect(b.orgUnitId).toBeNull();
    // Cột `createdAt` KHÔNG có default ở DB: thiếu nó là lỗi (Prisma bắt trước, nhưng DB cũng NOT NULL).
    const c = await db.$queryRaw<{ column_default: string | null; is_nullable: string }[]>`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'PosSaiMaYeuCau' AND column_name = 'createdAt'`;
    expect(c).toEqual([{ column_default: null, is_nullable: "NO" }]);
  });

  it("[HN3-MIG-02] HAI UNIQUE TỪNG PHẦN đo HÀNH VI: một giao dịch / một phiếu chỉ một yêu cầu SỐNG hoặc ĐÃ DÙNG; bị bác thì NHẢ", async () => {
    await ghiYc(); // (INT1, BT1) CHO_DUYET
    // Prisma báo vi phạm UNIQUE bằng DANH SÁCH TRƯỜNG chứ không bằng tên chỉ mục: một mình `bankTransactionId` = chỉ mục theo giao dịch,
    // một mình `intentId` = chỉ mục theo phiếu, cả hai = chỉ mục CẶP.
    // Cùng GIAO DỊCH, phiếu khác ⇒ chặn bởi chỉ mục theo giao dịch.
    expect(await loiDayDu(ghiYc({ intentId: INT3, bankTransactionId: BT1 }))).toMatch(CHI_GIAO_DICH);
    // Cùng PHIẾU, giao dịch khác ⇒ chặn bởi chỉ mục theo phiếu.
    expect(await loiDayDu(ghiYc({ intentId: INT1, bankTransactionId: BT2 }))).toMatch(CHI_PHIEU);
    expect(await db.posSaiMaYeuCau.count()).toBe(1);

    // Mọi trạng thái KHÁC TU_CHOI đều giữ chỗ: DANG_GHI, DA_GHI_NHAN cũng chặn.
    for (const trangThai of ["DANG_GHI", "DA_GHI_NHAN"] as const) {
      await db.posSaiMaYeuCau.updateMany({
        where: { intentId: INT1 },
        data: { trangThai, dangGhiLuc: LUC, nguoiQuyetId: KT, quyetLuc: LUC },
      });
      expect(await loiDayDu(ghiYc({ intentId: INT3, bankTransactionId: BT1 })), trangThai).toMatch(CHI_GIAO_DICH);
      expect(await loiDayDu(ghiYc({ intentId: INT1, bankTransactionId: BT2 })), trangThai).toMatch(CHI_PHIEU);
    }
    await db.posSaiMaYeuCau.updateMany({ where: { intentId: INT1 }, data: { trangThai: "CHO_DUYET", dangGhiLuc: null, nguoiQuyetId: null, quyetLuc: null } });

    // ĐỐI CHỨNG DƯƠNG: bị TỪ CHỐI ⇒ nhả CẢ HAI chỉ mục ⇒ phiếu khác giữ được giao dịch cũ, và phiếu cũ đề nghị được giao dịch khác.
    await db.posSaiMaYeuCau.updateMany({
      where: { intentId: INT1 },
      data: { trangThai: "TU_CHOI", nguoiQuyetId: KT, quyetLuc: LUC, lyDoTuChoi: "không phải giao dịch của khách" },
    });
    expect(await loiDayDu(ghiYc({ intentId: INT3, bankTransactionId: BT1 })), "nhả giao dịch").toBeNull();
    expect(await loiDayDu(ghiYc({ intentId: INT1, bankTransactionId: BT2 })), "nhả phiếu").toBeNull();
    expect(await db.posSaiMaYeuCau.count()).toBe(3);
  });

  it("[HN3-MIG-03] @@unique([intentId, bankTransactionId]): đúng cặp đã bị bác KHÔNG đề nghị lại được (chặn vòng lặp); cặp khác thì được", async () => {
    await ghiYc({
      trangThai: "TU_CHOI",
      nguoiQuyetId: KT,
      quyetLuc: LUC,
      lyDoTuChoi: "không phải giao dịch của khách",
    });
    // Hai chỉ mục từng phần đã nhả (TU_CHOI) ⇒ chỉ còn chỉ mục CẶP chặn.
    expect(await loiDayDu(ghiYc())).toMatch(CHI_CAP);
    // Đối chứng dương: cặp khác (cùng phiếu, giao dịch khác) ghi được.
    expect(await loiDayDu(ghiYc({ bankTransactionId: BT2 }))).toBeNull();
  });

  it("[HN3-MIG-04] NĂM CHECK chặn thật — mỗi ca kèm đối chứng dương", async () => {
    // (1) tu_choi_check: TU_CHOI phải có người + lúc + lý do ≥ 5 ký tự (sau khi bỏ khoảng trắng hai đầu).
    const tc = { trangThai: "TU_CHOI" as const };
    expect(await loiDayDu(ghiYc({ ...tc }))).toMatch(/PosSaiMaYeuCau_tu_choi_check/);
    expect(await loiDayDu(ghiYc({ ...tc, nguoiQuyetId: KT, quyetLuc: LUC }))).toMatch(/PosSaiMaYeuCau_tu_choi_check/);
    expect(await loiDayDu(ghiYc({ ...tc, nguoiQuyetId: KT, quyetLuc: LUC, lyDoTuChoi: "  ab  " }))).toMatch(/PosSaiMaYeuCau_tu_choi_check/);
    expect(await loiDayDu(ghiYc({ ...tc, nguoiQuyetId: KT, quyetLuc: LUC, lyDoTuChoi: "đúng 5" }))).toBeNull();
    await db.posSaiMaYeuCau.deleteMany({});

    // (2) khac_nguoi_check: người quyết ≠ người gửi.
    expect(await loiDayDu(ghiYc({ trangThai: "DANG_GHI", dangGhiLuc: LUC, nguoiQuyetId: SALE }))).toMatch(/PosSaiMaYeuCau_khac_nguoi_check/);
    expect(await loiDayDu(ghiYc({ trangThai: "DANG_GHI", dangGhiLuc: LUC, nguoiQuyetId: KT }))).toBeNull();
    await db.posSaiMaYeuCau.deleteMany({});

    // (3) ly_do_check: CHO_KE_TOAN phải nói vì sao.
    expect(await loiDayDu(ghiYc({ lyDo: "" }))).toMatch(/PosSaiMaYeuCau_ly_do_check/);
    expect(await loiDayDu(ghiYc({ kieu: "TU_GHI_NHAN", trangThai: "DANG_GHI", dangGhiLuc: LUC, lyDo: "" }))).toBeNull();
    await db.posSaiMaYeuCau.deleteMany({});

    // (4) dang_ghi_check: DANG_GHI phải có mốc.
    expect(await loiDayDu(ghiYc({ kieu: "TU_GHI_NHAN", trangThai: "DANG_GHI", lyDo: "" }))).toMatch(/PosSaiMaYeuCau_dang_ghi_check/);
    expect(await loiDayDu(ghiYc({ kieu: "TU_GHI_NHAN", trangThai: "DANG_GHI", lyDo: "", dangGhiLuc: LUC }))).toBeNull();
    await db.posSaiMaYeuCau.deleteMany({});

    // (5) nguoi_duyet_check: yêu cầu CHO_KE_TOAN đã đi qua bước duyệt (đang ghi / đã ghi) phải nêu người duyệt.
    expect(await loiDayDu(ghiYc({ trangThai: "DA_GHI_NHAN" }))).toMatch(/PosSaiMaYeuCau_nguoi_duyet_check/);
    expect(await loiDayDu(ghiYc({ trangThai: "DANG_GHI", dangGhiLuc: LUC }))).toMatch(/PosSaiMaYeuCau_nguoi_duyet_check/);
    expect(await loiDayDu(ghiYc({ trangThai: "DA_GHI_NHAN", nguoiQuyetId: KT, quyetLuc: LUC }))).toBeNull();
    await db.posSaiMaYeuCau.deleteMany({});
    // …còn TU_GHI_NHAN không qua kế toán nên KHÔNG đòi người duyệt.
    expect(await loiDayDu(ghiYc({ kieu: "TU_GHI_NHAN", trangThai: "DA_GHI_NHAN", lyDo: "" }))).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HN3-MIG-05] khoá ngoại: yêu cầu giữ dấu một khoản tiền thật — RESTRICT cả bốn", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("xoá phiếu POS / giao dịch / người gửi / người quyết còn yêu cầu trỏ vào ⇒ bị chặn; yêu cầu còn nguyên", async () => {
    // Người GỬI là `KT` (không phải `SALE`: SALE còn là người tạo phiếu POS nên xoá SALE bị chặn bởi khoá ngoại KHÁC, không phải của bảng này).
    await ghiYc({ nguoiGuiId: KT, trangThai: "DANG_GHI", dangGhiLuc: LUC, nguoiQuyetId: KT_XOA });
    expect(await loiDayDu(db.posPaymentIntent.delete({ where: { id: INT1 } }))).toMatch(/PosSaiMaYeuCau_intentId_fkey/);
    expect(await loiDayDu(db.bankTransaction.delete({ where: { id: BT1 } }))).toMatch(/PosSaiMaYeuCau_bankTransactionId_fkey/);
    expect(await loiDayDu(db.user.delete({ where: { id: KT } }))).toMatch(/PosSaiMaYeuCau_nguoiGuiId_fkey/);
    expect(await loiDayDu(db.user.delete({ where: { id: KT_XOA } }))).toMatch(/PosSaiMaYeuCau_nguoiQuyetId_fkey/);
    expect(await db.posSaiMaYeuCau.count({ where: { intentId: INT1 } })).toBe(1);
  });

  it("khoá ngoại sang phiếu POS / giao dịch KHÔNG tồn tại ⇒ bị chặn P2003", async () => {
    for (const o of [{ intentId: `${T}khong-co` }, { bankTransactionId: `${T}khong-co` }]) {
      const loi = await ghiYc(o)
        .then(() => null)
        .catch((e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e)));
      expect(loi).toBe("P2003");
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HN3-SC-01] scopedDb cách ly yêu cầu theo cơ sở", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("actor neo CS1 KHÔNG thấy yêu cầu CS2 — THẤY yêu cầu CS1 (đối chứng dương); actor HO thấy cả hai", async () => {
    const a = await ghiYc();
    const b = await ghiYc({ intentId: INT2, bankTransactionId: BT2, centerId: CS2 });
    const loc = { where: { intentId: { in: [INT1, INT2] } }, select: { id: true as const } };

    const thay1 = await scopedDb(actorCoSo(CS1)).posSaiMaYeuCau.findMany(loc);
    expect(thay1.map((x) => x.id)).toEqual([a.id]);
    const thay2 = await scopedDb(actorCoSo(CS2)).posSaiMaYeuCau.findMany(loc);
    expect(thay2.map((x) => x.id)).toEqual([b.id]);
    const ho = await scopedDb(actorHo()).posSaiMaYeuCau.findMany(loc);
    expect(ho.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });
});
