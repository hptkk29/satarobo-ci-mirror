import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { laySachGiaoKhoa, sachGiaoKhoaQuery } from "@/lib/mobile-api/dich-vu/tu-sach";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/library/textbooks?grade=1..12 — sách giáo khoa: liên kết «đọc trực tuyến» của NXB Giáo dục (không lưu tệp). Không có `grade` ⇒ toàn bộ. Cờ TU_SACH_ENABLED TẮT ⇒ 404. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => {
    const u = new URL(req.url);
    const p = sachGiaoKhoaQuery.safeParse({ grade: u.searchParams.get("grade") ?? undefined });
    if (!p.success) throw new LoiApiMobile("VALIDATION", 400, p.error.issues[0]?.message || "Tham số không hợp lệ.");
    return traThanhCong(await laySachGiaoKhoa(nguoi, p.data));
  });
}
