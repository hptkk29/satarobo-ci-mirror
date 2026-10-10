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
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnYmd } from "@/lib/time/vn";
import { FormLapHoSo } from "../_components/form-lap-ho-so";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lập hồ sơ bảo lưu | Admin Sata Robo" };

export default async function LapBaoLuuPage({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const { studentId } = await searchParams;
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
      enrollments: {
        where: { deletedAt: null, status: { in: [...TRANG_THAI_GHI_DANH_BAO_LUU_DUOC] as ("STUDYING" | "ACTIVE")[] } },
        select: { id: true, course: { select: { name: true, allowPause: true } }, class: { select: { name: true } } },
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

  const [cs, choPhepVuotTran] = await Promise.all([docChinhSach(hv.orgUnitId), checkPermission("bao-luu:exception")]);

  return (
    <Khung>
      <PageHeader title={`Lập hồ sơ bảo lưu — ${hv.name}`} subtitle="Hồ sơ cần Quản lý cơ sở duyệt; người lập không tự duyệt." />
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
            tenHocVien={hv.name}
            ghiDanh={duocChon.map((g) => ({ id: g.id, ten: `${g.course.name} — ${g.class.name}` }))}
            hanToiDa={ngayVN(hanToiDaBaoLuu(now, cs.maxMonths))}
            hanToiDaYmd={vnYmd(hanToiDaBaoLuu(now, cs.maxMonths))}
            choPhepVuotTran={choPhepVuotTran}
            soThangToiDa={cs.maxMonths}
            homNay={vnYmd(now)}
          />
        </>
      )}
    </Khung>
  );
}
