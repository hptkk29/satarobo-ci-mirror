// /students/<id>/edit — "Hồ sơ học viên" (thiết kế lại 25/09/2026).
//
// Bố cục (khung nở theo BẬC, chỉ dùng `min-[..]` — trộn `2xl:max-w` với `min-[..]` thì bậc
// 2xl đứng sau trong CSS sinh ra và thắng, màn 8K kẹt ở 1440px; xem `man-nhap-lead.tsx`):
//   · dải đầu: ảnh · tên · trạng thái · LEAD NGUỒN · nút vòng đời;
//   · < 1280px: một cột — form → cột phải (lead nguồn, tài khoản PH, anh chị em) → lớp & tiến độ;
//   · ≥ 1280px: [form | cột phải 380px dính trên] rồi "Lớp & tiến độ" dưới form;
//   · ≥ 2200px: [form | lớp & tiến độ | cột phải 400px].
//
// Quyền + che PII giữ NGUYÊN như bản cũ: cổng `students:edit`, CCCD chỉ `payments:view-pii`,
// SĐT PH che ở SERVER khi DENY cấp trường.
// 26/09/2026 — khối "Hồ sơ năng lực robotics" THAY bằng "Nhận xét buổi học & học bạ" (mỗi phần
// gác đúng quyền màn gốc); mã học viên chỉ Quản trị tối cao sửa (`students:change-code`).
// Lead nguồn đọc DUY NHẤT qua `docLeadNguon` (cách ly cơ sở + canSeeLead + che PII) —
// trang này KHÔNG tự truy vấn lead (include lồng không được scopedDb cách ly).

import { createHash } from "node:crypto";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect, notFound } from "next/navigation";
import { getWardsByProvince, provinces } from "vietnam-address-data";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import {
  checkAnyPermission,
  checkPermission,
  checkPermissionDetail,
} from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { getStudentFeedback } from "@/lib/portal/feedback";
import { maskPhone } from "@/lib/utils";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { getStudentProgressForClasses } from "@/lib/progress";
import { getStudentClassProgress, getStudentAbsences } from "@/lib/students/progress";
import { docLeadNguon } from "@/lib/students/lead-nguon";
import { nhanGioiTinh } from "@/lib/students/gioi-tinh";
import { maTinhMoi, toAddressOptions, toNameOptions } from "@/lib/address/vn-address";
import { ngayVN } from "@/lib/format/date";
import { vnYmd } from "@/lib/time/vn";
import { StudentForm, type StudentFormValue } from "../../_components/student-form";
import { ReserveHistorySection } from "../../_components/reserve-history-section";
import { ParentAccountSection } from "../../_components/parent-account-section";
import { ParentChildrenManager } from "../../_components/parent-children-manager";
import { DaiDangBaoLuu, DaiDanhTinh } from "../../_components/ho-so/dai-danh-tinh";
import { KhungLeadNguon } from "../../_components/ho-so/khung-lead-nguon";
import { GiuFormKhiDangSua } from "../../_components/ho-so/giu-form-khi-dang-sua";
import {
  LopVaTienDo,
  type DongLichSu,
  type DongLopDangHoc,
} from "../../_components/ho-so/lop-va-tien-do";
import {
  laGhiDanhDangHoc,
  ngayChoONhap,
  ngayNhapHoc,
  tinhTuoi,
} from "../../_components/ho-so/nhan-ho-so";
import {
  NhanXetVaHocBa,
  type DongHocBa,
  type DongNhanXet,
} from "../../_components/ho-so/nhan-xet-va-hoc-ba";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata = { title: "Hồ sơ học viên | Admin" };
export const dynamic = "force-dynamic";

export default async function EditStudentPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("students:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;

  const [
    canViewParentCccd,
    chiTietXem,
    coTheGhiDanh,
    actor,
    coTheDoiMa,
    xemNhanXet,
    xemHocBaNangLuc,
    xemHocBaTongHop,
  ] = await Promise.all([
    // #15 — CCCD PH là PII: chỉ actor có payments:view-pii (kế toán/admin) mới thấy +
    // sửa. Sale/CM có students:edit nhưng KHÔNG có view-pii → ẩn ô + không prefill raw.
    checkPermission("payments:view-pii"),
    // US-03 (TS-02): DENY cấp trường từ grant nhóm — che parentPhone kể cả khi actor
    // có students:edit (mask độc lập với quyết định action — đồng nhất trang list).
    checkPermissionDetail("students:view-all"),
    // Nút "Ghi danh vào lớp" ở khối trống chỉ hiện khi bấm vào là làm được (luật 12).
    checkPermission("enrollments:create"),
    resolveActor(session.user.id),
    // 26/09 — mã học viên: chỉ Quản trị tối cao (R7-05 C10). Server gác lại ở action.
    checkPermission("students:change-code"),
    // Nhận xét buổi: đúng cặp quyền mà màn điểm danh dùng để mở trang nhận xét buổi.
    checkAnyPermission(["sessions:edit", "session-feedback:view-all"]),
    // Học bạ năng lực: đúng cổng của /report-cards/<enrollmentId>.
    checkAnyPermission(["report-cards:manage", "report-cards:review"]),
    // Học bạ tổng hợp: đúng cổng của /hoc-ba.
    checkAnyPermission(PAGE_GATES["/hoc-ba"]),
  ]);
  const phoneMasked = chiTietXem.fieldMask.includes("parentPhone");
  const sdb = scopedDb(actor);

  const [student, orgUnits] = await Promise.all([
    sdb.student.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        studentCode: true,
        dateOfBirth: true,
        gender: true,
        avatarUrl: true,
        currentGrade: true,
        school: true,
        parentName: true,
        parentPhone: true,
        parentEmail: true,
        parentRelation: true,
        parentNationalId: true,
        parentGender: true,
        parentDob: true,
        parentFacebookUrl: true,
        parent2Name: true,
        parent2Phone: true,
        parent2Relation: true,
        address: true,
        ward: true,
        city: true,
        allergies: true,
        healthNotes: true,
        notes: true,
        status: true,
        centerId: true,
        orgUnitId: true,
        leadId: true,
        leadChildId: true,
        parentUserId: true,
        center: { select: { name: true } },
        parentUser: { select: { email: true, phone: true, name: true, accountStatus: true } },
      },
    }),
    // Hội sở KHÔNG nhận học viên (chốt 04/08) — picker chỉ liệt kê cơ sở dạy học.
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
  ]);

  if (!student) notFound();

  const [parentChildren, phieuNhanXet, enrollments, activeReserve, absences, leadNguon] =
    await Promise.all([
      // Commit 3 — đa con: các con đang gắn cùng phụ huynh này.
      student.parentUserId
        ? sdb.student.findMany({
            where: { parentUserId: student.parentUserId, deletedAt: null },
            orderBy: { name: "asc" },
            select: { id: true, name: true, studentCode: true },
          })
        : Promise.resolve([]),
      // 26/09 — nhận xét buổi: CÙNG hàm cổng phụ huynh dùng (số buổi / tiêu đề khớp site GV).
      // Hàm đọc `db` trần theo studentId; HV đã qua `sdb.student.findFirst` ở trên (cách ly
      // cơ sở) nên không lộ phiếu của học viên ngoài tầm nhìn.
      xemNhanXet ? getStudentFeedback(id, 20) : Promise.resolve(null),
      // MỘT truy vấn ghi danh cho cả trang (bản cũ đọc ba lần: lớp đang học, nút vòng đời,
      // lịch sử học tập). Ghi danh là model soft-delete ⇒ đã tự lọc `deletedAt: null`.
      sdb.enrollment.findMany({
        where: { studentId: id },
        select: {
          id: true,
          status: true,
          classId: true,
          enrolledAt: true,
          endedAt: true,
          class: {
            select: {
              id: true,
              name: true,
              classCode: true,
              course: { select: { name: true } },
              center: { select: { name: true } },
            },
          },
        },
        orderBy: { enrolledAt: "desc" },
      }),
      sdb.studentReserve.findFirst({
        where: { studentId: id, isActive: true },
        orderBy: { startedAt: "desc" },
        select: { id: true, startedAt: true, expectedEndAt: true, reason: true },
      }),
      getStudentAbsences(id),
      docLeadNguon({
        actor,
        userId: session.user.id,
        student: {
          id: student.id,
          leadId: student.leadId,
          leadChildId: student.leadChildId,
          parentPhone: student.parentPhone,
        },
        // SĐT PH đang che cho người xem ⇒ khối lead không được in/so SĐT (cùng số).
        parentPhoneMasked: phoneMasked,
      }),
    ]);

  // ─── Nhận xét buổi + học bạ (26/09) ───────────────────────────────────────────────
  const nhanXet: DongNhanXet[] | null =
    phieuNhanXet === null
      ? null
      : phieuNhanXet.map((f) => ({
          id: f.id,
          buoi: f.order,
          tieuDe: f.title,
          ngay: ngayVN(new Date(f.dateISO)),
          lop: f.className,
          giaoVien: f.teacher,
          duAn: f.projectName,
          noiDung: (f.notes?.overall || f.comment || "").trim(),
        }));
  // ─── Lớp & tiến độ: mỗi LỚP tính tiến độ buổi MỘT lần (bản cũ gọi hai lần/lớp) ───
  const dangHocRaw = enrollments.filter((e) => laGhiDanhDangHoc(e.status));
  const lopDangHocIds = [...new Set(dangHocRaw.map((e) => e.classId))];
  const moiLop = [...new Set(enrollments.map((e) => e.classId))];
  const [chiSoTheoLop, buoiTheoLop, phieuHocBa] = await Promise.all([
    // QRY-07: chỉ số mọi lớp đang học batch 1 lượt.
    getStudentProgressForClasses(id, lopDangHocIds),
    Promise.all(
      moiLop.map(async (cid) => [cid, await getStudentClassProgress(id, cid)] as const),
    ).then((cap) => new Map(cap)),
    // Học bạ năng lực: 1–1 với ghi danh (cột phẳng, không quan hệ) ⇒ cần id ghi danh, nên đi
    // chung lô này chứ không thêm một nhịp chờ. `ReportCard` ∈ SCOPED_MODELS ⇒ qua `sdb`.
    xemHocBaNangLuc
      ? sdb.reportCard.findMany({
          where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
          select: { enrollmentId: true, status: true, publishedAt: true, finalComment: true },
        })
      : Promise.resolve(null),
  ]);
  const tenLopTheoGhiDanh = new Map(enrollments.map((e) => [e.id, e.class.name]));
  const hocBa: DongHocBa[] | null =
    phieuHocBa === null
      ? null
      : phieuHocBa.map((r) => ({
          enrollmentId: r.enrollmentId,
          lop: tenLopTheoGhiDanh.get(r.enrollmentId) ?? "Lớp",
          trangThai: r.status,
          ngayPhatHanh: r.status === "PUBLISHED" && r.publishedAt ? ngayVN(r.publishedAt) : null,
          nhanXetCuoi: r.finalComment?.trim() || null,
        }));

  const lopCua = (e: (typeof enrollments)[number]) => ({
    id: e.class.id,
    ten: e.class.name,
    ma: e.class.classCode,
    khoa: e.class.course.name,
    coSo: e.class.center?.name ?? null,
  });
  const buoiRong = { total: 0, attended: 0, remaining: 0, absentNoMakeup: 0, currentSession: 0 };

  const dangHoc: DongLopDangHoc[] = dangHocRaw.map((e) => {
    const p = chiSoTheoLop.get(e.classId);
    return {
      enrollmentId: e.id,
      lop: lopCua(e),
      buoi: buoiTheoLop.get(e.classId) ?? buoiRong,
      chiSo: p
        ? {
            diemDanh: `${p.attendedSessions}/${p.totalSessions}`,
            tyLeDiemDanh: p.attendanceRate,
            baiHoc: `${p.coveredLessons}/${p.totalLessons}`,
            baiTap: `${p.submittedAssignments}/${p.totalAssignments}`,
            diemTB: p.averageScore,
          }
        : null,
    };
  });
  const lichSu: DongLichSu[] = enrollments
    .filter((e) => !laGhiDanhDangHoc(e.status))
    .map((e) => ({
      enrollmentId: e.id,
      lop: lopCua(e),
      status: e.status,
      batDau: e.enrolledAt,
      ketThuc: e.endedAt,
      buoi: buoiTheoLop.get(e.classId) ?? buoiRong,
    }));

  // "Ngày nhập học" (D3) = ghi danh SỚM NHẤT, trừ ghi danh đã HUỶ (huỷ = chưa từng vào học).
  const nhapHoc = ngayNhapHoc(enrollments.filter((e) => e.status !== "CANCELLED"));

  // ─── Form ────────────────────────────────────────────────────────────────────
  const formValue: StudentFormValue = {
    id: student.id,
    name: student.name,
    studentCode: student.studentCode,
    dateOfBirth: ngayChoONhap(student.dateOfBirth),
    gender: student.gender,
    currentGrade: student.currentGrade,
    school: student.school,
    status: student.status,
    parentName: student.parentName,
    // Che SĐT PH ở SERVER khi bị DENY cấp trường (chống leak qua RSC payload).
    parentPhone:
      phoneMasked && student.parentPhone ? maskPhone(student.parentPhone) : student.parentPhone,
    parentPhoneMasked: phoneMasked && !!student.parentPhone,
    parentRelation: student.parentRelation,
    parentGender: student.parentGender,
    parentDob: ngayChoONhap(student.parentDob),
    parentEmail: student.parentEmail,
    parentFacebookUrl: student.parentFacebookUrl,
    // Không gửi raw CCCD xuống client khi actor không có quyền xem đầy đủ.
    parentNationalId: canViewParentCccd ? student.parentNationalId : null,
    parent2Name: student.parent2Name,
    parent2Phone: student.parent2Phone,
    parent2Relation: student.parent2Relation,
    city: student.city,
    ward: student.ward,
    address: student.address,
    allergies: student.allergies ?? [],
    healthNotes: student.healthNotes,
    notes: student.notes,
    orgUnitId: student.orgUnitId,
  };

  // ⚠️ KHOÁ của form = dấu vân tay GIÁ TRỊ hồ sơ. Ô nhập không kiểm soát chỉ đọc
  // `defaultValue` lúc MOUNT — `router.refresh()` sau "Gắn lead" (điền ô trống), sau nút
  // vòng đời (đổi trạng thái) mang giá trị mới về nhưng ô vẫn hiện giá trị CŨ. Đổi khoá ⇒
  // form dựng lại với giá trị mới — TRỪ khi người dùng đang sửa dở: `GiuFormKhiDangSua` giữ
  // form + báo có bản mới (dựng lại là mất chữ đang gõ), và form chỉ gửi ô đã đổi nên lưu
  // lúc đó không ghi ngược. Đổi ẢNH không nằm trong form nên không đổi khoá.
  const formKey = createHash("sha1").update(JSON.stringify(formValue)).digest("hex").slice(0, 16);

  // 26/09 — tên tỉnh đang lưu dịch sang danh mục MỚI (bỏ tiền tố "TP", tỉnh đã sáp nhập →
  // tỉnh nhận) — cùng phép dịch với ô tỉnh trong form (`ho-so/dia-chi.ts`).
  const maTinhDangLuu = maTinhMoi(provinces, student.city);
  const phuongCuaTinh = maTinhDangLuu ? toNameOptions(getWardsByProvince(maTinhDangLuu)) : [];

  const tenCoSo =
    orgUnits.find((o) => o.orgUnitId === student.orgUnitId)?.name ?? student.center?.name ?? null;
  const tuoi = tinhTuoi(student.dateOfBirth, new Date());

  // SĐT prefill khối "Tài khoản phụ huynh" — cùng luật che như form.
  const rawAccountPhone = student.parentUser?.phone ?? student.parentPhone;
  const displayAccountPhone =
    phoneMasked && rawAccountPhone ? maskPhone(rawAccountPhone) : rawAccountPhone;

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-5 min-[1536px]:max-w-[1440px] min-[2200px]:max-w-[2200px] min-[3200px]:max-w-[2880px]">
      <Link
        href="/students"
        className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden /> Danh sách học viên
      </Link>

      <DaiDanhTinh
        student={{
          id: student.id,
          name: student.name,
          avatarUrl: student.avatarUrl,
          status: student.status,
        }}
        meta={[
          student.studentCode,
          tuoi !== null ? `${tuoi} tuổi` : null,
          nhanGioiTinh(student.gender),
          tenCoSo,
        ]}
        ketQua={leadNguon}
        activeReserve={activeReserve}
        lifecycleEnrollments={enrollments.map((e) => ({
          id: e.id,
          status: e.status,
          class: { name: e.class.name },
        }))}
      />

      {activeReserve && <DaiDangBaoLuu baoLuu={activeReserve} />}

      <div className="grid items-start gap-5 min-[1280px]:grid-cols-[minmax(0,1fr)_380px] min-[2200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_400px]">
        <div className="min-w-0 min-[1280px]:col-start-1 min-[1280px]:row-start-1">
          <GiuFormKhiDangSua khoa={formKey}>
          <StudentForm
            student={formValue}
            orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
            canViewParentCccd={canViewParentCccd}
            provinces={toAddressOptions(provinces)}
            initialWards={phuongCuaTinh}
            homNay={vnYmd(new Date())}
            coTheDoiMa={coTheDoiMa}
            thongTinTrungTam={{
              lopDangHoc: dangHoc.map((d) => ({ id: d.lop.id, ten: d.lop.ten })),
              ngayNhapHoc: nhapHoc ? ngayVN(nhapHoc) : null,
            }}
          />
          </GiuFormKhiDangSua>
        </div>

        {/* Cột phải DÍNH từ 1280px. Cao hơn màn hình thì tự cuộn bên trong — không thì phần
            dưới (tài khoản PH, anh chị em) bị che cho tới khi cuộn hết trang. `p-1 -m-1` để
            vùng cuộn không xén bóng/viền focus của các khung. */}
        <aside
          aria-label="Nguồn khách hàng và tài khoản phụ huynh"
          className="min-w-0 space-y-4 min-[1280px]:sticky min-[1280px]:top-4 min-[1280px]:col-start-2 min-[1280px]:row-span-2 min-[1280px]:row-start-1 min-[1280px]:-m-1 min-[1280px]:max-h-[calc(100dvh-6rem)] min-[1280px]:overflow-y-auto min-[1280px]:p-1 min-[2200px]:col-start-3 min-[2200px]:row-span-1"
        >
          <KhungLeadNguon ketQua={leadNguon} studentId={student.id} tenHocVien={student.name} />
          <ParentAccountSection
            studentId={student.id}
            linked={!!student.parentUserId}
            parentEmail={student.parentUser?.email ?? null}
            parentName={student.parentUser?.name ?? student.parentName}
            defaultEmail={student.parentEmail}
            defaultPhone={displayAccountPhone}
            pendingActivation={student.parentUser?.accountStatus === "PENDING_ACTIVATION"}
          />
          {student.parentUserId && (
            <ParentChildrenManager
              parentUserId={student.parentUserId}
              currentStudentId={student.id}
              children={parentChildren}
            />
          )}
        </aside>

        <div className="min-w-0 space-y-5 min-[1280px]:col-start-1 min-[1280px]:row-start-2 min-[2200px]:col-start-2 min-[2200px]:row-start-1">
          <LopVaTienDo
            studentId={student.id}
            tenHocVien={student.name}
            dangHoc={dangHoc}
            lichSu={lichSu}
            buoiVang={absences}
            coTheGhiDanh={coTheGhiDanh}
            trangThaiHocVien={student.status}
          />

          <ReserveHistorySection studentId={student.id} />

          {/* 26/09 — THAY khối "Hồ sơ năng lực robotics" (chủ dự án chốt). Dữ liệu năng lực
              cũ vẫn nằm nguyên trong DB — chỉ màn này thôi hiện. */}
          <NhanXetVaHocBa
            studentId={student.id}
            nhanXet={nhanXet}
            hocBa={hocBa}
            moHocBaNangLuc={xemHocBaNangLuc}
            xemHocBaTongHop={xemHocBaTongHop}
          />
        </div>
      </div>
    </div>
  );
}
