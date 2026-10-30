import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getCenterOptions } from "@/lib/org/center-options";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState } from "@/components/admin/ui/states";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { formatDateVN } from "@/lib/format/date";
import { docCaseChoDuyet } from "@/lib/hoc-bu/case-doc";
import { gioCase } from "@/lib/hoc-bu/thong-bao-thuan";
import { docLoChoDuyetThem } from "@/lib/hoc-bu/yeu-cau-them-be-db";
import { NutDuyetCase, NutTuChoiCase } from "../_components/duyet-case";
import { NutDuyetThemBe, NutTuChoiThemBe } from "../_components/duyet-them-be";

// "Duyệt case" — màn của QUẢN LÝ CƠ SỞ (20/10/2026). Case do Sale (và người không có quyền duyệt) tạo ra ở trạng thái CHỜ DUYỆT: giữ chỗ giáo viên / phòng / lượt của các bé nhưng CHƯA là
// lịch thật — giáo viên chưa thấy, phụ huynh chưa được báo, chưa có công dạy. Duyệt ⇒ lịch thật (có thể đổi giáo viên / phòng ngay lúc duyệt); từ chối ⇒ case huỷ, các bé quay lại danh sách cần bù,
// người tạo thấy lý do. Gác `makeup:waive` (cùng quyền miễn phí / huỷ buổi cần bù); mỗi Server Action gác lại.
export const metadata = { title: "Duyệt case học bù | Admin" };
export const dynamic = "force-dynamic";

export default async function DuyetCasePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/hoc-bu/duyet"]))) redirect("/hoc-bu");

  const actor = await resolveActor(session.user.id);
  const [dong, loThem, coSoList] = await Promise.all([docCaseChoDuyet(scopedDb(actor), {}), docLoChoDuyetThem(scopedDb(actor), {}), getCenterOptions(actor)]);
  // Cột "Cơ sở" chỉ khi người xem thấy ≥2 cơ sở (cùng nếp với màn Học bù).
  const tenCoSo = coSoList.length > 1 ? Object.fromEntries(coSoList.map((c) => [c.id, c.code || c.name])) : null;
  const bayGio = new Date();

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title="Duyệt case học bù"
        subtitle={
          dong.length + loThem.length > 0
            ? [dong.length > 0 ? `${dong.length} case` : null, loThem.length > 0 ? `${loThem.length} yêu cầu thêm học viên` : null].filter(Boolean).join(" · ") + " đang chờ bạn duyệt"
            : "Case do Sale tạo và yêu cầu thêm học viên vào case chờ quản lý cơ sở duyệt"
        }
        actions={
          <Link href="/hoc-bu?tab=case" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted sm:min-h-9">
            ← Về Học bù
          </Link>
        }
      />
      <PageHelp>
        <p>
          Case do <b>Sale</b> tạo ở đây <b>chưa là lịch thật</b>: đã giữ chỗ giáo viên, phòng và lượt bù của các bé, nhưng giáo viên chưa thấy và phụ huynh chưa được báo. <b>Duyệt</b> để thành lịch
          thật (đổi giáo viên / phòng ngay lúc duyệt nếu cần); <b>Từ chối</b> thì các bé quay lại danh sách cần bù và Sale thấy lý do.
        </p>
        <p>
          Khi Sale muốn <b>thêm học viên khác vào case đã có</b>, case <b>giữ nguyên</b> cho tới khi bạn duyệt: <b>Duyệt</b> thì các bé được xếp vào case (hệ thống kiểm lại lượt, lịch và số bài lúc đó,
          phụ huynh và giáo viên được báo); <b>Từ chối</b> thì các bé vẫn ở danh sách cần bù và Sale thấy lý do.
        </p>
      </PageHelp>

      {loThem.length > 0 && (
        <section className="mb-6" aria-labelledby="yc-them-be">
          <h2 id="yc-them-be" className="mb-2 text-base font-semibold">
            Yêu cầu thêm học viên vào case ({loThem.length})
          </h2>
          <ul className="space-y-3">
            {loThem.map((l) => {
              const c = l.thongTinCase;
              const caseMo = c?.status === "SCHEDULED";
              return (
                <li key={l.batchId} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/hoc-bu/case/${l.caseId}`} className="font-semibold tabular-nums hover:underline">
                          {c ? `${formatDateVN(c.date)} · ${c.startTime}–${c.endTime}` : "Case"}
                        </Link>
                        <StatusPill tone="warning">Chờ duyệt thêm bé</StatusPill>
                        {!caseMo && <StatusPill tone="danger">Case đã đóng — chỉ từ chối được</StatusPill>}
                        {l.moRongBai && <StatusPill tone="info">Kèm thêm bài vào case</StatusPill>}
                        {tenCoSo && <span className="text-xs text-muted-foreground">{tenCoSo[l.centerId] ?? "—"}</span>}
                      </div>
                      {c && <p className="text-sm text-muted-foreground">{c.khoa}</p>}
                      <p className="text-xs text-muted-foreground">
                        {l.nguoiGui} gửi lúc {formatDateVN(l.proposedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {caseMo && <NutDuyetThemBe batchId={l.batchId} />}
                      <NutTuChoiThemBe batchId={l.batchId} />
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Xin thêm ({l.hocVien.length} buổi vắng)</p>
                    <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {l.hocVien.map((h) => (
                        <li key={`${h.ten}|${h.lop}|${h.bai}`} className="min-w-0 truncate">
                          <span className="font-medium">{h.ten}</span> <span className="text-muted-foreground">· {h.lop} · {h.bai}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {dong.length === 0 && loThem.length === 0 ? (
        <EmptyState title="Không có gì chờ duyệt" description="Khi Sale tạo case học bù mới hoặc xin thêm học viên vào case có sẵn, mục đó sẽ hiện ở đây để bạn duyệt." />
      ) : dong.length === 0 ? null : (
        <ul className="space-y-3">
          {dong.map((c) => {
            const quaGio = bayGio.getTime() >= gioCase({ ymd: c.date.toISOString().slice(0, 10), startTime: c.startTime, endTime: c.endTime }).ketThuc.getTime();
            return (
              <li key={c.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/hoc-bu/case/${c.id}`} className="font-semibold tabular-nums hover:underline">
                        {formatDateVN(c.date)} · {c.startTime}–{c.endTime}
                      </Link>
                      <StatusPill tone="warning">Chờ duyệt</StatusPill>
                      {quaGio && <StatusPill tone="danger">Đã qua giờ — chỉ từ chối được</StatusPill>}
                      {tenCoSo && <span className="text-xs text-muted-foreground">{tenCoSo[c.centerId] ?? "—"}</span>}
                    </div>
                    <p className="text-sm">
                      {c.khoa} · <span className="text-muted-foreground">{c.buoi.join(" · ")}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Giáo viên <span className="font-medium text-foreground">{c.giaoVien}</span> · Phòng <span className="font-medium text-foreground">{c.phong ?? "chưa xếp"}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.nguoiTao} tạo lúc {formatDateVN(c.taoLuc)}
                    </p>
                    {c.note && <p className="whitespace-pre-line text-sm">{c.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!quaGio && <NutDuyetCase caseId={c.id} phienBan={c.version} />}
                    <NutTuChoiCase caseId={c.id} />
                  </div>
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Học viên ({c.hocVien.length})</p>
                  <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {c.hocVien.map((h) => (
                      <li key={`${h.ten}|${h.lop}`} className="min-w-0 truncate">
                        <span className="font-medium">{h.ten}</span> <span className="text-muted-foreground">· {h.lop}{h.soBuoi > 1 ? ` · ${h.soBuoi} buổi` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
