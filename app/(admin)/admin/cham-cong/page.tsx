// app/(admin)/admin/cham-cong/page.tsx — BẢNG CÔNG NGÀY: hàng chờ RÀ CỜ của quản lý cơ sở.
//
// Vì sao màn này tồn tại: công đếm theo LỊCH ĐÃ XẾP, lượt quét chỉ sinh cờ (T-01) — nên việc thật
// mỗi ngày là "ai có cờ, cờ gì, có phải sửa công không", chứ không phải đọc bảng giờ. Dải ngày
// mang số cờ cả tháng để chọn đúng ngày cần mở; bảng xếp cờ nặng lên đầu; bấm TÊN mở panel chi tiết
// (lượt quét + ghi đè) thay vì nhét ô nhập vào một ô bảng 90px như bản cũ.
//
// Điều dễ vỡ:
//  · MỌI đường dẫn trong màn phải mang theo `date` VÀ `coSo`. Bản cũ push `/cham-cong?date=` làm
//    rơi `coSo`, nên người Hội sở đang xem CS2 đổi ngày là bị ném về CS1 mà không hay. Vì thế thanh
//    lọc là `<form method="GET">` có hidden `coSo`/`loc`, không phải input tự điều hướng.
//  · Giờ in ra là giờ VN (+07) tính ở SERVER. Truyền `Date` xuống client là giờ đổi theo máy người xem.
//  · Quyền hỏi MỘT lần qua `loadModuleScope` (action là biến, target luôn thật); không `redirect` câm.
import { TRANG_THAI_CON_HIEU_LUC } from "@/lib/cham-cong/don-trong-ngay-db";
import { dongPhutDon } from "@/lib/cham-cong/dong-phut-don";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Flag,
  Lock,
  Monitor,
  PencilLine,
  Search,
  Users,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { loadCenterMap } from "@/lib/cham-cong/home-center";
import {
  nhanNoiQuet,
  noiQuetKhacNoiChiuCong,
} from "@/lib/cham-cong/noi-quet";
import { nguoiThuocSoCong } from "@/lib/cham-cong/noi-chiu-cong";
import { laLuotDaBiThay, moTaMoc, soMocCuaCa } from "@/lib/cham-cong/sua-gio-quet";
import {
  ASK_WHO,
  loadModuleScope,
  periodStatusOf,
  type ModuleAction,
} from "@/lib/cham-cong/module-scope";
import { hrefWith, monthStepDate, scopeHref } from "@/lib/cham-cong/scope-href";
import { countsAsIssue, flagInfo } from "@/lib/cham-cong/flag-labels";
import {
  parseVnYmd,
  vnDateAt,
  vnDateOnly,
  vnWeekday,
  vnYmd,
} from "@/lib/time/vn";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { BangGioCa } from "@/components/cham-cong/ui/bang-gio-ca";
import { dongGioCa } from "@/lib/cham-cong/gio-ca";
import {
  DayStrip,
  type DayStripDay,
} from "@/components/admin/cham-cong/day-strip";
import { KpiStrip } from "@/components/admin/cham-cong/kpi-strip";
import {
  BTN_OUTLINE,
  CHIP,
  CHIP_ACTIVE,
  CHIP_IDLE,
  FIELD,
  PILL,
} from "@/components/admin/cham-cong/classes";
import { FlagList } from "@/components/cham-cong/ui/flag-chip";
import {
  ShiftCodeChip,
  type ShiftSource,
} from "@/components/cham-cong/ui/shift-code-chip";
import {
  DayTypePill,
  type DayType,
} from "@/components/cham-cong/ui/day-type-pill";
import {
  DayDetailSheet,
  type DayRow,
  type DayTap,
} from "./_components/day-detail-sheet";

export const metadata = {
  title: "Bảng công ngày | Admin",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";
const ADJUST: ModuleAction = "hr_attendance:adjust";

/** MỘT chuỗi cho cả hai nhánh (có quyền / không quyền) — hai câu khác nhau cho cùng một màn là
 *  thứ người dùng đọc thành "hai màn khác nhau". */
const SUBTITLE =
  "Công đếm theo lịch đã xếp; lượt quét chỉ sinh cờ để quản lý rà.";

/** Bộ lọc nhanh trên toolbar. Giá trị lạ ⇒ coi như không lọc. */
type Loc = "co" | "chuaquet" | "ghide" | null;
const LOC_CHIPS: { value: Loc; label: string }[] = [
  { value: null, label: "Tất cả" },
  { value: "co", label: "Chỉ có cờ" },
  { value: "chuaquet", label: "Chưa quét" },
  { value: "ghide", label: "Đã ghi đè" },
];

interface Props {
  searchParams: Promise<{
    date?: string;
    coSo?: string;
    loc?: string;
    q?: string;
  }>;
}

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Giờ VN của một mốc thời gian. Cộng tay +07 thay vì `toLocaleTimeString`: Vercel chạy UTC. */
function hhmm(d: Date | null | undefined): string {
  if (!d) return "—";
  const p = new Date(d.getTime() + 7 * 3_600_000);
  return `${String(p.getUTCHours()).padStart(2, "0")}:${String(p.getUTCMinutes()).padStart(2, "0")}`;
}

function fmtMin(m: number): string {
  return m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "—";
}

/** Cờ nặng lên trước, để `FlagList max={2}` luôn hiện đúng thứ cần rà. */
function flagRank(code: string): number {
  const tone = flagInfo(code).tone;
  if (tone === "danger") return 0;
  if (tone === "warn") return 1;
  // Mã lạ mang tông `info` nhưng VẪN là việc cần rà (`countsAsIssue`) — xếp trước ghi chú thường.
  return countsAsIssue(code) ? 2 : 3;
}

/** Thứ hạng của cả DÒNG: danger → warn/mã lạ → còn lại. */
function rowRank(flags: string[]): number {
  if (flags.length === 0) return 3;
  return Math.min(...flags.map((f) => Math.min(flagRank(f), 2)));
}

export default async function ChamCongPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong");

  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const block = scope.pick(sp.coSo, VIEW);
  const ctxNoBlock = { coSo: null, date: null };

  if (!block) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Bảng công ngày" subtitle={SUBTITLE} />
        <ModuleNav active="ngay" scope={scope} ctx={ctxNoBlock} />
        <NoPermission
          permission={VIEW}
          what="bảng công"
          askWho={ASK_WHO[VIEW]}
        />
      </div>
    );
  }

  const coSo = block.id;
  const canAdjust = scope.has(ADJUST, coSo);
  const canAssign = scope.has(ASSIGN, coSo);

  // ── Ngày đang xem (giữ nguyên hợp đồng `?date=` + fallback "hôm nay") ─────────────────
  const day = (sp.date && parseVnYmd(sp.date)) || new Date();
  const workDate = vnDateOnly(day);
  const dateStr = workDate.toISOString().slice(0, 10);
  const ky = dateStr.slice(0, 7);
  const today = vnYmd(new Date());
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const monthFrom = new Date(Date.UTC(year, month - 1, 1));
  const monthTo = new Date(Date.UTC(year, month, 0));
  const daysInMonth = monthTo.getUTCDate();
  const dateLabel = `${WD[vnWeekday(vnDateAt(year, month - 1, Number(dateStr.slice(8, 10)), 12))]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}/${year}`;

  const loc: Loc =
    sp.loc === "co" || sp.loc === "chuaquet" || sp.loc === "ghide"
      ? sp.loc
      : null;
  const q = (sp.q ?? "").trim();
  /** Mọi link trong màn đi qua đây — quên một tham số là rơi ngữ cảnh (bug `coSo` của bản cũ). */
  const here = (over: { date?: string; loc?: Loc }) =>
    hrefWith("/cham-cong", {
      coSo,
      date: over.date ?? dateStr,
      loc: over.loc === undefined ? loc : over.loc,
      q,
    });
  const kyHref = hrefWith("/cham-cong/ky-cong", { ky, coSo });

  const sdb = scopedDb(await resolveActor(session.user.id));
  const centerMap = await loadCenterMap();
  const orgUnitId =
    Object.values(centerMap.byCode).find((c) => c.centerId === coSo)
      ?.orgUnitId ?? null;

  // ── D1: centerId → MÃ cơ sở, để nhãn lượt quét nói được nơi quét ────────────────────
  //
  // Dựng từ `centerMap` đang có sẵn — KHÔNG thêm truy vấn, và KHÔNG đi qua `scopedDb`:
  // `loadCenterMap()` cố ý không scope vì nó là bản đồ tổ chức, không phải dữ liệu cơ sở.
  // `byCode` bỏ HO (xem `home-center.ts:51`) nên phải thêm tay từ `hoCenterId`.
  const maCoSoTheoId = new Map<string, string>([[centerMap.hoCenterId, "HO"]]);
  for (const [ma, c] of Object.entries(centerMap.byCode)) maCoSoTheoId.set(c.centerId, ma);

  const [days, assignments, monthRows, holidays, weeklyOff, period] =
    await Promise.all([
      sdb.staffAttendanceDay.findMany({ where: { workDate, centerId: coSo } }),
      sdb.shiftAssignment.findMany({
        where: { workDate, centerId: coSo, status: "ACTIVE" },
        select: { userId: true, templateCode: true, source: true, soCapQuetKyVong: true },
      }),
      sdb.staffAttendanceDay.findMany({
        where: { centerId: coSo, workDate: { gte: monthFrom, lte: monthTo } },
        select: { workDate: true, flags: true, dayType: true },
      }),
      sdb.holiday.findMany({
        where: {
          type: "HOLIDAY",
          date: { lte: monthTo },
          AND: [
            {
              OR: [
                { endDate: null, date: { gte: monthFrom } },
                { endDate: { gte: monthFrom } },
              ],
            },
            { OR: [{ centerId: null }, { centerId: coSo }] },
          ],
        },
        select: { date: true, endDate: true, attendanceEffect: true },
      }),
      getSetting("shift.weeklyOffDays", { orgUnitId }),
      periodStatusOf(sdb, coSo, ky),
    ]);

  // 🔴 Vá 13/09/2026 — SỔ CÔNG của một cơ sở chỉ gồm người có NGÀY CÔNG hoặc CA XẾP ở đây.
  //
  // Bản cũ gộp thêm nguồn thứ ba: `StaffTimeLog where centerId = coSo`, tức ai QUÉT ở đây là
  // lọt vào sổ, dù ngày công của họ thuộc nơi khác. Hệ quả trên prod: người Hội sở quét QR ở
  // một cơ sở thì hiện trong sổ công của cơ sở đó LẪN Hội sở.
  //
  // 📌 `StaffAttendanceDay` có `@@unique([userId, workDate])` ⇒ một người một ngày ĐÚNG MỘT
  // dòng. Đây chưa bao giờ là "đẻ thêm dòng công" — là MỘT dòng bị nhiều màn cùng liệt kê.
  //
  // Nguồn thứ ba ấy vào ngày 07/09 với lý do "người quét ở đây mà không được xếp ca ở đây vẫn
  // phải hiện". Lý do đó nay có chỗ phục vụ ĐÚNG HƠN: D1 (10/09) in " · quét ở CS2" lên dòng
  // của người đó TẠI cơ sở chịu công của họ — thông tin không mất, nó về đúng cái sổ có thẩm
  // quyền. Luật + ca test: `lib/cham-cong/noi-chiu-cong.ts`.
  const userIds = nguoiThuocSoCong({
    coNgayCong: days.map((d) => d.userId),
    coCaXep: assignments.map((a) => a.userId),
  });

  // Lượt quét ĐẦY ĐỦ của những người đã lọt danh sách — CỐ Ý không lọc theo cơ sở đang xem.
  //
  // Đừng lọc theo cơ sở đang xem: công ngày (`StaffAttendanceDay`) được tính trên TOÀN BỘ lượt
  // của người đó trong ngày,
  // không lọc cơ sở (`recompute.ts:24`), còn cơ sở chịu công thì lấy theo CA ĐƯỢC XẾP
  // (`recompute.ts:88`). Hai cái đó lệch nhau đúng ở tình huống đáng quan tâm nhất: người được
  // xếp ca CS1 nhưng quét ở CS2. Khi đó dòng hiện "Quét —" như thể chưa từng quét, mà cột Giờ
  // vẫn có số — người duyệt đọc ra "máy hỏng" thay vì "quét nhầm cơ sở".
  // (Bắt được khi nghiệm thu trên test 07/09.)
  //
  // `scopedDb` vẫn gác: quản lý cấp cơ sở không thấy lượt của cơ sở khác — đó là cách ly đúng,
  // không phải lỗi; họ thấy dòng "quét ở nơi khác" mà không thấy giờ giấc chi tiết.
  const logsDay = userIds.length
    ? await sdb.staffTimeLog.findMany({
        where: { userId: { in: userIds }, workDate, result: "ACCEPTED" },
        orderBy: { loggedAt: "asc" },
        select: {
          userId: true,
          direction: true,
          loggedAt: true,
          flags: true,
          centerId: true,
          // ── D1 (10/09/2026): NƠI QUÉT phải hiện ra tên, không phải "nơi khác" ─────
          // `workLocationId` là ĐIỂM CHẤM cụ thể mà QR thuộc về. Có nó thì nhãn nói được
          // "Quét ở CS1" thay vì một chuỗi cố định vô nghĩa.
          workLocationId: true,
          // ── Panel sửa giờ (09/09/2026) cần biết dòng này TỪ ĐÂU RA ────────────────
          // Không có `source` thì một mốc do quản lý gõ trông y hệt một lượt quét thật, và
          // người rà tiếp theo không phân biệt được "máy ghi" với "người ghi".
          source: true,
          adjustRequestId: true,
          reviewedById: true,
          reviewedAt: true,
          reviewNote: true,
          // ── Ghi đè 06/10/2026: lượt `DISMISSED` = đã được thay bằng chỉnh tay. Vẫn ĐỌC để
          // panel in lịch sử (gạch ngang), nhưng KHÔNG vào cột Quét / số lượt / cờ — đó là
          // những thứ nói về bức tranh engine đang tính (`LUOT_CON_TINH`).
          reviewStatus: true,
        },
      })
    : [];

  // ── Dữ liệu để panel NÓI ĐỦ cho người sắp sửa giờ ────────────────────────────────────
  //
  // Ba thứ, thiếu cái nào người sửa cũng đang đoán:
  //   · CA hôm đó (giờ kế hoạch, các đoạn, nghỉ giữa giờ) — để biết giờ đang sửa lệch bao nhiêu;
  //   · ĐƠN đã áp lên ngày này, ai duyệt lúc nào — để không sửa chồng lên một đơn vừa duyệt;
  //   · ai đã sửa tay ngày này rồi (suy từ `logsDay`: source MANUAL_ADJUST + adjustRequestId null).
  const maCaTrongNgay = [
    ...new Set(
      [...days.map((d) => d.templateCode), ...assignments.map((a) => a.templateCode)].filter(
        (x): x is string => typeof x === "string",
      ),
    ),
  ];
  // Tên điểm chấm của những lượt trong ngày — để panel nói được "Quầy CS1" chứ không chỉ mã
  // cơ sở. Chỉ tra những điểm THỰC SỰ xuất hiện, không quét cả bảng.
  const idDiem = [
    ...new Set(logsDay.map((l) => l.workLocationId).filter((x): x is string => typeof x === "string")),
  ];
  const [mauCa, donDaAp, nguoiSua, diemCham] = await Promise.all([
    maCaTrongNgay.length
      ? sdb.shiftTemplate.findMany({
          where: { code: { in: maCaTrongNgay }, centerId: null },
          select: {
            code: true,
            name: true,
            segments: true,
            nominalMinutes: true,
            pmBreakStart: true,
            pmBreakEnd: true,
            dayCredit: true,
            soCapQuetKyVong: true,
          },
        })
      : Promise.resolve([]),
    userIds.length
      ? sdb.workRequest.findMany({
          where: { requesterId: { in: userIds }, fromDate: workDate, status: { in: [...TRANG_THAI_CON_HIEU_LUC] } },
          select: {
            id: true,
            kind: true,
            requesterId: true,
            reviewedByName: true,
            reviewedAt: true,
            reviewNote: true,
            requestedInAt: true,
            requestedOutAt: true,
            requestedIn2At: true,
            requestedOut2At: true,
          },
          orderBy: { reviewedAt: "asc" },
        })
      : Promise.resolve([]),
    // Tên người đã sửa tay — `reviewedById` là id trần.
    (async () => {
      const ids = [
        ...new Set(
          logsDay
            .map((l) => l.reviewedById)
            .filter((x): x is string => typeof x === "string"),
        ),
      ];
      if (!ids.length) return new Map<string, string>();
      const us = await sdb.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      });
      return new Map(us.map((u) => [u.id, u.name ?? u.email ?? u.id]));
    })(),
    idDiem.length
      ? sdb.workLocation.findMany({
          where: { id: { in: idDiem } },
          select: { id: true, code: true, name: true, centerId: true },
        })
      : Promise.resolve([]),
  ]);
  const tenDiem = new Map(diemCham.map((d) => [d.id, d.name]));
  const caTheoMa = new Map(mauCa.map((t) => [t.code, t]));
  const users = await sdb.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  // ── Một dòng = một người trong ngày (công thức GIỮ NGUYÊN từ bản cũ) ────────────────
  type Row = {
    detail: DayRow;
    taps: number;
    quet: string;
    gio: string;
    credit: number | null;
    override: boolean;
    overrideNote: string | null;
    locked: boolean;
    computed: boolean;
    flags: string[];
    name: string;
  };

  const rows: Row[] = userIds
    .map((userId) => {
      const d = days.find((x) => x.userId === userId) ?? null;
      // `myAll` = mọi lượt ACCEPTED (kể cả đã bị thay) — cho danh sách lịch sử trong panel.
      // `my` = chỉ lượt CÒN TÍNH — cho cột Quét, số lượt, cờ, nơi quét: phải khớp với thứ
      // engine đang tính, không thì dòng nói "08:32 → 17:40" trong khi công tính theo 08:00.
      const myAll = logsDay.filter((l) => l.userId === userId);
      const my = myAll.filter((l) => !laLuotDaBiThay(l));
      const firstIn =
        my.find((l) => l.direction === "CHECK_IN")?.loggedAt ?? null;
      const lastOut =
        [...my].reverse().find((l) => l.direction === "CHECK_OUT")?.loggedAt ??
        null;
      const asg = assignments.find((a) => a.userId === userId) ?? null;
      const name = nameOf.get(userId) ?? userId;
      const worked = d?.workedMinutes ?? 0;
      const expected = d?.expectedMinutes ?? 0;
      const credit = d ? (d.overrideUnits ?? d.dayCreditEarned) : null;
      const flags = (d ? d.flags : [...new Set(my.flatMap((l) => l.flags))])
        .slice()
        .sort((a, b) => flagRank(a) - flagRank(b));
      const taps: DayTap[] = myAll.map((l) => ({
        time: hhmm(l.loggedAt),
        dir: l.direction === "CHECK_IN" ? "IN" : "OUT",
        flags: l.flags.slice().sort((a, b) => flagRank(a) - flagRank(b)),
        // `MANUAL_ADJUST` + có `adjustRequestId` = vào bằng ĐƠN đã duyệt.
        // `MANUAL_ADJUST` + null = quản lý SỬA TAY ngoài luồng đơn. Hai thứ khác nhau về
        // căn cứ, nên phải hiện khác nhau (luật 12: nhãn phải nói thật).
        nguon:
          l.source !== "MANUAL_ADJUST"
            ? "QUET"
            : l.adjustRequestId
              ? "QUA_DON"
              : "SUA_TAY",
        // D1: MỖI LƯỢT mang nơi của CHÍNH NÓ — check in ở CS1 và check out ở CS2 là
        // chuyện hợp lệ, và mỗi mốc phải nói đúng chỗ của mình.
        noiQuet: maCoSoTheoId.get(l.centerId) ?? null,
        diemCham: l.workLocationId ? (tenDiem.get(l.workLocationId) ?? null) : null,
        nguoiSua: l.reviewedById ? (nguoiSua.get(l.reviewedById) ?? null) : null,
        suaLuc: l.reviewedAt ? hhmm(l.reviewedAt) : null,
        ghiChu: l.reviewNote,
        daBiThay: laLuotDaBiThay(l),
      }));

      const ca = d?.templateCode ?? asg?.templateCode ?? null;
      const mau = ca ? (caTheoMa.get(ca) ?? null) : null;

      return {
        name,
        taps: my.length,
        quet: my.length
          ? `${hhmm(firstIn)} → ${hhmm(lastOut)} ·${my.length}` +
            // ── D1 (10/09/2026): GHI RÕ NƠI QUÉT, bỏ nhãn "quét nơi khác" ───────────
            //
            // Luật ở `lib/cham-cong/noi-quet.ts` (THUẦN, có test) — không viết inline ở đây:
            // nhãn này là thứ người vận hành đọc mỗi ngày, và inline thì không cấy thử được.
            nhanNoiQuet(noiQuetKhacNoiChiuCong(my, coSo, maCoSoTheoId))
          : "—",
        gio: `${fmtMin(worked)} / ${fmtMin(expected)}`,
        credit,
        override: d?.overrideUnits != null,
        overrideNote: d?.overrideNote ?? null,
        locked: d?.status === "LOCKED",
        computed: !!d,
        flags,
        detail: {
          userId,
          name,
          ca: mau
            ? {
                code: mau.code,
                name: mau.name,
                // `segments` là `Json` — ép về hình dạng panel cần, bỏ dòng hỏng thay vì
                // để `undefined` lọt xuống client rồi vẽ ra "undefined–undefined".
                doan: Array.isArray(mau.segments)
                  ? (mau.segments as unknown[]).flatMap((x) => {
                      const o = (x ?? {}) as Record<string, unknown>;
                      return typeof o.start === "string" && typeof o.end === "string"
                        ? [
                            {
                              start: o.start,
                              end: o.end,
                              kind: typeof o.kind === "string" ? o.kind : "WORK",
                              place: typeof o.place === "string" ? o.place : null,
                            },
                          ]
                        : [];
                    })
                  : [],
                nghiGiuaGio:
                  mau.pmBreakStart && mau.pmBreakEnd
                    ? `${mau.pmBreakStart}–${mau.pmBreakEnd}`
                    : null,
                gioChuan: mau.nominalMinutes != null ? fmtMin(mau.nominalMinutes) : null,
                congChuan: mau.dayCredit,
              }
            : null,
          donDaAp: donDaAp
            .filter((r) => r.requesterId === userId)
            .map((r) => ({
              id: r.id,
              kind: r.kind as string,
              nguoiDuyet: r.reviewedByName,
              luc: r.reviewedAt ? hhmm(r.reviewedAt) : null,
              ghiChu: r.reviewNote,
              // Đủ 4 mốc (06/10/2026) — in thiếu mốc lần 2 là panel nói một đằng, sổ ghi một nẻo.
              gioDeNghi:
                moTaMoc([r.requestedInAt, r.requestedOutAt, r.requestedIn2At, r.requestedOut2At]) || null,
            })),
          code: d?.templateCode ?? asg?.templateCode ?? null,
          source: (asg?.source as ShiftSource | undefined) ?? undefined,
          dayType: (d?.dayType as DayType | undefined) ?? null,
          taps,
          // Số ô mốc mặc định của form ghi đè: ca khai 2 cặp quét ⇒ 4 ô, còn lại 2 ô. Ô lưới
          // (ảnh chụp lúc xếp) trước, mẫu ca sau.
          soMocCa: soMocCuaCa(asg?.soCapQuetKyVong ?? mau?.soCapQuetKyVong ?? null),
          worked: fmtMin(worked),
          expected: fmtMin(expected),
          // Phút theo đơn đã duyệt (OT…) — chữ dựng ở MỘT chỗ (`dong-phut-don.ts`).
          phutDon: d ? dongPhutDon(d) : [],
          credit,
          engineCredit: d?.dayCreditEarned ?? null,
          override: d?.overrideUnits != null,
          overrideNote: d?.overrideNote ?? null,
          computed: !!d,
          flags,
          workDate: dateStr,
          dateLabel,
          blockLabel: block.label,
          absenceStatus: d?.absenceStatus ?? null,
          absenceNote: d?.absenceNote ?? null,
        },
      };
    })
    .sort(
      (a, b) =>
        rowRank(a.flags) - rowRank(b.flags) ||
        a.name.localeCompare(b.name, "vi-VN"),
    );

  const kpiIssues = rows.filter((r) => r.flags.some(countsAsIssue)).length;
  const kpiScanned = rows.filter((r) => r.taps > 0).length;
  const kpiShift = rows.filter((r) => r.detail.code).length;
  const kpiPending = rows.filter((r) => !r.computed).length;
  const kpiOverride = rows.filter((r) => r.override).length;

  const qLower = q.toLowerCase();
  const visible = rows.filter((r) => {
    if (loc === "co" && !r.flags.some(countsAsIssue)) return false;
    if (loc === "chuaquet" && r.taps > 0) return false;
    if (loc === "ghide" && !r.override) return false;
    if (qLower && !r.name.toLowerCase().includes(qLower)) return false;
    return true;
  });

  // ── Dải ngày của tháng ────────────────────────────────────────────────────────────
  const flagByDay = new Map<string, number>();
  const holidayDays = new Set<string>();
  for (const r of monthRows) {
    const ymd = r.workDate.toISOString().slice(0, 10);
    if (r.flags.some(countsAsIssue))
      flagByDay.set(ymd, (flagByDay.get(ymd) ?? 0) + 1);
    if (r.dayType === "HOLIDAY") holidayDays.add(ymd);
  }
  for (const h of holidays) {
    if (h.attendanceEffect === "INFO_ONLY") continue;
    const end = h.endDate ?? h.date;
    for (
      let d = new Date(h.date);
      d <= end;
      d = new Date(d.getTime() + 86_400_000)
    ) {
      holidayDays.add(d.toISOString().slice(0, 10));
    }
  }
  const stripDays: DayStripDay[] = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const ymd = `${ky}-${String(i).padStart(2, "0")}`;
    const wd = vnWeekday(vnDateAt(year, month - 1, i, 12));
    stripDays.push({
      ymd,
      day: i,
      wd,
      flagCount: flagByDay.get(ymd) ?? 0,
      type: holidayDays.has(ymd)
        ? "HOLIDAY"
        : weeklyOff.includes(wd)
          ? "WEEKLY_OFF"
          : "WORK",
      href: here({ date: ymd }),
    });
  }

  const locked = period.status === "LOCKED";

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Bảng công ngày"
        subtitle={SUBTITLE}
        actions={
          <>
            <Link
              href={`/cham-cong/man-hinh?centerId=${coSo}`}
              className={BTN_OUTLINE}
            >
              <Monitor aria-hidden className="h-4 w-4" /> Màn hình QR
            </Link>
            {canAssign && (
              // `scopeHref` chứ không href trần: màn import ĐỌC cả `ky` lẫn `coSo`, đi tay là
              // người đang soát CS2 tháng 08 bấm sang rơi về tháng hiện tại của khối đầu tiên.
              <Link
                href={scopeHref("/cham-cong/phan-ca/import", { ky, coSo })}
                className={BTN_OUTLINE}
              >
                <FileSpreadsheet aria-hidden className="h-4 w-4" /> Import lịch
              </Link>
            )}
          </>
        }
      />

      <ModuleNav
        active="ngay"
        scope={scope}
        ctx={{ ky, coSo, date: dateStr }}
      />

      <ScopeBar
        basePath="/cham-cong"
        blocks={scope
          .blocksWith(VIEW)
          .map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        month={{
          ky,
          prevHref: here({ date: monthStepDate(dateStr, -1) }),
          nextHref: here({ date: monthStepDate(dateStr, 1) }),
        }}
        period={{
          status: period.status,
          standardUnits: period.standardUnits,
          href: kyHref,
        }}
        keep={{ date: dateStr, ...(loc ? { loc } : {}), ...(q ? { q } : {}) }}
      />

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi dòng là một người trong ngày đang chọn. Công được tính theo ca đã
          xếp trong lưới phân ca — lượt quét vào/ra chỉ dùng để gắn cờ (đi muộn,
          thiếu lượt, ngoài vùng…) cho quản lý rà lại, không tự trừ công.
        </p>
        <p className="mt-2">
          Số đỏ trên dải ngày là số người có cờ cần rà của ngày đó. Bấm tên một
          người để xem từng lượt quét và ghi đè công (phải ghi lý do; mọi lần
          ghi đè đều được lưu vết).
        </p>
      </PageHelp>

      {/* Chỉ những mã ca CÓ TRONG NGÀY đang xem — đúng thứ đang hiện trên bảng, không phải
          cả danh mục 21 mã. Người rà không phải lọc bằng mắt. */}
      <BangGioCa maCa={dongGioCa(mauCa)} className="mt-4 mb-5" />

      <DayStrip days={stripDays} selected={dateStr} today={today} />

      <KpiStrip
        cols={5}
        items={[
          // `KpiStrip` không tự format (xem hợp đồng ở kpi-strip.tsx) — số phải được định dạng
          // vi-VN tại đây, kẻo một khối vượt 1.000 là hàng KPI có ô "1.234" cạnh ô "1234".
          {
            icon: Users,
            value: kpiShift.toLocaleString("vi-VN"),
            label: "Có ca",
            tone: "brand",
            hint: `${rows.length.toLocaleString("vi-VN")} người trong ngày`,
          },
          {
            icon: ClipboardCheck,
            value: kpiScanned.toLocaleString("vi-VN"),
            label: "Đã quét",
            tone: "info",
          },
          {
            icon: Flag,
            value: kpiIssues.toLocaleString("vi-VN"),
            label: "Cờ cần rà",
            tone: "danger",
            href: here({ loc: "co" }),
          },
          {
            icon: CalendarClock,
            value: kpiPending.toLocaleString("vi-VN"),
            label: "Chờ tính",
            tone: "warning",
            hint: kpiPending > 0 ? "Máy tính lại sau vài phút" : undefined,
          },
          {
            icon: PencilLine,
            value: kpiOverride.toLocaleString("vi-VN"),
            label: "Đã ghi đè",
            tone: "warning",
            href: here({ loc: "ghide" }),
          },
        ]}
      />

      {locked && (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <Lock aria-hidden className="h-4 w-4 shrink-0" />
          Kỳ {ky.slice(5)}/{ky.slice(0, 4)} đã chốt — công ngày chỉ đổi qua đơn
          chỉnh công.
          <Link
            href={kyHref}
            className="font-medium text-primary hover:underline"
          >
            Sang màn Kỳ công
          </Link>
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {LOC_CHIPS.map((c) => (
            <Link
              key={c.label}
              href={here({ loc: c.value })}
              aria-current={c.value === loc ? "page" : undefined}
              className={cn(CHIP, c.value === loc ? CHIP_ACTIVE : CHIP_IDLE)}
            >
              {c.label}
            </Link>
          ))}
        </div>

        {/* GET form, KHÔNG input tự push: hidden `coSo` là thứ giữ khối khi đổi ngày. */}
        <form
          method="GET"
          action="/cham-cong"
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="coSo" value={coSo} />
          {loc && <input type="hidden" name="loc" value={loc} />}
          <label htmlFor="cc-q" className="sr-only">
            Tìm theo tên nhân sự
          </label>
          <input
            id="cc-q"
            name="q"
            defaultValue={q}
            placeholder="Tìm tên nhân sự…"
            className={cn(FIELD, "w-44")}
          />
          <label htmlFor="cc-date" className="sr-only">
            Ngày công
          </label>
          <input
            id="cc-date"
            type="date"
            name="date"
            defaultValue={dateStr}
            className={FIELD}
          />
          <button type="submit" className={BTN_OUTLINE}>
            <Search aria-hidden className="h-4 w-4" /> Xem
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={`Chưa có ca hay lượt chấm ngày ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)} ở ${block.label}`}
          description={
            <>
              Có thể lịch tháng này chưa được import, hoặc cả khối nghỉ ngày
              này.
              {/* Quyền MỘT PHẦN phải nói thành lời: kế toán cơ sở có `view` mà không có `assign`
                  chỉ thấy nút Import biến mất, không biết vì sao và hỏi ai. */}
              {!canAssign && (
                <>
                  {" "}
                  Import lịch cần quyền{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    hr_attendance:assign
                  </code>{" "}
                  tại {block.label} — xin cấp ở {ASK_WHO[ASSIGN]}.
                </>
              )}
            </>
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {canAssign && (
                <Link
                  href={scopeHref("/cham-cong/phan-ca/import", { ky, coSo })}
                  className={BTN_OUTLINE}
                >
                  <FileSpreadsheet aria-hidden className="h-4 w-4" /> Import
                  lịch
                </Link>
              )}
              <Link
                href={hrefWith("/cham-cong/phan-ca", { ky, coSo })}
                className={BTN_OUTLINE}
              >
                Xem lưới phân ca
              </Link>
            </div>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Không ai khớp bộ lọc"
          description={`Ngày ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)} có ${rows.length} người, nhưng không ai khớp bộ lọc đang bật.`}
          action={
            <Link
              href={hrefWith("/cham-cong", { coSo, date: dateStr })}
              className={BTN_OUTLINE}
            >
              Bỏ lọc
            </Link>
          }
        />
      ) : (
        // Vỏ thẻ giống period-table/request-queue-table — và giống `TableSkeleton`, nếu không
        // thì khung bo góc của lúc chờ hiện ra rồi BIẾN MẤT khi dữ liệu về.
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="cham-cong-ngay">
            <table className="w-full">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className={adminTh}>
                    Nhân sự
                  </th>
                  <th scope="col" className={adminTh}>
                    Ca
                  </th>
                  <th scope="col" className={adminTh}>
                    Quét
                  </th>
                  <th scope="col" className={cn(adminTh, "text-right")}>
                    Giờ / KH
                  </th>
                  <th scope="col" className={cn(adminTh, "text-right")}>
                    Công
                  </th>
                  <th scope="col" className={adminTh}>
                    Cờ
                  </th>
                  <th scope="col" className={adminTh}>
                    <span className="sr-only">Chi tiết</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  // `relative` là NEO của lớp phủ trong `DayDetailSheet` (`after:inset-0`);
                  // `group` để mũi tên cuối dòng đổi màu theo hover của cả hàng;
                  // `cursor-pointer` để con trỏ nói đúng sự thật — cả dòng bấm được.
                  <tr
                    key={r.detail.userId}
                    className={cn(
                      adminTr,
                      "relative h-11 cursor-pointer group",
                    )}
                  >
                    <td className={cn(adminTd, "py-0")}>
                      <DayDetailSheet
                        row={r.detail}
                        canAdjust={canAdjust}
                        locked={r.locked || locked}
                        kyHref={kyHref}
                      />
                    </td>
                    <td className={cn(adminTd, "py-0")}>
                      <span className="flex items-center gap-1.5">
                        <ShiftCodeChip
                          code={r.detail.code}
                          source={r.detail.source}
                          size="sm"
                        />
                        <DayTypePill type={r.detail.dayType} />
                      </span>
                    </td>
                    <td className={cn(adminTd, "py-0 font-mono tabular-nums")}>
                      {r.quet}
                    </td>
                    <td className={cn(adminTd, "py-0 text-right tabular-nums")}>
                      {r.gio}
                    </td>
                    <td className={cn(adminTd, "py-0 text-right")}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {r.credit != null ? (
                          <span className="font-semibold tabular-nums">
                            {r.credit}
                          </span>
                        ) : (
                          <span
                            className={cn(
                              PILL,
                              "bg-muted text-muted-foreground",
                            )}
                          >
                            Chờ tính
                          </span>
                        )}
                        {r.override && (
                          <span
                            className={cn(
                              PILL,
                              "bg-state-warning-soft text-state-warning-ink",
                            )}
                            title={r.overrideNote ?? "Quản lý đã ghi đè"}
                          >
                            ghi đè
                          </span>
                        )}
                        {r.locked && (
                          <Lock
                            aria-label="Ngày đã chốt"
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                        )}
                      </span>
                    </td>
                    <td className={cn(adminTd, "py-0 whitespace-normal")}>
                      <FlagList codes={r.flags} max={2} />
                    </td>
                    <td className={cn(adminTd, "py-0 text-right")}>
                      {/* Mũi tên GIỮ `aria-hidden`: nó nằm TRONG vùng bấm (lớp phủ của
                          `SheetTrigger` phủ kín hàng) nhưng không phải nút riêng — điều
                          khiển có nhãn là chính `SheetTrigger` với `aria-label="Chi tiết
                          <tên>"`. Đọc thêm "chevron right" chỉ là nhiễu cho người dùng
                          trình đọc màn hình. Nó nay ĐỔI MÀU theo hover của hàng, nên nó
                          không còn là hình vẽ chết. */}
                      <ChevronRight
                        aria-hidden
                        className="ml-auto h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {/* dd/MM/yyyy chứ không phải chuỗi ISO máy đọc — cả module in ngày theo kiểu Việt. */}
        Ngày công tính theo giờ Việt Nam. Hôm nay:{" "}
        {`${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`}.
      </p>
    </div>
  );
}
