// Khối "Nhận xét buổi học & học bạ" trên hồ sơ học viên (26/09/2026) — THAY khối "Hồ sơ năng
// lực robotics". Chủ dự án 26/09: "thay đổi phần hồ sơ năng lực thành phần tóm tắt nhận xét
// các buổi của học viên + học bạ".
//
// Chỉ HIỂN THỊ — mọi dữ liệu do trang đọc (`[id]/edit/page.tsx`) và đọc bằng ĐÚNG hàm của màn
// gốc (luật 12b: đọc số của màn đã có, không dựng lại):
//   · nhận xét buổi   ← `getStudentFeedback` (lib/portal/feedback.ts) — cùng hàm cổng phụ huynh
//                       dùng, nên số buổi / tiêu đề khớp đúng thứ phụ huynh và giáo viên thấy;
//   · học bạ năng lực ← `ReportCard` theo từng ghi danh (màn /report-cards/<enrollmentId>);
//   · học bạ tổng hợp ← link sang /hoc-ba?studentId=… (màn có sẵn, xuất PDF).
// Mỗi phần có cổng quyền RIÊNG của màn gốc; `null` = người xem không có quyền ⇒ không vẽ.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { REPORT_CARD_STATUS_LABEL, type ReportCardStatusValue } from "@/lib/lms/report-card-core";
import { cn } from "@/lib/utils";

export type DongNhanXet = {
  id: string;
  /** Buổi thứ mấy của lớp (khớp site GV + cổng PH); null khi không tra được. */
  buoi: number | null;
  tieuDe: string;
  /** dd/MM/yyyy */
  ngay: string;
  lop: string | null;
  giaoVien: string | null;
  duAn: string | null;
  /** Đánh giá chung, rỗng thì nhận xét cũ — đã cắt khoảng trắng. */
  noiDung: string;
};

export type DongHocBa = {
  enrollmentId: string;
  lop: string;
  trangThai: ReportCardStatusValue;
  /** dd/MM/yyyy — chỉ khi đã phát hành. */
  ngayPhatHanh: string | null;
  nhanXetCuoi: string | null;
};

const MAU_TRANG_THAI: Record<ReportCardStatusValue, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_REVIEW: "bg-state-warning-soft text-state-warning-ink",
  PUBLISHED: "bg-state-success-soft text-state-success-ink",
  RECALLED: "bg-state-danger-soft text-state-danger-ink",
};

/** Số phiếu hiện sẵn — phần còn lại gấp trong <details>. */
const HIEN_SAN = 3;

function TheNhanXet({ n }: { n: DongNhanXet }) {
  return (
    <li className="min-w-0 space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          {n.buoi !== null ? `Buổi ${n.buoi}` : "Buổi học"}
        </span>
        <span className="tabular-nums">{n.ngay}</span>
        {n.lop && <span className="min-w-0 truncate">· {n.lop}</span>}
        {n.giaoVien && <span className="min-w-0 truncate">· GV {n.giaoVien}</span>}
      </div>
      {(n.duAn || n.tieuDe) && (
        <p className="break-words text-sm font-medium text-foreground">{n.duAn ?? n.tieuDe}</p>
      )}
      {n.noiDung ? (
        <p className="line-clamp-4 whitespace-pre-line break-words text-sm text-foreground/90">
          {n.noiDung}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Phiếu chỉ chấm mức, không có lời nhận xét.</p>
      )}
    </li>
  );
}

export function NhanXetVaHocBa({
  studentId,
  nhanXet,
  hocBa,
  moHocBaNangLuc,
  xemHocBaTongHop,
}: {
  studentId: string;
  /** `null` = người xem không có quyền xem nhận xét buổi. */
  nhanXet: DongNhanXet[] | null;
  /** `null` = người xem không có quyền xem học bạ năng lực. */
  hocBa: DongHocBa[] | null;
  /** Mở được /report-cards/<enrollmentId> (quyền `report-cards:manage|review`). */
  moHocBaNangLuc: boolean;
  /** Mở được /hoc-ba (cổng `PAGE_GATES["/hoc-ba"]`). */
  xemHocBaTongHop: boolean;
}) {
  if (nhanXet === null && hocBa === null && !xemHocBaTongHop) return null;
  const dau = nhanXet?.slice(0, HIEN_SAN) ?? [];
  const sau = nhanXet?.slice(HIEN_SAN) ?? [];

  return (
    <section
      aria-labelledby="nhan-xet-hoc-ba"
      className="min-w-0 rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="nhan-xet-hoc-ba" className="text-sm font-semibold text-foreground">
          Nhận xét buổi học &amp; học bạ
        </h2>
        {xemHocBaTongHop && (
          <Link
            href={`/hoc-ba?studentId=${encodeURIComponent(studentId)}`}
            className="inline-flex min-h-9 items-center gap-1 rounded-md text-xs font-semibold text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Học bạ tổng hợp (PDF) <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <div className="divide-y divide-border">
        {nhanXet !== null && (
          <div className="space-y-3 px-4 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nhận xét các buổi{nhanXet.length > 0 ? ` · ${nhanXet.length} phiếu gần nhất` : ""}
            </h3>
            {nhanXet.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có phiếu nhận xét buổi nào — giáo viên viết phiếu sau mỗi buổi ở site giáo
                viên hoặc màn buổi học.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {dau.map((n) => (
                    <TheNhanXet key={n.id} n={n} />
                  ))}
                </ul>
                {sau.length > 0 && (
                  <details className="group">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center text-sm font-medium text-primary-ink hover:underline [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">Xem thêm {sau.length} nhận xét</span>
                      <span className="hidden group-open:inline">Thu gọn</span>
                    </summary>
                    <ul className="mt-2 divide-y divide-border border-t border-border pt-3">
                      {sau.map((n) => (
                        <TheNhanXet key={n.id} n={n} />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {hocBa !== null && (
          <div className="space-y-3 px-4 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Học bạ năng lực theo lớp
            </h3>
            {hocBa.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có học bạ năng lực nào cho các lớp của em.
              </p>
            ) : (
              <ul className="space-y-2">
                {hocBa.map((h) => {
                  const noiDung = (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                          {h.lop}
                        </span>
                        <span
                          className={cn(
                            "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                            MAU_TRANG_THAI[h.trangThai],
                          )}
                        >
                          {REPORT_CARD_STATUS_LABEL[h.trangThai]}
                        </span>
                        {h.ngayPhatHanh && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {h.ngayPhatHanh}
                          </span>
                        )}
                      </div>
                      {h.nhanXetCuoi && (
                        <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm text-foreground/90">
                          {h.nhanXetCuoi}
                        </p>
                      )}
                    </>
                  );
                  return (
                    <li key={h.enrollmentId}>
                      {moHocBaNangLuc ? (
                        <Link
                          href={`/report-cards/${h.enrollmentId}`}
                          className="block rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {noiDung}
                        </Link>
                      ) : (
                        <div className="rounded-lg border border-border px-3 py-2.5">{noiDung}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
