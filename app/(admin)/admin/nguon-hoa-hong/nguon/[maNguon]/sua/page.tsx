// app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/sua/page.tsx — SỬA MỘT NGUỒN (SPEC nguồn động §4).
//
// Trang đầy đủ như `/nguon/tao`. Khác biệt: dữ liệu đọc từ DB (`docFormSuaNguon` — tự gác `sources:manage`), ô bị khoá kèm lý do lấy từ `truongBiKhoa` (cùng hàm với cổng ghi), và biểu mẫu
// được `key` theo `capNhatLuc` để khi người khác vừa sửa nguồn và người dùng bấm «Tải lại», biểu mẫu dựng LẠI từ dữ liệu mới (không giữ chỗ đang sửa dở của bản cũ).
// Bốn trạng thái: tải (`loading.tsx`) · lỗi (`error.tsx`) · không quyền (NoPermission nêu `sources:manage`) · không tìm thấy (404, mã lạ hoặc cờ nguồn tắt — `vaoTab("nguon")`).
import { notFound } from "next/navigation";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { NguonForm } from "@/components/admin/nguon-hoa-hong/nguon-form";
import { NoPermission } from "@/components/admin/ui/states";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docFormSuaNguon } from "@/lib/nguon/doc-form-nguon";
import { phuDeTrangSua } from "@/lib/nguon/form-nguon";
import { coQuyenKichHoatChinhSach } from "@/lib/nguon/quyen-kich-hoat";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { giaiMaTrenUrl } from "@/lib/nguon-hoa-hong/url";
import { vaoTab } from "../../../_lib/vao-tab";

export const metadata = { title: "Sửa nguồn | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SuaNguonPage({ params }: { params: Promise<{ maNguon: string }> }) {
  const { actor, scope } = await vaoTab("nguon");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/nguon"])) {
    return <ThieuQuyen tab="nguon" scope={scope} soHangCho={{}} />;
  }
  const { maNguon } = await params;
  // `%` đơn lẻ trên URL: decodeURIComponent trần ném URIError. Mã hỏng = mã lạ = 404.
  const ma = giaiMaTrenUrl(maNguon);
  if (ma === null) notFound();
  const soHangCho = await docSoHangChoTheoTab(actor, scope);

  if (!scope.has("sources:manage")) {
    return (
      <KhungModule tab="nguon" scope={scope} soHangCho={soHangCho} tieuDe="Sửa nguồn" phuDe="Đổi thông tin, cửa sổ ghi công, người phụ trách hoặc hoa hồng của một nguồn.">
        <NoPermission permission="sources:manage" what="trang sửa nguồn" askWho="Marketing Hội sở hoặc quản trị hệ thống" />
      </KhungModule>
    );
  }

  const [du, coQuyenKichHoat] = await Promise.all([docFormSuaNguon(actor, ma), coQuyenKichHoatChinhSach()]);
  if (!du) notFound();
  return (
    <KhungModule
      tab="nguon"
      scope={scope}
      soHangCho={soHangCho}
      tieuDe={`Sửa nguồn: ${du.nguon.name}`}
      phuDe={phuDeTrangSua({ code: du.nguon.code, isSystem: du.nguon.isSystem, daDung: du.nguon.daDung.daDung })}
    >
      <NguonForm
        key={du.nguon.capNhatLuc}
        cheDo="sua"
        nguon={du.nguon}
        donVi={du.donVi}
        thuTuGoiY={du.thuTuGoiY}
        cuaSoMacDinhNgay={du.cuaSoMacDinhNgay}
        boiCanh={{ ...du.boiCanh, coQuyenKichHoat, nowIso: new Date().toISOString() }}
      />
    </KhungModule>
  );
}
