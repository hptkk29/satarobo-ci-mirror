// app/(admin)/admin/cham-cong/checkin/page.tsx — CHẤM CÔNG: đích của mã QR xoay tại quầy.
//
// Vì sao màn này khác mọi màn admin: nó mở trên ĐIỆN THOẠI, người dùng đang đứng ở quầy, và mã QR
// là mã TĨNH dán ở quầy, còn VÉ thì sống 120 giây. Mọi thứ phải vừa một cột 375px và nói rõ vì
// sao bấm không được.
//
// DỄ VỠ:
// 1. `?w=<workLocationId>&t=<token>` là URL SỐNG in trong mã QR (`app/api/admin/cham-cong/qr-token`).
//    Đổi tên tham số hay đổi route = mọi mã QR đang dán ở quầy chết.
// 2. `prepareCheckin` cấp vé và GHI dấu — gọi đúng MỘT lần, chỉ khi có đủ `w` + `t`. Mở trang này
//    từ menu (không có w/t) phải ra màn "chưa quét mã", KHÔNG được gọi hàm cấp vé rồi in lỗi đỏ.
// 3. Thiếu quyền thì hiện NoPermission tại chỗ, KHÔNG `redirect("/dashboard")`: người đang đứng ở
//    quầy quét mã mà bị ném về bảng điều khiển desktop thì không hiểu chuyện gì vừa xảy ra.
// 4. GPS CHẶN ở điểm đã khai toạ độ + đã bật định vị (đổi 07/09 cùng QR tĩnh). Điểm chưa khai
//    toạ độ vẫn theo luật cũ: ghi nhận rồi gắn cờ.
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { ipKhachHang } from "@/lib/security/client-ip";
import { CheckinClient, type CheckinToday } from "@/components/cham-cong/checkin-client";
import { prepareCheckin } from "@/lib/cham-cong/checkin-gate";
import { getMyAssignments, getMyAttendanceDays, getMyTapsOfDay } from "@/lib/cham-cong/my-schedule";
import { NutChamNgoai } from "@/components/cham-cong/nut-cham-ngoai";
import { quyenChamNgoaiLucNay } from "@/lib/cham-cong/cham-ngoai-db";
import { vnDateOnly } from "@/lib/time/vn";
import { ASK_WHO } from "@/lib/cham-cong/module-scope";
import { vnYmd } from "@/lib/time/vn";
import { suyHuongHomNay } from "@/lib/cham-cong/suy-huong-db";
import { EmptyState, ErrorState, NoPermission } from "@/components/admin/ui/states";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import type { ShiftSource } from "@/components/cham-cong/ui/shift-code-chip";

export const metadata = { title: "Chấm công | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const SOURCES = new Set<string>(["PATTERN", "IMPORT", "MANUAL", "SWAP", "LEAVE", "HOLIDAY"]);
const OLD_QR =
  "Mã QR cũ (cố định theo cơ sở) không còn dùng. Mở màn hình chấm công mới tại quầy rồi quét lại.";

/** Giờ VN "HH:mm" của một mốc. */
const vnYmdGio = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);

const fmtMin = (m: number) => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : null);

interface Props {
  searchParams: Promise<{ w?: string; t?: string; c?: string }>;
}

/** Dải "Hôm nay": ca được xếp + tình trạng công ngày của CHÍNH người đăng nhập. */
async function loadToday(userId: string): Promise<CheckinToday> {
  const from = new Date(`${vnYmd(new Date())}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 86_400_000);
  const [shifts, dayRows] = await Promise.all([
    getMyAssignments(userId, from, to),
    getMyAttendanceDays(userId, from, to),
  ]);
  const s = shifts[0] ?? null;
  const d = dayRows[0] ?? null;
  return {
    shiftCode: s?.code ?? null,
    shiftName: s?.name ?? null,
    shiftSource: s && SOURCES.has(s.source) ? (s.source as ShiftSource) : null,
    timeLabel: s?.timeLabel ?? "",
    placeLabel: s?.centerLabel ?? null,
    hasRecord: Boolean(d && (d.worked > 0 || d.units > 0)),
    workedLabel: d ? fmtMin(d.worked) : null,
    units: d?.units ?? null,
  };
}

export default async function CheckinPage({ searchParams }: Props) {
  const session = await auth();
  const { w, t, c } = await searchParams;
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/cham-cong/checkin?w=${w ?? ""}&t=${t ?? ""}`)}`);
  }

  const backToSchedule = (
    <Link href="/cham-cong/lich-ca" className={BTN_OUTLINE}>
      Về lịch ca của tôi
    </Link>
  );

  const shell = (body: React.ReactNode) => (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-center text-xl font-bold tracking-tight text-foreground">Chấm công</h1>
      {body}
    </div>
  );

  if (!(await checkPermission("hr_attendance:checkin", { centerId: null }))) {
    return shell(
      <NoPermission
        permission="hr_attendance:checkin"
        what="trang chấm công"
        askWho={ASK_WHO["hr_attendance:checkin"]}
      />,
    );
  }

  // Mã QR đời cũ (`?c=<centerId>` cố định) — nói thẳng là mã đã đổi, đừng để người ta quét lại mãi.
  if (c && !w) {
    return shell(
      <ErrorState title="Mã QR đã cũ" description={OLD_QR} action={backToSchedule} />,
    );
  }

  // Vào từ menu / bookmark: KHÔNG có mã quét thì không có gì để cấp vé — đây là chuyện bình thường,
  // không phải lỗi hệ thống.
  if (!w || !t) {
    // Đợt 5–6 đơn từ (08/10/2026): đơn LÀM TỪ XA / CÔNG TÁC đã duyệt (hoặc ca công tác) phủ lúc này
    // ⇒ chấm bằng nút ngay tại đây, không cần quét mã. Cùng hàm với cổng của `chamCongTac` nên nút
    // hiện ⇔ bấm được (luật 12). Không có quyền chấm ngoài thì vẫn là màn "cần quét mã" như cũ.
    const now = new Date();
    const quyen = await quyenChamNgoaiLucNay(session.user.id, now);
    if (quyen) {
      const taps = await getMyTapsOfDay(session.user.id, vnDateOnly(now));
      const vao = taps.find((x) => x.direction === "CHECK_IN");
      const ra = [...taps].reverse().find((x) => x.direction === "CHECK_OUT");
      const goiY = await suyHuongHomNay({ userId: session.user.id, workLocationId: null, now });
      const gio = (d: Date) => vnYmdGio(d);
      return shell(
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-foreground">Chấm công ngoài cơ sở — {quyen.nhan}</h2>
          <NutChamNgoai
            daVao={vao ? gio(vao.loggedAt) : null}
            daRa={ra ? gio(ra.loggedAt) : null}
            duDoan={{ huong: goiY.huong, nhanBuoi: goiY.nhanBuoi, trung: goiY.trung }}
            donChinhCongHref="/don-tu/cua-toi?type=TIMESHEET_FIX"
          />
        </section>,
      );
    }
    return shell(
      <EmptyState
        title="Cần quét mã QR tại quầy"
        description="Mở từ menu thì không chấm được — phải quét mã. Dùng camera điện thoại quét mã QR dán tại quầy (hoặc chiếu trên màn hình quầy) của cơ sở."
        action={backToSchedule}
      />,
    );
  }

  const h = await headers();
  const gate = await prepareCheckin({
    token: t,
    workLocationId: w,
    userId: session.user.id,
    ip: ipKhachHang(h),
  });

  if (!gate.ok) {
    return shell(<ErrorState title="Chưa chấm công được" description={gate.error} action={backToSchedule} />);
  }

  // Dự đoán hướng lượt này (MỘT nút, 06/10/2026) — chỉ để hiện trước khi bấm; `recordCheckin`
  // suy lại lúc bấm và đó mới là hướng được ghi.
  const [today, duDoan] = await Promise.all([
    loadToday(session.user.id),
    suyHuongHomNay({ userId: session.user.id, workLocationId: gate.workLocation.id, now: new Date() }),
  ]);

  return shell(
    <>
      <CheckinClient
        ticketId={gate.ticketId}
        nonce={gate.nonce}
        expiresAt={gate.expiresAt}
        locationName={gate.workLocation.name}
        geofenceEnabled={gate.workLocation.geofenceEnabled}
        today={today}
        afterHref="/cham-cong/lich-ca"
        afterLabel="Lịch ca của tôi"
        // `/don-tu/cua-toi` ĐỌC `?type=` (mở sẵn form đúng loại) và `?date=` (điền sẵn ngày).
        donHref={`/don-tu/cua-toi?type=TIMESHEET_FIX&date=${vnYmd(new Date())}`}
        duDoan={{ huong: duDoan.huong, nhanBuoi: duDoan.nhanBuoi, trung: duDoan.trung }}
      />
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Quét nhầm mã của cơ sở khác sẽ bị từ chối. Dạy thay ở cơ sở khác thì báo Quản lý cơ sở đó xác nhận công.
      </p>
    </>,
  );
}
