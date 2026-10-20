// app/(admin)/admin/cham-cong/khung-ca/page.tsx — KHUNG CA TUẦN: mẫu ca lặp hằng tuần của từng
// người theo khối (tab KHUNG CA của Sheet). Đây là bản gốc mà "Sinh lưới từ khung" đọc để dựng
// lịch cả tháng, nên sai ở đây là sai cả tháng chứ không sai một ngày.
//
// Ba điều dễ vỡ:
//  1. Thứ nghỉ tô xám đọc `getSetting("shift.weeklyOffDays")` THEO TỪNG KHỐI — bản cũ không tô gì,
//     còn lưới tháng thì tô cứng Thứ Hai; người vận hành đổi ngày nghỉ ở Cấu hình vận hành mà màn
//     này nói khác là họ xếp nhầm cả khối.
//  2. `?coSo` chỉ THU HẸP về một khối. Không truyền = mọi khối xem được, y như trước — sidebar cũ
//     và mọi đường vào không kèm tham số nên đổi mặc định là đổi nghĩa màn.
//  3. Nút "Sinh lưới tháng" ở đây chỉ là ĐƯỜNG DẪN sang lưới phân ca. Việc ghi hàng trăm ô chỉ có
//     một cửa vào (hộp thoại ở màn đó) — hai cửa là hai bộ mặc định lệch nhau.
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import {
  ASK_WHO,
  loadModuleScope,
  type ModuleAction,
} from "@/lib/cham-cong/module-scope";
import { scopeHref } from "@/lib/cham-cong/scope-href";
import type { ShiftSegment } from "@/lib/cham-cong/catalog";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ConfigTabs } from "@/components/admin/cham-cong/config-tabs";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import {
  PatternGrid,
  type Candidate,
  type PatternBlock,
  type PatternCode,
} from "./_components/pattern-grid";

export const metadata = {
  title: "Khung ca tuần | Admin",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const BASE = "/cham-cong/khung-ca";
const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";

/** Giờ làm của một mã ca, gộp các đoạn WORK — cùng cách hiển thị với màn Danh mục mã ca. */
function timeLabelOf(segments: unknown): string {
  const segs = (segments as ShiftSegment[] | null) ?? [];
  return segs
    .filter((s) => s.kind === "WORK")
    .map((s) => `${s.start}–${s.end}`)
    .join(" · ");
}

interface Props {
  searchParams: Promise<{ coSo?: string; ky?: string }>;
}

export default async function KhungCaPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fkhung-ca");

  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  // Xếp ca được thì đương nhiên xem được; kế toán chỉ có `view` vào đọc để đối chiếu.
  const visible = scope.blocks.filter((b) => b.perms[ASSIGN] || b.perms[VIEW]);
  const ky = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ky ?? "")
    ? (sp.ky as string)
    : null;
  const coSo = visible.some((b) => b.id === sp.coSo)
    ? (sp.coSo as string)
    : null;
  const ctx = { ky, coSo };

  const head = (
    <>
      <PageHeader
        title="Khung ca tuần"
        subtitle="Ca lặp hằng tuần của từng người theo khối — nguồn để sinh lưới phân ca tháng."
        actions={
          scope.any(ASSIGN) ? (
            <Link
              href={scopeHref("/cham-cong/phan-ca", ctx)}
              className={BTN_OUTLINE}
              title="Mở lưới phân ca — nút sinh lưới từ khung nằm ở màn đó"
            >
              Sinh lưới tháng
            </Link>
          ) : null
        }
      />
      <ModuleNav active="cauhinh" scope={scope} ctx={ctx} />
    </>
  );

  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        {head}
        <NoPermission
          permission={VIEW}
          what="khung ca tuần"
          askWho={ASK_WHO[VIEW]}
        />
      </div>
    );
  }

  const map = await loadCenterMap();
  const sdb = scopedDb(await resolveActor(session.user.id));
  const pool = coSo ? visible.filter((b) => b.id === coSo) : visible;

  const [patterns, templates] = await Promise.all([
    sdb.shiftWeeklyPattern.findMany({
      where: { centerId: { in: pool.map((b) => b.id) }, effectiveTo: null },
      select: {
        userId: true,
        centerId: true,
        weekday: true,
        templateCode: true,
        sheetName: true,
        jobLabel: true,
        displayOrder: true,
      },
    }),
    sdb.shiftTemplate.findMany({
      where: { isActive: true },
      select: { code: true, name: true, segments: true, isLeave: true, dayCredit: true, soCapQuetKyVong: true },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  // Khối chỉ-xem mà chưa ai có khung ca thì không bày bảng rỗng (luật cũ); nhưng khi người dùng
  // CHỌN đúng khối đó bằng chip thì phải hiện, kèm lời giải thích vì sao trống.
  const shown = coSo
    ? pool
    : pool.filter(
        (b) => b.perms[ASSIGN] || patterns.some((p) => p.centerId === b.id),
      );

  const userIds = [...new Set(patterns.map((p) => p.userId))];
  const canAssignAnyShown = shown.some((b) => b.perms[ASSIGN]);
  const [users, employees, offPairs] = await Promise.all([
    userIds.length
      ? sdb.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    canAssignAnyShown
      ? sdb.employee.findMany({
          where: { status: "ACTIVE", userAccount: { isNot: null } },
          // `department` / `jobTitle` / cơ sở trực thuộc là ba bộ lọc của hộp thêm hàng loạt.
          // ⚠️ `center` ở đây là cơ sở TRỰC THUỘC của nhân sự, KHÁC khối đang xếp ca —
          // người của CS1 làm ca ở CS2 là bình thường, nên nó là bộ LỌC chứ không phải
          // điều kiện.
          select: {
            fullName: true,
            employeeCode: true,
            department: true,
            departmentRef: { select: { name: true } },
            jobTitle: true,
            center: { select: { name: true } },
            userAccount: { select: { id: true } },
          },
          orderBy: { fullName: "asc" },
        })
      : Promise.resolve([]),
    Promise.all(
      shown.map(async (b) => {
        const orgUnitId =
          b.id === HO_CENTER_ID
            ? null
            : (Object.values(map.byCode).find((c) => c.centerId === b.id)
                ?.orgUnitId ?? null);
        return [
          b.id,
          await getSetting("shift.weeklyOffDays", { orgUnitId }),
        ] as const;
      }),
    ),
  ]);

  const offOf = new Map(offPairs);
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  for (const e of employees)
    if (!nameOf.has(e.userAccount!.id))
      nameOf.set(e.userAccount!.id, e.fullName);
  const candidates: Candidate[] = employees.map((e) => ({
    userId: e.userAccount!.id,
    name: e.fullName,
    employeeCode: e.employeeCode,
    department: e.department ?? null,
    // Nhãn đọc từ `DepartmentDef` (BẢNG), không chép tay: phòng ban là DỮ LIỆU —
    // SUPER_ADMIN/HR thêm phòng ban mà không cần deploy. Rơi về mã enum khi hồ sơ chưa
    // được nối sang bảng (2-phase, dual-write còn dở) — in mã còn hơn in "Chưa gán" sai.
    departmentLabel: e.departmentRef?.name ?? e.department ?? "Chưa gán",
    jobTitle: e.jobTitle ?? null,
    centerLabel: e.center?.name ?? "Chưa gán cơ sở",
  }));

  const blocks: PatternBlock[] = shown.map((b) => {
    const byUser = new Map<string, PatternBlock["people"][number]>();
    for (const p of patterns
      .filter((x) => x.centerId === b.id)
      .sort((x, y) => x.displayOrder - y.displayOrder)) {
      const row = byUser.get(p.userId) ?? {
        userId: p.userId,
        name: nameOf.get(p.userId) ?? p.userId,
        jobLabel: p.jobLabel,
        sheetName: p.sheetName,
        byWeekday: {},
      };
      row.byWeekday[p.weekday] = p.templateCode;
      byUser.set(p.userId, row);
    }
    return {
      centerId: b.id,
      label: b.label,
      canAssign: b.perms[ASSIGN],
      offDays: [...(offOf.get(b.id) ?? [])],
      people: [...byUser.values()],
    };
  });

  const codes: PatternCode[] = templates.map((t) => ({
    code: t.code,
    name: t.name,
    timeLabel: timeLabelOf(t.segments),
    isLeave: t.isLeave,
  }));

  return (
    <div className="max-w-6xl">
      {head}
      <ConfigTabs active="khung-ca" scope={scope} ctx={ctx} />

      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        allLabel="Tất cả khối"
        keep={ky ? { ky } : undefined}
      />

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi dòng là lịch tuần cố định của một người trong một khối. Chọn mã ca
          cho từng thứ, để trống nghĩa là thứ đó không xếp ca. Người làm ở cả
          hai cơ sở có hai dòng — một dòng ở mỗi khối.
        </p>
        <p className="mt-2">
          Khung ca không tự sinh lịch. Xếp xong thì sang <b>Lưới phân ca</b> và
          bấm &ldquo;Sinh lưới từ khung&rdquo; cho tháng cần: ô đã sửa tay, ô từ
          đơn đã duyệt và ô từ file import đều được giữ nguyên.
        </p>
        <p className="mt-2">
          Cột nền xám là ngày nghỉ tuần theo cấu hình của khối đó. Cột{" "}
          <b>Công/tuần</b> đếm số thứ có mã, trừ{" "}
          <span className="font-mono">X</span> và{" "}
          <span className="font-mono">P</span>.
        </p>
        <p className="mt-2">
          <b>Gỡ khỏi khối</b> chỉ gỡ người đó khỏi{" "}
          <i>khung ca tuần của khối này</i>: <b>không xoá hồ sơ nhân sự</b>,
          không xoá tài khoản, và lưới phân ca đã sinh của những ngày trước vẫn
          giữ nguyên — từ hôm sau mới thôi xếp. Thêm lại người đó thì lịch tuần
          cũ sống lại. Muốn cho nghỉ việc thì làm ở màn <b>Nhân sự</b>.
        </p>
      </PageHelp>

      {blocks.length === 0 ? (
        <EmptyState
          title="Chưa khối nào có khung ca tuần"
          description="Khối bạn xem được chưa ai có lịch tuần cố định, và bạn không có quyền xếp ca ở khối nào. Người xếp lịch của cơ sở sẽ thêm nhân sự vào khung ca."
          action={
            <Link
              href={scopeHref("/cham-cong/phan-ca", ctx)}
              className={BTN_OUTLINE}
            >
              Xem lưới phân ca tháng
            </Link>
          }
        />
      ) : (
        <PatternGrid blocks={blocks} codes={codes} candidates={candidates} />
      )}
    </div>
  );
}
