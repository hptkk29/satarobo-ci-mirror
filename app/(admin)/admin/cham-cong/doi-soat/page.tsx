// app/(admin)/admin/cham-cong/doi-soat/page.tsx — Đối soát Sheet ↔ hệ thống (kỳ chạy song song, L6).
//
// Vì sao màn này tồn tại: khi Sheet cũ và hệ thống cùng chạy, chỉ có một câu hỏi đáng hỏi mỗi
// ngày — "hai bên còn lệch ô nào không". Cổng ra để bỏ Sheet là 10 ngày làm việc liên tiếp
// không lệch, nên `cleanStreak` phải là thứ nhìn thấy trước cả bảng lệch.
//
// Dễ vỡ: (1) đối soát CHỈ ĐỌC — không ghi gì vào hệ thống, người dùng phải đọc được điều đó
// trước khi dám tải file lên; (2) tháng trên ScopeBar chính là `periodKey` gửi cho action, nên
// chọn tháng mà file không có tab tương ứng sẽ báo lỗi tại chỗ chứ không im lặng so nhầm kỳ;
// (3) quyền tính MỘT lần bằng `loadModuleScope` — không lặp `checkPermission` rải rác nữa.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { ASK_WHO, loadModuleScope, periodStatusOf } from "@/lib/cham-cong/module-scope";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import { vnYmd } from "@/lib/time/vn";
import { ReconcilePanel } from "./_components/reconcile-panel";

export const metadata = { title: "Đối soát Sheet | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/cham-cong/doi-soat";

/** Kỳ "YYYY-MM" hợp lệ? (tháng 01–12) — không mượn `period.ts` vì file đó kéo cả PrismaClient. */
function validKy(ky: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(ky);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export default async function DoiSoatPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fdoi-soat");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const ky = sp.ky && validKy(sp.ky) ? sp.ky : vnYmd(new Date()).slice(0, 7);
  const ctx = { ky, coSo: sp.coSo ?? null };

  if (!scope.any("hr_attendance:view")) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Đối soát Sheet" />
        <ModuleNav active="doisoat" scope={scope} ctx={ctx} />
        <NoPermission
          permission="hr_attendance:view"
          what="đối soát"
          askWho={ASK_WHO["hr_attendance:view"]}
        />
      </div>
    );
  }

  const blocks = scope.blocksWith("hr_attendance:view");
  const coSo = scope.pick(sp.coSo, "hr_attendance:view")?.id ?? null;
  const period = coSo
    ? await periodStatusOf(scopedDb(await resolveActor(session.user.id)), coSo, ky)
    : { status: null, standardUnits: null };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Đối soát Sheet"
        subtitle="So Sheet đang dùng với số của hệ thống trong kỳ chạy song song."
      />
      <ModuleNav active="doisoat" scope={scope} ctx={{ ...ctx, coSo }} />
      <ScopeBar
        basePath={BASE}
        blocks={blocks}
        coSo={coSo}
        keep={{ ky }}
        month={{
          ky,
          prevHref: hrefWith(BASE, { ky: shiftKy(ky, -1), coSo }),
          nextHref: hrefWith(BASE, { ky: shiftKy(ky, 1), coSo }),
        }}
        period={{ ...period, href: hrefWith("/cham-cong/ky-cong", { ky, coSo }) }}
      />
      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi ngày tải file Sheet lịch đang dùng lên đây để xem ô nào lệch với hệ thống. Máy chỉ
          đọc file — không ghi gì vào hệ thống, chạy bao nhiêu lần cũng được.
        </p>
        <p className="mt-2">
          Chỉ so tới <b>hôm qua</b>: hôm nay chưa hết ca nên công chưa tính xong. Cổng ra để bỏ
          Sheet là <b>10 ngày làm việc liên tiếp không lệch</b>. Người chưa ánh xạ thì ánh xạ ở màn
          Import lịch; người miễn chấm công tự bị loại khỏi phép so.
        </p>
      </PageHelp>
      <ReconcilePanel ky={ky} coSo={coSo} />
    </div>
  );
}
