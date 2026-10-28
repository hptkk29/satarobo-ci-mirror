// GET /payments/hoa-don/<hoaDonId>/tai-ve?loai=pdf|xml — tải tệp hoá đơn điện tử.
// (docs/ke-toan-hoa-don/PLAN.md §6 + §8; trình duyệt gọi URL gọn trên admin host, proxy viết lại
// sang /admin/payments/... — tiền lệ `payments/[id]/phieu-thu`.)
//
// Ai tải được bản nào:
//   · KẾ TOÁN của cơ sở giữ đơn — `payments:confirm` VÀ cơ sở nằm trong tập cơ sở của ĐÚNG quyền đó
//     (`coQuyenKeToanTaiCoSo`) — tải MỌI bản (nháp để soát, bản bị thay để đối chiếu).
//   · Người có `orders:view-pii` (sale, QLCS…) — CHỈ bản DA_XAC_NHAN. Bản nháp có thể sai, bản đã bị
//     thay là tờ sai; sale gửi tay qua Zalo thì không thu về được.
//   · Bản khác / không thấy ⇒ 404, KHÔNG 403 — không lộ sự tồn tại.
//
// Thứ tự: cờ → đăng nhập → quyền → scopedDb (khác cơ sở ⇒ null) → luật bản → kho đã cấu hình →
// AUDIT → ký GET 300 giây → redirect 302 no-store. Audit ném ⇒ 503 và KHÔNG ký (khuôn
// `lib/calls/nghe-ghi-am.ts` — OmiCall, đã gỡ 06/10/2026). `NextResponse.redirect` mặc định 307 — truyền 302 tường minh.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { coQuyenKeToanTaiCoSo, duocTaiBanHoaDon } from "@/lib/finance/hoa-don/quyen";
import { khoHoaDonDaCauHinh, kyUrlTaiVeHoaDon } from "@/lib/finance/hoa-don/kho-tep";

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
  if (!session?.user) return loi(401, "Chưa đăng nhập");

  const [keToan, xemPii] = await Promise.all([
    checkPermission("payments:confirm"),
    checkPermission("orders:view-pii"),
  ]);
  if (!keToan && !xemPii) return loi(403, "Không có quyền tải hoá đơn");

  const loai = new URL(req.url).searchParams.get("loai") ?? "pdf";
  if (loai !== "pdf" && loai !== "xml") return loi(400, "Loại tệp không hợp lệ");

  const { hoaDonId } = await params;
  const actor = await resolveActor(session.user.id);
  // HoaDonDienTu ∈ SCOPED_MODELS ⇒ findUnique lọc hậu kỳ bằng passesScope (khác cơ sở ⇒ null).
  const hd = await scopedDb(actor).hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: {
      id: true,
      orderId: true,
      centerId: true,
      orgUnitId: true,
      trangThai: true,
      kyHieu: true,
      soHoaDon: true,
      tepPdfKey: true,
      tepPdfTen: true,
      tepXmlKey: true,
      tepXmlTen: true,
    },
  });
  if (!hd) return loi(404, "Không tìm thấy hoá đơn");

  // Luật dùng chung với nút tải trên trang chi tiết đơn (GĐ 7) — đừng viết lại điều kiện tại đây.
  const keToanCoSo = keToan && coQuyenKeToanTaiCoSo(actor, hd.centerId);
  if (!duocTaiBanHoaDon({ keToanCoSo, xemPii, trangThai: hd.trangThai })) {
    return loi(404, "Không tìm thấy hoá đơn");
  }

  const khoa = loai === "pdf" ? hd.tepPdfKey : hd.tepXmlKey;
  if (!khoa) return loi(404, loai === "pdf" ? "Hoá đơn chưa có tệp PDF" : "Hoá đơn không kèm tệp XML");

  if (!khoHoaDonDaCauHinh()) return loi(503, "Kho lưu hoá đơn chưa cấu hình — báo người vận hành");

  try {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id },
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: hd.id,
      action: "TAI_TEP_HOA_DON",
      // KHÔNG chép khoá tệp hay URL: nhật ký là nơi nhiều người đọc được hơn kho tệp.
      newValues: { loai, trangThai: hd.trangThai, orderId: hd.orderId },
      orgUnitId: hd.orgUnitId,
    });
  } catch (err) {
    console.error("[hoa-don] KHÔNG ghi được AuditLog — từ chối cấp liên kết tải:", err);
    return loi(503, "Không ghi được nhật ký nên chưa tải được hoá đơn. Vui lòng thử lại.");
  }

  const tenTep =
    hd.kyHieu && hd.soHoaDon
      ? `hoa-don-${hd.kyHieu}-${hd.soHoaDon}.${loai}`
      : ((loai === "pdf" ? hd.tepPdfTen : hd.tepXmlTen) ?? `hoa-don.${loai}`);

  let url: string;
  try {
    url = await kyUrlTaiVeHoaDon(khoa, tenTep, TTL_GIAY);
  } catch (err) {
    console.error("[hoa-don] ký URL tải thất bại:", err);
    return loi(503, "Kho lưu hoá đơn đang lỗi. Vui lòng thử lại.");
  }
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
