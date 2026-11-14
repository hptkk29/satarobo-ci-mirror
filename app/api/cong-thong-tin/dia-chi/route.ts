/**
 * GET /api/cong-thong-tin/dia-chi[?thanhPho=<tên>] — danh mục tỉnh/phường cho hộp «để lại thông tin» (Tủ sách + Sức khỏe, 07/11/2026).
 *
 *  → 200 { ok:true, thanhPho:[tên…], macDinh:"Tp Đà Nẵng", phuong:[tên…] của `thanhPho` }.
 *  - cả hai cờ tắt ⇒ 404 rỗng; `thanhPho` lạ ⇒ 400 (không đoán);
 *  - DỮ LIỆU CÔNG KHAI (danh mục hành chính), không đọc DB/body, không log ⇒ cho đệm phía trình duyệt/CDN.
 * Cùng nguồn `lib/lead/phuong-xa.ts` với biểu mẫu DISC; khác `/api/disc/dia-chi` ở chỗ KHÔNG gắn với cờ DISC.
 */
import { NextResponse } from "next/server";
import { danhSachPhuongCuaTinh, danhSachTinh, idTinhTheoTen, TP_MAC_DINH } from "@/lib/lead/phuong-xa";
import { isCongThongTinEnabled } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEM_CONG_KHAI = { "Cache-Control": "public, max-age=3600, s-maxage=86400" } as const;

export async function GET(req: Request) {
  if (!isCongThongTinEnabled()) return new NextResponse(null, { status: 404 });
  const yeuCau = new URL(req.url).searchParams.get("thanhPho");
  const thanhPho = yeuCau === null || yeuCau === "" ? TP_MAC_DINH : yeuCau;
  const tinhId = idTinhTheoTen(thanhPho);
  if (!tinhId) return NextResponse.json({ ok: false, loi: "THANH_PHO_KHONG_HOP_LE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { ok: true, thanhPho: danhSachTinh().map((t) => t.name), macDinh: TP_MAC_DINH, phuong: danhSachPhuongCuaTinh(tinhId) },
    { status: 200, headers: DEM_CONG_KHAI },
  );
}
