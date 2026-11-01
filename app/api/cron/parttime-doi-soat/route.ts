// app/api/cron/parttime-doi-soat/route.ts — đối soát định kỳ phân công Parttime (G1, 24/10/2026).
// Vỏ mỏng: xác thực cron rồi gọi `doiSoatDongBo` (lib/parttime/doi-soat-dong-bo.ts) cho [hôm nay, +21 ngày]. Bộ đồng bộ idempotent —
// nguồn đã đúng thì không ghi gì; cơ sở chưa bật phân công thì chỉ huỷ phân công mồ côi.
// ⚠️ KHÔNG nhận `?now=` / `?soNgay=`: endpoint chạy thật — mở tham số ra query là cho người gọi tự chọn khoảng (kể cả lùi về quá khứ).
import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { doiSoatDongBo, SO_NGAY_DOI_SOAT } from "@/lib/parttime/doi-soat-dong-bo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const kq = await doiSoatDongBo({ now: new Date(), soNgay: SO_NGAY_DOI_SOAT, actor: { id: null, name: "Hệ thống — đối soát phân công định kỳ" } });
  return NextResponse.json({ ok: kq.loi.length === 0, tu: kq.tu, den: kq.den, soNguon: kq.soNguon, soBuoc: kq.soBuoc, soLoi: kq.loi.length, ngoaiLe: kq.ngoaiLe });
}
