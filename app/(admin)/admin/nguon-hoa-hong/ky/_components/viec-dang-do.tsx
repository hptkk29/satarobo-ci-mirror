// app/(admin)/admin/nguon-hoa-hong/ky/_components/viec-dang-do.tsx — "Việc còn dang dở" của kỳ đang chọn (06 §5.4): chỗ cấu trúc "Hàng chờ trước sổ" tụ lại.
//
// MỘT thẻ, ba nhóm, không thẻ lồng thẻ:
//   1. CHẶN — chỉ những thứ làm cổng server từ chối chuyển trạng thái: hàng chờ có `blockingPeriodId` = kỳ này, và đầu vào đổi sau lần Tính. Số và câu lấy từ
//      CÙNG nguồn với cổng (`demHangChoChan` · `dauVaoMoiNhat`), nên "còn 3 khoản chờ duyệt tay" ở đây và "Còn 3 hàng chờ đang chặn khoá kỳ" của server là MỘT con số.
//   2. CHỜ CHI — kỳ đã xuất nhưng lô chưa đánh dấu đã chi.
//   3. KHÔNG CHẶN — thông tin: vai chưa có người nhận, việc ở tab Nguồn / Chính sách. Nói rõ "không chặn" để kế toán khỏi dừng việc vì chúng.
// Khiếu nại KHÔNG chặn khoá (04 §12.1) và bảng khiếu nại chưa có (PR11) ⇒ không vẽ dòng nào về khiếu nại: một "0 khiếu nại" ở đây là con số bịa.
import Link from "next/link";
import { CircleCheck, CircleDot, TriangleAlert } from "lucide-react";

import type { TrangThaiKy } from "@/lib/hoa-hong/ky-hoa-hong";
import { type MucChan } from "@/lib/hoa-hong/ky-man-hinh";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";

export type LienKet = { href: string; nhan: string } | null;

export type DuLieuViecDangDo = {
  trangThai: TrangThaiKy;
  mucChan: MucChan[];
  /** Đầu vào đổi sau lần Tính (vế (b) của cổng): có thì mang theo ngày của lần Tính. */
  troi: { ngayTinh: string | null } | null;
  /** Liên kết sang tab Sổ cho từng mục chặn — null khi người xem không mở được tab Sổ (luật 12: không vẽ link chết). */
  hrefSo: (m: MucChan) => string | null;
  loChoChi: { nhan: string; soDong: number; tongTien: number; taoLuc: string }[];
  /** Nhóm «Chưa phân giải người hưởng» (không chặn khoá). `null` = người xem không đọc được hàng chờ ⇒ không vẽ dòng. */
  treo: number | null;
  hrefSoTreo: string | null;
  nguon: { so: number; lienKet: LienKet } | null;
  chinhSach: { so: number; lienKet: LienKet } | null;
  /**
   * Trong số hàng chờ CHẶN, bao nhiêu khoản DỜI ĐƯỢC sang kỳ sau (cùng tập mã với nút ở tab Sổ — `MA_DOI_DUOC_SANG_KY_SAU`) + liên kết sang chỗ có nút.
   * `null` = người xem KHÔNG có nút để bấm (thiếu quyền quản lý kỳ, hoặc không mở được hàng chờ ở tab Sổ) hoặc chẳng khoản nào dời được ⇒ không một câu nào nhắc "dời sang kỳ sau" (luật 12: không hứa điều không làm được).
   */
  doiDuoc: { so: number; href: string } | null;
};

const DANG_TINH: ReadonlySet<TrangThaiKy> = new Set<TrangThaiKy>(["OPEN", "CALCULATED", "REVIEWING"]);

export function ViecDangDo({ d }: { d: DuLieuViecDangDo }) {
  const coChan = d.mucChan.length > 0 || d.troi !== null;
  const tongChan = d.mucChan.reduce((s, m) => s + m.soLuong, 0);
  const thongTin: { khoa: string; noiDung: React.ReactNode }[] = [];
  if (d.treo !== null && d.treo > 0) {
    thongTin.push({
      khoa: "treo",
      noiDung: (
        <>
          <b className="tabular-nums text-foreground">{d.treo}</b> vai chưa có người nhận (vd đơn không có lead) — chưa sinh dòng hoa hồng.{" "}
          {d.hrefSoTreo && (
            <Link href={d.hrefSoTreo} className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              Xem ở tab Sổ
            </Link>
          )}
        </>
      ),
    });
  }
  if (d.nguon && d.nguon.so > 0) {
    thongTin.push({
      khoa: "nguon",
      noiDung: (
        <>
          Tab Nguồn còn <b className="tabular-nums text-foreground">{d.nguon.so}</b> việc cần xử lý.{" "}
          {d.nguon.lienKet && (
            <Link href={d.nguon.lienKet.href} className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {d.nguon.lienKet.nhan}
            </Link>
          )}
        </>
      ),
    });
  }
  if (d.chinhSach && d.chinhSach.so > 0) {
    thongTin.push({
      khoa: "chinh-sach",
      noiDung: (
        <>
          Tab Chính sách còn <b className="tabular-nums text-foreground">{d.chinhSach.so}</b> việc cần xử lý.{" "}
          {d.chinhSach.lienKet && (
            <Link href={d.chinhSach.lienKet.href} className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {d.chinhSach.lienKet.nhan}
            </Link>
          )}
        </>
      ),
    });
  }

  return (
    <section aria-label="Việc còn dang dở" className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">Việc còn dang dở</h2>

      {DANG_TINH.has(d.trangThai) &&
        (coChan ? (
          <div className="mt-2" data-nhom="chan">
            <p className="flex items-start gap-2 text-sm font-medium text-state-warning-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {d.mucChan.length > 0 ? "Chặn khoá kỳ" : "Đầu vào đã đổi sau lần Tính"}
                {tongChan > 0 && <span className="font-normal text-muted-foreground"> — xử lý xong mới khoá được. Không có cách khoá bỏ qua.</span>}
              </span>
            </p>
            <ul className="mt-1.5 flex flex-col divide-y divide-border/60 text-sm">
              {d.mucChan.map((m) => {
                const href = d.hrefSo(m);
                return (
                  <li key={m.nhan} className="flex items-center justify-between gap-3 py-1.5">
                    <span>
                      <b className="tabular-nums">{m.soLuong}</b> khoản {m.nhan}
                    </span>
                    {href && (
                      <Link href={href} className="whitespace-nowrap font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                        Xem ở tab Sổ
                      </Link>
                    )}
                  </li>
                );
              })}
              {d.troi && (
                <li className="py-1.5">
                  Dữ liệu đầu vào (lead, đơn, nhân sự, nguồn…) đã đổi sau lần Tính{d.troi.ngayTinh ? ` ${d.troi.ngayTinh}` : ""} — Tính lại để số khớp.
                </li>
              )}
            </ul>
            {d.doiDuoc && d.mucChan.length > 0 && (
              <p data-doi-duoc className="mt-1.5 text-sm text-muted-foreground">
                <b className="tabular-nums text-foreground">{d.doiDuoc.so}</b> khoản trong số này có thể dời sang kỳ sau (chờ văn bản hoặc chờ người quyết).{" "}
                <Link href={d.doiDuoc.href} className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  Mở tab Sổ để dời
                </Link>
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-sm text-state-success-ink" data-nhom="chan">
            <CircleCheck aria-hidden className="h-4 w-4 shrink-0" />
            Không còn gì chặn khoá kỳ này.
          </p>
        ))}

      {d.loChoChi.length > 0 && (
        <div className="mt-3" data-nhom="cho-chi">
          <p className="flex items-center gap-2 text-sm font-medium text-state-warning-ink">
            <CircleDot aria-hidden className="h-4 w-4 shrink-0" />
            Đã xuất bảng chi, chờ đánh dấu đã chi
          </p>
          <ul className="mt-1.5 flex flex-col divide-y divide-border/60 text-sm">
            {d.loChoChi.map((l) => (
              <li key={`${l.nhan}-${l.taoLuc}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span>
                  <b>{l.nhan}</b> · {l.soDong} dòng sổ
                </span>
                <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {dinhDangDong(l.tongTien)} · xuất {l.taoLuc}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {thongTin.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-2.5" data-nhom="khong-chan">
          <p className="text-xs font-semibold text-muted-foreground">Không chặn khoá kỳ</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
            {thongTin.map((t) => (
              <li key={t.khoa}>{t.noiDung}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
