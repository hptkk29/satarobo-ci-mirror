// app/(admin)/admin/cham-cong/phan-ca/page.tsx — LƯỚI PHÂN CA THÁNG: ai làm ca gì, ngày nào,
// trong MỘT khối của MỘT kỳ. Đây là bản gốc mà bảng công ngày và kỳ công đều đọc theo.
//
// Ba điều dễ vỡ ở màn này:
//  1. Ô của người chịu công ở khối KHÁC là CHỈ ĐỌC. Bản cũ nhét chuỗi `→CS2` vào `<select value>`
//     — không khớp option nào nên trình duyệt vẽ ô TRỐNG, và quản lý cơ sở tưởng chưa xếp ca rồi
//     xếp đè. Nay ô đó là `ShiftCodeChip foreignUnit` (viền đứt + mũi tên), không bấm được.
//  2. Ngày nghỉ tuần đọc từ `getSetting("shift.weeklyOffDays")` theo đơn vị, KHÔNG hard-code Thứ Hai:
//     người vận hành đổi ngày nghỉ ở màn Cấu hình vận hành mà lưới vẫn tô Thứ Hai là sai lịch cả tháng.
//  3. Mọi truy vấn đi qua `scopedDb` và mọi quyền đi qua `loadModuleScope` (action là biến, target
//     luôn thật) — đừng gọi `checkPermission` rải rác lại ở đây.
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Grid2x2Check, Inbox, PenLine, TriangleAlert, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { vnYmd } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { ASK_WHO, loadModuleScope, periodStatusOf, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith, scopeHref, shiftKy } from "@/lib/cham-cong/scope-href";
import type { ShiftSegment } from "@/lib/cham-cong/catalog";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/cham-cong/classes";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { KpiStrip } from "@/components/admin/cham-cong/kpi-strip";
import type { ShiftCellCode } from "@/components/admin/cham-cong/shift-cell-picker";
import { SourceLegend } from "@/components/cham-cong/ui/shift-code-chip";
import { BangGioCa } from "@/components/cham-cong/ui/bang-gio-ca";
import { dongGioCa, locMaCaDaDung } from "@/lib/cham-cong/gio-ca";
import { loadLuoiPhanCa } from "@/lib/cham-cong/luoi-phan-ca-db";
import { duocXuatCuaPhienHienTai } from "@/lib/export/quyen-xuat";
import { NutXuatLuoiPhanCa } from "@/components/admin/cham-cong/nut-xuat-luoi-phan-ca";
import { GenerateDialog } from "./_components/generate-dialog";
import { MonthGrid, type GridDay, type GridRow } from "./_components/month-grid";

export const metadata = { title: "Lưới phân ca | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const BASE = "/cham-cong/phan-ca";
const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";

/** Lối ra màn khác. `href` là chuỗi LITERAL — `nav-coverage.test.ts` đếm chuỗi ngay sau `href:`
 *  để biết route nào còn lối vào; `/cham-cong/phan-ca/import` KHÔNG có ở ModuleNav/ConfigTabs
 *  nên đây là nơi duy nhất giữ nó khỏi thành route mồ côi. */
const RA_MAN = [
  { key: "khungca", label: "Khung ca tuần", href: "/cham-cong/khung-ca" },
  { key: "import", label: "Import Sheet", href: "/cham-cong/phan-ca/import" },
] as const;

/** Nhãn nơi làm cho menu chọn ca — cùng chữ với màn Danh mục mã ca. */
function placeLabel(token: string): string {
  if (token.startsWith("CENTER:")) return `Tại ${token.slice("CENTER:".length)}`;
  const map: Record<string, string> = {
    HOME: "Cơ sở của đơn vị",
    ASSIGNED: "Theo phân công",
    ANY_CENTER: "Bất kỳ cơ sở",
    OFFSITE: "Công tác ngoài",
    ANYWHERE: "Linh động",
  };
  return map[token] ?? token;
}

function timeLabelOf(segments: unknown): string {
  const segs = (segments as ShiftSegment[] | null) ?? [];
  return segs
    .filter((s) => s.kind === "WORK")
    .map((s) => `${s.start}–${s.end}`)
    .join(" · ");
}

function kyLabel(ky: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ky);
  return m ? `tháng ${m[2]}/${m[1]}` : ky;
}

interface Props {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}

export default async function PhanCaPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fphan-ca");

  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  // Màn này mở được bằng assign HOẶC view — chỉ xem cũng là một tư cách hợp lệ (kế toán đối chiếu).
  const visible = scope.blocks.filter((b) => b.perms[ASSIGN] || b.perms[VIEW]);
  const ky = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ky ?? "") ? (sp.ky as string) : vnYmd(new Date()).slice(0, 7);

  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Lưới phân ca" />
        <ModuleNav active="luoi" scope={scope} ctx={{ ky }} />
        <NoPermission permission={VIEW} what="lưới phân ca" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const block = visible.find((b) => b.id === sp.coSo) ?? visible[0];
  const coSo = block.id;
  const canAssign = block.perms[ASSIGN];
  const ctx = { ky, coSo };

  const today = vnYmd(new Date());

  const map = await loadCenterMap();
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const unitOf = (centerId: string) =>
    centerId === HO_CENTER_ID ? "HO" : (scope.blocks.find((b) => b.id === centerId)?.code ?? "HO");
  const unitHere = unitOf(coSo);
  const orgUnitId =
    coSo === HO_CENTER_ID
      ? null
      : (Object.values(map.byCode).find((c) => c.centerId === coSo)?.orgUnitId ?? null);

  // MỘT nguồn với tệp Excel (`/api/admin/cham-cong/phan-ca/export`) — xem lib/cham-cong/luoi-phan-ca-db.ts.
  const [luoi, period, xuatDuoc] = await Promise.all([
    loadLuoiPhanCa({ sdb, coSo, ky, orgUnitId, unitHere, unitOf, today }),
    periodStatusOf(sdb, coSo, ky),
    // Cổng vai xuất (`phan-ca-thang`). Cổng xem màn đã qua (khối nằm trong `visible`) — đúng hai
    // cổng mà route kiểm, nên nút chỉ hiện khi bấm chắc chắn tải được (luật 12).
    duocXuatCuaPhienHienTai("phan-ca-thang"),
  ]);
  const { templates } = luoi;
  const days: GridDay[] = luoi.days;
  // `source` của dòng DB là chuỗi enum; MonthGrid đọc nó qua union `ShiftSource` cùng tập giá trị.
  const rows = luoi.rows as GridRow[];
  const allAssign = luoi.maDaDung.map((templateCode) => ({ templateCode }));

  const codes: ShiftCellCode[] = templates.map((t) => ({
    code: t.code,
    name: t.name,
    timeLabel: timeLabelOf(t.segments),
    place: placeLabel(t.defaultPlace),
    isLeave: t.isLeave,
  }));
  // Mã nghỉ để đếm "7 ngày không nghỉ". Tổng Công/Nghỉ của từng dòng vẫn theo K-01 (X/P) — xem MonthGrid.
  const leaveCodes = new Set([...templates.filter((t) => t.isLeave).map((t) => t.code), "X", "P"]);

  // KPI: đo trên chính lưới đang hiện, không truy vấn lại — số phải khớp thứ người dùng đếm được.
  let filled = 0;
  let manual = 0;
  let fromRequest = 0;
  let restRisk = 0;
  for (const r of rows) {
    let run = 0;
    let maxRun = 0;
    for (const d of days) {
      const c = r.cells[d.day];
      if (c?.code) {
        filled += 1;
        if (c.source === "MANUAL") manual += 1;
        if (c.source === "SWAP" || c.source === "LEAVE") fromRequest += 1;
      }
      const working = !!c?.code && !leaveCodes.has(c.code);
      run = working ? run + 1 : 0;
      if (run > maxRun) maxRun = run;
    }
    if (maxRun >= 7) restRisk += 1;
  }

  const gioCaThangNay = locMaCaDaDung(
    dongGioCa(templates),
    allAssign.map((a) => a.templateCode),
  );

  const monthHref = (delta: number) => hrefWith(BASE, { ky: shiftKy(ky, delta), coSo });

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Lưới phân ca"
        subtitle={`Ca của từng người trong ${kyLabel(ky)} · ${block.label}`}
        actions={
          <>
            {xuatDuoc && (
              <NutXuatLuoiPhanCa
                ky={ky}
                kyLabel={kyLabel(ky)}
                // Đúng những khối người này XEM được lưới — route kiểm lại cùng cổng theo từng khối.
                khoi={visible.map((b) => ({ id: b.id, label: b.label }))}
                dangXem={coSo}
                className={BTN_OUTLINE}
              />
            )}
            {RA_MAN.map((r) =>
              r.key === "import" && !canAssign ? null : (
                <Link key={r.key} href={scopeHref(r.href, ctx)} className={BTN_OUTLINE}>
                  {r.label}
                </Link>
              ),
            )}
            {canAssign && (
              <GenerateDialog
                defaultKy={shiftKy(vnYmd(new Date()).slice(0, 7), 1)}
                blocks={scope.blocksWith(ASSIGN).map((b) => ({ id: b.id, label: b.label }))}
                defaultBlockId={coSo}
              />
            )}
          </>
        }
      />

      <ModuleNav active="luoi" scope={scope} ctx={ctx} />

      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        month={{ ky, prevHref: monthHref(-1), nextHref: monthHref(1) }}
        period={{
          status: period.status,
          standardUnits: period.standardUnits,
          href: hrefWith("/cham-cong/ky-cong", { ky, coSo }),
        }}
        keep={{ ky }}
      />

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi ô là ca của một người trong một ngày. Bấm vào ô để đổi mã ca, xoá ca, hoặc chọn kèm lý do —
          người đó nhận thông báo ngay.
        </p>
        <p className="mt-2">
          Ô sửa tay (dấu <b>T</b>) và ô sinh từ đơn đã duyệt (<b>Đ</b>, <b>N</b>) được giữ nguyên khi bấm
          &quot;Sinh lưới từ khung&quot; hay import lại file Sheet. Ô viền đứt kèm mũi tên là ca chịu công ở
          khối khác — muốn sửa thì chuyển sang khối đó.
        </p>
        <p className="mt-2">
          Cột <b>Công</b> đếm ô có mã trừ X và P; cột <b>Nghỉ</b> đếm X và P. Ngày nền xám là ngày nghỉ tuần
          theo cấu hình của cơ sở, chữ đỏ là ngày lễ.
        </p>
      </PageHelp>

      <KpiStrip
        cols={5}
        items={[
          { icon: Users, value: rows.length, label: "Người trong khối" },
          {
            icon: Grid2x2Check,
            value: `${filled}/${rows.length * days.length}`,
            label: "Ô đã xếp",
            hint: `${days.length} ngày`,
          },
          { icon: PenLine, value: manual, label: "Ô sửa tay", tone: manual > 0 ? "warning" : "brand" },
          { icon: Inbox, value: fromRequest, label: "Ô từ đơn đã duyệt", tone: "info" },
          {
            icon: TriangleAlert,
            value: restRisk,
            label: "Người 7 ngày không nghỉ",
            tone: restRisk > 0 ? "danger" : "brand",
            hint: "Điều 111 BLLĐ",
          },
        ]}
      />

      {!canAssign && (
        <p className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground">
          <CalendarClock aria-hidden className="h-4 w-4 shrink-0" />
          Bạn chỉ xem — sửa ô cần quyền
          <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs text-foreground">
            hr_attendance:assign
          </code>
          tại {block.label}. Xin cấp ở {ASK_WHO[ASSIGN]}.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={`Chưa có ai trong ${block.label} kỳ ${kyLabel(ky)}`}
          description="Khối này chưa có khung ca tuần, cũng chưa có ca nào trong tháng. Xếp khung ca rồi sinh lưới, hoặc import file Sheet của tháng."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href={scopeHref("/cham-cong/khung-ca", ctx)} className={canAssign ? BTN_OUTLINE : BTN_PRIMARY}>
                Xếp khung ca tuần
              </Link>
              {canAssign && (
                <Link href={scopeHref("/cham-cong/phan-ca/import", ctx)} className={BTN_OUTLINE}>
                  Import file Sheet
                </Link>
              )}
            </div>
          }
        />
      ) : (
        <>
          {/* CHỈ mã ca có mặt trong tháng đang xem — danh mục 21 mã mà khối này chỉ dùng
              4–6; đổ hết ra là bắt người rà tự lọc bằng mắt. */}
          <BangGioCa maCa={gioCaThangNay} className="mb-4" />
          <MonthGrid
            rows={rows}
            days={days}
            codes={codes}
            canEdit={canAssign}
            blockLabel={block.label}
            gioCa={gioCaThangNay}
          />
          <SourceLegend className="mt-3" />
        </>
      )}
    </div>
  );
}
