import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatDateVN } from "@/lib/format/date";
import { docChiTietCaseV2ChoGv } from "@/lib/hoc-bu/case-chi-tiet";
import { DiemDanhBe, type HanhDongBe } from "@/components/hoc-bu/diem-danh-be";
import { PageHeader } from "../../_components/ui/page-header";
import { diemDanhBeGvAction, suaDiemDanhBeGvAction, danhGiaMucGvAction, guiBaiKiemTraBuGvAction } from "../_actions";
import { taiLieuCuaCase } from "@/lib/hoc-bu/tai-lieu-bu";
import { KhoiTaiLieuBu } from "@/components/hoc-bu/tai-lieu-bu";

// Site GV — điểm danh buổi DẠY BÙ (mô hình nhiều bài, T07/T16). GV chỉ mở được case mình dạy (`docChiTietCaseV2ChoGv` lọc
// theo `teacherId`); case của người khác ⇒ 404, không lộ là case có tồn tại.
export const dynamic = "force-dynamic";
export const metadata = { title: "Buổi dạy bù" };

export default async function TeacherHocBuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow
  const c = await docChiTietCaseV2ChoGv(session.user.id, id);
  if (!c) notFound();

  const mo = c.status === "SCHEDULED";
  const taiLieuTheoBai = await Promise.all(c.boBai.map(async (b) => ({ bai: b, taiLieu: await taiLieuCuaCase({ lessonId: b.id, classIds: c.classIds }) })));

  // Server action nhận caseId cố định ở đây — component chỉ truyền id bé / id mục.
  async function diemDanh(p: Parameters<HanhDongBe["diemDanh"]>[0]) {
    "use server";
    return diemDanhBeGvAction({ caseId: id, ...p });
  }
  async function sua(p: Parameters<NonNullable<HanhDongBe["sua"]>>[0]) {
    "use server";
    return suaDiemDanhBeGvAction({ caseId: id, ...p });
  }
  async function luuPhieu(p: Parameters<NonNullable<HanhDongBe["luuPhieu"]>>[0]) {
    "use server";
    return danhGiaMucGvAction({ caseId: id, ...p });
  }
  const hanhDong: HanhDongBe = { diemDanh, sua, luuPhieu };
  async function guiBai(examId: string) {
    "use server";
    return guiBaiKiemTraBuGvAction({ caseId: id, examId });
  }

  const khoiTaiLieu = (
    <div className="space-y-4">
        {taiLieuTheoBai.map(({ bai, taiLieu }) => (
          <div key={bai.id}>
            {c.boBai.length > 1 && <h3 className="mb-1.5 text-sm font-medium text-foreground">{bai.ten}</h3>}
            <KhoiTaiLieuBu
              taiLieu={taiLieu}
              hrefScorm={taiLieu.scorm ? `/teacher/scorm/play/${taiLieu.scorm.id}?from=/teacher/hoc-bu/${id}` : null}
              soCoMat={c.soCoMat}
              guiBai={guiBai}
            />
          </div>
        ))}
    </div>
  );

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
        {c.boBai.length > 1 ? "Các bài bù:" : "Bài bù:"} <span className="font-medium text-foreground">{c.boBai.map((b) => b.ten).join(" · ")}</span>
      </p>

      {/* Một bài: tài liệu đứng trước điểm danh như cũ. Nhiều bài: điểm danh lên trước, tài liệu gập lại ở cuối trang (trên điện thoại 3 bài = 6 thẻ chữ trước nút điểm danh). */}
      {c.boBai.length === 1 && <div className="mb-6">{khoiTaiLieu}</div>}

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Điểm danh ({c.soBe} bé)</h2>
        {mo && <p className="text-xs text-muted-foreground">{c.soChoDiemDanh ? `Còn ${c.soChoDiemDanh} bé chưa điểm danh` : "Đã điểm danh xong"}</p>}
      </div>
      {c.daNangCap ? (
        <DiemDanhBe be={c.be} moDiemDanh={mo} coTheNhap hanhDong={hanhDong} boiCanh={{ khoa: c.khoa, ngayHienThi: formatDateVN(c.date) }} hrefPhieuGoc="/teacher/hoc-bu/phieu/" />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Case này tạo theo cách cũ và chưa được nâng cấp. Nhờ quản lý mở case ở trang quản trị và bấm “Nâng cấp case này”, rồi điểm danh ở đây.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Với mỗi bé có mặt, chọn từng bài “Đã học xong” hoặc “Chưa xong”. Bài chưa xong sẽ được xếp bù lại; bé vắng buổi bù được trung tâm xếp lại buổi khác. Điểm danh xong
        thì buổi bù được tính vào công dạy của bạn.
      </p>

      {c.boBai.length > 1 && (
        <details className="mt-6 rounded-xl border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">Tài liệu &amp; bài kiểm tra bù của {c.boBai.length} bài</summary>
          <div className="border-t border-border p-4">{khoiTaiLieu}</div>
        </details>
      )}
    </div>
  );
}
