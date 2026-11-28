// app/(admin)/admin/nguon-hoa-hong/affiliate/[id]/page.tsx — CHI TIẾT MỘT ĐỐI TÁC AFFILIATE (AFF-L3a): nơi HOÀN TẤT onboarding đối tác bằng giao diện (không SQL). NĂM mục chia bằng tiêu đề + đường kẻ
// (KHÔNG thẻ lồng thẻ): Thông tin · Chuẩn bị phát link · Chương trình tham gia · Ghi danh vào campaign · Tài khoản truy cập cổng.
//
// Cổng và cách ly (khuôn `campaign/[maCampaign]`): `vaoTab("affiliate")` (cờ tắt ⇒ 404, đứng TRƯỚC quyền) → `PAGE_GATES["/nguon-hoa-hong/affiliate"]` (xem) → id trên URL giải bằng `giaiMaTrenUrl`
// (hỏng ⇒ 404, không URIError) → không có đối tác ⇒ `notFound()`. Đối tác là danh mục toàn hệ — cách ly nằm ở cổng quyền; SỐ LEAD đếm qua `scopedDb` (đọc `docDoiTacTheoId`).
//
// MỖI NÚT GHI vẽ bằng ĐÚNG khoá mà action của nó kiểm ở đầu hàm (luật 12 — `scope.has(k)` ↔ `checkPermission(k)`):
//   · Sửa hồ sơ · đổi trạng thái đối tác · tài khoản truy cập (liên kết / gỡ / đại diện / tạm ngừng) → `affiliates:manage`
//   · Ghi danh campaign · duyệt / ngừng thành viên                                                  → `affiliate_memberships:manage`
// PII: SĐT/email/ghi chú chỉ người có `affiliates:manage` thấy bản thật (che ở TẦNG ĐỌC, trước khi thành props RSC). Danh sách tài khoản che theo cùng quy tắc.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Lock, Pencil } from "lucide-react";
import { DoiTacSheet } from "@/components/admin/nguon-hoa-hong/affiliate/doi-tac-sheet";
import { NutDoiTrangThaiDoiTac } from "@/components/admin/nguon-hoa-hong/affiliate/doi-trang-thai-doi-tac";
import { GhiDanhCampaign } from "@/components/admin/nguon-hoa-hong/affiliate/ghi-danh-campaign";
import { KhoiChuongTrinhDoiTac } from "@/components/admin/nguon-hoa-hong/affiliate/khoi-chuong-trinh-doi-tac";
import { KhoiOnboarding } from "@/components/admin/nguon-hoa-hong/affiliate/khoi-onboarding";
import { KhoiTaiKhoanTruyCap } from "@/components/admin/nguon-hoa-hong/affiliate/khoi-tai-khoan-truy-cap";
import { TrangThaiDoiTacPill } from "@/components/admin/nguon-hoa-hong/affiliate/trang-thai-doi-tac-pill";
import { BTN_OUTLINE } from "@/components/admin/nguon-hoa-hong/classes";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { docDoiTacTheoId, docTuyChonDoiTac } from "@/lib/affiliate/doc-doi-tac";
import { docOnboardingDoiTac } from "@/lib/affiliate/doc-ho-so-doi-tac";
import { NHAN_KIEU_DOI_TAC } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { docTruyCapCuaDoiTac } from "@/lib/affiliate/tai-khoan-truy-cap";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { giaiMaTrenUrl } from "@/lib/nguon-hoa-hong/url";
import { vaoTab } from "../../_lib/vao-tab";

export const metadata = { title: "Chi tiết đối tác Affiliate | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// id (cuid) trên URL: chặn chuỗi rác/dài trước khi chạm DB.
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Muc({ id, tieuDe, moTa, children }: { id: string; tieuDe: string; moTa?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-tieu-de`} className="space-y-3 py-5">
      <div>
        <h2 id={`${id}-tieu-de`} className="text-base font-semibold text-foreground">
          {tieuDe}
        </h2>
        {moTa && <p className="mt-0.5 text-sm text-muted-foreground">{moTa}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function ChiTietDoiTacPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, scope } = await vaoTab("affiliate");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/affiliate"])) {
    return <ThieuQuyen tab="affiliate" scope={scope} soHangCho={{}} />;
  }
  const { id: idTho } = await params;
  const id = giaiMaTrenUrl(idTho);
  if (id === null || !ID_RE.test(id)) notFound();
  const now = new Date();

  // MỖI cờ quyền hỏi MỘT lần từ scope — cùng khoá với action tương ứng.
  const coTheGhi = scope.has("affiliates:manage");
  const coTheThanhVien = scope.has("affiliate_memberships:manage");
  // Dòng hướng dẫn mã giới thiệu trong Sheet «Sửa hồ sơ» chỉ có đường dẫn sang tab Link / QR / Mã khi người xem được PHÁT link (AFF-WEB).
  const coTheTaoLink = scope.has("affiliate_links:manage");

  const [soHangCho, ctDoiTac, onboarding] = await Promise.all([
    docSoHangChoTheoTab(actor, scope),
    docDoiTacTheoId(actor, id, coTheGhi),
    docOnboardingDoiTac({ partyId: id, now }),
  ]);
  if (!ctDoiTac || !onboarding) notFound();
  const { dong: d, phamViLead } = ctDoiTac;

  const ketThuc = d.trangThai === "ENDED";
  const [truyCap, tuyChon] = await Promise.all([
    docTruyCapCuaDoiTac({ partyId: d.id, doiTacKetThuc: ketThuc, coTheXemLienHe: coTheGhi }),
    coTheGhi && !ketThuc ? docTuyChonDoiTac(actor) : Promise.resolve(null),
  ]);

  const lienHe = [d.dienThoai, d.email].filter(Boolean).join(" · ");
  const doiTacTom = { id: d.id, code: d.ma, ten: d.ten, kind: d.kieu, loai: d.loai?.ten ?? null, status: d.trangThai };

  return (
    <KhungModule
      tab="affiliate"
      scope={scope}
      soHangCho={soHangCho}
      tieuDe={d.ten}
      phuDe={`Mã ${d.ma} · ${NHAN_KIEU_DOI_TAC[d.kieu]}`}
      actions={
        coTheGhi && tuyChon ? (
          <>
            <DoiTacSheet dong={d} tuyChon={tuyChon} coTheTaoLink={coTheTaoLink} triggerClassName={BTN_OUTLINE}>
              <Pencil aria-hidden className="h-4 w-4" />
              Sửa hồ sơ
            </DoiTacSheet>
            <NutDoiTrangThaiDoiTac doiTac={{ id: d.id, ten: d.ten, trangThai: d.trangThai, loaiCanDuyet: d.loai ? d.loai.canDuyet : null, capNhatLuc: d.capNhatLuc }} />
          </>
        ) : undefined
      }
    >
      <Link href="/nguon-hoa-hong/affiliate" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        Tất cả đối tác
      </Link>

      <div className="divide-y divide-border rounded-xl border border-border bg-card px-4 sm:px-6">
        <Muc id="thong-tin" tieuDe="Thông tin">
          <dl className="space-y-2.5">
            <Dong nhan="Trạng thái">
              <TrangThaiDoiTacPill trangThai={d.trangThai} />
            </Dong>
            <Dong nhan="Loại đối tác">{d.loai ? `${d.loai.ten}${d.loai.dangDung ? "" : " (đã ngừng)"}` : "Chưa có loại"}</Dong>
            <Dong nhan="Nhãn">{d.nhan.length > 0 ? d.nhan.map((n) => n.ten).join(", ") : "Chưa có nhãn"}</Dong>
            <Dong nhan="Mã giới thiệu">
              <span className="inline-flex items-center gap-2">
                <span className="font-mono font-semibold">{d.ma}</span>
                {d.maDaKhoa && (
                  <span title="Mã đã có lead — không đổi được (đổi mã làm chết link đã in)">
                    <Lock role="img" aria-label="Mã đã khoá" className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                )}
              </span>
            </Dong>
            {d.toChuc && <Dong nhan="Thuộc tổ chức">{d.toChuc.ten}</Dong>}
            {d.kieu === "ORGANIZATION" && <Dong nhan="Thành viên">{soVN(d.soThanhVien)} cá nhân</Dong>}
            {d.nhanVien && <Dong nhan="Nhân viên liên kết">{d.nhanVien.ten}</Dong>}
            {lienHe && <Dong nhan="Liên hệ">{lienHe}</Dong>}
            {d.ghiChu && <Dong nhan="Ghi chú">{d.ghiChu}</Dong>}
            <Dong nhan={phamViLead === "GIOI_HAN" ? "Lead (trong phạm vi bạn xem)" : "Lead"}>
              {soVN(d.soLead)} · đã chốt {soVN(d.soLeadDaChot)}
            </Dong>
          </dl>
        </Muc>

        <Muc id="chuan-bi" tieuDe="Chuẩn bị phát link" moTa="Đã đủ để phát link chưa — cùng cổng với lúc phát link và lúc khách bấm link, nên checklist và nút «Phát link» không thể nói khác nhau.">
          <KhoiOnboarding buoc={onboarding.buoc} sanSang={onboarding.sanSang} />
        </Muc>

        <Muc id="chuong-trinh" tieuDe="Chương trình đang tham gia" moTa="Mỗi campaign kèm nguồn khách mà đối tác này sẽ được gán — thiếu cấu hình hiện «Cần xem tay» kèm lý do.">
          <KhoiChuongTrinhDoiTac chuongTrinh={onboarding.chuongTrinh} doiTac={doiTacTom} coTheThanhVien={coTheThanhVien} />
        </Muc>

        <Muc id="ghi-danh" tieuDe="Ghi danh vào campaign" moTa="Chỉ đối tác đang hoạt động mới ghi danh được. Ghi danh xong thành viên ở trạng thái «Chờ duyệt» — duyệt ở mục trên.">
          <GhiDanhCampaign partyId={d.id} ungVien={onboarding.ungVien} conNua={onboarding.conUngVien} coTheGhi={coTheThanhVien} />
        </Muc>

        <Muc id="tai-khoan" tieuDe="Tài khoản truy cập cổng" moTa="Những tài khoản phụ huynh được vào cổng /portal/gioi-thieu để xem việc giới thiệu của đối tác này. Tuỳ chọn — đối tác không có tài khoản vẫn hoạt động bình thường.">
          <KhoiTaiKhoanTruyCap partyId={d.id} doiTacKetThuc={ketThuc} dong={truyCap} coTheGhi={coTheGhi} />
        </Muc>
      </div>
    </KhungModule>
  );
}
