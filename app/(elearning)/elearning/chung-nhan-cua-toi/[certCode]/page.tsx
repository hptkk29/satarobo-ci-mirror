import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import QRCode from "qrcode";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { elearningHomeUrl } from "@/lib/auth/hosts";
import { scopedDb } from "@/lib/db-scope";
import { moHinhChungNhan, napChungNhanXem } from "@/lib/elearning/certificate-view";
import { gocXacThuc } from "@/lib/elearning/verify-origin";
import { EmptyState } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";

/**
 * XEM CHỨNG NHẬN của chính tôi theo số hiệu. Cùng `moHinhChungNhan` với bản PDF ⇒ trang xem và tờ in không thể lệch.
 *
 * Người khác gõ số hiệu của bạn nhận đúng một câu "Không mở được chứng nhận này", giống số hiệu không tồn tại — không tiết lộ
 * số hiệu có thật (`napChungNhanXem` đặt `userId` trong `where`).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Xem chứng nhận | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const SAC = { VALID: "success", EXPIRED: "warning", REVOKED: "danger" } as const;
const NHAN = { VALID: "Còn hiệu lực", EXPIRED: "Hết hiệu lực", REVOKED: "Đã thu hồi" } as const;

export default async function XemChungNhanPage({ params }: { params: Promise<{ certCode: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</main>;
  }
  const { certCode } = await params;
  const actor = await resolveActor(session.user.id);
  const kq = await napChungNhanXem(scopedDb(actor), { certCode: decodeURIComponent(certCode), userId: session.user.id });

  if (!kq) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <EmptyState
          title="Không mở được chứng nhận này"
          description="Số hiệu không đúng, hoặc chứng nhận không phải của bạn."
          action={
            <Link
              href="/elearning/chung-nhan-cua-toi"
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Về chứng nhận của tôi
            </Link>
          }
        />
      </div>
    );
  }

  const mh = moHinhChungNhan(kq.cn, kq.tenKhoa, new Date());
  // Cùng cách dựng địa chỉ tra cứu và QR với bản PDF (route sinh QR tại chỗ từ `verifyToken`, không lưu ảnh).
  const verifyUrl = `${gocXacThuc(elearningHomeUrl())}/xac-thuc/${kq.cn.verifyToken}`;
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 288, errorCorrectionLevel: "M" });

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <nav aria-label="Vị trí" className="text-sm">
        <Link
          href="/elearning/chung-nhan-cua-toi"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-primary-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Chứng nhận của tôi
        </Link>
      </nav>

      <article aria-label="Chứng nhận" className="rounded-2xl border border-border bg-card p-6 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Chứng nhận hoàn thành khoá học</p>
          <TrangThaiBadge sac={SAC[mh.trangThai]}>{NHAN[mh.trangThai]}</TrangThaiBadge>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Chứng nhận</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{mh.studentName}</h1>
        {mh.studentCode ? <p className="text-sm text-muted-foreground">Mã nhân viên {mh.studentCode}</p> : null}
        <p className="mt-5 text-sm text-muted-foreground">đã hoàn thành khoá</p>
        <p className="mt-1 text-lg font-semibold text-foreground">{mh.courseName}</p>

        <dl className="mt-6 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Số hiệu</dt>
            <dd className="mt-0.5 font-mono font-medium text-foreground">{mh.certificateCode}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ngày cấp</dt>
            <dd className="mt-0.5 font-medium text-foreground">{mh.completedAt}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Hiệu lực</dt>
            <dd className="mt-0.5 font-medium text-foreground">{mh.validityLine}</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-col items-start gap-4 border-t border-border pt-5 sm:flex-row sm:items-center">
          {/* QR là data URL sinh tại server từ verifyToken — không phải ảnh từ nguồn ngoài nên dùng thẻ img thường là đủ. */}
          <Image src={qr} alt="Mã QR tra cứu chứng nhận" width={96} height={96} unoptimized className="h-24 w-24 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Quét mã để mở trang xác minh công khai. Người xem chỉ thấy tên, khoá học, số hiệu và tình trạng hiệu lực.
          </p>
        </div>
      </article>

      <div className="flex flex-wrap gap-2">
        {mh.trangThai === "REVOKED" ? null : (
          <a
            href={`/api/elearning/chung-nhan?id=${kq.cn.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            Tải bản PDF
          </a>
        )}
        <a
          href={verifyUrl}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Mở trang xác minh
        </a>
      </div>
    </main>
  );
}
