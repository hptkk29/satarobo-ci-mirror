import { chayChoPhuHuynhCoThan, motMobileTat, traThanhCong } from "@/lib/mobile-api/cong";
import { danhGiaSucKhoe, danhGiaSucKhoeSchema, motSucKhoeTat } from "@/lib/mobile-api/dich-vu/suc-khoe";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/parent/health/evaluate { nguoi:[{ ma, ngaySinh, gioiTinh, hoatDong?, mangThaiHoacChoConBu?, benhNen?, soDo:[{ngay,chieuCaoCm,canNangKg,vongEoCm?}] }] } — tính THUẦN (BMI, phân loại, khuôn, năng lượng ước tính).
 * KHÔNG LƯU, KHÔNG GHI LOG, KHÔNG tạo dòng nào, không nhận tên / câu trả lời khảo sát. ⚠️ Chưa được chủ dự án duyệt việc gửi số đo lên máy chủ (quyết định 08/11: sổ ở lại trên máy) — xem SUC-KHOE-API-V823.md.
 * Cờ `SUC_KHOE_ENABLED` TẮT ⇒ 404 TRƯỚC khi đọc thân. Chế độ học sinh ⇒ 403. Thân ≤ 256 KB (413), lược đồ strict (400).
 */
export async function POST(req: Request) {
  const tat = motMobileTat() ?? motSucKhoeTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, danhGiaSucKhoeSchema, async (_nguoi, _ctx, than) => traThanhCong(danhGiaSucKhoe(than)));
}
