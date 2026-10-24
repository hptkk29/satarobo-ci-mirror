import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSigningSecret } from "@/lib/security/signing-key";
import { makeStaticKioskToken } from "@/lib/cham-cong/kiosk-token";
import { originCuaRequest } from "@/lib/http/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/cham-cong/qr-token?centerId=…[&workLocationId=…]
//
// MỘT chế độ duy nhất: QR TĨNH của điểm chấm công. Mã không đổi, không hết hạn; thu hồi bằng
// cách tăng `WorkLocation.qrKeyVersion`. Chốt chủ dự án 07/09/2026 — chế độ QR XOAY 60s đã gỡ.
//
// Tham số `tinh=1` của bản cũ nay là thừa. KHÔNG bắt lỗi khi nó còn xuất hiện: màn TV là trang
// chạy liên tục ở quầy, bản JS cũ đang mở vẫn gửi kèm nó cho tới lần tải lại kế tiếp.
//
// `workLocationId` để chọn ĐÚNG điểm khi một cơ sở có nhiều quầy — trước đây `findFirst` lấy
// bừa điểm đầu tiên, nên cơ sở hai quầy thì quầy thứ hai không bao giờ in được mã của mình.
//
// Chỉ đòi quyền VIEW tại cơ sở đó.
//
// Bản đầu tôi gác mã tĩnh ở `hr_attendance:config` với lý lẽ "in mã là việc của người quản trị".
// Sai hai đường: (a) màn TV nay chiếu chính mã tĩnh, nên gác ở config là nhân viên cơ sở KHÔNG
// MỞ NỔI MÀN TV — mà mở TV là việc hằng ngày; (b) nó không mua được gì về bảo mật: tờ mã dán
// công khai ở quầy, ai đứng đó cũng chụp được. Gác chặt một thứ vốn không phải bí mật thì chỉ
// đổi lấy phiền toái. Thứ thật sự chặn người ở xa là ĐỊNH VỊ, không phải quyền xem mã.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams;
  const centerId = q.get("centerId");
  const workLocationId = q.get("workLocationId");
  if (!centerId) {
    return NextResponse.json({ error: "Thiếu centerId" }, { status: 400 });
  }
  if (!(await checkPermission("hr_attendance:view", { centerId }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sdb = scopedDb(await resolveActor(session.user.id));
  const wl = workLocationId
    ? await sdb.workLocation.findFirst({ where: { id: workLocationId, centerId, isActive: true }, select: { id: true, name: true, geofenceEnabled: true, qrKeyVersion: true } })
    : await sdb.workLocation.findFirst({ where: { centerId, isActive: true }, select: { id: true, name: true, geofenceEnabled: true, qrKeyVersion: true } });
  if (!wl) {
    return NextResponse.json({ error: "Cơ sở chưa có điểm chấm công — vào Chấm công → Điểm chấm công để tạo (hoặc chạy seed nền)." }, { status: 404 });
  }

  const token = makeStaticKioskToken(wl.id, wl.qrKeyVersion, getSigningSecret());
  const checkinUrl = `${originCuaRequest(req)}/cham-cong/checkin?w=${encodeURIComponent(wl.id)}&t=${encodeURIComponent(token)}`;
  // Mã in ra to hơn và sửa lỗi ở mức cao hơn: tờ giấy dán ở quầy sẽ bị mờ, bị xước, bị dán đè
  // góc — mức M chịu được ~15% hỏng, mức Q chịu ~25%.
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
    width: 720,
    margin: 2,
    errorCorrectionLevel: "Q",
  });
  return NextResponse.json({
    token,
    qrDataUrl,
    checkinUrl,
    workLocation: wl,
    qrKeyVersion: wl.qrKeyVersion,
  });
}
