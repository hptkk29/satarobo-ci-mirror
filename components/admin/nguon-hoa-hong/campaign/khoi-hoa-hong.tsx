"use client";

// components/admin/nguon-hoa-hong/campaign/khoi-hoa-hong.tsx — KHỐI «Hoa hồng» của trang chi tiết campaign (AFF-L1): chọn «có thưởng / không có mức riêng», xem các phiên bản chính sách của campaign,
// đường tới trình soạn, và bảng «cách tính» nói thật cái gì engine có / không có.
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// · Hai ô chọn «thưởng» chỉ BẤM ĐƯỢC khi `quyen.doiCheDo` (= `affiliate_campaigns:manage`, đúng khoá `datCheDoThuongAction` kiểm) ∧ campaign chưa kết thúc. Không quyền ⇒ chỉ đọc, KHÔNG nút.
// · Đường «Soạn chính sách» chỉ vẽ khi `quyen.soanChinhSach` (= `commission_policies:manage` ∧ engine hoa hồng bật — tab Chính sách 404 khi engine tắt) ∧ lựa chọn không phải «không có mức riêng»
//   (kích hoạt chính sách khi đang «không có mức riêng» bị máy chủ chặn — nên không mời soạn).
// · «Không có mức riêng» KHÔNG hứa «0 đồng»: chính sách chung (toàn hệ thống · nhóm nguồn) vẫn có thể trả cho đối tác — màn nói thẳng điều đó.
// · Chưa chọn (`null`) hiện rõ là «Chưa chọn» — không phải một trong hai lựa chọn.
// · Số tiền hoa hồng chỉ hiện khi người xem có `commission_policies:view` (`phienBan !== null`); thiếu quyền ⇒ nói «chưa có quyền», KHÔNG in danh sách rỗng.
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Lock } from "lucide-react";
import { datCheDoThuongAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { CHE_DO_THUONG, LY_DO_TOI_THIEU_CAMPAIGN, NHAN_CHE_DO_THUONG, type CheDoThuong, type KetQuaDoiCheDoThuong, type TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import {
  ANH_XA_TRUONG,
  hrefSoanChinhSachCampaign,
  hrefSuaNhapChinhSach,
  trangThaiCacKieuTinh,
  type PhienBanCuaCampaignView,
  type QuyenHoaHongCampaign,
} from "@/lib/affiliate/hoa-hong-campaign-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY } from "../classes";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";
import { HopThoaiLyDo } from "./hop-thoai-ly-do";
import { ngayHienThi } from "./nhan-campaign";

type Doi = (i: { id: string; updatedAtDaThay: string; den: CheDoThuong; lyDo: string | null }) => Promise<KetQuaDoiCheDoThuong>;
const DOI_MAC_DINH: Doi = (i) => datCheDoThuongAction(i);

const MO_TA_CHE_DO: Readonly<Record<CheDoThuong, string>> = {
  POLICY: "Campaign có mức hoa hồng RIÊNG, soạn thành chính sách phạm vi «một campaign Affiliate». Phải có ít nhất một chính sách đang hiệu lực mới kích hoạt được campaign.",
  NONE: "Campaign không có mức riêng. Lưu ý: đây KHÔNG phải «đối tác không nhận gì» — chính sách chung (toàn hệ thống, theo nhóm nguồn) vẫn có thể trả cho đối tác theo luật chung; xem ở tab Chính sách.",
};

const TONE_PILL: Record<"success" | "warning" | "danger" | "info" | "muted", PillTone> = { success: "success", warning: "warning", danger: "danger", info: "info", muted: "muted" };

/** `effectiveTo` là biên MỞ (00:00 VN của ngày kế tiếp) ⇒ ngày CUỐI còn áp dụng là ngày trước đó. */
const ngayCuoi = (iso: string): string => ngayHienThi(new Date(new Date(iso).getTime() - 86_400_000).toISOString());

export function KhoiHoaHong({
  campaignId,
  maCampaign,
  capNhatLuc,
  trangThai,
  cheDoThuong,
  phienBan,
  quyen,
  tran,
  hrefTran,
  doi = DOI_MAC_DINH,
}: {
  campaignId: string;
  maCampaign: string;
  /** `updatedAt` của campaign mà người xem ĐÃ THẤY — khoá lạc quan của lệnh đổi lựa chọn. */
  capNhatLuc: string;
  trangThai: TrangThaiCampaign;
  cheDoThuong: CheDoThuong | null;
  /** `null` = người xem KHÔNG có `commission_policies:view` (khác với «chưa có phiên bản nào» = mảng rỗng). */
  phienBan: readonly PhienBanCuaCampaignView[] | null;
  quyen: QuyenHoaHongCampaign;
  /** Trần tổng hiện hành dạng chữ («9%») hoặc `null` khi không đọc được. */
  tran: string | null;
  /** Đường tới Cấu hình vận hành (nâng trần) hoặc `null` khi người xem không có quyền mở. */
  hrefTran: string | null;
  doi?: Doi;
}) {
  const [mo, setMo] = useState<CheDoThuong | null>(null);
  const daKetThuc = trangThai === "ENDED";
  const bamDuoc = quyen.doiCheDo && !daKetThuc;
  const kieu = trangThaiCacKieuTinh();
  const coNhap = (phienBan ?? []).some((p) => p.khoa === "NHAP");

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Thưởng cho campaign này</legend>
        {cheDoThuong === null && (
          <p role="status" className="rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
            <b>Chưa chọn.</b> Ô trống không phải là «không thưởng» — chọn một trong hai bên dưới thì campaign mới kích hoạt được.
          </p>
        )}
        <div role="radiogroup" aria-label="Thưởng cho campaign" className="grid gap-2 md:grid-cols-2">
          {CHE_DO_THUONG.map((c) => {
            const chon = cheDoThuong === c;
            const noiDung = (
              <>
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span aria-hidden className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", chon ? "border-primary" : "border-border")}>
                    {chon && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  {NHAN_CHE_DO_THUONG[c]}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{MO_TA_CHE_DO[c]}</span>
              </>
            );
            const lop = cn("block w-full rounded-lg border px-3 py-2.5 text-left", chon ? "border-primary bg-primary-soft" : "border-border bg-card");
            return bamDuoc && !chon ? (
              <button key={c} type="button" role="radio" aria-checked={false} onClick={() => setMo(c)} className={cn(lop, "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring")}>
                {noiDung}
              </button>
            ) : (
              <div key={c} role="radio" aria-checked={chon} className={lop}>
                {noiDung}
              </div>
            );
          })}
        </div>
        {!quyen.doiCheDo && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Bạn không có quyền đổi lựa chọn này (affiliate_campaigns:manage).
          </p>
        )}
        {quyen.doiCheDo && daKetThuc && <p className="text-sm text-muted-foreground">Campaign đã kết thúc — không đổi lựa chọn thưởng nữa.</p>}
      </fieldset>

      <section aria-label="Chính sách hoa hồng của campaign" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Chính sách hoa hồng riêng của campaign</h3>
        {phienBan === null ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            <Lock aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Bạn chưa có quyền xem chính sách hoa hồng (commission_policies:view) nên không thấy các phiên bản và mức tiền ở đây.
          </p>
        ) : phienBan.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">Chưa có chính sách riêng nào cho campaign này.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {phienBan.map((p) => (
              <li key={p.versionId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <Link href={`/nguon-hoa-hong/chinh-sach/${encodeURIComponent(p.policyId)}`} className="text-primary-ink underline-offset-2 hover:underline">
                      {p.policyCode}
                    </Link>
                    <span className="text-muted-foreground">v{p.versionNo}</span>
                    <StatusPill tone={TONE_PILL[p.tone]} className={INK_THEO_TONE[TONE_PILL[p.tone]]}>
                      {p.nhan}
                    </StatusPill>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Từ {ngayHienThi(p.tuNgay)} {p.denNgay ? `· đến hết ${ngayCuoi(p.denNgay)}` : "· chưa có ngày kết thúc"}
                    {!p.coVanBan && " · chưa gắn văn bản"}
                  </p>
                  {p.mucTien.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-sm text-foreground">
                      {p.mucTien.map((m, i) => (
                        <li key={i}>
                          {m.loaiGd} · {m.vai}: <span className="tabular-nums font-medium">{m.mucTien}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Chưa có quy tắc nào.</p>
                  )}
                </div>
                {quyen.soanChinhSach && p.khoa === "NHAP" && (
                  <Link href={hrefSuaNhapChinhSach(p.policyId, p.versionId)} className={BTN_OUTLINE}>
                    Sửa nháp
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        {quyen.soanChinhSach && !daKetThuc && cheDoThuong !== "NONE" && !coNhap && (
          <Link href={hrefSoanChinhSachCampaign(maCampaign)} className={BTN_PRIMARY}>
            <ExternalLink aria-hidden className="h-4 w-4" />
            Soạn chính sách cho campaign này
          </Link>
        )}
        {quyen.soanChinhSach && cheDoThuong === "NONE" && <p className="text-sm text-muted-foreground">Chọn «{NHAN_CHE_DO_THUONG.POLICY}» để soạn chính sách riêng.</p>}
        {quyen.soanChinhSach && (
          <p className="text-sm text-muted-foreground">
            Soạn, thử tính trên thực thu thật, kiểm hàng rào và kích hoạt đều ở trình soạn chính sách. <b className="text-foreground">Lưu nháp không kích hoạt gì</b> — kích hoạt là bước riêng, cần quyền kích hoạt chính sách.
          </p>
        )}
      </section>

      <section aria-label="Cách tính hoa hồng" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Cách tính — engine có gì, không có gì</h3>
        <ul className="space-y-1 text-sm" aria-label="Kiểu tính">
          {kieu.map((k) => (
            <li key={k.kieu} className={k.dungDuoc ? "text-foreground" : "text-muted-foreground"}>
              <b>{k.nhan}</b> — {k.ghiChu}
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 text-sm">
          {ANH_XA_TRUONG.map((d) => (
            <div key={d.truong} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <dt className={d.coTrongEngine ? "font-medium text-foreground" : "font-medium text-muted-foreground"}>
                {d.truong}
                {!d.coTrongEngine && <span className="ml-1.5 text-xs font-normal">(không có trong engine)</span>}
              </dt>
              <dd className="text-muted-foreground">{d.khaiNiem}</dd>
            </div>
          ))}
        </dl>
        {tran && (
          <p className="text-sm text-muted-foreground">
            Trần tổng hiện hành: <b className="text-foreground">{tran}</b> trên một khoản thu.{" "}
            {hrefTran ? (
              <Link href={hrefTran} className="font-semibold text-primary-ink underline underline-offset-2 hover:no-underline">
                Nâng trần ở Cấu hình vận hành
              </Link>
            ) : (
              "Nâng trần là thao tác của quản trị hệ thống (Cấu hình vận hành)."
            )}
          </p>
        )}
      </section>

      {mo && (
        <HopThoaiLyDo
          tieuDe={`Chọn «${NHAN_CHE_DO_THUONG[mo]}»`}
          moTa={<span className="block">{MO_TA_CHE_DO[mo]}</span>}
          nhanXacNhan="Chọn"
          canLyDo={trangThai === "ACTIVE"}
          lyDoToiThieu={LY_DO_TOI_THIEU_CAMPAIGN}
          thanhCong={`Đã chọn «${NHAN_CHE_DO_THUONG[mo]}».`}
          xacNhan={(lyDo) => doi({ id: campaignId, updatedAtDaThay: capNhatLuc, den: mo, lyDo })}
          dong={() => setMo(null)}
        />
      )}
    </div>
  );
}
