import type { ScopedDb } from "@/lib/actions/factory";
import { cauTrangThai, trangThaiHienThi, type TrangThaiHienThi } from "@/lib/elearning/certificate";
import { napChungNhanCuaToi, type ChungNhanCuaToi } from "@/lib/elearning/certificate-mine";

/**
 * XEM CHỨNG NHẬN — MỘT nguồn dữ liệu cho TRANG XEM (`/elearning/chung-nhan-cua-toi/[certCode]`) và BẢN PDF
 * (`/api/elearning/chung-nhan`). Hai nơi cùng gọi `moHinhChungNhan` nên "trang xem khớp PDF" là điều KHÔNG THỂ lệch, không phải
 * điều "nhớ giữ khớp" (chứng từ in ra mà lệch trang xem là loại lỗi người dùng chỉ thấy khi cầm tờ giấy).
 *
 * ⚠️ Khuôn PDF (`lib/pdf/certificate.tsx`) KHÔNG được sửa ở đây — nó dùng chung với chứng chỉ học viên (HANDOFF §5.2).
 */

/** Các cột cần để dựng mô hình — dùng chung cho mọi nơi đọc một chứng nhận để hiển thị. */
export const CHON_CHUNG_NHAN_XEM = {
  id: true,
  userId: true,
  certCode: true,
  verifyToken: true,
  snapFullName: true,
  snapEmployeeCode: true,
  issuedAt: true,
  validUntil: true,
  revokedAt: true,
  status: true,
  courseId: true,
} as const;

export type ChungNhanDoc = {
  id: string;
  userId: string;
  certCode: string;
  verifyToken: string;
  snapFullName: string;
  snapEmployeeCode: string;
  issuedAt: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
  status: string;
  courseId: string;
};

export type MoHinhChungNhan = {
  studentName: string;
  studentCode: string;
  courseName: string;
  certificateCode: string;
  /** Ngày cấp, dạng người đọc (dd/mm/yyyy) — đúng chuỗi in trên PDF. */
  completedAt: string;
  /** Câu hiệu lực — in cả khi hết hạn/thu hồi (tờ giấy là ảnh chụp một thời điểm). */
  validityLine: string;
  trangThai: TrangThaiHienThi;
};

export function moHinhChungNhan(cn: ChungNhanDoc, tenKhoa: string | null, now: Date): MoHinhChungNhan {
  const tt = trangThaiHienThi(cn, now);
  return {
    studentName: cn.snapFullName,
    studentCode: cn.snapEmployeeCode,
    courseName: tenKhoa ?? "(khoá đã bị gỡ khỏi danh mục)",
    certificateCode: cn.certCode,
    completedAt: cn.issuedAt.toLocaleDateString("vi-VN"),
    validityLine: cauTrangThai(tt, cn),
    trangThai: tt,
  };
}

/**
 * Chứng nhận của CHÍNH `userId` theo SỐ HIỆU. `userId` nằm trong `where` (không phải so sau khi đọc): người khác gõ số hiệu của
 * bạn nhận `null` — cùng kết quả với số hiệu không tồn tại, không tiết lộ nó có thật.
 */
export async function napChungNhanXem(
  db: ScopedDb,
  input: { certCode: string; userId: string },
): Promise<{ cn: ChungNhanDoc; tenKhoa: string | null } | null> {
  const cn = await db.trnCertificate.findFirst({
    where: { certCode: input.certCode, userId: input.userId },
    select: CHON_CHUNG_NHAN_XEM,
  });
  if (!cn) return null;
  const khoa = await db.trnCourse.findFirst({ where: { id: cn.courseId }, select: { title: true } });
  return { cn, tenKhoa: khoa?.title ?? null };
}

// ── Danh sách "Chứng nhận của tôi" ────────────────────────────────────────────────────────────────

/** Ngưỡng "sắp hết hạn": khớp cron nhắc T-30 (`cron-cert-expiry`). */
export const NGAY_SAP_HET_HAN = 30;
const MS_NGAY = 86_400_000;

/** "Hết hạn sau 15 ngày" — chỉ cho chứng nhận CÒN HIỆU LỰC và có hạn trong ngưỡng; còn lại `null`. */
export function nhanSapHetHan(
  c: Pick<ChungNhanCuaToi, "trangThai" | "validUntil">,
  now: Date,
): string | null {
  if (c.trangThai !== "VALID" || !c.validUntil) return null;
  const conLai = Math.ceil((c.validUntil.getTime() - now.getTime()) / MS_NGAY);
  if (conLai < 1 || conLai > NGAY_SAP_HET_HAN) return null;
  return `Hết hạn sau ${conLai} ngày`;
}

export type ChungNhanTrongDanhSach = ChungNhanCuaToi & {
  /** Lượt HỌC LẠI (chu kỳ mới, chưa xong) của cùng khoá đã có trong "Khoá của tôi" — `null` khi chưa có. */
  luotHocLaiId: string | null;
};

/**
 * Danh sách chứng nhận của tôi + liên kết sang lượt học lại. `napChungNhanCuaToi` (2 truy vấn) + tối đa MỘT truy vấn lượt học —
 * cố định, không theo số chứng nhận. Tách khỏi `napChungNhanCuaToi` để KPI ở Tổng quan không gánh thêm truy vấn.
 */
export async function napDanhSachChungNhanCuaToi(
  db: ScopedDb,
  userId: string,
  now: Date,
): Promise<ChungNhanTrongDanhSach[]> {
  const ds = await napChungNhanCuaToi(db, userId, now);
  if (ds.length === 0) return [];

  const goc = await db.trnCertificate.findMany({
    where: { userId, id: { in: ds.map((c) => c.id) } },
    select: { id: true, courseId: true, enrollmentId: true },
  });
  const maKhoa = [...new Set(goc.map((g) => g.courseId))];
  const luot = await db.trnEnrollment.findMany({
    where: { userId, courseId: { in: maKhoa }, status: { notIn: ["REVOKED", "COMPLETED", "COMPLETED_LATE"] } },
    select: { id: true, courseId: true },
  });
  const luotCuaKhoa = new Map(luot.map((l) => [l.courseId, l.id]));
  const khoaCua = new Map(goc.map((g) => [g.id, g]));
  return ds.map((c) => {
    const g = khoaCua.get(c.id);
    const l = g ? luotCuaKhoa.get(g.courseId) : undefined;
    // Lượt đang mở của cùng khoá chỉ tính là "học lại" khi KHÁC lượt đã sinh chứng nhận này.
    return { ...c, luotHocLaiId: l && l !== g?.enrollmentId ? l : null };
  });
}
