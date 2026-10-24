// app/(admin)/admin/nguon-hoa-hong/campaign/page.tsx — tab CAMPAIGN AFFILIATE (AFF-P0b, docs/source-commission/12): danh sách chương trình giới thiệu + lọc theo trạng thái trên URL.
//
// Mở ra ở DANH SÁCH (bảng dày, phân trang phía server): Tên/Mã · Trạng thái · Mô hình ghi nhận · Hiệu lực · Số đối tác đang tham gia · Số website. Mỗi dòng mở trang chi tiết
// (`campaign/[maCampaign]`) — nơi cấu hình quy nguồn, website, thành viên và kích hoạt.
//
// Campaign là danh mục TOÀN HỆ (Hội sở sở hữu, không `centerId`): không có ScopeBar theo cơ sở. Cách ly nằm ở cổng quyền:
//   · xem: `affiliate_campaigns:view` (PAGE_GATES) · nút «Tạo campaign»: `affiliate_campaigns:manage` — ĐÚNG khoá mà `taoCampaignAction` kiểm ở đầu hàm (luật 12).
// Cờ `affiliate.enabled` ∧ `nguon.enabled` tắt ⇒ `vaoTab` 404 (đứng TRƯỚC câu hỏi quyền).
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { BTN_PRIMARY, CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { EmptyState } from "@/components/admin/ui/states";
import { docDanhSachCampaign } from "@/lib/affiliate/doc-campaign";
import { NHAN_TRANG_THAI_CAMPAIGN, TRANG_THAI_CAMPAIGN } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { docTrang, hrefVoi, kepTrang, motGiaTri } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";
import { vaoTab } from "../_lib/vao-tab";
import { BangCampaign } from "./_components/bang-campaign";

export const metadata = { title: "Campaign Affiliate | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/nguon-hoa-hong/campaign";
const KICH_THUOC_TRANG = 25;

type Sp = { trangthai?: string | string[]; trang?: string | string[] };

export default async function CampaignPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor, scope } = await vaoTab("campaign");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/campaign"])) {
    return <ThieuQuyen tab="campaign" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  // Bộ lọc nhận giá trị ĐÃ CHUẨN HOÁ qua bảng trạng thái — không nhận chuỗi URL thô vào truy vấn.
  const trangThai = TRANG_THAI_CAMPAIGN.find((t) => t === motGiaTri(sp.trangthai)) ?? null;
  const trang = docTrang(sp.trang);
  const now = new Date();

  const [danhSach, soHangCho] = await Promise.all([docDanhSachCampaign({ trangThai, trang, kichThuoc: KICH_THUOC_TRANG }), docSoHangChoTheoTab(actor, scope)]);

  // Danh sách co lại khi lọc: F5 / bookmark ở trang cuối rơi quá biên là chuyện thật. Về trang cuối thay vì vẽ bảng rỗng kèm «Hiển thị 26–10 / 10».
  const trangHopLe = kepTrang(trang, danhSach.tong, danhSach.kichThuoc);
  if (danhSach.tong > 0 && trangHopLe !== trang) redirect(hrefVoi(BASE, { trangthai: trangThai, trang: trangHopLe }));

  const coTheTao = scope.has("affiliate_campaigns:manage");
  const tatCa = TRANG_THAI_CAMPAIGN.reduce((n, t) => n + danhSach.demTheoTrangThai[t], 0);
  const nutTao = coTheTao ? (
    <Link href="/nguon-hoa-hong/campaign/tao" className={BTN_PRIMARY}>
      <Plus aria-hidden className="h-4 w-4" />
      Tạo campaign
    </Link>
  ) : undefined;

  return (
    <KhungModule tab="campaign" scope={scope} soHangCho={soHangCho} actions={nutTao}>
      <nav aria-label="Lọc theo trạng thái campaign" className="mb-4 flex w-full items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
        <Link href={BASE} aria-current={trangThai === null ? "page" : undefined} className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}>
          Tất cả ({tatCa})
        </Link>
        {TRANG_THAI_CAMPAIGN.map((t) => (
          <Link key={t} href={hrefVoi(BASE, { trangthai: t })} aria-current={trangThai === t ? "page" : undefined} className={cn(CHIP, trangThai === t ? CHIP_ACTIVE : CHIP_IDLE)}>
            {NHAN_TRANG_THAI_CAMPAIGN[t]} ({danhSach.demTheoTrangThai[t]})
          </Link>
        ))}
      </nav>

      {danhSach.dong.length === 0 ? (
        trangThai ? (
          <EmptyState
            title={`Không có campaign nào “${NHAN_TRANG_THAI_CAMPAIGN[trangThai]}”`}
            description="Bỏ bộ lọc trạng thái để xem toàn bộ campaign."
            action={
              <Link href={BASE} className="text-sm font-medium text-primary-ink hover:underline">
                Bỏ bộ lọc
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Chưa có campaign nào"
            description={coTheTao ? "Tạo campaign đầu tiên để đối tác có chương trình giới thiệu để tham gia. Campaign mới ở trạng thái Nháp — chưa ghi nhận khách cho tới khi kích hoạt." : "Chưa có campaign nào. Nhờ quản trị viên có quyền quản lý campaign tạo giúp."}
            action={nutTao}
          />
        )
      ) : (
        <BangCampaign dong={danhSach.dong} tong={danhSach.tong} trang={danhSach.trang} kichThuoc={danhSach.kichThuoc} hrefTrang={(t) => hrefVoi(BASE, { trangthai: trangThai, trang: t })} now={now} />
      )}
    </KhungModule>
  );
}
