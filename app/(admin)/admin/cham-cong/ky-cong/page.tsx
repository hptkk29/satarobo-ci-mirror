// app/(admin)/admin/cham-cong/ky-cong/page.tsx — Kỳ công & chốt sổ: đích của mọi việc rà trong tháng.
//
// Vì sao màn này tồn tại: cả module chấm công quy về một câu hỏi của kế toán — "tháng này mỗi người
// bao nhiêu công, chốt được chưa". Chốt là thao tác ĐÓNG BĂNG số và chỉ Hội sở mở lại được, nên màn
// này bày đủ ba thứ trước khi bấm: số của cả kỳ, việc còn dang dở (có link tới đúng chỗ xử lý), và
// hệ quả bằng số trong hộp xác nhận.
//
// Dễ vỡ:
// - `getOrCreatePeriod` GHI (upsert). CHỈ gọi khi người ta có quyền chốt; người chỉ `view` lướt qua
//   12 tháng × 3 khối mà gọi nó là mở kỳ hàng loạt cho cơ sở. Đường đọc dùng `findUnique` qua sdb.
// - Kỳ LOCKED phải đọc `summaryJson` (số ĐÃ CHỐT), không dựng lại từ dữ liệu sống — dựng lại là in
//   ra một con số khác với con số đã trả lương.
// - Quyền lấy MỘT lần từ `loadModuleScope` (target luôn thật). Không quyền ⇒ `NoPermission` chứ
//   không `redirect` câm: bản cũ đá về `/cham-cong` rồi màn đó đá tiếp về `/dashboard`.
import { TRANG_THAI_CHO_QUAN_LY } from "@/lib/work-request";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, Flag, GraduationCap, Sigma, TriangleAlert, Users, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import { countsAsIssue } from "@/lib/cham-cong/flag-labels";
import {
  buildPeriodSummary,
  currentPeriodKey,
  getOrCreatePeriod,
  parsePeriodKey,
  periodRange,
  type PeriodSummary,
} from "@/lib/cham-cong/period";
import { vnYmd } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { KpiStrip } from "@/components/admin/cham-cong/kpi-strip";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { PeriodActions, PeriodPanel } from "./_components/period-panel";
import { UnfinishedList, type UnfinishedItem } from "./_components/unfinished-list";
import { PeriodTable, type PeriodTableRow } from "./_components/period-table";

export const metadata = { title: "Kỳ công | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const CLOSE: ModuleAction = "hr_attendance:close-period";
const EXPORT: ModuleAction = "hr_attendance:export";
const APPROVE: ModuleAction = "hr_attendance:approve";

const BASE = "/cham-cong/ky-cong";

/** "2026-09" → "09/2026". Kỳ sai định dạng ⇒ in nguyên (không đoán hộ). */
function kyLabelOf(ky: string): string {
  const p = parsePeriodKey(ky);
  return p ? `${String(p.m).padStart(2, "0")}/${p.y}` : ky;
}

/** Ngày UTC-midnight (@db.Date) → "dd/MM/yyyy" — không đi qua timezone máy chạy. */
function ngayVN(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function gioVN(iso: string | Date): string {
  return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
}

/** Ngày trong kỳ mà người đó CÓ ca nhưng máy chưa tính — chốt luôn là chốt ở 0 công. */
function demNgayChuaTinh(summary: PeriodSummary, todayYmd: string): number {
  const dates = new Set<string>();
  for (const r of summary.rows) {
    for (const [ymd, code] of Object.entries(r.grid)) {
      if (code === "X" || code === "P") continue;
      if (ymd > todayYmd) continue;
      if (ymd in r.unitsByDay) continue;
      dates.add(ymd);
    }
  }
  return dates.size;
}

export default async function KyCongPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fky-cong");

  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const ky = sp.ky && parsePeriodKey(sp.ky) ? sp.ky : currentPeriodKey();
  const kyLabel = kyLabelOf(ky);

  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title={`Kỳ công tháng ${kyLabel}`} />
        <ModuleNav active="ky" scope={scope} ctx={{ ky, coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="kỳ công" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const ctx = { ky, coSo };
  const canClose = scope.has(CLOSE, coSo);
  const canReopen = scope.has(CLOSE, HO_CENTER_ID);
  const canExport = scope.has(EXPORT, coSo);
  const canApprove = scope.has(APPROVE, coSo);

  const sdb = scopedDb(await resolveActor(session.user.id));
  // GHI (upsert) — chỉ người chốt được mới mở kỳ; người xem đi đường `findUnique`.
  const period = canClose
    ? await getOrCreatePeriod(coSo, ky)
    : await sdb.attendancePeriod.findUnique({ where: { centerId_periodKey: { centerId: coSo, periodKey: ky } } });
  const locked = period?.status === "LOCKED";
  const summary: PeriodSummary =
    locked && period?.summaryJson
      ? (period.summaryJson as unknown as PeriodSummary)
      : await buildPeriodSummary(coSo, ky);

  const { from, to, days: soNgayTrongKy } = periodRange(ky);
  const periodEnded = to.getTime() < Date.now();
  const todayYmd = vnYmd(new Date());

  // Cờ theo NGÀY: dùng cho dải "việc còn dang dở" + đích của ô Cờ/Ghi đè trên bảng.
  // `overrideUnits` đi kèm vì ô Ghi đè có ĐÍCH RIÊNG (`loc=ghide` + ngày người ĐÓ bị ghi đè):
  // dùng chung đích với ô Cờ thì người chỉ có ghi đè mà không có cờ bị đẩy sang ngày của người
  // khác, lọc `q=<tên>` không khớp ai, và màn đích in "Không ai khớp bộ lọc".
  const dayRows = await sdb.staffAttendanceDay.findMany({
    where: { centerId: coSo, workDate: { gte: from, lte: to } },
    select: { userId: true, workDate: true, flags: true, dayType: true, overrideUnits: true },
    orderBy: { workDate: "asc" },
  });
  const ngayCoCo = new Set<string>();
  const ngayKhongLuot = new Set<string>();
  const coDauTienCua = new Map<string, string>();
  const ghiDeDauTienCua = new Map<string, string>();
  for (const d of dayRows) {
    const ymd = d.workDate.toISOString().slice(0, 10);
    if (d.flags.some(countsAsIssue)) {
      ngayCoCo.add(ymd);
      if (!coDauTienCua.has(d.userId)) coDauTienCua.set(d.userId, ymd);
    }
    if (d.overrideUnits != null && !ghiDeDauTienCua.has(d.userId)) ghiDeDauTienCua.set(d.userId, ymd);
    if (d.dayType === "WORK" && d.flags.includes("KHONG_CO_LUOT")) ngayKhongLuot.add(ymd);
  }
  const ngayCoCoDauTien = [...ngayCoCo].sort()[0] ?? null;
  const ngayKhongLuotDauTien = [...ngayKhongLuot].sort()[0] ?? null;
  const nguoiChuaCoCa = summary.rows.filter((r) => Object.keys(r.grid).length === 0).length;
  const ngayChuaTinh = demNgayChuaTinh(summary, todayYmd);
  const donChoDuyet = canApprove
    ? await sdb.workRequest.count({ where: { centerId: coSo, status: { in: [...TRANG_THAI_CHO_QUAN_LY] } } })
    : 0;

  const dangDo: UnfinishedItem[] = [];
  if (ngayCoCoDauTien) {
    dangDo.push({
      key: "co",
      count: ngayCoCo.size,
      unit: "ngày",
      label: "còn cờ chưa rà — mở bảng công ngày đầu tiên",
      href: hrefWith("/cham-cong", { coSo, date: ngayCoCoDauTien, loc: "co" }),
      tone: "warn",
    });
  }
  if (ngayKhongLuotDauTien) {
    dangDo.push({
      key: "chuaquet",
      count: ngayKhongLuot.size,
      unit: "ngày",
      label: "có người không quét lượt nào — công đang tính 0",
      href: hrefWith("/cham-cong", { coSo, date: ngayKhongLuotDauTien, loc: "chuaquet" }),
      tone: "danger",
    });
  }
  if (nguoiChuaCoCa > 0) {
    dangDo.push({
      key: "chuacoca",
      count: nguoiChuaCoCa,
      unit: "người",
      label: "chưa có ca nào trong lưới kỳ này",
      href: hrefWith("/cham-cong/phan-ca", { ky, coSo }),
      tone: "warn",
    });
  }
  if (donChoDuyet > 0) {
    dangDo.push({
      key: "don",
      count: donChoDuyet,
      unit: "đơn",
      label: "chờ duyệt — duyệt sau khi chốt sẽ không vào kỳ này",
      href: hrefWith("/don-tu", { coSo, status: "PENDING" }),
      tone: "warn",
    });
  }

  const standardUnits = period?.standardUnits ?? summary.standardUnits;
  // Đích của một ô = ngày của CHÍNH người đó (không mượn ngày của người khác) + đúng bộ lọc sinh
  // ra con số trong ô. Không có ngày ⇒ trả `null` để ô in số trần, thà không bấm được còn hơn dẫn
  // tới một trang rỗng.
  const drillBase = (name: string, ymd: string | undefined, loc: "co" | "ghide") =>
    ymd ? hrefWith("/cham-cong", { coSo, date: ymd, loc, q: name }) : null;
  const rows: PeriodTableRow[] = summary.rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    employeeCode: r.employeeCode,
    units: r.units,
    expectedUnits: r.expectedUnits,
    leaveUnits: r.leaveUnits,
    holidayPaidUnits: r.holidayPaidUnits,
    hourCredit: r.hourCredit,
    workedMinutes: r.workedMinutes,
    expectedMinutes: r.expectedMinutes,
    lateCount: r.lateCount,
    earlyLeaveCount: r.earlyLeaveCount,
    missingTapDays: r.missingTapDays,
    overrideDays: r.overrideDays,
    flaggedDays: r.flaggedDays,
    teachingSessions: r.teachingSessions,
    makeupSessions: r.makeupSessions,
    drillHref: drillBase(r.name, coDauTienCua.get(r.userId), "co"),
    overrideHref: drillBase(r.name, ghiDeDauTienCua.get(r.userId), "ghide"),
  }));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Kỳ công tháng ${kyLabel} — ${block.label}`}
        subtitle="Công = tổng công ngày (đã tính ghi đè). Buổi dạy = buổi lớp đã hoàn thành do người đó thực dạy."
        actions={
          <PeriodActions
            centerId={coSo}
            ky={ky}
            kyLabel={kyLabel}
            blockLabel={block.label}
            status={period?.status ?? null}
            canClose={canClose}
            canReopen={canReopen}
            canExport={canExport}
            periodEnded={periodEnded}
            periodEndLabel={ngayVN(to)}
            people={summary.totals.people}
            units={summary.totals.units}
            flaggedDays={ngayCoCo.size}
            notComputedDays={ngayChuaTinh}
          />
        }
      />

      <ModuleNav active="ky" scope={scope} ctx={ctx} />

      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        month={{
          ky,
          prevHref: hrefWith(BASE, { ky: shiftKy(ky, -1), coSo }),
          nextHref: hrefWith(BASE, { ky: shiftKy(ky, 1), coSo }),
        }}
        period={{ status: period?.status ?? null, standardUnits, href: hrefWith(BASE, ctx) }}
        keep={{ ky }}
      />

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Chốt kỳ đóng băng công của cả khối trong tháng: sau khi chốt, lượt quét và ô lưới không đổi được số
          nữa, và chỉ cấp Hội sở mở lại được. Rà hết dải “việc còn dang dở” rồi bấm “Tính lại” trước khi chốt.
        </p>
        <p className="mt-2">
          Cột <b>Buổi ở cơ sở</b> đếm buổi của những lớp <b>thuộc cơ sở này</b>. Màn{" "}
          <b>Công dạy</b> có một con số khác, đếm theo <b>người</b> — giáo viên cơ sở này đi dạy lớp
          cơ sở khác thì buổi đó nằm ở màn Công dạy chứ không nằm ở đây. <b>Hai số lệch nhau ở ca dạy
          chéo là ĐÚNG</b>; đừng sửa cho khớp.
        </p>
        <p className="mt-2">
          Công chuẩn là số ngày công chuẩn của tháng, mặc định = số ngày trong tháng trừ ngày nghỉ tuần
          và ngày lễ. Sửa tay khi khối có lịch riêng; để trống rồi Lưu là trả về cách tính tự động.
        </p>
      </PageHelp>

      <KpiStrip
        cols={5}
        items={[
          {
            icon: CalendarCheck,
            value: standardUnits != null ? standardUnits.toLocaleString("vi-VN") : "—",
            label: "Công chuẩn",
            hint:
              standardUnits != null
                ? `${soNgayTrongKy} ngày − ${(soNgayTrongKy - standardUnits).toLocaleString("vi-VN")} ngày nghỉ tuần/lễ`
                : "Chưa đặt cho kỳ này",
          },
          {
            icon: Sigma,
            value: summary.totals.units.toLocaleString("vi-VN", { maximumFractionDigits: 2 }),
            label: "Tổng công cả kỳ",
            tone: "brand",
          },
          {
            icon: Flag,
            value: ngayCoCo.size.toLocaleString("vi-VN"),
            label: "Ngày có cờ",
            tone: ngayCoCo.size ? "warning" : "success",
            hint: ngayCoCo.size ? "Rà trước khi chốt" : "Không còn cờ",
            href: ngayCoCoDauTien ? hrefWith("/cham-cong", { coSo, date: ngayCoCoDauTien, loc: "co" }) : undefined,
          },
          {
            icon: GraduationCap,
            value: summary.totals.teachingSessions.toLocaleString("vi-VN"),
            label: "Buổi dạy ở cơ sở này",
            hint: `lớp thuộc cơ sở này · ${(summary.totals.makeupSessions ?? 0).toLocaleString("vi-VN")} buổi dạy bù`,
          },
          {
            icon: Users,
            value: summary.totals.people.toLocaleString("vi-VN"),
            label: "Người có công",
          },
        ]}
      />

      {!locked && (
        <SectionCard
          title="Việc còn dang dở trước khi chốt"
          icon={TriangleAlert}
          tone={dangDo.length ? "warning" : "success"}
          className="mb-4"
        >
          <UnfinishedList items={dangDo} />
        </SectionCard>
      )}

      <SectionCard title="Công chuẩn & trạng thái kỳ" icon={Wallet} className="mb-4">
        <PeriodPanel
          centerId={coSo}
          ky={ky}
          blockLabel={block.label}
          status={period?.status ?? null}
          standardUnits={standardUnits}
          standardUnitsNote={period?.standardUnitsNote ?? null}
          canClose={canClose}
          canReopen={canReopen}
          askWho={ASK_WHO[CLOSE]}
        />
      </SectionCard>

      {rows.length === 0 ? (
        <EmptyState
          title="Chưa có ca hay ngày công nào trong kỳ này"
          description="Chưa xếp lịch cho khối, hoặc cả khối nghỉ nguyên kỳ."
          action={
            <Link href={hrefWith("/cham-cong/phan-ca", ctx)} className={BTN_OUTLINE}>
              Xem lưới phân ca
            </Link>
          }
        />
      ) : (
        <PeriodTable rows={rows} totals={summary.totals} />
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {locked && period?.lockedAt
          ? `Số đã chốt lúc ${gioVN(period.lockedAt)}${period.lockReason ? ` — ${period.lockReason}` : ""} · đã xuất ${period.exportCount.toLocaleString("vi-VN")} lần.`
          : `Bản tạm dựng lúc ${gioVN(summary.builtAt)} · số công ngày cập nhật vài phút sau mỗi lượt quét hoặc mỗi lần đổi ca.`}
      </p>
    </div>
  );
}
