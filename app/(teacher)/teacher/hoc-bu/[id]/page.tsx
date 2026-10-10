import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatDateVN } from "@/lib/format/date";
import { docChiTietCaseChoGv } from "@/lib/hoc-bu/case-doc";
import { DiemDanhCase } from "@/components/hoc-bu/diem-danh-case";
import { PageHeader } from "../../_components/ui/page-header";
import { diemDanhBuGvAction, nhanXetBuGvAction, guiBaiKiemTraBuGvAction } from "../_actions";
import { taiLieuCuaCase } from "@/lib/hoc-bu/tai-lieu-bu";
import { KhoiTaiLieuBu } from "@/components/hoc-bu/tai-lieu-bu";
import type { PhieuNhanXetGui } from "../../lop/_components/student-eval-dialog";

// Site GV — điểm danh buổi DẠY BÙ. GV chỉ mở được case mình dạy (`docChiTietCaseChoGv` lọc
// theo `teacherId`); case của người khác ⇒ 404, không lộ là case có tồn tại.
export const dynamic = "force-dynamic";
export const metadata = { title: "Buổi dạy bù" };

export default async function TeacherHocBuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow
  const c = await docChiTietCaseChoGv(session.user.id, id);
  if (!c) notFound();

  const mo = c.status === "SCHEDULED";
  const taiLieu = await taiLieuCuaCase({ lessonId: c.lessonId, classIds: c.classIds });
  const conCho = c.be.filter((b) => b.status === "PLACED").length;

  async function diemDanh(caseStudentId: string, coMat: boolean) {
    "use server";
    return diemDanhBuGvAction({ caseId: id, caseStudentId, coMat });
  }
  async function guiBai(examId: string) {
    "use server";
    return guiBaiKiemTraBuGvAction({ caseId: id, examId });
  }
  async function nhanXet(caseStudentId: string, phieu: PhieuNhanXetGui) {
    "use server";
    return nhanXetBuGvAction({ ...phieu, caseId: id, caseStudentId });
  }

  return (
    <div>
      <Link
        href="/teacher/hoc-bu"
        className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Học bù
      </Link>
      <PageHeader
        title={`Học bù · ${c.khoa}`}
        subtitle={`${formatDateVN(c.date)} · ${c.startTime}–${c.endTime}${c.phong ? ` · ${c.phong}` : ""}`}
      />

      <p className="mb-4 text-sm text-muted-foreground">
        Buổi bù: <span className="font-medium text-foreground">{c.buoi}</span>
      </p>

      <div className="mb-6">
        <KhoiTaiLieuBu
          taiLieu={taiLieu}
          hrefScorm={taiLieu.scorm ? `/teacher/scorm/play/${taiLieu.scorm.id}?from=/teacher/hoc-bu/${id}` : null}
          soCoMat={c.soCoMat}
          guiBai={guiBai}
        />
      </div>

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Điểm danh ({c.be.length} bé)</h2>
        {mo && (
          <p className="text-xs text-muted-foreground">
            {conCho ? `Còn ${conCho} bé chưa điểm danh` : "Đã điểm danh xong"}
          </p>
        )}
      </div>
      <DiemDanhCase
        be={c.be}
        moDiemDanh={mo}
        coTheNhap
        thongTinBuoi={{ khoa: c.khoa, buoi: c.buoi, ngayIso: c.date.toISOString(), duAn: c.duAn }}
        diemDanh={diemDanh}
        nhanXet={nhanXet}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Bé vắng buổi bù sẽ được trung tâm xếp lại buổi khác. Điểm danh xong đủ lớp thì buổi bù được
        tính vào công dạy của bạn.
      </p>
    </div>
  );
}
