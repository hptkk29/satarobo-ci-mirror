import { createElement, type ReactElement } from "react";
import { type NextRequest } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { fail } from "@/lib/api/response";
import { withFreshFonts } from "@/lib/pdf/brand";
import { CertificatePdf, type CertificateData } from "@/lib/pdf/certificate";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P8/QtMauCN — XEM THỬ khuôn chứng nhận HIỆN HÀNH bằng dữ liệu MẪU (người giả). Chỉ đọc: không đọc/ghi chứng nhận thật, không ghi gì vào DB.
 *
 * ⚠️ Dùng ĐÚNG `CertificatePdf` mà đường tải thật dùng (không khuôn thứ hai) nên xem thử không thể lệch với bản thật. Dòng hiệu lực ghi rõ
 * "BẢN XEM THỬ" và QR trỏ vào địa chỉ MẪU không tồn tại ⇒ tờ này không thể bị nhầm là chứng nhận thật.
 * Gác: cờ → phiên SỐNG → `elearning:progress:view-all` (cùng quyền xem danh sách chứng nhận).
 */
export async function GET(_req: NextRequest) {
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  const session = await requireLiveSession();
  if (!session?.user?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:progress:view-all")) return fail("PERMISSION_DENIED", "Không có quyền xem mẫu chứng nhận", { status: 403 });

  const verifyUrl = "https://example.invalid/xac-thuc/BAN-XEM-THU";
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 288, errorCorrectionLevel: "M" });
  const d: CertificateData = {
    studentName: "Nguyễn Văn Mẫu",
    studentCode: "NV-MAU",
    courseName: "Tên khoá học (bản xem thử)",
    certificateCode: "SR-XEM-THU",
    completedAt: new Date().toLocaleDateString("vi-VN"),
    finalGrade: null,
    qrDataUrl,
    verifyUrl,
    validityLine: "BẢN XEM THỬ — không có giá trị chứng nhận",
  };
  const buf = await withFreshFonts(() => renderToBuffer(createElement(CertificatePdf, { d }) as unknown as ReactElement<DocumentProps>));
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="mau-chung-nhan-xem-thu.pdf"', "Cache-Control": "private, no-store" },
  });
}
