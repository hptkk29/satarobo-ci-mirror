import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type { Prisma, ParentRequestStatus, ParentRequestType } from "@prisma/client";
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL } from "@/lib/portal/request-labels";
import { MO_TA_LOAI, THU_TU_LOAI, nhanMocDeXuat, nhanNgayDayDu, nhanGio, nhanThoiDiemGui } from "@/lib/portal/yeu-cau-hien-thi";
import { classifyAbsenceUrgency } from "@/lib/students/absence";
import { getSetting } from "@/lib/settings/service";
import { laBaoLuuBat } from "@/lib/bao-luu/feature";
import { PageHeader } from "@/components/admin/ui/page-header";
import { RequestCard, type RequestItem } from "./_components/request-card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Yêu cầu phụ huynh | Admin" };
export const dynamic = "force-dynamic";

// Lọc theo TRẠNG THÁI — dùng giá trị enum thật, không thêm enum mới. MẶC ĐỊNH là «Chờ xử lý»: đây là hàng đợi việc, không phải lịch sử (13/11/2026).
const STATUS_FILTERS: { key: string; label: string; status?: ParentRequestStatus }[] = [
  { key: "PENDING", label: REQUEST_STATUS_LABEL.PENDING, status: "PENDING" },
  { key: "APPROVED", label: REQUEST_STATUS_LABEL.APPROVED, status: "APPROVED" },
  { key: "REJECTED", label: REQUEST_STATUS_LABEL.REJECTED, status: "REJECTED" },
  { key: "CANCELLED", label: REQUEST_STATUS_LABEL.CANCELLED, status: "CANCELLED" },
  { key: "all", label: "Tất cả" },
];

interface Props {
  searchParams: Promise<{ type?: string; status?: string }>;
}

function buildHref(type: string, status: string): string {
  const sp = new URLSearchParams();
  if (type !== "all") sp.set("type", type);
  if (status !== "PENDING") sp.set("status", status);
  const qs = sp.toString();
  return qs ? `/parent-requests?${qs}` : "/parent-requests";
}

export default async function ParentRequestsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("parent-requests:manage"))) redirect("/dashboard");

  const { type, status } = await searchParams;
  const activeType: ParentRequestType | "all" = THU_TU_LOAI.find((t) => t === type) ?? "all";
  const activeStatus = STATUS_FILTERS.find((f) => f.key === status) ?? STATUS_FILTERS[0];

  // Cách ly cơ sở: ParentRequest KHÔNG nằm trong SCOPED_MODELS (không có centerId trực tiếp) → phụ thuộc cơ sở qua student.centerId. Scope thủ công bằng tầm nhìn cơ sở của
  // model Student (mẫu như /admin/enrollments scope qua class.centerId). SUPER_ADMIN/HO → ALL.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const phamVi: Prisma.ParentRequestWhereInput = {};
  const visibleStudentCenters = getModelVisibleCenterIds("Student", actor);
  if (visibleStudentCenters !== "ALL") phamVi.student = { centerId: { in: visibleStudentCenters } };

  const where: Prisma.ParentRequestWhereInput = {
    ...phamVi,
    ...(activeType !== "all" ? { type: activeType } : {}),
    ...(activeStatus.status ? { status: activeStatus.status } : {}),
  };

  const [rows, demTheoLoai, coTheXep] = await Promise.all([
    // ParentRequest ∉ SCOPED_MODELS → sdb pass-through; cách ly nằm ở where.student trên.
    sdb.parentRequest.findMany({
      where,
      // Hàng đợi: việc ĐÃ CHỜ LÂU NHẤT lên đầu; lịch sử thì mới nhất lên đầu.
      orderBy: { createdAt: activeStatus.key === "PENDING" ? "asc" : "desc" },
      take: 200,
      select: {
        id: true,
        type: true,
        status: true,
        content: true,
        preferredDate: true,
        sessionId: true,
        makeupNeedId: true,
        response: true,
        handledByName: true,
        parentUserId: true,
        createdAt: true,
        studentId: true,
        reserveId: true,
        student: {
          select: {
            name: true,
            studentCode: true,
            orgUnitId: true,
            enrollments: {
              where: { status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] } },
              select: { class: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
    }),
    // Số yêu cầu CHỜ XỬ LÝ theo loại — hiện trên từng tab để thấy việc nào đang tồn, không cần bấm vào từng loại.
    sdb.parentRequest.groupBy({ by: ["type"], where: { ...phamVi, status: "PENDING" }, _count: { _all: true } }),
    checkPermission("makeup:manage"),
  ]);
  const choTheoLoai = new Map(demTheoLoai.map((d) => [d.type, d._count._all]));
  const tongCho = [...choTheoLoai.values()].reduce((a, b) => a + b, 0);

  // Enrich báo vắng / học bù: ngày buổi (phân loại gấp/đúng hạn) + tên lớp từ session.
  const now = new Date();
  const urgentThresholdDays = await getSetting("student.absenceUrgentThresholdDays");
  const sessionIds = rows.map((r) => r.sessionId).filter((x): x is string => !!x);
  // ClassSession ∈ SCOPED_MODELS → auto-scope theo tầm nhìn (buổi cùng cơ sở HV).
  const sessions = sessionIds.length
    ? await sdb.classSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, date: true, class: { select: { name: true } } } })
    : [];
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  // Tên phụ huynh — map parentUserId → User.name.
  const parentIds = Array.from(new Set(rows.map((r) => r.parentUserId).filter((x): x is string => !!x)));
  const parents = parentIds.length ? await sdb.user.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true, email: true } }) : [];
  const parentMap = new Map(parents.map((p) => [p.id, p.name ?? p.email]));

  // Dòng cần bù của từng yêu cầu — để nút "Xếp học bù" dẫn đúng vào hộp xếp case của dòng đó. Đơn học bù mới mang `makeupNeedId`; báo vắng đã tiếp nhận (và đơn cũ) khớp theo
  // (học viên, buổi vắng). CHỈ dòng còn CHỜ XẾP và chưa bị quản lý huỷ mới xếp được; chỉ người có `makeup:manage` mới thấy liên kết.
  const caps = rows.filter((r) => (r.type === "MAKEUP" || r.type === "ABSENCE") && (r.makeupNeedId || r.sessionId));
  const needs =
    coTheXep && caps.length
      ? await sdb.makeupNeed.findMany({
          where: {
            status: "PENDING",
            waivedAt: null,
            OR: [
              { id: { in: caps.map((r) => r.makeupNeedId).filter((x): x is string => !!x) } },
              ...caps.filter((r) => r.sessionId).map((r) => ({ studentId: r.studentId, missedSessionId: r.sessionId! })),
            ],
          },
          select: { id: true, studentId: true, missedSessionId: true },
        })
      : [];
  const needTheoId = new Map(needs.map((n) => [n.id, n.id]));
  const needTheoBuoi = new Map(needs.map((n) => [`${n.studentId}|${n.missedSessionId}`, n.id]));

  // C12 — nút "Lập hồ sơ bảo lưu" CHỈ hiện cho yêu cầu RESERVE còn chờ, ở cơ sở ĐÃ BẬT bảo lưu, với người có `bao-luu:create`. Hỏi cờ MỘT lần cho mỗi đơn vị (không N+1).
  const coQuyenLapBaoLuu = rows.some((r) => r.type === "RESERVE" && r.status === "PENDING") ? await checkPermission("bao-luu:create") : false;
  const baoLuuBatTheoDonVi = new Map<string, boolean>();
  if (coQuyenLapBaoLuu) {
    for (const r of rows) {
      const k = r.student.orgUnitId;
      if (r.type !== "RESERVE" || r.status !== "PENDING" || !k || baoLuuBatTheoDonVi.has(k)) continue;
      baoLuuBatTheoDonVi.set(k, await laBaoLuuBat(k).catch(() => false));
    }
  }

  const items: RequestItem[] = rows.map((r) => {
    const sess = r.sessionId ? sessionMap.get(r.sessionId) : null;
    const ngayBuoi = sess?.date ?? (r.type === "ABSENCE" ? r.preferredDate : null);
    const needXep =
      r.makeupNeedId && needTheoId.has(r.makeupNeedId)
        ? r.makeupNeedId
        : r.sessionId
          ? (needTheoBuoi.get(`${r.studentId}|${r.sessionId}`) ?? null)
          : null;
    return {
      id: r.id,
      studentId: r.studentId,
      reserveId: r.reserveId,
      baoLuuLapDuoc: coQuyenLapBaoLuu && r.type === "RESERVE" && r.status === "PENDING" && !!r.student.orgUnitId && baoLuuBatTheoDonVi.get(r.student.orgUnitId) === true,
      type: r.type,
      status: r.status,
      content: r.content,
      response: r.response,
      handledByName: r.handledByName,
      parentName: r.parentUserId ? (parentMap.get(r.parentUserId) ?? null) : null,
      studentName: r.student.name,
      studentCode: r.student.studentCode,
      className: sess?.class.name ?? r.student.enrollments[0]?.class.name ?? null,
      guiLuc: nhanThoiDiemGui(r.createdAt),
      buoiGoc: ngayBuoi ? `${nhanNgayDayDu(ngayBuoi)}${nhanGio(ngayBuoi) !== "00:00" ? ` · ${nhanGio(ngayBuoi)}` : ""}` : null,
      // Học bù: `sessionId` là buổi ĐÃ VẮNG, `preferredDate` mới là mốc phụ huynh đề xuất (có giờ). Hai thứ khác nhau — đừng lẫn.
      deXuatBu: r.type === "MAKEUP" ? nhanMocDeXuat(r.preferredDate) : null,
      urgency: r.type === "ABSENCE" && ngayBuoi ? classifyAbsenceUrgency(ngayBuoi, now, urgentThresholdDays) : null,
      tiepNhanDuoc: r.type === "ABSENCE" && !!r.sessionId,
      needXep: coTheXep ? needXep : null,
    };
  });

  // Mọi loại ⇒ chia NHÓM theo loại (mỗi nhóm một tiêu đề + số lượng); chọn một loại ⇒ danh sách phẳng.
  const nhom = activeType === "all" ? THU_TU_LOAI.map((t) => ({ type: t, ds: items.filter((i) => i.type === t) })).filter((g) => g.ds.length > 0) : [{ type: activeType, ds: items }];

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <PageHeader
        title="Yêu cầu phụ huynh"
        subtitle={tongCho > 0 ? `${tongCho} yêu cầu đang chờ xử lý` : "Không có yêu cầu nào đang chờ — đã xử lý hết."}
      />

      {/* LOẠI yêu cầu: một hàng cuộn ngang ở màn hẹp (không xuống nhiều dòng), kèm số yêu cầu đang chờ của từng loại. */}
      <nav aria-label="Loại yêu cầu" className="-mx-4 mb-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
          {(["all", ...THU_TU_LOAI] as const).map((t) => {
            const dang = activeType === t;
            const cho = t === "all" ? tongCho : (choTheoLoai.get(t) ?? 0);
            return (
              <li key={t}>
                <Link
                  href={buildHref(t, activeStatus.key)}
                  aria-current={dang ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors sm:min-h-9",
                    dang ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {t === "all" ? "Tất cả" : REQUEST_TYPE_LABEL[t]}
                  {cho > 0 ? (
                    <span
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                        dang ? "bg-primary-foreground/20 text-primary-foreground" : "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]",
                      )}
                    >
                      {cho}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* TRẠNG THÁI: nút phân đoạn — mặc định Chờ xử lý. */}
      <nav aria-label="Trạng thái" className="mb-5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="inline-flex w-max gap-1 rounded-lg bg-muted p-1">
          {STATUS_FILTERS.map((f) => {
            const dang = activeStatus.key === f.key;
            return (
              <li key={f.key}>
                <Link
                  href={buildHref(activeType, f.key)}
                  aria-current={dang ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors sm:min-h-8",
                    dang ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            {activeStatus.key === "PENDING" ? "Không có yêu cầu nào đang chờ" : "Không có yêu cầu nào trong mục này"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {activeStatus.key === "PENDING"
              ? "Khi phụ huynh gửi báo vắng, xin học bù hay đổi lớp từ cổng thông tin, yêu cầu sẽ hiện ở đây."
              : "Đổi loại hoặc trạng thái ở trên để xem mục khác."}
          </p>
          {activeStatus.key !== "all" ? (
            <Link href={buildHref(activeType, "all")} className="mt-1 text-sm font-semibold text-primary hover:underline">
              Xem tất cả trạng thái
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {nhom.map((g) => (
            <section key={g.type} aria-labelledby={`nhom-${g.type}`} className="flex flex-col gap-3">
              {activeType === "all" ? (
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <h2 id={`nhom-${g.type}`} className="text-base font-semibold text-foreground">
                    {REQUEST_TYPE_LABEL[g.type]} <span className="font-normal text-muted-foreground tabular-nums">({g.ds.length})</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">{MO_TA_LOAI[g.type]}</p>
                </div>
              ) : (
                <h2 id={`nhom-${g.type}`} className="sr-only">
                  {REQUEST_TYPE_LABEL[g.type]}
                </h2>
              )}
              <div className="flex flex-col gap-3">
                {g.ds.map((item) => (
                  <RequestCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {items.length >= 200 ? <p className="mt-4 text-xs text-muted-foreground">Đang hiện 200 yêu cầu gần nhất — lọc theo loại hoặc trạng thái để thu hẹp.</p> : null}
    </div>
  );
}
