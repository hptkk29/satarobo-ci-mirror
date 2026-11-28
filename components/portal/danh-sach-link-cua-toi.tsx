// components/portal/danh-sach-link-cua-toi.tsx — DANH SÁCH LINK CỦA CHÍNH NGƯỜI XEM (trạng thái · trang đích · lượt bấm · referral · URL cuối · link ngắn + QR).
//
// MỘT nơi vẽ cho cả cổng phụ huynh (`gioi-thieu-page.tsx`) và màn «Link giới thiệu của tôi» của nhân sự (admin) — hai màn không được nói khác nhau về cùng một link (luật 12b).
// `taoQr` TIÊM được: mỗi màn truyền Server Action xin QR của CHÍNH nó (action đó tự kiểm link thuộc người đăng nhập); bỏ trống = action của cổng phụ huynh.
import { NutQrLinkCuaToi, type TaoQr } from "@/components/portal/nut-qr-link-cua-toi";
import { NutSaoChepLink } from "@/components/portal/nut-sao-chep-link";
import type { LinkCuaToi } from "@/lib/affiliate/cua-toi";
import { dinhDangSo } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const so = (n: number) => dinhDangSo(n);

export function DanhSachLinkCuaToi({ link, coGocLinkNgan, taoQr }: { link: readonly LinkCuaToi[]; coGocLinkNgan: boolean; taoQr?: TaoQr }) {
  return (
    <ul className="space-y-3">
      {link.map((l, i) => (
        <li key={i} data-link className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-sm font-semibold text-foreground">
              {l.website}
              {l.nhan && <span className="ml-2 font-normal text-muted-foreground">· {l.nhan}</span>}
            </p>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", l.hoatDong ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground")}>
              {l.hoatDong ? "Đang dùng" : "Đã thu hồi"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Trang đích <span className="font-mono">{l.trangDich}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span data-so-luot-bam className="tabular-nums">{so(l.soLuotBam)}</span> lượt bấm
            {l.soLuotBamLoi > 0 && <> (+ <span className="tabular-nums">{so(l.soLuotBamLoi)}</span> lượt vào khi link không dùng được)</>}
            {" · "}
            <span data-so-referral className="tabular-nums">{so(l.soReferral)}</span> referral
          </p>
          {l.lyDoKhongDung && (
            <p role="status" data-link-tam-ngung className="mt-2 text-xs text-state-warning-ink">
              Link tạm chưa ghi nhận khách: {l.lyDoKhongDung}
            </p>
          )}
          {l.hoatDong && l.urlCuoi && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">URL cuối (nơi khách đến)</p>
              <div className="flex flex-wrap items-start gap-3">
                <code data-url-cuoi className="min-w-0 flex-1 basis-60 select-all break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
                  {l.urlCuoi}
                </code>
                <NutSaoChepLink diaChi={l.urlCuoi} nhan={`link ${l.website}`} />
              </div>
            </div>
          )}
          {l.hoatDong && l.lienKetNgan && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Link ngắn (in ấn, QR — đếm được lượt bấm)</p>
              <div className="flex flex-wrap items-start gap-3">
                <code data-dia-chi className="min-w-0 flex-1 basis-60 select-all break-all rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
                  {l.lienKetNgan}
                </code>
                <NutSaoChepLink diaChi={l.lienKetNgan} nhan={`link ngắn ${l.website}`} />
                <NutQrLinkCuaToi id={l.id} nhan={l.website} {...(taoQr ? { taoQr } : {})} />
              </div>
            </div>
          )}
          {l.hoatDong && !l.lienKetNgan && !coGocLinkNgan && (
            <p data-thieu-goc className="mt-3 text-xs text-state-warning-ink">
              Chưa có link ngắn / mã QR (hệ thống chưa cấu hình địa chỉ công khai) — dùng URL cuối ở trên.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
