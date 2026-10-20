// app/(admin)/admin/cham-cong/man-hinh/page.tsx — MÀN HÌNH QR QUẦY. Một URL, hai chế độ:
// điều khiển (người trực ngồi bàn cấu hình + theo dõi) và trình chiếu (lớp phủ toàn màn hình
// cho TV ở quầy, xem `_components/kiosk-stage.tsx`).
//
// ĐIỀU DỄ VỠ:
//  - Hội sở KHÔNG có điểm chấm công (Q-04) ⇒ chip cơ sở loại khối HO ra; ai gõ tay
//    `?centerId=hoi-so` thì gặp màn rỗng nói rõ lý do, không phải bảng trống.
//  - Mã QR trỏ tới `/cham-cong/checkin?w=&t=` do `/api/admin/cham-cong/qr-token` dựng. ĐỪNG
//    đổi route đó: mọi mã đã in/đang chiếu sẽ chết. Trang này không sửa API, chỉ đọc.
//  - "Lượt chấm hôm nay" có tên người ⇒ chỉ ở chế độ điều khiển.
import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, ScanLine } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { vnDateOnly, vnParts } from "@/lib/time/vn";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { ASK_WHO, loadModuleScope } from "@/lib/cham-cong/module-scope";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import { laLuotDaBiThay } from "@/lib/cham-cong/sua-gio-quet";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/cham-cong/classes";
import { QrScreen } from "./_components/qr-screen";
import { KioskLauncher } from "./_components/kiosk-stage";
import { TodayTaps, type TapRow } from "./_components/today-taps";

export const metadata = { title: "Màn hình QR chấm công | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ centerId?: string }>;
}

const VIEW = "hr_attendance:view" as const;
const CONFIG = "hr_attendance:config" as const;
const SUBTITLE = "Mở trên TV tại quầy — cùng mã với tờ QR dán ở quầy";
const SHELL = "max-w-3xl";

/** "14:03" theo đồng hồ VN — máy chủ Vercel chạy UTC nên không dùng `getHours()`. */
function hhmm(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export default async function ManHinhPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fman-hinh");

  const { centerId } = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  // Chỉ cơ sở VẬN HÀNH: Hội sở không có quầy nên cũng không có mã QR (Q-04).
  const blocks = scope.blocksWith(VIEW).filter((b) => b.code !== "HO");

  const head = (actions?: React.ReactNode) => (
    <PageHeader title="Màn hình QR" subtitle={SUBTITLE} actions={actions} />
  );

  if (blocks.length === 0) {
    return (
      <div className={SHELL}>
        {head()}
        <NoPermission permission={VIEW} what="màn hình QR" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  const askedHo = centerId === HO_CENTER_ID;
  const active = askedHo ? null : (blocks.find((b) => b.id === centerId) ?? null);
  // Gõ tay một cơ sở mình không xem được: nói thẳng thiếu quyền gì, không đá về dashboard.
  const denied = !!centerId && !askedHo && !active;

  const bar = (
    <ScopeBar
      basePath="/cham-cong/man-hinh"
      blocks={blocks.map((b) => ({ id: b.id, label: b.label }))}
      coSo={active?.id ?? null}
      paramName="centerId"
    />
  );

  const help = (
    <PageHelp guideSlug="nhan-su-giao-vien">
      <p>
        Chọn cơ sở rồi bấm <b>Trình chiếu</b> để đưa mã lên TV ở quầy: màn hình phủ kín, không còn
        menu quản trị và không hiện tên ai. Bấm <b>Esc</b> hoặc nút <b>Thoát</b> để quay lại.
      </p>
      <p className="mt-2">
        Mã này KHÔNG đổi — nó chính là mã in dán ở quầy. Nên ảnh chụp lại vẫn quét được, và thứ
        chặn người ở xa là ĐỊNH VỊ: điểm chấm công đã khai toạ độ thì quét ngoài phạm vi bị từ
        chối thẳng. Điểm chưa khai toạ độ thì chưa chặn được ai — vào Điểm chấm công để nhập.
        Nếu TV rớt mạng, màn hình vẫn giữ mã cuối cùng; mạng về là tự chạy lại.
      </p>
    </PageHelp>
  );

  if (denied) {
    return (
      <div className={SHELL}>
        {head()}
        {bar}
        <NoPermission permission={VIEW} what="màn hình QR của cơ sở này" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }

  if (askedHo) {
    return (
      <div className={SHELL}>
        {head()}
        {bar}
        <EmptyState
          title="Hội sở không có điểm chấm công"
          description="Mã QR gắn với một điểm chấm công tại cơ sở, mà Hội sở không có quầy. Chọn một cơ sở ở thanh trên."
          action={
            <Link href={hrefWith("/cham-cong/man-hinh", { centerId: blocks[0].id })} className={BTN_PRIMARY}>
              Mở {blocks[0].label}
            </Link>
          }
        />
      </div>
    );
  }

  if (!active) {
    return (
      <div className={SHELL}>
        {head()}
        {bar}
        {help}
        <EmptyState
          title="Chưa chọn cơ sở"
          description="Mỗi cơ sở có mã QR riêng theo điểm chấm công của nó. Chọn cơ sở ở thanh trên để hiện mã."
          action={
            <Link href={hrefWith("/cham-cong/man-hinh", { centerId: blocks[0].id })} className={BTN_PRIMARY}>
              Mở {blocks[0].label}
            </Link>
          }
        />
      </div>
    );
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const canConfig = scope.has(CONFIG, active.id);
  const wl = await sdb.workLocation.findFirst({
    where: { centerId: active.id, isActive: true },
    select: { id: true, code: true, name: true, geofenceEnabled: true, radiusMeters: true, qrKeyVersion: true },
  });

  const backHref = hrefWith("/cham-cong", { coSo: active.id });

  if (!wl) {
    return (
      <div className={SHELL}>
        {head(
          <Link href={backHref} className={BTN_OUTLINE}>
            Bảng công ngày
          </Link>,
        )}
        {bar}
        {help}
        <EmptyState
          title={`${active.label} chưa có điểm chấm công`}
          description={
            canConfig
              ? "Mã QR dựng từ điểm chấm công của cơ sở. Tạo điểm rồi quay lại màn này."
              : "Mã QR dựng từ điểm chấm công của cơ sở. Báo Quản lý cơ sở tạo điểm giúp, sau đó màn này chạy được ngay."
          }
          action={
            canConfig ? (
              <Link href="/cham-cong/diem-cham" className={BTN_PRIMARY}>
                Tạo điểm chấm công
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  // 10 lượt gần nhất trong NGÀY HÔM NAY tại cơ sở đang chiếu — đủ để biết mã có ăn không.
  const today = vnDateOnly(new Date());
  const logs = await sdb.staffTimeLog.findMany({
    where: { workDate: today, centerId: active.id, result: "ACCEPTED" },
    orderBy: { loggedAt: "desc" },
    take: 10,
    select: { id: true, userId: true, direction: true, loggedAt: true, flags: true, reviewStatus: true },
  });
  const users = logs.length
    ? await sdb.user.findMany({
        where: { id: { in: [...new Set(logs.map((l) => l.userId))] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const taps: TapRow[] = logs.map((l) => ({
    id: l.id,
    name: nameOf.get(l.userId) ?? l.userId,
    time: hhmm(l.loggedAt),
    direction: l.direction === "CHECK_IN" ? "IN" : "OUT",
    flags: l.flags,
    daBiThay: laLuotDaBiThay(l),
  }));

  const failProps = {
    centerId: active.id,
    centerLabel: active.label,
    askWho: ASK_WHO[VIEW],
    canConfig,
  };

  return (
    <div className={SHELL}>
      {head(
        <>
          <Link href={backHref} className={BTN_OUTLINE}>
            Bảng công ngày
          </Link>
          <KioskLauncher
            {...failProps}
            centerName={active.label}
            locationName={wl.name}
            geofenceEnabled={wl.geofenceEnabled}
          />
        </>,
      )}
      {bar}
      {help}

      <div className="grid gap-5 lg:grid-cols-2">
        <QrScreen {...failProps} />

        <SectionCard title="Điểm chấm công" icon={MapPin}>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Tên điểm</dt>
            <dd className="font-medium text-foreground">
              {wl.name} <span className="font-mono text-xs text-muted-foreground">{wl.code}</span>
            </dd>

            <dt className="text-muted-foreground">Kiểm định vị</dt>
            <dd className="text-foreground">
              {wl.geofenceEnabled ? `Bật · bán kính ${wl.radiusMeters}m` : "Tắt"}
            </dd>

            {/* Mã TĨNH (07/09): không còn vòng đời. Thứ người vận hành cần biết ở đây là ĐỜI
                KHOÁ — tăng nó lên là mọi tờ đã in và mọi ảnh chụp cũ chết ngay. */}
            <dt className="text-muted-foreground">Mã QR</dt>
            <dd className="text-foreground">
              Cố định · đời khoá <span className="tabular-nums">{wl.qrKeyVersion}</span>
            </dd>
          </dl>
          {canConfig && (
            <Link
              href="/cham-cong/diem-cham"
              className="mt-4 inline-flex text-sm font-medium text-primary-ink hover:underline"
            >
              Sửa điểm chấm công
            </Link>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Lượt chấm hôm nay" icon={ScanLine} className="mt-5">
        <TodayTaps rows={taps} />
      </SectionCard>
    </div>
  );
}
