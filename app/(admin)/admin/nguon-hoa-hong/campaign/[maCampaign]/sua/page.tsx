// app/(admin)/admin/nguon-hoa-hong/campaign/[maCampaign]/sua/page.tsx — SỬA CAMPAIGN AFFILIATE (AFF-P0b). Trang đầy đủ, khuôn `nguon/[maNguon]/sua`.
//
// Cổng: `vaoTab("campaign")` → `PAGE_GATES` (xem) → quyền SỬA `affiliate_campaigns:manage` (đúng khoá mà `suaCampaignAction` kiểm ở đầu hàm — luật 12; người chỉ xem thấy NoPermission thay vì form
// bấm Lưu mới biết bị từ chối) → mã hỏng / không có campaign ⇒ 404. Campaign ĐÃ KẾT THÚC không có form: nói thẳng, kèm đường về chi tiết.
// Campaign ĐANG CHẠY có form nhưng các ô ảnh hưởng ghi nhận bị khoá kèm lý do (xem `CampaignForm` + `lyDoKhoaTruong`).
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignForm } from "@/components/admin/nguon-hoa-hong/campaign/campaign-form";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { BTN_OUTLINE } from "@/components/admin/nguon-hoa-hong/classes";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { docChiTietCampaign, docLuaChonChoCampaign } from "@/lib/affiliate/doc-campaign";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { giaiMaTrenUrl } from "@/lib/nguon-hoa-hong/url";
import { vaoTab } from "../../../_lib/vao-tab";

export const metadata = { title: "Sửa campaign Affiliate | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SuaCampaignPage({ params }: { params: Promise<{ maCampaign: string }> }) {
  const { actor, scope } = await vaoTab("campaign");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/campaign"])) {
    return <ThieuQuyen tab="campaign" scope={scope} soHangCho={{}} />;
  }
  const { maCampaign } = await params;
  const ma = giaiMaTrenUrl(maCampaign);
  if (ma === null) notFound();
  const now = new Date();

  const [campaign, luaChon, soHangCho] = await Promise.all([docChiTietCampaign(ma, now), docLuaChonChoCampaign(now), docSoHangChoTheoTab(actor, scope)]);
  if (!campaign) notFound();

  const goc = `/nguon-hoa-hong/campaign/${encodeURIComponent(campaign.code)}`;
  const tieuDe = `Sửa: ${campaign.name}`;

  if (!scope.has("affiliate_campaigns:manage")) {
    return (
      <KhungModule tab="campaign" scope={scope} soHangCho={soHangCho} tieuDe={tieuDe}>
        <NoPermission permission="affiliate_campaigns:manage" what="trang sửa campaign" askWho="Marketing Hội sở hoặc quản trị hệ thống" />
      </KhungModule>
    );
  }
  if (campaign.status === "ENDED") {
    return (
      <KhungModule tab="campaign" scope={scope} soHangCho={soHangCho} tieuDe={tieuDe}>
        <EmptyState
          title="Campaign đã kết thúc"
          description="Campaign đã kết thúc không sửa được nữa. Muốn chạy chương trình tương tự, tạo campaign mới."
          action={
            <Link href={goc} className={BTN_OUTLINE}>
              Về chi tiết campaign
            </Link>
          }
        />
      </KhungModule>
    );
  }

  const mac = campaign.nguonMacDinh;
  return (
    <KhungModule tab="campaign" scope={scope} soHangCho={soHangCho} tieuDe={tieuDe} phuDe={`Mã ${campaign.code} — mã không đổi được.`}>
      <CampaignForm
        cheDo="sua"
        campaign={{
          id: campaign.id,
          code: campaign.code,
          status: campaign.status,
          capNhatLuc: campaign.capNhatLuc,
          name: campaign.name,
          description: campaign.description,
          attributionModel: campaign.attributionModel,
          cookieWindowDays: campaign.cookieWindowDays,
          protectWindowDays: campaign.protectWindowDays,
          allowSelfReferral: campaign.allowSelfReferral,
          partnerCanViewAmount: campaign.partnerCanViewAmount,
          defaultSourceGroupId: campaign.defaultSourceGroupId,
          effectiveFrom: campaign.effectiveFrom,
          effectiveTo: campaign.effectiveTo,
        }}
        nguon={luaChon.nguon}
        nguonMacDinhHong={mac && !mac.chonDuoc ? { id: mac.id, ten: mac.ten, lyDo: `Nguồn «${mac.ten}» hiện không dùng được. Chọn nguồn khác, hoặc giữ nguyên nếu bạn sẽ kích hoạt lại nguồn đó.` } : null}
      />
    </KhungModule>
  );
}
