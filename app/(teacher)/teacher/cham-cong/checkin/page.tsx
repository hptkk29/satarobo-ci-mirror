// app/(teacher)/teacher/cham-cong/checkin/page.tsx — trang check-in trên site GV (L0 mở đường,
// L4 đổi sang QR xoay + vé 120s). Đích của mã QR tại quầy khi người quét là GV thuần:
// `admin.satarobo.vn/cham-cong/checkin?w=&t=` → decideRoute đá sang giaovien GIỮ path+query → đây.
// Cùng client + action + cổng với màn admin (components/cham-cong, lib/cham-cong/checkin-gate).
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { ipKhachHang } from "@/lib/security/client-ip";
import { CheckinClient } from "@/components/cham-cong/checkin-client";
import { prepareCheckin } from "@/lib/cham-cong/checkin-gate";
import { suyHuongHomNay } from "@/lib/cham-cong/suy-huong-db";
import { PageHeader } from "../../_components/ui/page-header";

export const metadata = { title: "Chấm công | Giáo viên", robots: { index: false } };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ w?: string; t?: string; c?: string }>;
}

export default async function TeacherCheckinPage({ searchParams }: Props) {
  const session = await auth();
  const { w, t, c } = await searchParams;
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/cham-cong/checkin?w=${w ?? ""}&t=${t ?? ""}`)}`);
  }
  if (!(await checkPermission("hr_attendance:checkin", { centerId: null }))) redirect("/teacher");
  const h = await headers();
  const gate = c && !w
    ? { ok: false as const, error: "Mã QR cũ (cố định theo cơ sở) không còn dùng. Mở màn hình chấm công mới tại quầy rồi quét lại." }
    : await prepareCheckin({ token: t, workLocationId: w, userId: session.user.id, ip: ipKhachHang(h) });
  // Dự đoán hướng lượt này (MỘT nút, 06/10/2026) — chỉ để hiện trước khi bấm; `recordCheckin`
  // suy lại lúc bấm và đó mới là hướng được ghi.
  const duDoan = gate.ok
    ? await suyHuongHomNay({ userId: session.user.id, workLocationId: gate.workLocation.id, now: new Date() })
    : null;

  return (
    <div className="mx-auto max-w-sm">
      <PageHeader title="Chấm công" subtitle="Bấm nút Chấm công mỗi lần tới hoặc về — hệ thống tự biết là vào hay ra." />
      {gate.ok ? (
        <CheckinClient ticketId={gate.ticketId} nonce={gate.nonce} expiresAt={gate.expiresAt} locationName={gate.workLocation.name} geofenceEnabled={gate.workLocation.geofenceEnabled}
          // `/teacher/don-tu` ĐỌC `?type=` (mở sẵn form đúng loại); KHÔNG đọc `?date=` nên không gửi.
          donHref="/teacher/don-tu?type=TIMESHEET_FIX"
          duDoan={duDoan ? { huong: duDoan.huong, nhanBuoi: duDoan.nhanBuoi, trung: duDoan.trung } : null}
        />
      ) : (
        <p className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground">{gate.error}</p>
      )}
    </div>
  );
}
