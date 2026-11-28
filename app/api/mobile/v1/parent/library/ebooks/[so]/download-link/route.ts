import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { lienKetTaiEbook, lienKetTaiEbookSchema } from "@/lib/mobile-api/dich-vu/tu-sach";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/library/ebooks/:so/download-link {} — cấp URL KÝ 300 giây tới PDF ở bucket R2 RIÊNG (ép tải về); AuditLog TRƯỚC khi ký. Cờ tắt / không có cuốn / tệp chưa nhập ⇒ 404; chưa đủ điều kiện tải (hồ sơ thiếu phường/xã) ⇒ 403; kho lỗi ⇒ 503. */
export async function POST(req: Request, ctx: { params: Promise<{ so: string }> }) {
  const { so } = await ctx.params;
  return chayChoPhuHuynhCoThan(req, lienKetTaiEbookSchema, async (nguoi) => traThanhCong(await lienKetTaiEbook(nguoi, so)));
}
