import "server-only";
// lib/finance/phieu-gop-go-gan-db.ts — tầng DB của `phieu-gop-go-gan.ts`. CHẠM TIỀN.
//
// Gọi TRONG transaction của `goGanTheoCon` (đang giữ khoá đơn), SAU khi phân bổ đã bị xoá — đúng
// MỘT lời gọi (lưới `[PGG-W1]`). Luật chọn phiếu + quyết định sống ở tệp thuần; tệp này chỉ đọc,
// hỏi, rồi ghi bằng `updateMany` CÓ ĐIỀU KIỆN `status: "PAID"`.
//
// ⚠️ VÌ SAO KHÔNG ĐẶT TRONG `phieu-gop.ts`: tệp đó import `ghi-tien-don.ts` (khoá đơn), còn
// `ghi-tien-don.ts` gọi hàm này ⇒ đặt ở đó là vòng import hai tệp ghi tiền của cả module.
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { conPhaiThuCuaPhieu } from "@/lib/payments/chia-phieu-gop";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import {
  phieuDoGiaoDichTra,
  quyetPhieuMoSauGoGan,
  quyetPhieuSauGoGan,
  type HanhDongPhieuSauGoGan,
  type NguonTienGoGan,
  type TinHieuTheSauGo,
} from "./phieu-gop-go-gan";
import { khepPhieuMo0dTrongTx } from "./khep-phieu-0d-db";

type Tx = Prisma.TransactionClient;

export type PhieuSauGoGan = {
  billId: string;
  ma: string | null;
  /** Việc ĐÃ LÀM, không phải dự định: phép ghi có điều kiện đổi 0 dòng ⇒ `GIU`. */
  hanhDong: HanhDongPhieuSauGoGan;
  /** Số còn phải thu của phiếu SAU khi phân bổ bị xoá — số mã cũ sẽ đòi nếu mở lại. */
  conPhaiThu: number;
  lyDo: string;
};

/**
 * Mở lại / đóng các phiếu gộp mà giao dịch vừa gỡ đã trả.
 *
 * ⚠️ HAI điều kiện gọi, cả hai là của người gọi:
 *   · đang giữ `khoaDonTrongTx(tx, orderId)` — mọi đường tạo/đổi phiếu (`taoPhieuGop`,
 *     `doiTrangThaiPhieuTrongTx`, `thuTheoPhieuGop`) cùng khoá đó, nên phép đếm "đơn có phiếu OPEN
 *     chưa" ở dưới không thể lỗi thời giữa lúc đếm và lúc mở lại (không thì chỉ mục từng phần
 *     ném giữa transaction và cuộn ngược CẢ lượt gỡ);
 *   · gọi SAU `paymentAllocation.deleteMany` — số còn phải thu đọc phân bổ SỐNG.
 */
export async function phieuGopSauGoGanTrongTx(
  tx: Tx,
  input: {
    orderId: string;
    /** `paymentRequestId` của các phân bổ vừa bị xoá. */
    dotVuaGo: readonly string[];
    /**
     * Ảnh chụp các phân bổ vừa bị xoá (số tiền) — rà vòng 6: phiếu ĐANG MỞ chỉ đóng khi lượt gỡ làm nó đòi
     * THÊM (so còn phải thu trước/sau). BẮT BUỘC (luật 7).
     */
    phanBoVuaXoa: readonly { paymentRequestId: string; amount: number; roundingWaived: number }[];
    /** `note` của các khoản `Payment` vừa bị đảo trong lượt gỡ này. */
    ghiChuVuaDao: readonly string[];
    lyDoGo: string;
    actor: AuditActor;
    /**
     * Kết quả `giaoDichPosSauGoGanTrongTx` (`tinHieu`) — chỉ chọn LÝ DO ghi nhật ký (luật tiền do `nguon`
     * gác, xem `quyetPhieuSauGoGan`).
     */
    tinHieuThe: TinHieuTheSauGo;
    /** Kết quả `giaoDichPosSauGoGanTrongTx` (`nguon`) — BẮT BUỘC (Q-M), xem `quyetPhieuSauGoGan`. */
    nguon: NguonTienGoGan;
  },
): Promise<PhieuSauGoGan[]> {
  if (input.dotVuaGo.length === 0) return [];
  const ketQua: PhieuSauGoGan[] = [];

  // ── Phiếu ĐANG MỞ mà tiền của lượt gỡ đang lấp (gắn tay / "Rót vào đơn" vào đợt của phiếu đã phát —
  // phiếu còn phải thu 0đ, màn giấu). Nhãn "Phiếu gộp <mã>" không có trên khoản đó nên phiếu không phải
  // ứng viên PAID ở dưới; sau khi xoá phân bổ nó HIỆN LẠI đòi tiền. Luật ở `quyetPhieuMoSauGoGan`:
  // chuyển khoản ⇒ để nguyên (`[V3-20]`); thẻ ⇒ ĐÓNG (hoàn một phần: `[V5-20]`; còn lại: Q-M) — CHỈ khi lượt
  // gỡ làm phiếu đòi THÊM (rà vòng 6: phiếu phát SAU khi gắn tay không tính số của thẻ ⇒ để nguyên).
  const moCham = await tx.paymentBill.findMany({
    where: { orderId: input.orderId, status: "OPEN", lines: { some: { paymentRequestId: { in: [...input.dotVuaGo] } } } },
    select: CHON_PHIEU,
  });
  for (const p of moCham) {
    const conPhaiThu = conPhaiThuCuaPhieu(dongCua(p, KHONG_CONG));
    const conPhaiThuTruoc = conPhaiThuCuaPhieu(dongCua(p, input.phanBoVuaXoa));
    const q = quyetPhieuMoSauGoGan({ conPhaiThu, conPhaiThuTruoc, nguon: input.nguon, tinHieuThe: input.tinHieuThe });
    if (!q) continue;
    const upd = await tx.paymentBill.updateMany({ where: { id: p.id, status: "OPEN" }, data: { status: "CLOSED" } });
    if (upd.count === 0) continue;
    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "PHIEU_GOP_CLOSED",
      oldValues: { billId: p.id, ma: p.matchKey, status: "OPEN" },
      newValues: { billId: p.id, status: "CLOSED", conPhaiThu },
      reason: `${q.lyDo} (gỡ gắn: ${input.lyDoGo})`,
      orgUnitId: p.centerId,
    });
    ketQua.push({ billId: p.id, ma: p.matchKey, hanhDong: "DONG", conPhaiThu, lyDo: q.lyDo });
  }

  if (input.ghiChuVuaDao.length === 0) return ketQua;

  const ungVien = await tx.paymentBill.findMany({
    where: { orderId: input.orderId, status: "PAID", lines: { some: { paymentRequestId: { in: [...input.dotVuaGo] } } } },
    select: { ...CHON_PHIEU, status: true },
    orderBy: { createdAt: "asc" },
  });
  const phieu = phieuDoGiaoDichTra(ungVien, new Set(input.dotVuaGo), input.ghiChuVuaDao);
  if (phieu.length === 0) return ketQua;

  const donNhanTien = (await tx.order.count({ where: { id: input.orderId, ...locDonNhanTien() } })) > 0;
  // "Phiếu mở khác" = phiếu OPEN còn phải thu > 0 (thấy trên màn). Phiếu OPEN 0đ (màn giấu) KHÔNG
  // chặn chỗ (rà vòng 4, `[V3-23]`) — nhưng cũng KHÔNG bị khép sẵn: rà vòng 5 (`[V5-30]`) bản trước
  // khép nó VÔ ĐIỀU KIỆN kể cả khi phiếu cần quyết ra ĐÓNG/GIỮ (không ai cần chỗ) và vứt kết quả ⇒
  // gỡ khoản đường khác sau đó thì phiếu 0đ không hiện lại (trái `[V3-20]`), và toast im. Nay chỉ
  // khép ngay trước phép MỞ LẠI (đúng luật `taoPhieuGop`: khép lúc có người cần chỗ) và NÓI RA.
  const moHienTai = await tx.paymentBill.findFirst({ where: { orderId: input.orderId, status: "OPEN" }, select: CHON_PHIEU });
  let coPhieuMo = moHienTai != null && conPhaiThuCuaPhieu(dongCua(moHienTai, KHONG_CONG)) > 0;
  let coPhieu0d = moHienTai != null && !coPhieuMo;

  for (const p of phieu) {
    // `conPhaiThuCuaPhieu` — CÙNG hàm mà QR in số và cổng đối khớp so số. Dòng phiếu mang số
    // chụp lúc phát (`amount`), tiền đã rót đọc SỐNG từ phân bổ ⇒ phần đường khác đã lấp không
    // bị đòi lại (ca `[PNS-04]`).
    const conPhaiThu = conPhaiThuCuaPhieu(dongCua(p, KHONG_CONG));
    const hoi = (coPhieuMoKhac: boolean) =>
      quyetPhieuSauGoGan({
        conPhaiThu,
        donNhanTien,
        coPhieuMoKhac,
        coDotDaHuy: p.lines.some((l) => l.paymentRequest.status === "VOID"),
        tinHieuThe: input.tinHieuThe,
        nguon: input.nguon,
      });
    let q = hoi(coPhieuMo);
    if (q.hanhDong === "GIU") {
      ketQua.push({ billId: p.id, ma: p.matchKey, hanhDong: "GIU", conPhaiThu, lyDo: q.lyDo });
      continue;
    }

    if (q.hanhDong === "MO_LAI" && coPhieu0d) {
      // Phiếu OPEN 0đ giữ chỗ trên chỉ mục một-phiếu-mở ⇒ khép nó TRƯỚC (đã nhận ⇒ ĐÓNG, chưa ⇒
      // HUỶ), không thì mở lại đụng `PaymentBill_orderId_open_key` ⇒ P2002 cuộn ngược cả lượt gỡ.
      coPhieu0d = false;
      const khep = await khepPhieuMo0dTrongTx(tx, {
        orderId: input.orderId,
        lyDo: `Phiếu còn phải thu 0đ (đủ tiền từ đường khác) — khép để mở lại phiếu ${p.matchKey ?? p.id} sau gỡ gắn (${input.lyDoGo})`,
        actor: input.actor,
      });
      if (khep) {
        ketQua.push({
          billId: khep.billId,
          ma: khep.ma,
          hanhDong: "DONG",
          conPhaiThu: 0,
          lyDo: "Phiếu còn phải thu 0đ — khép để nhường chỗ cho phiếu mở lại",
        });
      }
      // Phòng thủ: khép đổi 0 dòng mà vẫn còn phiếu OPEN ⇒ quyết lại như "có phiếu mở khác".
      if ((await tx.paymentBill.count({ where: { orderId: input.orderId, status: "OPEN" } })) > 0) {
        coPhieuMo = true;
        q = hoi(true);
      }
    }

    const dich = q.hanhDong === "MO_LAI" ? "OPEN" : "CLOSED";
    const upd = await tx.paymentBill.updateMany({ where: { id: p.id, status: "PAID" }, data: { status: dich } });
    if (upd.count === 0) {
      // Nhánh phòng thủ: `goGanTheoCon` giữ khoá đơn, và các đường đổi trạng thái phiếu đã biết
      // (thu theo mã, soát phiếu khi VOID đợt — kể cả lưu/duyệt/từ chối kế hoạch, huỷ đơn) cũng giữ
      // CÙNG khoá. Đổi 0 dòng ⇒ ghi nhận đúng việc ĐÃ làm (không gì), không đoán.
      ketQua.push({ billId: p.id, ma: p.matchKey, hanhDong: "GIU", conPhaiThu, lyDo: "Phiếu vừa đổi trạng thái — không đụng" });
      continue;
    }
    if (dich === "OPEN") coPhieuMo = true;

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: dich === "OPEN" ? "PHIEU_GOP_MO_LAI" : "PHIEU_GOP_CLOSED",
      oldValues: { billId: p.id, ma: p.matchKey, status: "PAID" },
      newValues: { billId: p.id, status: dich, conPhaiThu },
      reason: `${q.lyDo} (gỡ gắn: ${input.lyDoGo})`,
      orgUnitId: p.centerId,
    });
    ketQua.push({ billId: p.id, ma: p.matchKey, hanhDong: q.hanhDong, conPhaiThu, lyDo: q.lyDo });
  }
  return ketQua;
}

const CHON_PHIEU = {
  id: true,
  matchKey: true,
  centerId: true,
  lines: {
    select: {
      paymentRequestId: true,
      sortOrder: true,
      amount: true,
      paymentRequest: { select: { amountDue: true, status: true, allocations: { select: { amount: true, roundingWaived: true } } } },
    },
  },
} as const;

type PhieuDoc = Prisma.PaymentBillGetPayload<{ select: typeof CHON_PHIEU }>;

/** Đọc trạng thái SAU lượt gỡ (không cộng lại gì) — tên riêng thay cho tham số mặc định (luật 7). */
const KHONG_CONG: readonly { paymentRequestId: string; amount: number; roundingWaived: number }[] = [];

/**
 * Dòng của phiếu cho `conPhaiThuCuaPhieu`. `congLai` = phân bổ vừa xoá ⇒ dựng lại trạng thái TRƯỚC lượt gỡ
 * (đọc ở đây là SAU `deleteMany`, nên cộng lại đúng phần vừa mất của từng đợt).
 */
function dongCua(p: PhieuDoc, congLai: readonly { paymentRequestId: string; amount: number; roundingWaived: number }[]) {
  const cong = (id: string, k: "amount" | "roundingWaived") =>
    congLai.reduce((s, a) => (a.paymentRequestId === id ? s + a[k] : s), 0);
  return p.lines.map((l) => ({
    paymentRequestId: l.paymentRequestId,
    sortOrder: l.sortOrder,
    amount: l.amount,
    amountDue: l.paymentRequest.amountDue,
    daRot: l.paymentRequest.allocations.reduce((s, a) => s + a.amount, 0) + cong(l.paymentRequestId, "amount"),
    daTha: l.paymentRequest.allocations.reduce((s, a) => s + a.roundingWaived, 0) + cong(l.paymentRequestId, "roundingWaived"),
  }));
}
