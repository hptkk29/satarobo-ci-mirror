// app/(admin)/admin/nguon-hoa-hong/chinh-sach/moi/page.tsx — TẠO chính sách mới (builder 7 bước, 06 §5.2).
//
// Đi cổng của tab Chính sách (cờ engine ∧ `commission_policies:view`), RỒI đòi thêm `commission_policies:manage` để soạn: người chỉ
// xem vào đây được hỏi quyền chứ không thấy form chết. Chủ sở hữu mặc định: Hội sở nếu người xem sở hữu được; không thì cơ sở đầu tiên
// trong tầm nhìn. Người không sở hữu được gì (không Hội sở, không cơ sở) ⇒ nói thẳng, không dựng form không lưu được.
//
// `?nguon=<mã>` (từ trang chi tiết một nguồn): chọn sẵn phạm vi «một nhóm nguồn» khi mã có thật VÀ nguồn qua được cổng hoạt động (`nguonChonSanTuMa`); mã lạ / UNKNOWN / nguồn ngừng ⇒ bỏ qua,
// mở ở phạm vi chung. Chỉ ĐỌC mã từ URL — id nhóm lấy từ danh sách máy chủ vừa nạp, không bao giờ tin id từ URL.
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docDuLieuSoan } from "@/lib/hoa-hong/chinh-sach-doc";
import { formRong } from "@/lib/hoa-hong/chinh-sach-form";
import { khoangMacDinh } from "@/lib/hoa-hong/mo-phong";
import { nguonChonSanTuMa } from "@/lib/hoa-hong/nguon-cho-soan";
import { docCoQuyenSuaTran } from "@/lib/hoa-hong/quyen-sua-tran";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { HOI_AI_TAB } from "@/lib/nguon-hoa-hong/tab";
import { motGiaTri } from "@/lib/nguon-hoa-hong/url";

import { vaoTab } from "../../_lib/vao-tab";
import { TrinhSoan } from "../_components/trinh-soan";

export const metadata = { title: "Tạo chính sách | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function TaoChinhSachPage({ searchParams }: { searchParams: Promise<{ nguon?: string | string[] }> }) {
  const { actor, scope } = await vaoTab("chinh-sach");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/chinh-sach"])) {
    return <ThieuQuyen tab="chinh-sach" scope={scope} soHangCho={{}} />;
  }
  const sp = await searchParams;
  const now = new Date();
  const soHangCho = await docSoHangChoTheoTab(actor, scope);
  const khung = { tab: "chinh-sach" as const, scope, soHangCho, tieuDe: "Tạo chính sách", phuDe: "Soạn theo bảy bước; lưu nháp bất cứ lúc nào, kích hoạt khi mọi điều kiện đạt." };

  if (!scope.has("commission_policies:manage")) {
    return (
      <KhungModule {...khung}>
        <NoPermission permission="commission_policies:manage" what="trình soạn chính sách" askWho={HOI_AI_TAB["chinh-sach"]} />
      </KhungModule>
    );
  }

  const [dl, coQuyenSuaTran] = await Promise.all([docDuLieuSoan(actor, now), docCoQuyenSuaTran()]);
  if (!dl.coTheSoHuuHoiSo && dl.coSo.length === 0) {
    return (
      <KhungModule {...khung}>
        <EmptyState title="Chưa có đơn vị nào để sở hữu chính sách" description="Tài khoản này không thuộc Hội sở và không thấy cơ sở nào, nên không tạo được chính sách. Nhờ quản trị hệ thống gán cơ sở cho tài khoản." />
      </KhungModule>
    );
  }

  const nguonChonSan = nguonChonSanTuMa(motGiaTri(sp.nguon), dl.nhomNguon);
  const formDau = {
    ...formRong(),
    chuSoHuuOrgUnitId: dl.coTheSoHuuHoiSo ? null : (dl.coSo[0]?.orgUnitId ?? null),
    ...(nguonChonSan ? { phamVi: { loai: "SOURCE_GROUP" as const, sourceGroupId: nguonChonSan.id } } : {}),
  };
  return (
    <KhungModule {...khung}>
      <TrinhSoan
        cheDo="tao-moi"
        policyId={null}
        luuDau={null}
        formDau={formDau}
        dl={dl}
        coQuyenKichHoat={scope.has("commission_policies:activate")}
        coQuyenQuanLyNguon={scope.has("sources:manage") && scope.co.nguon}
        coQuyenSuaTran={coQuyenSuaTran}
        khoa={null}
        hangRaoDau={null}
        buocDau="boi-canh"
        coQuyenSoan
        thuTinh={{ coQuyen: scope.has("commission_policies:manage"), khoangMacDinh: khoangMacDinh(new Date()) }}
      />
    </KhungModule>
  );
}
