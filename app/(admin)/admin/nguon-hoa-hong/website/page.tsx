// app/(admin)/admin/nguon-hoa-hong/website/page.tsx — tab "Website & trang đích" (AFF-P0b, docs/source-commission/12).
//
// Danh sách WEBSITE được phép gắn link giới thiệu + TRANG ĐÍCH của từng website (Sheet) + «Thử một địa chỉ». Người dùng Affiliate (P1) chỉ chọn trong danh sách này — không tự nhập URL tuỳ ý;
// phép kiểm ở `lib/affiliate/website-hop-le.ts` là cổng chặn open-redirect / link giả mạo, màn này chỉ là nơi Admin khai và thử nó.
//
// Cờ (`affiliate.enabled` ∧ `nguon.enabled`) đã được `vaoTab` gác (404 khi tắt); quyền XEM = `PAGE_GATES`; quyền GHI = `affiliate_campaigns:manage` ∧ cờ — ĐÚNG hai điều kiện mà các Server Action ở
// `_actions.ts` kiểm ở đầu hàm, nên nút ghi chỉ vẽ khi máy chủ sẽ nhận (luật 12). Hai câu truy vấn (số hàng chờ của pill · danh sách website) chạy SONG SONG, không nối đuôi.
import { Globe } from "lucide-react";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { BangWebsite } from "@/components/admin/nguon-hoa-hong/website/bang-website";
import { NutThemWebsite } from "@/components/admin/nguon-hoa-hong/website/form-website";
import { EmptyState } from "@/components/admin/ui/states";
import { docWebsite } from "@/lib/affiliate/doc-website";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";

import { vaoTab } from "../_lib/vao-tab";

export const metadata = { title: "Website & trang đích | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const { actor, scope } = await vaoTab("website");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/website"])) {
    return <ThieuQuyen tab="website" scope={scope} soHangCho={{}} />;
  }
  // Quyền GHI = đúng hai điều kiện của Server Action: khoá `affiliate_campaigns:manage` ∧ cờ Affiliate.
  const coTheGhi = scope.has("affiliate_campaigns:manage") && scope.co.affiliate;
  const [soHangCho, du] = await Promise.all([docSoHangChoTheoTab(actor, scope), docWebsite()]);

  return (
    <KhungModule tab="website" scope={scope} soHangCho={soHangCho} actions={coTheGhi ? <NutThemWebsite campaignChon={du.campaignChon} /> : undefined}>
      {du.dong.length === 0 ? (
        <EmptyState
          title="Chưa có website nào"
          description={
            coTheGhi
              ? "Bấm «Thêm website» để khai website đối tác đầu tiên (ví dụ quatang.edu.vn) rồi các trang đích được phép. Chưa có website thì chưa ai tạo được link giới thiệu."
              : "Chưa có website nào được khai. Nhờ người có quyền quản lý website thêm giúp."
          }
        />
      ) : (
        <BangWebsite dong={du.dong} campaignChon={du.campaignChon} coTheGhi={coTheGhi} />
      )}
      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Globe aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Tên miền khớp chính xác, không tính tên miền con. Link giới thiệu chỉ trỏ được tới website ĐANG HOẠT ĐỘNG, đang bật theo dõi và tới đường dẫn khớp một trang đích đang bật. Bấm một dòng để xem trang đích và thử một địa chỉ.
        </span>
      </p>
    </KhungModule>
  );
}
