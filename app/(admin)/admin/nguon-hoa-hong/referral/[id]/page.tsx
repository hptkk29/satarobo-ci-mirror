// app/(admin)/admin/nguon-hoa-hong/referral/[id]/page.tsx — CHI TIẾT MỘT LƯỢT REFERRAL (AFF-P1): trang đọc, BỐN mục chia bằng tiêu đề + đường kẻ (KHÔNG thẻ lồng thẻ):
//   Kết quả · Người giới thiệu · Nguồn đã giải · Phiếu khách.
//
// Cổng và cách ly (khuôn `campaign/[maCampaign]`): `vaoTab("referral")` (cờ tắt ⇒ 404, đứng TRƯỚC quyền) → `PAGE_GATES["/nguon-hoa-hong/referral"]` → id trên URL giải bằng `giaiMaTrenUrl` (hỏng ⇒ 404)
// → `docChiTietReferral` đọc qua `scopedDb`: lượt của cơ sở khác / lượt chưa quy được cơ sở (khi người xem cấp cơ sở) ⇒ null ⇒ `notFound()` — không phân biệt «không có» với «không được xem».
// XỬ LÝ TAY (AFF-L3b): panel nút CHỈ khi người xem có `affiliate_referrals:manage` (đúng khoá action kiểm) ∧ trạng thái còn nhận xử lý; «Lịch sử xử lý» đọc nhật ký chỉ-thêm.
// PII: không có tên/SĐT/email khách ở bất kỳ mục nào (kể cả lý do/bằng chứng — tầng ghi chặn).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { KhungModule, ThieuQuyen } from "@/components/admin/nguon-hoa-hong/khung-module";
import { BTN_OUTLINE } from "@/components/admin/nguon-hoa-hong/classes";
import { TrangThaiReferralPill } from "@/components/admin/nguon-hoa-hong/referral/trang-thai-referral-pill";
import { LichSuXuLy } from "@/components/admin/nguon-hoa-hong/referral/lich-su-xu-ly";
import { XuLyReferralPanel } from "@/components/admin/nguon-hoa-hong/referral/xu-ly-referral-panel";
import { Separator } from "@/components/ui/separator";
import { docChiTietReferral } from "@/lib/affiliate/doc-referral";
import { docLichSuReferral } from "@/lib/affiliate/doc-xu-ly-referral";
import { dangChoBangChung, cacHanhDongChoPhep } from "@/lib/affiliate/xu-ly-referral";
import { MO_TA_TRANG_THAI_REFERRAL, NHAN_CACH_DEN_REFERRAL, NHAN_CAN_CU_TU_GIOI_THIEU, NHAN_ORIGIN_REFERRAL, thoiDiemHienThi } from "@/lib/affiliate/ghi-referral-dau-vao";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { docSoHangChoTheoTab } from "@/lib/nguon-hoa-hong/hang-cho";
import { giaiMaTrenUrl } from "@/lib/nguon-hoa-hong/url";
import { PhieuKhach } from "../_components/bang-referral";
import { vaoTab } from "../../_lib/vao-tab";

export const metadata = { title: "Chi tiết referral | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// id (cuid) trên URL: chặn chuỗi rác/dài trước khi chạm DB.
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
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
      <dl className="space-y-2.5">{children}</dl>
    </section>
  );
}

export default async function ChiTietReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, scope } = await vaoTab("referral");
  if (!scope.any(PAGE_GATES["/nguon-hoa-hong/referral"])) {
    return <ThieuQuyen tab="referral" scope={scope} soHangCho={{}} />;
  }
  const { id: idTho } = await params;
  // `%` đơn lẻ trên URL: decodeURIComponent trần ném URIError ⇒ 500. Mã hỏng = mã lạ = 404.
  const id = giaiMaTrenUrl(idTho);
  if (id === null || !ID_RE.test(id)) notFound();
  const now = new Date();

  const coTheMoLead = await checkAnyPermission(["leads:view-all", "leads:view-own"]);
  const [r, soHangCho, lichSu] = await Promise.all([docChiTietReferral(actor, id, { coTheMoLead }), docSoHangChoTheoTab(actor, scope), docLichSuReferral(actor, id)]);
  if (!r) notFound();
  // Nút xử lý: khoá quyền của action ∧ bảng trạng thái của máy chủ (`cacHanhDongChoPhep`) — nút vẽ ra ⇔ action chạy được.
  const coQuyenXuLy = scope.has("affiliate_referrals:manage");

  const sn = r.snapshot;
  // Liên kết sang campaign chỉ khi người xem MỞ ĐƯỢC trang campaign (cùng cổng với tab Campaign) — không thì chỉ in tên.
  const coTheMoCampaign = scope.any(PAGE_GATES["/nguon-hoa-hong/campaign"]);
  const heBaoVe = r.baoVeDen !== null && now.getTime() >= new Date(r.baoVeDen).getTime();

  return (
    <KhungModule
      tab="referral"
      scope={scope}
      soHangCho={soHangCho}
      tieuDe={`Referral ${thoiDiemHienThi(r.luc)}`}
      phuDe={`${r.doiTac.ten} · ${r.campaign.ten}`}
      actions={
        <Link href="/nguon-hoa-hong/referral" className={BTN_OUTLINE}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
          Về danh sách
        </Link>
      }
    >
      {coQuyenXuLy && (
        <>
          <Muc id="xu-ly" tieuDe="Xử lý" moTa={cacHanhDongChoPhep(r.trangThai).length > 0 ? "Lượt này đang chờ người quyết định." : undefined}>
            <XuLyReferralPanel id={r.id} trangThai={r.trangThai} capNhatLuc={r.capNhatLuc} coQuyen={coQuyenXuLy} dangChoBangChung={cacHanhDongChoPhep(r.trangThai).length > 0 && dangChoBangChung(lichSu)} />
          </Muc>
          <Separator />
        </>
      )}

      <Muc id="ket-qua" tieuDe="Kết quả" moTa="Hệ thống đã xử lý lượt gửi biểu mẫu này như thế nào.">
        <Dong nhan="Trạng thái">
          <div className="flex flex-wrap items-center gap-2">
            <TrangThaiReferralPill trangThai={r.trangThai} />
            <span className="text-muted-foreground">{MO_TA_TRANG_THAI_REFERRAL[r.trangThai]}</span>
          </div>
        </Dong>
        <Dong nhan="Lý do / ghi chú">{r.lyDo.day}</Dong>
        <Dong nhan="Gửi lúc">{thoiDiemHienThi(r.luc)}</Dong>
        <Dong nhan="Bảo vệ đến">
          {r.baoVeDen === null ? (
            <span className="text-muted-foreground">Không có (chỉ lượt Hợp lệ mới được bảo vệ)</span>
          ) : (
            <>
              {thoiDiemHienThi(r.baoVeDen)}
              {heBaoVe && <span className="ml-2 text-muted-foreground">(đã hết thời hạn bảo vệ)</span>}
            </>
          )}
        </Dong>
        {r.datDieuKienLuc !== null && <Dong nhan="Đạt điều kiện lúc">{thoiDiemHienThi(r.datDieuKienLuc)}</Dong>}
        {r.tuChoiLuc !== null && <Dong nhan="Từ chối lúc">{thoiDiemHienThi(r.tuChoiLuc)}</Dong>}
        <Dong nhan="Cập nhật lần cuối">{thoiDiemHienThi(r.capNhatLuc)}</Dong>
      </Muc>
      <Separator />

      <Muc id="nguoi-gioi-thieu" tieuDe="Người giới thiệu" moTa="Thông tin chụp lúc ghi nhận — đổi cấu hình về sau không viết lại.">
        <Dong nhan="Đối tác">
          {r.doiTac.ten} <span className="font-mono text-xs text-muted-foreground">{r.doiTac.ma}</span>
        </Dong>
        <Dong nhan="Loại đối tác">{r.tenLoai ?? <span className="text-muted-foreground">Không có</span>}</Dong>
        <Dong nhan="Nhãn">
          {r.tenNhan.length === 0 ? (
            <span className="text-muted-foreground">Không có</span>
          ) : (
            r.tenNhan.map((n) => n.ten).join(", ")
          )}
        </Dong>
        <Dong nhan="Campaign">
          {coTheMoCampaign ? (
            <Link href={`/nguon-hoa-hong/campaign/${encodeURIComponent(r.campaign.ma)}`} className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {r.campaign.ten}
            </Link>
          ) : (
            r.campaign.ten
          )}{" "}
          <span className="font-mono text-xs text-muted-foreground">{r.campaign.ma}</span>
        </Dong>
        <Dong nhan="Cách đến">{NHAN_CACH_DEN_REFERRAL[r.cachDen]}</Dong>
      </Muc>
      <Separator />

      <Muc id="nguon" tieuDe="Nguồn đã giải" moTa="Nhóm nguồn mà cấu hình campaign giải ra cho đối tác này lúc ghi nhận.">
        <Dong nhan="Nguồn">
          {r.nguon !== null ? r.nguon : <span className="text-muted-foreground">Chưa quy được nguồn — lượt này không được quyết là Hợp lệ nên chưa có nguồn nào được ghi.</span>}
        </Dong>
        {sn.tuNhan !== null && <Dong nhan="Quyết định theo">{sn.tuNhan}</Dong>}
        <Dong nhan="Tín hiệu Origin">{sn.origin !== null ? NHAN_ORIGIN_REFERRAL[sn.origin] : <span className="text-muted-foreground">Không có ghi nhận.</span>}</Dong>
        <Dong nhan="Căn cứ tự giới thiệu">
          {sn.canCuTuGioiThieu.length === 0 ? (
            <span className="text-muted-foreground">Không thấy dấu hiệu người giới thiệu và khách là một người.</span>
          ) : (
            `Người giới thiệu và khách ${sn.canCuTuGioiThieu.map((c) => NHAN_CAN_CU_TU_GIOI_THIEU[c]).join(", ")}.`
          )}
        </Dong>
      </Muc>
      <Separator />

      <Muc id="phieu-khach" tieuDe="Phiếu khách" moTa="Màn này không hiện tên, số điện thoại hay email của khách. Mở phiếu để xem — màn phiếu tự kiểm quyền và cơ sở.">
        <Dong nhan="Phiếu">
          <PhieuKhach phieu={r.phieu} />
        </Dong>
      </Muc>
      <Separator />

      <section id="lich-su" aria-labelledby="lich-su-tieu-de" className="space-y-3 py-5">
        <div>
          <h2 id="lich-su-tieu-de" className="text-base font-semibold text-foreground">
            Lịch sử xử lý
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Ai làm gì với lượt này, lúc nào, vì sao. Nhật ký chỉ-thêm — không sửa, không xoá.</p>
        </div>
        <LichSuXuLy dong={lichSu} />
      </section>
    </KhungModule>
  );
}
