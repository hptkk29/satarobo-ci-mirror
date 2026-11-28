import { NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/response";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { datCauHinhThuTien, docCauHinhDangBat, docLichSuCauHinh, voHieuCauHinhThuTien, laQuanTriToiCao } from "@/lib/online-checkout/cau-hinh-thanh-toan";

export const dynamic = "force-dynamic";

/**
 * V8.18 — CẤU HÌNH THU TIỀN ONLINE (chỉ Quản trị tối cao). Owner chốt: SataRobo bán · nhận tiền · xuất hoá đơn; KHÔNG theo cơ sở Offline.
 *   GET    → trạng thái đang bật (SAN_SANG | BLOCKED_CONFIG + trường thiếu) + lịch sử (STK che 4 số cuối)
 *   PUT    { paymentMethodId, memoPrefix?, mode:"TEST"|"PROD", reason, legalEntityId + xacNhanMaSoThue (BẮT BUỘC khi PROD) } → bật cấu hình MỚI (dòng cũ tắt); chỉ áp cho đơn MỚI
 *   DELETE { reason } → ngừng phát hành hướng dẫn mới (đơn đang chờ giữ thông tin đã phát hành)
 * Auth: phiên Auth.js + vai SUPER_ADMIN (không có vai nào khác được cấp). PROD chỉ lưu được khi Owner đã đặt khoá `ONLINE_PAYMENT_PROD_UNLOCK`.
 */
const putSchema = z.strictObject({ paymentMethodId: z.string().min(1).max(64), legalEntityId: z.string().min(1).max(64).optional(), xacNhanMaSoThue: z.string().max(20).optional(), memoPrefix: z.string().max(8).optional(), mode: z.enum(["TEST", "PROD"]), reason: z.string().min(1).max(500) });
const deleteSchema = z.strictObject({ reason: z.string().min(1).max(500) });
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

async function nguoiGoi() {
  const s = await auth();
  const u = s?.user as { id?: string; name?: string | null; email?: string | null; role?: string; roles?: string[] } | undefined;
  if (!u?.id) return { res: fail("UNAUTHENTICATED", "Chưa đăng nhập.", { status: 401, headers: KHONG_LUU }) };
  if (!laQuanTriToiCao(u)) return { res: fail("FORBIDDEN", "Chỉ Quản trị tối cao.", { status: 403, headers: KHONG_LUU }) };
  return { actor: { id: u.id, name: u.name ?? u.email ?? u.id, role: u.role ?? null, roles: u.roles ?? [] } };
}

export async function GET() {
  const n = await nguoiGoi();
  if ("res" in n && n.res) return n.res;
  const actor = n.actor!;
  const [dangBat, ls] = await Promise.all([docCauHinhDangBat(db), docLichSuCauHinh(db, { actor })]);
  if (!ls.ok) return fail(ls.ma, ls.thongBao, { status: 403, headers: KHONG_LUU });
  return ok({ dangBat: dangBat.trangThai === "SAN_SANG" ? { trangThai: "SAN_SANG", mode: dangBat.cauHinh.mode, memoPrefix: dangBat.cauHinh.memoPrefix, phapNhan: dangBat.cauHinh.phapNhan } : dangBat, lichSu: ls.muc }, { headers: KHONG_LUU });
}

async function docThan<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }) };
  }
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, res: fail("VALIDATION", p.error.issues[0]?.message ?? "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }) };
  return { ok: true, data: p.data };
}

const HTTP_LOI = { KHONG_CO_QUYEN: 403, THIEU_LY_DO: 400, PHUONG_THUC_KHONG_HOP_LE: 422, PHAP_NHAN_KHONG_HOP_LE: 422, TIEN_TO_KHONG_HOP_LE: 400, MODE_KHONG_HOP_LE: 400, PROD_CHUA_MO: 409, PHAP_NHAN_CHUA_XAC_NHAN: 422, KHONG_CO_CAU_HINH_DANG_BAT: 409 } as const;

export async function PUT(req: Request) {
  const n = await nguoiGoi();
  if ("res" in n && n.res) return n.res;
  const than = await docThan(req, putSchema);
  if (!than.ok) return than.res;
  const r = await datCauHinhThuTien(db, { actor: n.actor!, ...than.data, now: new Date() });
  if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI[r.ma], headers: KHONG_LUU });
  return ok({ configId: r.configId }, { headers: KHONG_LUU });
}

export async function DELETE(req: Request) {
  const n = await nguoiGoi();
  if ("res" in n && n.res) return n.res;
  const than = await docThan(req, deleteSchema);
  if (!than.ok) return than.res;
  const r = await voHieuCauHinhThuTien(db, { actor: n.actor!, reason: than.data.reason, now: new Date() });
  if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI[r.ma], headers: KHONG_LUU });
  return ok({ configId: r.configId }, { headers: KHONG_LUU });
}
