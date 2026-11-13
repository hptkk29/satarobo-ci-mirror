import "server-only";
// lib/finance/dong-phieu-khi-het-viec-db.ts — ĐÓNG PHIẾU GỘP + KẾT THÚC PHIẾU THẺ khi phiếu HẾT VIỆC. CHẠM TIỀN (trạng thái phiếu).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ TỆP NÀY — #663 (nghiệm thu thẻ POS 11–12/10/2026, đơn `ORD-261011-000017`, mã `DYUJU`)
//
// Kế toán GẮN TAY một giao dịch thẻ đủ tiền vào đơn: đợt thành "Đã đủ", đơn CONFIRMED — nhưng phiếu gộp vẫn `OPEN` và phiếu thẻ vẫn `CHO_QUET`
// (mã 5 ký tự còn sống cho một đơn đã đủ tiền); HUỶ đơn sau đó cũng không đóng phiếu gộp (6 đơn chưa thu khác huỷ xong có phiếu `VOID`, riêng
// đơn này đã thu đủ nên không có đợt nào bị VOID để `soatPhieuGopMoTrongTx` bắt). Hộp thẻ phía sale vẫn nói "Chưa thấy giao dịch mang mã …" trên
// một đợt đã "Đã đủ" ⇒ có thể mời khách quẹt lại. Chỉ đường tự khớp (`thuTheoPhieuGop`) tự đặt phiếu `PAID`.
//
// ── MỘT HÀM, HAI LÝ DO HẾT VIỆC ──────────────────────────────────────────────
//   · `DU_TIEN` — mọi đợt của phiếu đã đủ tiền (còn phải thu 0đ) bằng BẤT KỲ đường nào ngoài `thuTheoPhieuGop`: gắn tay (`ganTienTheoCon`),
//     mã đời cũ (`allocateToOrder`). Đóng phiếu bằng CHÍNH `khepPhieuMo0dTrongTx` (đã nhận ⇒ ĐÓNG, chưa ⇒ HUỶ — luật có sẵn, không viết thêm),
//     rồi kết thúc phiếu thẻ mở của nó. KHÔNG tự đặt `PAID`: soát phiếu gộp (`soat-phieu-gop.ts`) giải thích vì sao `PAID` là trạng thái lượt gỡ gắn
//     KHÔNG đảo được (ca `[POS-DB-21b]`).
//   · `DON_HUY` — đơn bị HUỶ: mọi phiếu gộp còn `OPEN` đóng nốt (đã nhận ⇒ ĐÓNG, chưa ⇒ HUỶ), kể cả phiếu mà MỌI đợt đã `PAID` (không đợt nào bị VOID
//     nên đường soát không thấy nó).
//
// ── SỰ KIỆN SAU CHỐT CHO ĐƯỜNG GẮN TAY ───────────────────────────────────────
// `thuTheoPhieuGop` phát `phieu-gop.da-chia` để handler `sau-da-chia.ts` làm việc SAU CHỐT (lead → "Đã đăng ký", báo sale, chốt đơn thu đủ ⇒ lịch sử +
// tài khoản phụ huynh + biên nhận). Đường gắn tay trước giờ KHÔNG làm các việc đó. Khi người gọi truyền `giaoDich`, phiếu vừa ĐÓNG với tiền đã nhận ⇒ phát
// CÙNG sự kiện, CÙNG `dedupeKey` (`phieu-gop.da-chia:<giao dịch>:<phiếu>`) ⇒ idempotent: một giao dịch không phát hai lần, dù hai đường cùng chạm.
// Handler đọc lại tiền SAU commit nên gỡ gắn trước lúc nó chạy ⇒ không báo gì.
//
// ── GIAO DỊCH VỀ SAU KHI PHIẾU ĐÃ ĐÓNG ───────────────────────────────────────
// Không thêm đường tiền nào: `thuTheoPhieuGop` thấy phiếu không còn `OPEN` ⇒ `PHIEU_KHONG_MO` ⇒ giao dịch ở hàng chờ `UNMATCHED` cho kế toán, KHÔNG ghi
// phân bổ / `Payment` lần hai (ca `[DPH-*]`).
//
// Người gọi PHẢI đang giữ `khoaDonTrongTx(tx, orderId)`. Chỉ CHẠM trạng thái PaymentBill / PosPaymentIntent / DomainEvent — không đụng tiền.
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { khepPhieuMo0dTrongTx, type PhieuDaKhep } from "@/lib/finance/khep-phieu-0d-db";
import { NGUON_DONG_DU_TIEN } from "@/lib/finance/phieu-gop-go-gan";
import {
  huyTheMoCungPhieuGopTrongTx,
  type KetQuaHuyTheCungPhieuGop,
} from "@/lib/payments/pos/huy-the-cung-phieu-gop";

type Tx = Prisma.TransactionClient;

export type LyDoDongPhieu = "DU_TIEN" | "DON_HUY";

/** Giao dịch vừa được gắn — chỉ để phát sự kiện sau chốt. `ngayThu` do người gọi quyết (thẻ POS = giờ quẹt). */
export type GiaoDichVuaGan = {
  bankTransactionId: string;
  provider: string;
  providerTxnId: string;
  ngayThu: Date;
};

export type KetQuaDongPhieu = {
  /** Phiếu gộp vừa đóng/huỷ (`null` ⇒ đơn không có phiếu mở, hoặc phiếu còn phải thu > 0). */
  phieu: PhieuDaKhep[];
  /** Phiếu thẻ mở đã kết thúc cùng phiếu gộp. */
  the: KetQuaHuyTheCungPhieuGop;
  /** Đã phát `phieu-gop.da-chia` trong lượt này. */
  daPhatSuKien: boolean;
};

const KHONG_GI: KetQuaDongPhieu = { phieu: [], the: { daHuy: [], boQua: [] }, daPhatSuKien: false };

/** Câu ghi vào `reason` của vết phiếu gộp VÀ của vết phiếu thẻ — người đọc sổ biết VÌ SAO mã chết. */
function lyDoCau(lyDo: LyDoDongPhieu, giaoDich: GiaoDichVuaGan | undefined): string {
  if (lyDo === "DON_HUY") return "Huỷ đơn";
  return giaoDich
    ? `Đợt đã đủ tiền bằng đường khác (giao dịch ${giaoDich.provider} ${giaoDich.providerTxnId})`
    : "Đợt đã đủ tiền bằng đường khác";
}

export async function dongPhieuGopKhiHetViecTrongTx(
  tx: Tx,
  input: {
    orderId: string;
    lyDo: LyDoDongPhieu;
    actor: AuditActor;
    /** Chỉ `DU_TIEN` đọc: có giao dịch vừa gắn ⇒ phiếu đóng với tiền đã nhận sẽ phát `phieu-gop.da-chia`. */
    giaoDich?: GiaoDichVuaGan;
  },
): Promise<KetQuaDongPhieu> {
  const cau = lyDoCau(input.lyDo, input.giaoDich);

  if (input.lyDo === "DU_TIEN") {
    // `dau` = dấu để lượt GỠ GẮN nhận ra phiếu này đóng vì đủ tiền (không phải bị huỷ/đóng vì lý do khác) và MỞ LẠI nó khi tiền bị gỡ — xem `phieuGopSauGoGanTrongTx`.
    const khep = await khepPhieuMo0dTrongTx(tx, { orderId: input.orderId, lyDo: cau, actor: input.actor, dau: { nguon: NGUON_DONG_DU_TIEN } });
    if (!khep) return KHONG_GI;
    const the = await huyTheMoCungPhieuGopTrongTx(tx, {
      orderId: input.orderId,
      billId: khep.billId,
      actor: input.actor,
      lyDo: cau,
      nguon: "DU_TIEN",
      them: { phieuGop: khep.dich },
    });
    const daPhatSuKien = await phatSuKienSauChot(tx, input.orderId, khep, input.giaoDich);
    return { phieu: [khep], the, daPhatSuKien };
  }

  // DON_HUY — MỌI phiếu gộp của đơn, bất kể trạng thái: phiếu thẻ mở của phiếu đã VOID/CLOSED trước đó (đường soát đóng phiếu mà không đụng phiếu thẻ) cũng phải
  // kết thúc theo đơn; còn đóng phiếu gộp thì chỉ phiếu đang `OPEN` (chỉ mục từng phần ⇒ tối đa MỘT, nhưng không dựa vào đó).
  const phieuCuaDon = await tx.paymentBill.findMany({
    where: { orderId: input.orderId },
    select: {
      id: true,
      status: true,
      matchKey: true,
      centerId: true,
      lines: { select: { paymentRequest: { select: { allocations: { select: { amount: true } } } } } },
    },
    orderBy: { id: "asc" },
  });
  const ketQua: KetQuaDongPhieu = { phieu: [], the: { daHuy: [], boQua: [] }, daPhatSuKien: false };
  for (const p of phieuCuaDon) {
    // Thẻ mở kết thúc TRƯỚC khi phiếu đổi trạng thái (cùng thứ tự với dừng học).
    const the = await huyTheMoCungPhieuGopTrongTx(tx, {
      orderId: input.orderId,
      billId: p.id,
      actor: input.actor,
      lyDo: cau,
      nguon: "HUY_DON",
      them: {},
    });
    ketQua.the.daHuy.push(...the.daHuy);
    ketQua.the.boQua.push(...the.boQua);

    if (p.status !== "OPEN") continue;
    const daNhan = p.lines.reduce((s, l) => s + l.paymentRequest.allocations.reduce((t, a) => t + a.amount, 0), 0);
    const dich = daNhan > 0 ? ("CLOSED" as const) : ("VOID" as const);
    const upd = await tx.paymentBill.updateMany({ where: { id: p.id, status: "OPEN" }, data: { status: dich } });
    if (upd.count === 0) continue;
    ketQua.phieu.push({ billId: p.id, ma: p.matchKey, dich, daNhan });
    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: dich === "VOID" ? "PHIEU_GOP_VOID" : "PHIEU_GOP_CLOSED",
      oldValues: { billId: p.id, ma: p.matchKey, status: "OPEN" },
      newValues: { billId: p.id, status: dich, daNhan },
      reason: cau,
      orgUnitId: p.centerId,
    });
  }
  return ketQua;
}

/**
 * Phiếu vừa ĐÓNG VỚI TIỀN ĐÃ NHẬN + biết giao dịch vừa gắn ⇒ phát `phieu-gop.da-chia`. Phiếu HUỶ (chưa nhận đồng nào) thì không có gì để "sau chốt".
 * Tên sự kiện LITERAL — lưới `khop-phat-nghe.test.ts` quét `publishEvent("…"`. KHÔNG đặt tên trường `paidDate` trong payload (`[POS-NT-01]`).
 */
async function phatSuKienSauChot(
  tx: Tx,
  orderId: string,
  khep: PhieuDaKhep,
  giaoDich: GiaoDichVuaGan | undefined,
): Promise<boolean> {
  if (!giaoDich || khep.dich !== "CLOSED") return false;
  const tong = await tx.paymentAllocation.aggregate({
    where: { bankTransactionId: giaoDich.bankTransactionId, paymentRequest: { orderId } },
    _sum: { amount: true },
  });
  await publishEvent(
    "phieu-gop.da-chia",
    {
      bankTransactionId: giaoDich.bankTransactionId,
      billId: khep.billId,
      ma: khep.ma,
      orderId,
      provider: giaoDich.provider,
      providerTxnId: giaoDich.providerTxnId,
      tong: tong._sum.amount ?? 0,
      ngayThu: giaoDich.ngayThu.toISOString(),
    },
    { tx, dedupeKey: `phieu-gop.da-chia:${giaoDich.bankTransactionId}:${khep.billId}` },
  );
  return true;
}
