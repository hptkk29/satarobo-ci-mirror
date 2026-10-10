// POST /api/admin/bao-luu/tep/upload-url — ký URL PUT cho đơn bảo lưu / minh chứng vào kho RIÊNG.
//
// KHÁC `/api/admin/upload-url` ở ba điểm có chủ đích (chốt 07/10/2026):
//   1. Bucket RIÊNG (`R2_BAOLUU_BUCKET_NAME`), KHÔNG trả `publicUrl` — đơn mang tên trẻ em, tình trạng
//      sức khoẻ, chữ ký phụ huynh; URL công khai là URL vĩnh viễn.
//   2. Quyền theo QUYỀN (`bao-luu:create` hoặc `bao-luu:center-pause`), không theo danh sách vai v1: vai
//      Sale ở v1 chỉ được ký category ảnh và Kế toán/Giáo vụ ở v2 không có vai v1 — cùng bẫy 11/08 đã vá hai lần.
//   3. Loại tệp hẹp hơn (PDF + ảnh), khoá do SERVER sinh, và khoá phải đi qua `laKhoaTepBaoLuu` ở mọi nơi nhận lại.
//
// Công tắc: chỉ ký khi có ÍT NHẤT MỘT cơ sở trong tầm nhìn đang bật `pause.enabled` — nút Tải lên đã ẩn khi
// tắt, đường này chặn POST tay (luật 8). Cổng bắt buộc nằm ở server action lúc LƯU hồ sơ (Phiên 3).
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getSetting } from "@/lib/settings/service";
import { coNoiNaoBatBaoLuu, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { kyUrlTaiLenBaoLuu, khoBaoLuuDaCauHinh } from "@/lib/bao-luu/kho-tep";
import { khoaTepBaoLuu, loaiTuTenTep, TRAN_CO_TEP_BAO_LUU } from "@/lib/bao-luu/tep";
import { vnParts } from "@/lib/time/vn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loi = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return loi(401, "Chưa đăng nhập");

  const [lap, trungTam] = await Promise.all([
    checkPermission("bao-luu:create"),
    checkPermission("bao-luu:center-pause"),
  ]);
  if (!lap && !trungTam) return loi(403, "Không có quyền tải tệp bảo lưu");

  const actor = await resolveActor(session.user.id);
  if (!(await coNoiNaoBatBaoLuu(actor.isHoLevel ? [] : actor.visibleOrgUnitIds ?? []))) {
    return loi(403, LOI_BAO_LUU_TAT);
  }

  let body: { filename?: unknown; mimeType?: unknown; sizeBytes?: unknown };
  try {
    body = await req.json();
  } catch {
    return loi(400, "Dữ liệu không hợp lệ");
  }
  const { filename, mimeType, sizeBytes } = body;
  if (typeof filename !== "string" || typeof mimeType !== "string" || typeof sizeBytes !== "number") {
    return loi(400, "Thiếu filename, mimeType hoặc sizeBytes");
  }
  const loai = loaiTuTenTep(filename, mimeType);
  if (!loai) return loi(400, "Chỉ nhận PDF hoặc ảnh JPG/PNG/WEBP, và loại tệp phải khớp đuôi tệp");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return loi(400, "Cỡ tệp không hợp lệ");
  if (sizeBytes > TRAN_CO_TEP_BAO_LUU) {
    return loi(413, `Tệp quá lớn. Tối đa ${Math.round(TRAN_CO_TEP_BAO_LUU / 1024 / 1024)}MB — hãy nén ảnh rồi tải lại.`);
  }

  if (!khoBaoLuuDaCauHinh()) return loi(503, "Kho tệp bảo lưu chưa cấu hình — báo người vận hành");

  const p = vnParts(new Date());
  const khoa = khoaTepBaoLuu({ nam: p.year, thang: p.month + 1, uuid: randomUUID(), loai });
  try {
    const ttl = await getSetting("storage.presignTtlSec");
    const uploadUrl = await kyUrlTaiLenBaoLuu(khoa, loai, ttl);
    // KHÔNG có `publicUrl`. Trình duyệt giữ `key` rồi gửi lại khi lưu hồ sơ.
    return NextResponse.json({ uploadUrl, key: khoa, contentType: mimeType.toLowerCase(), expiresIn: ttl }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[bao-luu] ký URL tải lên thất bại:", err);
    return loi(503, "Kho tệp bảo lưu đang lỗi. Vui lòng thử lại.");
  }
}

