// tests/finance/pos-gd4.test.ts — GĐ4 POS: ĐẦU NHẬN POS AGENT. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id (khuôn `pos-gd2.test.ts`).
//
// Thiết kế: docs/pos-gd4-thiet-ke.md §11. Đi qua ĐÚNG cửa đời thật: request của agent qua HANDLER THẬT
// (`app/api/pos-agent/*`) với chữ ký HMAC thật; lô giao dịch qua `nhanGiaoDichAgent` (→ CHÍNH `nhapLoPos`); file
// qua `nhapLoPos`; phiếu POS qua `moPhieuPos`; lượt kiểm qua `kiemTraPhieuPos` (hàm DUY NHẤT gọi provider) với
// provider THẬT (`TcbPortalAgentProvider`) — đồng hồ đơn điệu + `ngu` TIÊM VÀO (không chờ thật 8 giây).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi hàm có `now` / `dongHo` đều nhận mốc tuyệt đối; route đọc `new Date()` ⇒ ca
// đặt giờ hệ thống bằng `vi.setSystemTime` (chỉ giả `Date`, không giả bộ hẹn giờ — Prisma không bị ảnh hưởng).
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { taoPhieuGop } from "@/lib/finance/phieu-gop";
import { khopGiaoDichThe, nhapLoPos, type KetQuaLoPos } from "@/lib/payments/pos/nhap-lo-pos";
import { PROVIDER_THE_POS, type DongHuyPos, type DongPos } from "@/lib/payments/pos/kieu";
import { LY_DO_HUY_TOAN_PHAN } from "@/lib/payments/pos/phan-loai-pos";
import { kiemTraPhieuPos, type TriggeredBy } from "@/lib/payments/pos/xu-ly-ket-qua";
import { moPhieuPos } from "@/lib/payments/pos/phieu-pos";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";
import { chayPollerPos } from "@/lib/payments/pos/poller";
import { anKhoiManSale } from "@/lib/payments/pos/phieu-pos-luat";
import { TcbPortalAgentProvider } from "@/lib/payments/pos/provider/tcb-agent";
import { nhanGiaoDichAgent } from "@/lib/payments/pos/agent/nhan-giao-dich";
import { CHON_AGENT, type AgentDaXacThuc } from "@/lib/payments/pos/agent/xac-thuc";
import { docJobChoAgent } from "@/lib/payments/pos/agent/job";
import { chayGiamSatAgent } from "@/lib/payments/pos/agent/giam-sat";
import { chayCanhBaoSang } from "@/lib/payments/pos/agent/sang";
import { docDoiChieuNguon, docSucKhoeAgent } from "@/lib/payments/pos/agent/suc-khoe-doc";
import type { DongAgentTho } from "@/lib/payments/pos/agent/schema";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { POST as heartbeatRoute } from "@/app/api/pos-agent/heartbeat/route";
import { POST as statusRoute } from "@/app/api/pos-agent/status/route";
import { GET as jobsRoute } from "@/app/api/pos-agent/jobs/route";
import { POST as transactionsRoute } from "@/app/api/pos-agent/transactions/route";
import { GET as giamSatRoute } from "@/app/api/cron/pos-agent-giam-sat/route";
import { GET as sangRoute } from "@/app/api/cron/pos-agent-sang/route";

// Tiêm lỗi một dòng ([POS4-ING-13]): bọc `thuTheoPhieuGop` thật, chỉ ném khi `noiDung` = mã được bật.
const tiem = vi.hoisted(() => ({ nemMa: null as string | null }));
vi.mock("@/lib/finance/phieu-gop", async (importOriginal) => {
  const that = await importOriginal<typeof import("@/lib/finance/phieu-gop")>();
  return {
    ...that,
    thuTheoPhieuGop: (...a: Parameters<typeof that.thuTheoPhieuGop>) => {
      if (tiem.nemMa !== null && a[0].noiDung === tiem.nemMa) throw new Error("fx: tiêm lỗi một dòng");
      return that.thuTheoPhieuGop(...a);
    },
  };
});

if (!RUN_DB_TESTS) console.warn(`[POS4-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const V = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/pos/agent-hmac-vectors.json"), "utf8")) as {
  masterKey: string;
};

const T = "fx-pos4gd-";
/** `maGiaoDich` chỉ nhận chữ/số (8–64) ⇒ tiền tố riêng, không gạch nối. */
const PFX = "FXPOS4GD";

const KT = `${T}kt`; // Kế toán HO — người nhập file + vai HO_ACCOUNTANT
const SALE = `${T}sale`;
const ADMIN = `${T}admin`; // Quản trị tối cao (vai SUPER_ADMIN)
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const DON = `${T}don`;
const A = `${T}item-a`;
const B = `${T}item-b`;
const DOT_A = `${T}dot-a`;
const DOT_B = `${T}dot-b`;
const LEAD = `${T}lead`;
const MAY1 = `${PFX}MAY01`;
const MAY2 = `${PFX}MAY02`;
const AG1 = "fxpos4gdagentcs1000001";
const AG2 = "fxpos4gdagentcs2000002";
const MER1 = "FXP4GCS1";
const MER2 = "FXP4GCS2";
const QUAY1 = "QTT45XWQT";
const QUAY2 = "QTTFBKATK";
const CUA_HANG1 = "CH9TSGU9";
const SDT_PH = "0399842345";
const ACTOR = { id: SALE, name: "Sale fixture POS4" };

const DOT_TIEN_A = 3_168_000;
const DOT_TIEN_B = 3_564_000;
const TONG = DOT_TIEN_A + DOT_TIEN_B; // 6.732.000

const GIAY = 1_000;
const PHUT = 60_000;
/** Lúc tạo phiếu POS — thứ Tư 07/10/2026 10:00 giờ VN. */
const NOW = new Date("2026-10-07T03:00:00Z");
/** Giờ quẹt thẻ theo portal (giờ VN) — SAU lúc tạo phiếu. */
const GIO_QUET_PORTAL = "2026/10/07 10:31:35";
const GIO_QUET_ISO = "2026-10-07T10:31:35+07:00";
/** Lúc sale bấm Kiểm tra. */
const KIEM = new Date("2026-10-07T03:40:00Z");
const sau = (moc: Date, ms: number) => new Date(moc.getTime() + ms);

let soLan = 0;
const maGd = () => `${PFX}${String(++soLan).padStart(6, "0")}`;
let soRrn = 0;
const rrnMoi = () => `62801${String(++soRrn).padStart(7, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────

const LOC_BT = { OR: [{ providerTxnId: { startsWith: PFX } }, { providerTxnId: { startsWith: T } }] };
const CUA_DON = { orderId: { startsWith: T } };
const AGENTS = [AG1, AG2];

async function don() {
  await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["orderId"], string_starts_with: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: T } } });
  await db.posAgentNonce.deleteMany({ where: { agentId: { in: AGENTS } } });
  await db.posTxnSource.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posCheckJob.deleteMany({ where: { OR: [{ agentId: { in: AGENTS } }, { intent: { paymentBill: CUA_DON } }] } });
  await db.posAgentEvent.deleteMany({ where: { agentId: { in: AGENTS } } });
  await db.posCheckLog.deleteMany({ where: { intent: { paymentBill: CUA_DON } } });
  await db.posPaymentIntent.deleteMany({ where: { paymentBill: CUA_DON } });
  await db.posAgent.deleteMany({ where: { OR: [{ id: { in: AGENTS } }, { merchantCode: { startsWith: "FXP4G" } }] } });
  await db.staffNotification.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.staffNotification.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.webPushOutbox.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { startsWith: T } },
        { actorId: { in: [KT, SALE, ADMIN] } },
        // Gộp GĐ3: audit lệch của lô AGENT mang entity = agent (actor hệ thống, `actorId` null).
        { entityType: "PosAgent", entityId: { in: AGENTS } },
      ],
    },
  });
  await db.orderStatusHistory.deleteMany({ where: CUA_DON });
  await db.posCardTransaction.deleteMany({ where: { maGiaoDich: { startsWith: PFX } } });
  await db.posImportBatch.deleteMany({ where: { importedById: KT } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: CUA_DON } });
  await db.paymentAllocation.deleteMany({ where: { bankTransaction: LOC_BT } });
  await db.paymentBillLine.deleteMany({ where: { bill: CUA_DON } });
  await db.paymentBill.deleteMany({ where: CUA_DON });
  await db.creditBalance.deleteMany({ where: CUA_DON });
  await db.payment.deleteMany({ where: CUA_DON });
  await db.paymentRequest.deleteMany({ where: CUA_DON });
  await db.bankTransaction.deleteMany({ where: LOC_BT });
  await db.posTerminal.deleteMany({ where: { maThietBi: { startsWith: PFX } } });
  await db.orderItem.deleteMany({ where: CUA_DON });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: [KT, SALE, ADMIN] } } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: [KT, SALE, ADMIN] } }, { phone: { in: [SDT_PH, "84399842345"] } }] } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function vai(code: string): Promise<string> {
  const r = await db.roleDef.upsert({ where: { code }, create: { code, name: code }, update: {}, select: { id: true } });
  return r.id;
}

async function dungFixture() {
  tiem.nemMa = null;
  vi.stubEnv("POS_AGENT_MASTER_KEY", V.masterKey);
  await don();
  for (const [id, role, ten] of [
    [KT, "ACCOUNTANT", "Kế toán HO fixture POS4"],
    [SALE, "SALES_CSM", "Sale fixture POS4"],
    [ADMIN, "SUPER_ADMIN", "Quản trị fixture POS4"],
  ] as const) {
    await db.user.create({ data: { id, name: ten, email: `${id}@test.local`, role, roles: [role] } });
  }
  // Người nhận báo (T17) đọc từ VAI. `effectiveFrom` TUYỆT ĐỐI (luật 19).
  const HIEU_LUC = new Date("2026-01-01T00:00:00Z");
  await db.userOrgRole.create({
    data: { userId: ADMIN, orgUnitId: `${T}ou-goc`, roleId: await vai("SUPER_ADMIN"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });
  await db.userOrgRole.create({
    data: { userId: KT, orgUnitId: `${T}ou-ho`, roleId: await vai("HO_ACCOUNTANT"), grantedById: ADMIN, effectiveFrom: HIEU_LUC },
  });
  for (const [id, ten, code] of [
    [CS1, "CS1 fixture POS4GD", "FXP4G-CS1"],
    [CS2, "CS2 fixture POS4GD", "FXP4G-CS2"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, code, address: "211 Nguyễn Hữu Thọ" } });
  }
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture POS4", centerId: CS1 } });
  await db.posTerminal.create({
    data: { maThietBi: MAY1, maQuay: QUAY1, maNhaCungCap: MER1, maCuaHang: CUA_HANG1, centerId: CS1 },
  });
  await db.posTerminal.create({ data: { maThietBi: MAY2, maQuay: QUAY2, maNhaCungCap: MER2, centerId: CS2 } });
  // Agent CS1 KHOẺ (READY, vừa gọi 30″ trước lúc kiểm); agent CS2 KHOẺ.
  for (const [id, cs, mer] of [
    [AG1, CS1, MER1],
    [AG2, CS2, MER2],
  ] as const) {
    await db.posAgent.create({
      data: { id, centerId: cs, merchantCode: mer, sessionState: "READY", lastHeartbeatAt: sau(KIEM, -30 * GIAY), createdById: ADMIN },
    });
  }
  await db.lead.create({
    data: { id: LEAD, parentName: "PH fixture POS4", phone: "0399842346", assignedToId: SALE, status: "CHO_QUYET_DINH" },
  });
  await taoDon(DON, CS1, [
    [A, DOT_A, "Bé A POS4", DOT_TIEN_A],
    [B, DOT_B, "Bé B POS4", DOT_TIEN_B],
  ]);
}

/** Đơn + dòng + đợt (mã đơn duy nhất theo id). */
async function taoDon(id: string, centerId: string, dong: readonly (readonly [string, string, string, number])[]) {
  await db.order.create({
    data: {
      id,
      code: `ORD-26998${String(id.length).padStart(2, "0")}-${id.slice(-6).replace(/[^0-9a-z]/gi, "0")}`,
      type: "COURSE",
      status: "PENDING_PAYMENT",
      customerName: "Phụ huynh fixture POS4",
      customerPhone: SDT_PH,
      totalAmount: dong.reduce((s, d) => s + d[3], 0),
      centerId,
      leadId: LEAD,
      createdById: SALE,
    },
  });
  let thuTu = 0;
  for (const [item, dot, ten, gia] of dong) {
    await db.orderItem.create({
      data: { id: item, orderId: id, type: "COURSE_ENROLLMENT", itemName: ten, quantity: 1, unitPrice: gia, totalPrice: gia },
    });
    await db.paymentRequest.create({
      data: { id: dot, orderId: id, orderItemId: item, centerId, installmentNo: 1, amountDue: gia, status: "PENDING", sortOrder: ++thuTu },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function phatPhieu(orderId = DON, ids: string[] = [DOT_A, DOT_B]) {
  const r = await taoPhieuGop({ orderId, paymentRequestIds: ids, actor: ACTOR });
  if (!r.ok) throw new Error(`fixture: không phát được phiếu gộp — ${r.error}`);
  return r;
}

async function moPhieu(o: { orderId?: string; dot?: string; now?: Date } = {}) {
  const r = await moPhieuPos({ orderId: o.orderId ?? DON, paymentRequestId: o.dot ?? DOT_A, actor: ACTOR, now: o.now ?? NOW });
  if (!r.ok) throw new Error(`fixture: không mở được phiếu POS — ${r.error}`);
  return r.phieu;
}

const phieuPos = (id: string) => db.posPaymentIntent.findUniqueOrThrow({ where: { id } });
const nhatKy = (intentId: string) => db.posCheckLog.findMany({ where: { intentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const docAgent = (id = AG1): Promise<AgentDaXacThuc> => db.posAgent.findUniqueOrThrow({ where: { id }, select: CHON_AGENT });
const btThe = (ma: string) =>
  db.bankTransaction.findUnique({ where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: ma } } });
const paymentCuaDon = (orderId = DON) => db.payment.findMany({ where: { orderId }, orderBy: { amount: "asc" } });
const chuong = (tienTo: string) =>
  db.staffNotification.findMany({ where: { dedupeKey: { startsWith: tienTo }, userId: { in: [KT, ADMIN] } } });

/** Một dòng agent (khoá portal) — máy CS1 đã khai đủ (merchant + quầy + cửa hàng). */
function dongAgent(p: Partial<DongAgentTho> & { transaction_id: string }): DongAgentTho {
  return {
    transaction_type: "PAYMENT",
    transaction_detail_status: "SUCCESS",
    transaction_master_status: "SUCCESS",
    order_description: "",
    authorization_id: "123456",
    card_transaction_id: rrnMoi(),
    order_amount: TONG,
    transaction_master_amount: TONG,
    transaction_detail_amount: TONG,
    currency: "VND",
    transaction_time: GIO_QUET_PORTAL,
    merchant_code: MER1,
    store_code: CUA_HANG1,
    terminal_code: QUAY1,
    payment_method: "CARD",
    service_type: "OMSMARTPOS",
    sender_card_number: "411111******1111",
    sender_card_type: "VISA",
    accounting_reference_id: null,
    settlement_id: null,
    fee: null,
    ...p,
  };
}

let soSync = 0;
async function guiLo(
  rows: DongAgentTho[],
  o: { agentId?: string; now?: Date; jobIds?: string[]; final?: boolean; syncId?: string; batchIndex?: number; windowTo?: string } = {},
) {
  const now = o.now ?? KIEM;
  return nhanGiaoDichAgent({
    agent: await docAgent(o.agentId ?? AG1),
    than: {
      syncId: o.syncId ?? `sync-${++soSync}`,
      batchIndex: o.batchIndex ?? 0,
      final: o.final ?? true,
      windowFrom: "2026-10-07 08:00:00",
      windowTo: o.windowTo ?? "2026-10-07 11:00:00",
      jobIds: o.jobIds ?? [],
      transactions: rows,
    },
    now,
    dongHo: () => now,
  });
}

function dongFile(p: Partial<DongPos> & { maGiaoDich: string }): DongPos {
  return {
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: TONG,
    thoiGian: GIO_QUET_ISO,
    dienGiai: "",
    maChuanChi: "123456",
    maGiaoDichThe: "998877665544",
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: QUAY1,
    maThietBi: MAY1,
    soTheMasked: "411111******1111",
    loaiThe: "VISA",
    maHachToan: null,
    phiGiaoDich: null,
    ...p,
  };
}

/** Một lượt import file (đúng thứ màn làm: mở lượt, ghi lô, đánh dấu XONG). */
async function nhapFile(dongs: DongPos[]): Promise<KetQuaLoPos & { batchId: string }> {
  const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: KT, soLoTong: 1 } });
  // Gộp GĐ3: `lo` BẮT BUỘC (luật 7) — `nhapLoPos` tự ghi số đếm + `soLoXong` trong MỘT câu có điều kiện.
  const kq = await nhapLoPos({ batchId: batch.id, lo: 1, dong: dongs, dongHuyCuaFile: [], nguoiNhapId: KT });
  await db.posImportBatch.update({ where: { id: batch.id }, data: { soLoXong: 1, trangThai: "XONG" } });
  return { ...kq, batchId: batch.id };
}

/** Provider THẬT với đồng hồ đơn điệu giả: `ngu(ms)` cộng giờ giả; `khiNgu` chạy ở lần ngủ đầu (giả agent). */
function providerSale(khiNgu?: () => Promise<void>) {
  let dongHo = 0;
  let daGoi = false;
  const p = new TcbPortalAgentProvider({
    cheDo: "SALE",
    ngu: async (ms) => {
      dongHo += ms;
      if (khiNgu && !daGoi) {
        daGoi = true;
        await khiNgu();
      }
    },
    dongHoDonDieu: () => dongHo,
  });
  return { p, daCho: () => dongHo };
}

function kiem(intentId: string, provider: TcbPortalAgentProvider, o: { nguon?: TriggeredBy; now?: Date } = {}) {
  return kiemTraPhieuPos({
    intentId,
    provider,
    triggeredBy: o.nguon ?? "SALE",
    now: o.now ?? KIEM,
    nguoiKiemId: (o.nguon ?? "SALE") === "SALE" ? SALE : null,
  });
}

// ── Gọi route THẬT, ký đúng hợp đồng §3 ─────────────────────────────────────
let soNonce = 0;
async function khoaAgent(id: string): Promise<string> {
  const a = await db.posAgent.findUniqueOrThrow({ where: { id }, select: { secretVersion: true } });
  return createHmac("sha256", Buffer.from(V.masterKey, "utf8")).update(`${id}:${a.secretVersion}`, "utf8").digest("hex");
}
function kyReq(o: { method: "GET" | "POST"; path: string; body?: string; agentId: string; secret: string; ts: number; nonce?: string }): NextRequest {
  const body = o.body ?? "";
  const nonce = o.nonce ?? `nonce4gd${String(++soNonce).padStart(12, "0")}`;
  const bamThan = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
  const sig = createHmac("sha256", Buffer.from(o.secret, "utf8"))
    .update(`${o.method}\n${o.path}\n${o.ts}\n${nonce}\n${bamThan}`, "utf8")
    .digest("hex");
  const headers: Record<string, string> = {
    "x-agent-contract": "1",
    "x-agent-id": o.agentId,
    "x-agent-ts": String(o.ts),
    "x-agent-nonce": nonce,
    "x-agent-sig": sig,
  };
  if (o.method === "POST") headers["content-type"] = "application/json";
  const url = `http://localhost${o.path}`;
  return o.method === "GET" ? new NextRequest(url, { method: "GET", headers }) : new NextRequest(url, { method: "POST", headers, body });
}
type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } }; headers: Headers };
async function goi(
  route: (r: NextRequest) => Promise<Response>,
  o: { method: "GET" | "POST"; path: string; body?: unknown; agentId?: string; now: Date; tsLech?: number; secret?: string; nonce?: string },
): Promise<Res> {
  vi.setSystemTime(o.now);
  const agentId = o.agentId ?? AG1;
  const secret = o.secret ?? (await khoaAgent(agentId).catch(() => "0".repeat(64)));
  const res = await route(
    kyReq({
      method: o.method,
      path: o.path,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      agentId,
      secret,
      ts: o.now.getTime() + (o.tsLech ?? 0),
      ...(o.nonce ? { nonce: o.nonce } : {}),
    }),
  );
  return { status: res.status, body: (await res.json()) as Res["body"], headers: res.headers };
}
const HB = (o: Partial<{ sessionState: string; extensionVersion: string; sessionExpiresAt: string | null }> = {}) => ({
  extensionVersion: "0.1.0",
  sessionState: "READY",
  sessionExpiresAt: "2026-10-08T08:15:00+07:00",
  lastSyncedAt: null,
  profileName: "CS1",
  ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(KIEM);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// XÁC THỰC
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-AUTH-01] xác thực qua route THẬT — chữ ký · nonce · giờ · active · tạo lại secret", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("hợp lệ ⇒ 200 + 1 dòng nonce + lastHeartbeatAt; nonce lặp ⇒ NONCE_REUSED; chữ ký sai ⇒ BAD_SIGNATURE và KHÔNG ghi nonce", async () => {
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: null } });
    const ok = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB(), now: KIEM, nonce: "nonce-lan-dau-0001" });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ merchantCode: MER1, sessionState: "READY", serverTime: KIEM.getTime() });
    expect(await db.posAgentNonce.count({ where: { agentId: AG1 } })).toBe(1);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).lastHeartbeatAt?.toISOString()).toBe(KIEM.toISOString());

    const lap = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB(), now: sau(KIEM, GIAY), nonce: "nonce-lan-dau-0001" });
    expect(lap.status).toBe(401);
    expect(lap.body.error?.code).toBe("NONCE_REUSED");

    const sai = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB(), now: sau(KIEM, 2 * GIAY), secret: "e".repeat(64) });
    expect(sai.status).toBe(401);
    expect(sai.body.error?.code).toBe("BAD_SIGNATURE");
    expect(await db.posAgentNonce.count({ where: { agentId: AG1 } }), "chữ ký sai KHÔNG đẻ dòng nonce").toBe(1);
  });

  it("agent KHÔNG tồn tại ⇒ CÙNG mã BAD_SIGNATURE (không lộ agent nào tồn tại)", async () => {
    const r = await goi(heartbeatRoute, {
      method: "POST",
      path: "/api/pos-agent/heartbeat",
      body: HB(),
      now: KIEM,
      agentId: "fxpos4gdkhongtontai00001",
      secret: "1".repeat(64),
    });
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe("BAD_SIGNATURE");
  });

  it("ts lệch 5′+1ms ⇒ CLOCK_SKEW + X-Server-Time; đúng 5′ ⇒ qua", async () => {
    const lech = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB(), now: KIEM, tsLech: -(5 * PHUT + 1) });
    expect(lech.status).toBe(401);
    expect(lech.body.error?.code).toBe("CLOCK_SKEW");
    expect(lech.headers.get("x-server-time")).toBe(String(KIEM.getTime()));
    const bien = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB(), now: KIEM, tsLech: 5 * PHUT });
    expect(bien.status).toBe(200);
  });

  it("agent TẮT ⇒ AGENT_DISABLED; bật lại ⇒ 200", async () => {
    await db.posAgent.update({ where: { id: AG1 }, data: { active: false } });
    const tat = await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: KIEM });
    expect(tat.status).toBe(401);
    expect(tat.body.error?.code).toBe("AGENT_DISABLED");
    await db.posAgent.update({ where: { id: AG1 }, data: { active: true } });
    expect((await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: sau(KIEM, GIAY) })).status).toBe(200);
  });

  it("'Tạo lại secret' (secretVersion + 1) ⇒ khoá CŨ chết ngay (BAD_SIGNATURE), khoá MỚI qua", async () => {
    const cu = await khoaAgent(AG1);
    await db.posAgent.update({ where: { id: AG1 }, data: { secretVersion: { increment: 1 } } });
    const voiCu = await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: KIEM, secret: cu });
    expect(voiCu.status).toBe(401);
    expect(voiCu.body.error?.code).toBe("BAD_SIGNATURE");
    const voiMoi = await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: sau(KIEM, GIAY) });
    expect(voiMoi.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NHẬN GIAO DỊCH — hội tụ agent ↔ file
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-ING] nhận giao dịch: MỘT dòng POS / MỘT giao dịch / MỘT bộ Payment cho mỗi transaction_id", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS4-ING-01] PAYMENT mang mã phiếu gộp CS1 ⇒ dòng POS (không lô, TU_KHOP) + giao dịch MATCHED nguồn TCB_PORTAL + Payment đủ số + dấu nguồn AGENT", async () => {
    const g = await phatPhieu();
    const m = maGd();
    // Qua ROUTE THẬT (lô 1 dòng, final).
    const r = await goi(transactionsRoute, {
      method: "POST",
      path: "/api/pos-agent/transactions",
      now: KIEM,
      body: {
        syncId: "sync-ing01",
        batchIndex: 0,
        final: true,
        windowFrom: "2026-10-07 08:00:00",
        windowTo: "2026-10-07 11:00:00",
        jobIds: [],
        transactions: [dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` })],
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ received: 1, unchanged: 0, created: 1, updated: 0, matched: 1, needsReview: 0, ignored: 0, rejected: [], errors: [] });
    const dong = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(dong).toMatchObject({ importBatchId: null, matchStatus: "TU_KHOP", maThietBi: MAY1, centerId: CS1, soTien: TONG });
    const bt = await btThe(m);
    expect(bt?.status).toBe("MATCHED");
    expect((bt?.rawPayload as { nguon?: string } | null)?.nguon).toBe("TCB_PORTAL");
    const pm = await paymentCuaDon();
    expect(pm.map((p) => p.amount).sort((a, b) => a - b)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    const nguon = await db.posTxnSource.findMany({ where: { maGiaoDich: m } });
    expect(nguon).toHaveLength(1);
    expect(nguon[0]).toMatchObject({ nguon: "AGENT", posAgentId: AG1, tuChoi: null, soTien: TONG, centerId: CS1, soLanThay: 1 });
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).lastSyncedAt?.toISOString()).toBe(KIEM.toISOString());
  });

  it("[POS4-ING-02] cùng lô gửi lần 2 ⇒ unchanged 1, KHÔNG phép ghi nào, KHÔNG sự kiện SYNC mới; vẫn 1 giao dịch / 1 bộ Payment", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const row = dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` });
    await guiLo([row]);
    const truoc = {
      dong: (await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).updatedAt.getTime(),
      // BankTransaction không có updatedAt ⇒ so CẢ dòng (mọi cột, kể cả rawPayload / unmatchedNote).
      bt: JSON.stringify(await btThe(m)),
      nguon: (await db.posTxnSource.findFirstOrThrow({ where: { maGiaoDich: m } })).updatedAt.getTime(),
      sync: await db.posAgentEvent.count({ where: { agentId: AG1, type: "SYNC" } }),
    };
    const kq = await guiLo([row], { now: sau(KIEM, PHUT) });
    expect(kq).toMatchObject({ received: 1, unchanged: 1, created: 0, updated: 0, matched: 0 });
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).updatedAt.getTime()).toBe(truoc.dong);
    expect(JSON.stringify(await btThe(m))).toBe(truoc.bt);
    expect((await db.posTxnSource.findFirstOrThrow({ where: { maGiaoDich: m } })).updatedAt.getTime()).toBe(truoc.nguon);
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "SYNC" } })).toBe(truoc.sync);
    expect(await db.bankTransaction.count({ where: { providerTxnId: m } })).toBe(1);
    expect(await paymentCuaDon()).toHaveLength(2);
  });

  it("[POS4-ING-03] agent RỒI file ⇒ 1 dòng POS / 1 giao dịch / 1 bộ Payment; nguồn có AGENT + FILE; importBatchId vẫn NULL, lastImportBatchId = lô", async () => {
    const g = await phatPhieu();
    const m = maGd();
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` })]);
    const f = await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}` })]);
    expect(f.loi).toEqual([]);
    const dong = await db.posCardTransaction.findMany({ where: { maGiaoDich: m } });
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ importBatchId: null, lastImportBatchId: f.batchId });
    expect(await db.bankTransaction.count({ where: { providerTxnId: m } })).toBe(1);
    expect(await paymentCuaDon()).toHaveLength(2);
    const nguon = await db.posTxnSource.findMany({ where: { maGiaoDich: m } });
    expect(nguon.map((x) => x.nguon).sort()).toEqual(["AGENT", "FILE"]);
    expect(nguon.find((x) => x.nguon === "FILE")).toMatchObject({ posAgentId: null, importBatchId: f.batchId, centerId: CS1 });
  });

  it("[POS4-ING-04] file RỒI agent ⇒ cùng bất biến; mã hạch toán / 'Hủy toàn phần' của file KHÔNG bị null của agent xoá", async () => {
    const g = await phatPhieu();
    const m = maGd();
    await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}`, maHachToan: "HT_FILE_01", phiGiaoDich: 12_000 })]);
    expect((await btThe(m))?.status).toBe("MATCHED");
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` })]);
    const dong = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(dong.maHachToan).toBe("HT_FILE_01");
    expect(dong.phiGiaoDich).toBe(12_000);
    expect(dong.importBatchId).not.toBeNull();
    expect(await db.bankTransaction.count({ where: { providerTxnId: m } })).toBe(1);
    expect(await paymentCuaDon()).toHaveLength(2);

    // Dòng file mang "Hủy toàn phần" (BO_QUA, không giao dịch) ⇒ agent gửi null cột đó ⇒ VẪN BO_QUA, cột còn nguyên.
    const h = maGd();
    await nhapFile([dongFile({ maGiaoDich: h, dienGiai: "Học phí không mã", trangThaiHoanHuy: "Hủy toàn phần" })]);
    await guiLo([dongAgent({ transaction_id: h, order_description: "Học phí không mã" })]);
    const huy = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: h } });
    expect(huy.trangThaiHoanHuy).toBe("Hủy toàn phần");
    expect(huy.matchStatus).toBe("BO_QUA");
    expect(await btThe(h)).toBeNull();
  });

  it("[POS4-ING-04b] agent ‖ file SONG SONG (6 vòng) ⇒ mỗi vòng ĐÚNG 1 giao dịch / 1 bộ Payment / 1 dòng POS", async () => {
    for (let i = 0; i < 6; i += 1) {
      const id = `${T}don-ss${i}`;
      await taoDon(id, CS1, [[`${T}item-ss${i}`, `${T}dot-ss${i}`, `Bé song song ${i}`, 2_500_000 + i]]);
      const g = await phatPhieu(id, [`${T}dot-ss${i}`]);
      const m = maGd();
      await Promise.all([
        guiLo([dongAgent({ transaction_id: m, order_description: `HP ${g.ma}`, order_amount: 2_500_000 + i, transaction_master_amount: null, transaction_detail_amount: null })]),
        nhapFile([dongFile({ maGiaoDich: m, dienGiai: `HP ${g.ma}`, soTien: 2_500_000 + i })]),
      ]);
      expect(await db.posCardTransaction.count({ where: { maGiaoDich: m } }), `vòng ${i}`).toBe(1);
      expect(await db.bankTransaction.count({ where: { providerTxnId: m } }), `vòng ${i}`).toBe(1);
      const pm = await db.payment.findMany({ where: { orderId: id } });
      expect(pm, `vòng ${i}`).toHaveLength(1);
      expect(pm[0]!.amount).toBe(2_500_000 + i);
    }
  });

  it("[POS4-ING-05] merchant_code KHÁC ⇒ rejected MERCHANT_MISMATCH, KHÔNG lưu gì của dòng; gửi 2 lần cùng ngày ⇒ ĐÚNG 1 sự kiện ERROR", async () => {
    const m = maGd();
    const row = dongAgent({ transaction_id: m, merchant_code: MER2 });
    const k1 = await guiLo([row]);
    expect(k1.rejected).toEqual([{ index: 0, transaction_id: m, code: "MERCHANT_MISMATCH" }]);
    const k2 = await guiLo([row], { now: sau(KIEM, PHUT) });
    expect(k2.rejected).toEqual([{ index: 0, transaction_id: m, code: "MERCHANT_MISMATCH" }]);
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: m } })).toBe(0);
    expect(await db.posTxnSource.count({ where: { maGiaoDich: m } })).toBe(0);
    const ev = await db.posAgentEvent.findMany({ where: { agentId: AG1, type: "ERROR", ma: "MERCHANT_MISMATCH" } });
    expect(ev).toHaveLength(1);
    expect((ev[0]!.detail as { dem?: number }).dem).toBe(2);
  });

  it("[POS4-ING-06] tiền lệch ⇒ rejected AMOUNT_MISMATCH + DẤU nguồn (tuChoi), 0 dòng POS / 0 giao dịch; gửi lại y hệt ⇒ unchanged, không sự kiện mới", async () => {
    const m = maGd();
    const row = dongAgent({ transaction_id: m, transaction_detail_amount: TONG - 1 });
    const k1 = await guiLo([row]);
    expect(k1.rejected).toEqual([{ index: 0, transaction_id: m, code: "AMOUNT_MISMATCH" }]);
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: m } })).toBe(0);
    expect(await btThe(m)).toBeNull();
    const dau = await db.posTxnSource.findFirstOrThrow({ where: { maGiaoDich: m } });
    expect(dau).toMatchObject({ nguon: "AGENT", tuChoi: "AMOUNT_MISMATCH", soTien: null, centerId: CS1 });
    const suKien = await db.posAgentEvent.count({ where: { agentId: AG1 } });
    const k2 = await guiLo([row], { now: sau(KIEM, PHUT) });
    expect(k2).toMatchObject({ unchanged: 1, rejected: [] });
    expect(await db.posAgentEvent.count({ where: { agentId: AG1 } })).toBe(suKien);
    expect((await db.posTxnSource.findFirstOrThrow({ where: { maGiaoDich: m } })).soLanThay).toBe(1);
  });

  it("[POS4-ING-07] máy CHƯA khai ⇒ CAN_XU_LY 'Thiết bị chưa gán cơ sở' (giao dịch UNMATCHED); khai máy ⇒ gửi lại y hệt ⇒ băm đổi ⇒ TU_KHOP + Payment", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const row = dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, terminal_code: "QTTMOI001", store_code: null });
    const k1 = await guiLo([row]);
    expect(k1).toMatchObject({ created: 1, needsReview: 1, matched: 0 });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      matchStatus: "CAN_XU_LY",
      matchReason: "Thiết bị chưa gán cơ sở",
      maThietBi: null,
    });
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    await db.posTerminal.create({ data: { maThietBi: `${PFX}MAYMOI`, maQuay: "QTTMOI001", maNhaCungCap: MER1, centerId: CS1 } });
    const k2 = await guiLo([row], { now: sau(KIEM, PHUT) });
    expect(k2).toMatchObject({ unchanged: 0, updated: 1, matched: 1 });
    expect((await btThe(m))?.status).toBe("MATCHED");
    expect(await paymentCuaDon()).toHaveLength(2);
  });

  it("[POS4-ING-08] PAYMENT ghi nhận ⇒ phiếu DA_THU; VOID cùng RRN tới sau ⇒ gốc cảnh báo, Payment KHÔNG đổi (D7); phiếu giữ DA_THU, kết quả CANCELLED_AFTER_PAID", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })]);
    expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
    const pmTruoc = await paymentCuaDon();
    const v = maGd();
    await guiLo([dongAgent({ transaction_id: v, transaction_type: "VOID", card_transaction_id: rrn, transaction_time: "2026/10/07 10:45:00" })], {
      now: sau(KIEM, 10 * PHUT),
    });
    const goc = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(goc.canhBaoHuy).toBe(true);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v } })).maGiaoDichGoc).toBe(m);
    expect((await btThe(m))?.status).toBe("MATCHED");
    expect((await paymentCuaDon()).map((x) => [x.id, x.amount, x.accountantStatus])).toEqual(pmTruoc.map((x) => [x.id, x.amount, x.accountantStatus]));
    const sauHuy = await phieuPos(p.intentId);
    expect(sauHuy.status).toBe("DA_THU");
    expect(sauHuy.lastResultKind).toBe("CANCELLED_AFTER_PAID");
    expect(sauHuy.lastResultMessage).toContain("đã bị huỷ/hoàn sau khi ghi nhận");
    expect((await nhatKy(p.intentId)).some((l) => l.triggeredBy === "AGENT")).toBe(true);
  });

  it("[POS4-ING-09] VOID tới TRƯỚC PAYMENT ⇒ 'Chưa thấy gốc'; PAYMENT tới ⇒ VOID được điền gốc ⇒ PAYMENT BO_QUA, 0 giao dịch ghi tiền; VOID BO_QUA", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: v, transaction_type: "VOID", card_transaction_id: rrn, transaction_time: "2026/10/07 10:45:00" })]);
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v } })).toMatchObject({
      matchStatus: "CAN_XU_LY",
      maGiaoDichGoc: null,
    });
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], { now: sau(KIEM, PHUT) });
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v } })).maGiaoDichGoc).toBe(m);
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({ matchStatus: "BO_QUA" });
    expect(await btThe(m)).toBeNull();
    expect(await paymentCuaDon()).toHaveLength(0);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v } })).matchStatus).toBe("BO_QUA");
  });

  it("[POS4-ING-10] VOID LỆCH số gốc (hoàn một phần) ⇒ Q-G: giao dịch gốc IGNORED + cảnh báo (luật lõi nguyên văn)", async () => {
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: m, order_description: "không có mã phiếu", card_transaction_id: rrn })]);
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    await guiLo(
      [
        dongAgent({
          transaction_id: v,
          transaction_type: "VOID",
          card_transaction_id: rrn,
          order_amount: 1_000_000,
          transaction_master_amount: null,
          transaction_detail_amount: null,
          transaction_time: "2026/10/07 10:45:00",
        }),
      ],
      { now: sau(KIEM, PHUT) },
    );
    expect((await btThe(m))?.status).toBe("IGNORED");
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).canhBaoHuy).toBe(true);
  });

  it("[POS4-ING-11] dòng ĐÃ ghi nhận nhận accounting_reference_id / settlement_id / fee ⇒ 3 cột cập nhật, tiền không đổi; lượt sau gửi null ⇒ KHÔNG xoá", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const goc = dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` });
    await guiLo([goc]);
    await guiLo([{ ...goc, accounting_reference_id: "HT20261008", settlement_id: "STL20261008", fee: 67_320 }], { now: sau(KIEM, PHUT) });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      maHachToan: "HT20261008",
      maKetToan: "STL20261008",
      phiGiaoDich: 67_320,
      soTien: TONG,
    });
    expect((await btThe(m))?.amount).toBe(TONG);
    await guiLo([goc], { now: sau(KIEM, 2 * PHUT) });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      maHachToan: "HT20261008",
      maKetToan: "STL20261008",
      phiGiaoDich: 67_320,
    });
    expect(await paymentCuaDon()).toHaveLength(2);
  });

  it("[POS4-ING-12] FAIL + USER_CANCELLED ⇒ maLyDoThatBai; sale bấm Kiểm tra ⇒ FAILED USER_CANCELLED ⇒ 'Khách huỷ trên máy — cho quẹt lại.'", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    await guiLo([
      dongAgent({
        transaction_id: m,
        order_description: `Học phí ${g.ma}`,
        transaction_detail_status: "FAIL",
        transaction_master_status: "FAIL",
        transaction_operation_msg: "USER_CANCELLED",
      }),
    ]);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).maLyDoThatBai).toBe("USER_CANCELLED");
    const { p: prov } = providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, sau(KIEM, 10 * GIAY));
      await guiLo([], { now: sau(KIEM, 10 * GIAY), jobIds: jobs.map((j) => j.id) });
    });
    const kq = await kiem(p.intentId, prov, { now: sau(KIEM, 10 * GIAY) });
    expect(kq.status).toBe("THAT_BAI");
    expect(kq.thongDiep).toBe("Khách huỷ trên máy — cho quẹt lại.");
    expect((await nhatKy(p.intentId)).at(-1)).toMatchObject({ triggeredBy: "SALE", kind: "FAILED", errorCode: "USER_CANCELLED" });
  });

  it("[POS4-ING-13] lỗi MỘT dòng ⇒ errors[PROCESSING_ERROR], KHÔNG dấu nguồn cho dòng đó ⇒ lượt sau xử lý lại (dòng kia vẫn vào)", async () => {
    const g = await phatPhieu();
    const m1 = maGd();
    const m2 = maGd();
    tiem.nemMa = g.ma;
    const k1 = await guiLo([
      dongAgent({ transaction_id: m1, order_description: `Học phí ${g.ma}` }),
      dongAgent({ transaction_id: m2, order_description: "không mã" }),
    ]);
    expect(k1.errors).toEqual([{ index: 0, transaction_id: m1, code: "PROCESSING_ERROR" }]);
    expect(await db.posTxnSource.count({ where: { maGiaoDich: m1 } })).toBe(0);
    expect(await db.posTxnSource.count({ where: { maGiaoDich: m2 } })).toBe(1);
    tiem.nemMa = null;
    const k2 = await guiLo([dongAgent({ transaction_id: m1, order_description: `Học phí ${g.ma}` })], { now: sau(KIEM, PHUT) });
    expect(k2).toMatchObject({ unchanged: 0, errors: [], matched: 1 });
    expect((await btThe(m1))?.status).toBe("MATCHED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GỘP GĐ3 × GĐ4 — luật DÒNG của GĐ3 áp cho CẢ lô AGENT (docs/pos-gd4-thiet-ke.md Phụ lục G)
// ─────────────────────────────────────────────────────────────────────────────

/** Bản TÓM của một dòng Hủy (thứ màn import gửi kèm mỗi lô — `dongHuyCuaFile`). */
const tomHuy = (d: DongPos): DongHuyPos => ({
  maGiaoDich: d.maGiaoDich,
  loaiGiaoDich: d.loaiGiaoDich,
  trangThai: d.trangThai,
  soTien: d.soTien,
  maGiaoDichGoc: d.maGiaoDichGoc,
  trangThaiHoanHuy: d.trangThaiHoanHuy,
});

/** Audit LỆCH của lô agent (GĐ3 V6 áp cho agent): entity = agent, actor hệ thống. */
const auditLechAgent = (agentId = AG1) =>
  db.auditLog.findMany({
    where: { action: "POS_AGENT_LECH_DA_GHI_NHAN", entityType: "PosAgent", entityId: agentId },
    orderBy: { createdAt: "asc" },
  });
const vnd = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const soTien3 = (n: number) => ({ order_amount: n, transaction_master_amount: n, transaction_detail_amount: n });

describe.skipIf(!RUN_DB_TESTS)("[POS4-G3] gộp GĐ3: luật DÒNG của GĐ3 áp cho CẢ lô AGENT", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS4-G3-01] V5–V7(i): file đã ghi nhận, agent báo SỐ TIỀN khác ⇒ sổ + dòng POS KHÔNG đổi; MỘT audit lệch + SYNC mang lech; gửi lại y hệt ⇒ KHÔNG báo lần hai", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const f = await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}` })]);
    expect(f.loi).toEqual([]);
    expect((await btThe(m))?.status).toBe("MATCHED");
    const B = TONG + 1_000;
    const lech = dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, ...soTien3(B) });
    // Đối chứng trong CÙNG lô: dòng không mang mã (chưa ghi nhận) ⇒ không thuộc lệch.
    const m2 = maGd();
    const kq = await guiLo([lech, dongAgent({ transaction_id: m2, order_description: "không mã" })]);
    expect(kq).toMatchObject({ received: 2, unchanged: 0, matched: 0, rejected: [], errors: [] });
    // Dòng ĐÃ GHI NHẬN chỉ đổi cột kết toán (GĐ3 luật 7): sổ, Payment, dòng POS giữ số đã vào sổ.
    expect(await btThe(m)).toMatchObject({ status: "MATCHED", amount: TONG });
    expect((await paymentCuaDon()).map((p) => p.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      soTien: TONG,
      trangThai: "Thành công",
      matchStatus: "TU_KHOP",
    });
    // BÁO: một dòng audit cho lô, đúng một mục (m2 không có mặt); actor hệ thống.
    const a = await auditLechAgent();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ module: "finance", actorId: null });
    expect((a[0]!.newValues as { lech?: unknown }).lech).toEqual([
      { maGiaoDich: m, truong: "soTien", daGhiNhan: vnd(TONG), trongFile: vnd(B) },
    ]);
    const sync = await db.posAgentEvent.findFirstOrThrow({ where: { agentId: AG1, type: "SYNC" }, orderBy: { createdAt: "desc" } });
    expect((sync.detail as { lech?: number }).lech).toBe(1);
    // Gửi lại y hệt ⇒ băm trùng ⇒ unchanged ⇒ KHÔNG báo lần hai.
    const lai = await guiLo([lech], { now: sau(KIEM, PHUT) });
    expect(lai).toMatchObject({ unchanged: 1, updated: 0 });
    expect(await auditLechAgent()).toHaveLength(1);
  });

  it("[POS4-G3-02] file ghi nhận 'Thành công', agent báo FAIL/FAIL ⇒ giao dịch VẪN MATCHED, Payment giữ, dòng giữ 'Thành công'; audit lệch TRẠNG THÁI", async () => {
    const g = await phatPhieu();
    const m = maGd();
    await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}` })]);
    await guiLo([
      dongAgent({
        transaction_id: m,
        order_description: `Học phí ${g.ma}`,
        transaction_detail_status: "FAIL",
        transaction_master_status: "FAIL",
      }),
    ]);
    expect(await btThe(m)).toMatchObject({ status: "MATCHED", amount: TONG });
    expect(await paymentCuaDon()).toHaveLength(2);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).trangThai).toBe("Thành công");
    const a = await auditLechAgent();
    expect(a).toHaveLength(1);
    expect((a[0]!.newValues as { lech?: unknown }).lech).toEqual([
      { maGiaoDich: m, truong: "trangThai", daGhiNhan: "Thành công", trongFile: "Thất bại" },
    ]);
  });

  it("[POS4-G3-03] gốc đã kết luận 'đã bị hủy/hoàn' (file, dòng Hủy CHƯA lưu) ⇒ agent gửi PAYMENT SUCCESS mang mã ⇒ VẪN BỎ QUA, 0 giao dịch, 0 Payment; quẹt lại cùng mã ⇒ thu (đối chứng dương)", async () => {
    const g = await phatPhieu();
    const goc = maGd();
    const huy = maGd();
    const rrn = rrnMoi();
    const dGoc = dongFile({ maGiaoDich: goc, dienGiai: `Học phí ${g.ma}`, maGiaoDichThe: rrn });
    const dHuy = dongFile({ maGiaoDich: huy, loaiGiaoDich: "Hủy", soTien: -TONG, maGiaoDichGoc: goc, maGiaoDichThe: rrn });
    // Hình dạng `catLoPos`: dòng Hủy chỉ đi kèm gốc qua `dongHuyCuaFile`; lượt dừng trước lô chứa nó ⇒ dòng Hủy
    // KHÔNG được lưu, gốc chỉ còn `matchReason` (khuôn [POS3-DB-10b]).
    const batch = await db.posImportBatch.create({ data: { tenFile: "fixture.xlsx", importedById: KT, soLoTong: 2 } });
    const r = await nhapLoPos({ batchId: batch.id, lo: 1, dong: [dGoc], dongHuyCuaFile: [tomHuy(dHuy)], nguoiNhapId: KT });
    expect(r.loi).toEqual([]);
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: goc } })).toMatchObject({
      matchStatus: "BO_QUA",
      matchReason: LY_DO_HUY_TOAN_PHAN,
      bankTransactionId: null,
      trangThaiHoanHuy: null,
    });
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: huy } }), "dòng Hủy chưa được lưu").toBe(0);

    // Máy đồng bộ thấy lần quẹt GỐC (lệnh hủy ngoài cửa sổ của nó; list API không có cột Hoàn/Hủy).
    const kq = await guiLo([dongAgent({ transaction_id: goc, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })]);
    expect(kq).toMatchObject({ matched: 0, rejected: [], errors: [] });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: goc } })).toMatchObject({
      matchStatus: "BO_QUA",
      bankTransactionId: null,
    });
    expect(await btThe(goc), "không sinh giao dịch cho lần quẹt đã hủy").toBeNull();
    expect(await paymentCuaDon()).toHaveLength(0);

    // Đối chứng dương: khách quẹt LẠI cùng mã (luồng thiết kế) ⇒ agent gửi ⇒ thu đủ.
    const k2 = await guiLo([dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` })], { now: sau(KIEM, PHUT) });
    expect(k2).toMatchObject({ matched: 1, errors: [] });
    expect((await paymentCuaDon()).map((p) => p.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
  });

  it("[POS4-G3-04] V7(ii): giao dịch vào sổ TRƯỚC (nút Kiểm tra, chưa có dòng POS) số A ⇒ agent gửi số B ⇒ dòng POS mang B, sổ GIỮ A, audit lệch; matched 0 (lượt này không chia tiền)", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const kl = await khopGiaoDichThe({ d: dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}` }), nguonDuLieu: "FAKE" });
    expect(kl.tien?.loai).toBe("DA_CHIA");
    expect(await db.posCardTransaction.count({ where: { maGiaoDich: m } })).toBe(0);
    const B = TONG + 1_000;
    const kq = await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, ...soTien3(B) })]);
    // "Tự khớp" = khớp MỚI ở lượt này (GĐ3 V13 · rà đối kháng #3) — giao dịch đã vào sổ trước lượt KHÔNG đếm.
    expect(kq).toMatchObject({ created: 1, matched: 0, errors: [] });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      soTien: B,
      matchStatus: "TU_KHOP",
      importBatchId: null,
    });
    expect(await btThe(m)).toMatchObject({ status: "MATCHED", amount: TONG });
    expect((await paymentCuaDon()).map((p) => p.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
    const a = await auditLechAgent();
    expect(a).toHaveLength(1);
    expect((a[0]!.newValues as { lech?: unknown }).lech).toEqual([
      { maGiaoDich: m, truong: "soTien", daGhiNhan: vnd(TONG), trongFile: vnd(B) },
    ]);
  });

  it("[POS4-G3-05] T12/H3 vẫn là lớp DUY NHẤT che cột KHÔNG phải kết toán: dòng file 'Thất bại' (chưa khoá) mang ghi chú + mã chuẩn chi ⇒ agent gửi ghi chú RỖNG + mã chuẩn chi null ⇒ KHÔNG bị xoá", async () => {
    // Sau gộp GĐ3, ba cột kết toán có HAI lớp che (trộn null của tầng agent + `cotKetToanCapNhat` của lõi) ⇒ cấy bỏ
    // trộn null không còn làm [POS4-ING-04]/[POS4-ING-11] đỏ. Ca này giữ cho lớp trộn null có răng ở tầng DB: cột GỐC
    // của dòng chưa khoá đi `cotGoc(d)` — chỉ trộn null đứng giữa nó và chuỗi rỗng / null của agent.
    const g = await phatPhieu();
    const m = maGd();
    await nhapFile([dongFile({ maGiaoDich: m, trangThai: "Thất bại", dienGiai: `Học phí ${g.ma}`, maChuanChi: "654321" })]);
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      matchStatus: "BO_QUA",
      bankTransactionId: null,
    });
    const kq = await guiLo([
      dongAgent({
        transaction_id: m,
        transaction_detail_status: "FAIL",
        transaction_master_status: "FAIL",
        order_description: "",
        authorization_id: null,
      }),
    ]);
    expect(kq).toMatchObject({ received: 1, unchanged: 0, updated: 1, errors: [], rejected: [] });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      matchStatus: "BO_QUA",
      dienGiai: `Học phí ${g.ma}`,
      maChuanChi: "654321",
    });
    expect(await btThe(m)).toBeNull();
  });

  it("[POS4-G3-06] rà #2 GĐ3 cho lô AGENT: lượt khác ghi Mã hạch toán / Phí MỚI giữa lúc lô agent chạy (ảnh chụp đầu lô mang giá trị CŨ) ⇒ null của agent KHÔNG ghi lại giá trị cũ", async () => {
    // Mã TRƯỚC bản vá: trộn null (T12) đổi null của agent thành giá trị ẢNH CHỤP đầu lô cho cả mã hạch toán / phí,
    // rồi lõi ghi nó TƯỜNG MINH qua `cotKetToanCapNhat` ⇒ đè giá trị lượt song song vừa commit — đúng lỗ GĐ3 rà #2 đã
    // vá cho lô file (`[POS3-DB-11]`). Sau gộp, hai cột này do LÕI che (ô trống = khoá vắng mặt) ⇒ trộn null không chạm.
    const g = await phatPhieu();
    const m = maGd();
    await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}`, maHachToan: "HT_CU", phiGiaoDich: 1_000 })]);
    expect((await btThe(m))?.status).toBe("MATCHED");

    /**
     * Chờ tới khi câu UPDATE dòng POS của lô agent ĐỨNG CHỜ KHOÁ — hoặc lô agent đã XONG mà không cần ghi dòng đó
     * (bản vá: không còn cột nào để ghi ⇒ Prisma không phát câu UPDATE). Đếm lượt hỏi, không đọc đồng hồ (khuôn
     * [POS3-DB-11]). Mã TRƯỚC bản vá luôn rơi vào vế "đứng chờ" (câu ghi mang mã hạch toán + phí của ảnh chụp).
     */
    const choCauGhiDangCho = async (daXong: () => boolean) => {
      for (let i = 0; i < 400; i++) {
        if (daXong()) return;
        const [r] = await db.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%UPDATE%PosCardTransaction%'`;
        if ((r?.n ?? 0) > 0) return;
        await new Promise((ok) => setTimeout(ok, 25));
      }
      throw new Error("không thấy câu ghi dòng POS đứng chờ khoá, và lô agent chưa xong");
    };

    let chay: Promise<unknown> | null = null;
    let xong = false;
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "PosCardTransaction" WHERE "maGiaoDich" = ${m} FOR UPDATE`;
          chay = guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` })]).finally(() => {
            xong = true;
          });
          await choCauGhiDangCho(() => xong);
          await tx.posCardTransaction.update({ where: { maGiaoDich: m }, data: { maHachToan: "HT_MOI", phiGiaoDich: 2_000 } });
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } finally {
      if (chay) await chay;
    }
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      maHachToan: "HT_MOI",
      phiGiaoDich: 2_000,
    });
    // Đối chứng dương: agent CÓ giá trị ⇒ agent ghi (agent thắng, như T12).
    await guiLo(
      [dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, accounting_reference_id: "HT_AGENT", fee: 3_000 })],
      { now: sau(KIEM, PHUT) },
    );
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      maHachToan: "HT_AGENT",
      phiGiaoDich: 3_000,
    });
    // Trần riêng: vòng chờ hỏi tối đa 400 × 25 ms (khuôn [POS3-DB-11]) — trần mặc định 5″ của vitest cắt nó trước khi
    // vòng kịp báo lỗi rõ nghĩa trên runner chậm.
  }, 20_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// JOB · CHỜ 8 GIÂY · D9 · CHỌN PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-JOB] job 'đồng bộ ngay' + chờ ≤ 8″ (ngoài transaction)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS4-JOB-01] SALE, agent khoẻ: job tạo ⇒ agent (giả, chạy trong lúc chờ) gửi lô final mang jobIds ⇒ job DONE ⇒ DA_THU; nhật ký SALE PAID; chờ < 8″", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const { p: prov, daCho } = providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, KIEM);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.scanFrom).toBe("2026-10-07T09:55:00+07:00");
      await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` })], { jobIds: jobs.map((j) => j.id) });
    });
    const kq = await kiem(p.intentId, prov);
    expect(kq.status).toBe("DA_THU");
    expect(daCho()).toBeLessThan(8_000);
    expect(await db.posCheckJob.findMany({ where: { intentId: p.intentId }, select: { status: true } })).toEqual([{ status: "DONE" }]);
    const nk = (await nhatKy(p.intentId)).filter((l) => l.triggeredBy === "SALE");
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ kind: "PAID", providerTxnId: m, statusSau: "DA_THU" });
  });

  it("[POS4-JOB-02] agent KHÔNG trả lời ⇒ hết 8″ (đồng hồ giả) ⇒ DANG_DONG_BO, phiếu giữ CHO_QUET; có dòng 'Thất bại' mà job chưa xong ⇒ VẪN DANG_DONG_BO", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const { p: prov, daCho } = providerSale();
    const kq = await kiem(p.intentId, prov);
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).toBe(
      "Máy đồng bộ Techcombank chưa trả lời kịp — bấm Kiểm tra lại sau vài giây. Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại.",
    );
    expect(daCho()).toBeGreaterThanOrEqual(8_000);
    // Dòng thất bại đã có (đồng bộ trước) — job lượt này vẫn không ai trả lời.
    await guiLo([
      dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}`, transaction_detail_status: "FAIL", transaction_master_status: null }),
    ]);
    // Agent vẫn gọi về đều (mốc sống mới) — chỉ là không trả lời job.
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: sau(KIEM, 3 * PHUT - 10 * GIAY) } });
    const { p: prov2 } = providerSale();
    const kq2 = await kiem(p.intentId, prov2, { now: sau(KIEM, 3 * PHUT) });
    expect(kq2.status, "không kết luận THAT_BAI khi dữ liệu chưa tươi").toBe("CHO_QUET");
    expect(kq2.thongDiep).toContain("chưa trả lời kịp");
  });

  // [Rà đối kháng GĐ4 — RV-06] ĐẢO T18: bản đầu DÙNG LẠI job PENDING trẻ ⇒ agent đang chạy lượt của job cũ (bắt
  // đầu TRƯỚC lần quẹt mới) đóng nó, lượt bấm sau thấy "xong" và đọc dữ liệu cũ (ca [POS4-RV-06b]). Nay mỗi lượt
  // SALE (đã qua cửa sổ chống bấm dồn 5″) tạo job MỚI; job PENDING cũ của phiếu ⇒ EXPIRED (bị thay) — vẫn MỘT
  // job PENDING / phiếu.
  it("[POS4-JOB-03] bấm lại sau 6″ ⇒ job MỚI, job cũ EXPIRED (bị thay); vẫn MỘT job PENDING / phiếu", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await kiem(p.intentId, providerSale().p);
    await kiem(p.intentId, providerSale().p, { now: sau(KIEM, 6 * GIAY) });
    const ds = () => db.posCheckJob.findMany({ where: { intentId: p.intentId }, orderBy: { createdAt: "asc" }, select: { status: true } });
    expect((await ds()).map((j) => j.status)).toEqual(["EXPIRED", "PENDING"]);
    await kiem(p.intentId, providerSale().p, { now: sau(KIEM, 2 * PHUT + GIAY) });
    expect((await ds()).map((j) => j.status)).toEqual(["EXPIRED", "EXPIRED", "PENDING"]);
  });

  it("[POS4-JOB-04] GET /jobs chỉ trả job PENDING TRẺ của CHÍNH agent; jobIds của agent KHÁC trong lô final ⇒ KHÔNG DONE", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await kiem(p.intentId, providerSale().p);
    const job = await db.posCheckJob.findFirstOrThrow({ where: { intentId: p.intentId } });
    // Job già của CHÍNH agent không được trả.
    await db.posCheckJob.create({
      data: { intentId: p.intentId, agentId: AG1, centerId: CS1, tuLuc: NOW, createdAt: sau(KIEM, -3 * PHUT), status: "PENDING" },
    });
    const r1 = await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: sau(KIEM, GIAY) });
    expect(r1.status).toBe(200);
    expect((r1.body.data?.jobs as { id: string }[]).map((j) => j.id)).toEqual([job.id]);
    expect(r1.body.data?.nextPollMs).toBe(2_000);
    const r2 = await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: sau(KIEM, 2 * GIAY), agentId: AG2 });
    expect(r2.body.data?.jobs).toEqual([]);
    // Agent CS2 khai jobId của agent CS1 ⇒ bị bỏ qua.
    const k = await guiLo([], { agentId: AG2, jobIds: [job.id] });
    expect(k.jobsDone).toBe(0);
    expect((await db.posCheckJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
    const k1 = await guiLo([], { jobIds: [job.id] });
    expect(k1.jobsDone).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-PE] D9 — máy đồng bộ không sẵn sàng: KHÔNG đổi phiếu, KHÔNG mất mã, đã báo admin", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS4-PE-01] agent EXPIRED ⇒ SALE ⇒ AGENT_HET_PHIEN: CHO_QUET giữ, DA_THU giữ (không đè câu), mã phiếu gộp nguyên; 1 chuông hết phiên (bấm 2 lần); 0 chuông lỗi kết nối; 0 job", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await db.posAgent.update({ where: { id: AG1 }, data: { sessionState: "EXPIRED", sessionDoiLuc: sau(KIEM, -20 * PHUT) } });
    const kq = await kiem(p.intentId, providerSale().p);
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).toBe(
      "Tạm mất kết nối Techcombank FXP4G-CS1, đã báo admin đăng nhập lại. Biên lai máy đã báo THÀNH CÔNG thì ĐỪNG cho quẹt lại — bấm Kiểm tra lại sau.",
    );
    await kiem(p.intentId, providerSale().p, { now: sau(KIEM, 10 * GIAY) });
    expect((await nhatKy(p.intentId)).map((l) => l.errorCode)).toEqual(["AGENT_HET_PHIEN", "AGENT_HET_PHIEN"]);
    const bell = await chuong(`pos.agent-het-phien:${CS1}:`);
    expect(bell.map((b) => b.userId).sort()).toEqual([ADMIN, KT].sort());
    expect(await chuong("pos.loi-ket-noi:")).toEqual([]);
    expect(await db.posCheckJob.count({ where: { intentId: p.intentId } })).toBe(0);
    const bill = await db.paymentBill.findFirstOrThrow({ where: { orderId: DON, status: "OPEN" } });
    expect(bill.matchKey).toBe(g.ma);

    // Phiếu ĐÃ THU: D9 không đè câu, không đổi trạng thái.
    await db.posPaymentIntent.update({ where: { id: p.intentId }, data: { status: "DA_THU", lastResultMessage: "Đã thu — câu cũ" } });
    const kq3 = await kiem(p.intentId, providerSale().p, { now: sau(KIEM, 20 * GIAY) });
    expect(kq3.status).toBe("DA_THU");
    expect((await phieuPos(p.intentId)).lastResultMessage).toBe("Đã thu — câu cũ");
  });

  it("[POS4-PE-02] im 3′+1ms ⇒ AGENT_MAT_KET_NOI ('máy đồng bộ không phản hồi'); im 2′59″ ⇒ đi bình thường (đối chứng dương: tạo job)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: sau(KIEM, -(3 * PHUT + 1)) } });
    const kq = await kiem(p.intentId, providerSale().p);
    expect(kq.thongDiep).toContain("Tạm mất kết nối Techcombank FXP4G-CS1 (máy đồng bộ không phản hồi)");
    expect((await nhatKy(p.intentId)).at(-1)?.errorCode).toBe("AGENT_MAT_KET_NOI");
    expect(await chuong(`pos.agent-mat-ket-noi:${CS1}:`)).toHaveLength(2);
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: sau(KIEM, 10 * GIAY - (2 * PHUT + 59 * GIAY)) } });
    const kq2 = await kiem(p.intentId, providerSale().p, { now: sau(KIEM, 10 * GIAY) });
    expect(kq2.thongDiep).toContain("chưa trả lời kịp");
    expect(await db.posCheckJob.count({ where: { intentId: p.intentId } })).toBe(1);
  });

  it("[POS4-PE-03] agent EXPIRED + Kế toán import file có dòng thu đúng mã ⇒ đồng bộ sau import ⇒ DA_THU (dự phòng sống — T5); POLLER không bị gác", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const p2Don = `${T}don-pe3`;
    await taoDon(p2Don, CS1, [[`${T}item-pe3`, `${T}dot-pe3`, "Bé PE3", 1_800_000]]);
    await phatPhieu(p2Don, [`${T}dot-pe3`]);
    await db.posAgent.update({ where: { id: AG1 }, data: { sessionState: "EXPIRED", sessionDoiLuc: sau(KIEM, -20 * PHUT) } });
    await nhapFile([dongFile({ maGiaoDich: maGd(), dienGiai: `Học phí ${g.ma}` })]);
    await dongBoPhieuPosSauNhap({ now: KIEM, nguoiKiemId: KT });
    expect((await phieuPos(p.intentId)).status).toBe("DA_THU");
    // POLLER (lượt máy) không gác sức khoẻ — đọc dữ liệu đã đồng bộ, KHÔNG ra AGENT_*.
    // KHÔNG tiêm provider: phải đi ĐÚNG `chonPosProvider({ choDongBo: false })` của poller.ts. Bản đầu tiêm một
    // provider máy dựng sẵn nên cấy C27 (poller đổi sang `choDongBo: true`) chỉ lưới mã nguồn [POS4-W4] đỏ — ca
    // hành vi này xanh trên mã đã hỏng (luật 14).
    // [Rà đối kháng GĐ4 — RV-03] ĐẢO một vế: lượt MÁY (poller) khi agent không sẵn sàng KHÔNG được kết luận
    // "thất bại / chưa thấy" từ dữ liệu CŨ (ghi đè câu D9 "ĐỪNG cho quẹt lại") — nó giữ D9 (AGENT_HET_PHIEN);
    // nhưng vẫn KHÔNG gác như lượt sale: không tạo job, không chờ, và PAID vẫn được tin (vế dưới).
    const p2 = await moPhieu({ orderId: p2Don, dot: `${T}dot-pe3` });
    const r = await chayPollerPos({ dongHo: () => sau(KIEM, PHUT) });
    expect(r.loi).toBe(0);
    expect((await nhatKy(p2.intentId)).map((l) => l.errorCode)).toEqual(["AGENT_HET_PHIEN"]);
    expect(await db.posCheckJob.count({ where: { intentId: p2.intentId } })).toBe(0);
    // Dữ liệu file có dòng thu đúng mã (KHÔNG chạy đồng bộ sau import) ⇒ poller (agent vẫn hết phiên) TIN PAID.
    const g2 = await db.paymentBill.findFirstOrThrow({ where: { orderId: p2Don, status: "OPEN" } });
    await nhapFile([dongFile({ maGiaoDich: maGd(), dienGiai: `Học phí ${g2.matchKey}`, soTien: 1_800_000 })]);
    // Phiếu đã ≥ 30′ ⇒ nhịp poller 10 phút (`lich-kiem.ts`).
    await chayPollerPos({ dongHo: () => sau(KIEM, 12 * PHUT) });
    expect((await phieuPos(p2.intentId)).status).toBe("DA_THU");
  });

  it("[POS4-CHON-02] cơ sở KHÔNG có agent / agent TẮT ⇒ chế độ FILE: câu NOT_FOUND y GĐ1 (theo lô import), không job", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await db.posAgent.update({ where: { id: AG1 }, data: { active: false } });
    await nhapFile([dongFile({ maGiaoDich: maGd(), dienGiai: "giao dịch khác" })]);
    const kq = await kiem(p.intentId, providerSale().p);
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).toMatch(/Dữ liệu Techcombank cập nhật lần cuối \d{2}:\d{2}[ .(]/);
    expect(kq.thongDiep).not.toContain("máy đồng bộ");
    expect(await db.posCheckJob.count({ where: { intentId: p.intentId } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-SYNC-01] sau mỗi lô CÓ thay đổi ⇒ kiểm lại phiếu liên quan (nguồn AGENT)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("phiếu mở cơ sở agent được kiểm; phiếu CS2 mang mã quẹt ở máy CS1 ⇒ CAN_XU_LY (Q-E); lô toàn unchanged ⇒ 0 lượt kiểm", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const don2 = `${T}don-cs2`;
    await taoDon(don2, CS2, [[`${T}item-cs2`, `${T}dot-cs2`, "Bé CS2", 2_222_000]]);
    const g2 = await phatPhieu(don2, [`${T}dot-cs2`]);
    const p2 = await moPhieu({ orderId: don2, dot: `${T}dot-cs2` });
    const row = dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g2.ma}`, order_amount: 2_222_000, transaction_master_amount: null, transaction_detail_amount: null });
    await guiLo([row]);
    expect((await nhatKy(p.intentId)).filter((l) => l.triggeredBy === "AGENT")).toHaveLength(1);
    const q2 = await phieuPos(p2.intentId);
    expect(q2.status).toBe("CAN_XU_LY");
    expect((await nhatKy(p2.intentId)).filter((l) => l.triggeredBy === "AGENT")).toHaveLength(1);
    // Lô y hệt ⇒ unchanged ⇒ không lượt kiểm nào.
    const truoc = await db.posCheckLog.count({ where: { intentId: { in: [p.intentId, p2.intentId] } } });
    const k = await guiLo([row], { now: sau(KIEM, PHUT) });
    expect(k.unchanged).toBe(1);
    expect(await db.posCheckLog.count({ where: { intentId: { in: [p.intentId, p2.intentId] } } })).toBe(truoc);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN · HEARTBEAT · CẢNH BÁO · CRON
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-ST] /status — đổi phiên MỘT lần, chuông theo cơ sở + ngày", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const st = (state: string, reason: string, now: Date) =>
    goi(statusRoute, { method: "POST", path: "/api/pos-agent/status", now, body: { state, reason, occurredAt: "2026-10-07T10:39:30+07:00", profileName: "CS1" } });

  it("[POS4-ST-01] EXPIRED ⇒ 1 sự kiện + 1 chuông; EXPIRED lần 2 ⇒ 0; READY ⇒ SESSION_READY; EXPIRED lại cùng ngày ⇒ chuông MỞ LẠI (thân giờ mới)", async () => {
    const r = await st("SESSION_EXPIRED", "NO_USER", KIEM);
    expect(r.status).toBe(200);
    expect(r.body.data?.sessionState).toBe("EXPIRED");
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).sessionState).toBe("EXPIRED");
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "SESSION_EXPIRED" } })).toBe(1);
    const c1 = await chuong(`pos.agent-het-phien:${CS1}:2026-10-07`);
    expect(c1).toHaveLength(2);
    expect(c1[0]!.body).toContain("Hết phiên lúc 10:40");
    // Admin đọc chuông.
    await db.staffNotification.updateMany({ where: { id: { in: c1.map((c) => c.id) } }, data: { readAt: KIEM } });
    await st("SESSION_EXPIRED", "HTTP_401", sau(KIEM, PHUT));
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "SESSION_EXPIRED" } })).toBe(1);
    expect((await chuong(`pos.agent-het-phien:${CS1}:`)).every((c) => c.readAt !== null)).toBe(true);
    await st("SESSION_READY", "USER_PRESENT", sau(KIEM, 30 * PHUT));
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "SESSION_READY" } })).toBe(1);
    await st("SESSION_EXPIRED", "NO_USER", sau(KIEM, 3 * 60 * PHUT));
    const c3 = await chuong(`pos.agent-het-phien:${CS1}:2026-10-07`);
    expect(c3).toHaveLength(2);
    expect(c3.every((c) => c.readAt === null), "lần hết phiên MỚI trong ngày ⇒ rung lại").toBe(true);
    expect(c3[0]!.body).toContain("Hết phiên lúc 13:40");
  });

  it("[POS4-ST-02] ERROR HEADER_NOT_CAPTURED ⇒ loiGanNhat + 1 sự kiện/ngày + 1 chuông (gửi 3 lần); mã KHÁC ⇒ chuông mở lại; phiên KHÔNG đổi", async () => {
    for (let i = 0; i < 3; i += 1) await st("ERROR", "HEADER_NOT_CAPTURED", sau(KIEM, i * GIAY));
    const a = await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } });
    expect(a).toMatchObject({ loiGanNhat: "HEADER_NOT_CAPTURED", sessionState: "READY" });
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "ERROR" } })).toBe(1);
    const c = await chuong(`pos.agent-loi:${CS1}:`);
    expect(c).toHaveLength(2);
    await db.staffNotification.updateMany({ where: { id: { in: c.map((x) => x.id) } }, data: { readAt: KIEM } });
    await st("ERROR", "HEADER_NOT_CAPTURED", sau(KIEM, 5 * GIAY));
    expect((await chuong(`pos.agent-loi:${CS1}:`)).every((x) => x.readAt !== null), "cùng mã ⇒ không rung lại").toBe(true);
    await st("ERROR", "PORTAL_BAD_SHAPE", sau(KIEM, PHUT));
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "ERROR" } })).toBe(2);
    expect((await chuong(`pos.agent-loi:${CS1}:`)).every((x) => x.readAt === null), "mã khác ⇒ rung lại").toBe(true);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-HB-01] heartbeat KHÔNG ghi sự kiện mỗi lượt", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("10 heartbeat ⇒ đúng 1 sự kiện (LAN_DAU); đổi phiên bản ⇒ +1 DOI_PHIEN_BAN; UNKNOWN không hạ READY; EXPIRED ≠ lưu ⇒ chuyển như /status", async () => {
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: null, extensionVersion: null } });
    for (let i = 0; i < 10; i += 1) {
      const r = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB(), now: sau(KIEM, i * 20 * GIAY) });
      expect(r.status).toBe(200);
    }
    expect((await db.posAgentEvent.findMany({ where: { agentId: AG1 } })).map((e) => [e.type, e.ma])).toEqual([["HEARTBEAT", "LAN_DAU"]]);
    await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB({ extensionVersion: "0.2.0" }), now: sau(KIEM, 5 * PHUT) });
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, ma: "DOI_PHIEN_BAN" } })).toBe(1);
    await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB({ extensionVersion: "0.2.0", sessionState: "UNKNOWN" }), now: sau(KIEM, 6 * PHUT) });
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).sessionState).toBe("READY");
    const ex = await goi(heartbeatRoute, { method: "POST", path: "/api/pos-agent/heartbeat", body: HB({ extensionVersion: "0.2.0", sessionState: "EXPIRED" }), now: sau(KIEM, 7 * PHUT) });
    expect(ex.body.data?.sessionState).toBe("EXPIRED");
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "SESSION_EXPIRED" } })).toBe(1);
    expect(await chuong(`pos.agent-het-phien:${CS1}:`)).toHaveLength(2);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-CR] cron giám sát + cron sáng", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS4-CR-01] mất 5′+1ms TRONG giờ ⇒ matKetNoiTuLuc + 1 sự kiện + 1 chuông; chạy lại ⇒ không thêm; request kế ⇒ KET_NOI_LAI; job 2′+ ⇒ EXPIRED; nonce cũ dọn", async () => {
    const lanCuoi = sau(KIEM, -(5 * PHUT + 1));
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: lanCuoi } });
    // AG2 chưa từng kết nối ⇒ cron KHÔNG báo.
    await db.posAgent.update({ where: { id: AG2 }, data: { lastHeartbeatAt: null } });
    await phatPhieu();
    const p = await moPhieu();
    await db.posCheckJob.create({ data: { intentId: p.intentId, agentId: AG1, centerId: CS1, tuLuc: NOW, createdAt: sau(KIEM, -(2 * PHUT + 1)) } });
    await db.posAgentNonce.create({ data: { agentId: AG1, nonce: "nonce-cu-da-qua-15p", createdAt: sau(KIEM, -16 * PHUT) } });
    const r1 = await chayGiamSatAgent({ dongHo: () => KIEM });
    expect(r1).toMatchObject({ matKetNoi: 1, jobHetHan: 1 });
    expect(r1.nonceXoa).toBeGreaterThanOrEqual(1);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).matKetNoiTuLuc?.toISOString()).toBe(lanCuoi.toISOString());
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "ERROR", ma: "MAT_KET_NOI" } })).toBe(1);
    expect(await chuong(`pos.agent-mat-ket-noi:${CS1}:2026-10-07`)).toHaveLength(2);
    expect(await chuong(`pos.agent-mat-ket-noi:${CS2}:`)).toEqual([]);
    expect((await db.posCheckJob.findFirstOrThrow({ where: { intentId: p.intentId } })).status).toBe("EXPIRED");
    expect(await db.posAgentNonce.count({ where: { nonce: "nonce-cu-da-qua-15p" } })).toBe(0);
    const r2 = await chayGiamSatAgent({ dongHo: () => sau(KIEM, PHUT) });
    expect(r2.matKetNoi).toBe(0);
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "ERROR", ma: "MAT_KET_NOI" } })).toBe(1);
    expect(await chuong(`pos.agent-mat-ket-noi:${CS1}:`)).toHaveLength(2);
    // Request hợp lệ kế tiếp ⇒ xoá dấu + KET_NOI_LAI.
    const back = await goi(jobsRoute, { method: "GET", path: "/api/pos-agent/jobs", now: sau(KIEM, 2 * PHUT) });
    expect(back.status).toBe(200);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).matKetNoiTuLuc).toBeNull();
    const lai = await db.posAgentEvent.findFirstOrThrow({ where: { agentId: AG1, ma: "KET_NOI_LAI" } });
    expect((lai.detail as { phut?: number }).phut).toBe(7);
  });

  it("[POS4-CR-01b] mất kết nối NGOÀI giờ (thứ Hai) ⇒ sự kiện, 0 chuông; còn mất lúc 08:00 thứ Ba ⇒ chuông của NGÀY MỚI", async () => {
    const thuHai = new Date("2026-10-05T03:00:00Z"); // thứ Hai 10:00 VN
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: sau(thuHai, -10 * PHUT) } });
    await chayGiamSatAgent({ dongHo: () => thuHai });
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, ma: "MAT_KET_NOI" } })).toBe(1);
    expect(await chuong(`pos.agent-mat-ket-noi:${CS1}:`)).toEqual([]);
    const thuBa8h = new Date("2026-10-06T01:00:00Z"); // thứ Ba 08:00 VN
    await chayGiamSatAgent({ dongHo: () => thuBa8h });
    expect(await chuong(`pos.agent-mat-ket-noi:${CS1}:2026-10-06`)).toHaveLength(2);
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, ma: "MAT_KET_NOI" } }), "không thêm sự kiện cho cùng lượt mất").toBe(1);
  });

  it("[POS4-CR-02] cron sáng: hết hạn 20:00 hôm nay ⇒ chuông sắp hết phiên; 21:00 ⇒ 0; phiên EXPIRED ⇒ chuông hết phiên NGÀY MỚI", async () => {
    const sang = new Date("2026-10-07T00:30:00Z"); // 07:30 VN
    await db.posAgent.update({ where: { id: AG1 }, data: { sessionExpiresAt: new Date("2026-10-07T13:00:00Z") } }); // 20:00 VN
    await db.posAgent.update({ where: { id: AG2 }, data: { sessionExpiresAt: new Date("2026-10-07T14:00:00Z") } }); // 21:00 VN
    const r = await chayCanhBaoSang({ dongHo: () => sang });
    expect(r.sapHetPhien).toBe(1);
    const c = await chuong(`pos.agent-sap-het-phien:${CS1}:2026-10-07`);
    expect(c).toHaveLength(2);
    expect(c[0]!.body).toBe("Phiên FXP4G-CS1 hết hạn lúc 20:00 hôm nay — đăng nhập lại trước giờ mở cửa.");
    expect(await chuong(`pos.agent-sap-het-phien:${CS2}:`)).toEqual([]);
    await db.posAgent.update({ where: { id: AG2 }, data: { sessionState: "EXPIRED", sessionDoiLuc: new Date("2026-10-06T15:00:00Z") } });
    const r2 = await chayCanhBaoSang({ dongHo: () => sau(sang, PHUT) });
    expect(r2.hetPhien).toBe(1);
    expect(await chuong(`pos.agent-het-phien:${CS2}:2026-10-07`)).toHaveLength(2);
  });

  it("[POS4-CR-03] hai route cron: thiếu Bearer ⇒ 401, lib KHÔNG chạy (không đổi DB)", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-fixture-pos4-0123456789");
    await db.posAgent.update({ where: { id: AG1 }, data: { lastHeartbeatAt: sau(KIEM, -10 * PHUT) } });
    for (const route of [giamSatRoute, sangRoute]) {
      const res = await route(new NextRequest("http://localhost/api/cron/x", { method: "GET" }));
      expect(res.status).toBe(401);
    }
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).matKetNoiTuLuc).toBeNull();
    const ok = await giamSatRoute(
      new NextRequest("http://localhost/api/cron/pos-agent-giam-sat", {
        method: "GET",
        headers: { authorization: "Bearer cron-secret-fixture-pos4-0123456789" },
      }),
    );
    expect(ok.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MÀN SỨC KHOẺ + ĐỐI CHIẾU
// ─────────────────────────────────────────────────────────────────────────────

function actorHo(): Actor {
  return {
    userId: ADMIN,
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

describe.skipIf(!RUN_DB_TESTS)("[POS4-MAN-01] nạp dữ liệu màn Sức khoẻ + Đối chiếu (qua scopedDb)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("sức khoẻ: trực tuyến / mất kết nối, job chờ, TB sống phiên, 20 sự kiện gần nhất; đối chiếu: 5 nhóm", async () => {
    await db.posAgent.update({ where: { id: AG2 }, data: { lastHeartbeatAt: sau(KIEM, -10 * PHUT), matKetNoiTuLuc: sau(KIEM, -10 * PHUT) } });
    await phatPhieu();
    const p = await moPhieu();
    await db.posCheckJob.create({ data: { intentId: p.intentId, agentId: AG1, centerId: CS1, tuLuc: NOW, createdAt: sau(KIEM, -GIAY) } });
    for (const [type, gio] of [
      ["SESSION_READY", 50],
      ["SESSION_EXPIRED", 30],
      ["SESSION_READY", 29],
    ] as const) {
      await db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type, createdAt: sau(KIEM, -gio * 60 * PHUT) } });
    }
    for (let i = 0; i < 25; i += 1) {
      await db.posAgentEvent.create({ data: { agentId: AG1, centerId: CS1, type: "SYNC", detail: { created: i }, createdAt: sau(KIEM, -i * GIAY) } });
    }
    const sk = await docSucKhoeAgent(scopedDb(actorHo()), KIEM);
    const a1 = sk.agents.find((a) => a.id === AG1)!;
    const a2 = sk.agents.find((a) => a.id === AG2)!;
    expect(a1).toMatchObject({ ketNoi: "TRUC_TUYEN", jobCho: 1, merchantCode: MER1, coSo: "FXP4G-CS1" });
    expect(a1.songPhien).toEqual({ soPhien: 1, tbMs: 20 * 60 * PHUT });
    expect(a1.mayKhaiDu).toBe(true);
    expect(a2.ketNoi).toBe("MAT_KET_NOI");
    expect(sk.suKien).toHaveLength(20);
    expect(sk.suKien[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(sk.suKien[19]!.createdAt.getTime());

    // Đối chiếu ngày 07/10: khớp · chỉ agent · chỉ file · agent từ chối · lệch.
    const gio = new Date("2026-10-07T03:31:35Z");
    const ghi = (ma: string, nguon: "FILE" | "AGENT", o: { soTien?: number; tuChoi?: string } = {}) =>
      db.posTxnSource.create({
        data: {
          maGiaoDich: ma,
          nguon,
          posAgentId: nguon === "AGENT" ? AG1 : null,
          lanDauThay: sau(gio, 20 * GIAY),
          lanCuoiThay: sau(gio, 20 * GIAY),
          bam: "c".repeat(64),
          soTien: o.soTien ?? TONG,
          trangThai: "Thành công",
          loaiGiaoDich: "Thanh toán",
          thoiGianGiaoDich: gio,
          tuChoi: o.tuChoi ?? null,
          centerId: CS1,
        },
      });
    await ghi(`${PFX}DC01`, "AGENT");
    await ghi(`${PFX}DC01`, "FILE");
    await ghi(`${PFX}DC02`, "AGENT");
    await ghi(`${PFX}DC03`, "FILE");
    await ghi(`${PFX}DC04`, "AGENT", { tuChoi: "AMOUNT_MISMATCH" });
    await ghi(`${PFX}DC05`, "AGENT", { soTien: 1 });
    await ghi(`${PFX}DC05`, "FILE");
    // Ngày khác — không tính.
    await db.posTxnSource.create({
      data: { maGiaoDich: `${PFX}DC99`, nguon: "FILE", lanDauThay: gio, lanCuoiThay: gio, bam: "d".repeat(64), thoiGianGiaoDich: new Date("2026-10-06T03:00:00Z"), centerId: CS1 },
    });
    const dc = await docDoiChieuNguon(scopedDb(actorHo()), "2026-10-07");
    const cuaToi = dc.dong.filter((d) => d.maGiaoDich.startsWith(PFX));
    expect(cuaToi.map((d) => [d.maGiaoDich, d.nhom]).sort()).toEqual(
      [
        [`${PFX}DC02`, "CHI_AGENT"],
        [`${PFX}DC03`, "CHI_FILE"],
        [`${PFX}DC04`, "AGENT_TU_CHOI"],
        [`${PFX}DC05`, "LECH"],
      ].sort(),
    );
    expect(dc.tong.KHOP).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG (07/10/2026) — docs/pos-gd4-thiet-ke.md phụ lục "RÀ ĐỐI KHÁNG". Mỗi ca mô tả hành vi ĐÚNG; mã
// TRƯỚC bản vá ra đúng điều ghi trong chú thích (đã tái hiện trên Postgres thật trước khi vá).
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-01] agent KHÔNG ghi được giao dịch ĐÃ CÓ của máy / cơ sở / agent khác (T29 trên dòng đã có)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Đơn CS2 một đợt + phiếu gộp — trả mã 5 ký tự. */
  async function donCs2(hau: string, gia: number) {
    const id = `${T}don-${hau}`;
    await taoDon(id, CS2, [[`${T}item-${hau}`, `${T}dot-${hau}`, `Bé ${hau}`, gia]]);
    const g = await phatPhieu(id, [`${T}dot-${hau}`]);
    return { id, dot: `${T}dot-${hau}`, ma: g.ma };
  }
  const motSo = (n: number) => ({ order_amount: n, transaction_master_amount: null, transaction_detail_amount: null });

  // Mã TRƯỚC: dòng đã có đọc theo mã KHÔNG lọc máy/cơ sở; trộn null thừa hưởng máy CS2 ⇒ Q-E cho qua ⇒ BT CS2
  // MATCHED 2.222.000 (số agent khai) + Payment vào phiếu CS2.
  it("[POS4-RV-01a] agent CS1 + transaction_id giao dịch CS2 (file, chờ tay) + terminal_code TRỐNG ⇒ MERCHANT_MISMATCH, KHÔNG đổi gì; agent CS2 (chủ máy) ⇒ nhận (đối chứng dương)", async () => {
    const d2 = await donCs2("rv1a", 2_222_000);
    const x = maGd();
    await nhapFile([dongFile({ maGiaoDich: x, dienGiai: "thanh toán lẻ", soTien: 100_000, maQuay: QUAY2, maThietBi: MAY2 })]);
    expect(await btThe(x)).toMatchObject({ status: "UNMATCHED", amount: 100_000, centerId: CS2 });
    const k = await guiLo([dongAgent({ transaction_id: x, order_description: `Học phí ${d2.ma}`, ...motSo(2_222_000), terminal_code: null, store_code: null })]);
    expect(k.rejected).toEqual([{ index: 0, transaction_id: x, code: "MERCHANT_MISMATCH" }]);
    expect(k).toMatchObject({ created: 0, updated: 0, matched: 0 });
    expect(await btThe(x)).toMatchObject({ status: "UNMATCHED", amount: 100_000, centerId: CS2 });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: x } })).toMatchObject({ maThietBi: MAY2, centerId: CS2, soTien: 100_000 });
    expect(await paymentCuaDon(d2.id)).toHaveLength(0);
    expect(await db.posTxnSource.count({ where: { maGiaoDich: x, nguon: "AGENT" } })).toBe(0);
    // ĐỐI CHỨNG DƯƠNG: agent CS2 (merchant + quầy của máy) ⇒ nhận dòng, ghi tiền vào phiếu CS2.
    const k2 = await guiLo(
      [dongAgent({ transaction_id: x, order_description: `Học phí ${d2.ma}`, ...motSo(2_222_000), merchant_code: MER2, terminal_code: QUAY2, store_code: null })],
      { agentId: AG2, now: sau(KIEM, PHUT) },
    );
    expect(k2).toMatchObject({ rejected: [], updated: 1, matched: 1 });
    expect((await btThe(x))?.status).toBe("MATCHED");
  });

  // Mã TRƯỚC: BT CS2 bị chuyển sang CS1 (centerId đổi) và ghi tiền phiếu CS1 với số agent khai.
  it("[POS4-RV-01b] agent CS1 + transaction_id giao dịch CS2 + terminal_code = quầy CS1 ⇒ MERCHANT_MISMATCH; giao dịch giữ cơ sở CS2; phiếu CS1 không có tiền", async () => {
    const g = await phatPhieu();
    const x = maGd();
    await nhapFile([dongFile({ maGiaoDich: x, dienGiai: "khách CS2 trả lẻ", soTien: 100_000, maQuay: QUAY2, maThietBi: MAY2 })]);
    const k = await guiLo([dongAgent({ transaction_id: x, order_description: `Học phí ${g.ma}` })]);
    expect(k.rejected).toEqual([{ index: 0, transaction_id: x, code: "MERCHANT_MISMATCH" }]);
    expect(await btThe(x)).toMatchObject({ status: "UNMATCHED", amount: 100_000, centerId: CS2 });
    expect(await paymentCuaDon()).toHaveLength(0);
    // ĐỐI CHỨNG DƯƠNG: dòng MỚI của máy CS1 vẫn vào (agent không bị chặn oan).
    const k2 = await guiLo([dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` })], { now: sau(KIEM, PHUT) });
    expect(k2).toMatchObject({ rejected: [], created: 1, matched: 1 });
  });

  // Mã TRƯỚC: ứng viên gốc VOID theo RRN lấy từ MỌI cơ sở ⇒ giao dịch CS2 ĐÃ GHI NHẬN bị gắn cờ hủy, phiếu POS CS2
  // ra CANCELLED_AFTER_PAID.
  it("[POS4-RV-01c] agent CS1 gửi VOID mang RRN + quầy CS2 ⇒ KHÔNG nối gốc CS2; phiếu CS2 giữ PAID; agent CS2 gửi cùng VOID ⇒ nối (đối chứng dương)", async () => {
    const d2 = await donCs2("rv1c", 2_222_000);
    const p2 = await moPhieu({ orderId: d2.id, dot: d2.dot });
    const x = maGd();
    const rrn = rrnMoi();
    const tra = { merchant_code: MER2, terminal_code: QUAY2, store_code: null };
    await guiLo([dongAgent({ transaction_id: x, card_transaction_id: rrn, order_description: `Học phí ${d2.ma}`, ...motSo(2_222_000), ...tra })], { agentId: AG2 });
    expect(await phieuPos(p2.intentId)).toMatchObject({ status: "DA_THU", lastResultKind: "PAID" });
    const v = maGd();
    const voidRow = dongAgent({
      transaction_id: v,
      transaction_type: "VOID",
      card_transaction_id: rrn,
      ...motSo(2_222_000),
      terminal_code: QUAY2,
      store_code: null,
      transaction_time: "2026/10/07 10:45:00",
    });
    await guiLo([voidRow], { now: sau(KIEM, 10 * PHUT) });
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: x } })).canhBaoHuy).toBe(false);
    expect((await db.posCardTransaction.findUnique({ where: { maGiaoDich: v } }))?.maGiaoDichGoc ?? null).toBeNull();
    expect(await phieuPos(p2.intentId)).toMatchObject({ status: "DA_THU", lastResultKind: "PAID" });
    // ĐỐI CHỨNG DƯƠNG: agent CS2 (chủ máy) gửi VOID cùng RRN (mã khác) ⇒ nối gốc, D7.
    const v2 = maGd();
    await guiLo([{ ...voidRow, transaction_id: v2, ...tra }], { agentId: AG2, now: sau(KIEM, 20 * PHUT) });
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v2 } })).maGiaoDichGoc).toBe(x);
    expect((await phieuPos(p2.intentId)).lastResultKind).toBe("CANCELLED_AFTER_PAID");
  });

  // Mã TRƯỚC: dòng do agent CS2 tạo mà CHƯA suy được máy (centerId NULL) bị agent CS1 nhận lại theo mã.
  it("[POS4-RV-01d] dòng do agent CS2 tạo (máy chưa khai ⇒ chưa có cơ sở) ⇒ agent CS1 gửi cùng mã ⇒ MERCHANT_MISMATCH (dấu nguồn của agent khác)", async () => {
    const g = await phatPhieu();
    const x = maGd();
    await guiLo([dongAgent({ transaction_id: x, ...motSo(100_000), merchant_code: MER2, terminal_code: "QTTLAA001", store_code: null })], { agentId: AG2 });
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: x } })).toMatchObject({ centerId: null, maThietBi: null });
    const k = await guiLo([dongAgent({ transaction_id: x, order_description: `Học phí ${g.ma}`, terminal_code: null, store_code: null })], { now: sau(KIEM, PHUT) });
    expect(k.rejected).toEqual([{ index: 0, transaction_id: x, code: "MERCHANT_MISMATCH" }]);
    expect(await btThe(x)).toMatchObject({ status: "UNMATCHED", amount: 100_000, centerId: null });
    expect(await paymentCuaDon()).toHaveLength(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-02] một dòng bị từ chối mang số tiền > int4 KHÔNG làm hỏng cả lô", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // Mã TRƯỚC: `ghiNguonThay` (không bọc) ném ConversionError INT4 SAU khi dòng tốt đã ghi tiền ⇒ route 500, lô
  // final không bao giờ xong (lastSyncedAt NULL mãi), gửi lại ném lại.
  it("[POS4-RV-02] [dòng tốt, dòng USD 3.000.000.000] ⇒ dòng tốt ghi tiền, dòng kia CURRENCY_UNSUPPORTED (dấu KHÔNG mang số), lastSyncedAt cập nhật; gửi lại ⇒ unchanged", async () => {
    const g = await phatPhieu();
    const tot = dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` });
    const ba = 3_000_000_000;
    const xau = dongAgent({ transaction_id: maGd(), currency: "USD", order_amount: ba, transaction_master_amount: ba, transaction_detail_amount: ba });
    const k = await guiLo([tot, xau]);
    expect(k.rejected).toEqual([{ index: 1, transaction_id: xau.transaction_id, code: "CURRENCY_UNSUPPORTED" }]);
    expect(k.matched).toBe(1);
    expect((await btThe(tot.transaction_id!))?.status).toBe("MATCHED");
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).lastSyncedAt?.toISOString()).toBe(KIEM.toISOString());
    expect(await db.posTxnSource.findFirstOrThrow({ where: { maGiaoDich: xau.transaction_id! } })).toMatchObject({
      tuChoi: "CURRENCY_UNSUPPORTED",
      soTien: null,
    });
    const k2 = await guiLo([tot, xau], { now: sau(KIEM, PHUT) });
    expect(k2).toMatchObject({ unchanged: 2, rejected: [] });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-03] lượt MÁY khi agent không sẵn sàng KHÔNG ghi đè câu D9 bằng dữ liệu CŨ", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const hetPhien = (luc: Date) =>
    db.posAgent.update({ where: { id: AG1 }, data: { sessionState: "EXPIRED", sessionDoiLuc: luc, lastHeartbeatAt: luc } });
  const thatBai = (ma: string) =>
    dongAgent({
      transaction_id: maGd(),
      order_description: `HP ${ma}`,
      transaction_detail_status: "FAIL",
      transaction_master_status: "FAIL",
      transaction_operation_msg: "USER_CANCELLED",
      transaction_time: "2026/10/07 10:05:00",
    });

  // Mã TRƯỚC: poller (choDongBo:false, không gác) đọc dòng THẤT BẠI cũ ⇒ FAILED "Khách huỷ trên máy — cho quẹt
  // lại." đè D9; phiếu rời màn sale lúc 30′ (KIND_GIU_TREN_MAN mất tác dụng).
  it("[POS4-RV-03a] quẹt 1 THẤT BẠI (đã đồng bộ) → agent hết phiên → sale D9 → poller ⇒ D9 GIỮ, phiếu không rời màn; agent sống lại ⇒ poller kết luận bình thường (đối chứng dương)", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await guiLo([thatBai(g.ma)], { now: sau(NOW, 6 * PHUT) });
    await hetPhien(sau(NOW, 8 * PHUT));
    const kq = await kiem(p.intentId, providerSale().p, { now: sau(NOW, 10 * PHUT) });
    expect(kq.thongDiep).toContain("ĐỪNG cho quẹt lại");
    await chayPollerPos({ dongHo: () => sau(NOW, 11 * PHUT) });
    const s = await phieuPos(p.intentId);
    expect(s.lastResultKind).toBe("PROVIDER_ERROR");
    expect(s.lastResultMessage).toContain("ĐỪNG cho quẹt lại");
    expect(
      anKhoiManSale({ status: s.status, createdAt: s.createdAt, lastResultKind: s.lastResultKind, coGiaoDichChoTay: false }, sau(NOW, 31 * PHUT)),
    ).toBe(false);
    expect(await db.posCheckJob.count({ where: { intentId: p.intentId } })).toBe(0);
    // ĐỐI CHỨNG DƯƠNG: agent sẵn sàng lại ⇒ poller đọc dữ liệu (lúc này là dữ liệu tươi) ⇒ FAILED.
    await db.posAgent.update({ where: { id: AG1 }, data: { sessionState: "READY", lastHeartbeatAt: sau(NOW, 12 * PHUT) } });
    await chayPollerPos({ dongHo: () => sau(NOW, 12 * PHUT) });
    expect(await phieuPos(p.intentId)).toMatchObject({ lastResultKind: "FAILED", lastResultMessage: "Khách huỷ trên máy — cho quẹt lại." });
  });

  // Mã TRƯỚC: poller thay D9 bằng "Chưa thấy giao dịch… cập nhật lần cuối 10:04:00" — mất câu cấm quẹt lại.
  it("[POS4-RV-03b] CHO_QUET, có giao dịch KHÁC sau lúc tạo phiếu, agent hết phiên ⇒ poller GIỮ D9", async () => {
    await phatPhieu();
    const p = await moPhieu();
    await guiLo([dongAgent({ transaction_id: maGd(), order_description: "khach khac", transaction_time: "2026/10/07 10:03:00" })], { now: sau(NOW, 4 * PHUT) });
    await hetPhien(sau(NOW, 5 * PHUT));
    await kiem(p.intentId, providerSale().p, { now: sau(NOW, 10 * PHUT) });
    await chayPollerPos({ dongHo: () => sau(NOW, 11 * PHUT) });
    const s = await phieuPos(p.intentId);
    expect(s.lastResultKind).toBe("PROVIDER_ERROR");
    expect(s.lastResultMessage).toContain("ĐỪNG cho quẹt lại");
  });

  // Mã TRƯỚC: lượt kiểm cuối của poller ra NOT_FOUND ⇒ choPhepHetHan ⇒ HET_HAN dù nguồn dữ liệu đang chết.
  it("[POS4-RV-03c] quá 24h, agent hết phiên ⇒ poller KHÔNG ghi HET_HAN; agent sẵn sàng ⇒ HET_HAN (đối chứng dương)", async () => {
    await phatPhieu();
    const p = await moPhieu();
    const QUA = sau(NOW, 24 * 60 * PHUT + PHUT);
    await hetPhien(sau(QUA, -PHUT));
    const r = await chayPollerPos({ dongHo: () => QUA });
    expect(r.hetHan).toBe(0);
    expect(await phieuPos(p.intentId)).toMatchObject({ status: "CHO_QUET", lastResultKind: "PROVIDER_ERROR" });
    await db.posAgent.update({ where: { id: AG1 }, data: { sessionState: "READY", lastHeartbeatAt: sau(QUA, 11 * PHUT) } });
    const r2 = await chayPollerPos({ dongHo: () => sau(QUA, 11 * PHUT) });
    expect(r2.hetHan).toBe(1);
    expect((await phieuPos(p.intentId)).status).toBe("HET_HAN");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-04] PAYMENT và VOID của CÙNG một lượt đồng bộ ở HAI lô ⇒ 0 tiền (hội tụ với file)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // Mã TRƯỚC: lô 0 (final:false) đi lõi ngay ⇒ THU ⇒ 1 bộ Payment + BT MATCHED; lô 1 chỉ bật cờ D7. File cùng dữ
  // liệu (`dongHuyCuaFile`) ra 0 Payment.
  it("[POS4-RV-04a] lô 0 final:false PAYMENT có mã, lô 1 final:true VOID cùng RRN ⇒ PAYMENT BO_QUA, 0 Payment, 0 giao dịch; lô 0 trả staged", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    const k0 = await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: "sync-rv04a",
      batchIndex: 0,
      final: false,
    });
    expect(k0).toMatchObject({ received: 1, staged: 1, created: 0, matched: 0, rejected: [] });
    expect(await btThe(m)).toBeNull();
    await guiLo([dongAgent({ transaction_id: v, transaction_type: "VOID", card_transaction_id: rrn, transaction_time: "2026/10/07 10:45:00" })], {
      syncId: "sync-rv04a",
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect(await btThe(m)).toBeNull();
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).matchStatus).toBe("BO_QUA");
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v } })).maGiaoDichGoc).toBe(m);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).lastSyncedAt?.toISOString()).toBe(sau(KIEM, 2 * GIAY).toISOString());
  });

  it("[POS4-RV-04b] lô final mà THIẾU lô trước của lượt ⇒ vẫn ghi phần đã có, nhưng KHÔNG đẩy lastSyncedAt / KHÔNG DONE job (lượt sau gửi lại)", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await kiem(p.intentId, providerSale().p);
    const job = await db.posCheckJob.findFirstOrThrow({ where: { intentId: p.intentId } });
    await guiLo([dongAgent({ transaction_id: maGd(), order_description: "lô 0" })], { syncId: "sync-rv04b", batchIndex: 0, final: false, now: sau(KIEM, GIAY) });
    const k = await guiLo([dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` })], {
      syncId: "sync-rv04b",
      batchIndex: 2,
      final: true,
      jobIds: [job.id],
      now: sau(KIEM, 2 * GIAY),
    });
    expect(k.created).toBe(2);
    expect(k.jobsDone).toBe(0);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).lastSyncedAt).toBeNull();
    expect((await db.posCheckJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-05] VOID tới trong cửa sổ chống bấm dồn 5″ vẫn đưa phiếu lên CANCELLED_AFTER_PAID", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // Mã TRƯỚC: lượt AGENT của tín hiệu hủy ra CACHE (lastCheckAt của lượt PAYMENT 2″ trước) ⇒ phiếu kẹt PAID mãi.
  it("[POS4-RV-05] PAYMENT ghi nhận ⇒ VOID cùng RRN 2″ sau ⇒ CANCELLED_AFTER_PAID", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })]);
    expect((await phieuPos(p.intentId)).lastResultKind).toBe("PAID");
    await guiLo([dongAgent({ transaction_id: maGd(), transaction_type: "VOID", card_transaction_id: rrn, transaction_time: "2026/10/07 10:45:00" })], {
      now: sau(KIEM, 2 * GIAY),
    });
    expect(await phieuPos(p.intentId)).toMatchObject({ status: "DA_THU", lastResultKind: "CANCELLED_AFTER_PAID" });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-06] job chỉ DONE khi cửa sổ đồng bộ PHỦ lúc bấm; bấm lại KHÔNG dùng lại job agent đã lấy", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Lần quẹt 1 THẤT BẠI (10:30) đã đồng bộ; trả phiếu POS. */
  async function thatBaiDaDongBo() {
    const g = await phatPhieu();
    const p = await moPhieu();
    await guiLo(
      [
        dongAgent({
          transaction_id: maGd(),
          order_description: `HP ${g.ma}`,
          transaction_detail_status: "FAIL",
          transaction_master_status: "FAIL",
          transaction_operation_msg: "USER_CANCELLED",
          transaction_time: "2026/10/07 10:30:00",
        }),
      ],
      { now: sau(NOW, 31 * PHUT) },
    );
    return p;
  }

  // Mã TRƯỚC: DONE bỏ qua windowTo ⇒ sale (bấm 10:40:00) đọc FAILED cũ ⇒ "Khách huỷ trên máy — cho quẹt lại."
  it("[POS4-RV-06a] lô final mang jobIds với windowTo 10:39:40 < lúc bấm 10:40:00 ⇒ job GIỮ PENDING ⇒ 'chưa trả lời kịp'; cửa sổ phủ lúc bấm ⇒ DONE (đối chứng dương)", async () => {
    const p = await thatBaiDaDongBo();
    const chay = (windowTo: string, luc: Date) => async () => {
      const jobs = await docJobChoAgent(AG1, sau(luc, GIAY));
      await guiLo([], { now: sau(luc, 2 * GIAY), jobIds: jobs.map((j) => j.id), windowTo });
    };
    const kq = await kiem(p.intentId, providerSale(chay("2026-10-07 10:39:40", KIEM)).p);
    expect(kq.thongDiep).toContain("chưa trả lời kịp");
    expect((await db.posCheckJob.findMany({ where: { intentId: p.intentId }, select: { status: true } })).map((j) => j.status)).toEqual(["PENDING"]);
    const B2 = sau(KIEM, 10 * GIAY);
    const kq2 = await kiem(p.intentId, providerSale(chay("2026-10-07 10:40:11", B2)).p, { now: B2 });
    expect(kq2.thongDiep).toBe("Khách huỷ trên máy — cho quẹt lại.");
  });

  // Mã TRƯỚC: bấm 2 DÙNG LẠI job của bấm 1; agent đóng nó bằng lượt bắt đầu 10:40:06 (trước lần quẹt 2 lúc
  // 10:40:07) ⇒ bấm 2 nhận "cho quẹt lại".
  it("[POS4-RV-06b] bấm 1 (agent bận) ⇒ bấm 2 sau 9″ tạo job MỚI; lượt agent cũ đóng job CŨ ⇒ bấm 2 vẫn 'chưa trả lời kịp'", async () => {
    const p = await thatBaiDaDongBo();
    const kq1 = await kiem(p.intentId, providerSale().p);
    expect(kq1.thongDiep).toContain("chưa trả lời kịp");
    const jobCu = await docJobChoAgent(AG1, sau(KIEM, 6 * GIAY));
    expect(jobCu).toHaveLength(1);
    const B2 = sau(KIEM, 9 * GIAY);
    const kq2 = await kiem(
      p.intentId,
      providerSale(async () => {
        await guiLo([], { now: sau(B2, GIAY), jobIds: jobCu.map((j) => j.id), windowTo: "2026-10-07 10:40:06" });
      }).p,
      { now: B2 },
    );
    expect(kq2.thongDiep).toContain("chưa trả lời kịp");
    const jobs = await db.posCheckJob.findMany({ where: { intentId: p.intentId }, orderBy: { createdAt: "asc" }, select: { status: true } });
    expect(jobs.map((j) => j.status)).toEqual(["EXPIRED", "PENDING"]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-07] trạng thái agent 'treo' KHÔNG đẩy giao dịch đang ở hàng chờ sang IGNORED", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // Mã TRƯỚC: SUCCESS/SETTLED ⇒ lõi luật 1 ⇒ BO_QUA ⇒ BT UNMATCHED → IGNORED vĩnh viễn (gửi lại SUCCESS vô ích).
  it("[POS4-RV-07] lệch số (UNMATCHED) → master_status SETTLED ⇒ VẪN UNMATCHED + cột hậu kết toán cập nhật; SUCCESS lại ⇒ UNMATCHED; 'Thất bại' rõ ràng ⇒ IGNORED (đối chứng)", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const lech = TONG - 100_000;
    const row = dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, order_amount: lech, transaction_master_amount: lech, transaction_detail_amount: lech });
    await guiLo([row]);
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    const truoc = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    await guiLo([{ ...row, transaction_master_status: "SETTLED", accounting_reference_id: "HT0001TREO" }], { now: sau(KIEM, PHUT) });
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    expect(await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).toMatchObject({
      matchStatus: truoc.matchStatus,
      trangThai: "Thành công",
      maHachToan: "HT0001TREO",
    });
    await guiLo([row], { now: sau(KIEM, 2 * PHUT) });
    expect((await btThe(m))?.status).toBe("UNMATCHED");
    // ĐỐI CHỨNG: "Thất bại" RÕ RÀNG (cả hai trường FAIL) vẫn là luật lõi ⇒ ra khỏi hàng chờ.
    await guiLo([{ ...row, transaction_detail_status: "FAIL", transaction_master_status: "FAIL" }], { now: sau(KIEM, 3 * PHUT) });
    expect((await btThe(m))?.status).toBe("IGNORED");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS4-RV-09] cơ sở chế độ FILE: lượt kiểm KHÔNG gắn nhãn nguồn TCB_PORTAL cho giao dịch file", () => {
  beforeEach(dungFixture);
  afterAll(don);

  // Mã TRƯỚC: provider luôn `nguonDuLieu = TCB_PORTAL` ⇒ pha tiền cập nhật BT UNMATCHED với rawPayload.nguon TCB_PORTAL.
  it("[POS4-RV-09] agent TẮT; file nhập khi máy chưa gán ⇒ khai máy ⇒ sale bấm ⇒ MATCHED, nhãn nguồn GIỮ SMARTPOS", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await db.posAgent.update({ where: { id: AG1 }, data: { active: false } });
    await db.posTerminal.update({ where: { maThietBi: MAY1 }, data: { active: false } });
    const m = maGd();
    await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}` })]);
    expect(((await btThe(m))?.rawPayload as { nguon?: string } | null)?.nguon).toBe("SMARTPOS");
    await db.posTerminal.update({ where: { maThietBi: MAY1 }, data: { active: true } });
    await kiem(p.intentId, providerSale().p);
    const bt = await btThe(m);
    expect(bt?.status).toBe("MATCHED");
    expect((bt?.rawPayload as { nguon?: string } | null)?.nguon).toBe("SMARTPOS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHỐT HỢP ĐỒNG GĐ4 ↔ GĐ5 (07/10/2026 — `docs/pos-agent-api.md` bản 1.1; đề xuất RV5.4 của GĐ5). Mỗi ca mô tả hành
// vi ĐÚNG; chú thích ghi mã TRƯỚC bản vá ra gì.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-CHOT] chốt hợp đồng: vượt trần ⇒ từ chối DÒNG · 'dữ liệu đã đọc tới' · mốc nguồn SESSION", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const dauAgent = (ma: string) => db.posTxnSource.findUnique({ where: { maGiaoDich_nguon: { maGiaoDich: ma, nguon: "AGENT" } } });

  // Mã TRƯỚC: `dongAgentSchema` canh `.max(128)` ⇒ cả lô 400 PAYLOAD_INVALID `transactions[1].store_code` — dòng TỐT
  // cũng không vào sổ, job không DONE.
  it("[POS4-CHOT-01] route THẬT: [dòng tốt mang mã phiếu, dòng store_code 129 ký tự] ⇒ 200; dòng tốt THU; dòng dài ⇒ rejected FIELD_TOO_LONG + field; dấu không mang chuỗi dài; job VẪN DONE (TỰ QUYẾT); gửi lại ⇒ unchanged", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const job = await db.posCheckJob.create({ data: { intentId: p.intentId, agentId: AG1, centerId: CS1, tuLuc: NOW, createdAt: sau(KIEM, -GIAY) } });
    const tot = dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` });
    const dai = dongAgent({ transaction_id: maGd(), store_code: "S".repeat(129) });
    const than = (syncId: string, jobIds: string[]) => ({
      syncId,
      batchIndex: 0,
      final: true,
      windowFrom: "2026-10-07 08:00:00",
      windowTo: "2026-10-07 10:41:00",
      jobIds,
      transactions: [tot, dai],
    });
    const r = await goi(transactionsRoute, { method: "POST", path: "/api/pos-agent/transactions", body: than("sync-chot01", [job.id]), now: KIEM });
    expect(r.status).toBe(200);
    expect(r.body.data?.rejected).toEqual([{ index: 1, transaction_id: dai.transaction_id, code: "FIELD_TOO_LONG", field: "store_code" }]);
    expect(r.body.data).toMatchObject({ received: 2, created: 1, matched: 1, jobsDone: 1 });
    expect((await btThe(tot.transaction_id!))?.status).toBe("MATCHED");
    expect(await btThe(dai.transaction_id!)).toBeNull();
    expect(await db.posCardTransaction.findUnique({ where: { maGiaoDich: dai.transaction_id! } })).toBeNull();
    const dau = await dauAgent(dai.transaction_id!);
    expect(dau?.tuChoi).toBe("FIELD_TOO_LONG");
    expect(JSON.stringify(dau)).not.toContain("S".repeat(129));
    expect((await db.posCheckJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
    const r2 = await goi(transactionsRoute, { method: "POST", path: "/api/pos-agent/transactions", body: than("sync-chot01b", []), now: sau(KIEM, PHUT) });
    expect(r2.status).toBe(200);
    expect(r2.body.data).toMatchObject({ rejected: [], unchanged: 2, created: 0 });
  });

  // Mã TRƯỚC: lô final:false cũng 400 cả lô ⇒ dòng tốt không xếp chờ; lượt không bao giờ final ⇒ tê liệt.
  it("[POS4-CHOT-02] lô final:false có dòng vượt trần ⇒ rejected theo index + KHÔNG xếp chờ dòng đó; dòng tốt xếp chờ; lô final của lượt THU dòng tốt + DONE job + ghi 'dữ liệu đã đọc tới'", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const job = await db.posCheckJob.create({ data: { intentId: p.intentId, agentId: AG1, centerId: CS1, tuLuc: NOW, createdAt: sau(KIEM, -GIAY) } });
    const dai = dongAgent({ transaction_id: maGd(), transaction_master_status: "M".repeat(129) });
    const tot = dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` });
    const k0 = await guiLo([dai, tot], { syncId: "sync-chot02", batchIndex: 0, final: false });
    expect(k0).toMatchObject({
      staged: 1,
      created: 0,
      rejected: [{ index: 0, transaction_id: dai.transaction_id, code: "FIELD_TOO_LONG", field: "transaction_master_status" }],
    });
    const cho = await db.posAgentLoCho.findUniqueOrThrow({
      where: { agentId_syncId_batchIndex: { agentId: AG1, syncId: "sync-chot02", batchIndex: 0 } },
    });
    expect(JSON.stringify(cho.dong)).not.toContain("M".repeat(129));
    // Dấu từ chối chụp bản đã CẮT về trần (trạng thái ghép "SUCCESS/MMM…" ≤ 128 ký tự mỗi vế) — không phần vượt.
    const dau = await dauAgent(dai.transaction_id!);
    expect(dau?.tuChoi).toBe("FIELD_TOO_LONG");
    expect(JSON.stringify(dau)).not.toContain("M".repeat(129));
    const lucFinal = sau(KIEM, 2 * GIAY);
    const k1 = await guiLo([], { syncId: "sync-chot02", batchIndex: 1, final: true, jobIds: [job.id], windowTo: "2026-10-07 10:41:00", now: lucFinal });
    expect(k1).toMatchObject({ created: 1, matched: 1, jobsDone: 1, rejected: [] });
    const a = await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } });
    expect(a.lastSyncedAt?.toISOString()).toBe(lucFinal.toISOString());
    expect(a.duLieuDenLuc?.toISOString()).toBe(new Date("2026-10-07T10:41:00+07:00").toISOString());
  });

  // Mã TRƯỚC: không có cột — màn in "đồng bộ xong lúc" = giờ máy chủ NHẬN lô, không phải mốc dữ liệu đã đọc tới.
  it("[POS4-CHOT-03] 'dữ liệu đã đọc tới' chỉ ghi CÙNG lastSyncedAt (lô final ĐỦ lô): final:false ⇒ không; final THIẾU lô ⇒ không; final đủ ⇒ = windowTo (giờ VN ⇒ mốc tuyệt đối); màn đọc được", async () => {
    const doc = () => db.posAgent.findUniqueOrThrow({ where: { id: AG1 }, select: { lastSyncedAt: true, duLieuDenLuc: true } });
    await guiLo([], { syncId: "sync-chot03a", batchIndex: 0, final: false, windowTo: "2026-10-07 10:30:00" });
    expect(await doc()).toEqual({ lastSyncedAt: null, duLieuDenLuc: null });
    await guiLo([], { syncId: "sync-chot03b", batchIndex: 2, final: true, windowTo: "2026-10-07 10:31:00", now: sau(KIEM, GIAY) });
    expect(await doc(), "lô final THIẾU lô 0..1 ⇒ không ghi").toEqual({ lastSyncedAt: null, duLieuDenLuc: null });
    const luc = sau(KIEM, 2 * GIAY);
    await guiLo([], { syncId: "sync-chot03c", batchIndex: 0, final: true, windowTo: "2026-10-07 10:36:00", now: luc });
    expect(await doc()).toEqual({ lastSyncedAt: luc, duLieuDenLuc: new Date("2026-10-07T03:36:00Z") });
    const sk = await docSucKhoeAgent(scopedDb(actorHo()), sau(luc, GIAY));
    expect(sk.agents.find((x) => x.id === AG1)).toMatchObject({ lastSyncedAt: luc, duLieuDenLuc: new Date("2026-10-07T03:36:00Z") });
  });

  // Mã TRƯỚC (lượt chốt đầu): dòng FIELD_TOO_LONG chỉ ghi sự kiện ERROR gộp (agent, mã, ngày); `/status ERROR
  // FIELD_TOO_LONG` của extension rơi vào CÙNG dòng gộp (`moi = false`) ⇒ KHÔNG ai nhận chuông — lệch hợp đồng câm.
  it("[POS4-CHOT-05] dòng FIELD_TOO_LONG ⇒ MỘT chuông `pos.agent-loi` / cơ sở / ngày từ MÁY CHỦ; dòng vượt trần khác + extension /status ERROR cùng mã ⇒ loiGanNhat, KHÔNG rung lại; đối chứng: dòng BAD_TIME ⇒ không chuông", async () => {
    await guiLo([dongAgent({ transaction_id: maGd(), transaction_time: "sai giờ" })]);
    expect(await chuong(`pos.agent-loi:${CS1}:`), "từ chối vì DỮ LIỆU (BAD_TIME) không chuông — như trước").toEqual([]);
    await guiLo([dongAgent({ transaction_id: maGd(), store_code: "S".repeat(129) })], { now: sau(KIEM, GIAY) });
    const c1 = await chuong(`pos.agent-loi:${CS1}:2026-10-07`);
    expect(c1).toHaveLength(2);
    expect(c1[0]!.title).toContain("FIELD_TOO_LONG");
    await db.staffNotification.updateMany({ where: { id: { in: c1.map((c) => c.id) } }, data: { readAt: KIEM } });
    await guiLo([dongAgent({ transaction_id: maGd(), currency: "V".repeat(17) })], { now: sau(KIEM, 2 * GIAY) });
    const st = await goi(statusRoute, {
      method: "POST",
      path: "/api/pos-agent/status",
      now: sau(KIEM, 3 * GIAY),
      body: { state: "ERROR", reason: "FIELD_TOO_LONG", occurredAt: "2026-10-07T10:40:03+07:00" },
    });
    expect(st.status).toBe(200);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).loiGanNhat).toBe("FIELD_TOO_LONG");
    expect(await db.posAgentEvent.count({ where: { agentId: AG1, type: "ERROR", ma: "FIELD_TOO_LONG" } })).toBe(1);
    expect((await chuong(`pos.agent-loi:${CS1}:`)).every((c) => c.readAt !== null), "cùng mã cùng ngày ⇒ không rung lại").toBe(true);
  });

  // Mã TRƯỚC: heartbeat lưu mọi `sessionExpiresAt` bất kể nguồn ⇒ mốc `expires` TRƯỢT của NextAuth (+30 ngày) hiện như
  // hạn phiên thật; cùng cơ chế, một mốc SESSION "hôm nay 20:00" làm 07:30 rung "sắp hết phiên" theo một mốc không tin được.
  it("[POS4-CHOT-04] heartbeat mốc nguồn SESSION ⇒ KHÔNG rõ hạn: lưu null, 07:30 KHÔNG chuông; cùng mốc nguồn ACCESS_TOKEN ⇒ lưu + chuông (đối chứng dương)", async () => {
    const homNay20h = "2026-10-07T20:00:00+07:00";
    const r = await goi(heartbeatRoute, {
      method: "POST",
      path: "/api/pos-agent/heartbeat",
      body: { ...HB({ sessionExpiresAt: homNay20h }), sessionExpiresSource: "SESSION" },
      now: new Date("2026-10-07T00:29:00Z"),
    });
    expect(r.status).toBe(200);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).sessionExpiresAt).toBeNull();
    await chayCanhBaoSang({ dongHo: () => new Date("2026-10-07T00:30:00Z") });
    expect(await chuong(`pos.agent-sap-het-phien:${CS1}:`)).toEqual([]);
    await goi(heartbeatRoute, {
      method: "POST",
      path: "/api/pos-agent/heartbeat",
      body: { ...HB({ sessionExpiresAt: homNay20h }), sessionExpiresSource: "ACCESS_TOKEN" },
      now: new Date("2026-10-07T00:31:00Z"),
    });
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).sessionExpiresAt?.toISOString()).toBe("2026-10-07T13:00:00.000Z");
    await chayCanhBaoSang({ dongHo: () => new Date("2026-10-07T00:32:00Z") });
    expect(await chuong(`pos.agent-sap-het-phien:${CS1}:2026-10-07`)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG BẢN GỘP GĐ3 × GĐ4 + hợp đồng 1.1 (07/10/2026). Mỗi ca mô tả hành vi ĐÚNG; chú thích ghi mã TRƯỚC
// bản vá ra gì.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-RVG] dòng bị TỪ CHỐI không được làm job 'xong' sai, không được làm mất VOID", () => {
  beforeEach(dungFixture);
  afterAll(don);

  /** Một giao dịch KHÁC (không mã) ở máy CS1 SAU lúc tạo phiếu ⇒ dữ liệu "đã có giao dịch sau lúc tạo phiếu". */
  const giaoDichKhacSauTao = () =>
    guiLo([dongAgent({ transaction_id: maGd(), order_description: "khách khác", transaction_time: "2026/10/07 10:20:00" })], {
      now: sau(KIEM, -15 * PHUT),
    });

  // Mã TRƯỚC: job DONE (C1 — dòng bị từ chối không chặn đóng job) ⇒ provider đọc ⇒ không có dòng nào mang mã ⇒
  // NOT_FOUND ⇒ "Chưa thấy giao dịch mang mã …" KHÔNG kèm câu cấm (cơ sở đã có giao dịch khác sau lúc tạo phiếu)
  // — trong khi chính lần quẹt của sale nằm trong dòng bị từ chối: khách đã bị trừ thẻ, sale được mời kiểm lại/quẹt lại.
  it("[POS4-RVG-01] lần quẹt CỦA SALE bị từ chối (AMOUNT_MISMATCH) trong lô trả job ⇒ KHÔNG 'Chưa thấy', câu PHẢI cấm quẹt lại", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await giaoDichKhacSauTao();
    const m = maGd();
    let jobsDone = -1;
    const { p: prov } = providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, KIEM);
      const r = await guiLo(
        [dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, transaction_master_amount: TONG + 1_000 })],
        { jobIds: jobs.map((j) => j.id) },
      );
      jobsDone = r.jobsDone;
      expect(r.rejected).toEqual([{ index: 0, transaction_id: m, code: "AMOUNT_MISMATCH" }]);
    });
    const kq = await kiem(p.intentId, prov);
    expect(jobsDone).toBe(1);
    expect(kq.status).toBe("CHO_QUET");
    expect(kq.thongDiep).not.toContain("Chưa thấy giao dịch");
    expect(kq.thongDiep).toContain("không đọc được dữ liệu");
    expect(kq.thongDiep).toContain("ĐỪNG cho quẹt lại");
  });

  // Mã TRƯỚC: lần 1 THẤT BẠI (đã đồng bộ) + lần quẹt lại THÀNH CÔNG bị từ chối (FIELD_TOO_LONG — extension lệch hợp
  // đồng) ⇒ provider chỉ thấy lần thất bại ⇒ FAILED ⇒ "Giao dịch thất bại (mã THAT_BAI) — cho quẹt lại." ⇒ trừ thẻ lần HAI.
  it("[POS4-RVG-01b] lần 1 thất bại + lần quẹt lại thành công bị từ chối (FIELD_TOO_LONG) ⇒ KHÔNG THAT_BAI 'cho quẹt lại'", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await guiLo(
      [
        dongAgent({
          transaction_id: maGd(),
          order_description: `Học phí ${g.ma}`,
          transaction_detail_status: "FAIL",
          transaction_master_status: "FAIL",
          transaction_time: "2026/10/07 10:20:00",
        }),
      ],
      { now: sau(KIEM, -15 * PHUT) },
    );
    const { p: prov } = providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, KIEM);
      await guiLo(
        [dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}`, transaction_operation_msg: "X".repeat(501) })],
        { jobIds: jobs.map((j) => j.id) },
      );
    });
    const kq = await kiem(p.intentId, prov);
    // Trạng thái THAT_BAI là của lần quẹt 1 (đã đồng bộ, lượt AGENT kết luận đúng) — phiếu vẫn MỞ. Thứ phải đúng là CÂU
    // của lượt này: không mời quẹt lại khi còn một dòng không đọc được.
    expect(kq.thongDiep).not.toMatch(/— cho quẹt lại\./);
    expect(kq.thongDiep).toContain("không đọc được dữ liệu");
    expect(kq.thongDiep).toContain("ĐỪNG cho quẹt lại");
  });

  // ĐỐI CHỨNG (vế hẹp của bản vá): dòng bị từ chối NGOÀI cửa sổ đọc của phiếu ⇒ câu thường (CHUA_THAY); dòng bị từ chối
  // mà sau đó ĐÃ có dòng POS cùng mã (file nhập bản đọc được — dấu AGENT vẫn mang `tuChoi`) ⇒ không còn "không đọc được"
  // ⇒ kết luận thường: "Thất bại — cho quẹt lại" là ĐÚNG khi file nói rõ thất bại.
  it("[POS4-RVG-01c] đối chứng: từ chối NGOÀI cửa sổ ⇒ CHUA_THAY như cũ; từ chối rồi file ĐỌC ĐƯỢC (Thất bại) ⇒ THAT_BAI", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await guiLo([dongAgent({ transaction_id: maGd(), transaction_master_amount: 1, transaction_time: "2026/10/07 09:40:00" })], {
      now: sau(KIEM, -30 * PHUT),
    });
    const kq1 = await kiem(p.intentId, providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, KIEM);
      await guiLo([], { jobIds: jobs.map((j) => j.id) });
    }).p);
    expect(kq1.thongDiep).toContain("Chưa thấy giao dịch mang mã");
    const m = maGd();
    const sai = dongAgent({
      transaction_id: m,
      order_description: `Học phí ${g.ma}`,
      transaction_detail_status: "FAIL",
      transaction_master_status: "FAIL",
      transaction_master_amount: TONG + 1,
    });
    expect((await guiLo([sai], { now: sau(KIEM, GIAY) })).rejected).toEqual([{ index: 0, transaction_id: m, code: "AMOUNT_MISMATCH" }]);
    await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}`, trangThai: "Thất bại" })]);
    const lan2 = sau(KIEM, 10 * GIAY);
    const kq2 = await kiem(p.intentId, providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, lan2);
      await guiLo([], { jobIds: jobs.map((j) => j.id), now: lan2 });
    }).p, { now: lan2 });
    expect(kq2.status).toBe("THAT_BAI");
    expect(kq2.thongDiep).toBe("Giao dịch thất bại (mã THAT_BAI) — cho quẹt lại.");
  });

  // Mã TRƯỚC: cặp PAYMENT (mang mã) + VOID cùng RRN trong CÙNG lô, VOID bị từ chối (AMOUNT_MISMATCH) ⇒ PAYMENT đi lõi
  // một mình ⇒ THU ⇒ Payment + phiếu DA_THU cho một lần quẹt ĐÃ HỦY trên máy. Cùng dữ liệu qua file ⇒ 0 Payment.
  it("[POS4-RVG-02] PAYMENT + VOID (bị từ chối) cùng RRN trong một lô ⇒ KHÔNG ghi tiền tự động", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    const kq = await guiLo([
      dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn }),
      dongAgent({
        transaction_id: v,
        transaction_type: "VOID",
        order_description: `Học phí ${g.ma}`,
        card_transaction_id: rrn,
        transaction_time: "2026/10/07 10:33:00",
        transaction_detail_amount: TONG - 1,
      }),
    ]);
    expect(kq.rejected).toEqual([{ index: 1, transaction_id: v, code: "AMOUNT_MISMATCH" }]);
    // Dòng GIỮ LẠI không phải "y hệt lần trước" (unchanged) và không được xử lý (không created / matched).
    expect(kq).toMatchObject({ received: 2, unchanged: 0, created: 0, matched: 0 });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect((await btThe(m))?.status ?? null).not.toBe("MATCHED");
    expect((await phieuPos(p.intentId)).status).not.toBe("DA_THU");
    // Sale bấm Kiểm tra ⇒ KHÔNG "Chưa thấy" / "cho quẹt lại": có giao dịch mà máy đồng bộ không đọc được.
    const lan = sau(KIEM, 10 * GIAY);
    const kiemSale = await kiem(p.intentId, providerSale(async () => {
      const jobs = await docJobChoAgent(AG1, lan);
      await guiLo([], { jobIds: jobs.map((j) => j.id), now: lan });
    }).p, { now: lan });
    expect(kiemSale.status).toBe("CHO_QUET");
    expect(kiemSale.thongDiep).toContain("không đọc được dữ liệu");
    expect(kiemSale.thongDiep).toContain("ĐỪNG cho quẹt lại");
    // Dòng hủy ĐỌC ĐƯỢC ở lượt sau (gửi lại cả cặp) ⇒ cặp về đúng chỗ như file: PAYMENT bỏ qua, 0 Payment.
    await guiLo(
      [
        dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn }),
        dongAgent({
          transaction_id: v,
          transaction_type: "VOID",
          order_description: `Học phí ${g.ma}`,
          card_transaction_id: rrn,
          transaction_time: "2026/10/07 10:33:00",
        }),
      ],
      { now: sau(KIEM, PHUT) },
    );
    expect(await paymentCuaDon()).toHaveLength(0);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).matchStatus).toBe("BO_QUA");
  });

  // Cùng luật ở lô final:false (RV-04): dòng thanh toán bị GIỮ LẠI thì KHÔNG xếp chờ — không thì lô final của lượt đưa nó
  // vào lõi một mình (dòng hủy bị từ chối không được xếp chờ). Mã TRƯỚC: staged 1 ⇒ lô final THU ⇒ Payment.
  it("[POS4-RVG-02d] lô final:false [PAYMENT, VOID bị từ chối cùng RRN] ⇒ PAYMENT KHÔNG xếp chờ; lô final ⇒ 0 Payment", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    const k0 = await guiLo(
      [
        dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn }),
        dongAgent({
          transaction_id: maGd(),
          transaction_type: "VOID",
          card_transaction_id: rrn,
          transaction_time: "2026/10/07 10:33:00",
          transaction_detail_amount: TONG - 1,
        }),
      ],
      { syncId: "sync-rvg02d", batchIndex: 0, final: false },
    );
    expect(k0).toMatchObject({ staged: 0, created: 0 });
    await guiLo([], { syncId: "sync-rvg02d", batchIndex: 1, final: true, now: sau(KIEM, 2 * GIAY) });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect(await btThe(m)).toBeNull();
  });

  // ĐỐI CHỨNG: dòng bị từ chối là THANH TOÁN (không phải tín hiệu hủy) cùng RRN với thanh toán đã ghi nhận ⇒ KHÔNG bật
  // cảnh báo hủy cho kế toán (cảnh báo giả là cảnh báo người ta học cách bỏ qua).
  it("[POS4-RVG-02e] đối chứng: dòng THANH TOÁN bị từ chối cùng RRN ⇒ gốc KHÔNG bị cảnh báo hủy", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })]);
    expect((await btThe(m))?.status).toBe("MATCHED");
    const r = await guiLo(
      [dongAgent({ transaction_id: maGd(), card_transaction_id: rrn, transaction_time: "2026/10/07 10:45:00", transaction_detail_amount: 1 })],
      { now: sau(KIEM, 10 * PHUT) },
    );
    expect(r.rejected.map((x) => x.code)).toEqual(["AMOUNT_MISMATCH"]);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).canhBaoHuy).toBe(false);
  });

  // ĐỐI CHỨNG: dòng hủy bị từ chối mang RRN KHÁC ⇒ không ghép với PAYMENT nào ⇒ PAYMENT THU bình thường (vế hẹp).
  it("[POS4-RVG-02c] đối chứng: VOID bị từ chối KHÁC RRN ⇒ PAYMENT vẫn THU (Payment đủ số)", async () => {
    const g = await phatPhieu();
    const m = maGd();
    await guiLo([
      dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` }),
      dongAgent({ transaction_id: maGd(), transaction_type: "VOID", transaction_time: "2026/10/07 10:33:00", transaction_detail_amount: TONG - 1 }),
    ]);
    expect((await btThe(m))?.status).toBe("MATCHED");
    expect((await paymentCuaDon()).map((x) => x.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
  });

  // Mã TRƯỚC: PAYMENT đã ghi nhận (lượt trước) ⇒ VOID cùng RRN tới sau nhưng bị từ chối ⇒ KHÔNG ai được báo: gốc không
  // cảnh báo, phiếu giữ "Đã thu" — tín hiệu hủy sau ghi nhận (D7) mất hẳn khi không còn nhập file hằng ngày (GĐ6).
  it("[POS4-RVG-02b] PAYMENT đã ghi nhận ⇒ VOID cùng RRN bị từ chối ⇒ gốc PHẢI mang cảnh báo cho kế toán (D7), tiền KHÔNG đổi", async () => {
    const g = await phatPhieu();
    await moPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })]);
    expect((await btThe(m))?.status).toBe("MATCHED");
    const pmTruoc = await paymentCuaDon();
    const v = maGd();
    const voidSai = dongAgent({
      transaction_id: v,
      transaction_type: "VOID",
      card_transaction_id: rrn,
      transaction_time: "2026/10/07 10:45:00",
      transaction_detail_amount: TONG - 1,
    });
    const r = await guiLo([voidSai], { now: sau(KIEM, 10 * PHUT) });
    expect(r.rejected).toEqual([{ index: 0, transaction_id: v, code: "AMOUNT_MISMATCH" }]);
    const goc = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(goc.canhBaoHuy).toBe(true);
    expect(goc.matchReason).toContain(v);
    expect((await btThe(m))?.status).toBe("MATCHED");
    expect((await paymentCuaDon()).map((x) => [x.id, x.amount])).toEqual(pmTruoc.map((x) => [x.id, x.amount]));
    // Kế toán đóng cảnh báo ⇒ agent gửi lại y hệt (unchanged) ⇒ KHÔNG mở lại, lý do KHÔNG nối lần hai.
    await db.posCardTransaction.update({ where: { id: goc.id }, data: { canhBaoHuy: false, canhBaoDaXuLyLuc: sau(KIEM, 11 * PHUT) } });
    await guiLo([voidSai], { now: sau(KIEM, 12 * PHUT) });
    const sauGuiLai = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(sauGuiLai.canhBaoHuy).toBe(false);
    expect(sauGuiLai.matchReason).toBe(goc.matchReason);
  });

  // Mã TRƯỚC: nhánh "treo" (RV-07) bỏ qua lõi ⇒ giao dịch ĐÃ GHI NHẬN mà agent báo số tiền + trạng thái KHÁC không
  // được báo lệch (GĐ3 V5–V7) — 0 dòng audit.
  it("[POS4-RVG-03] file đã ghi nhận ⇒ agent báo trạng thái 'treo' + số tiền khác ⇒ sổ GIỮ, audit lệch CÓ", async () => {
    const g = await phatPhieu();
    const m = maGd();
    await nhapFile([dongFile({ maGiaoDich: m, dienGiai: `Học phí ${g.ma}` })]);
    expect((await btThe(m))?.status).toBe("MATCHED");
    const B = TONG + 1_000;
    // ĐỐI CHỨNG trong CÙNG lô: giao dịch CHƯA ghi nhận (hàng chờ tay, UNMATCHED) cũng nhận trạng thái treo + số khác ⇒
    // KHÔNG được báo "đã ghi nhận nhưng ghi khác" (V7 — chỉ MATCHED).
    const m2 = maGd();
    await guiLo([dongAgent({ transaction_id: m2, order_description: "không mã" })], { now: sau(KIEM, -PHUT) });
    expect((await btThe(m2))?.status).toBe("UNMATCHED");
    await guiLo([
      dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, transaction_master_status: "SETTLED", ...soTien3(B) }),
      dongAgent({ transaction_id: m2, order_description: "không mã", transaction_master_status: "SETTLED", ...soTien3(B) }),
    ]);
    expect(await btThe(m)).toMatchObject({ status: "MATCHED", amount: TONG });
    const a = await auditLechAgent();
    expect(a).toHaveLength(1);
    const lech = (a[0]!.newValues as { lech?: { maGiaoDich: string; truong: string }[] }).lech ?? [];
    expect(lech.map((l) => `${l.maGiaoDich}|${l.truong}`).sort()).toEqual([`${m}|soTien`, `${m}|trangThai`]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R9 (07/10/2026) — rà extension GĐ5: cặp PAYMENT + VOID (cùng RRN) rơi vào HAI LÔ khác nhau của MỘT lượt, dòng VOID bị
// TỪ CHỐI ở một lô final:false. Bước ⑥b (RVG-02) chỉ nhìn dòng CÙNG LÔ, lô chờ chỉ giữ dòng NHẬN ⇒ lô final không biết
// VOID đã bị từ chối ⇒ PAYMENT đi lõi một mình ⇒ THU cho lần quẹt ĐÃ HỦY. Mỗi ca mô tả hành vi ĐÚNG; chú thích ghi mã
// TRƯỚC bản vá ra gì.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("[POS4-R9] VOID bị từ chối ở MỘT lô, PAYMENT ở lô KHÁC của cùng lượt ⇒ KHÔNG ghi tiền", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const voidSai = (rrn: string, v = maGd()) =>
    dongAgent({
      transaction_id: v,
      transaction_type: "VOID",
      card_transaction_id: rrn,
      transaction_time: "2026/10/07 10:33:00",
      transaction_detail_amount: TONG - 1, // AMOUNT_MISMATCH
    });
  const soLoChoCuaLuot = (syncId: string) => db.posAgentLoCho.count({ where: { agentId: AG1, syncId } });

  // Mã TRƯỚC: lô 0 xếp chờ PAYMENT; lô 1 (final:false) từ chối VOID — lô chờ KHÔNG giữ dòng bị từ chối; lô 2 (final) gom
  // PAYMENT một mình ⇒ THU ⇒ 2 Payment (đủ số hai đợt) cho lần quẹt đã hủy.
  it("[POS4-R9a] PAYMENT ở lô 0, VOID bị từ chối ở lô 1 (đều final:false), lô final rỗng ⇒ 0 Payment, phiếu KHÔNG đã thu", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9a";
    const k0 = await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 0,
      final: false,
    });
    expect(k0).toMatchObject({ staged: 1, created: 0 });
    const k1 = await guiLo([voidSai(rrn, v)], { syncId: s, batchIndex: 1, final: false, now: sau(KIEM, GIAY) });
    expect(k1.rejected).toEqual([{ index: 0, transaction_id: v, code: "AMOUNT_MISMATCH" }]);
    await guiLo([], { syncId: s, batchIndex: 2, final: true, now: sau(KIEM, 2 * GIAY) });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect((await btThe(m))?.status ?? null).not.toBe("MATCHED");
    expect(await db.posCardTransaction.findUnique({ where: { maGiaoDich: m } })).toBeNull(); // GIỮ LẠI: không ghi gì
    expect((await phieuPos(p.intentId)).status).not.toBe("DA_THU");
    expect(await soLoChoCuaLuot(s)).toBe(0); // lô chờ (cả phần dòng hủy bị từ chối) dọn ở lô final
    // Lượt SAU gửi lại cả cửa sổ, cặp lại rơi hai lô (VOID vẫn bị từ chối) ⇒ vẫn 0 Payment.
    const s2 = "sync-r9a-lan2";
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s2,
      batchIndex: 0,
      final: false,
      now: sau(KIEM, PHUT),
    });
    await guiLo([voidSai(rrn, v)], { syncId: s2, batchIndex: 1, final: false, now: sau(KIEM, PHUT + GIAY) });
    await guiLo([], { syncId: s2, batchIndex: 2, final: true, now: sau(KIEM, PHUT + 2 * GIAY) });
    expect(await paymentCuaDon()).toHaveLength(0);
  });

  // Chiều NGƯỢC (nguyên văn phát hiện): VOID bị từ chối ở lô TRƯỚC, PAYMENT ở lô SAU — ở đây PAYMENT nằm ngay lô final.
  // Mã TRƯỚC: lô final không có dòng bị từ chối nào trong tay ⇒ PAYMENT THU.
  it("[POS4-R9b] VOID bị từ chối ở lô 0 (final:false), PAYMENT ở lô 1 (final:true) ⇒ 0 Payment", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9b";
    const k0 = await guiLo([voidSai(rrn, v)], { syncId: s, batchIndex: 0, final: false });
    expect(k0.rejected).toEqual([{ index: 0, transaction_id: v, code: "AMOUNT_MISMATCH" }]);
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect(await btThe(m)).toBeNull();
    expect((await phieuPos(p.intentId)).status).not.toBe("DA_THU");
  });

  // Mã TRƯỚC: PAYMENT ở lô 1 (final:false) được xếp chờ; lô final rỗng gom nó một mình ⇒ THU.
  it("[POS4-R9c] VOID bị từ chối ở lô 0, PAYMENT ở lô 1 (final:false), lô final rỗng ở lô 2 ⇒ 0 Payment", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9c";
    await guiLo([voidSai(rrn)], { syncId: s, batchIndex: 0, final: false });
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 1,
      final: false,
      now: sau(KIEM, GIAY),
    });
    await guiLo([], { syncId: s, batchIndex: 2, final: true, now: sau(KIEM, 2 * GIAY) });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect(await btThe(m)).toBeNull();
  });

  // ĐỐI CHỨNG (vế hẹp): VOID bị từ chối mang RRN KHÁC ở lô trước ⇒ không ghép được ⇒ PAYMENT vẫn THU (bản vá không
  // được giữ tiền của người vô can).
  it("[POS4-R9d] đối chứng: VOID bị từ chối KHÁC RRN ở lô trước ⇒ PAYMENT ở lô sau vẫn THU (Payment đủ số)", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const s = "sync-r9d";
    await guiLo([voidSai(rrnMoi())], { syncId: s, batchIndex: 0, final: false });
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}` })], {
      syncId: s,
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect((await btThe(m))?.status).toBe("MATCHED");
    expect((await paymentCuaDon()).map((x) => x.amount)).toEqual([DOT_TIEN_A, DOT_TIEN_B]);
  });

  // ĐỐI CHỨNG: dòng bị từ chối là THANH TOÁN (không phải tín hiệu hủy) cùng RRN ở lô trước ⇒ KHÔNG giữ PAYMENT.
  it("[POS4-R9e] đối chứng: dòng THANH TOÁN bị từ chối cùng RRN ở lô trước ⇒ PAYMENT hợp lệ ở lô sau vẫn THU", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9e";
    const k0 = await guiLo([dongAgent({ transaction_id: maGd(), card_transaction_id: rrn, transaction_detail_amount: 1 })], {
      syncId: s,
      batchIndex: 0,
      final: false,
    });
    expect(k0.rejected.map((x) => x.code)).toEqual(["AMOUNT_MISMATCH"]);
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect((await btThe(m))?.status).toBe("MATCHED");
  });

  // ĐỐI CHỨNG hành vi cũ GIỮ NGUYÊN: VOID HỢP LỆ ở lô trước (xếp chờ) + PAYMENT ở lô sau ⇒ cặp về đúng chỗ như file
  // (PAYMENT BO_QUA, 0 Payment, VOID nối gốc). Không phải đường mới — canh để bản vá không phá nó.
  it("[POS4-R9f] đối chứng: VOID HỢP LỆ ở lô 0, PAYMENT ở lô 1 (final) ⇒ PAYMENT BO_QUA, 0 Payment, VOID nối gốc", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9f";
    const k0 = await guiLo(
      [dongAgent({ transaction_id: v, transaction_type: "VOID", card_transaction_id: rrn, transaction_time: "2026/10/07 10:45:00" })],
      { syncId: s, batchIndex: 0, final: false },
    );
    expect(k0).toMatchObject({ staged: 1, rejected: [] });
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect(await paymentCuaDon()).toHaveLength(0);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).matchStatus).toBe("BO_QUA");
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: v } })).maGiaoDichGoc).toBe(m);
  });

  // Cùng mã dòng: lô trước bị từ chối, lô CUỐI gửi lại ĐÚNG mã đó và nhận được ⇒ dòng sau thắng (luật "trùng mã ⇒ giữ
  // dòng SAU") ⇒ không còn tín hiệu từ chối nào ⇒ cặp về đúng chỗ (PAYMENT BO_QUA) — không giữ PAYMENT mãi.
  it("[POS4-R9g] VOID bị từ chối ở lô 1 rồi CÙNG mã được nhận ở lô final (dòng sau thắng) ⇒ cặp đi lõi, PAYMENT BO_QUA, 0 Payment", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9g";
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 0,
      final: false,
    });
    await guiLo([voidSai(rrn, v)], { syncId: s, batchIndex: 1, final: false, now: sau(KIEM, GIAY) });
    await guiLo(
      [dongAgent({ transaction_id: v, transaction_type: "VOID", card_transaction_id: rrn, transaction_time: "2026/10/07 10:33:00" })],
      { syncId: s, batchIndex: 2, final: true, now: sau(KIEM, 2 * GIAY) },
    );
    expect(await paymentCuaDon()).toHaveLength(0);
    expect((await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } })).matchStatus).toBe("BO_QUA");
  });

  // D7 ở lô final: PAYMENT ĐÃ GHI NHẬN (lượt trước), VOID bị từ chối ở lô 0 của lượt sau ⇒ gốc mang cảnh báo; lô final
  // KHÔNG nối lý do lần hai (phép ghi có điều kiện "lý do chưa nhắc mã dòng hủy").
  it("[POS4-R9h] PAYMENT đã ghi nhận ⇒ VOID bị từ chối ở lô 0 (final:false) của lượt sau ⇒ gốc mang cảnh báo D7 đúng MỘT lần, tiền KHÔNG đổi", async () => {
    const g = await phatPhieu();
    await moPhieu();
    const m = maGd();
    const v = maGd();
    const rrn = rrnMoi();
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })]);
    const pmTruoc = await paymentCuaDon();
    const s = "sync-r9h";
    await guiLo([voidSai(rrn, v)], { syncId: s, batchIndex: 0, final: false, now: sau(KIEM, 10 * PHUT) });
    await guiLo([], { syncId: s, batchIndex: 1, final: true, now: sau(KIEM, 10 * PHUT + GIAY) });
    const goc = await db.posCardTransaction.findUniqueOrThrow({ where: { maGiaoDich: m } });
    expect(goc.canhBaoHuy).toBe(true);
    expect(goc.matchReason?.split(v).length).toBe(2); // mã dòng hủy xuất hiện ĐÚNG một lần
    expect((await paymentCuaDon()).map((x) => [x.id, x.amount])).toEqual(pmTruoc.map((x) => [x.id, x.amount]));
  });

  // Cột `huyTuChoi` hỏng (không đọc được) ⇒ như lô chờ hỏng: lô final vẫn ghi phần đọc được nhưng KHÔNG đóng job / KHÔNG
  // đẩy lastSyncedAt (lượt sau gửi lại cả cửa sổ) — không lặng lẽ coi là "không có tín hiệu hủy".
  it("[POS4-R9i] cột huyTuChoi của lô chờ KHÔNG đọc được ⇒ lô final KHÔNG đẩy lastSyncedAt / KHÔNG DONE job", async () => {
    const g = await phatPhieu();
    const p = await moPhieu();
    await kiem(p.intentId, providerSale().p);
    const job = await db.posCheckJob.findFirstOrThrow({ where: { intentId: p.intentId } });
    const s = "sync-r9i";
    await guiLo([dongAgent({ transaction_id: maGd(), order_description: `Học phí ${g.ma}` })], { syncId: s, batchIndex: 0, final: false, now: sau(KIEM, GIAY) });
    await db.posAgentLoCho.update({
      where: { agentId_syncId_batchIndex: { agentId: AG1, syncId: s, batchIndex: 0 } },
      data: { huyTuChoi: [{ ma: 123 }] },
    });
    const k = await guiLo([], { syncId: s, batchIndex: 1, final: true, jobIds: [job.id], now: sau(KIEM, 2 * GIAY) });
    expect(k.jobsDone).toBe(0);
    expect((await db.posAgent.findUniqueOrThrow({ where: { id: AG1 } })).lastSyncedAt).toBeNull();
    expect((await db.posCheckJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
  });

  // ĐỐI CHỨNG đường lưu/đọc lô chờ: VOID bị từ chối ở lô TRƯỚC giờ quẹt của PAYMENT (10:31:35) ⇒ không thể hủy một lần quẹt
  // xảy ra SAU nó ⇒ PAYMENT vẫn THU. Mất `gio` khi lưu (hoặc không đọc lại) ⇒ giữ thanh toán oan.
  it("[POS4-R9j] đối chứng: VOID bị từ chối ở lô trước mang GIỜ SỚM HƠN PAYMENT cùng RRN ⇒ PAYMENT vẫn THU", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9j";
    await guiLo([{ ...voidSai(rrn), transaction_time: "2026/10/07 10:10:00" }], { syncId: s, batchIndex: 0, final: false });
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect((await btThe(m))?.status).toBe("MATCHED");
  });

  // ĐỐI CHỨNG: VOID bị từ chối ở lô trước mang QUẦY KHÁC quầy của PAYMENT (cùng RRN) ⇒ không ghép ⇒ PAYMENT vẫn THU.
  it("[POS4-R9k] đối chứng: VOID bị từ chối ở lô trước mang QUẦY khác PAYMENT cùng RRN ⇒ PAYMENT vẫn THU", async () => {
    const g = await phatPhieu();
    const m = maGd();
    const rrn = rrnMoi();
    const s = "sync-r9k";
    const k0 = await guiLo([{ ...voidSai(rrn), terminal_code: QUAY2 }], { syncId: s, batchIndex: 0, final: false });
    expect(k0.rejected.map((x) => x.code)).toEqual(["AMOUNT_MISMATCH"]);
    await guiLo([dongAgent({ transaction_id: m, order_description: `Học phí ${g.ma}`, card_transaction_id: rrn })], {
      syncId: s,
      batchIndex: 1,
      final: true,
      now: sau(KIEM, 2 * GIAY),
    });
    expect((await btThe(m))?.status).toBe("MATCHED");
  });
});
