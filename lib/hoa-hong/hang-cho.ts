// lib/hoa-hong/hang-cho.ts — HÀNG CHỜ (`CommissionHold`): dựng, ghi, đóng.
//
// Nguồn: docs/source-commission/04 §10.5, 02 §9.3. Hàng chờ là BẢNG CÔNG VIỆC (sửa được), khác sổ (bất biến).
//
// Quy tắc sống còn:
//   · KHÔNG ĐOÁN: thiếu dữ liệu để quyết ⇒ hàng chờ, không dòng sổ (L7).
//   · `holdKey` UNIQUE chống đẻ trùng giữa các lượt quét. Lượt quét sau gặp lại cùng ca ⇒ cập nhật chi tiết, KHÔNG đẻ dòng thứ hai.
//   · Mềm KHÔNG chặn khoá kỳ khi là `UNRESOLVED_BENEFICIARY` / `NEGATIVE_BALANCE` (blockingPeriodId luôn NULL — CHECK DB). Còn lại
//     chặn kỳ chứa khoản đó; "Dời sang kỳ sau" (PR9) đổi cột này.
//   · Một hàng chờ do lượt quét sinh ra thì lượt quét ĐÓNG nó khi điều kiện không còn (khoản đã gắn bé, chính sách đã sửa…) — người
//     không phải bấm "giải" những ca máy tự nhìn thấy. `DISMISSED` ("giữ nguyên" kèm lý do) KHÔNG bị mở lại.
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
export type MaHold = Prisma.CommissionHoldCreateInput["code"];

/** Mã chặn khoá kỳ (cứng + mềm-chặn). Hai mã còn lại luôn `blockingPeriodId = NULL`. */
const MA_KHONG_CHAN: ReadonlySet<MaHold> = new Set<MaHold>(["UNRESOLVED_BENEFICIARY", "NEGATIVE_BALANCE"]);
export const hangChoChanKy = (ma: MaHold): boolean => !MA_KHONG_CHAN.has(ma);

/** Mức nghiêm trọng theo bảng 04 §10.5. */
const MA_MEM: ReadonlySet<MaHold> = new Set<MaHold>(["CHUA_GAN_CON", "CHO_HOC_VIEN", "UNRESOLVED_BENEFICIARY", "NEGATIVE_BALANCE"]);
export const mucCuaHangCho = (ma: MaHold): "SOFT" | "HARD" => (MA_MEM.has(ma) ? "SOFT" : "HARD");

export type HoldNhap = {
  holdKey: string;
  code: MaHold;
  paymentId: string | null;
  orderId: string | null;
  orderItemId: string | null;
  studentId: string | null;
  entryId: string | null;
  calcSlotId: string | null;
  /** Kỳ chặn — chỉ được set khi `hangChoChanKy(code)`. `null` cũng hợp lệ (chưa quy được đơn vị). */
  blockingPeriodId: string | null;
  detail: Record<string, unknown>;
  centerId: string | null;
  orgUnitId: string | null;
};

/**
 * Ghi (tạo hoặc cập nhật) một hàng chờ. PHẢI chạy trong transaction đang giữ khoá advisory theo khoản
 * (`chayTrongKhoa`) — find-rồi-ghi không an toàn nếu hai lượt cùng khoản chạy song song.
 */
export async function ghiHangCho(tx: Tx, h: HoldNhap, now: Date): Promise<void> {
  const blocking = hangChoChanKy(h.code) ? h.blockingPeriodId : null;
  const cu = await tx.commissionHold.findUnique({ where: { holdKey: h.holdKey }, select: { id: true, status: true } });
  const chung = {
    code: h.code,
    severity: mucCuaHangCho(h.code),
    paymentId: h.paymentId,
    orderId: h.orderId,
    orderItemId: h.orderItemId,
    studentId: h.studentId,
    entryId: h.entryId,
    calcSlotId: h.calcSlotId,
    blockingPeriodId: blocking,
    detail: h.detail as Prisma.InputJsonValue,
    centerId: h.centerId,
    orgUnitId: h.orgUnitId,
  };
  if (!cu) {
    await tx.commissionHold.create({ data: { holdKey: h.holdKey, status: "OPEN", ...chung } });
    return;
  }
  if (cu.status === "DISMISSED") return; // người đã quyết "giữ nguyên" — không mở lại
  await tx.commissionHold.update({
    where: { id: cu.id },
    data: { ...chung, status: "OPEN", resolvedAt: null, resolvedById: null, resolutionNote: null },
  });
  void now;
}

/**
 * Đóng các hàng chờ ĐANG MỞ của một khoản mà lượt quét này không còn dựng nữa. `conGiu` = tập `holdKey` còn hiệu lực.
 * Chỉ đóng mã do lượt quét SINH (mọi mã trừ `NEGATIVE_BALANCE` — thuộc bước xuất) — người xử lý tay bằng cách sửa dữ liệu rồi Tính lại.
 */
export async function dongHangChoDaHetCan(tx: Tx, paymentId: string, conGiu: ReadonlySet<string>, now: Date): Promise<number> {
  const dangMo = await tx.commissionHold.findMany({
    where: { paymentId, status: "OPEN", code: { not: "NEGATIVE_BALANCE" } },
    select: { id: true, holdKey: true, code: true },
  });
  const can = dangMo.filter((h) => !conGiu.has(h.holdKey));
  if (can.length === 0) return 0;
  await tx.commissionHold.updateMany({
    where: { id: { in: can.map((h) => h.id) }, status: "OPEN" },
    data: { status: "RESOLVED", resolvedAt: now, resolutionNote: "Tự đóng ở lượt quét: điều kiện của hàng chờ không còn." },
  });
  return can.length;
}
