import { docCacBanMau } from "./cn-mau-db";
import { db } from "@/lib/db";
import { chiTietKhoa, danhSachDanhMuc, danhSachKhoa, type LocKhoa } from "./khoa-hoc";
import { docHocVienTrongKhoa, lichSuQuyenHoc, timHocVienDeCap, type LocHocVien } from "./hoc-vien-khoa";
import { docCayNoiDung } from "./noi-dung";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { lichSuPhienBan } from "./phien-ban";
import { danhSachChoCham, docCauHoiCuaKhoa, docDeThiCuaKhoa, docDeThiOnlineTatCa } from "./danh-gia-db";
import { docChungNhanOnlineTatCa, docChungNhanTrongKhoa } from "./chung-nhan";
import { docBaoCaoKhoa } from "./bao-cao";

/**
 * E-LEARNING ONLINE — HÀM ĐỌC cho trang (RSC). Bọc các hàm dịch vụ bằng `db` để trang trong `app/(elearning)/**` KHÔNG phải import `@/lib/db`
 * trần (ESLint chặn). Bảng `Onl*` là dữ liệu cấp công ty — không có `centerId` để scope; ranh giới là QUYỀN `onl:*` mà trang đã kiểm trước khi gọi.
 */
export const docDanhSachKhoa = (loc: LocKhoa) => danhSachKhoa(db, loc);
export const docChiTietKhoa = (courseId: string) => chiTietKhoa(db, courseId);
export const docDanhMuc = () => danhSachDanhMuc(db);
export const docCay = (versionId: string) => docCayNoiDung(db, versionId);
export const docHocVienKhoa = (loc: LocHocVien, o: { now: Date; xemPii: boolean }) => docHocVienTrongKhoa(db, loc, o);
export const docLichSuQuyen = (courseId: string, studentId: string) => lichSuQuyenHoc(db, { courseId, studentId });
export const docUngVienCap = (courseId: string, q: string) => timHocVienDeCap(db, { courseId, q });
export const docLichSuBan = (courseId: string) => lichSuPhienBan(db, courseId);

/** Danh sách khoá rút gọn cho ô chọn (tiên quyết…): mọi khoá chưa lưu trữ, trừ `tru`. */
export async function docKhoaDeChon(tru?: string) {
  const ds = await db.onlCourse.findMany({ where: { deletedAt: null, ...(tru ? { id: { not: tru } } : {}) }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true } });
  return ds;
}

/** Cài đặt học tập hợp lệ của MỘT bản (hoặc `null` nếu hỏng) — trang hiện cảnh báo thay vì ném. */
export async function docCaiDatBan(versionId: string) {
  const b = await db.onlCourseVersion.findUnique({ where: { id: versionId }, select: { settingsJson: true } });
  if (!b) return null;
  const r = docCaiDatHocTap(b.settingsJson);
  return r.ok ? r.caiDat : null;
}

/** Nội dung chi tiết MỘT bài (để sửa trong bản nháp). */
export async function docBai(lessonId: string) {
  return db.onlLesson.findUnique({ where: { id: lessonId }, select: { id: true, versionId: true, title: true, description: true, kind: true, required: true, hidden: true, freePreview: true, durationSec: true, passPercent: true, contentJson: true } });
}

export const docCauHoiKhoa = (courseId: string) => docCauHoiCuaKhoa(db, courseId);
export const docDeThiKhoa = (courseId: string) => docDeThiCuaKhoa(db, courseId);
export const docTatCaDeThiOnline = () => docDeThiOnlineTatCa(db);
export const docHangChoCham = (courseId: string) => danhSachChoCham(db, courseId);
export const docBaoCaoCuaKhoa = (courseId: string) => docBaoCaoKhoa(db, courseId, new Date());
export const docTatCaChungNhanOnline = () => docChungNhanOnlineTatCa(db);
export const docMauChungNhanKhoa = (courseId: string) => docCacBanMau(db, courseId);
export const docChungNhanKhoa = (courseId: string, trang?: number) => docChungNhanTrongKhoa(db, { courseId, trang, coTrang: 20 });

/**
 * QoMkt — "Nội dung public" của MỘT khoá cho người chỉ-đọc (Marketing): mô tả + danh sách bài HỌC THỬ của bản đang chạy.
 * CỐ Ý không chọn `contentJson`/`description`/`thumbnailKey` của bài (cùng ranh giới với danh mục công khai) và KHÔNG liệt kê bài trả phí.
 */
export async function docNoiDungPublicCuaKhoa(courseId: string) {
  const k = await db.onlCourse.findFirst({ where: { id: courseId, deletedAt: null }, select: { shortDescription: true, fullDescription: true, publishedVersionId: true, slug: true, saleStatus: true } });
  if (!k) return null;
  const hocThu = k.publishedVersionId
    ? await db.onlLesson.findMany({
        where: { versionId: k.publishedVersionId, hidden: false, freePreview: true, chapter: { hidden: false } },
        orderBy: [{ chapter: { orderIndex: "asc" } }, { orderIndex: "asc" }],
        select: { stableId: true, title: true },
      })
    : [];
  return { shortDescription: k.shortDescription, fullDescription: k.fullDescription, slug: k.slug, saleStatus: k.saleStatus, daPhatHanh: !!k.publishedVersionId, hocThu };
}
