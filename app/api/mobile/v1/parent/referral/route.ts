import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { docGioiThieu } from "@/lib/mobile-api/dich-vu/gioi-thieu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/referral — «Giới thiệu bạn bè» của phụ huynh là ĐỐI TÁC Affiliate: link/QR, lượt bấm, số referral (không PII khách), hoa hồng (chỉ khi chương trình cho phép hiện tiền). Chỉ ĐỌC từ sổ web; không phải đối tác / cờ tắt ⇒ 404; chế độ học sinh ⇒ 403. */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await docGioiThieu(nguoi)));
}
