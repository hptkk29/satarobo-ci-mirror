// lib/hoa-hong/du-kien-man-hinh-doc.ts — ĐỌC cho khối "Hoa hồng dự kiến của bạn" (06 §5.6): bối cảnh engine → `duKienCuaToi` → view-model.
//
// Cờ / mốc: đi qua `dungBoiCanhQuet` — engine TẮT hoặc CHƯA có mốc cutover ⇒ `{ loai: "AN" }` (khối không hiện, không đoán). Người gọi vẫn nên kiểm cờ
// TRƯỚC (để khỏi tốn lượt đi-về khi tắt), nhưng đây là lưới cuối: hàm tự không trả số khi engine tắt.
//
// Quyền: `duKienCuaToi` ném `PermissionError` nếu thiếu `commission:view-self`. Nó luôn lọc theo CHÍNH actor, kể cả actor có `view-center`.
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";

import { dungBoiCanhQuet } from "./boi-canh";
import { duKienCuaToi } from "./doc-so";
import { PermissionError } from "@/lib/auth/can";

import { dungDuKienManHinh, type DuKienManHinh } from "./du-kien-man-hinh";

/** `now` BẮT BUỘC (luật 19). */
export async function docDuKienChoMan(actor: Actor, i: { leadId?: string; orderId?: string }, now: Date): Promise<DuKienManHinh> {
  const boiCanh = await dungBoiCanhQuet(db, now);
  if (boiCanh.loai === "TAT") return { loai: "AN" };

  const [kq, vai, lead] = await Promise.all([
    duKienCuaToi(db, boiCanh.bc, actor, i),
    db.beneficiaryRole.findMany({ select: { code: true, name: true } }),
    // Người xem có thể là người hưởng? Chủ lead (người chốt) hoặc admin lead — hai khoá resolver của vai Sale / Sale Admin. Chỉ để quyết có nói "chưa thể tính" hay không.
    i.leadId
      ? db.lead.findUnique({ where: { id: i.leadId }, select: { convertedById: true, adminId: true } })
      : i.orderId
        ? db.order.findUnique({ where: { id: i.orderId }, select: { lead: { select: { convertedById: true, adminId: true } } } }).then((o) => o?.lead ?? null)
        : Promise.resolve(null),
  ]);
  const laNguoiLienQuan = lead !== null && (lead.convertedById === actor.userId || lead.adminId === actor.userId);
  return dungDuKienManHinh({ kq, laNguoiLienQuan, tenVai: new Map(vai.map((v) => [v.code, v.name])) });
}

/**
 * Bản dùng cho TRANG (lead / đơn): khối này là PHỤ — hỏng không được kéo sập cả trang lead/đơn.
 *   · thiếu `commission:view-self` ⇒ ẩn (không phải lỗi);
 *   · lỗi khác ⇒ `LOI` để màn nói "chưa tải được" (không im lặng ẩn: ẩn nghĩa là "không có gì để nói", mà ở đây là "không biết").
 */
export async function docDuKienChoManHienThi(actor: Actor, i: { leadId?: string; orderId?: string }, now: Date): Promise<DuKienManHinh> {
  try {
    return await docDuKienChoMan(actor, i, now);
  } catch (e) {
    if (e instanceof PermissionError) return { loai: "AN" };
    return { loai: "LOI" };
  }
}
