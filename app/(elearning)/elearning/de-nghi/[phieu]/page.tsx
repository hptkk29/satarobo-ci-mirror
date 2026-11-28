import Link from "next/link";
import { ArrowLeft, CircleCheck, CircleDashed } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { dongThoiGianPhieu, nhanQuy, nhanTrangThaiPhieu } from "@/lib/elearning/de-nghi-pure";
import { napPhieuChiTiet } from "@/lib/elearning/de-nghi-view";
import { EmptyState } from "@/components/admin/ui/states";
import { ChamTrangThai } from "../../_components/ui/trang-thai-nhom";

/**
 * CHI TIẾT MỘT ĐỀ NGHỊ (chỉ xem) — của CHÍNH người gửi. Phiếu của người khác ≡ mã không tồn tại.
 * Không có "Rút đề nghị" / lý do từ chối / tên người đang xem: mô hình chưa có (Q14, BLOCKERS B-06) — không vẽ lời hứa.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chi tiết đề nghị | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const gio = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(d);

export default async function ChiTietDeNghiPage({ params }: { params: Promise<{ phieu: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</main>;
  }
  const { phieu } = await params;
  const actor = await resolveActor(session.user.id);
  const p = await napPhieuChiTiet(scopedDb(actor), { code: decodeURIComponent(phieu), userId: session.user.id });

  if (!p) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          title="Không mở được đề nghị này"
          description="Mã không đúng, hoặc đề nghị không phải của bạn."
          action={
            <Link
              href="/elearning/de-nghi"
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Về đề nghị đào tạo
            </Link>
          }
        />
      </div>
    );
  }

  const tt = nhanTrangThaiPhieu(p.status);
  const buoc = dongThoiGianPhieu(p);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <nav aria-label="Vị trí" className="text-sm">
        <Link
          href="/elearning/de-nghi"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-primary-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Đề nghị đào tạo
        </Link>
      </nav>

      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <ChamTrangThai nhom={tt.nhom} nhan={tt.nhan} />
          <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{p.title}</h1>
      </header>

      <dl className="grid gap-4 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Đối tượng</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{p.targetGroupText}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Lý do</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{p.reason}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Kết quả mong đợi</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{p.expectedOutcome}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Quý dự kiến</dt>
          <dd className="mt-0.5 font-medium text-foreground">{nhanQuy(p.proposedQuarter)}</dd>
        </div>
      </dl>

      <section aria-labelledby="tien-trinh" className="rounded-xl border border-border bg-card p-5">
        <h2 id="tien-trinh" className="text-base font-semibold text-foreground">
          Tiến trình
        </h2>
        <ol className="mt-3 space-y-3">
          {buoc.map((b) => (
            <li key={b.id} className="flex items-start gap-3 text-sm">
              {b.xong ? (
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-state-success-ink" aria-hidden />
              ) : (
                <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden />
              )}
              <span className="min-w-0">
                <span className={`block font-medium ${b.xong ? "text-foreground" : "text-muted-foreground"}`}>
                  {b.nhan}
                  {b.thoiDiem ? <span className="font-normal text-muted-foreground"> · {gio(b.thoiDiem)}</span> : null}
                </span>
                {b.chiTiet ? <span className="block text-xs text-muted-foreground">{b.chiTiet}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
