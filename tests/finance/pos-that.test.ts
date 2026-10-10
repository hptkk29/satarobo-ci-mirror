// tests/finance/pos-that.test.ts — NHẬP HAI FILE SmartPOS THẬT (đã che) vào sổ tiền. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// `pnpm test:unit` trần sẽ SKIP. Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo
// mã giao dịch của file thật + tiền tố id — cùng khuôn `tests/finance/pos-the.test.ts`.
//
// Khác `pos-the.test.ts` ở ĐẦU VÀO: bộ kia gõ tay từng `DongPos`, bộ này đi đúng đường màn
// import đi — byte zip của ngân hàng (`dungZipThat`, giữ data descriptor) → `docFilePos` →
// `catLoPos` (Thanh toán trước Hủy, cắt lô) → qua `dongPosNhapSchema` / `dongHuyPosSchema` như
// `nhapLoPosAction` → `nhapLoPos`. Chỉ bỏ vế `auth()` của action (không có phiên trong vitest).
//
// Fixture: `tests/fixtures/pos/smartpos-that.ts` — 11 dòng thật ngày 29/09/2026, 2 máy:
//   CS1 (máy …3321): 1 thành công · 1 thất bại · 1 cặp Thanh toán + Hủy          = 4 dòng
//   CS2 (máy …3322): 2 thành công · 3 thất bại · 1 cặp Thanh toán + Hủy          = 7 dòng
// Cơ sở của từng dòng lấy theo MÃ THIẾT BỊ (bảng `PosTerminal`), không theo file.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { buildActor, type Actor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { docFilePos } from "@/lib/payments/pos/doc-file-pos";
import { catLoPos } from "@/lib/payments/pos/cat-lo-pos";
import { nhapLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, dongHuyPosSchema, dongPosNhapSchema } from "@/lib/payments/pos/kieu";
import {
  DONG_CS1,
  DONG_CS2,
  MAY_CS1,
  MAY_CS2,
  THU_MUC_CS1,
  THU_MUC_CS2,
  dungZipThat,
  type DongThat,
} from "@/tests/fixtures/pos/smartpos-that";

if (!RUN_DB_TESTS) console.warn(`[POS-THAT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-posthat-";
const ACTOR_AUDIT = { id: `${T}actor`, name: "Kế toán fixture POS thật" };
const USER = `${T}user`;
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON = `${T}don`;
const ITEM = `${T}item`;
const DOT = `${T}dot`;

const MA = (d: DongThat) => String(d["Mã giao dịch"]);
const MA_CS1 = DONG_CS1.map(MA);
const MA_CS2 = DONG_CS2.map(MA);
const MA_TAT_CA = [...MA_CS1, ...MA_CS2];

const laThanhCong = (d: DongThat) => d["Trạng thái giao dịch"] === "Thành công";
const laThanhToan = (d: DongThat) => d["Loại giao dịch"] === "Thanh toán";
const biHuyToanPhan = (d: DongThat) => String(d["Trạng thái Hoàn/Hủy"] ?? "") !== "";

/** Dòng "Thanh toán + Thành công + Hoàn/Hủy trống" — đúng tập được sinh `BankTransaction`. */
const MA_THU_CS1 = DONG_CS1.filter((d) => laThanhToan(d) && laThanhCong(d) && !biHuyToanPhan(d)).map(MA);
const MA_THU_CS2 = DONG_CS2.filter((d) => laThanhToan(d) && laThanhCong(d) && !biHuyToanPhan(d)).map(MA);
const MA_GOC_BI_HUY = [...DONG_CS1, ...DONG_CS2].filter((d) => laThanhToan(d) && biHuyToanPhan(d)).map(MA);
const MA_DONG_HUY = [...DONG_CS1, ...DONG_CS2].filter((d) => d["Loại giao dịch"] === "Hủy").map(MA);
const MA_THAT_BAI = [...DONG_CS1, ...DONG_CS2].filter((d) => !laThanhCong(d)).map(MA);

// Tách thân FIXTURE khỏi thân BỘ CA: đếm sai ở đây thì mọi ca dưới kiểm một file khác file thật.
function kiemFixture() {
  expect(MA_CS1).toHaveLength(4);
  expect(MA_CS2).toHaveLength(7);
  expect(MA_THU_CS1).toHaveLength(1);
  expect(MA_THU_CS2).toHaveLength(2);
  expect(MA_GOC_BI_HUY).toHaveLength(2);
  expect(MA_DONG_HUY).toHaveLength(2);
  expect(MA_THAT_BAI).toHaveLength(4);
}

// ── Dọn / dựng ─────────────────────────────────────────────────────────────────

async function don() {
  await db.auditLog.deleteMany({ where: { actorId: ACTOR_AUDIT.id } });
  await db.auditLog.deleteMany({ where: { entityType: "Order", entityId: DON } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: DON } } });
  await db.paymentAllocation.deleteMany({
    where: { bankTransaction: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA_TAT_CA } } },
  });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { in: MA_TAT_CA } } });
  await db.posImportBatch.deleteMany({ where: { importedById: USER } });
  await db.posTerminal.deleteMany({ where: { maThietBi: { in: [MAY_CS1, MAY_CS2] } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: DON } } });
  await db.paymentBill.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.bankTransaction.deleteMany({ where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA_TAT_CA } } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.user.deleteMany({ where: { id: USER } });
}

async function dungFixture() {
  await don();
  await db.user.create({
    data: { id: USER, name: "Kế toán HO fixture", email: `${USER}@test.local`, role: "ACCOUNTANT", roles: ["ACCOUNTANT"] },
  });
  await db.center.create({ data: { id: CS1, name: "Cơ sở 1 fixture", slug: `${T}cs1`, address: "211 Nguyễn Hữu Thọ" } });
  await db.center.create({ data: { id: CS2, name: "Cơ sở 2 fixture", slug: `${T}cs2`, address: "114 Hoàng Diệu" } });
}

async function khaiMay(maThietBi: string, centerId: string, maQuay: string) {
  await db.posTerminal.create({ data: { maThietBi, maQuay, centerId } });
}

// ── Đường màn import: zip → docFilePos → catLoPos → schema của action → nhapLoPos ─────

const loSchema = z.object({ dong: z.array(dongPosNhapSchema), dongHuyCuaFile: z.array(dongHuyPosSchema) });

type TongLuot = { batchId: string; moi: number; capNhat: number; tuKhop: number; canXuLy: number; boQua: number };

async function nhapFile(
  thuMuc: string,
  dongs: readonly DongThat[],
  gioiHan?: { dong: number; byte: number },
): Promise<TongLuot> {
  const kq = await docFilePos(await dungZipThat(thuMuc, [dongs]), "29092026_USER_TXN.zip");
  if (!kq.ok) throw new Error(`docFilePos từ chối: ${kq.loi} — thiếu ${kq.cotThieu.join(", ")}`);
  const batch = await db.posImportBatch.create({ data: { tenFile: "29092026_USER_TXN.zip", importedById: USER } });
  const tong: TongLuot = { batchId: batch.id, moi: 0, capNhat: 0, tuKhop: 0, canXuLy: 0, boQua: 0 };
  for (const [i, lo] of catLoPos(kq.dong, gioiHan).entries()) {
    const p = loSchema.parse(lo); // như `nhapLoSchema` của `nhapLoPosAction` (che số thẻ ở đây)
    const r = await nhapLoPos({ batchId: batch.id, lo: i + 1, dong: p.dong, dongHuyCuaFile: p.dongHuyCuaFile, nguoiNhapId: USER });
    expect(r.loi, "không dòng nào được lỗi").toEqual([]);
    tong.moi += r.moi;
    tong.capNhat += r.capNhat;
    tong.tuKhop += r.tuKhop;
    tong.canXuLy += r.canXuLy;
    tong.boQua += r.boQua;
  }
  return tong;
}

const nhapCs1 = (g?: { dong: number; byte: number }) => nhapFile(THU_MUC_CS1, DONG_CS1, g);
const nhapCs2 = (dongs: readonly DongThat[] = DONG_CS2, g?: { dong: number; byte: number }) =>
  nhapFile(THU_MUC_CS2, dongs, g);

const posRow = (ma: string) =>
  db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: ma }, include: { bankTransaction: true } });
const btCuaFile = () =>
  db.bankTransaction.findMany({ where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA_TAT_CA } } });
const soPaymentCuaFile = () =>
  db.payment.count({ where: { OR: MA_TAT_CA.map((m) => ({ note: { contains: `[auto:card_pos:${m}]` } })) } });

// ── Actor cho ca cách ly — `buildActor` THẬT trên cây HO → REGION → CENTER ─────────────
const NOW = new Date("2026-09-29T05:00:00Z");
const ORG: OrgUnitNode[] = [
  { id: `${T}ou-ho`, code: "HO", type: "HO", parentId: null, centerId: null },
  { id: `${T}ou-dn`, code: "DANANG", type: "REGION", parentId: `${T}ou-ho`, centerId: null },
  { id: `${T}ou-cs1`, code: "CS1", type: "CENTER", parentId: `${T}ou-dn`, centerId: CS1 },
  { id: `${T}ou-cs2`, code: "CS2", type: "CENTER", parentId: `${T}ou-dn`, centerId: CS2 },
];
// `payments:*` seed GLOBAL cho cả vai cấp cơ sở (prisma/seed-roles.ts) — tầm nhìn cơ sở đến
// từ NƠI NEO VAI, không từ scopeType (CLAUDE.md, mục PaymentMethod). Dựng đúng như vậy.
function vai(orgUnitId: string, code: string): UserOrgRoleRow {
  return {
    orgUnitId,
    roleId: `${T}role-${code}`,
    status: "ACTIVE",
    effectiveFrom: new Date("2000-01-01"),
    effectiveTo: null,
    role: { code, isActive: true, permissions: [{ action: "payments:view", scopeType: "GLOBAL" }] },
  };
}
const actorTai = (orgUnitId: string, code: string): Actor =>
  buildActor({ userId: `${T}nguoi-${code}`, rows: [vai(orgUnitId, code)], orgNodes: ORG, now: NOW });

async function nhinThay(actor: Actor) {
  const sdb = scopedDb(actor);
  const pos = await sdb.posCardTransaction.findMany({ where: { maGiaoDich: { in: MA_TAT_CA } }, select: { maGiaoDich: true } });
  const bt = await sdb.bankTransaction.findMany({
    where: { provider: PROVIDER_THE_POS, providerTxnId: { in: MA_TAT_CA } },
    select: { providerTxnId: true },
  });
  return {
    pos: new Set(pos.map((r) => r.maGiaoDich)),
    bt: new Set(bt.map((r) => r.providerTxnId)),
  };
}

describe.skipIf(!RUN_DB_TESTS)("[POS-THAT-DB] hai file SmartPOS thật — DB thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS-THAT-DB-00] fixture: đúng hình dạng hai file thật 29/09", () => {
    kiemFixture();
  });

  it("[POS-THAT-DB-01] khai 2 máy, import 2 file ⇒ 11 dòng; 3 giao dịch sổ đúng cơ sở; cặp hủy BO_QUA; 0 Payment", async () => {
    await khaiMay(MAY_CS1, CS1, "QTT45XWQT");
    await khaiMay(MAY_CS2, CS2, "QTTFBKATK");
    const k1 = await nhapCs1();
    const k2 = await nhapCs2();
    // Số màn import hiện cho người dùng (cộng các lô) — không có dòng nào "cần xử lý" oan.
    expect(k1).toMatchObject({ moi: 4, capNhat: 0, tuKhop: 0, canXuLy: 1, boQua: 3 });
    expect(k2).toMatchObject({ moi: 7, capNhat: 0, tuKhop: 0, canXuLy: 2, boQua: 5 });

    expect(await db.posCardTransaction.count({ where: { maGiaoDich: { in: MA_TAT_CA } } })).toBe(11);

    // BankTransaction CHỈ cho 3 dòng thành công chưa hủy, cơ sở theo MÁY.
    const bt = await btCuaFile();
    expect(bt.map((b) => b.providerTxnId).sort()).toEqual([...MA_THU_CS1, ...MA_THU_CS2].sort());
    for (const b of bt) {
      expect(b.status).toBe("UNMATCHED");
      expect(b.amount).toBe(2000);
      expect(b.centerId, `giao dịch ${b.providerTxnId}`).toBe(MA_THU_CS1.includes(b.providerTxnId) ? CS1 : CS2);
    }

    // Cặp Thanh toán + Hủy ⇒ gốc BO_QUA, KHÔNG có giao dịch sống; dòng hủy kết luận xong.
    for (const m of MA_GOC_BI_HUY) {
      const r = await posRow(m);
      expect(r.matchStatus, `gốc ${m}`).toBe("BO_QUA");
      expect(r.bankTransaction === null || r.bankTransaction.status === "IGNORED", `gốc ${m} không có giao dịch sống`).toBe(true);
    }
    for (const m of MA_DONG_HUY) {
      const r = await posRow(m);
      expect(r.matchStatus, `dòng hủy ${m}`).toBe("BO_QUA");
      expect(r.matchReason).toContain("Hủy giao dịch gốc");
      expect(r.bankTransactionId, "dòng hủy không bao giờ sinh giao dịch").toBeNull();
    }
    for (const m of MA_THAT_BAI) {
      const r = await posRow(m);
      expect(r.matchStatus, `thất bại ${m}`).toBe("BO_QUA");
      expect(r.bankTransactionId).toBeNull();
    }
    // Đúng file thật hôm 29/09: dòng thành công không mang mã phiếu ⇒ CAN_XU_LY.
    for (const m of [...MA_THU_CS1, ...MA_THU_CS2]) {
      const r = await posRow(m);
      expect(r.matchStatus, `thành công ${m}`).toBe("CAN_XU_LY");
      expect(r.matchReason).toContain("Không có mã phiếu");
      expect(r.centerId).toBe(MA_THU_CS1.includes(m) ? CS1 : CS2);
    }
    // Mọi dòng POS mang cơ sở của máy.
    for (const m of MA_CS1) expect((await posRow(m)).centerId, m).toBe(CS1);
    for (const m of MA_CS2) expect((await posRow(m)).centerId, m).toBe(CS2);

    expect(await soPaymentCuaFile()).toBe(0);
    // Không số thẻ nào (kể cả bản che) lọt vào rawPayload.
    for (const b of bt) expect(JSON.stringify(b.rawPayload)).not.toMatch(/\*\*|4111|5555/);
  });

  it("[POS-THAT-DB-01b] cắt lô 1 DÒNG/lô ⇒ số màn import vẫn đúng (Thanh toán trước Hủy trên cả file)", async () => {
    // File ngân hàng xếp giờ GIẢM DẦN ⇒ dòng Hủy đứng TRƯỚC gốc. Lô 1 dòng khiến thứ tự lô là
    // thứ duy nhất quyết định: không xếp Thanh toán trước Hủy thì dòng Hủy vào lô trước gốc,
    // bị đếm "cần xử lý" ("Chưa thấy giao dịch gốc") dù server xét lại nó sau.
    await khaiMay(MAY_CS1, CS1, "QTT45XWQT");
    await khaiMay(MAY_CS2, CS2, "QTTFBKATK");
    const motDong = { dong: 1, byte: 600_000 };
    expect(await nhapCs1(motDong)).toMatchObject({ moi: 4, canXuLy: 1, boQua: 3 });
    expect(await nhapCs2(DONG_CS2, motDong)).toMatchObject({ moi: 7, canXuLy: 2, boQua: 5 });
    for (const m of MA_DONG_HUY) expect((await posRow(m)).matchStatus, `dòng hủy ${m}`).toBe("BO_QUA");
  });

  it("[POS-THAT-DB-02] import lại cả 2 file ⇒ 0 dòng mới, 0 giao dịch mới, 0 Payment", async () => {
    await khaiMay(MAY_CS1, CS1, "QTT45XWQT");
    await khaiMay(MAY_CS2, CS2, "QTTFBKATK");
    await nhapCs1();
    await nhapCs2();
    const bt1 = (await btCuaFile()).map((b) => b.id).sort();

    const l1 = await nhapCs1();
    const l2 = await nhapCs2();
    expect(l1.moi + l2.moi).toBe(0);
    expect(l1.capNhat + l2.capNhat).toBe(11);
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: { in: MA_TAT_CA } } })).toBe(11);
    expect((await btCuaFile()).map((b) => b.id).sort(), "cùng 3 giao dịch, không tạo đôi").toEqual(bt1);
    expect(bt1).toHaveLength(3);
    expect(await soPaymentCuaFile()).toBe(0);
    // Trạng thái không trôi sau lượt hai.
    for (const m of [...MA_THU_CS1, ...MA_THU_CS2]) expect((await posRow(m)).matchStatus).toBe("CAN_XU_LY");
    for (const m of [...MA_GOC_BI_HUY, ...MA_DONG_HUY, ...MA_THAT_BAI]) expect((await posRow(m)).matchStatus).toBe("BO_QUA");
  });

  it("[POS-THAT-DB-03] CÁCH LY CƠ SỞ: kế toán CS1 chỉ thấy CS1; CS2 chỉ thấy CS2; kế toán HO thấy cả hai", async () => {
    await khaiMay(MAY_CS1, CS1, "QTT45XWQT");
    await khaiMay(MAY_CS2, CS2, "QTTFBKATK");
    await nhapCs1();
    await nhapCs2();

    const ktCs1 = actorTai(`${T}ou-cs1`, "CENTER_ACCOUNTANT");
    const ktCs2 = actorTai(`${T}ou-cs2`, "CENTER_ACCOUNTANT");
    const ktHo = actorTai(`${T}ou-ho`, "HO_ACCOUNTANT");
    // Dựng actor đúng như mong đợi — không thì ca dưới kiểm một actor khác.
    expect(ktCs1.isHoLevel).toBe(false);
    expect(ktCs1.visibleCenterIds).toEqual([CS1]);
    expect(ktHo.isHoLevel).toBe(true);

    const n1 = await nhinThay(ktCs1);
    expect(n1.pos).toEqual(new Set(MA_CS1));
    expect(n1.bt).toEqual(new Set(MA_THU_CS1));
    for (const m of MA_CS2) expect(n1.pos.has(m), `CS1 KHÔNG thấy dòng ${m} của CS2`).toBe(false);

    const n2 = await nhinThay(ktCs2);
    expect(n2.pos).toEqual(new Set(MA_CS2));
    expect(n2.bt).toEqual(new Set(MA_THU_CS2));

    // Đối chứng DƯƠNG: kế toán HO thấy đủ cả hai file.
    const nHo = await nhinThay(ktHo);
    expect(nHo.pos).toEqual(new Set(MA_TAT_CA));
    expect(nHo.bt).toEqual(new Set([...MA_THU_CS1, ...MA_THU_CS2]));

    // findUnique (IDOR) cũng chặn chéo cơ sở.
    const mCs2 = MA_THU_CS2[0]!;
    expect(await scopedDb(ktCs1).posCardTransaction.findUnique({ where: { maGiaoDich: mCs2 } })).toBeNull();
    expect(await scopedDb(ktCs2).posCardTransaction.findUnique({ where: { maGiaoDich: mCs2 } })).not.toBeNull();
  });

  it("[POS-THAT-DB-04] dòng thành công CS2 mang mã phiếu OPEN 2.000đ ⇒ TU_KHOP, Payment card_pos, paidDate = giờ quẹt thật", async () => {
    await khaiMay(MAY_CS1, CS1, "QTT45XWQT");
    await khaiMay(MAY_CS2, CS2, "QTTFBKATK");
    await db.order.create({
      data: {
        id: DON,
        code: "ORD-260929-000888",
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture POS thật",
        customerPhone: "0900000001",
        totalAmount: 2000,
        centerId: CS2,
      },
    });
    await db.orderItem.create({
      data: { id: ITEM, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Bé POS thật", quantity: 1, unitPrice: 2000, totalPrice: 2000 },
    });
    await db.paymentRequest.create({
      data: { id: DOT, orderId: DON, orderItemId: ITEM, centerId: CS2, installmentNo: 1, amountDue: 2000, status: "PENDING", sortOrder: 1 },
    });
    const r = await taoPhieuGop({ orderId: DON, paymentRequestIds: [DOT], actor: ACTOR_AUDIT });
    if (!r.ok) throw new Error(`fixture: không phát được phiếu — ${r.error}`);
    const bill = await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } });
    expect(bill.status).toBe("OPEN");
    expect(bill.matchKey).toBe(r.ma);

    // Sửa đúng MỘT ô "Diễn giải đơn hàng" của một dòng thành công thật — mọi ô khác giữ nguyên.
    const goc = DONG_CS2.find((d) => MA(d) === MA_THU_CS2[0])!;
    const dongSua = DONG_CS2.map((d) => (d === goc ? { ...d, "Diễn giải đơn hàng": `Kiet 0900000001 ${r.ma}` } : d));
    await nhapCs1();
    const k2 = await nhapCs2(dongSua);
    expect(k2).toMatchObject({ moi: 7, tuKhop: 1, canXuLy: 1, boQua: 5 });

    const row = await posRow(MA(goc));
    expect(row.matchStatus).toBe("TU_KHOP");
    expect(row.maPhieu).toBe(r.ma);
    expect(row.centerId).toBe(CS2);
    expect(row.bankTransaction?.status).toBe("MATCHED");
    expect(row.bankTransaction?.centerId).toBe(CS2);

    const khoan = await db.payment.findMany({ where: { orderId: DON } });
    expect(khoan).toHaveLength(1);
    expect(khoan[0]!.amount).toBe(2000);
    expect(khoan[0]!.method).toBe("card_pos");
    expect(khoan[0]!.note ?? "").toContain(`[auto:card_pos:${MA(goc)}]`);
    // Giờ quẹt THẬT của dòng đó: "2026/09/29 17:31:35" giờ VN.
    expect(String(goc["Thời gian giao dịch"])).toBe("2026/09/29 17:31:35");
    expect(khoan[0]!.paidDate?.toISOString()).toBe(new Date("2026-09-29T17:31:35+07:00").toISOString());
    expect((await db.paymentBill.findFirstOrThrow({ where: { orderId: DON } })).status).toBe("PAID");

    // Dòng thành công KIA của CS2 và dòng CS1 vẫn chờ xử lý — mã chỉ ăn đúng dòng mang nó.
    expect((await posRow(MA_THU_CS2[1]!)).matchStatus).toBe("CAN_XU_LY");
    expect((await posRow(MA_THU_CS1[0]!)).matchStatus).toBe("CAN_XU_LY");
    expect(await soPaymentCuaFile()).toBe(1);
  });

  it("[POS-THAT-DB-05] import CS2 khi CHƯA khai máy ⇒ CAN_XU_LY 'Thiết bị chưa gán cơ sở', giao dịch NULL cơ sở; khai máy + import lại ⇒ gán CS2", async () => {
    await khaiMay(MAY_CS1, CS1, "QTT45XWQT");
    const k = await nhapCs2();
    expect(k).toMatchObject({ moi: 7, tuKhop: 0, canXuLy: 2, boQua: 5 });
    for (const m of MA_THU_CS2) {
      const r = await posRow(m);
      expect(r.matchStatus, m).toBe("CAN_XU_LY");
      expect(r.matchReason).toBe("Thiết bị chưa gán cơ sở");
      expect(r.centerId).toBeNull();
      expect(r.bankTransaction?.status).toBe("UNMATCHED");
      expect(r.bankTransaction?.centerId, "giao dịch chưa biết cơ sở").toBeNull();
    }
    // Gốc bị hủy toàn phần vẫn BO_QUA — luật 3 đứng trước luật 5.
    for (const m of MA_GOC_BI_HUY.filter((x) => MA_CS2.includes(x))) expect((await posRow(m)).matchStatus).toBe("BO_QUA");
    expect((await btCuaFile()).map((b) => b.providerTxnId).sort()).toEqual([...MA_THU_CS2].sort());

    await khaiMay(MAY_CS2, CS2, "QTTFBKATK");
    const lai = await nhapCs2();
    expect(lai).toMatchObject({ moi: 0, capNhat: 7, canXuLy: 2 });
    const bt = await btCuaFile();
    expect(bt).toHaveLength(2);
    for (const b of bt) {
      expect(b.centerId, b.providerTxnId).toBe(CS2);
      expect(b.status).toBe("UNMATCHED");
    }
    for (const m of MA_THU_CS2) {
      const r = await posRow(m);
      expect(r.centerId).toBe(CS2);
      expect(r.matchReason).toContain("Không có mã phiếu");
    }
    // MỌI dòng của máy vừa khai nhận cơ sở — kể cả dòng Hủy đã kết luận (BO_QUA), đi nhánh "đã
    // kết luận chỉ cập nhật kết toán". Mã TRƯỚC bản vá: nhánh đó không đặt cơ sở ⇒ dòng Hủy
    // NULL mãi (NULL_IS_GLOBAL ⇒ mọi cơ sở đọc được).
    for (const m of MA_CS2) expect((await posRow(m)).centerId, `dòng ${m} sau khi khai máy`).toBe(CS2);
    expect(await soPaymentCuaFile()).toBe(0);
  });
});
