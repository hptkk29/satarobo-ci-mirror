import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napKhoaCuaToi } from "@/lib/elearning/course-view";
import {
  LOC_TRANG_THAI,
  SAP_XEP,
  docLoc,
  docSapXep,
  locSapXepKhoa,
  type LocTrangThai,
  type SapXep,
} from "@/lib/elearning/dashboard-pure";
import { EmptyState } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { TheKhoa } from "../_components/ui/the-khoa";

/**
 * KHOÁ CỦA TÔI — danh sách đầy đủ có tìm, lọc theo trạng thái, sắp xếp, phân trang.
 *
 * Mọi trạng thái nằm trên URL (chia sẻ được, F5 giữ nguyên, nút Quay lại hoạt động) và trang chạy được KHÔNG cần
 * JavaScript (biểu mẫu GET + liên kết). Dữ liệu từ `napKhoaCuaToi` — cùng nguồn với trang Tổng quan (không số liệu riêng).
 * Ô tìm trên thanh trên cùng trỏ vào đây (`?q=`).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khoá của tôi | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

type SP = { tt?: string; q?: string; sx?: string; p?: string };

function href(o: { tt: LocTrangThai; q: string; sx: SapXep; p?: number }): string {
  const sp = new URLSearchParams();
  if (o.tt !== "tat-ca") sp.set("tt", o.tt);
  if (o.q) sp.set("q", o.q);
  if (o.sx !== "han") sp.set("sx", o.sx);
  if (o.p && o.p > 1) sp.set("p", String(o.p));
  const qs = sp.toString();
  return qs ? `/elearning/khoa-cua-toi?${qs}` : "/elearning/khoa-cua-toi";
}

export default async function KhoaCuaToiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </main>
    );
  }
  const sp = await searchParams;
  const tt = docLoc(sp.tt);
  const sx = docSapXep(sp.sx);
  const q = (sp.q ?? "").slice(0, 100).trim();
  const trangYeuCau = Number.parseInt(sp.p ?? "1", 10);

  const actor = await resolveActor(session.user.id);
  const khoa = await napKhoaCuaToi(scopedDb(actor), session.user.id);
  const now = new Date();
  const kq = locSapXepKhoa(khoa, { loc: tt, q, sapXep: sx, trang: trangYeuCau }, now);
  const dangLoc = tt !== "tat-ca" || q !== "";

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Khoá của tôi"
        subtitle="Những khoá được giao cho bạn. Việc cần làm sớm nhất xếp lên trước."
      />

      {khoa.length === 0 ? (
        <EmptyState
          title="Bạn chưa được giao khoá nào"
          description="Phòng Đào tạo là nơi giao khoá học. Liên hệ phòng Đào tạo nếu bạn nghĩ đây là nhầm lẫn."
        />
      ) : (
        <>
          <nav aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
            {LOC_TRANG_THAI.map((l) => {
              const mo = l.ma === tt;
              return (
                <Link
                  key={l.ma}
                  href={href({ tt: l.ma, q, sx })}
                  aria-current={mo ? "true" : undefined}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                    mo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  {l.nhan}
                  <span className={mo ? "text-primary-foreground/80" : "text-muted-foreground"}>{kq.dem[l.ma]}</span>
                </Link>
              );
            })}
          </nav>

          <form action="/elearning/khoa-cua-toi" method="GET" role="search" className="flex flex-wrap items-center gap-2">
            {tt !== "tat-ca" ? <input type="hidden" name="tt" value={tt} /> : null}
            <div className="relative min-w-0 flex-1 basis-60">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Tìm theo tên khoá"
                aria-label="Tìm theo tên khoá"
                className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Sắp xếp</span>
              <select
                name="sx"
                defaultValue={sx}
                className="h-10 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SAP_XEP.map((s) => (
                  <option key={s.ma} value={s.ma}>
                    {s.nhan}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Áp dụng
            </button>
            {dangLoc ? (
              <Link
                href="/elearning/khoa-cua-toi"
                className="rounded text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xoá bộ lọc
              </Link>
            ) : null}
          </form>

          {kq.tong === 0 ? (
            // Lọc không ra ≠ chưa được giao: nói đúng bộ lọc đang áp và cho đường thoát.
            <EmptyState
              title="Không có khoá nào khớp bộ lọc"
              description={
                q
                  ? `Không có khoá nào tên có “${q}”${tt !== "tat-ca" ? " trong trạng thái đang chọn" : ""}.`
                  : "Không có khoá nào ở trạng thái này."
              }
              action={
                <Link
                  href="/elearning/khoa-cua-toi"
                  className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Xoá bộ lọc
                </Link>
              }
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {kq.tong} khoá{dangLoc ? " khớp bộ lọc" : ""}
              </p>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {kq.dong.map((k) => (
                  <li key={k.enrollmentId} className="min-w-0">
                    <TheKhoa khoa={k} now={now} />
                  </li>
                ))}
              </ul>

              {kq.tongTrang > 1 ? (
                <nav aria-label="Phân trang" className="flex items-center justify-between gap-3">
                  {kq.trang > 1 ? (
                    <Link
                      href={href({ tt, q, sx, p: kq.trang - 1 })}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden /> Trang trước
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-sm text-muted-foreground">
                    Trang {kq.trang}/{kq.tongTrang}
                  </span>
                  {kq.trang < kq.tongTrang ? (
                    <Link
                      href={href({ tt, q, sx, p: kq.trang + 1 })}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Trang sau <ChevronRight className="h-4 w-4" aria-hidden />
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          )}
        </>
      )}
    </main>
  );
}
