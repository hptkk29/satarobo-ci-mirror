import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { vnYmd } from "@/lib/time/vn";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { danhSachCaseGv, type DongCaseGv } from "@/lib/hoc-bu/case-doc";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";

// Site GV — "Học bù" (29/09/2026): buổi dạy bù được xếp cho mình, khuôn giống danh sách Trial.
// Mỗi dòng mở trang case: điểm danh, nhận xét, tài liệu SCORM của đúng bài, gửi bài kiểm tra bù.
export const dynamic = "force-dynamic";
export const metadata = { title: "Học bù" };

const ngayFmt = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

export default async function TeacherHocBuListPage() {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate
  const homNay = new Date(`${vnYmd(new Date())}T00:00:00Z`);
  const { sapToi, daDay } = await danhSachCaseGv(session.user.id, homNay);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Học bù"
        subtitle="Buổi dạy bù trung tâm xếp cho bạn. Mở từng buổi để điểm danh, nhận xét và mở bài giảng của đúng buổi đó."
      />
      <Khoi tieuDe="Sắp dạy" rows={sapToi} rong="Chưa có buổi bù nào được xếp cho bạn." khoa="gv-hoc-bu-sap" />
      <Khoi tieuDe="Đã dạy (60 ngày)" rows={daDay} rong="Chưa có buổi bù nào đã dạy." khoa="gv-hoc-bu-da" />
    </div>
  );
}

function Khoi({ tieuDe, rows, rong, khoa }: { tieuDe: string; rows: DongCaseGv[]; rong: string; khoa: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {tieuDe} <span className="font-normal normal-case">· {rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title={rong} />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang tenDonVi="buổi bù" khoaGhiNho={khoa}>
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-5 py-3">Buổi</th>
                  <th scope="col" className="px-5 py-3">Khoá · bài bù</th>
                  <th scope="col" className="px-5 py-3">Học viên</th>
                  <th scope="col" className="px-5 py-3 text-right">Sĩ số</th>
                  <th scope="col" className="px-5 py-3">Điểm danh · nhận xét</th>
                  <th scope="col" className="px-5 py-3">Tài liệu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const xongDiemDanh = r.soDaDiemDanh === r.soBe && r.soBe > 0;
                  const xongNhanXet = r.soDaNhanXet === r.soCoMat;
                  return (
                    <tr key={r.id} className="relative border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                      <td className="min-w-[10rem] px-5 py-3.5">
                        <Link
                          href={`/teacher/hoc-bu/${r.id}`}
                          className="font-semibold whitespace-nowrap text-foreground after:absolute after:inset-0 focus-visible:underline"
                        >
                          {ngayFmt.format(r.date)}
                        </Link>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {r.startTime}–{r.endTime}
                        </p>
                      </td>
                      <td className="max-w-[16rem] px-5 py-3.5">
                        <p className="truncate font-medium text-foreground">{r.khoa}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.buoi}</p>
                      </td>
                      <td className="max-w-[16rem] px-5 py-3.5">
                        <p className="truncate text-foreground" title={r.hocVien.join(", ")}>
                          {r.hocVien.join(", ") || "—"}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-foreground">{r.soBe}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          <span
                            className={cn(
                              "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
                              xongDiemDanh ? "bg-state-success-soft text-state-success-ink" : "bg-state-warning-soft text-state-warning-ink",
                            )}
                          >
                            Điểm danh {r.soDaDiemDanh}/{r.soBe}
                          </span>
                          {r.soCoMat > 0 && (
                            <span
                              className={cn(
                                "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
                                xongNhanXet ? "bg-state-success-soft text-state-success-ink" : "bg-state-warning-soft text-state-warning-ink",
                              )}
                            >
                              Nhận xét {r.soDaNhanXet}/{r.soCoMat}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        {r.coTaiLieu ? (
                          <span className="font-semibold text-foreground">Có bài giảng SCORM</span>
                        ) : (
                          <span className="text-muted-foreground">Bài chưa có SCORM</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </section>
  );
}
