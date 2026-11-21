// app/(admin)/admin/bao-luu/moi/page.tsx — LẬP hồ sơ bảo lưu cho MỘT học viên (đi từ nút "Bảo lưu" ở hồ sơ học viên).
//
// Cổng ở trang (trước khi vẽ form): đăng nhập → `bao-luu:create` → học viên trong tầm nhìn cơ sở (`scopedDb`) → công tắc
// `pause.enabled` của cơ sở học viên BẬT. Mỗi cổng có một câu nói đúng nguyên nhân — không vẽ form rồi để action từ chối.
// Server action `lapBaoLuuAction` kiểm lại toàn bộ (trang không phải cổng).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { ngayVN } from "@/lib/format/date";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { TRANG_THAI_GHI_DANH_BAO_LUU_DUOC } from "@/lib/bao-luu/hoso";
import { docChinhSach, ghiDanhChuaCoHoSoMo } from "@/lib/bao-luu/ngu-canh-db";
import { mauTheoMaCoSo } from "@/lib/bao-luu/mau-don";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnYmd } from "@/lib/time/vn";
import { FormLapHoSo } from "../_components/form-lap-ho-so";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lập hồ sơ bảo lưu | Admin Sata Robo" };

export default async function LapBaoLuuPage({ searchParams }: { searchParams: Promise<{ studentId?: string; parentRequestId?: string }> }) {
  const { studentId, parentRequestId } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fbao-luu");
  if (!(await checkPermission("bao-luu:create"))) redirect("/bao-luu?error=unauthorized");

  const Khung = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto w-full max-w-[720px]">
      <Link href="/bao-luu" className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Danh sách hồ sơ bảo lưu
      </Link>
      {children}
    </div>
  );

  if (!studentId) {
    return (
      <Khung>
        <EmptyState title="Chưa chọn học viên." description="Mở hồ sơ học viên rồi bấm Bảo lưu để lập hồ sơ." />
      </Khung>
    );
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const hv = await sdb.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: {
      id: true, name: true, centerId: true, orgUnitId: true,
      studentCode: true, dateOfBirth: true, parentName: true, parentPhone: true, parentEmail: true, parentRelation: true,
      enrollments: {
        where: { deletedAt: null, status: { in: [...TRANG_THAI_GHI_DANH_BAO_LUU_DUOC] as ("STUDYING" | "ACTIVE")[] } },
        select: {
          id: true,
          course: { select: { name: true, allowPause: true } },
          class: { select: { name: true, classCode: true, teacher: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!hv) {
    return (
      <Khung>
        <EmptyState title="Không tìm thấy học viên." description="Học viên không tồn tại hoặc không thuộc cơ sở bạn phụ trách." />
      </Khung>
    );
  }

  if (!(await laBaoLuuBat(hv.orgUnitId))) {
    return (
      <Khung>
        <EmptyState title="Chưa bật bảo lưu cho cơ sở này." description={LOI_BAO_LUU_TAT} />
      </Khung>
    );
  }

  // Ghi danh đã có hồ sơ mở (chờ duyệt hoặc đang bảo lưu) KHÔNG đưa vào ô chọn — chọn rồi mới bị từ chối là lời hứa suông.
  const now = new Date();
  const chuaCoHoSo = await ghiDanhChuaCoHoSoMo({ studentId: hv.id, enrollmentIds: hv.enrollments.map((g) => g.id), now });
  const duocChon = hv.enrollments.filter((g) => g.course.allowPause && chuaCoHoSo.has(g.id));
  const khongChon = hv.enrollments.length - duocChon.length;

  // Mẫu đơn theo CƠ SỞ của học viên (hai pháp nhân khác nhau). Center là danh mục không scoped; chưa gắn cơ sở hoặc chưa có mẫu ⇒ null,
  // và khối "Đơn bảo lưu" khoá nút kèm lý do — KHÔNG rơi về mẫu của cơ sở khác.
  const [cs, choPhepVuotTran, coSo] = await Promise.all([
    docChinhSach(hv.orgUnitId),
    checkPermission("bao-luu:exception"),
    hv.centerId ? sdb.center.findFirst({ where: { id: hv.centerId }, select: { code: true } }) : Promise.resolve(null),
  ]);

  // C12 — lập từ yêu cầu 'Bảo lưu' của phụ huynh: chỉ nhận khi yêu cầu thuộc ĐÚNG học viên, loại RESERVE, còn chờ (id từ URL = dữ liệu ngoài). Không hợp lệ ⇒ lập vẫn được
  // nhưng KHÔNG gắn yêu cầu, và nói rõ thay vì lặng lẽ bỏ.
  const yeuCau = parentRequestId
    ? await sdb.parentRequest.findFirst({
        where: { id: parentRequestId, studentId: hv.id, type: "RESERVE", status: "PENDING" },
        select: { id: true, content: true, createdAt: true },
      })
    : null;

  return (
    <Khung>
      <PageHeader title={`Lập hồ sơ bảo lưu — ${hv.name}`} subtitle="Hồ sơ cần Quản lý cơ sở duyệt; người lập không tự duyệt." />
      {yeuCau && (
        <div role="status" className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-semibold">Lập từ yêu cầu của phụ huynh ({ngayVN(yeuCau.createdAt)})</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{yeuCau.content}</p>
          <p className="mt-1 text-xs text-muted-foreground">Lập xong, yêu cầu tự chuyển sang &quot;Đã xử lý&quot; và gắn với hồ sơ này.</p>
        </div>
      )}
      {parentRequestId && !yeuCau && (
        <p role="status" className="mb-4 rounded-xl border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          Yêu cầu của phụ huynh này không còn chờ xử lý (hoặc không thuộc học viên này) nên hồ sơ sẽ được lập mà KHÔNG gắn với yêu cầu nào.
        </p>
      )}
      {duocChon.length === 0 ? (
        <EmptyState
          title="Học viên không có khoá nào bảo lưu được."
          description="Chỉ khoá đang học, có áp dụng bảo lưu và chưa có hồ sơ chờ duyệt / đang bảo lưu mới lập được."
        />
      ) : (
        <>
          {khongChon > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">{khongChon} khoá không hiện ở dưới vì đang có hồ sơ mở hoặc khoá không áp dụng bảo lưu.</p>
          )}
          <FormLapHoSo
            studentId={hv.id}
            parentRequestId={yeuCau?.id ?? null}
            tenHocVien={hv.name}
            ghiDanh={duocChon.map((g) => ({ id: g.id, ten: `${g.course.name} — ${g.class.name}` }))}
            hanToiDa={ngayVN(hanToiDaBaoLuu(now, cs.maxMonths))}
            hanToiDaYmd={vnYmd(hanToiDaBaoLuu(now, cs.maxMonths))}
            choPhepVuotTran={choPhepVuotTran}
            soThangToiDa={cs.maxMonths}
            homNay={vnYmd(now)}
            mauDon={{
              maMau: mauTheoMaCoSo(coSo?.code),
              hocVien: { hoTen: hv.name, ma: hv.studentCode, ngaySinhYmd: hv.dateOfBirth ? vnYmd(hv.dateOfBirth) : null },
              phuHuynh: { hoTen: hv.parentName, quanHe: hv.parentRelation, dienThoai: hv.parentPhone, email: hv.parentEmail },
              // `maLop` = mã lớp ngắn ("CS1.03") cho ghi chú "Sata 3 (lớp CS1.03)" khi chọn nhiều khoá; lớp chưa có mã thì dùng tên lớp.
              ghiDanh: duocChon.map((g) => ({
                id: g.id,
                tenKhoa: g.course.name,
                tenLop: g.class.name,
                maLop: g.class.classCode ?? g.class.name,
                giaoVien: g.class.teacher?.name ?? null,
              })),
            }}
          />
        </>
      )}
    </Khung>
  );
}
