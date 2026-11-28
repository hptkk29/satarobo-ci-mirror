import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";
import { taiPhoiLen } from "@/lib/elearning-online/cn-mau-db";
import { GIOI_HAN_PHOI } from "@/lib/elearning-online/cn-mau";
import { khoR2 } from "@/lib/elearning-online/cn-tai-san";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * QoCN — TẢI PHÔI chứng nhận Online của một khoá (multipart: `courseId` + `phoi`). Tạo bản NHÁP; duyệt ở bước riêng.
 * Gác: cờ → phiên SỐNG → `onl:course:manage`. Ảnh vào CHÍNH bucket R2 hiện có (không bucket mới), khoá theo mã băm nội dung.
 * Định dạng nhận bằng CHỮ KÝ TỆP — không tin MIME/đuôi do client gửi.
 */
export async function POST(req: NextRequest) {
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  const session = await requireLiveSession();
  if (!session?.user?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "onl:course:manage")) return fail("PERMISSION_DENIED", "Không có quyền quản lý khoá online", { status: 403 });
  const lenDoc = Number(req.headers.get("content-length") ?? 0);
  if (lenDoc > GIOI_HAN_PHOI.toiDaByte + 64 * 1024) return fail("VALIDATION_FAILED", "Phôi vượt 10 MB", { status: 413 });
  const form = await req.formData().catch(() => null);
  const courseId = z.string().min(1).safeParse(form?.get("courseId"));
  const tep = form?.get("phoi");
  if (!courseId.success || !(tep instanceof File)) return fail("VALIDATION_FAILED", "Thiếu khoá hoặc tệp phôi", { status: 400 });
  const bytes = new Uint8Array(await tep.arrayBuffer());
  const kho = await khoR2().catch(() => null);
  if (!kho) return fail("INTERNAL", "Kho tệp chưa cấu hình", { status: 503 });
  const r = await taiPhoiLen(db, kho, { courseId: courseId.data, bytes, actorUserId: actor.userId });
  if (!r.ok) return fail("VALIDATION_FAILED", r.thongBao, { status: r.ma === "KHOA_KHONG_TON_TAI" ? 404 : 400 });
  return ok({ id: r.id, version: r.version, canhBao: r.canhBao });
}
