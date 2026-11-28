import { createElement, type ReactElement } from "react";
import { type NextRequest } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { fail } from "@/lib/api/response";
import { elearningHomeUrl } from "@/lib/auth/hosts";
import { gocXacThuc } from "@/lib/elearning/verify-origin";
import { withFreshFonts } from "@/lib/pdf/brand";
import { CertificatePdf, type CertificateData } from "@/lib/pdf/certificate";
import { CHON_CHUNG_NHAN_XEM, moHinhChungNhan } from "@/lib/elearning/certificate-view";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * EL-16 — TẢI BẢN PDF chứng nhận.
 *
 * ⚠️ Ai được tải: CHÍNH CHỦ, hoặc người có `elearning:progress:view-all`.
 *
 * Không dùng `elearning:certificate:issue` để gác: cấp và ĐỌC là hai việc khác nhau,
 * và người cần tải nhiều nhất là chính người được cấp — họ không có quyền cấp, và
 * không nên có.
 *
 * ⚠️ KHÔNG gác bằng `scopedDb` một mình. Đọc qua `scopedDb` chặn được người cấp cơ
 * sở lấy chứng nhận cơ sở khác, nhưng KHÔNG chặn được đồng nghiệp CÙNG cơ sở tải bản
 * PDF của nhau — mà bản PDF mang tên, mã nhân viên và lịch sử đào tạo của một con
 * người. Vì vậy có thêm phép so `userId` tường minh bên dưới.
 */
export async function GET(req: NextRequest) {
  // Cờ TRƯỚC mọi thao tác khác (kể cả đọc phiên) — đặc tả §4.8; lưới tests/elearning/api-gate.test.ts.
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  // Bản PDF mang tên + mã nhân viên và rời hệ thống ngay khi tải ⇒ phiên phải còn SỐNG so với
  // DB (SEC-M11), như export Excel R1 — không chỉ tin JWT còn hạn.
  const session = await requireLiveSession();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }
  const actor = await resolveActor(session.user.id);

  const certId = new URL(req.url).searchParams.get("id");
  if (!certId) return fail("VALIDATION", "Thiếu ?id=", { field: "id" });

  const sdb = scopedDb(actor);
  const cn = await sdb.trnCertificate.findFirst({
    where: { id: certId },
    select: CHON_CHUNG_NHAN_XEM,
  });
  if (!cn) return fail("NOT_FOUND", "Không tìm thấy chứng nhận", { status: 404 });

  const laChinhChu = cn.userId === session.user.id;
  if (!laChinhChu && !can(actor, "elearning:progress:view-all")) {
    return fail("PERMISSION_DENIED", "Chỉ chính chủ hoặc phòng Đào tạo tải được", {
      status: 403,
    });
  }

  const khoa = await sdb.trnCourse.findFirst({
    where: { id: cn.courseId },
    select: { title: true },
  });

  // Địa chỉ tra cứu — cùng một chỗ với trang xác minh công khai.
  // Gốc theo MÔI TRƯỜNG (`ELEARNING_VERIFY_ORIGIN`): QR phát từ TEST phải trỏ về TEST — xem lib/elearning/verify-origin.ts.
  const verifyUrl = `${gocXacThuc(elearningHomeUrl())}/xac-thuc/${cn.verifyToken}`;

  // QR sinh TẠI ĐÂY, không lưu sẵn: nó suy hoàn toàn từ `verifyToken`, nên lưu thêm
  // một bản ảnh chỉ tạo ra một thứ nữa có thể lệch với sự thật.
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 0,
    width: 288,
    errorCorrectionLevel: "M",
  });

  // Cùng MỘT mô hình với trang xem chứng nhận (`certificate-view.ts`) — trang xem và bản PDF không thể lệch nhau.
  const mh = moHinhChungNhan(cn, khoa?.title ?? null, new Date());

  const d: CertificateData = {
    studentName: mh.studentName,
    studentCode: mh.studentCode,
    courseName: mh.courseName,
    certificateCode: mh.certificateCode,
    completedAt: mh.completedAt,
    finalGrade: null,
    qrDataUrl,
    verifyUrl,
    // ⚠️ In luôn tình trạng hiệu lực lên tờ giấy, kể cả khi đã hết hạn hoặc bị thu
    // hồi. Bản PDF là ảnh chụp một thời điểm và sẽ được in ra rồi cất đi; im lặng ở
    // dòng này là để một tờ giấy hết hiệu lực trông y hệt tờ còn hiệu lực.
    validityLine: mh.validityLine,
  };

  const buf = await withFreshFonts(() =>
    renderToBuffer(
      createElement(CertificatePdf, { d }) as unknown as ReactElement<DocumentProps>,
    ),
  );

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${cn.certCode}.pdf"`,
      // Chứng nhận có thể bị thu hồi bất cứ lúc nào — không để proxy nào giữ lại một
      // bản cũ nói rằng nó còn hiệu lực.
      "Cache-Control": "private, no-store",
    },
  });
}
