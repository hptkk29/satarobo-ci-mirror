import Link from "next/link";
import { ArrowLeft, ArrowRight, Award, CircleHelp, ClipboardList, FileQuestion, GraduationCap, Library, ListChecks, Send } from "lucide-react";
import { TieuDeTrang } from "./ui/tieu-de-trang";
import { QuayLai, TrangQuanTri } from "./ui/trang";
import { DANH_SACH_HUONG_DAN, DUONG_HUONG_DAN, timHuongDan, type KhuHuongDan } from "@/lib/elearning/huong-dan";

/**
 * P8 — giao diện HƯỚNG DẪN SỬ DỤNG (danh sách + chi tiết) cho cả hai khu. Server component thuần: nội dung ở `lib/elearning/huong-dan.ts`.
 * Không có ảnh chụp có vòng đỏ như thiết kế (cần chụp + chú thích thật cho từng bước) — xem DECISIONS D-25.
 */

const BIEU_TUONG: Record<string, typeof GraduationCap> = {
  "hoc-khoa": GraduationCap,
  "kiem-tra": FileQuestion,
  "bai-tap": ClipboardList,
  "chung-nhan": Award,
  "soan-khoa": Library,
  "giao-khoa": Send,
  "cham-bai": ListChecks,
  "cau-hoi": CircleHelp,
};

export function HuongDanDanhSach({ khu }: { khu: KhuHuongDan }) {
  const ds = DANH_SACH_HUONG_DAN[khu];
  return (
    <TrangQuanTri rong="vua">
      <TieuDeTrang
        title="Hướng dẫn sử dụng"
        subtitle={`Mỗi bài vài bước ngắn cho những việc ${khu === "nhan-vien" ? "nhân viên" : "quản trị"} hay làm nhất.`}
      />
      <ul aria-label="Các bài hướng dẫn" className="mt-6 grid gap-4 sm:grid-cols-2">
        {ds.map((b) => {
          const Icon = BIEU_TUONG[b.slug] ?? CircleHelp;
          return (
            <li key={b.slug}>
              <Link
                href={`${DUONG_HUONG_DAN[khu]}/${b.slug}`}
                className="flex h-full items-start gap-4 rounded-xl border border-border bg-card p-4 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="mt-0.5 h-6 w-6 shrink-0 text-primary-ink" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-foreground">{b.tieuDe}</span>
                  <span className="block text-sm text-muted-foreground">{b.moTa}</span>
                  <span className="mt-2 block text-[13px] text-muted-foreground">{b.buoc.length} bước</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {khu === "nhan-vien" ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Chưa thấy việc bạn cần? Gửi câu hỏi cho phòng Đào tạo ở mục{" "}
          <Link href="/elearning/de-nghi" className="font-medium text-primary-ink underline-offset-2 hover:underline">
            Đề nghị đào tạo
          </Link>
          .
        </p>
      ) : null}
    </TrangQuanTri>
  );
}

export function HuongDanChiTiet({ khu, slug }: { khu: KhuHuongDan; slug: string }) {
  const kq = timHuongDan(khu, slug);
  if (!kq) return null;
  const { bai, truoc, tiep } = kq;
  const goc = DUONG_HUONG_DAN[khu];
  return (
    <TrangQuanTri rong="hep">
      <div>
        <QuayLai href={goc}>Hướng dẫn sử dụng</QuayLai>
        <TieuDeTrang className="mb-0 mt-1" title={bai.tieuDe} subtitle={bai.moTa} />
        <p className="mt-3 text-[13px] text-muted-foreground">
          {bai.buoc.length} bước · khoảng {bai.phut} phút
        </p>
      </div>
      <ol aria-label="Các bước" className="mt-6 border-t border-border">
        {bai.buoc.map((b, i) => (
          <li key={b.tieuDe} className="flex gap-4 border-b border-border py-4">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">{b.tieuDe}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{b.moTa}</p>
            </div>
          </li>
        ))}
      </ol>
      <nav aria-label="Chuyển bài hướng dẫn" className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        {truoc ? (
          <Link href={`${goc}/${truoc.slug}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 font-medium text-foreground hover:bg-muted">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Bài trước: {truoc.tieuDe}
          </Link>
        ) : (
          <span />
        )}
        {tiep ? (
          <Link href={`${goc}/${tiep.slug}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 font-medium text-foreground hover:bg-muted">
            Bài tiếp: {tiep.tieuDe} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <Link href={goc} className="inline-flex min-h-10 items-center rounded-lg px-2 font-medium text-foreground hover:bg-muted">
            Về danh sách hướng dẫn
          </Link>
        )}
      </nav>
    </TrangQuanTri>
  );
}
