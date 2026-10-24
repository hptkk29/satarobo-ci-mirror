// app/(admin)/admin/nguon-hoa-hong/chinh-sach/[policyId]/page.tsx — CHI TIẾT một chính sách (06 §5.2): danh sách phiên bản + chi tiết
// phiên bản đang chọn (`?v=<số phiên bản>`). Chỉ ĐỌC; sửa/kích hoạt đi qua trình soạn (`/soan`).
//
// Nút hiện theo QUYỀN THẬT của hành động (luật 12): "Sửa bản nháp" / "Tạo phiên bản mới" cần `commission_policies:manage` ∧ ghi được cho
// đơn vị sở hữu; "Kiểm và kích hoạt" cần `commission_policies:activate` ∧ ghi được. Người chỉ xem thấy chi tiết + thanh điều kiện nhưng
// KHÔNG thấy nút nào họ bấm sẽ bị từ chối. Cách ly: đọc qua `scopedDb`; id ngoài tầm nhìn ⇒ 404.
import Link from "next/link";
import { notFound } from "next/navigation";

import { BTN_OUTLINE, BTN_PRIMARY, CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { HangRaoBar } from "@/components/admin/nguon-hoa-hong/hang-rao-bar";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { PolicyVersionBadge, TrangThaiPhienBanPill } from "@/components/admin/nguon-hoa-hong/policy-version-badge";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docBoLocChinhSach, docChiTietChinhSach, tamNhinChinhSach } from "@/lib/hoa-hong/chinh-sach-doc";
import { kiemHangRao } from "@/lib/hoa-hong/chinh-sach-hanh-dong";
import { coTheGhiChoChuSoHuu } from "@/lib/hoa-hong/chinh-sach-quyen";
import { khoangHieuLuc } from "@/lib/hoa-hong/dinh-dang";
import { dungHangRao } from "@/lib/hoa-hong/hang-rao-ui";
import { docCoQuyenSuaTran } from "@/lib/hoa-hong/quyen-sua-tran";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { ScopeBar } from "@/components/admin/nguon-hoa-hong/scope-bar";
import { cn } from "@/lib/utils";

import { vaoTab } from "../../_lib/vao-tab";
import { PhienBanChiTietView } from "../_components/phien-ban-chi-tiet";

export const metadata = { title: "Chi tiết chính sách | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ChiTietChinhSachPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  const { actor, scope } = await vaoTab("chinh-sach");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/chinh-sach"])) {
    return <ThieuQuyen tab="chinh-sach" scope={scope} soHangCho={{}} />;
  }
  const { policyId } = await params;
  const sp = await searchParams;
  const now = new Date();

  const [ct, soHangCho, boLoc, coQuyenSuaTran] = await Promise.all([docChiTietChinhSach(actor, policyId, now), docSoHangChoTheoTab(actor, scope), docBoLocChinhSach(actor), docCoQuyenSuaTran()]);
  if (!ct) notFound();

  const vRaw = Array.isArray(sp.v) ? sp.v[0] : sp.v;
  const soChon = Number.parseInt(vRaw ?? "", 10);
  // Mặc định: bản đang áp dụng; không có thì bản mới nhất (danh sách đã sắp giảm dần).
  const mac = ct.phienBan.find((v) => v.khoa === "DANG_AP_DUNG") ?? ct.phienBan.find((v) => v.status !== "CANCELLED") ?? ct.phienBan[0];
  const chon = ct.phienBan.find((v) => v.versionNo === soChon) ?? mac;
  if (!chon) notFound();

  const coTheGhi = coTheGhiChoChuSoHuu(tamNhinChinhSach(actor), ct.ownerCenterId);
  const coTheSoan = scope.has("commission_policies:manage") && coTheGhi;
  const coTheKichHoat = scope.has("commission_policies:activate") && coTheGhi;
  const nhapHienCo = ct.phienBan.find((v) => v.status === "DRAFT");
  const chonLaNhap = chon.status === "DRAFT" && !chon.daDung;

  const kiem = chonLaNhap ? await kiemHangRao({ actor, now, versionId: chon.versionId }) : null;
  const hangRao = kiem && kiem.ok ? dungHangRao(kiem.hangRao, { tran: boLoc.tran, tenVai: new Map(boLoc.vai.map((v) => [v.code, v.name])) }) : null;

  const hrefSoan = (q: string) => `/nguon-hoa-hong/chinh-sach/${ct.policyId}/soan${q}`;
  const actions = (
    <>
      {chonLaNhap && coTheSoan && (
        <Link href={hrefSoan(`?v=${chon.versionId}`)} className={BTN_PRIMARY}>
          Sửa bản nháp
        </Link>
      )}
      {chonLaNhap && coTheKichHoat && (
        <Link href={hrefSoan(`?v=${chon.versionId}&buoc=kich-hoat`)} className={coTheSoan ? BTN_OUTLINE : BTN_PRIMARY}>
          Kiểm và kích hoạt
        </Link>
      )}
      {!chonLaNhap && coTheSoan && (
        <Link href={hrefSoan("")} className={nhapHienCo ? BTN_OUTLINE : BTN_PRIMARY}>
          {nhapHienCo ? `Mở bản nháp v${nhapHienCo.versionNo}` : "Tạo phiên bản mới"}
        </Link>
      )}
    </>
  );

  return (
    <KhungModule
      tab="chinh-sach"
      scope={scope}
      soHangCho={soHangCho}
      tieuDe={ct.name}
      phuDe={`${ct.policyCode} · Đơn vị sở hữu: ${ct.chuSoHuu}${ct.description ? ` · ${ct.description}` : ""}`}
      actions={actions}
      scopeBar={<ScopeBar basePath="/nguon-hoa-hong/chinh-sach" tran={boLoc.tran} />}
    >
      <p className="-mt-1 mb-4 text-sm">
        <Link href="/nguon-hoa-hong/chinh-sach?xem=tat-ca" className="text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          ← Tất cả chính sách
        </Link>
      </p>
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Các phiên bản" className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Phiên bản</h2>
          <ul className="grid gap-1.5">
            {ct.phienBan.map((v) => {
              const dang = v.versionId === chon.versionId;
              return (
                <li key={v.versionId}>
                  <Link
                    href={`/nguon-hoa-hong/chinh-sach/${ct.policyId}?v=${v.versionNo}`}
                    aria-current={dang ? "page" : undefined}
                    className={cn(CHIP, "h-auto w-full flex-col items-start gap-1 py-2", dang ? CHIP_ACTIVE : CHIP_IDLE)}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <PolicyVersionBadge versionNo={v.versionNo} />
                      <TrangThaiPhienBanPill status={v.status} effectiveFrom={v.effectiveFrom} effectiveTo={v.effectiveTo} now={now} />
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">{khoangHieuLuc(v.effectiveFrom, v.effectiveTo)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={cn("grid min-w-0 items-start gap-5", hangRao && "xl:grid-cols-[minmax(0,1fr)_18rem]")}>
          <PhienBanChiTietView pb={chon} now={now} />
          {hangRao && <HangRaoBar hangRao={hangRao} coQuyenSuaTran={coQuyenSuaTran} moTaChuaKiem="Không kiểm được lúc này — mở trình soạn để thử lại." />}
        </div>
      </div>
    </KhungModule>
  );
}
