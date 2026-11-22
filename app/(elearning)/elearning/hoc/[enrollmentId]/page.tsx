import Link from "next/link";
import {
  ArrowRight,
  Award,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  Download,
  FileText,
  ListChecks,
  Package,
  PencilLine,
  Users,
  type LucideIcon,
  ArrowLeft,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napDeCuongKhoa } from "@/lib/elearning/course-view";
import { dongHan, trangThaiHienThi } from "@/lib/elearning/dashboard-pure";
import { chonBaiTiepTheo } from "@/lib/elearning/lesson-tree";
import { EmptyState } from "@/components/admin/ui/states";
import { MUC_CHU, TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { TienDo } from "../../_components/ui/tien-do";

/**
 * EL-04 — ĐỀ CƯƠNG MỘT KHOÁ.
 *
 * ⚠️ Route này là ĐÍCH của ba đường dẫn đã tồn tại từ lâu và đang trả 404:
 * thông báo "được giao khoá", thông báo "quá hạn", và chuông việc-chưa-xong. Cả ba
 * trỏ `/elearning/hoc/{enrollmentId}` — một địa chỉ chưa bao giờ có tệp.
 *
 * Hệ quả suốt thời gian đó: người học nhận thông báo được giao bài, bấm vào, gặp
 * trang lỗi; và không có đường nào khác vào bài trừ gõ tay URL hai đoạn — mà họ
 * không biết `lessonId`.
 *
 * Giao diện: đầu trang (tên · trạng thái · tiến độ · hạn · "Tiếp tục học"), khối chứng nhận, cấu trúc chương/bài có biểu
 * tượng loại bài + trạng thái. Điều kiện hoàn thành, số bài bắt buộc, chứng nhận lấy NGUYÊN từ `napDeCuongKhoa`.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khoá học | Sata Robo",
  robots: { index: false, follow: false },
};

const ICON_LOAI: Record<string, LucideIcon> = {
  READ: FileText,
  VIDEO: CirclePlay,
  QUIZ: ListChecks,
  TASK: PencilLine,
  LIVE_SESSION: Users,
  SCORM: Package,
};

export default async function Page({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 text-center text-sm">
        <h1 className="text-lg font-semibold">Chưa đăng nhập</h1>
        <p className="mt-2 text-muted-foreground">Đăng nhập rồi mở lại trang này.</p>
      </main>
    );
  }
  const actor = await resolveActor(session.user.id);
  const { enrollmentId } = await params;
  const kh = await napDeCuongKhoa(scopedDb(actor), {
    enrollmentId,
    userId: session.user.id,
  });

  if (!kh) {
    // Không phân biệt "không có" với "không phải của bạn": nói một câu cho cả hai,
    // vì phân biệt ra là tiết lộ lượt học của người khác có tồn tại.
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          title="Không mở được khoá này"
          description="Có thể lượt học đã bị thu hồi, hoặc đường dẫn không đúng."
          action={
            <Link
              href="/elearning/khoa-cua-toi"
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Về danh sách khoá của tôi
            </Link>
          }
        />
      </div>
    );
  }

  const now = new Date();
  const tt = trangThaiHienThi(kh, now);
  const han = dongHan(kh, now);
  const quaHan = kh.status === "OVERDUE";
  const tiep = chonBaiTiepTheo(kh.chuong.flatMap((c) => c.lessons));
  const batDau = kh.progressPercent === 0 && tiep?.trangThai !== "DANG_HOC";

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <nav aria-label="Vị trí" className="text-sm text-muted-foreground">
        <Link
          href="/elearning/khoa-cua-toi"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-primary-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Khoá của tôi
        </Link>
      </nav>

      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TrangThaiBadge sac={tt.sac}>{tt.nhan}</TrangThaiBadge>
          <span className="text-xs text-muted-foreground">
            {kh.soBaiXong}/{kh.soBaiBatBuoc} bài bắt buộc
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{kh.tenKhoa}</h1>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <TienDo phanTram={kh.progressPercent} nhan={kh.tenKhoa} className="max-w-md" />
              <span className="shrink-0 text-sm font-medium text-foreground">{kh.progressPercent}%</span>
            </div>
            <p className={`mt-1.5 text-sm ${han ? MUC_CHU[han.sac] : "text-muted-foreground"}`}>
              {han ? han.chu : "Khoá đã hoàn thành."}
            </p>
          </div>
          {tiep ? (
            <Link
              href={`/elearning/hoc/${kh.enrollmentId}/${tiep.lessonId}`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {batDau ? "Bắt đầu học" : "Tiếp tục học"}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>

      {quaHan ? (
        <p
          role="status"
          className="rounded-xl bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink"
        >
          Khoá đã quá hạn. Liên hệ phòng Đào tạo nếu cần gia hạn.
        </p>
      ) : null}

      {kh.chungNhan ? (
        // ⚠️ Chứng nhận cấp TỰ ĐỘNG qua hàng đợi sự kiện. Không hiện ở đây thì người
        // học không có cách nào biết mình đã có, và đường tải PDF vừa dựng xong thành một
        // cổng không cửa.
        <section
          aria-label="Chứng nhận"
          className="flex flex-col gap-3 rounded-xl bg-state-success-soft px-4 py-4 text-state-success-ink sm:flex-row sm:items-center"
        >
          <Award className="hidden h-6 w-6 shrink-0 sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Bạn đã có chứng nhận hoàn thành khoá này.</p>
            <p className="mt-0.5 text-sm">
              Số hiệu <span className="font-mono">{kh.chungNhan.certCode}</span>
              {kh.chungNhan.validUntil
                ? ` · có hiệu lực đến ${kh.chungNhan.validUntil.toLocaleDateString("vi-VN")}`
                : " · không thời hạn"}
            </p>
          </div>
          <a
            href={`/api/elearning/chung-nhan?id=${kh.chungNhan.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-state-success-ink/30 bg-card px-4 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="h-4 w-4" aria-hidden />
            Tải bản PDF (có mã QR tra cứu)
          </a>
        </section>
      ) : null}

      {kh.slaGraceDays > 0 ? (
        // ⚠️ Nói cho người học biết hạn của họ ĐÃ được nới, và vì sao. Không nói thì
        // họ thấy một cái hạn khác với hạn ban đầu và tưởng hệ thống tính sai.
        <p className="rounded-xl bg-muted px-4 py-3 text-sm">
          Hạn của bạn đã được nới thêm <strong>{kh.slaGraceDays} ngày làm việc</strong>{" "}
          vì bài nộp phải chờ chấm quá hạn cam kết. Bạn không bị tính trễ vì việc đó.
        </p>
      ) : null}

      <section aria-labelledby="cau-truc-khoa">
        <h2 id="cau-truc-khoa" className="mb-3 text-base font-semibold text-foreground">
          Nội dung khoá
        </h2>
        {kh.chuong.length === 0 ? (
          <EmptyState
            title="Khoá này chưa có bài nào"
            description="Người soạn chưa thêm nội dung. Báo với phòng Đào tạo."
          />
        ) : (
          <ol className="space-y-4">
            {kh.chuong.map((c, i) => (
              <li key={c.moduleId} className="rounded-xl border border-border bg-card">
                <h3 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                  {i + 1}. {c.title}
                </h3>
                {c.lessons.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Chương này chưa có bài nào.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {c.lessons.map((b) => {
                      const Icon = ICON_LOAI[b.kind] ?? FileText;
                      const xong = b.trangThai === "XONG";
                      const noiDung = (
                        <>
                          {xong ? (
                            <CircleCheck className="h-5 w-5 shrink-0 text-state-success-ink" aria-hidden />
                          ) : (
                            <CircleDashed
                              className={`h-5 w-5 shrink-0 ${b.trangThai === "DANG_HOC" ? "text-state-info-ink" : "text-muted-foreground/60"}`}
                              aria-hidden
                            />
                          )}
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm font-medium ${b.moDuoc ? "text-foreground" : "text-muted-foreground"}`}>
                              {b.title}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {b.nhanLoai}
                              {b.batBuoc ? " · bắt buộc" : " · tuỳ chọn"}
                              {/* Không dựng link thì phải NÓI VÌ SAO ngay tại đây. Một dòng chữ xám không bấm được, không
                                  kèm lý do, đọc ra thành "bạn chưa được phép" — trong khi sự thật là bài này giảng viên
                                  điểm danh hộ. */}
                              {b.moDuoc ? "" : b.viSaoKhongMo ? ` · ${b.viSaoKhongMo}` : ""}
                            </span>
                          </span>
                          <TrangThaiBadge sac={xong ? "success" : b.trangThai === "DANG_HOC" ? "info" : "muted"}>
                            {xong ? "Đã xong" : b.trangThai === "DANG_HOC" ? "Đang học" : "Chưa học"}
                          </TrangThaiBadge>
                        </>
                      );
                      return (
                        <li key={b.lessonId}>
                          {b.moDuoc ? (
                            <Link
                              href={`/elearning/hoc/${kh.enrollmentId}/${b.lessonId}`}
                              className="flex min-h-14 items-center gap-3 px-4 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              {noiDung}
                            </Link>
                          ) : (
                            <div className="flex min-h-14 items-center gap-3 px-4 py-2">{noiDung}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
