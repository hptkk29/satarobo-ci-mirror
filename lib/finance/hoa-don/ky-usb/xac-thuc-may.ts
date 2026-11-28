import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { db } from "@/lib/db";
import { laKyUsbBat } from "../feature";
import { QUYEN_KE_TOAN_HOA_DON, phamViKeToan } from "../quyen";
import { xacThucTokenMay } from "./may-ky";

// lib/finance/hoa-don/ky-usb/xac-thuc-may.ts — cổng chung của MỌI route mà ứng dụng ký gọi (Bearer = token máy). Hub/13 §5.
//
// Thứ tự (mỗi lời gọi, không nhớ gì từ lời gọi trước): cờ `hoaDon.kyUsb` → token (băm, còn hạn, chưa thu hồi) → tài khoản CÒN HOẠT ĐỘNG (isActive, chưa xoá mềm)
// → `resolveActor` LẠI → còn quyền `payments:confirm` (`can()` trên actor vừa dựng — KHÔNG dùng phiên đăng nhập, ứng dụng không có phiên) → còn là kế toán ở ÍT NHẤT
// một cơ sở. Mất quyền / bị khoá tài khoản ⇒ máy mất tác dụng ngay, không cần ai nhớ thu hồi.
// Mọi từ chối trả mã HTTP trơn, KHÔNG thông điệp (không lộ máy tồn tại hay hết hạn hay mất quyền).

export type KetQuaXacThucMay =
  | { ok: true; actor: Actor; userId: string; userName: string; mayId: string }
  | { ok: false; status: 401 | 403 | 404 };

export function layBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h.trim()) : null;
  return m ? m[1]! : null;
}

export async function xacThucYeuCauMay(req: Request, now: Date): Promise<KetQuaXacThucMay> {
  if (!(await laKyUsbBat())) return { ok: false, status: 404 };
  const may = await xacThucTokenMay(layBearer(req), now);
  if (!may) return { ok: false, status: 401 };
  const u = await db.user.findUnique({ where: { id: may.userId }, select: { id: true, name: true, email: true, isActive: true, deletedAt: true } });
  if (!u || !u.isActive || u.deletedAt) return { ok: false, status: 401 };
  const actor = await resolveActor(may.userId);
  if (!can(actor, QUYEN_KE_TOAN_HOA_DON)) return { ok: false, status: 403 };
  const pham = phamViKeToan(actor);
  if (pham !== "ALL" && pham.length === 0) return { ok: false, status: 403 };
  return { ok: true, actor, userId: u.id, userName: u.name ?? u.email ?? u.id, mayId: may.mayId };
}
