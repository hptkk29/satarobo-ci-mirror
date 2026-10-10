// app/(admin)/admin/nguon-hoa-hong/chinh-sach/[policyId]/soan/page.tsx — SOẠN một phiên bản của chính sách đã có (06 §5.2).
//
//   · `?v=<versionId>` + bản NHÁP  ⇒ sửa nháp đó;
//   · `?v=<versionId>` + bản đã kích hoạt / đã dùng / đã thay ⇒ CHỈ ĐỌC (mọi ô khoá), nút chính "Tạo phiên bản mới";
//   · không `?v`                   ⇒ TẠO phiên bản mới, chép rule + phạm vi từ bản mới nhất không bị huỷ. Ngày hiệu lực, lý do và văn bản
//                                    để TRỐNG: phiên bản mới thường kèm văn bản mới, và mang văn bản + ngày của bản cũ sang là đặt sẵn một
//                                    câu trả lời "đã qua 15 ngày làm việc" cho một bản chưa ai công bố. Đã có nháp ⇒ mở nháp đó (không chồng nháp).
//
// Cách ly: đọc qua `scopedDb` (id ngoài tầm nhìn ⇒ 404). Quyền SỬA = `commission_policies:manage` ∧ ghi được cho chủ sở hữu của chính sách.
import { notFound, redirect } from "next/navigation";

import { EmptyState } from "@/components/admin/ui/states";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docChiTietChinhSach, docDuLieuSoan, docPhienBanDeSoan, tamNhinChinhSach } from "@/lib/hoa-hong/chinh-sach-doc";
import { BUOC, formTuPhienBan, type BuocKey } from "@/lib/hoa-hong/chinh-sach-form";
import { kiemHangRao } from "@/lib/hoa-hong/chinh-sach-hanh-dong";
import { khoangMacDinh } from "@/lib/hoa-hong/mo-phong";
import { coTheGhiChoChuSoHuu } from "@/lib/hoa-hong/chinh-sach-quyen";
import { docCoQuyenSuaTran } from "@/lib/hoa-hong/quyen-sua-tran";
import { trangThaiPhienBanHienThi } from "@/lib/hoa-hong/trang-thai-phien-ban";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { motGiaTri } from "@/lib/nguon-hoa-hong/url";

import { vaoTab } from "../../../_lib/vao-tab";
import { TrinhSoan } from "../../_components/trinh-soan";

export const metadata = { title: "Soạn chính sách | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SoanChinhSachPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ v?: string | string[]; buoc?: string | string[] }>;
}) {
  const { actor, scope } = await vaoTab("chinh-sach");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/chinh-sach"])) {
    return <ThieuQuyen tab="chinh-sach" scope={scope} soHangCho={{}} />;
  }
  const { policyId } = await params;
  const sp = await searchParams;
  const now = new Date();
  const versionId = motGiaTri(sp.v);
  const buocDau: BuocKey = BUOC.find((b) => b === motGiaTri(sp.buoc)) ?? "boi-canh";

  const [goc, dl, soHangCho, coQuyenSuaTran] = await Promise.all([
    docPhienBanDeSoan(actor, policyId, versionId),
    docDuLieuSoan(actor, now),
    docSoHangChoTheoTab(actor, scope),
    docCoQuyenSuaTran(),
  ]);
  if (!goc) notFound();

  // Tạo phiên bản mới nhưng đã có một nháp ⇒ sửa nháp đó, không chồng thêm.
  if (versionId === null) {
    const ct = await docChiTietChinhSach(actor, policyId, now);
    const nhap = ct?.phienBan.find((v) => v.status === "DRAFT");
    if (nhap) redirect(`/nguon-hoa-hong/chinh-sach/${policyId}/soan?v=${nhap.versionId}`);
  }

  const bd = formTuPhienBan(goc.dauVao);
  const khung = { tab: "chinh-sach" as const, scope, soHangCho, tieuDe: goc.dauVao.name, phuDe: `${goc.dauVao.policyCode} · ${versionId ? `phiên bản v${goc.versionNo}` : "tạo phiên bản mới"}` };

  if (bd.khongBieuDienDuoc.length > 0) {
    return (
      <KhungModule {...khung}>
        <EmptyState
          title="Phiên bản này có nội dung chưa soạn được ở màn này"
          description={
            <>
              <p>Màn soạn hiện chỉ làm việc với tỉ lệ phần trăm và phạm vi theo nhóm nguồn / cơ sở. Phiên bản này còn:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-left">
                {bd.khongBieuDienDuoc.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p className="mt-2">Bạn vẫn xem được toàn bộ ở trang chi tiết.</p>
            </>
          }
          action={
            <a href={`/nguon-hoa-hong/chinh-sach/${policyId}`} className="text-sm font-medium text-primary-ink hover:underline">
              Về chi tiết chính sách
            </a>
          }
        />
      </KhungModule>
    );
  }

  // "Ghi được cho chủ sở hữu này" tách khỏi từng quyền hành động: BLĐ (`activate`, không `manage`) kích hoạt được bản nháp mà không sửa được nó.
  const coTheGhi = coTheGhiChoChuSoHuu(tamNhinChinhSach(actor), goc.ownerCenterId);
  const coQuyenSoan = scope.has("commission_policies:manage") && coTheGhi;
  const taoMoi = versionId === null;
  const tt = trangThaiPhienBanHienThi({ status: goc.status, effectiveFrom: goc.dauVao.effectiveFrom, effectiveTo: goc.dauVao.effectiveTo }, now);
  const khoa = taoMoi
    ? null
    : goc.status !== "DRAFT"
      ? { lyDo: `Phiên bản v${goc.versionNo} đang ở trạng thái “${tt.nhan}”${goc.daDung ? " và đã sinh dòng sổ hoa hồng" : ""} — không sửa được. Muốn đổi, tạo phiên bản mới.` }
      : goc.daDung
        ? { lyDo: `Phiên bản v${goc.versionNo} đã sinh dòng sổ hoa hồng — không sửa được. Muốn đổi, tạo phiên bản mới.` }
        : null;

  const formDau = taoMoi ? { ...bd.form, hieuLucTu: "", hieuLucDen: "", lyDo: "", vanBan: { kieu: "chua" as const } } : bd.form;
  const laNhapSua = !taoMoi && goc.status === "DRAFT" && !goc.daDung;
  const hangRao = laNhapSua ? await kiemHangRao({ actor, now, versionId: goc.versionId }) : null;

  return (
    <KhungModule {...khung}>
      <TrinhSoan
        key={versionId ?? "moi"}
        cheDo={taoMoi ? "version-moi" : "sua-nhap"}
        policyId={policyId}
        luuDau={taoMoi ? null : { versionId: goc.versionId, versionNo: goc.versionNo, updatedAt: goc.updatedAt.toISOString() }}
        formDau={formDau}
        dl={dl}
        coQuyenKichHoat={scope.has("commission_policies:activate") && coTheGhi}
        coQuyenQuanLyNguon={scope.has("sources:manage") && scope.co.nguon}
        coQuyenSuaTran={coQuyenSuaTran}
        khoa={khoa}
        hangRaoDau={hangRao && hangRao.ok ? hangRao.hangRao : null}
        buocDau={buocDau}
        coQuyenSoan={coQuyenSoan}
        thuTinh={{ coQuyen: scope.has("commission_policies:manage"), khoangMacDinh: khoangMacDinh(now) }}
      />
    </KhungModule>
  );
}
