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
import { formatDateTimeVN } from "@/lib/format/date";
import { docYeuCauChoDuyet, docYeuCauDaXuLy } from "@/lib/orders/hoc-vuot-cho-duyet";
import { NutDuyetHocVuot, NutTuChoiHocVuot } from "./_components/nut-duyet-hoc-vuot";

// "Duyệt học vượt bù" — màn của QUẢN LÝ CƠ SỞ (27/10/2026). Sale chuyển đổi một bé vào lớp ĐÃ HỌC TRƯỚC n buổi, điền số buổi học bù; ở đây Quản lý cơ sở duyệt số buổi đó.
// Duyệt ⇒ sinh các dòng cần bù (học vượt) + CỘNG đúng số buổi bù vào trần học bù miễn phí của bé. Từ chối ⇒ ghi danh giữ nguyên, không cộng lượt. Gác `makeup:waive`.
export const metadata = { title: "Duyệt học vượt bù | Admin" };
export const dynamic = "force-dynamic";

export default async function DuyetHocVuotPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/hoc-bu/duyet-hoc-vuot"]))) redirect("/hoc-bu");

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const [cho, daXuLy, coSoList] = await Promise.all([docYeuCauChoDuyet(sdb), docYeuCauDaXuLy(sdb), getCenterOptions(actor)]);
  // Cột cơ sở chỉ khi người xem thấy ≥ 2 cơ sở (cùng nếp với màn Học bù).
  const tenCoSo = coSoList.length > 1 ? Object.fromEntries(coSoList.map((c) => [c.id, c.code || c.name])) : null;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 2xl:max-w-6xl">
      <PageHeader
        title="Duyệt học vượt bù"
        subtitle={cho.length > 0 ? `${cho.length} yêu cầu đang chờ bạn duyệt` : "Sale xin học bù cho bé vào lớp đã học trước — chờ quản lý cơ sở duyệt"}
        actions={
          <Link href="/hoc-bu/duyet" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted sm:min-h-9">
            ← Duyệt case học bù
          </Link>
        }
      />
      <PageHelp>
        <p>
          Khi Sale chuyển đổi một bé vào lớp <b>đã học trước</b> buổi bé bắt đầu, bé phải <b>học vượt</b> (học bù) các buổi đã qua. Sale điền <b>số buổi học bù</b> (một buổi có thể dạy nhiều bài nên có thể
          ít hơn số buổi phải bù). <b>Duyệt</b>: hệ thống sinh các dòng cần bù và cộng đúng số buổi đó vào trần học bù miễn phí của bé để Sale đặt lịch. <b>Từ chối</b>: ghi danh giữ nguyên, không cộng lượt.
        </p>
      </PageHelp>

      {cho.length === 0 ? (
        <EmptyState title="Không có yêu cầu nào đang chờ" description="Khi Sale chuyển đổi bé vào lớp đã học trước và xin học bù, yêu cầu hiện ở đây và có thông báo trên chuông." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-label="Yêu cầu học vượt bù chờ duyệt">
          {cho.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words text-base font-semibold text-foreground">{r.tenBe}</span>
                  <StatusPill tone="warning">Chờ duyệt</StatusPill>
                  {tenCoSo && <span className="whitespace-nowrap text-xs text-muted-foreground">{tenCoSo[r.centerId] ?? ""}</span>}
                </div>
                <p className="min-w-0 break-words text-sm text-muted-foreground">
                  {r.tenKhoa} · {r.tenLop} ·{" "}
                  <Link href={`/orders/${r.orderId}/chuyen-doi`} className="whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline">
                    Đơn {r.maDon}
                  </Link>
                </p>
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Bắt đầu từ buổi</dt>
                    <dd className="font-semibold tabular-nums">{r.startLesson}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Phải học vượt</dt>
                    <dd className="font-semibold tabular-nums">{r.sessionsToCatchUp} buổi</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Sale xin bù trong</dt>
                    <dd className="font-semibold tabular-nums">{r.makeupSessions} buổi</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {r.nguoiGui} gửi lúc {formatDateTimeVN(r.guiLuc)}. Duyệt ⇒ cộng <b className="tabular-nums text-foreground">{r.makeupSessions}</b> lượt học bù miễn phí và tạo {r.sessionsToCatchUp} dòng cần bù.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <NutDuyetHocVuot requestId={r.id} soLuot={r.makeupSessions} />
                <NutTuChoiHocVuot requestId={r.id} tenBe={r.tenBe} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {daXuLy.length > 0 && (
        <section className="mt-8" aria-labelledby="da-xu-ly">
          <h2 id="da-xu-ly" className="mb-2 text-base font-semibold">
            Đã xử lý gần đây
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {daXuLy.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                <div className="min-w-0">
                  <span className="font-medium">{r.tenBe}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {r.tenLop} · Đơn {r.maDon} · từ buổi {r.startLesson}, bù {r.makeupSessions}/{r.sessionsToCatchUp} buổi
                  </span>
                  {r.lyDoQuyet && <p className="break-words text-xs text-muted-foreground">{r.lyDoQuyet}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "danger" : "muted"}>
                    {r.status === "APPROVED" ? "Đã duyệt" : r.status === "REJECTED" ? "Từ chối" : "Đã huỷ"}
                  </StatusPill>
                  {r.nguoiQuyet && <span className="whitespace-nowrap text-xs text-muted-foreground">{r.nguoiQuyet}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
