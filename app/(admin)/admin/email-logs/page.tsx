import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { maskEmail } from "@/lib/utils";
import { EmailLogStatus, type Prisma } from "@prisma/client";
import {
  EMAIL_LOG_STATUS_LABEL,
  EMAIL_LOG_STATUS_COLOR,
} from "@/lib/validators/email-template";
import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { docSoDong } from "@/lib/ui/phan-trang";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";

export const metadata = { title: "Email Logs | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    q?: string;
    status?: string;
    templateId?: string;
    page?: string;
    size?: string;
  }>;
}

const STATUS_VALUES = Object.values(EmailLogStatus) as EmailLogStatus[];

export default async function EmailLogsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("emails:view")))
    redirect("/dashboard?error=unauthorized");
  // MARKETING có emails:view nhưng KHÔNG có quyền xem PII liên hệ → che email người nhận.
  const canViewPii = await canViewLeadPii();

  // EmailLog/EmailTemplate là model global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const statusParam =
    sp.status && STATUS_VALUES.includes(sp.status as EmailLogStatus)
      ? (sp.status as EmailLogStatus)
      : undefined;
  const templateId = sp.templateId || "";
  const page = Math.max(1, Number(sp.page) || 1);
  const soDong = docSoDong(sp.size);

  const where: Prisma.EmailLogWhereInput = {};
  if (q) {
    where.OR = [
      { toEmail: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
    ];
  }
  if (statusParam) where.status = statusParam;
  if (templateId) where.templateId = templateId;

  const [totalCount, logs, templates] = await Promise.all([
    sdb.emailLog.count({ where }),
    sdb.emailLog.findMany({
      where,
      include: {
        template: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * soDong,
      take: soDong,
    }),
    sdb.emailTemplate.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / soDong));

  function urlFor(
    p: Partial<{
      q: string;
      status: string;
      templateId: string;
      page: number;
    }>,
  ) {
    const u = new URLSearchParams();
    if (p.q) u.set("q", p.q);
    if (p.status) u.set("status", p.status);
    if (p.templateId) u.set("templateId", p.templateId);
    if (p.page && p.page > 1) u.set("page", String(p.page));
    return `/email-logs${u.toString() ? "?" + u.toString() : ""}`;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Email Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lịch sử email đã gửi qua hệ thống
        </p>
      </div>

      <form className="flex flex-wrap gap-2 items-end p-3 bg-muted rounded">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Tìm</label>
          <input
            name="q"
            defaultValue={q}
            placeholder="Email hoặc subject..."
            className="px-3 py-1.5 border rounded text-sm w-56"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
          <select
            name="status"
            defaultValue={statusParam ?? ""}
            className="px-3 py-1.5 border rounded text-sm"
          >
            <option value="">Tất cả</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {EMAIL_LOG_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Template</label>
          <select
            name="templateId"
            defaultValue={templateId}
            className="px-3 py-1.5 border rounded text-sm"
          >
            <option value="">Tất cả</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm">
          Áp dụng
        </button>
      </form>

      <div className="text-sm text-muted-foreground">
        {totalCount.toLocaleString("vi-VN")} email logs
      </div>

      {/* Vùng cuộn ôm RIÊNG cái bảng: 7 cột, trong đó Subject và email người nhận là chuỗi
          dài tuỳ nội dung — không có div này thì bảng đẩy rộng cả trang, kéo thanh cuộn
          ngang của <body> và làm lệch luôn thanh lọc phía trên. Thẻ ngoài giữ
          `overflow-hidden` để bo góc không bị bảng cắt vuông. */}
      <div className="border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr>
                <th className="text-left px-3 py-2">Thời gian</th>
                <th className="text-left px-3 py-2">Đến</th>
                <th className="text-left px-3 py-2">Subject</th>
                <th className="text-left px-3 py-2">Template</th>
                <th className="text-left px-3 py-2">Trigger</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Người gửi</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    Chưa có email log
                  </td>
                </tr>
              )}
              {logs.map((log) => (
                <tr key={log.id} className="border-b hover:bg-muted">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {log.createdAt.toLocaleString("vi-VN")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-sm">{log.toName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {canViewPii ? log.toEmail : maskEmail(log.toEmail)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm">{log.subject}</td>
                  <td className="px-3 py-2 text-xs">
                    {log.template ? (
                      <Link
                        href={`/email-templates/${log.template.id}/edit`}
                        className="text-state-info-ink hover:underline"
                      >
                        {log.template.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{log.triggerType}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "px-2 py-0.5 rounded text-xs " +
                        EMAIL_LOG_STATUS_COLOR[log.status]
                      }
                    >
                      {EMAIL_LOG_STATUS_LABEL[log.status]}
                    </span>
                    {log.failureReason && (
                      <div
                        className="text-xs text-state-danger-ink mt-1 max-w-xs truncate"
                        title={log.failureReason}
                      >
                        ⚠ {log.failureReason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {log.triggeredByName ?? "Hệ thống"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalCount > 0 && (
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <ChonSoDong soDong={soDong} tong={totalCount} tenDonVi="email" />
            <span>
              Trang {page} / {totalPages}
            </span>
          </div>
          <DieuHuongTrangLink
            trang={page}
            soTrang={totalPages}
            hrefCua={(n: number) => urlFor({ q, status: statusParam, templateId, page: n })}
          />
        </div>
      )}
    </div>
  );
}
