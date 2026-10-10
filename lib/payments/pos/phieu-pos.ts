import "server-only";
// lib/payments/pos/phieu-pos.ts — TẠO phiếu thu thẻ POS + BÁO ADMIN (GĐ1 POS · 06/10/2026).
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §6.1, §6.3. Phiếu POS là TAY CẦM của sale cho MỘT phiếu gộp (mã 5
// ký tự US-10 — D1: một hệ mã). KHÔNG ghi tiền (lưới `[POS1-W1]`): tiền chỉ vào qua thân dòng chung
// (`khopGiaoDichThe` / `nhapLoPos`).
//
// Action gọi tệp này SAU cổng quyền + phạm vi + cờ (`congDuongB(…, "payments:pos-check")`). Tầng này
// đọc bằng `db` trần — người bấm đã qua cổng phạm vi của CHÍNH đơn này.
//
// Bốn cổng của "Thu bằng thẻ POS", cổng nào cũng đứng TRƯỚC phép ghi đầu tiên (luật rollback):
//   T9  đơn CHỜ DUYỆT ⇒ không phát mã, không mở phiếu (kể cả khi mã đã phát) — hỏi TRƯỚC khi phát
//       phiếu gộp, và hỏi LẠI dưới khoá đơn;
//   T10 cơ sở chưa khai máy POS đang bật ⇒ không mở phiếu (quẹt máy chưa khai chắc chắn ra "Thiết bị
//       chưa gán cơ sở" — nút ấy là lời hứa suông, luật 12);
//   T21 phiếu gộp có giao dịch thẻ LECH_TIEN/CAN_XU_LY còn ở hàng chờ ⇒ không mở phiếu mới (chặn trừ
//       thẻ khách lần hai khi lần một chưa ngã ngũ). Hỏi theo MÃ của phiếu gộp (`maCoGiaoDichChoTay`),
//       không chỉ theo giao dịch phiếu POS ĐÃ NHẬN — rà đối kháng 06/10/2026: ghi chú 2 mã (D2 không
//       cho nhận) và phiếu cũ bị thay trước khi file về đều lọt cổng cũ;
//   ·   "một phiếu POS ĐANG MỞ mỗi phiếu gộp" do DB gác (`PosPaymentIntent_paymentBillId_mo_key`).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { khoaDonTrongTx, type KetQuaGhi } from "@/lib/finance/ghi-tien-don";
import { docPhieuDeThuTrongTx, docPhieuGopDangMo, taoPhieuGop } from "@/lib/finance/phieu-gop";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { laDonChoDuyet, lyDoChuaDuyetQr } from "@/lib/orders/cho-duyet";
import { loiDotKhacDangGiu, trangThaiQrDot } from "@/lib/payments/qr-theo-dot";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import {
  dungPhieuPosView,
  HAN_PHIEU_POS_MS,
  lyDoKhongBaoAdmin,
  phieuPosHetHan,
  TRANG_THAI_MO,
  type PhieuPosView,
} from "./phieu-pos-luat";
import { nguoiNhanBaoPos } from "./nguoi-nhan-bao-pos";
import { tachMaPos } from "./tach-ma-pos";
import { CUA_SO_LUI_MS } from "./provider/tcb-file";

type Tx = Prisma.TransactionClient;

/**
 * T21 THEO MÃ (rà đối kháng 06/10/2026) — mã nào trong `phieu` còn giao dịch thẻ nằm HÀNG CHỜ TAY:
 * dòng POS mang mã (token đứng riêng, qua checksum — `tachMaPos`, D2) có giao dịch UNMATCHED, quẹt
 * từ `tu` trở đi. Gồm cả giao dịch phiếu POS KHÔNG nhận (ghi chú 2 mã; quẹt dưới phiếu cũ đã bị thay
 * trước khi file về). Cổng máy chủ (`taoPhieuPosTrongKhoa`) và màn đơn (`choKeToan`) gọi CÙNG hàm.
 *
 * KHÔNG scope (câu tra để CHẶN — CLAUDE.md "PaymentMethod"): quẹt ở máy cơ sở khác vẫn là tiền đã
 * trừ thẻ khách. `tu` = mốc phiếu gộp phát mã (hoặc phiếu POS đầu tiên, lấy cái sớm hơn) − 5 phút —
 * mã có thể được cấp lại cho phiếu gộp sau, giao dịch cũ hơn mốc không phải của phiếu này.
 */
export async function maCoGiaoDichChoTay(
  client: Pick<Tx, "posCardTransaction">,
  phieu: readonly { code5: string; tu: Date }[],
): Promise<Set<string>> {
  if (phieu.length === 0) return new Set();
  const rows = await client.posCardTransaction.findMany({
    where: {
      bankTransaction: { status: "UNMATCHED" },
      OR: phieu.map((x) => ({
        dienGiai: { contains: x.code5, mode: "insensitive" as const },
        thoiGianGiaoDich: { gte: x.tu },
      })),
    },
    select: { dienGiai: true, thoiGianGiaoDich: true },
    take: 200,
  });
  const co = new Set<string>();
  for (const x of phieu) {
    if (rows.some((r) => r.thoiGianGiaoDich.getTime() >= x.tu.getTime() && tachMaPos(r.dienGiai).includes(x.code5))) {
      co.add(x.code5);
    }
  }
  return co;
}

/** Mốc tìm giao dịch chờ tay của MỘT phiếu gộp: sớm hơn của (lúc phát mã, phiếu POS đầu) − 5 phút. */
function mocChoTay(billTao: Date, phieuPosTao: readonly Date[]): Date {
  const som = Math.min(billTao.getTime(), ...phieuPosTao.map((d) => d.getTime()));
  return new Date(som - CUA_SO_LUI_MS);
}

/** Gắn `coGiaoDichChoTay` cho các phiếu POS đọc từ DB (màn đơn) — một câu tra cho cả danh sách. */
async function ganChoTay<T extends { code5: string; createdAt: Date; paymentBillId: string; paymentBill: { createdAt: Date } }>(
  ds: readonly T[],
): Promise<(T & { coGiaoDichChoTay: boolean })[]> {
  const theoBill = new Map<string, { code5: string; billTao: Date; tao: Date[] }>();
  for (const p of ds) {
    const g = theoBill.get(p.paymentBillId) ?? { code5: p.code5, billTao: p.paymentBill.createdAt, tao: [] };
    g.tao.push(p.createdAt);
    theoBill.set(p.paymentBillId, g);
  }
  const co = await maCoGiaoDichChoTay(
    db,
    [...theoBill.values()].map((g) => ({ code5: g.code5, tu: mocChoTay(g.billTao, g.tao) })),
  );
  return ds.map((p) => ({ ...p, coGiaoDichChoTay: co.has(p.code5) }));
}

/**
 * Từ chối SAU khi đã vào transaction — phải NÉM (return không rollback). Bắt và dịch ở ngoài, như
 * `LoiPhatPhieu` của phiếu gộp.
 */
export class LoiPhieuPos extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiPhieuPos";
  }
}

const LOI_CHUA_KHAI_MAY = "Cơ sở chưa khai máy POS — Kế toán HO khai ở tab Máy POS";
const LOI_GIAO_DICH_CHO_TAY = "Giao dịch thẻ trước còn chờ kế toán xử lý — xử lý xong mới thu thẻ tiếp";

const CHON_DUYET = {
  id: true,
  centerId: true,
  discountApprovalStatus: true,
  installmentApprovalStatus: true,
  soBuoiApprovalStatus: true,
} as const satisfies Prisma.OrderSelect;

const CHON_VIEW = {
  id: true,
  code5: true,
  amount: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  lastCheckAt: true,
  lastResultKind: true,
  lastResultMessage: true,
  paymentBillId: true,
  posTerminal: { select: { id: true, maThietBi: true, maQuay: true, ten: true } },
  bankTransaction: { select: { status: true, allocations: { select: { paymentRequestId: true } } } },
  paymentBill: {
    select: { status: true, orderId: true, createdAt: true, lines: { select: { paymentRequestId: true } } },
  },
} as const satisfies Prisma.PosPaymentIntentSelect;

/** View của một phiếu POS (hộp phiếu POS trên màn đơn). `null` nếu không có. */
export async function docPhieuPosView(intentId: string, now: Date): Promise<PhieuPosView | null> {
  const tho = await db.posPaymentIntent.findUnique({ where: { id: intentId }, select: CHON_VIEW });
  if (!tho) return null;
  const [ds, phieuMo] = await Promise.all([ganChoTay([tho]), docPhieuGopDangMo(tho.paymentBill.orderId)]);
  const p = ds[0];
  return p ? dungPhieuPosView({ intent: p, phieuMo, now }) : null;
}

/**
 * Phiếu POS của một đơn cho MÀN ĐƠN (§7.1) — 10 phiếu mới nhất, `createdAt` giảm dần; trang chọn
 * MỘT (`chonPhieuPosHienThi`) sau khi biết phiếu gộp đang mở rồi dựng view (thuần, không `await`).
 * Trang gọi SAU cổng phạm vi của chính đơn (scopedDb đã cho đọc đơn này) — đọc bằng `db` trần như
 * `docPhieuPosView`.
 */
export async function docPhieuPosTho(orderId: string) {
  const ds = await db.posPaymentIntent.findMany({
    where: { paymentBill: { orderId } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: CHON_VIEW,
  });
  return ganChoTay(ds);
}

/**
 * "Thu bằng thẻ POS" cho MỘT đợt: dùng lại phiếu gộp đang mở chứa đợt đó (T15), chưa có thì phát
 * phiếu gộp 1 dòng (`taoPhieuGop` — đường "Xuất QR" sẵn có), rồi mở phiếu POS. Bấm lại khi phiếu
 * còn hạn ⇒ trả lại CHÍNH nó, không ghi gì (`[POS1-LC-01]`).
 */
export async function moPhieuPos(input: {
  orderId: string;
  paymentRequestId: string;
  /** Bắt buộc khi cơ sở có > 1 máy đang bật. */
  posTerminalId?: string;
  /** `id` là User thật — `PosPaymentIntent.createdById` có khoá ngoại. */
  actor: { id: string; name: string };
  /** BẮT BUỘC (luật 19, T18): `createdAt` của phiếu = mốc này. */
  now: Date;
}): Promise<KetQuaGhi<{ phieu: PhieuPosView; taoMoi: boolean }>> {
  // ── Cổng TRƯỚC khi phát phiếu gộp: đơn chờ duyệt / chưa cơ sở / chưa khai máy. ──
  const don = await db.order.findUnique({ where: { id: input.orderId }, select: CHON_DUYET });
  if (!don) return { ok: false, error: "Không tìm thấy đơn hàng" };
  if (!don.centerId) return { ok: false, error: "Đơn chưa gán cơ sở — không thu thẻ được" };
  const lyDoDuyet = lyDoChuaDuyetQr(laDonChoDuyet(don));
  if (lyDoDuyet) return { ok: false, error: lyDoDuyet };
  const may = await db.posTerminal.findMany({ where: { centerId: don.centerId, active: true }, select: { id: true } });
  if (may.length === 0) return { ok: false, error: LOI_CHUA_KHAI_MAY };
  if (input.posTerminalId === undefined && may.length > 1) {
    return { ok: false, error: "Cơ sở có nhiều máy POS — chọn máy sẽ quẹt" };
  }
  if (input.posTerminalId !== undefined && !may.some((m) => m.id === input.posTerminalId)) {
    return { ok: false, error: "Máy POS không thuộc cơ sở của đơn hoặc đã tắt — tải lại trang" };
  }

  // ── Phiếu gộp: dùng lại / phát mới / đợt khác đang giữ mã (khuôn `trangThaiQrDot`). ──
  const mo = await docPhieuGopDangMo(input.orderId);
  const tt = trangThaiQrDot({
    bat: true, // cổng cờ đã hỏi ở action (congDuongB) cho CƠ SỞ ĐƠN
    dongPhieuMo: mo ? mo.dong.map((d) => ({ paymentRequestId: d.paymentRequestId, nhan: d.ten })) : null,
    paymentRequestId: input.paymentRequestId,
  });
  let billId: string;
  if (tt.kieu === "MOI_CUA_DOT_KHAC") return { ok: false, error: loiDotKhacDangGiu(tt.nhanDotDangGiu) };
  if (tt.kieu === "MOI_CUA_DOT_NAY" && mo) {
    billId = mo.billId;
  } else {
    const g = await taoPhieuGop({ orderId: input.orderId, paymentRequestIds: [input.paymentRequestId], actor: input.actor });
    if (!g.ok) return { ok: false, error: g.error };
    if (g.canhBaoKho) console.warn(`[phieu-gop] CẠN KHO MÃ: ${g.canhBaoKho}`);
    billId = g.billId;
  }

  let kq: { intentId: string; taoMoi: boolean };
  try {
    kq = await db.$transaction((tx) =>
      taoPhieuPosTrongKhoa(tx, {
        orderId: input.orderId,
        billId,
        posTerminalId: input.posTerminalId,
        actor: input.actor,
        now: input.now,
      }),
    );
  } catch (err) {
    if (err instanceof LoiPhieuPos) return { ok: false, error: err.message };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Hai lượt bấm chen nhau vượt khoá (không xảy ra khi cùng khoá đơn) — DB vẫn gác.
      return { ok: false, error: "Phiếu thu thẻ vừa được tạo ở nơi khác — tải lại trang" };
    }
    throw err;
  }

  const phieu = await docPhieuPosView(kq.intentId, input.now);
  if (!phieu) throw new Error(`Không đọc lại được phiếu POS ${kq.intentId}`);
  return { ok: true, phieu, taoMoi: kq.taoMoi };
}

async function taoPhieuPosTrongKhoa(
  tx: Tx,
  x: { orderId: string; billId: string; posTerminalId: string | undefined; actor: AuditActor & { id: string }; now: Date },
): Promise<{ intentId: string; taoMoi: boolean }> {
  await khoaDonTrongTx(tx, x.orderId);

  // ── CỔNG — mọi từ chối là `throw`, đứng TRƯỚC phép ghi đầu tiên. ──
  const don = await tx.order.findUnique({ where: { id: x.orderId }, select: CHON_DUYET });
  if (!don?.centerId) throw new LoiPhieuPos("Đơn chưa gán cơ sở — không thu thẻ được");
  const lyDoDuyet = lyDoChuaDuyetQr(laDonChoDuyet(don));
  if (lyDoDuyet) throw new LoiPhieuPos(lyDoDuyet);

  // "Còn phải thu" đọc DƯỚI khoá đơn bằng ĐÚNG phép tính đường thu dùng (`docPhieuDeThuTrongTx`).
  const phieu = await docPhieuDeThuTrongTx(tx, x.billId);
  if (!phieu || phieu.orderId !== x.orderId || phieu.status !== "OPEN" || !phieu.matchKey) {
    throw new LoiPhieuPos("Phiếu gộp không còn mở — tải lại trang");
  }
  if (phieu.conPhaiThu <= 0) throw new LoiPhieuPos("Phiếu gộp không còn khoản phải thu");

  // T21 — giao dịch thẻ trước của CHÍNH phiếu gộp này còn ở hàng chờ tay: (i) giao dịch phiếu POS đã
  // nhận, HOẶC (ii) bất kỳ giao dịch thẻ nào mang MÃ của phiếu gộp (phiếu POS không nhận được: ghi chú
  // 2 mã · quẹt dưới phiếu cũ đã bị thay trước khi file về). Ca `[POS1-LC-06]`, `[POS1-VA-DB-02..04]`.
  const choTay = await tx.posPaymentIntent.findFirst({
    where: {
      paymentBillId: x.billId,
      status: { in: ["LECH_TIEN", "CAN_XU_LY"] },
      bankTransaction: { status: "UNMATCHED" },
    },
    select: { id: true },
  });
  if (choTay) throw new LoiPhieuPos(LOI_GIAO_DICH_CHO_TAY);
  const billTao = await tx.paymentBill.findUniqueOrThrow({ where: { id: x.billId }, select: { createdAt: true } });
  const phieuDau = await tx.posPaymentIntent.findFirst({
    where: { paymentBillId: x.billId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const theoMa = await maCoGiaoDichChoTay(tx, [
    { code5: phieu.matchKey, tu: mocChoTay(billTao.createdAt, phieuDau ? [phieuDau.createdAt] : []) },
  ]);
  if (theoMa.size > 0) throw new LoiPhieuPos(LOI_GIAO_DICH_CHO_TAY);

  // Máy đọc lại dưới khoá (vừa tắt giữa chừng thì từ chối).
  const may = await tx.posTerminal.findMany({ where: { centerId: don.centerId, active: true }, select: { id: true } });
  const mayId = x.posTerminalId ?? (may.length === 1 ? may[0]!.id : null);
  if (may.length === 0) throw new LoiPhieuPos(LOI_CHUA_KHAI_MAY);
  if (!mayId || !may.some((m) => m.id === mayId)) throw new LoiPhieuPos("Chọn máy POS sẽ quẹt — tải lại trang");

  // Phiếu POS đang mở của phiếu gộp này còn hạn ⇒ trả lại CHÍNH nó (bấm lại là idempotent, không ghi).
  const dangMo = await tx.posPaymentIntent.findFirst({
    where: { paymentBillId: x.billId, status: { in: [...TRANG_THAI_MO] } },
    select: { id: true, expiresAt: true },
  });
  // Mốc hết hạn CHUNG (GĐ2 U12) — cùng hàm view và poller dùng.
  if (dangMo && !phieuPosHetHan(dangMo.expiresAt, x.now)) return { intentId: dangMo.id, taoMoi: false };

  // ── HẾT CỔNG. Từ đây là phép ghi. ──
  // Phiếu mở QUÁ HẠN ⇒ HET_HAN (rời chỉ mục từng phần, nhường chỗ phiếu mới).
  if (dangMo) await tx.posPaymentIntent.update({ where: { id: dangMo.id }, data: { status: "HET_HAN" } });
  // Phiếu mở của CÁC PHIẾU GỘP KHÁC của đơn (phiếu gộp đó không còn OPEN — mỗi đơn một mã sống) ⇒ HUY.
  await tx.posPaymentIntent.updateMany({
    where: { paymentBill: { orderId: x.orderId }, paymentBillId: { not: x.billId }, status: { in: [...TRANG_THAI_MO] } },
    data: { status: "HUY" },
  });
  const moi = await tx.posPaymentIntent.create({
    data: {
      paymentBillId: x.billId,
      code5: phieu.matchKey,
      amount: phieu.conPhaiThu,
      centerId: don.centerId,
      posTerminalId: mayId,
      status: "CHO_QUET",
      createdById: x.actor.id,
      // T18: app đặt — cửa sổ tìm giao dịch + CHECK `expiresAt > createdAt` theo CÙNG một đồng hồ.
      createdAt: x.now,
      expiresAt: new Date(x.now.getTime() + HAN_PHIEU_POS_MS),
    },
    select: { id: true },
  });
  await writeAudit({
    tx,
    actor: x.actor,
    module: "finance",
    entityType: "Order",
    entityId: x.orderId,
    action: "POS_PHIEU_TAO",
    newValues: {
      intentId: moi.id,
      billId: x.billId,
      ma: phieu.matchKey,
      soTien: phieu.conPhaiThu,
      posTerminalId: mayId,
      thayPhieuHetHan: dangMo?.id ?? null,
    },
    reason: `Mở phiếu thu thẻ mã ${phieu.matchKey} — ${phieu.conPhaiThu}`,
  });
  return { intentId: moi.id, taoMoi: true };
}

/**
 * "Báo admin" (§6.3): sale đã chờ ≥ 10 phút mà vẫn "Chưa thấy giao dịch" ⇒ báo Kế toán HO + Quản trị
 * (T17). Máy chủ hỏi lại cổng (`lyDoKhongBaoAdmin`) — nút chỉ là lời hứa. Dedupe theo phiếu.
 */
export async function baoAdminPhieuPos(input: {
  intentId: string;
  orderId: string;
  ghiChu?: string;
  actor: AuditActor;
  now: Date;
}): Promise<KetQuaGhi<{ soNguoi: number }>> {
  const p = await db.posPaymentIntent.findUnique({
    where: { id: input.intentId },
    select: {
      id: true,
      status: true,
      lastResultKind: true,
      lastResultMessage: true,
      createdAt: true,
      code5: true,
      amount: true,
      paymentBill: { select: { orderId: true, order: { select: { code: true } } } },
      posTerminal: { select: { maThietBi: true, maQuay: true } },
    },
  });
  if (!p || p.paymentBill.orderId !== input.orderId) return { ok: false, error: "Không tìm thấy phiếu POS" };
  const lyDo = lyDoKhongBaoAdmin(p, input.now);
  if (lyDo) return { ok: false, error: lyDo };

  const nguoi = await nguoiNhanBaoPos(input.now);
  if (nguoi.length === 0) {
    return { ok: false, error: "Chưa có Kế toán HO / Quản trị nào để báo — gọi trực tiếp kế toán" };
  }
  const may = p.posTerminal ? (p.posTerminal.maQuay ?? p.posTerminal.maThietBi) : "(chưa rõ máy)";
  const ghiChu = input.ghiChu?.trim();
  const soNguoi = await notifyStaff({
    userIds: nguoi,
    dedupeKey: `pos.bao-admin:${p.id}`,
    title: `Sale báo: chưa thấy giao dịch thẻ mã ${p.code5}`,
    body:
      `Đơn ${p.paymentBill.order.code} · ${new Intl.NumberFormat("vi-VN").format(p.amount)}đ · máy ${may} · ` +
      `tạo lúc ${gioVN(p.createdAt).slice(11, 16)}.` +
      (ghiChu ? ` Ghi chú: ${ghiChu.slice(0, 500)}` : ""),
    href: "/bien-dong-so-du",
    entityId: input.orderId,
  });
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "Order",
    entityId: input.orderId,
    action: "POS_PHIEU_BAO_ADMIN",
    newValues: { intentId: p.id, ma: p.code5, soNguoi },
    reason: ghiChu || "Sale báo admin: chưa thấy giao dịch thẻ",
  });
  return { ok: true, soNguoi };
}
