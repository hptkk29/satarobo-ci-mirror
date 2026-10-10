import "server-only";
// lib/payments/pos/xu-ly-ket-qua.ts — HÀM DUY NHẤT ghi trạng thái phiếu thu thẻ theo kết quả máy
// (GĐ1 POS · 06/10/2026). CHẠM TIỀN (qua thân dòng chung — không tự ghi tiền).
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §4. Hai pha, HAI transaction nối tiếp, KHÔNG lồng:
//
//   ① PHA TIỀN (chỉ PAID*) — NGOÀI mọi transaction: `khopGiaoDichThe` = ĐÚNG thân dòng của
//      `nhapLoPos` (BankTransaction{CARD_POS} → Q-E → `thuTheoPhieuGop`: khoá ĐƠN → khoá GIAO DỊCH →
//      đọc lại trạng thái trong khoá). Lưới `[POS1-W1]`: tệp này không có phép ghi tiền nào.
//   ② PHA PHIẾU — `db.$transaction { khoá ĐƠN → SELECT phiếu POS FOR UPDATE → đọc lại giao dịch →
//      quyetPhieuPos (thuần) → update phiếu POS }`. Thứ tự khoá ĐƠN trước như mọi đường tiền
//      (§4.3) ⇒ không vòng chờ. Trạng thái theo SỰ THẬT của giao dịch đọc lại trong khoá, nên lượt
//      sập GIỮA hai pha tự chữa ở lượt kiểm sau (tiền đã commit ⇒ thấy MATCHED ⇒ DA_THU).
//   ③ Sau commit — báo admin (`notifyStaff` không nhận tx).
//
// Nút ‖ poller ‖ import cùng một giao dịch ⇒ đúng 1 BankTransaction / 1 bộ phân bổ / 1 bộ Payment /
// 1 sự kiện (`[POS1-RACE-01..03]`): các bất biến do khoá + khoá duy nhất của đường tiền gác, không
// do tệp này.
import type { PosCheckLogKind, PosCheckTrigger, PosIntentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { dongPosSchema, PROVIDER_THE_POS, type DongPos, type NguonDuLieuPos } from "./kieu";
import { khopGiaoDichThe } from "./nhap-lo-pos";
import { tachMaPos } from "./tach-ma-pos";
import {
  docKetQuaPos,
  KET_QUA_HONG,
  type IntentDeKiem,
  type PosCheckResult,
  type PosProvider,
} from "./provider/kieu";
import {
  apCuaSoChongDon,
  mucDoHienThi,
  quyetPhieuPos,
  trongCuaSoChongDon,
  type BtDocLai,
  type TienPos,
} from "./phieu-pos-luat";
import {
  CAU_DANG_KIEM,
  thongDiepPos,
  thongDiepTrangThai,
  type KetLuanPos,
  type MucDoPos,
} from "./thong-diep-pos";
import { nguoiNhanBaoPos } from "./nguoi-nhan-bao-pos";
import { chuongLoiKetNoiHeThong, khoaChuaXacDinhMay } from "./lich-kiem";
import { baoAgentKhongSanSang, laLyDoAgent } from "./agent/canh-bao";

type Tx = Prisma.TransactionClient;

/** Ai kích lượt kiểm. AGENT để chỗ cho GĐ4. */
export type TriggeredBy = PosCheckTrigger;

export type KetQuaXuLyPos = {
  status: PosIntentStatus;
  doiTrangThai: boolean;
  thongDiep: string;
  mucDo: MucDoPos;
  /** `null` ⇒ phiếu đóng nhận kết quả yếu — câu là câu CŨ. */
  ketLuan: KetLuanPos | null;
};

const TEN_NGUON: Record<TriggeredBy, string> = {
  SALE: "sale bấm Kiểm tra",
  POLLER: "tự kiểm định kỳ",
  AGENT: "máy đồng bộ",
  IMPORT: "đồng bộ sau import",
  QUET_SACH: "quét sạch cuối ngày",
};

/**
 * Khoá DÒNG phiếu POS (`SELECT … FOR UPDATE`) — gọi SAU khoá đơn. Hàm module (không viết
 * `tx.$executeRaw` trong callback): lưới `cong-truoc-phep-ghi.test.ts` đếm `tx.$executeRaw` là PHÉP
 * GHI — cùng lối `khoaGiaoDichTrongTx`.
 */
export async function khoaPhieuPosTrongTx(tx: Tx, intentId: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "PosPaymentIntent" WHERE id = ${intentId} FOR UPDATE`;
}

const CHON_DONG_FILE = {
  maGiaoDich: true,
  loaiGiaoDich: true,
  hinhThuc: true,
  trangThai: true,
  soTien: true,
  thoiGianGiaoDich: true,
  dienGiai: true,
  maChuanChi: true,
  maGiaoDichThe: true,
  maGiaoDichGoc: true,
  trangThaiHoanHuy: true,
  maDonHang: true,
  maQuay: true,
  maThietBi: true,
  soTheMasked: true,
  loaiThe: true,
  maHachToan: true,
  phiGiaoDich: true,
} as const satisfies Prisma.PosCardTransactionSelect;

type DongFile = Prisma.PosCardTransactionGetPayload<{ select: typeof CHON_DONG_FILE }>;

/** Dòng FILE đã import ⇒ `DongPos` (sự thật của file thắng kết quả provider). */
function dongTuPosCard(r: DongFile): DongPos {
  return dongPosSchema.parse({ ...r, thoiGian: gioVN(r.thoiGianGiaoDich), thoiGianGiaoDich: undefined });
}

/**
 * Kết quả provider (không có dòng file) ⇒ `DongPos`. Thiếu mã giao dịch / số tiền dương / giờ quẹt
 * đọc được ⇒ `null` (không vào pha tiền). Thiếu ghi chú ⇒ phân loại ra "Không có mã phiếu" ⇒ hàng
 * chờ tay — fail-closed: không tự khớp khi chưa tự đọc được mã (D2).
 */
function dongTuKetQua(kq: PosCheckResult): DongPos | null {
  if (!kq.providerTxnId || kq.amount === undefined || kq.amount <= 0 || !kq.paidAt) return null;
  if (Number.isNaN(new Date(kq.paidAt).getTime())) return null;
  return dongPosSchema.parse({
    maGiaoDich: kq.providerTxnId,
    loaiGiaoDich: "Thanh toán",
    hinhThuc: "Thẻ",
    trangThai: "Thành công",
    soTien: kq.amount,
    thoiGian: kq.paidAt,
    dienGiai: kq.dienGiai ?? "",
    maChuanChi: kq.approvalCode ?? null,
    maGiaoDichThe: null,
    maGiaoDichGoc: null,
    trangThaiHoanHuy: null,
    maDonHang: null,
    maQuay: null,
    maThietBi: kq.terminalCode ?? null,
    soTheMasked: kq.cardMasked ?? null,
    loaiThe: null,
    maHachToan: null,
    phiGiaoDich: null,
  });
}

const laPaid = (k: PosCheckResult["kind"]) => k === "PAID" || k === "PAID_AMOUNT_MISMATCH";

/** HÀM DUY NHẤT ghi trạng thái phiếu POS theo kết quả máy. */
export async function xuLyKetQuaPos(input: {
  /** Đọc LẠI dưới khoá — không tin một bản phiếu cũ. */
  intentId: string;
  ketQua: PosCheckResult;
  triggeredBy: TriggeredBy;
  /** BẮT BUỘC (luật 19). */
  now: Date;
  nguonDuLieu: NguonDuLieuPos;
  /** Người bấm (vết nhật ký khi phiếu đổi trạng thái). Không có ⇒ "hệ thống" theo nguồn. */
  nguoiBam?: AuditActor;
}): Promise<KetQuaXuLyPos> {
  // 0. Không tin provider: mọi kết quả qua schema; hỏng ⇒ PROVIDER_ERROR KET_QUA_HONG.
  let kq = docKetQuaPos(input.ketQua);

  const goc = await db.posPaymentIntent.findUnique({
    where: { id: input.intentId },
    select: { id: true, code5: true, centerId: true, paymentBill: { select: { orderId: true } } },
  });
  if (!goc) throw new Error(`Không tìm thấy phiếu POS ${input.intentId}`);
  const orderId = goc.paymentBill.orderId;

  // ① PHA TIỀN — chỉ PAID*, NGOÀI mọi transaction.
  let tien: TienPos = { loai: "KHONG_DOI_TIEN" };
  let d: DongPos | null = null;
  if (laPaid(kq.kind)) {
    try {
      const row = kq.providerTxnId
        ? await db.posCardTransaction.findUnique({ where: { maGiaoDich: kq.providerTxnId }, select: CHON_DONG_FILE })
        : null;
      d = row ? dongTuPosCard(row) : dongTuKetQua(kq);
      if (d === null) {
        kq = { ...KET_QUA_HONG };
      } else {
        const kl = await khopGiaoDichThe({ d, nguonDuLieu: input.nguonDuLieu });
        tien = kl.tien ?? { loai: "CHUA_XAC_DINH" };
      }
    } catch (err) {
      // Không biết tiền đã đi tới đâu ⇒ GIỮ trạng thái, báo admin, cấm mời quẹt lại (§4.2).
      console.error(`[pos] pha tiền ném (phiếu ${input.intentId}):`, err);
      tien = { loai: "CHUA_XAC_DINH" };
    }
  }

  const maGiaoDich = laPaid(kq.kind) ? (d?.maGiaoDich ?? kq.providerTxnId ?? null) : null;
  const maTrongGhiChu = d ? tachMaPos(d.dienGiai) : [];
  const coMaDuyNhat = maTrongGhiChu.length === 1 && maTrongGhiChu[0] === goc.code5;
  const soTienMay = d?.soTien ?? kq.amount ?? null;
  const gioQuetRaw = d ? new Date(d.thoiGian) : kq.paidAt ? new Date(kq.paidAt) : null;
  const gioQuet = gioQuetRaw && !Number.isNaN(gioQuetRaw.getTime()) ? gioQuetRaw : null;

  // ② PHA PHIẾU.
  const kqPha = await db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, orderId);
    await khoaPhieuPosTrongTx(tx, input.intentId);
    const p = await tx.posPaymentIntent.findUnique({
      where: { id: input.intentId },
      select: {
        id: true,
        status: true,
        bankTransactionId: true,
        lastResultMessage: true,
        code5: true,
        createdAt: true,
        paymentBillId: true,
      },
    });
    if (!p) throw new Error(`Không tìm thấy phiếu POS ${input.intentId}`);

    const btKhoa = maGiaoDich
      ? await tx.bankTransaction.findUnique({
          where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: maGiaoDich } },
          select: { id: true },
        })
      : null;
    // Phiếu đã NHẬN một giao dịch ⇒ CHÍNH giao dịch đó quyết trạng thái tiền của phiếu: một kết quả
    // nói về giao dịch KHÁC cùng mã không được lật một phiếu DA_THU sang LECH_TIEN.
    const giuKhac = p.bankTransactionId !== null && btKhoa !== null && btKhoa.id !== p.bankTransactionId;
    const btQuyetId = laPaid(kq.kind) ? (p.bankTransactionId ?? btKhoa?.id ?? null) : null;

    let bt: BtDocLai = null;
    let btId: string | null = null;
    let btCuaPhieuKhac = false;
    if (btQuyetId) {
      const b = await tx.bankTransaction.findUnique({
        where: { id: btQuyetId },
        select: { id: true, status: true, allocations: { select: { paymentRequestId: true } } },
      });
      if (b) {
        const dong = await tx.paymentBillLine.findMany({
          where: { billId: p.paymentBillId },
          select: { paymentRequestId: true },
        });
        const dongPhieu = new Set(dong.map((x) => x.paymentRequestId));
        bt = {
          status: b.status,
          vaoDungPhieu: b.allocations.length > 0 && b.allocations.every((a) => dongPhieu.has(a.paymentRequestId)),
        };
        btId = b.id;
        // Đọc trong KHOÁ ĐƠN: mọi phiếu POS của cùng phiếu gộp ⇒ cùng đơn ⇒ cùng khoá.
        btCuaPhieuKhac =
          (await tx.posPaymentIntent.findFirst({
            where: { bankTransactionId: b.id, id: { not: p.id } },
            select: { id: true },
          })) !== null;
      }
    }

    const tienQuyet: TienPos =
      giuKhac && bt && btId
        ? { loai: "DA_KHOA", btId, trangThaiBt: bt.status === "UNMATCHED" ? null : bt.status, huySauGhiNhan: false }
        : tien;

    const quyet = quyetPhieuPos({
      hienTai: p.status,
      kq,
      tien: tienQuyet,
      bt,
      coMaDuyNhat: giuKhac ? true : coMaDuyNhat,
      btCuaPhieuKhac,
      code5: p.code5,
      taoLuc: p.createdAt,
      soTienMay,
      gioQuet,
    });

    const td = quyet.ketLuan ? thongDiepPos(quyet.ketLuan) : null;
    const theoTrangThai = thongDiepTrangThai(quyet.status);
    const thongDiep = td?.cau ?? p.lastResultMessage ?? theoTrangThai.cau;
    const mucDo = td?.mucDo ?? theoTrangThai.mucDo;
    const nhan = quyet.nhanBt && btId !== null && p.bankTransactionId === null;
    const doi = quyet.status !== p.status;
    // Kết quả HIỆU LỰC: provider báo PAID mà pha tiền thấy giao dịch đã hủy/hoàn SAU khi ghi nhận (D7)
    // ⇒ lưu `CANCELLED_AFTER_PAID` — màn tô mức cảnh báo theo đúng trường này (`dungPhieuPosView`).
    const kindLuu: PosCheckResult["kind"] = quyet.ketLuan?.loai === "HUY_SAU_THU" ? "CANCELLED_AFTER_PAID" : kq.kind;

    await tx.posPaymentIntent.update({
      where: { id: p.id },
      data: {
        lastCheckAt: input.now,
        lastTriggeredBy: input.triggeredBy,
        ...(quyet.ghiKetQua ? { lastResultKind: kindLuu, lastResultMessage: thongDiep } : {}),
        ...(doi ? { status: quyet.status } : {}),
        ...(nhan && btId ? { bankTransactionId: btId } : {}),
      },
    });

    // Vết chỉ khi ĐỔI trạng thái (T20) — bấm Kiểm tra lặp lại không đổ đầy nhật ký.
    if (doi) {
      await writeAudit({
        tx,
        actor: input.nguoiBam ?? { id: null, name: `Phiếu thu thẻ (${TEN_NGUON[input.triggeredBy]})` },
        module: "finance",
        entityType: "Order",
        entityId: orderId,
        action: `POS_PHIEU_${quyet.status}`,
        oldValues: { intentId: p.id, status: p.status },
        newValues: {
          intentId: p.id,
          status: quyet.status,
          ketQua: kindLuu,
          bankTransactionId: nhan ? btId : p.bankTransactionId,
          nguon: input.triggeredBy,
        },
        reason: thongDiep.slice(0, 500),
      });
    }

    return { status: quyet.status, doi, thongDiep, mucDo, ketLuan: quyet.ketLuan, baoAdmin: quyet.baoAdmin, code5: p.code5 };
  });

  // ③ Sau commit — báo admin (dedupe theo GIỜ: bấm lại trong giờ không dội chuông).
  if (kqPha.baoAdmin === "AGENT") {
    // GĐ4 (D9, T16): máy đồng bộ của cơ sở không sẵn sàng ⇒ chuông AGENT (khoá cơ sở + ngày — CÙNG khoá với
    // `/status` + cron), KHÔNG chuông `pos.loi-ket-noi:`. Câu D9 nói "đã báo admin" ⇒ lượt này BẢO ĐẢM đã báo.
    const lyDo = kq.reasonCode;
    if (laLyDoAgent(lyDo)) {
      await baoAgentKhongSanSang({ centerId: goc.centerId, lyDo, now: input.now }).catch((err) =>
        console.error(`[pos] báo admin máy đồng bộ lỗi (phiếu ${input.intentId}):`, err),
      );
    }
  } else if (kqPha.baoAdmin) {
    await baoAdminTuDong({
      loai: kqPha.baoAdmin,
      intentId: input.intentId,
      orderId,
      code5: kqPha.code5,
      maLoi: kq.reasonCode ?? null,
      now: input.now,
      triggeredBy: input.triggeredBy,
    }).catch((err) => console.error(`[pos] báo admin lỗi (phiếu ${input.intentId}):`, err));
  }

  return {
    status: kqPha.status,
    doiTrangThai: kqPha.doi,
    thongDiep: kqPha.thongDiep,
    mucDo: kqPha.mucDo,
    ketLuan: kqPha.ketLuan,
  };
}

async function baoAdminTuDong(x: {
  loai: "LOI_KET_NOI" | "CHUA_XAC_DINH";
  intentId: string;
  orderId: string;
  code5: string;
  maLoi: string | null;
  now: Date;
  triggeredBy: TriggeredBy;
}): Promise<void> {
  const nguoi = await nguoiNhanBaoPos(x.now);
  if (nguoi.length === 0) {
    console.warn(`[pos] ${x.loai} phiếu ${x.intentId}: không có Kế toán HO / Quản trị nào để báo`);
    return;
  }
  const gio = gioVN(x.now);
  const khoaGio = gio.slice(0, 13); // "YYYY-MM-DDTHH" giờ VN
  const laLoi = x.loai === "LOI_KET_NOI";

  // [GĐ2 U13] Lỗi kết nối khi MÁY tự kiểm (poller / đồng bộ import / quét sạch / agent): MỘT chuông TOÀN
  // HỆ THỐNG mỗi giờ — provider sập một giờ với 20 phiếu mở không được bắn 20 chuông/giờ cho mỗi admin
  // chỉ vì poller. Nội dung KHÔNG mang phút của từng lượt (ổn định trong giờ ⇒ không ghi lại vô ích) và
  // href mang NGÀY VN (`chuongLoiKetNoiHeThong`). SALE bấm giữ khoá THEO PHIẾU + GIỜ như GĐ1.
  const laMay = x.triggeredBy !== "SALE";
  if (laLoi && laMay) {
    await notifyStaff({ userIds: nguoi, ...chuongLoiKetNoiHeThong(x.now, x.maLoi) });
    return;
  }

  const don = await db.order.findUnique({ where: { id: x.orderId }, select: { code: true } });
  // CHUA_XAC_DINH (tiền có thể đã trừ thẻ) luôn theo PHIẾU. Nguồn MÁY: một chuông / phiếu / NGÀY VN và thân
  // KHÔNG mang phút (rà đối kháng 06/10/2026 — khoá theo giờ + nhịp poller = ~24 chuông/phiếu/người/ngày).
  // SALE bấm: khoá theo GIỜ như GĐ1 (người đang đứng trước khách cần chuông cho lượt bấm của mình).
  const khoaChua = laMay ? khoaChuaXacDinhMay(x.intentId, x.now) : `pos.chua-xac-dinh:${x.intentId}:${khoaGio}`;
  await notifyStaff({
    userIds: nguoi,
    dedupeKey: laLoi ? `pos.loi-ket-noi:${x.intentId}:${khoaGio}` : khoaChua,
    title: laLoi
      ? `Lỗi kết nối hệ thống thanh toán thẻ (mã ${x.maLoi ?? "KHONG_RO"})`
      : "Chưa xác định được kết quả thu thẻ — cần kiểm tay",
    body: laLoi
      ? `Phiếu thu thẻ mã ${x.code5} · đơn ${don?.code ?? x.orderId} · lúc ${gio.slice(11, 16)}.`
      : `Phiếu thu thẻ mã ${x.code5} · đơn ${don?.code ?? x.orderId}` +
        (laMay ? " (máy tự kiểm)" : ` · lúc ${gio.slice(11, 16)}`) +
        ". Pha ghi tiền lỗi — sale đã được dặn KHÔNG cho khách quẹt lại.",
    href: `/orders/${x.orderId}`,
    entityId: x.orderId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GĐ2 (docs/pos-gd2-thiet-ke.md §2) — NHẬT KÝ KIỂM + CHỐNG BẤM DỒN
//
// Cả hai sống ở `kiemTraPhieuPos` — chỗ DUY NHẤT gọi `provider.checkStatus(` (lưới `[POS2-W2]`): mọi
// nguồn (SALE · POLLER · AGENT · IMPORT · QUET_SACH) đi qua đây, nên một chỗ gác cho tất cả.
//   ① GIỮ LƯỢT — tx { khoá DÒNG phiếu POS → đọc `lastCheckAt` }: trong cửa sổ 5 giây (nguồn chịu cửa
//      sổ) ⇒ ghi dòng CACHE, trả câu lưu, KHÔNG gọi provider; còn lại ⇒ đặt `lastCheckAt = now` TRƯỚC
//      khi gọi provider (giữ lượt). Bản GĐ1 đọc `lastCheckAt` NGOÀI khoá trong action ⇒ hai lượt bấm
//      cùng lúc đều qua cổng (`[POS2-CD-03]`).
//   ② provider.checkStatus — NGOÀI tx, đo thời lượng bằng đồng hồ ĐƠN ĐIỆU.
//   ③ xuLyKetQuaPos (GĐ1, không đổi).
//   ④ `finally` — ĐÚNG MỘT dòng nhật ký, kể cả khi ③ ném (`errorCode = "XU_LY_NEM"`). Ghi NGOÀI tx; lỗi
//      ghi nhật ký chỉ `console.error`, KHÔNG ném (U4): nhật ký là chẩn đoán, không phải sổ tiền —
//      không được làm hỏng kết quả tiền đã commit.
//
// Giữ lượt cầm ĐÚNG MỘT khoá (dòng phiếu POS) và không xin khoá nào khác khi đang cầm ⇒ không thể
// đứng trong một vòng chờ với pha phiếu (khoá ĐƠN → khoá DÒNG).
// ─────────────────────────────────────────────────────────────────────────────

/** Kết quả một lượt kiểm: kết quả xử lý + lượt này có phải lượt CACHE (không hỏi provider) không. */
export type KetQuaKiemPos = KetQuaXuLyPos & {
  tuCache: boolean;
  /**
   * ISO giờ VN của lượt GỌI provider mà câu `thongDiep` thuộc về — lượt CACHE trả giờ của lượt THẬT gần
   * nhất (`lastCheckAt`), không phải giờ bấm: hộp phiếu in "kiểm lúc …" cạnh câu (rà đối kháng 06/10/2026).
   */
  kiemLuc: string;
};

/** Mã lỗi ghi vào nhật ký khi `xuLyKetQuaPos` ném. */
const LOI_XU_LY_NEM = "XU_LY_NEM";
/** Trần mã lỗi — trùng CHECK `PosCheckLog_errorCode_check` (DB là lưới thứ hai). */
const LOI_TOI_DA = 64;

const CHON_GIU = {
  id: true,
  code5: true,
  amount: true,
  createdAt: true,
  expiresAt: true,
  centerId: true,
  posTerminalId: true,
  bankTransactionId: true,
  orgUnitId: true,
  status: true,
  lastCheckAt: true,
  lastResultKind: true,
  lastResultMessage: true,
} as const satisfies Prisma.PosPaymentIntentSelect;

type IntentGiu = Prisma.PosPaymentIntentGetPayload<{ select: typeof CHON_GIU }>;
type GiuLuot = { loai: "CACHE"; p: IntentGiu } | { loai: "GIU"; p: IntentGiu };
type DauVaoGiu = { intentId: string; triggeredBy: TriggeredBy; now: Date; nguoiKiemId: string | null; boQuaChongDon: boolean };

/** Đầu vào của MỘT dòng nhật ký — không có chỗ cho số thẻ, ghi chú, mã chuẩn chi, raw. */
type DongNhatKy = {
  intentId: string;
  centerId: string;
  orgUnitId: string | null;
  triggeredBy: TriggeredBy;
  kind: PosCheckLogKind;
  errorCode: string | null;
  durationMs: number;
  providerTxnId: string | null;
  statusSau: PosIntentStatus | null;
  createdById: string | null;
  createdAt: Date;
};

/**
 * Dựng `data` cho MỘT dòng nhật ký — hai phép ghi (lượt CACHE + lượt gọi provider) cùng đi qua đây nên
 * mọi dòng có CÙNG một tập khoá. Lưới `[POS2-LOG-06]` ghim tập khoá và nguồn của từng khoá.
 * `orgUnitId` của phiếu trống ⇒ BỎ khoá để ghi kép tự điền theo `centerId` (đặt `null` tường minh là
 * "người gọi đã quyết" — dual-write tôn trọng và để trống).
 */
function dongNhatKy(d: DongNhatKy): Prisma.PosCheckLogUncheckedCreateInput {
  return {
    intentId: d.intentId,
    centerId: d.centerId,
    ...(d.orgUnitId ? { orgUnitId: d.orgUnitId } : {}),
    triggeredBy: d.triggeredBy,
    kind: d.kind,
    errorCode: d.errorCode?.slice(0, LOI_TOI_DA) ?? null,
    durationMs: d.durationMs,
    providerTxnId: d.providerTxnId,
    statusSau: d.statusSau,
    createdById: d.createdById,
    createdAt: d.createdAt,
  };
}

/**
 * Ghi nhật ký cho lượt GỌI provider — NGOÀI tx, nuốt lỗi (U4). Hệ quả biết trước: sập tiến trình đúng
 * giữa commit pha phiếu và câu này ⇒ mất một dòng nhật ký (trạng thái + AuditLog vẫn đúng).
 */
async function ghiNhatKyKiem(d: DongNhatKy): Promise<void> {
  try {
    await db.posCheckLog.create({ data: dongNhatKy(d) });
  } catch (err) {
    console.error(`[pos] ghi nhật ký kiểm lỗi (phiếu ${d.intentId}, nguồn ${d.triggeredBy}):`, err);
  }
}

/**
 * ① GIỮ LƯỢT dưới khoá DÒNG phiếu POS (`khoaPhieuPosTrongTx` — cùng khoá pha phiếu dùng). Hai nhánh
 * `return` dưới KHÔNG phải từ chối (lưới `cong-truoc-phep-ghi.test.ts`): nhánh CACHE ghi đúng một dòng
 * nhật ký rồi trả; nhánh GIỮ đặt `lastCheckAt`. Không phép ghi nào đứng trước cổng.
 */
async function giuLuotKiem(x: DauVaoGiu): Promise<GiuLuot> {
  return db.$transaction(async (tx) => {
    await khoaPhieuPosTrongTx(tx, x.intentId);
    const p = await tx.posPaymentIntent.findUnique({ where: { id: x.intentId }, select: CHON_GIU });
    if (!p) throw new Error(`Không tìm thấy phiếu POS ${x.intentId}`);
    if (!x.boQuaChongDon && apCuaSoChongDon(x.triggeredBy) && trongCuaSoChongDon(p.lastCheckAt, x.now)) {
      await tx.posCheckLog.create({
        data: dongNhatKy({
          intentId: p.id,
          centerId: p.centerId,
          orgUnitId: p.orgUnitId,
          triggeredBy: x.triggeredBy,
          kind: "CACHE",
          errorCode: null,
          durationMs: 0,
          providerTxnId: null,
          statusSau: p.status,
          createdById: x.nguoiKiemId,
          createdAt: x.now,
        }),
      });
      return { loai: "CACHE" as const, p };
    }
    await tx.posPaymentIntent.update({ where: { id: p.id }, data: { lastCheckAt: x.now } });
    return { loai: "GIU" as const, p };
  });
}

/**
 * Lượt CACHE (U2): câu lưu gần nhất; phiếu chưa có câu (lượt đầu đang bay) ⇒ `CAU_DANG_KIEM`. Mức độ tô
 * theo CÙNG phép của màn (`mucDoHienThi(trạng thái, kết quả gần nhất)`) — bản trước tô theo trạng thái thôi
 * ⇒ "ĐỪNG cho khách quẹt lại" (pha tiền ném, phiếu vẫn CHO_QUET) bấm lại trong 5 giây ra tông thông tin
 * (rà đối kháng 06/10/2026). `kiemLuc` = giờ lượt THẬT (lastCheckAt — trong cửa sổ thì luôn có).
 */
function ketQuaCache(p: IntentGiu, now: Date): KetQuaKiemPos {
  return {
    status: p.status,
    doiTrangThai: false,
    thongDiep: p.lastResultMessage ?? CAU_DANG_KIEM,
    mucDo: p.lastResultMessage === null ? "thong_tin" : mucDoHienThi(p.status, p.lastResultKind),
    ketLuan: null,
    tuCache: true,
    kiemLuc: gioVN(p.lastCheckAt ?? now),
  };
}

/** Phần của phiếu provider được thấy (`IntentDeKiem`) — không chuyển trạng thái/câu lưu xuống provider. */
function deKiem(p: IntentGiu): IntentDeKiem {
  return {
    id: p.id,
    code5: p.code5,
    amount: p.amount,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    centerId: p.centerId,
    posTerminalId: p.posTerminalId,
    bankTransactionId: p.bankTransactionId,
  };
}

/**
 * Bọc provider + `xuLyKetQuaPos` — MỌI nguồn (SALE · POLLER · AGENT · IMPORT · QUET_SACH); test tiêm Fake.
 * Hàm DUY NHẤT gọi `provider.checkStatus(` (lưới `[POS2-W2]`).
 */
export async function kiemTraPhieuPos(input: {
  intentId: string;
  provider: PosProvider;
  triggeredBy: TriggeredBy;
  /** BẮT BUỘC (luật 19). */
  now: Date;
  /** BẮT BUỘC (luật 7 — `tsc` liệt kê chỗ gọi): người bấm / người nhập file; `null` cho máy. */
  nguoiKiemId: string | null;
  nguoiBam?: AuditActor;
  /**
   * [Rà đối kháng GĐ4 — RV-05] Lượt sinh từ TÍN HIỆU HỦY/HOÀN vừa đồng bộ (`dongBoPhieuPosSauAgent`) KHÔNG chịu cửa
   * sổ chống bấm dồn 5″: tín hiệu chỉ tới MỘT lần (dòng hủy đã ghi băm ⇒ lần gửi sau là `unchanged`; poller chỉ quét
   * phiếu MỞ), nên trả CACHE cho nó là mất hẳn CANCELLED_AFTER_PAID. Vắng = chịu cửa sổ như GĐ2 (chiều AN TOÀN).
   */
  boQuaChongDon?: true;
}): Promise<KetQuaKiemPos> {
  const giu = await giuLuotKiem({
    intentId: input.intentId,
    triggeredBy: input.triggeredBy,
    now: input.now,
    nguoiKiemId: input.nguoiKiemId,
    boQuaChongDon: input.boQuaChongDon === true,
  });
  if (giu.loai === "CACHE") return ketQuaCache(giu.p, input.now);
  const p = giu.p;

  // Đồng hồ ĐƠN ĐIỆU — chỉ đo thời lượng, không suy ngày (luật 19 không áp: không phải mốc nghiệp vụ).
  const t0 = performance.now();
  let ketQua: PosCheckResult;
  try {
    ketQua = await input.provider.checkStatus(deKiem(p), input.now);
  } catch (err) {
    // Hợp đồng: provider KHÔNG ném. Ném thì vẫn là lỗi provider có mã — không để lọt ra action.
    console.error(`[pos] provider ${input.provider.ten} ném:`, err);
    ketQua = { kind: "PROVIDER_ERROR", reasonCode: "PROVIDER_NEM" };
  }
  const durationMs = Math.max(0, Math.round(performance.now() - t0));
  // Nhật ký ghi kind MÁY BÁO (đã qua schema; hỏng ⇒ PROVIDER_ERROR KET_QUA_HONG) — "máy nói gì";
  // `statusSau` trả lời "hệ thống kết luận gì".
  const kq = docKetQuaPos(ketQua);

  let statusSau: PosIntentStatus | null = null;
  let nem = false;
  try {
    const r = await xuLyKetQuaPos({
      intentId: input.intentId,
      ketQua,
      triggeredBy: input.triggeredBy,
      now: input.now,
      // RV-09 — nhãn nguồn theo DỮ LIỆU provider vừa đọc (chế độ FILE của provider agent ⇒ SMARTPOS).
      nguonDuLieu: kq.nguonDuLieu ?? input.provider.nguonDuLieu,
      ...(input.nguoiBam ? { nguoiBam: input.nguoiBam } : {}),
    });
    statusSau = r.status;
    return { ...r, tuCache: false, kiemLuc: gioVN(input.now) };
  } catch (err) {
    nem = true;
    throw err;
  } finally {
    await ghiNhatKyKiem({
      intentId: p.id,
      centerId: p.centerId,
      orgUnitId: p.orgUnitId,
      triggeredBy: input.triggeredBy,
      kind: kq.kind,
      errorCode: nem ? LOI_XU_LY_NEM : (kq.reasonCode ?? null),
      durationMs,
      providerTxnId: kq.providerTxnId ?? null,
      statusSau,
      createdById: input.nguoiKiemId,
      createdAt: input.now,
    });
  }
}
