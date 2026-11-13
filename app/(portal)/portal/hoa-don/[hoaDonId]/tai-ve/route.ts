// GET /portal/hoa-don/<hoaDonId>/tai-ve?loai=pdf|xml — phụ huynh tải tệp hoá đơn điện tử của con mình (03/11/2026).
// Khuôn: `app/(admin)/admin/payments/hoa-don/[hoaDonId]/tai-ve/route.ts` (cổng kế toán). Khác ở CHỦ SỞ HỮU: không có
// quyền `can()` nào ở đây — quyền đọc là QUYỀN SỞ HỮU (hoá đơn gắn với con của chính phụ huynh đăng nhập).
//
// «Xem» (`xem=1`, chỉ PDF) ký URL inline; «Tải về» ký URL attachment. Hoá đơn của đơn KHÔNG có nhu cầu (phụ huynh không khai người mua) ⇒ 404.
//
// Thứ tự: cờ → đăng nhập (PARENT) → không ở chế độ học sinh → đã đồng ý chính sách website → loại tệp → sở hữu + luật bản (MỘT truy vấn:
// `whereHoaDonPhuHuynh`) → có tệp → kho đã cấu hình → AUDIT → ký GET 300 giây → redirect 302 no-store.
//   · Không thấy / của người khác / không phải bản được hiện (NHAP, THAY_THE, GIA_LAP…) ⇒ 404 y hệt, KHÔNG 403.
//   · Audit ném ⇒ 503 và KHÔNG ký (người ta tải được tệp mà không để lại dấu là thứ ta không chấp nhận).
//   · Chế độ học sinh (cookie `portal_hv`): học phí/hoá đơn là việc của ba mẹ ⇒ 404.
//   · `NextResponse.redirect` mặc định 307 — truyền 302 tường minh.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit/audit-log";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { khoHoaDonDaCauHinh, kyUrlTaiVeHoaDon } from "@/lib/finance/hoa-don/kho-tep";
import { hasAcceptedSitePolicy } from "@/lib/legal/site-policy";
import { docHoaDonDeTai } from "@/lib/portal/hoa-don-phu-huynh";
import { kyUrlXemPdfHoaDon } from "@/lib/portal/hoa-don-phu-huynh-url";
import { tenTepTaiVe } from "@/lib/portal/hoa-don-phu-huynh-thuan";
import { docTepKhoCucBo, thuMucKhoCucBo } from "@/lib/portal/hoa-don-kho-cuc-bo";
import { getPortalContext } from "@/lib/portal/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** URL ký sống 5 phút — đủ để trình duyệt bắt đầu tải, không đủ để thành đường dẫn chia sẻ. */
const TTL_GIAY = 300;

function loi(status: number, thongDiep: string) {
  return NextResponse.json({ error: thongDiep }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ hoaDonId: string }> }) {
  if (!(await laHoaDonBat())) return loi(404, "Không tìm thấy");

  const session = await auth();
  if (!session?.user?.id) return loi(401, "Chưa đăng nhập");
  if (session.user.role !== "PARENT") return loi(404, "Không tìm thấy hoá đơn");

  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return loi(404, "Không tìm thấy hoá đơn");

  // Cùng cổng "Chính sách hoạt động của website" với trang Học phí (`hoc-phi/layout.tsx`): chưa đồng ý ⇒ chưa lấy được tệp.
  if (!(await hasAcceptedSitePolicy(session.user.id))) return loi(403, "Cần đồng ý chính sách hoạt động của website trước khi xem học phí");

  const loai = new URL(req.url).searchParams.get("loai") ?? "pdf";
  if (loai !== "pdf" && loai !== "xml") return loi(400, "Loại tệp không hợp lệ");

  // `xem=1` chỉ có nghĩa với PDF: mở trong tab (inline). Còn lại (và mọi XML) là TẢI VỀ (attachment).
  const xem = loai === "pdf" && new URL(req.url).searchParams.get("xem") === "1";

  const { hoaDonId } = await params;
  // MỌI con của phụ huynh đăng nhập (lấy từ phiên, không từ URL). Danh sách trên trang chỉ lọc theo con đang chọn, nhưng
  // tải thì phụ huynh được lấy hoá đơn của bất kỳ con nào của mình.
  const hd = await docHoaDonDeTai(
    ctx.children.map((c) => c.id),
    hoaDonId,
  );
  if (!hd) return loi(404, "Không tìm thấy hoá đơn");

  const khoa = loai === "pdf" ? hd.tepPdfKey : hd.tepXmlKey;
  if (!khoa) return loi(404, loai === "pdf" ? "Hoá đơn chưa có tệp PDF" : "Hoá đơn không kèm tệp XML");

  // Kho cục bộ chỉ có ở máy dev (tắt cứng ở production) — thay NGUỒN byte, không thay các cổng ở trên/dưới.
  const thuMucCucBo = thuMucKhoCucBo();
  if (!thuMucCucBo && !khoHoaDonDaCauHinh()) return loi(503, "Kho lưu hoá đơn chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ trung tâm.");

  try {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id },
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: hd.id,
      action: "PH_TAI_TEP_HOA_DON",
      // KHÔNG chép khoá tệp hay URL: nhật ký là nơi nhiều người đọc được hơn kho tệp.
      newValues: { loai, cachMo: xem ? "XEM" : "TAI_VE", nguoiTai: "PHU_HUYNH" },
      orgUnitId: hd.orgUnitId,
    });
  } catch (err) {
    console.error("[portal/hoa-don] KHÔNG ghi được AuditLog — từ chối cấp liên kết tải:", err);
    return loi(503, "Chưa tải được hoá đơn lúc này. Vui lòng thử lại.");
  }

  const tenTep = tenTepTaiVe({
    kyHieu: hd.kyHieu,
    soHoaDon: hd.soHoaDon,
    loai,
    tenDaLuu: loai === "pdf" ? hd.tepPdfTen : hd.tepXmlTen,
  });

  if (thuMucCucBo) {
    const byte = await docTepKhoCucBo(thuMucCucBo, khoa);
    if (!byte) return loi(404, "Không thấy tệp trong kho cục bộ");
    return new NextResponse(new Uint8Array(byte), {
      headers: {
        "Content-Type": loai === "pdf" ? "application/pdf" : "application/xml",
        "Content-Disposition": `${xem ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(tenTep)}`,
        "Cache-Control": "no-store",
      },
    });
  }

  let url: string;
  try {
    url = xem ? await kyUrlXemPdfHoaDon(khoa, TTL_GIAY) : await kyUrlTaiVeHoaDon(khoa, tenTep, TTL_GIAY);
  } catch (err) {
    console.error("[portal/hoa-don] ký URL tải thất bại:", err);
    return loi(503, "Kho lưu hoá đơn đang lỗi. Vui lòng thử lại.");
  }
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
