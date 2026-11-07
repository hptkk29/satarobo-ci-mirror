/**
 * GET /api/disc/dia-chi[?thanhPho=<tên>] — danh mục địa chỉ cho bước «Lưu» của DISC (05/11/2026).
 *
 *  → 200 { ok:true, thanhPho:[tên…], macDinh:"Tp Đà Nẵng", phuong:[tên…] của `thanhPho` (mặc định = thành phố mặc định) }.
 *  - cờ DISC_ENABLED tắt ⇒ 404 rỗng TRƯỚC mọi việc khác (như `/api/disc/bo-de`);
 *  - `thanhPho` lạ ⇒ 400 (không đoán);
 *  - DỮ LIỆU CÔNG KHAI, KHÔNG chứa thông tin cá nhân (danh mục hành chính từ gói `vietnam-address-data`) ⇒ cho phép đệm phía trình duyệt/CDN;
 *  - không đọc DB, không đọc body, không log gì.
 *
 * Vì sao là API chứ không nhúng danh mục vào JS của trang: gói ≈ 420 KB / 3.321 phường-xã của 34 tỉnh, trong khi một người chỉ cần ~100 dòng của
 * MỘT thành phố. Trang công khai có ngân sách LCP/CLS (CLAUDE.md) — mỗi lần đổi thành phố chỉ tải thêm ~1–5 KB.
 */
import { NextResponse } from "next/server";
import { danhSachPhuongCuaTinh, danhSachTinh, idTinhTheoTen, TP_MAC_DINH } from "@/lib/lead/phuong-xa";
import { isDiscEnabled } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEM_CONG_KHAI = { "Cache-Control": "public, max-age=3600, s-maxage=86400" } as const;

export async function GET(req: Request) {
  if (!isDiscEnabled()) return new NextResponse(null, { status: 404 });
  const yeuCau = new URL(req.url).searchParams.get("thanhPho");
  const thanhPho = yeuCau === null || yeuCau === "" ? TP_MAC_DINH : yeuCau;
  const tinhId = idTinhTheoTen(thanhPho);
  if (!tinhId) return NextResponse.json({ ok: false, loi: "THANH_PHO_KHONG_HOP_LE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { ok: true, thanhPho: danhSachTinh().map((t) => t.name), macDinh: TP_MAC_DINH, phuong: danhSachPhuongCuaTinh(tinhId) },
    { status: 200, headers: DEM_CONG_KHAI },
  );
}
