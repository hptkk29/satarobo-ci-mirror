// app/(admin)/admin/nguon-hoa-hong/campaign/tao/page.tsx — TẠO CAMPAIGN AFFILIATE (AFF-P0b). Trang đầy đủ (không Sheet), khuôn `nguon/tao`.
//
// Bốn trạng thái (DESIGN.md §5): đang tải → `loading.tsx`; lỗi → `error.tsx` của module; không quyền → `NoPermission` nêu TÊN khoá `affiliate_campaigns:manage` + hỏi ai (đúng khoá mà
// `taoCampaignAction` kiểm ở đầu hàm — luật 12). Cờ tắt ⇒ `vaoTab` 404; cổng THẬT của cờ nằm ở action.
// Người chỉ có `affiliate_campaigns:view` KHÔNG vào được biểu mẫu: thấy NoPermission thay vì một form mà bấm Lưu mới biết bị từ chối.
import { CampaignForm } from "@/components/admin/nguon-hoa-hong/campaign/campaign-form";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { NoPermission } from "@/components/admin/ui/states";
import { docLuaChonChoCampaign } from "@/lib/affiliate/doc-campaign";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { vaoTab } from "../../_lib/vao-tab";

export const metadata = { title: "Tạo campaign Affiliate | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const PHU_DE = "Một chương trình giới thiệu: cách ghi nhận khách, nguồn khách và thời hạn. Quy tắc theo loại / nhãn đối tác, website và thành viên thêm ở trang chi tiết sau khi tạo.";

export default async function TaoCampaignPage() {
  const { actor, scope } = await vaoTab("campaign");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/campaign"])) {
    return <ThieuQuyen tab="campaign" scope={scope} soHangCho={{}} />;
  }
  const soHangCho = await docSoHangChoTheoTab(actor, scope);

  if (!scope.has("affiliate_campaigns:manage")) {
    return (
      <KhungModule tab="campaign" scope={scope} soHangCho={soHangCho} tieuDe="Tạo campaign" phuDe={PHU_DE}>
        <NoPermission permission="affiliate_campaigns:manage" what="trang tạo campaign" askWho="Marketing Hội sở hoặc quản trị hệ thống" />
      </KhungModule>
    );
  }

  const luaChon = await docLuaChonChoCampaign(new Date());
  return (
    <KhungModule tab="campaign" scope={scope} soHangCho={soHangCho} tieuDe="Tạo campaign" phuDe={PHU_DE}>
      <CampaignForm cheDo="tao" nguon={luaChon.nguon} />
    </KhungModule>
  );
}
