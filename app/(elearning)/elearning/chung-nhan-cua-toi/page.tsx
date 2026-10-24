import Link from "next/link";
import { Award, Download } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { cauTrangThai } from "@/lib/elearning/certificate";
import { napChungNhanCuaToi } from "@/lib/elearning/certificate-mine";
import type { SacThai } from "@/lib/elearning/dashboard-pure";
import { EmptyState } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";

/**
 * CHỨNG NHẬN CỦA TÔI — chứng nhận chính chủ, tải PDF qua route sẵn có (`/api/elearning/chung-nhan?id=`; route tự kiểm
 * chính chủ + phiên còn sống). Màn quản lý chứng nhận của phòng Đào tạo/HR là `/elearning/chung-nhan`, khác màn này.
 *
 * Trạng thái suy từ `validUntil` chứ không đọc cột `status` (cột đệm do cron cập nhật hằng ngày) — xem `certificate-mine.ts`.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chứng nhận của tôi | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN: Record<string, { nhan: string; sac: SacThai }> = {
  VALID: { nhan: "Còn hiệu lực", sac: "success" },
  EXPIRED: { nhan: "Hết hiệu lực", sac: "warning" },
  REVOKED: { nhan: "Đã thu hồi", sac: "danger" },
};

const ngay = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);

export default async function ChungNhanCuaToiPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </main>
    );
  }
  const actor = await resolveActor(session.user.id);
  const ds = await napChungNhanCuaToi(scopedDb(actor), session.user.id, new Date());

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Chứng nhận của tôi"
        subtitle="Chứng nhận được cấp khi bạn hoàn thành khoá. Bản PDF có mã QR để người khác kiểm tra tính xác thực."
      />

      {ds.length === 0 ? (
        <EmptyState
          title="Bạn chưa có chứng nhận nào"
          description="Chứng nhận được cấp tự động sau khi bạn hoàn thành một khoá có cấp chứng nhận. Xem các khoá đang học để biết còn thiếu gì."
          action={
            <Link
              href="/elearning/khoa-cua-toi"
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Xem khoá của tôi
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {ds.map((c) => {
            const t = NHAN[c.trangThai] ?? { nhan: c.trangThai, sac: "muted" as const };
            return (
              <li
                key={c.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
              >
                <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-ink sm:flex">
                  <Award className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-foreground">{c.tenKhoa}</p>
                    <TrangThaiBadge sac={t.sac}>{t.nhan}</TrangThaiBadge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Số hiệu <span className="font-mono text-foreground">{c.certCode}</span> · cấp ngày {ngay(c.issuedAt)}
                  </p>
                  <p className="text-sm text-muted-foreground">{cauTrangThai(c.trangThai, c)}</p>
                </div>
                {c.trangThai === "REVOKED" ? null : (
                  <a
                    href={`/api/elearning/chung-nhan?id=${c.id}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Tải PDF
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
