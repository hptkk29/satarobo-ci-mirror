// Ca [POS4-MIG-02] · [POS4-AUTH-02] · [POS4-SC-02] — năm bảng của đầu nhận POS Agent (GĐ4) trên
// POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Vì sao phải đo ở DB (F5 GĐ1): Prisma 5.22 `migrate diff` KHÔNG in CHECK ⇒ kiểm drift "0 dòng" không
// chứng minh chúng tồn tại; lưới `[POS4-MIG-01]` chỉ chứng minh câu SQL còn nằm trong tệp. Một biểu thức
// CHECK viết sai vẫn khớp regex mà không chặn gì — bộ này đo HÀNH VI.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { donNonceCu } from "@/lib/payments/pos/agent/giam-sat";

if (!RUN_DB_TESTS) console.warn(`[POS4-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos4sc-";
const PFX = "FXPOS4SC";
const USER = `${T}user`;
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const PHIEU1 = `${T}bill1`;
const PHIEU2 = `${T}bill2`;
const PHIEU_POS1 = `${T}intent1`;
const PHIEU_POS2 = `${T}intent2`;
const AG1 = "fxpos4scagentcs10000001";
const AG2 = "fxpos4scagentcs20000002";
const BAM = "a".repeat(64);

/** Đồng hồ ĐÓNG BĂNG (luật 19). */
const LUC = new Date("2026-10-07T03:15:00Z");
const HAN = new Date("2026-10-08T03:15:00Z");
const PHUT = 60_000;

async function don() {
  await db.posAgentNonce.deleteMany({ where: { agentId: { in: [AG1, AG2] } } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCheckJob.deleteMany({ where: { agentId: { in: [AG1, AG2] } } });
  await db.posAgentEvent.deleteMany({ where: { agentId: { in: [AG1, AG2] } } });
  await db.posPaymentIntent.deleteMany({ where: { id: { in: [PHIEU_POS1, PHIEU_POS2] } } });
  await db.posAgent.deleteMany({ where: { id: { in: [AG1, AG2] } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: [DON1, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON1, DON2] } } });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.user.deleteMany({ where: { id: USER } });
}

async function dungFixture() {
  await don();
  await db.user.create({ data: { id: USER, name: "Admin fixture POS4", email: `${USER}@test.local`, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] } });
  for (const [id, ten, code] of [
    [CS1, "CS1 fixture POS4SC", "FXP4S-CS1"],
    [CS2, "CS2 fixture POS4SC", "FXP4S-CS2"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, code, address: "211 Nguyễn Hữu Thọ" } });
  }
  // CS1 có đơn vị ⇒ ghi kép tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture POS4", centerId: CS1 } });
  await db.posAgent.create({ data: { id: AG1, centerId: CS1, merchantCode: "FXP4SCAA", createdById: USER } });
  await db.posAgent.create({ data: { id: AG2, centerId: CS2, merchantCode: "FXP4SCBB", createdById: USER } });
  for (const [id, cs, ma, sdt] of [
    [DON1, CS1, "ORD-269964-000001", "0328545241"],
    [DON2, CS2, "ORD-269964-000002", "0905123469"],
  ] as const) {
    await db.order.create({
      data: { id, code: ma, type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH fixture POS4", customerPhone: sdt, totalAmount: 6_732_000, centerId: cs },
    });
  }
  await db.paymentBill.create({ data: { id: PHIEU1, orderId: DON1, centerId: CS1, amountDue: 3_168_000, matchKey: "K7M2N" } });
  await db.paymentBill.create({ data: { id: PHIEU2, orderId: DON2, centerId: CS2, amountDue: 3_564_000, matchKey: "Q4W8R" } });
  await db.posPaymentIntent.create({
    data: { id: PHIEU_POS1, paymentBillId: PHIEU1, code5: "K7M2N", amount: 3_168_000, centerId: CS1, createdById: USER, createdAt: LUC, expiresAt: HAN },
  });
  await db.posPaymentIntent.create({
    data: { id: PHIEU_POS2, paymentBillId: PHIEU2, code5: "Q4W8R", amount: 3_564_000, centerId: CS2, createdById: USER, createdAt: LUC, expiresAt: HAN },
  });
}

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
    userId: USER,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "payments:import-pos", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] },
    ],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

function actorHo(): Actor {
  return {
    userId: USER,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [
      { action: "payments:import-pos", scopeType: "GLOBAL", orgUnitId: "ou-ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" },
    ],
    visibleCenterIds: [CS1, CS2],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

const nguon = (o: { ma: string; nguon?: "FILE" | "AGENT"; agent?: string | null; centerId?: string | null; tuChoi?: string | null; bam?: string }) =>
  db.posTxnSource.create({
    data: {
      maGiaoDich: o.ma,
      nguon: o.nguon ?? "AGENT",
      posAgentId: o.agent === undefined ? AG1 : o.agent,
      lanDauThay: LUC,
      lanCuoiThay: LUC,
      bam: o.bam ?? BAM,
      tuChoi: o.tuChoi ?? null,
      centerId: o.centerId === undefined ? CS1 : o.centerId,
    },
  });

describe.skipIf(!RUN_DB_TESTS)("[POS4-MIG-02] năm bảng GĐ4 — các khoá mã ứng dụng DỰA VÀO", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS4-MIG-02a] RLS BẬT, không FORCE — cả năm bảng", async () => {
    const r = await db.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('PosAgent','PosAgentEvent','PosCheckJob','PosAgentNonce','PosTxnSource') AND relkind = 'r'
      ORDER BY relname`;
    expect(r).toEqual(
      ["PosAgent", "PosAgentEvent", "PosAgentNonce", "PosCheckJob", "PosTxnSource"].map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: false,
      })),
    );
  });

  it("[POS4-MIG-02b] bảy CHECK + bảy khoá ngoại đúng hành vi xoá (r = RESTRICT, n = SET NULL, c = CASCADE)", async () => {
    const chk = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid IN ('"PosAgent"'::regclass, '"PosAgentEvent"'::regclass, '"PosCheckJob"'::regclass,
                         '"PosAgentNonce"'::regclass, '"PosTxnSource"'::regclass)
        AND contype = 'c' ORDER BY conname`;
    expect(chk.map((x) => x.conname)).toEqual([
      "PosAgentEvent_ma_check",
      "PosAgent_merchantCode_check",
      "PosAgent_secretVersion_check",
      "PosCheckJob_doneAt_check",
      "PosTxnSource_bam_check",
      "PosTxnSource_nguon_check",
      "PosTxnSource_tuChoi_check",
    ]);
    const fk = await db.$queryRaw<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
      WHERE conrelid IN ('"PosAgent"'::regclass, '"PosAgentEvent"'::regclass, '"PosCheckJob"'::regclass,
                         '"PosAgentNonce"'::regclass, '"PosTxnSource"'::regclass)
        AND contype = 'f' ORDER BY conname`;
    expect(fk).toEqual([
      { conname: "PosAgentEvent_agentId_fkey", confdeltype: "r" },
      { conname: "PosAgentNonce_agentId_fkey", confdeltype: "c" },
      { conname: "PosAgent_centerId_fkey", confdeltype: "r" },
      { conname: "PosAgent_createdById_fkey", confdeltype: "n" },
      { conname: "PosCheckJob_agentId_fkey", confdeltype: "r" },
      { conname: "PosCheckJob_intentId_fkey", confdeltype: "r" },
      { conname: "PosTxnSource_posAgentId_fkey", confdeltype: "r" },
    ]);
  });

  it("[POS4-MIG-02c] PosCardTransaction: importBatchId / maKetToan / maLyDoThatBai đều NULLABLE", async () => {
    const r = await db.$queryRaw<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'PosCardTransaction' AND column_name IN ('importBatchId', 'maKetToan', 'maLyDoThatBai')
      ORDER BY column_name`;
    expect(r).toEqual([
      { column_name: "importBatchId", is_nullable: "YES" },
      { column_name: "maKetToan", is_nullable: "YES" },
      { column_name: "maLyDoThatBai", is_nullable: "YES" },
    ]);
    // Dòng KHÔNG có lô file (agent tạo) ghi được.
    const d = await db.posCardTransaction.create({
      data: {
        maGiaoDich: `${PFX}0001`,
        loaiGiaoDich: "Thanh toán",
        hinhThuc: "Thẻ",
        trangThai: "Thành công",
        soTien: 1,
        thoiGianGiaoDich: LUC,
        dienGiai: "",
        matchStatus: "CAN_XU_LY",
        maKetToan: "STL001",
        maLyDoThatBai: "USER_CANCELLED",
      },
    });
    expect(d.importBatchId).toBeNull();
  });

  it("[POS4-MIG-02d] CHECK chặn THẬT — đối chứng dương ngay cạnh", async () => {
    // merchantCode chữ thường / có ký tự lạ ⇒ chặn; IN HOA + số ⇒ qua.
    expect(await loiDayDu(db.posAgent.create({ data: { centerId: CS1, merchantCode: "nccph6ke" } }))).toMatch(/PosAgent_merchantCode_check/);
    expect(await loiDayDu(db.posAgent.create({ data: { centerId: CS1, merchantCode: "NCC-PH6" } }))).toMatch(/PosAgent_merchantCode_check/);
    expect(await loiDayDu(db.posAgent.create({ data: { centerId: CS1, merchantCode: "FXP4SCAA" } }))).toMatch(/PosAgent_merchantCode_key|Unique constraint/);
    expect(await loiDayDu(db.posAgent.update({ where: { id: AG1 }, data: { secretVersion: 0 } }))).toMatch(/PosAgent_secretVersion_check/);
    // Mã sự kiện: IN HOA + gạch dưới; khoaGop trùng ⇒ chặn.
    expect(
      await loiDayDu(db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "ERROR", ma: "loi-thuong", createdAt: LUC } })),
    ).toMatch(/PosAgentEvent_ma_check/);
    expect(
      await loiDayDu(db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "ERROR", ma: "HEADER_NOT_CAPTURED", khoaGop: `${T}k1`, createdAt: LUC } })),
    ).toBeNull();
    expect(
      await loiDayDu(db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "ERROR", ma: "HEADER_NOT_CAPTURED", khoaGop: `${T}k1`, createdAt: LUC } })),
    ).toMatch(/khoaGop|Unique constraint/);
    // Job: DONE ⇔ doneAt.
    const job = { intentId: PHIEU_POS1, agentId: AG1, centerId: CS1, tuLuc: LUC, createdAt: LUC };
    expect(await loiDayDu(db.posCheckJob.create({ data: { ...job, status: "DONE" } }))).toMatch(/PosCheckJob_doneAt_check/);
    expect(await loiDayDu(db.posCheckJob.create({ data: { ...job, status: "PENDING", doneAt: LUC } }))).toMatch(/PosCheckJob_doneAt_check/);
    expect(await loiDayDu(db.posCheckJob.create({ data: { ...job, status: "DONE", doneAt: LUC } }))).toBeNull();
    expect(await loiDayDu(db.posCheckJob.create({ data: { ...job, status: "EXPIRED" } }))).toBeNull();
    // Nguồn: AGENT ⇔ posAgentId; tuChoi chỉ AGENT; băm 64 hex thường.
    expect(await loiDayDu(nguon({ ma: `${PFX}A1`, agent: null }))).toMatch(/PosTxnSource_nguon_check/);
    expect(await loiDayDu(nguon({ ma: `${PFX}A2`, nguon: "FILE", agent: AG1 }))).toMatch(/PosTxnSource_nguon_check/);
    expect(await loiDayDu(nguon({ ma: `${PFX}A3`, nguon: "FILE", agent: null, tuChoi: "AMOUNT_MISMATCH" }))).toMatch(/PosTxnSource_tuChoi_check/);
    expect(await loiDayDu(nguon({ ma: `${PFX}A4`, bam: "A".repeat(64) }))).toMatch(/PosTxnSource_bam_check/);
    expect(await loiDayDu(nguon({ ma: `${PFX}A5` }))).toBeNull();
    expect(await loiDayDu(nguon({ ma: `${PFX}A5`, nguon: "FILE", agent: null }))).toBeNull();
    expect(await loiDayDu(nguon({ ma: `${PFX}A5` }))).toMatch(/maGiaoDich|Unique constraint/);
  });

  it("[POS4-MIG-02e] nonce: khoá (agentId, nonce) chặn lặp; xoá agent kéo theo nonce (CASCADE) — sự kiện thì chặn xoá (RESTRICT)", async () => {
    await db.posAgentNonce.create({ data: { agentId: AG2, nonce: "n-0123456789abcdef", createdAt: LUC } });
    expect(await loiDayDu(db.posAgentNonce.create({ data: { agentId: AG2, nonce: "n-0123456789abcdef", createdAt: LUC } }))).toMatch(
      /Unique constraint|PosAgentNonce_pkey/,
    );
    await db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "HEARTBEAT", ma: "LAN_DAU", createdAt: LUC } });
    expect(await loiDayDu(db.posAgent.delete({ where: { id: AG1 } }))).toMatch(/PosAgentEvent_agentId_fkey/);
    await db.posAgent.delete({ where: { id: AG2 } });
    expect(await db.posAgentNonce.count({ where: { agentId: AG2 } })).toBe(0);
  });

  it("[POS4-MIG-02f] ghi kép centerId → orgUnitId tự chạy cho PosAgent / sự kiện / job / nguồn (CS1 có đơn vị, CS2 không)", async () => {
    const a1 = await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } });
    expect(a1.orgUnitId).toBe(OU1);
    const a2 = await db.posAgent.findUniqueOrThrow({ where: { id: AG2 } });
    expect(a2.orgUnitId).toBeNull();
    const e = await db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "SYNC", createdAt: LUC } });
    expect(e.orgUnitId).toBe(OU1);
    const j = await db.posCheckJob.create({ data: { intentId: PHIEU_POS1, agentId: AG1, centerId: CS1, tuLuc: LUC, createdAt: LUC } });
    expect(j.orgUnitId).toBe(OU1);
    const s = await nguon({ ma: `${PFX}B1` });
    expect(s.orgUnitId).toBe(OU1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-AUTH-02] dọn nonce: quá 15 phút xoá, 14 phút giữ", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("dòng 15′+1ms bị xoá, dòng 14′ và đúng 15′ giữ", async () => {
    const now = new Date("2026-10-07T03:30:00Z");
    await db.posAgentNonce.createMany({
      data: [
        { agentId: AG1, nonce: "nonce-cu-15p-1ms", createdAt: new Date(now.getTime() - 15 * PHUT - 1) },
        { agentId: AG1, nonce: "nonce-dung-15p00", createdAt: new Date(now.getTime() - 15 * PHUT) },
        { agentId: AG1, nonce: "nonce-moi-14p000", createdAt: new Date(now.getTime() - 14 * PHUT) },
      ],
    });
    const xoa = await donNonceCu(now);
    expect(xoa).toBeGreaterThanOrEqual(1);
    const con = await db.posAgentNonce.findMany({ where: { agentId: AG1 }, select: { nonce: true }, orderBy: { nonce: "asc" } });
    expect(con.map((x) => x.nonce)).toEqual(["nonce-dung-15p00", "nonce-moi-14p000"]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-SC-02] scopedDb cách ly bốn bảng GĐ4 theo cơ sở", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("actor neo CS1 thấy agent/sự kiện/job/nguồn CS1, KHÔNG thấy CS2 và KHÔNG thấy nguồn NULL; actor HO thấy hết", async () => {
    await db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "SYNC", createdAt: LUC } });
    await db.posAgentEvent.create({ data: { agentId: AG2, centerId: CS2, type: "SYNC", createdAt: LUC } });
    await db.posCheckJob.create({ data: { intentId: PHIEU_POS1, agentId: AG1, centerId: CS1, tuLuc: LUC, createdAt: LUC } });
    await db.posCheckJob.create({ data: { intentId: PHIEU_POS2, agentId: AG2, centerId: CS2, tuLuc: LUC, createdAt: LUC } });
    await nguon({ ma: `${PFX}C1`, centerId: CS1 });
    await nguon({ ma: `${PFX}C2`, agent: AG2, centerId: CS2 });
    await nguon({ ma: `${PFX}C3`, nguon: "FILE", agent: null, centerId: null });

    const cs1 = scopedDb(actorCoSo(CS1));
    expect((await cs1.posAgent.findMany({ where: { id: { in: [AG1, AG2] } }, select: { id: true } })).map((x) => x.id)).toEqual([AG1]);
    expect(await cs1.posAgentEvent.count({ where: { agentId: { in: [AG1, AG2] } } })).toBe(1);
    expect(await cs1.posCheckJob.count({ where: { agentId: { in: [AG1, AG2] } } })).toBe(1);
    const thayNguon = await cs1.posTxnSource.findMany({ where: { maGiaoDich: { startsWith: PFX } }, select: { maGiaoDich: true } });
    expect(thayNguon.map((x) => x.maGiaoDich)).toEqual([`${PFX}C1`]);

    const ho = scopedDb(actorHo());
    expect(await ho.posAgent.count({ where: { id: { in: [AG1, AG2] } } })).toBe(2);
    expect(await ho.posAgentEvent.count({ where: { agentId: { in: [AG1, AG2] } } })).toBe(2);
    expect(await ho.posCheckJob.count({ where: { agentId: { in: [AG1, AG2] } } })).toBe(2);
    expect(await ho.posTxnSource.count({ where: { maGiaoDich: { startsWith: PFX } } })).toBe(3);
  });
});
