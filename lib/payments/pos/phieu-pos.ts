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
//       thẻ khách lần hai khi lần một chưa ngã ngũ). Hỏi theo MÃ của phiếu gộp (`maCoGiaoDichChoTay`, `the-dang-mo.ts`),
//       không chỉ theo giao dịch phiếu POS ĐÃ NHẬN — rà đối kháng 06/10/2026: ghi chú 2 mã (D2 không
//       cho nhận) và phiếu cũ bị thay trước khi file về đều lọt cổng cũ;
//   ·   "một phiếu POS ĐANG MỞ mỗi phiếu gộp" do DB gác (`PosPaymentIntent_paymentBillId_mo_key`).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { khoaDonTrongTx, TIEN_TO_GO_GAN, type KetQuaGhi } from "@/lib/finance/ghi-tien-don";
import { docPhieuDeThuTrongTx, docPhieuGopDangMo, loiDotKhacCoThe, phatHoacDungLaiPhieuGop } from "@/lib/finance/phieu-gop";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { laDonChoDuyet, lyDoChuaDuyetQr } from "@/lib/orders/cho-duyet";
import { trangThaiQrDot } from "@/lib/payments/qr-theo-dot";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import {
  dungPhieuPosView,
  HAN_PHIEU_POS_MS,
  lyDoKhongBaoAdmin,
  phieuPosHetHan,
  TRANG_THAI_MO,
  type PhieuPosDeXem,
  type PhieuPosView,
} from "./phieu-pos-luat";
import type { TrangThaiSaiMa } from "./sai-ma";
import { docGiaoDichDaBiBac } from "./sai-ma-doc";
import { nguoiNhanBaoPos } from "./nguoi-nhan-bao-pos";
// T21 theo mã dời sang tệp lá `the-dang-mo.ts` (TỰ QUYẾT V14): cổng huỷ phiếu ở `lib/finance/phieu-gop.ts` cũng cần
// nó mà `phieu-pos.ts` đã import `phieu-gop.ts` — để ở đây là import vòng.
import { cuaSoTheoPhieuGop, maCoGiaoDichChoTay, mocChoTay } from "./the-dang-mo";
// VIỆC 4 (rà đối kháng 09/10/2026): cờ "dòng thẻ mang mã chưa thành giao dịch" (`coDongTheChuaKetLuan`) — Việc 3 không có cờ này.
// (Hai cờ yêu cầu "nhập sai mã" của nút "Huỷ phiếu thẻ" KHÔNG nạp ở đây: `dungPhieuPosView` suy chúng từ `saiMaYeuCau` mà `ganChoTay` đã nạp.)
import { ganDongTheChuaKetLuan } from "./dong-the-chua-ket-luan-gan";

type Tx = Prisma.TransactionClient;

/** Yêu cầu "nhập sai mã" như `CHON_VIEW` đọc ra (Việc 3) — `ganChoTay` đổi sang dạng `PhieuPosDeXem.saiMaYeuCau`. */
type YeuCauSaiMaTho = {
  trangThai: TrangThaiSaiMa;
  lyDoTuChoi: string | null;
  dangGhiLuc: Date | null;
  bankTransaction: { status: "MATCHED" | "UNMATCHED" | "IGNORED"; unmatchedNote: string | null };
};

/**
 * Gắn `coGiaoDichChoTay` cho các phiếu POS đọc từ DB (màn đơn) — một câu tra cho cả danh sách — và đổi yêu cầu "nhập sai mã" sang dạng
 * thuần (`btDaGoGan` tính ở ĐÂY vì tiền tố gỡ gắn nằm ở tệp server-only; `phieu-pos-luat.ts` chạy được ở trình duyệt).
 */
async function ganChoTay<
  T extends {
    code5: string;
    createdAt: Date;
    paymentBillId: string;
    paymentBill: { createdAt: Date };
    saiMaYeuCau: readonly YeuCauSaiMaTho[];
  },
>(
  ds: readonly T[],
): Promise<(Omit<T, "saiMaYeuCau"> & { coGiaoDichChoTay: boolean; saiMaYeuCau: PhieuPosDeXem["saiMaYeuCau"] })[]> {
  const co = await maCoGiaoDichChoTay(db, cuaSoTheoPhieuGop(ds));
  return ds.map((p) => ({
    ...p,
    coGiaoDichChoTay: co.has(p.code5),
    saiMaYeuCau: p.saiMaYeuCau.map((y) => ({
      trangThai: y.trangThai,
      lyDoTuChoi: y.lyDoTuChoi,
      dangGhiLuc: y.dangGhiLuc,
      btStatus: y.bankTransaction.status,
      btDaGoGan: (y.bankTransaction.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN),
    })),
  }));
}

/**
 * MỘT chỗ nạp các cờ phía màn cho CẢ HAI đường đọc view (`docPhieuPosView`, `docPhieuPosTho`): `coGiaoDichChoTay` + yêu cầu "nhập sai mã" (`ganChoTay`) và
 * `coDongTheChuaKetLuan` (`ganDongTheChuaKetLuan`). Hai câu tra `posCardTransaction` ĐỘC LẬP nhau (cùng đầu vào là hàng thô, cùng cửa sổ qua `cuaSoTheoPhieuGop`) ⇒
 * chạy SONG SONG: độ sâu tuần tự — không phải câu tra nặng — là thứ làm trang admin chậm (CLAUDE.md, `[DST-01]`). Thêm một cờ phía màn nữa thì thêm vào ĐÂY.
 */
async function ganCoPhiaMan<
  T extends {
    code5: string;
    createdAt: Date;
    paymentBillId: string;
    paymentBill: { createdAt: Date; orderId: string };
    saiMaYeuCau: readonly YeuCauSaiMaTho[];
  },
>(ds: readonly T[]) {
  const [daGan, dongChuaKetLuan] = await Promise.all([ganChoTay(ds), ganDongTheChuaKetLuan(db, ds)]);
  // Việc 5 (rà đối kháng): đơn nào từng có giao dịch bị kế toán bác — CÙNG hàm với bộ nhớ chặn tự ghi nhận (`docGiaoDichDaBiBac`), không truy vấn `TU_CHOI` thứ hai.
  // ⚠️ Chạy NỐI ĐUÔI hai câu tra song song ở trên, KHÔNG gộp vào `Promise.all`: đường này là cuối của MỌI action thu thẻ và ca đua `[HN3-DB-03]` chạy năm luồng = đúng cỡ pool
  // (xem chú thích ở `docPhieuPosView`) — một kết nối song song nữa cho mỗi luồng là cạn pool. Mỗi đơn khác nhau một câu (trang đơn chỉ có MỘT đơn).
  const donBac = await docDonDaCoVetBac(ds.map((p) => p.paymentBill.orderId));
  // `ganDongTheChuaKetLuan` map `ds` theo THỨ TỰ nên hai mảng thẳng hàng; ghép theo chỉ số.
  return daGan.map((p, i) => ({
    ...p,
    coDongTheChuaKetLuan: dongChuaKetLuan[i]!.coDongTheChuaKetLuan,
    donDaCoVetBac: donBac.has(ds[i]!.paymentBill.orderId),
  }));
}

/** Tập đơn (trong `orderIds`) từng có ≥ 1 yêu cầu sai mã bị kế toán TỪ CHỐI. Khách trần `db` (không scope): câu tra để CẢNH BÁO/CHẶN không được bị lọc phạm vi. */
async function docDonDaCoVetBac(orderIds: readonly string[]): Promise<ReadonlySet<string>> {
  const duyNhat = [...new Set(orderIds)];
  const kq = await Promise.all(duyNhat.map(async (id) => ((await docGiaoDichDaBiBac(db, id)).soLan > 0 ? id : null)));
  return new Set(kq.filter((id): id is string => id !== null));
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

const LOI_CHUA_KHAI_MAY = "Cơ sở chưa khai máy POS — Kế toán HO khai ở màn Cơ sở, mục Máy POS quẹt thẻ";
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
  // Việc 3: yêu cầu "nhập sai mã" MỚI NHẤT của phiếu — hộp phiếu thẻ ẩn hướng dẫn quẹt sau từ chối và in câu đúng khi đang chờ.
  saiMaYeuCau: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      trangThai: true,
      lyDoTuChoi: true,
      dangGhiLuc: true,
      bankTransaction: { select: { status: true, unmatchedNote: true } },
    },
  },
} as const satisfies Prisma.PosPaymentIntentSelect;

/** View của một phiếu POS (hộp phiếu POS trên màn đơn). `null` nếu không có. */
export async function docPhieuPosView(intentId: string, now: Date): Promise<PhieuPosView | null> {
  const tho = await db.posPaymentIntent.findUnique({ where: { id: intentId }, select: CHON_VIEW });
  if (!tho) return null;
  // Hai đường đọc view (đây và `docPhieuPosTho`) đều đi `ganCoPhiaMan` — thiếu bước nào là một cờ BẮT BUỘC của `PhieuPosDeXem` không được nạp
  // (tsc bắt; lưới `[HN4-W3]` ghim hình dạng).
  // ⚠️ KHÔNG gộp `docPhieuGopDangMo` vào CÙNG `Promise.all` với `ganCoPhiaMan` (đo 10/10/2026): đường này là cuối của MỌI action thu thẻ (mở phiếu · kiểm tra), và các ca đua
  // `[HN3-DB-03]` chạy NĂM luồng cùng lúc = đúng cỡ pool kết nối mặc định — thêm một kết nối song song cho mỗi luồng là cạn pool ⇒ giao dịch quá 5 giây ⇒ ca đỏ (xanh ở bản
  // gốc, đỏ ở bản gộp ba câu tra song song, xanh lại khi tách). Đường trang đơn (`docPhieuPosTho`) vẫn song song hai câu tra trong `ganCoPhiaMan`.
  const ds = await ganCoPhiaMan([tho]);
  const phieuMo = await docPhieuGopDangMo(tho.paymentBill.orderId);
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
  return ganCoPhiaMan(ds);
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
  // Phiếu giữ mã có THẺ mở ⇒ câu nói đúng điều đó (không chỉ vào "đóng hoặc huỷ" — chưa huỷ được).
  if (tt.kieu === "MOI_CUA_DOT_KHAC" && mo) {
    return { ok: false, error: await loiDotKhacCoThe({ orderId: input.orderId, mo, now: input.now }) };
  }
  if (tt.kieu === "MOI_CUA_DOT_NAY" && mo) {
    billId = mo.billId;
  } else {
    // Nút "Xuất QR" bấm gần như cùng lúc (hai nút của một dòng, hai tab, hai người) đã phát phiếu ⇒ DÙNG LẠI mã đó
    // thay vì nhận "huỷ hoặc đóng phiếu đó trước" (rà đối kháng 09/10/2026).
    const g = await phatHoacDungLaiPhieuGop({
      orderId: input.orderId,
      paymentRequestIds: [input.paymentRequestId],
      actor: input.actor,
      now: input.now,
    });
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
