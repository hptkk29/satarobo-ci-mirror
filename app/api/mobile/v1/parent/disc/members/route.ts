import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, docThanhVien, luuThanhVienSo, thanhVienBody } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/disc/members — P-Disc-gia-dinh («Thành viên và quyền xem»): thành viên của sổ + bộ đề khả dụng + quan hệ từng cặp + học viên chưa nối. */
export async function GET(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docThanhVien(nguoi)));
}

/** POST /api/mobile/v1/parent/disc/members — thêm thành viên (không có `id`) hoặc sửa (có `id` của sổ này). Nối học viên: domain tự kiểm học viên thuộc tài khoản này. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, thanhVienBody, async (nguoi, _ctx, than) => traThanhCong(await luuThanhVienSo(nguoi, than)));
}
