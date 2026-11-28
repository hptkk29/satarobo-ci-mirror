import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { apMaTatCaGioMobile, suaGioSchema, xemGioMobile, xoaGioMobile } from "@/lib/mobile-api/dich-vu/online-gio";

export const dynamic = "force-dynamic";

const soRevision = (req: Request): number | undefined => {
  const v = new URL(req.url).searchParams.get("revision");
  return v !== null && /^\d{1,10}$/.test(v) ? Number(v) : undefined;
};

/** GET /api/mobile/v1/parent/cart — giỏ hàng Online ĐÃ LƯU (không hết hạn): `{revision, dong[], tongTien, giamTong, soDongSanSang, soDong}`; trạng thái SỐNG từng dòng. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await xemGioMobile(nguoi.userId)));
}

/** PATCH /parent/cart { maGiamGia: string|null, revision? } — «Áp mã cho tất cả» (null = gỡ). Chỉ GIỮ mã dạng chữ, không tiêu lượt. */
export async function PATCH(req: Request) {
  return chayChoPhuHuynhCoThan(req, suaGioSchema, async (nguoi, _ctx, than) => traThanhCong(await apMaTatCaGioMobile(nguoi.userId, than)));
}

/** DELETE /parent/cart[?revision=] — xoá hết dòng. */
export async function DELETE(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await xoaGioMobile(nguoi.userId, soRevision(req))));
}
