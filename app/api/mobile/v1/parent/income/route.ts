import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { layThuNhap, thuNhapQuery } from "@/lib/mobile-api/dich-vu/thu-nhap";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/income?q=&tt= — «Thu nhập thêm»: khách phụ huynh này mang về (SĐT che) + số chốt + tỉ lệ. Cờ THU_NHAP_THEM_ENABLED TẮT ⇒ 404. Không theo học viên. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => {
    const u = new URL(req.url);
    const p = thuNhapQuery.safeParse({ q: u.searchParams.get("q") ?? undefined, tt: u.searchParams.get("tt") ?? undefined });
    if (!p.success) throw new LoiApiMobile("VALIDATION", 400, "Tham số tìm kiếm không hợp lệ.");
    return traThanhCong(await layThuNhap(nguoi.userId, p.data));
  });
}
