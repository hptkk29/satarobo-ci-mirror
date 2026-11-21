import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import type { LuotDisc } from "@/lib/disc/portal-doc";
import { RadarDisc, ThanhDiem } from "./bieu-do-disc";
import { GhiChuXuHuong, NHAN_VAI, ngayVN } from "./tong-quan-disc";

const nhanBac = (b: string | null) => (b ? (b === "MN" ? "Mầm non" : `Lớp ${b}`) : null);

/** Chi tiết MỘT lần làm: kết quả từng người + nút tải lại báo cáo (HTML in được). */
export function ChiTietLuotDisc({ luot, coBaoCao }: { luot: LuotDisc; coBaoCao: boolean }) {
  return (
    <div className="portal-v2">
      <Link href="/portal/disc" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Tất cả kết quả DISC
      </Link>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">Kết quả ngày {ngayVN(luot.taoLuc)}</h2>
        {coBaoCao && (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/portal/disc/${luot.id}/bao-cao`}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted/50"
            >
              <Download aria-hidden className="size-4" />
              Mở báo cáo để in
            </a>
          </div>
        )}
      </div>
      <div className="mt-3">
        <GhiChuXuHuong />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {luot.nguoi.map((n) => (
          <article key={`${n.vaiTro}-${n.hoTen}`} className="min-w-0 rounded-2xl border border-border bg-card p-4" aria-label={`${NHAN_VAI[n.vaiTro]} ${n.hoTen}`} data-nguoi-chi-tiet={n.vaiTro}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{NHAN_VAI[n.vaiTro]}</p>
            <h3 className="break-words text-base font-bold text-foreground">{n.hoTen}</h3>
            <p className="text-xs text-muted-foreground">
              Năm sinh {n.namSinh}
              {nhanBac(n.bacHoc) ? ` · ${nhanBac(n.bacHoc)}` : ""}
              {n.nguoiLonQuanSat ? " · Người lớn quan sát và trả lời hộ" : ""}
            </p>
            {n.diem ? (
              <div className="mt-3 grid items-center gap-4 sm:grid-cols-[minmax(0,180px)_1fr]">
                <RadarDisc diem={n.diem} ten={n.hoTen} />
                <ThanhDiem diem={n.diem} ten={n.hoTen} />
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground" data-khong-doc-duoc>
                Không đọc được điểm của lần làm này. Vui lòng liên hệ trung tâm để được hỗ trợ.
              </p>
            )}
            {n.maBoDe && <p className="mt-3 text-xs text-muted-foreground">Bộ câu hỏi {n.maBoDe} · phiên bản {n.phienBanBoDe}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
