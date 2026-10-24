import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  checkAnyPermission,
  checkPermission,
} from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { TransferForm } from "./_components/transfer-form";
import { RequestActions } from "./_components/request-actions";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Chuyển lớp / cơ sở | Admin" };
export const dynamic = "force-dynamic";

const ACTIVE_ENROLLMENT_STATUSES = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

interface PageProps {
  searchParams: Promise<{ fromCenterId?: string }>;
}

export default async function TransferPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // P1-c: sale/quản lý TẠO yêu cầu (enrollments:create); chỉ quản lý (transfer) DUYỆT.
  if (!(await checkAnyPermission(PAGE_GATES["/chuyen-lop"])))
    redirect("/dashboard");
  const canApprove = await checkPermission("enrollments:transfer");

  const sp = await searchParams;
  const fromCenterId = sp.fromCenterId?.trim() || "";

  // Cách ly cơ sở: Student ∈ SCOPED_MODELS → sdb.student auto-inject centerId IN visible.
  // StudentTransferRequest KHÔNG ∈ SCOPED_MODELS (chỉ có fromCenterId/toCenterId, không
  // có centerId trực tiếp) → scope THỦ CÔNG qua from/toCenterId theo tầm nhìn cơ sở của
  // actor (cùng tầm nhìn model Student). Center = bảng tổ chức (không scoped) → giữ toàn
  // bộ cơ sở active làm danh sách đích chuyển cơ sở.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleCenters = getModelVisibleCenterIds("Student", actor);

  // FL2-05 — Hội sở không nhận học viên → loại khỏi cả picker cơ sở nguồn lẫn đích.
  const hoCenterIds = await getNonEnrollableCenterIds();
  const centerIdNotHo = hoCenterIds.length
    ? { id: { notIn: hoCenterIds } }
    : {};

  const requestWhere: Prisma.StudentTransferRequestWhereInput = {
    status: { in: ["PENDING", "WAITLISTED"] },
  };
  if (visibleCenters !== "ALL") {
    // Ngoài tầm nhìn (mảng rỗng) → `in: []` khớp 0 dòng = fail-safe, không lộ cơ sở khác.
    requestWhere.OR = [
      { fromCenterId: { in: visibleCenters } },
      { toCenterId: { in: visibleCenters } },
    ];
  }

  const [centers, requests] = await Promise.all([
    sdb.center.findMany({
      where: { isActive: true, ...centerIdNotHo },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
    sdb.studentTransferRequest.findMany({
      where: requestWhere,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        reason: true,
        createdAt: true,
        toClassId: true,
        student: { select: { name: true, studentCode: true } },
      },
    }),
  ]);

  // FL2-06 (LD-6) — luồng "cơ sở → học sinh": chỉ nạp HV của cơ sở nguồn đã chọn
  // (giảm truy vấn so với nạp toàn bộ HV). scopedDb auto-inject centerId IN visible
  // → fromCenterId ngoài tầm nhìn actor (vd CS1 chọn CS2) khớp 0 dòng = fail-safe.
  const students = fromCenterId
    ? await sdb.student.findMany({
        where: {
          deletedAt: null,
          centerId: fromCenterId,
          enrollments: {
            some: { status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
          },
        },
        orderBy: { name: "asc" },
        take: 500,
        select: {
          id: true,
          name: true,
          studentCode: true,
          enrollments: {
            where: { status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
            select: {
              classId: true,
              class: { select: { name: true, classCode: true } },
            },
          },
        },
      })
    : [];

  const studentOptions = students.map((s) => ({
    id: s.id,
    name: s.name,
    studentCode: s.studentCode,
    classes: s.enrollments.map((e) => ({
      classId: e.classId,
      label:
        e.class.name + (e.class.classCode ? ` (${e.class.classCode})` : ""),
    })),
  }));

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Chuyển lớp / chuyển cơ sở
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Yêu cầu chuyển lớp và chuyển cơ sở
        </p>
      </div>

      <PageHelp>
        <p>
          Lớp đích cùng khoá, không vượt tiến độ học viên. Hết chỗ → tự đưa vào
          danh sách chờ (waitlist). Giữ lịch sử cơ sở cũ.
        </p>
      </PageHelp>

      <TransferForm
        students={studentOptions}
        centers={centers}
        fromCenterId={fromCenterId}
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b px-4 py-2 text-sm font-semibold text-foreground">
          Yêu cầu đang chờ
        </div>
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Học viên</th>
                <th className="px-4 py-2">Trạng thái</th>
                <th className="px-4 py-2">Lý do</th>
                <th className="px-4 py-2">Ngày</th>
                <th className="px-4 py-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    Không có yêu cầu.
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-4 py-2 font-medium">
                      {r.student.name}
                      {r.student.studentCode ? ` (${r.student.studentCode})` : ""}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          r.status === "WAITLISTED"
                            ? "rounded bg-state-warning-soft px-2 py-0.5 text-xs text-state-warning-ink"
                            : "rounded bg-state-info-soft px-2 py-0.5 text-xs text-state-info-ink"
                        }
                      >
                        {r.status === "WAITLISTED" ? "Chờ chỗ" : "Chờ duyệt"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.reason ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-2">
                      <RequestActions
                        id={r.id}
                        hasTarget={!!r.toClassId}
                        canManage={canApprove}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
