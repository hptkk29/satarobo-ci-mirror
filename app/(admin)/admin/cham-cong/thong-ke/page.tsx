// app/(admin)/admin/cham-cong/thong-ke/page.tsx — NỘI QUY & THỐNG KÊ tháng.
//
// Vì sao màn này tồn tại (yêu cầu chủ dự án 06/09/2026): "Bản thống kê chấm công trong tháng cho
// quản lý và cho cả nhân viên — số ca thực tế / số ca quy định, số lần đi trễ, % nội quy bị trừ".
//
// ⚠️ ĐIỀU PHẢI HIỂU TRƯỚC KHI SỬA MÀN NÀY: cột "Ca thực tế" ở đây KHÔNG phải `dayCreditEarned`.
// Engine gán cứng `dayCreditEarned = dayCreditExpected` (luật T-01 — công đếm theo KẾ HOẠCH,
// engine không tự trừ), nên lấy hai cột đó chia nhau thì mọi người, mọi tháng đều ra 100%. "Ca
// thực tế" là đại lượng RIÊNG, đếm từ bằng chứng có mặt, và CỐ Ý không đụng tới cột công dùng để
// trả lương. Luật đếm nằm một chỗ duy nhất: `lib/cham-cong/noi-quy.ts`.
//
// Dễ vỡ:
// - Ba tham số (ngưỡng trễ, % trừ mỗi lần trễ, % trừ mỗi ngày không phép) đọc từ Cấu hình vận
//   hành theo đơn vị. Đừng in số cứng ra màn — người vận hành sửa mà màn vẫn nói số cũ.
// - "Chờ kết luận" ≠ "nghỉ không phép". Ngày vắng chỉ thành tiền phạt sau khi quản lý xác nhận
//   (chốt của chủ dự án) — vì cờ `KHONG_CO_LUOT` còn do quên quét, quầy hỏng, đi công tác.
// - Kỳ đã CHỐT: đọc `summaryJson` đã đóng băng, không dựng lại từ dữ liệu sống.
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CalendarX, Percent, UserRoundCheck, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith, shiftKy } from "@/lib/cham-cong/scope-href";
import {
  buildPeriodSummary,
  currentPeriodKey,
  parsePeriodKey,
  type PeriodSummary,
} from "@/lib/cham-cong/period";
import { nhanCa, tyLeDat } from "@/lib/cham-cong/noi-quy";
import { getSetting } from "@/lib/settings/service";
import { loadCenterMap } from "@/lib/cham-cong/home-center";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { KpiStrip } from "@/components/admin/cham-cong/kpi-strip";
import { NoiQuyTable, type NoiQuyRow } from "./_components/noi-quy-table";

export const metadata = { title: "Nội quy & thống kê | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const BASE = "/cham-cong/thong-ke";

function kyLabelOf(ky: string): string {
  const p = parsePeriodKey(ky);
  return p ? `${String(p.m).padStart(2, "0")}/${p.y}` : ky;
}

/** "3,5%" — dấu phẩy thập phân, bỏ đuôi ",0". */
function phanTram(n: number): string {
  const s = n.toFixed(n % 1 === 0 ? 0 : 1).replace(".", ",");
  return `${s}%`;
}

export default async function ThongKePage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fthong-ke");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const ky = sp.ky && parsePeriodKey(sp.ky) ? sp.ky : currentPeriodKey();
  const kyLabel = kyLabelOf(ky);

  const visible = scope.blocksWith(VIEW);
  if (visible.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title={`Nội quy & thống kê tháng ${kyLabel}`} />
        <ModuleNav active="thongke" scope={scope} ctx={{ ky, coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="thống kê chấm công" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const block = scope.pick(sp.coSo, VIEW) ?? visible[0];
  const coSo = block.id;
  const ctx = { ky, coSo };

  const sdb = scopedDb(await resolveActor(session.user.id));
  // CHỈ ĐỌC — màn này không mở kỳ. `getOrCreatePeriod` là đường GHI, để cho màn Kỳ công.
  const period = await sdb.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId: coSo, periodKey: ky } },
  });
  const locked = period?.status === "LOCKED";
  const summary: PeriodSummary =
    locked && period?.summaryJson
      ? (period.summaryJson as unknown as PeriodSummary)
      : await buildPeriodSummary(coSo, ky);

  const centerMap = await loadCenterMap();
  const orgUnitId =
    Object.values(centerMap.byCode).find((c) => c.centerId === coSo)?.orgUnitId ?? null;
  const [nguongTre, truTre, truVang] = await Promise.all([
    getSetting("shift.latePenaltyGraceMinutes", { orgUnitId }),
    getSetting("shift.penaltyLatePercent", { orgUnitId }),
    getSetting("shift.penaltyAbsentPercent", { orgUnitId }),
  ]);

  // Kỳ CHỐT TRƯỚC 07/09 có `summaryJson` đóng băng theo hình CŨ — không có `noiQuy`. Đọc thẳng
  // `r.noiQuy` là TypeError và cả màn rơi vào error boundary, tức kỳ đó không xem được nữa.
  // Không dựng lại số từ dữ liệu sống: kỳ đã chốt phải giữ nguyên con số đã dùng để trả lương.
  const RONG = { caQuyDinh: 0, caThucTe: 0, soLanTre: 0, ngayKhongPhep: 0, ngayChoKetLuan: 0, phanTramTru: 0 };
  const thieuNoiQuy = summary.rows.some((r) => !r.noiQuy);
  const rows: NoiQuyRow[] = summary.rows.map((r) => {
    const t = r.noiQuy ?? RONG;
    const tyLe = tyLeDat(t);
    return {
      userId: r.userId,
      name: r.name,
      employeeCode: r.employeeCode,
      caLabel: nhanCa(t),
      tyLe,
      tyLeLabel: tyLe === null ? "—" : phanTram(Math.round(tyLe * 1000) / 10),
      soLanTre: t.soLanTre,
      ngayKhongPhep: t.ngayKhongPhep,
      ngayChoKetLuan: t.ngayChoKetLuan,
      truLabel: phanTram(t.phanTramTru),
      truCoSo: t.phanTramTru > 0,
      // Đích: bảng công ngày, lọc "chưa quét" + tên người này. Không có ngày cụ thể ở đây nên
      // đưa về ngày đầu kỳ — người dùng bấm tiếp trên dải ngày.
      choKetLuanHref: t.ngayChoKetLuan
        ? hrefWith("/cham-cong", { coSo, date: `${ky}-01`, loc: "chuaquet", q: r.name })
        : null,
    };
  });

  const tongTre = rows.reduce((s, r) => s + r.soLanTre, 0);
  const tongKhongPhep = rows.reduce((s, r) => s + r.ngayKhongPhep, 0);
  const tongCho = rows.reduce((s, r) => s + r.ngayChoKetLuan, 0);
  const nguoiBiTru = rows.filter((r) => r.truCoSo).length;
  const tongCaThucTe = summary.rows.reduce((s, r) => s + (r.noiQuy?.caThucTe ?? 0), 0);
  const tongCaQuyDinh = summary.rows.reduce((s, r) => s + (r.noiQuy?.caQuyDinh ?? 0), 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Nội quy & thống kê tháng ${kyLabel} — ${block.label}`}
        subtitle={`Ca thực tế đếm ngày quét ĐỦ cả vào lẫn ra. Trễ quá ${nguongTre} phút tính 1 lần (trừ ${phanTram(truTre)}); mỗi ngày nghỉ không phép trừ ${phanTram(truVang)}.`}
      />

      <ModuleNav active="thongke" scope={scope} ctx={ctx} />

      <ScopeBar
        basePath={BASE}
        blocks={visible.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        month={{
          ky,
          prevHref: hrefWith(BASE, { ky: shiftKy(ky, -1), coSo }),
          nextHref: hrefWith(BASE, { ky: shiftKy(ky, 1), coSo }),
        }}
        period={{
          status: period?.status ?? null,
          standardUnits: period?.standardUnits ?? summary.standardUnits,
          href: hrefWith("/cham-cong/ky-cong", ctx),
        }}
        keep={{ ky }}
      />

      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Bảng này KHÔNG phải bảng công. Cột <b>Công</b> ở màn Kỳ công đếm theo lịch đã xếp (đi làm hay
          không thì công vẫn tính, thiếu quét chỉ sinh cờ) — đó là số dùng để trả lương. Còn <b>Ca thực tế</b>
          ở đây đếm ngày có bằng chứng có mặt trọn vẹn: quét đủ cả lượt vào lẫn lượt ra.
        </p>
        <p className="mt-2">
          <b>Chờ kết luận</b> là ngày có ca mà không có lượt quét nào — <em>chưa</em> phải nghỉ không phép.
          Quên quét, quầy hỏng, đi công tác đều rơi vào đây. Bấm vào số để mở đúng ngày rồi kết luận từng
          ngày một; chỉ ngày được xác nhận <b>không phép</b> mới vào cột trừ.
        </p>
        <p className="mt-2">
          Ba con số (ngưỡng trễ, mức trừ mỗi lần trễ, mức trừ mỗi ngày không phép) sửa ở{" "}
          <b>Cấu hình vận hành</b>, không cần lập trình viên. Sửa xong bảng tính lại ngay theo số mới.
        </p>
      </PageHelp>

      <KpiStrip
        cols={5}
        items={[
          {
            icon: UserRoundCheck,
            label: "Ca thực tế cả khối",
            value: tongCaQuyDinh ? `${tongCaThucTe} / ${tongCaQuyDinh}` : "—",
            hint: "quét đủ vào và ra",
          },
          { icon: AlarmClock, label: `Lần trễ (quá ${nguongTre}′)`, value: tongTre, tone: tongTre ? "warning" : "brand" },
          { icon: CalendarX, label: "Ngày nghỉ không phép", value: tongKhongPhep, tone: tongKhongPhep ? "danger" : "brand" },
          {
            icon: Users,
            label: "Ngày vắng chờ kết luận",
            value: tongCho,
            tone: tongCho ? "warning" : "brand",
            hint: tongCho ? "chưa trừ đồng nào" : undefined,
          },
          { icon: Percent, label: "Người bị trừ nội quy", value: nguoiBiTru, tone: nguoiBiTru ? "danger" : "brand" },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={`Chưa có ai trong ${block.label} kỳ tháng ${kyLabel}`}
          description="Bảng này dựng từ lưới phân ca của kỳ. Chưa xếp lưới thì chưa có gì để thống kê."
          action={
            <Link href={hrefWith("/cham-cong/phan-ca", ctx)} className={BTN_OUTLINE}>
              Xem lưới phân ca
            </Link>
          }
        />
      ) : (
        <NoiQuyTable rows={rows} />
      )}

      {thieuNoiQuy && (
        <p className="mt-3 rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Kỳ này được chốt trước khi có thống kê nội quy, nên bản đóng băng không mang các số ở đây —
          bảng trên hiện 0. Số công của kỳ vẫn nguyên vẹn ở màn Kỳ công.
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {locked
          ? `Kỳ đã chốt — số ở đây là bản đóng băng lúc chốt, không đổi theo dữ liệu sống.`
          : `Số cập nhật sau mỗi lượt quét hoặc mỗi lần đổi ca. Kỳ chốt xong sẽ đóng băng.`}
      </p>
    </div>
  );
}
