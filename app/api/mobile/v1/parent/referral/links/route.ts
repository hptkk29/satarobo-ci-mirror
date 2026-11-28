import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { taoLinkDoiTac, taoLinkSchema } from "@/lib/mobile-api/dich-vu/gioi-thieu";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/referral/links { membershipId, siteId, landingPath, landingPageId?, label? } — đối tác tự tạo link (lõi `tuTaoLink` của web: hạn mức/cổng chuỗi/nhật ký). Trường lạ ⇒ 400 (strict). */
export async function POST(req: Request) {
  return chayDaDangNhapCoThan(req, taoLinkSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await taoLinkDoiTac(nguoi, thanDl)));
}
