import "server-only";
import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { hasMediaConsent } from "@/lib/lms/media-consent";
import { docDongYQuyDinh, phuHuynhCoGhiDanh } from "@/lib/legal/quy-dinh-dao-tao";

// Portal v2 — dữ liệu trang "Hồ sơ gia đình" (giống SataUI): phụ huynh đại diện +
// phụ huynh thứ hai + học sinh liên kết (kèm trạng thái đồng ý hình ảnh).
// PH name/email/address lấy từ User; phone/PH thứ hai denormalized trên Student.

const ACTIVE = GHI_DANH_DANG_HOC; // lib/portal/trang-thai-ghi-danh.ts

export type ProfileChild = {
  id: string;
  name: string;
  initials: string;
  className: string | null;
  /** Mã học viên (hiện ở thẻ con). */
  studentCode: string | null;
  courseName: string | null;
  classCode: string | null;
  centerName: string | null;
  school: string | null;
  grade: number | null;
  active: boolean;
  mediaConsent: boolean;
  /** Ảnh đại diện (`Student.avatarUrl`) — admin hoặc phụ huynh đặt. */
  avatarUrl: string | null;
};

export type ParentProfile = {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  familyCode: string;
  parent2Name: string | null;
  parent2Phone: string | null;
  children: ProfileChild[];
  /**
   * Trạng thái «Quy định đào tạo» (SR.VH.205). `ap` = phụ huynh có con đã đăng ký khoá (phải đồng ý); tài khoản miễn phí
   * `ap=false` ⇒ trang hồ sơ không vẽ thẻ. `luc` = ISO của lần đồng ý đầu (null khi chưa).
   */
  quyDinh: { ap: boolean; daDongY: boolean; luc: string | null };
};

function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter((x) => /\p{L}/u.test(x[0] ?? ""));
  return (w.slice(-2).map((x) => x[0]).join("") || "HS").toUpperCase();
}

function familyCodeOf(parentUserId: string): string {
  let h = 0;
  for (const ch of parentUserId) h = (h * 31 + ch.charCodeAt(0)) % 10000;
  return `SATAFAM-${String(h).padStart(4, "0")}`;
}

export async function getParentProfile(
  parentUserId: string,
  activeStudentId: string | null,
): Promise<ParentProfile> {
  const [user, students] = await Promise.all([
    db.user.findUnique({
      where: { id: parentUserId },
      select: { name: true, email: true, phone: true, address: true },
    }),
    db.student.findMany({
      where: { parentUserId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        currentGrade: true,
        studentCode: true,
        avatarUrl: true,
        school: true,
        parentPhone: true,
        parent2Name: true,
        parent2Phone: true,
        enrollments: {
          where: { status: { in: [...ACTIVE] }, deletedAt: null },
          orderBy: { enrolledAt: "desc" },
          take: 1,
          select: { class: { select: { name: true, classCode: true, course: { select: { name: true } }, center: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  const consents = await Promise.all(students.map((s) => hasMediaConsent(s.id).catch(() => false)));

  const children: ProfileChild[] = students.map((s, i) => ({
    id: s.id,
    name: s.name,
    initials: initialsOf(s.name),
    avatarUrl: s.avatarUrl,
    className: s.enrollments[0]?.class?.name ?? null,
    studentCode: s.studentCode,
    courseName: s.enrollments[0]?.class?.course?.name ?? null,
    classCode: s.enrollments[0]?.class?.classCode ?? null,
    centerName: s.enrollments[0]?.class?.center?.name ?? null,
    school: s.school,
    grade: s.currentGrade,
    active: s.id === activeStudentId,
    mediaConsent: consents[i],
  }));

  const first = students[0];
  const [dongY, apDung] = await Promise.all([docDongYQuyDinh(parentUserId), phuHuynhCoGhiDanh(parentUserId)]);
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    // AUTH-SĐT P6 — nguồn sự thật là `User.phone` (định danh đăng nhập). Lùi về
    // `Student.parentPhone` cho hồ sơ CŨ chưa được đồng bộ; đọc mỗi Student thì
    // phụ huynh chưa gắn con nào sẽ thấy trống dù tài khoản có SĐT hẳn hoi.
    phone: user?.phone ?? first?.parentPhone ?? null,
    address: user?.address ?? null,
    familyCode: familyCodeOf(parentUserId),
    parent2Name: first?.parent2Name ?? null,
    parent2Phone: first?.parent2Phone ?? null,
    children,
    quyDinh: { ap: apDung, daDongY: dongY.daDongY, luc: dongY.luc?.toISOString() ?? null },
  };
}
