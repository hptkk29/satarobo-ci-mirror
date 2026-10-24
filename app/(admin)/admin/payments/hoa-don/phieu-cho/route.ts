// Bản CHỜ XÁC NHẬN của phiếu thu — docs/ke-toan-hoa-don/PLAN.md §4 bước ②.
//
// Kế toán tải NGAY khi tiền về, trước khi có số RCP, để sang MISA làm hoá đơn. Một lần thu phủ nhiều
// khoản (vd hai con) ⇒ MỘT tệp, mỗi khoản một trang.
//
//   GET ?don=<orderId>&chon=<lanThuKey>
//
// ⚠️ Server KHÔNG nhận danh sách khoản từ client: tập khoản + số RÒNG dựng lại bằng CHÍNH loader
// của màn (`napHangChoHoaDon` thu hẹp theo đơn), rồi khớp khoá dòng. Nhận `?khoan=a,b` là để người
// gõ URL in phiếu cho khoản của đơn khác / số tiền đã đảo.
// ⚠️ Không phải kế toán của cơ sở giữ đơn ⇒ 404, KHÔNG 403 (không lộ sự tồn tại — cùng luật với
// route tải tệp hoá đơn).
// ⚠️ Audit TRƯỚC khi dựng PDF, kèm dấu người mua (`bamNguoiMua`): bước lưu nháp đọc lại dấu này để
// cảnh báo khi thông tin người mua bị sửa trong lúc kế toán làm hoá đơn ở MISA. Audit lỗi ⇒ 503.
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { withFreshFonts } from "@/lib/pdf/brand";
import { PhieuThuNhieuTrangPdf } from "@/lib/pdf/phieu-thu";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { QUYEN_KE_TOAN_HOA_DON } from "@/lib/finance/hoa-don/quyen";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { gopTuKhoa } from "@/lib/finance/hoa-don/lan-thu";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { bamNguoiMua } from "@/lib/finance/hoa-don/bam-nguoi-mua";
import { napTrangPhieuCho } from "@/lib/finance/hoa-don/trang-phieu-cho";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const loi = (status: number, error: string) => NextResponse.json({ error }, { status, headers: KHONG_LUU });

function tenTepAnToan(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export async function GET(req: Request) {
  if (!(await laHoaDonBat())) return loi(404, "Không tìm thấy");
  const session = await auth();
  if (!session?.user) return loi(401, "Chưa đăng nhập");
  if (!(await checkPermission(QUYEN_KE_TOAN_HOA_DON))) return loi(403, "Không có quyền");

  const url = new URL(req.url);
  const orderId = url.searchParams.get("don")?.trim() ?? "";
  const chon = url.searchParams.get("chon")?.trim() ?? "";
  if (!orderId || !chon || orderId.length > 64 || chon.length > 512) return loi(400, "Thiếu đơn hoặc lần thu");

  const actor = await resolveActor(session.user.id);
  // Q2 — dòng GỘP: tập gộp đọc từ CHÍNH khoá (`gopTuKhoa`), cùng đường với action lưu nháp.
  const { dong } = await napHangChoHoaDon(actor, { canViewPii: true, orderId, gop: gopTuKhoa(chon) });
  const row = dong.find((d) => d.key === chon && d.orderId === orderId);
  // `taiPhieu` = kế toán ĐÚNG cơ sở của đơn (luật ở `hanhDongChoDong`, một chỗ).
  if (!row || !row.hanhDong.taiPhieu || row.khoan.length === 0) return loi(404, "Không tìm thấy lần thu");

  // Nạp + dựng trang: CÙNG hàm với "Phát hành qua MISA" (lib/finance/hoa-don/trang-phieu-cho.ts) — tờ MISA
  // hệ thống tự phát hành nói đúng những gì tờ này in.
  const nap = await napTrangPhieuCho(actor, row);
  if (!nap.ok) return loi(nap.status, nap.error);
  const { trang, khoiDon } = nap;

  try {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id },
      module: "finance",
      entityType: "Order",
      entityId: orderId,
      action: "TAI_PHIEU_CHO",
      newValues: {
        lanThuKey: row.key,
        khoanIds: row.khoanIds,
        soTien: row.soTien,
        nguoiMuaHash: bamNguoiMua(nguoiMuaChoDon(khoiDon)),
      },
    });
  } catch {
    return loi(503, "Không ghi được nhật ký — thử lại sau");
  }

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(createElement(PhieuThuNhieuTrangPdf, { trang }) as unknown as ReactElement<DocumentProps>),
    );
  } catch (err) {
    return loi(500, `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}`);
  }

  const tenTep = `PhieuThu-CHO-${tenTepAnToan(khoiDon.code)}-${row.ngayThu}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${tenTep}"`,
      ...KHONG_LUU,
    },
  });
}
