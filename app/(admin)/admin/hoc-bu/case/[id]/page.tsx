import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { DiemDanhCase } from "@/components/hoc-bu/diem-danh-case";
import { formatDateVN } from "@/lib/format/date";
import { docChiTietCase } from "@/lib/hoc-bu/case-doc";
import { diemDanhBuAction, goKhoiCaseAction, nhanXetBuAction, guiBaiKiemTraBuAction } from "../../_actions";
import { taiLieuCuaCase } from "@/lib/hoc-bu/tai-lieu-bu";
import { KhoiTaiLieuBu } from "@/components/hoc-bu/tai-lieu-bu";
import type { PhieuNhanXetGui } from "@/app/(teacher)/teacher/lop/_components/student-eval-dialog";
import { NutHuyCase } from "./nut-huy-case";

export const metadata = { title: "Case dạy bù | Admin" };
export const dynamic = "force-dynamic";

export default async function CaseBuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/hoc-bu"]]))) redirect("/dashboard?error=unauthorized");
  const [xemTatCa, coTheXep, coTheNhap] = await Promise.all([
    checkPermission("makeup:view-all"),
    checkPermission("makeup:manage"),
    // Điểm danh + nhận xét: quản lý (admin/QLCS/quản lý lớp). Sale chỉ xem trạng thái (chốt 29/09).
    checkPermission("makeup:attend"),
  ]);

  const sdb = scopedDb(await resolveActor(session.user.id));
  const c = await docChiTietCase(sdb, { caseId: id, chiCuaSale: xemTatCa ? null : session.user.id });
  if (!c) notFound();

  const mo = c.status === "SCHEDULED";
  const taiLieu = await taiLieuCuaCase({ lessonId: c.lessonId, classIds: c.classIds });
  const conCho = c.be.filter((b) => b.status === "PLACED").length;
  const tt =
    c.status === "SCHEDULED"
      ? ({ nhan: "Sắp dạy", tone: "info" } as const)
      : c.status === "COMPLETED"
        ? ({ nhan: "Đã dạy", tone: "success" } as const)
        : ({ nhan: "Đã huỷ", tone: "muted" } as const);

  // Server action nhận caseId cố định ở đây — component chỉ truyền id học viên.
  async function diemDanh(caseStudentId: string, coMat: boolean) {
    "use server";
    return diemDanhBuAction({ caseId: id, caseStudentId, coMat });
  }
  async function nhanXet(caseStudentId: string, phieu: PhieuNhanXetGui) {
    "use server";
    return nhanXetBuAction({ ...phieu, caseStudentId });
  }
  async function guiBai(examId: string) {
    "use server";
    return guiBaiKiemTraBuAction({ caseId: id, examId });
  }
  async function goKhoi(caseStudentId: string) {
    "use server";
    return goKhoiCaseAction({ caseId: id, caseStudentId });
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link
        href="/hoc-bu?tab=case"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Case dạy bù
      </Link>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Buổi bù {formatDateVN(c.date)} · {c.startTime}–{c.endTime}
            </h1>
            <StatusPill tone={tt.tone}>{tt.nhan}</StatusPill>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {c.khoa} · {c.buoi}
          </p>
        </div>
        {coTheXep && mo && conCho === c.be.length && <NutHuyCase caseId={c.id} />}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Giáo viên</dt>
          <dd className="truncate font-medium">{c.giaoVien}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Phòng</dt>
          <dd className="truncate font-medium">{c.phong ?? "Chưa xếp"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Học viên</dt>
          <dd className="font-medium tabular-nums">{c.be.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Có mặt</dt>
          <dd className="font-medium tabular-nums">
            {c.soCoMat}/{c.be.length}
          </dd>
        </div>
        {c.note && (
          <div className="col-span-2 min-w-0 sm:col-span-4">
            <dt className="text-xs text-muted-foreground">Ghi chú</dt>
            <dd className="whitespace-pre-line">{c.note}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6">
        <KhoiTaiLieuBu taiLieu={taiLieu} hrefScorm={null} soCoMat={c.soCoMat} guiBai={coTheNhap ? guiBai : null} />
      </div>

      <section className="mt-6 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Điểm danh &amp; nhận xét</h2>
          {mo && (
            <p className="text-xs text-muted-foreground">
              {conCho ? `Còn ${conCho} bé chưa điểm danh` : "Đã điểm danh xong"}
            </p>
          )}
        </div>
        <DiemDanhCase
          be={c.be}
          moDiemDanh={mo}
          coTheNhap={coTheNhap}
          thongTinBuoi={{ khoa: c.khoa, buoi: c.buoi, ngayIso: c.date.toISOString(), duAn: c.duAn }}
          diemDanh={diemDanh}
          nhanXet={nhanXet}
          goKhoi={coTheXep && mo ? goKhoi : undefined}
        />
        {!coTheNhap && (
          <p className="text-xs text-muted-foreground">
            Bạn xem được trạng thái điểm danh / nhận xét. Việc nhập do giáo viên của buổi bù hoặc quản lý làm —
            còn “Chưa nhận xét” thì nhắc giáo viên.
          </p>
        )}
        {!mo && (
          <p className="text-xs text-muted-foreground">
            {c.status === "COMPLETED"
              ? "Case đã chốt: buổi bù được tính vào công dạy của giáo viên theo phân loại Học bù."
              : "Case đã huỷ — các bé chưa học được trả lại danh sách cần bù."}
          </p>
        )}
      </section>
    </div>
  );
}
