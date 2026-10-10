import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { maskEmail, maskPhone } from "@/lib/utils";
import { getSetting } from "@/lib/settings/service";
import { formatPhoneVN } from "@/lib/phone";
import type { Prisma, OtpPurpose } from "@prisma/client";
import { PageHelp } from "@/components/admin/ui/page-help";
import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { docSoDong } from "@/lib/ui/phan-trang";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";

// AUTH-SĐT P4 — màn trả lời câu "phụ huynh báo không nhận được mã": trước đây
// 0 UI nào đọc OtpRequest/OtpDeliveryLog, nhân viên phải mò Email logs (sắp
// mất tác dụng khi mã đi Zalo). Quyền dùng chung `emails:view` với /email-logs
// — cùng nhóm nhân viên trực hỗ trợ, không đẻ action RBAC mới (v2 đang enforce
// trên prod, thêm action = phải seed RolePermission prod).
export const metadata = { title: "OTP Logs | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ q?: string; purpose?: string; page?: string; size?: string }>;
}

const PURPOSES: OtpPurpose[] = ["ACTIVATION", "RESET", "CHANGE_CONTACT"];
const PURPOSE_LABEL: Record<string, string> = {
  ACTIVATION: "Kích hoạt",
  RESET: "Quên mật khẩu",
  CHANGE_CONTACT: "Đổi liên hệ",
};
const ZNS_COST_VND = 300; // QĐ-E — đơn giá 1 tin ZNS Xác thực

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function maskTarget(target: string, canViewPii: boolean): string {
  if (canViewPii) return target.includes("@") ? target : formatPhoneVN(target);
  return target.includes("@")
    ? maskEmail(target)
    : maskPhone(formatPhoneVN(target));
}

/** Delivery FAILED có key lỗi người-nhận (không phải lỗi hệ thống). */
function shortError(error: string | null): string {
  if (!error) return "";
  return error.split(":")[0] ?? error;
}

export default async function OtpLogsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("emails:view")))
    redirect("/dashboard?error=unauthorized");
  const canViewPii = await canViewLeadPii();

  // OtpRequest/OtpDeliveryLog là model global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const purpose = PURPOSES.includes(sp.purpose as OtpPurpose)
    ? (sp.purpose as OtpPurpose)
    : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const soDong = docSoDong(sp.size);

  const where: Prisma.OtpRequestWhereInput = {};
  if (q) where.target = { contains: q };
  if (purpose) where.purpose = purpose;

  const [
    totalCount,
    rows,
    sentToday,
    znsSentToday,
    znsUserErrToday,
    dailyCap,
    killSwitch,
  ] = await Promise.all([
    sdb.otpRequest.count({ where }),
    sdb.otpRequest.findMany({
      where,
      include: { deliveries: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * soDong,
      take: soDong,
    }),
    sdb.otpDeliveryLog.count({
      where: { status: "SENT", createdAt: { gte: startOfToday() } },
    }),
    sdb.otpDeliveryLog.count({
      where: {
        status: "SENT",
        channel: "ZALO",
        createdAt: { gte: startOfToday() },
      },
    }),
    sdb.otpDeliveryLog.count({
      where: {
        status: "FAILED",
        channel: "ZALO",
        createdAt: { gte: startOfToday() },
        OR: [
          { error: { startsWith: "ZNS_NO_ZALO_ACCOUNT" } },
          { error: { startsWith: "ZNS_USER_REFUSED" } },
          { error: { startsWith: "ZNS_USER_UNREACHABLE" } },
        ],
      },
    }),
    getSetting("otp.globalDailyCap"),
    getSetting("otp.globalKillSwitch"),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / soDong));

  function urlFor(p: Partial<{ q: string; purpose: string; page: number }>) {
    const u = new URLSearchParams();
    if (p.q) u.set("q", p.q);
    if (p.purpose) u.set("purpose", p.purpose);
    if (p.page && p.page > 1) u.set("page", String(p.page));
    return `/otp-logs${u.toString() ? "?" + u.toString() : ""}`;
  }

  const stat = (label: string, value: string, warn = false) => (
    <div
      className={`rounded-lg border px-4 py-2 ${warn ? "border-state-danger bg-state-danger-soft" : "border-border bg-card"}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-bold ${warn ? "text-state-danger-ink" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">OTP Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tra cứu mã OTP đã gửi cho phụ huynh
        </p>
      </div>

      <PageHelp>
        <p>
          Tra cứu &quot;phụ huynh báo không nhận được mã&quot; — mỗi yêu cầu OTP
          kèm các lần gửi (Zalo ZNS / email dự phòng).
        </p>
      </PageHelp>

      <div className="flex flex-wrap gap-3">
        {stat(
          "Tin đã gửi hôm nay",
          `${sentToday}/${dailyCap}`,
          sentToday >= dailyCap,
        )}
        {stat("Ngưỡng tự ngắt", String(killSwitch), sentToday >= killSwitch)}
        {stat(
          "Chi phí ZNS hôm nay (ước)",
          `${(znsSentToday * ZNS_COST_VND).toLocaleString("vi-VN")}đ`,
        )}
        {stat(
          "ZNS lỗi người nhận hôm nay",
          String(znsUserErrToday),
          znsUserErrToday > 30,
        )}
      </div>

      <form className="flex flex-wrap gap-2 items-end p-3 bg-muted rounded">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Tìm theo SĐT/email
          </label>
          <input
            name="q"
            defaultValue={q}
            placeholder="84905… hoặc email…"
            className="px-3 py-1.5 border rounded text-sm w-56"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Mục đích
          </label>
          <select
            name="purpose"
            defaultValue={purpose ?? ""}
            className="px-3 py-1.5 border rounded text-sm"
          >
            <option value="">Tất cả</option>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-1.5 bg-gray-900 text-white rounded text-sm"
        >
          Lọc
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Lúc</th>
              <th className="px-4 py-3">Người nhận</th>
              <th className="px-4 py-3">Mục đích</th>
              <th className="px-4 py-3">Các lần gửi</th>
              <th className="px-4 py-3">Trạng thái mã</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Không có yêu cầu OTP nào khớp bộ lọc.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-muted/60">
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {r.createdAt.toLocaleString("vi-VN", { hour12: false })}
                </td>
                <td className="px-4 py-3 font-medium">
                  {maskTarget(r.target, canViewPii)}
                </td>
                <td className="px-4 py-3">
                  {PURPOSE_LABEL[r.purpose] ?? r.purpose}
                </td>
                <td className="px-4 py-3">
                  {r.deliveries.length === 0 && (
                    <span className="text-muted-foreground">
                      — chưa gửi được lần nào
                    </span>
                  )}
                  <ul className="space-y-0.5">
                    {r.deliveries.map((d) => (
                      <li key={d.id} className="whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${d.status === "SENT" ? "bg-state-success-soft text-state-success-ink" : "bg-state-danger-soft text-state-danger-ink"}`}
                        >
                          {d.channel} · {d.status}
                        </span>{" "}
                        {d.status !== "SENT" && (
                          <span className="text-xs text-state-danger-ink">
                            {shortError(d.error)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                  {r.consumedAt
                    ? `✅ đã dùng ${r.consumedAt.toLocaleTimeString("vi-VN", { hour12: false })}`
                    : r.expiresAt.getTime() < Date.now()
                      ? "⏱ hết hạn"
                      : `còn hiệu lực · ${r.attempts}/${r.maxAttempts} lần thử`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ChonSoDong soDong={soDong} tong={totalCount} tenDonVi="yêu cầu" />
          <span className="text-muted-foreground">
            Trang {page}/{totalPages}
          </span>
          <DieuHuongTrangLink
            trang={page}
            soTrang={totalPages}
            hrefCua={(n: number) => urlFor({ q, purpose, page: n })}
          />
        </div>
      )}
    </div>
  );
}
