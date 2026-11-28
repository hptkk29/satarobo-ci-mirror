import { z } from "zod";
import { ActionError, type ActionConfig } from "@/lib/actions/factory";
import { db } from "@/lib/db";
import {
  danhMucSchema, datTienQuyet, doiTrangThaiBan, luuDanhMuc, luuTruKhoa, sapXepKhoa, sapXepSchema, suaKhoa, suaKhoaSchema, taoKhoa, taoKhoaSchema,
  tienQuyetSchema, trangThaiBanSchema, xoaDanhMuc,
} from "./khoa-hoc";
import {
  baiSchema, bocucSchema, chuongSchema, datBoCuc, moBanNhap, suaBai, suaBaiSchema, suaChuong, suaChuongSchema, themBai, themChuong, xoaBai, xoaChuong,
} from "./noi-dung";
import { luuCaiDat, luuCaiDatSchema, phatHanh, phatHanhSchema, xemTruocPhatHanh, chinhSachSchema, type XemTruocPhatHanh } from "./phien-ban";
import { capQuyenHoc, thuHoiQuyenHoc } from "./quyen-hoc-db";
import { cauHoiSchema } from "./cham-diem";
import { danhDauCauTrung, kiemBangTinh, type KetQuaKiemNhap } from "./nhap-cau-hoi";
import { docTepXlsx } from "./nhap-cau-hoi-tep";
import { nhapCauHoi } from "./nhap-cau-hoi-db";
import { capChungNhanTay, thuHoiChungNhan } from "./chung-nhan";
import { duyetMau, taoBanMoiTuBan } from "./cn-mau-db";
import { capBuLoiHeThong, docLichSuGianDoan, quyetBoiHoan } from "./gian-doan-db";
import { chamSanPham, luuKhungCham, yeuCauNopLai } from "./san-pham-db";
import { chamLaiTay, chamLaiTaySchema, chamTay, chamTaySchema, deThiSchema, docCauHoiDeSua, docLuotDeCham, luuCauHoi, luuDeThi, luuTruCauHoi } from "./danh-gia-db";
import { lichSuQuyenHoc, timHocVienDeCap, type DongLichSuQuyen, type UngVienCap } from "./hoc-vien-khoa";

/**
 * E-LEARNING ONLINE — CẤU HÌNH ACTION (pipeline chung: zod → can() → handler → AuditLog). Tệp `_actions.ts` của route chỉ bọc bằng `defineAction`.
 *
 * Vì sao cấu hình nằm ở `lib/` chứ không ở `_actions.ts`: tệp "use server" không nạp được trong vitest, và chỉ được export hàm async.
 *
 * Quyền: MỌI action đòi một key `onl:*` — không mượn `elearning:*` của Nội bộ. `can()` ở đây là cổng thật; ẩn nút ở UI không phải bảo vệ.
 * Lỗi nghiệp vụ của lớp dịch vụ (`{ ok:false, ma, thongBao }`) → `ActionError(ma, thongBao)`, giữ nguyên MÃ ổn định cho giao diện.
 */

const MODULE = "elearning-online";
const loi = (r: { ma: string; thongBao: string }): never => {
  throw new ActionError(r.ma, r.thongBao);
};
const duongDan = (courseId: string) => [`/elearning/online/khoa/${courseId}`, "/elearning/online"];

// ───────── Khoá & danh mục ─────────

export const cauHinhTaoKhoa: ActionConfig<z.infer<typeof taoKhoaSchema>, { courseId: string; draftVersionId: string; slug: string }> = {
  name: "onlTaoKhoa",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "CREATE",
  schema: taoKhoaSchema,
  revalidate: ["/elearning/online"],
  handler: async ({ actor, input }) => {
    const r = await taoKhoa(db, input, actor.userId);
    if (!r.ok) return loi(r);
    return { entityId: r.courseId, data: { courseId: r.courseId, draftVersionId: r.draftVersionId, slug: r.slug }, newValues: { code: input.code, name: input.name, listPrice: input.listPrice, salePrice: input.salePrice, validityMonths: input.validityMonths } };
  },
};

export const cauHinhSuaKhoa: ActionConfig<z.infer<typeof suaKhoaSchema>, { courseId: string }> = {
  name: "onlSuaKhoa",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "UPDATE",
  schema: suaKhoaSchema,
  handler: async ({ input }) => {
    const r = await suaKhoa(db, input);
    if (!r.ok) return loi(r);
    return { entityId: r.courseId, data: { courseId: r.courseId }, oldValues: r.truoc, newValues: r.sau, revalidate: duongDan(r.courseId) };
  },
};

export const cauHinhDoiTrangThaiBan: ActionConfig<z.infer<typeof trangThaiBanSchema>, { truoc: string; sau: string }> = {
  name: "onlDoiTrangThaiBan",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "UPDATE",
  schema: trangThaiBanSchema,
  handler: async ({ input }) => {
    const r = await doiTrangThaiBan(db, input);
    if (!r.ok) return loi(r);
    return { entityId: input.courseId, data: { truoc: r.truoc, sau: r.sau }, oldValues: { saleStatus: r.truoc }, newValues: { saleStatus: r.sau }, revalidate: duongDan(input.courseId) };
  },
};

export const cauHinhTienQuyet: ActionConfig<z.infer<typeof tienQuyetSchema>, { ok: true }> = {
  name: "onlTienQuyet",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "UPDATE",
  schema: tienQuyetSchema,
  handler: async ({ input }) => {
    const r = await datTienQuyet(db, input);
    if (!r.ok) return loi(r);
    return { entityId: input.courseId, data: { ok: true }, newValues: { prerequisiteMode: input.mode, prerequisiteCourseId: input.prerequisiteCourseId }, revalidate: duongDan(input.courseId) };
  },
};

export const cauHinhLuuTruKhoa: ActionConfig<{ courseId: string }, { ok: true }> = {
  name: "onlLuuTruKhoa",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "DELETE",
  requireReason: true,
  schema: z.object({ courseId: z.string().min(1) }).strict(),
  revalidate: ["/elearning/online"],
  handler: async ({ input }) => {
    const r = await luuTruKhoa(db, input.courseId, new Date());
    if (!r.ok) return loi(r);
    return { entityId: input.courseId, data: { ok: true } };
  },
};

export const cauHinhSapXepKhoa: ActionConfig<z.infer<typeof sapXepSchema>, { soDaDoi: number }> = {
  name: "onlSapXepKhoa",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "UPDATE",
  schema: sapXepSchema,
  revalidate: ["/elearning/online"],
  handler: async ({ input }) => {
    const r = await sapXepKhoa(db, input.courseIds);
    return { entityId: "thu-tu-hien-thi", data: { soDaDoi: r.soDaDoi }, newValues: { courseIds: input.courseIds } };
  },
};

export const cauHinhLuuDanhMuc: ActionConfig<z.infer<typeof danhMucSchema>, { id: string }> = {
  name: "onlLuuDanhMuc",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCategory",
  auditAction: "UPDATE",
  schema: danhMucSchema,
  revalidate: ["/elearning/online", "/elearning/online/danh-muc"],
  handler: async ({ input }) => {
    const r = await luuDanhMuc(db, input);
    if (!r.ok) return loi(r);
    return { entityId: r.id, data: { id: r.id }, newValues: { name: input.name, parentId: input.parentId ?? null } };
  },
};

export const cauHinhXoaDanhMuc: ActionConfig<{ id: string }, { ok: true }> = {
  name: "onlXoaDanhMuc",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCategory",
  auditAction: "DELETE",
  requireReason: true,
  schema: z.object({ id: z.string().min(1) }).strict(),
  revalidate: ["/elearning/online/danh-muc"],
  handler: async ({ input }) => {
    const r = await xoaDanhMuc(db, input.id);
    if (!r.ok) return loi(r);
    return { entityId: input.id, data: { ok: true } };
  },
};

// ───────── Nội dung (bản nháp) ─────────

const kqNoiDung = (courseId: string) => duongDan(courseId);

/** Tìm khoá của một bản để revalidate đúng trang (và để audit gắn đúng khoá). */
async function khoaCuaBan(versionId: string): Promise<string> {
  const b = await db.onlCourseVersion.findUnique({ where: { id: versionId }, select: { courseId: true } });
  return b?.courseId ?? versionId;
}

export const cauHinhMoBanNhap: ActionConfig<{ courseId: string }, { versionId: string; number: number; moiTao: boolean }> = {
  name: "onlMoBanNhap",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourseVersion",
  auditAction: "CREATE",
  schema: z.object({ courseId: z.string().min(1) }).strict(),
  handler: async ({ actor, input }) => {
    const r = await moBanNhap(db, input.courseId, actor.userId);
    if (!r.ok) return loi(r);
    return { entityId: r.versionId, data: { versionId: r.versionId, number: r.number, moiTao: r.moiTao }, newValues: { courseId: input.courseId, number: r.number, moiTao: r.moiTao }, revalidate: kqNoiDung(input.courseId) };
  },
};

export const cauHinhThemChuong: ActionConfig<z.infer<typeof chuongSchema>, { chapterId: string }> = {
  name: "onlThemChuong",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlChapter",
  auditAction: "CREATE",
  schema: chuongSchema,
  handler: async ({ input }) => {
    const r = await themChuong(db, input);
    if (!r.ok) return loi(r);
    return { entityId: r.chapterId, data: { chapterId: r.chapterId }, newValues: { title: input.title, versionId: input.versionId }, revalidate: kqNoiDung(await khoaCuaBan(input.versionId)) };
  },
};

export const cauHinhSuaChuong: ActionConfig<z.infer<typeof suaChuongSchema>, { ok: true }> = {
  name: "onlSuaChuong",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlChapter",
  auditAction: "UPDATE",
  schema: suaChuongSchema,
  handler: async ({ input }) => {
    const r = await suaChuong(db, input);
    if (!r.ok) return loi(r);
    const c = await db.onlChapter.findUnique({ where: { id: input.chapterId }, select: { versionId: true } });
    return { entityId: input.chapterId, data: { ok: true }, newValues: { title: input.title ?? null, hidden: input.hidden ?? null }, revalidate: kqNoiDung(c ? await khoaCuaBan(c.versionId) : "") };
  },
};

export const cauHinhXoaChuong: ActionConfig<{ chapterId: string }, { soBaiXoa: number }> = {
  name: "onlXoaChuong",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlChapter",
  auditAction: "DELETE",
  requireReason: true,
  schema: z.object({ chapterId: z.string().min(1) }).strict(),
  handler: async ({ input }) => {
    const c = await db.onlChapter.findUnique({ where: { id: input.chapterId }, select: { versionId: true } });
    const r = await xoaChuong(db, input.chapterId);
    if (!r.ok) return loi(r);
    return { entityId: input.chapterId, data: { soBaiXoa: r.soBaiXoa }, oldValues: { soBaiXoa: r.soBaiXoa }, revalidate: kqNoiDung(c ? await khoaCuaBan(c.versionId) : "") };
  },
};

export const cauHinhThemBai: ActionConfig<z.infer<typeof baiSchema>, { lessonId: string; stableId: string }> = {
  name: "onlThemBai",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlLesson",
  auditAction: "CREATE",
  schema: baiSchema,
  handler: async ({ input }) => {
    const r = await themBai(db, input);
    if (!r.ok) return loi(r);
    return { entityId: r.lessonId, data: { lessonId: r.lessonId, stableId: r.stableId }, newValues: { title: input.title, kind: input.kind }, revalidate: kqNoiDung(await khoaCuaBan(input.versionId)) };
  },
};

export const cauHinhSuaBai: ActionConfig<z.infer<typeof suaBaiSchema>, { ok: true }> = {
  name: "onlSuaBai",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlLesson",
  auditAction: "UPDATE",
  schema: suaBaiSchema,
  handler: async ({ input }) => {
    const b = await db.onlLesson.findUnique({ where: { id: input.lessonId }, select: { versionId: true } });
    const r = await suaBai(db, input);
    if (!r.ok) return loi(r);
    // Không ghi `contentJson` vào audit (có thể là thân bài dài); chỉ tên các trường đổi.
    return { entityId: input.lessonId, data: { ok: true }, newValues: { truongDoi: Object.keys(input).filter((k) => k !== "lessonId") }, revalidate: kqNoiDung(b ? await khoaCuaBan(b.versionId) : "") };
  },
};

export const cauHinhXoaBai: ActionConfig<{ lessonId: string }, { ok: true }> = {
  name: "onlXoaBai",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlLesson",
  auditAction: "DELETE",
  requireReason: true,
  schema: z.object({ lessonId: z.string().min(1) }).strict(),
  handler: async ({ input }) => {
    const b = await db.onlLesson.findUnique({ where: { id: input.lessonId }, select: { versionId: true } });
    const r = await xoaBai(db, input.lessonId);
    if (!r.ok) return loi(r);
    return { entityId: input.lessonId, data: { ok: true }, revalidate: kqNoiDung(b ? await khoaCuaBan(b.versionId) : "") };
  },
};

export const cauHinhDatBoCuc: ActionConfig<z.infer<typeof bocucSchema>, { ok: true }> = {
  name: "onlDatBoCuc",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourseVersion",
  auditAction: "UPDATE",
  schema: bocucSchema,
  handler: async ({ input }) => {
    const r = await datBoCuc(db, input);
    if (!r.ok) return loi(r);
    return { entityId: input.versionId, data: { ok: true }, newValues: { soChuong: input.chuong.length }, revalidate: kqNoiDung(await khoaCuaBan(input.versionId)) };
  },
};

export const cauHinhLuuCaiDat: ActionConfig<z.infer<typeof luuCaiDatSchema>, { ok: true }> = {
  name: "onlLuuCaiDat",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCourseVersion",
  auditAction: "UPDATE",
  schema: luuCaiDatSchema,
  handler: async ({ input }) => {
    const r = await luuCaiDat(db, input);
    if (!r.ok) return loi(r);
    return { entityId: input.versionId, data: { ok: true }, oldValues: (r.truoc ?? null) as Record<string, unknown> | null, newValues: r.sau as unknown as Record<string, unknown>, revalidate: kqNoiDung(await khoaCuaBan(input.versionId)) };
  },
};

// ───────── Phát hành ─────────

const xemTruocSchema = z.object({ courseId: z.string().min(1), chinhSach: chinhSachSchema.nullable().optional() }).strict();

export const cauHinhXemTruocPhatHanh: ActionConfig<z.infer<typeof xemTruocSchema>, XemTruocPhatHanh> = {
  name: "onlXemTruocPhatHanh",
  permission: "onl:course:release",
  module: MODULE,
  entityType: "OnlCourse",
  auditAction: "READ",
  schema: xemTruocSchema,
  handler: async ({ input }) => {
    const r = await xemTruocPhatHanh(db, input.courseId, input.chinhSach ?? null);
    if (!r.ok) return loi(r);
    // Chỉ ĐỌC: không có gì để ghi sổ.
    return { entityId: input.courseId, data: r.xemTruoc, daGhiAudit: true };
  },
};

export const cauHinhPhatHanh: ActionConfig<z.infer<typeof phatHanhSchema>, { versionId: string; number: number; soPhaiHocLai: number; soTienDoDatLai: number }> = {
  name: "onlPhatHanh",
  permission: "onl:course:release",
  module: MODULE,
  entityType: "OnlCourseVersion",
  auditAction: "PUBLISH",
  schema: phatHanhSchema,
  handler: async ({ actor, input }) => {
    const r = await phatHanh(db, input, actor.userId, new Date());
    if (!r.ok) return loi(r);
    return {
      entityId: r.versionId,
      data: { versionId: r.versionId, number: r.number, soPhaiHocLai: r.tacDong?.soPhaiHocLai ?? 0, soTienDoDatLai: r.soTienDoDatLai },
      newValues: { courseId: input.courseId, number: r.number, chinhSach: input.chinhSach ?? null, soHocVien: r.tacDong?.soHocVien ?? 0, soBiAnhHuong: r.tacDong?.soBiAnhHuong ?? 0, soPhaiHocLai: r.tacDong?.soPhaiHocLai ?? 0, soTienDoDatLai: r.soTienDoDatLai },
      revalidate: duongDan(input.courseId),
    };
  },
};

// ───────── Quyền học của học viên trong khoá ─────────

const khoaIdem = z.string().trim().min(8, "Khoá idempotency tối thiểu 8 ký tự").max(120);

export const capQuyenSchema = z
  .object({
    courseId: z.string().min(1),
    studentId: z.string().min(1),
    /** `CAP_MIEN_PHI` = cấp mới / cộng thêm kỳ hạn không cần đơn; `GIA_HAN` = gia hạn một quyền đã có. Việc MUA do Workstream A gọi `capQuyenHoc` trực tiếp, không qua đây. */
    loai: z.enum(["CAP_MIEN_PHI", "GIA_HAN"]),
    /** Sinh MỘT lần khi mở hộp thoại; bấm lại/nhấp đúp ⇒ không cấp hai lần. */
    idempotencyKey: khoaIdem,
  })
  .strict();

export const cauHinhCapQuyen: ActionConfig<z.infer<typeof capQuyenSchema>, { entitlementId: string; hanhDong: string; hetHan: string | null; daXuLyTruocDo: boolean }> = {
  name: "onlCapQuyen",
  permission: "onl:student:grant",
  module: MODULE,
  entityType: "OnlEntitlement",
  auditAction: "GRANT",
  requireReason: true,
  schema: capQuyenSchema,
  handler: async ({ actor, input, reason }) => {
    const r = await capQuyenHoc(db, { studentId: input.studentId, courseId: input.courseId, loai: input.loai, now: new Date(), idempotencyKey: input.idempotencyKey, reason: reason ?? undefined, actorUserId: actor.userId });
    if (!r.ok) return loi(r);
    return {
      entityId: r.entitlementId,
      data: { entitlementId: r.entitlementId, hanhDong: r.hanhDong, hetHan: r.hetHan ? r.hetHan.toISOString() : null, daXuLyTruocDo: r.daXuLyTruocDo },
      newValues: { courseId: input.courseId, studentId: input.studentId, loai: input.loai, hanhDong: r.hanhDong, hetHan: r.hetHan ? r.hetHan.toISOString() : null, daXuLyTruocDo: r.daXuLyTruocDo },
      revalidate: duongDan(input.courseId),
    };
  },
};

export const thuHoiSchema = z.object({ courseId: z.string().min(1), studentId: z.string().min(1), idempotencyKey: khoaIdem }).strict();

export const cauHinhThuHoiQuyen: ActionConfig<z.infer<typeof thuHoiSchema>, { entitlementId: string; daXuLyTruocDo: boolean }> = {
  name: "onlThuHoiQuyen",
  permission: "onl:student:revoke",
  module: MODULE,
  entityType: "OnlEntitlement",
  auditAction: "REVOKE",
  requireReason: true,
  schema: thuHoiSchema,
  handler: async ({ actor, input, reason }) => {
    const r = await thuHoiQuyenHoc(db, { studentId: input.studentId, courseId: input.courseId, reason: reason ?? "", idempotencyKey: input.idempotencyKey, now: new Date(), actorUserId: actor.userId, loaiThuHoi: "ADMIN" });
    if (!r.ok) return loi(r);
    return {
      entityId: r.entitlementId,
      data: { entitlementId: r.entitlementId, daXuLyTruocDo: r.daXuLyTruocDo },
      newValues: { courseId: input.courseId, studentId: input.studentId, daXuLyTruocDo: r.daXuLyTruocDo },
      revalidate: duongDan(input.courseId),
    };
  },
};

// ───────── Đọc theo yêu cầu từ giao diện (hộp thoại) ─────────

export const lichSuQuyenSchema = z.object({ courseId: z.string().min(1), studentId: z.string().min(1) }).strict();

/** Lịch sử quyền học của MỘT học viên trong MỘT khoá. Chỉ đọc (không ghi audit). Quyền `onl:student:view`. */
export const cauHinhLichSuQuyen: ActionConfig<z.infer<typeof lichSuQuyenSchema>, DongLichSuQuyen[]> = {
  name: "onlLichSuQuyen",
  permission: "onl:student:view",
  module: MODULE,
  entityType: "OnlEntitlement",
  auditAction: "READ",
  schema: lichSuQuyenSchema,
  handler: async ({ input }) => {
    const r = await lichSuQuyenHoc(db, input);
    if (!r) throw new ActionError("CHUA_CO_QUYEN", "Học viên chưa có quyền học khoá này");
    return { entityId: input.courseId, data: r, daGhiAudit: true };
  },
};

export const lichSuGianDoanSchema = z.object({ courseId: z.string().min(1), entitlementId: z.string().min(1).optional() }).strict();

/** P0 Mobile: Admin xem lịch sử lượt bị gián đoạn khi thu hồi + bồi hoàn (ai thu hồi, lúc nào, quyền nào, lượt nào, ai cấp lại). Chỉ đọc. Quyền `onl:student:view`. Không có đáp án/điểm. */
export const cauHinhLichSuGianDoan: ActionConfig<z.infer<typeof lichSuGianDoanSchema>, Awaited<ReturnType<typeof docLichSuGianDoan>>> = {
  name: "onlLichSuGianDoan",
  permission: "onl:student:view",
  module: MODULE,
  entityType: "OnlAttemptInterruption",
  auditAction: "READ",
  schema: lichSuGianDoanSchema,
  handler: async ({ input }) => ({ entityId: input.courseId, data: await docLichSuGianDoan(db, input), daGhiAudit: true }),
};

export const quyetBoiHoanSchema = z.object({ interruptionId: z.string().min(1), quyet: z.enum(["DUYET", "TU_CHOI"]), lyDo: z.string().trim().min(10, "Nêu lý do (≥ 10 ký tự)").max(1000) }).strict();

/** P0 Mobile: Admin xử lý trường hợp ngoại lệ — duyệt/từ chối bồi hoàn đang chờ xem xét. Cần lý do; vào nhật ký. Quyền `onl:student:grant` (cùng quyền cấp lại quyền học). */
export const capBuLoiHeThongSchema = z
  .object({ attemptId: z.string().min(1), lyDo: z.string().trim().min(10, "Nêu lý do (≥ 10 ký tự)").max(1000), bangChung: z.string().trim().min(5, "Cần bằng chứng xác minh lỗi hệ thống (≥ 5 ký tự)").max(500) })
  .strict();

/** Owner EX-01: Admin cấp bù MỘT lượt thi vì lỗi hệ thống ĐÃ XÁC MINH. Quyền `onl:student:grant`; lý do + bằng chứng bắt buộc; vào nhật ký. KHÔNG đi qua luồng làm bài/tự chốt. */
export const cauHinhCapBuLoiHeThong: ActionConfig<z.infer<typeof capBuLoiHeThongSchema>, { compensationId: string; daCoTruocDo: boolean }> = {
  name: "onlCapBuLoiHeThong",
  permission: "onl:student:grant",
  module: MODULE,
  entityType: "OnlAttemptInterruption",
  auditAction: "CREATE",
  schema: capBuLoiHeThongSchema,
  handler: async ({ actor, input }) => {
    const r = await capBuLoiHeThong(db, { attemptId: input.attemptId, actorUserId: actor.userId, lyDo: input.lyDo, bangChung: input.bangChung, now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: r.interruptionId, data: { compensationId: r.compensationId, daCoTruocDo: r.daCoTruocDo }, newValues: { attemptId: input.attemptId, lyDo: input.lyDo, bangChung: input.bangChung, daCoTruocDo: r.daCoTruocDo }, revalidate: ["/elearning/online"] };
  },
};

export const cauHinhQuyetBoiHoan: ActionConfig<z.infer<typeof quyetBoiHoanSchema>, { trangThai: string }> = {
  name: "onlQuyetBoiHoan",
  permission: "onl:student:grant",
  module: MODULE,
  entityType: "OnlAttemptInterruption",
  auditAction: "UPDATE",
  schema: quyetBoiHoanSchema,
  handler: async ({ actor, input }) => {
    const r = await quyetBoiHoan(db, { interruptionId: input.interruptionId, quyet: input.quyet, actorUserId: actor.userId, lyDo: input.lyDo, now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: input.interruptionId, data: { trangThai: r.trangThai }, newValues: { trangThai: r.trangThai, quyet: input.quyet, lyDo: input.lyDo }, revalidate: ["/elearning/online"] };
  },
};

export const timUngVienSchema = z.object({ courseId: z.string().min(1), q: z.string().trim().min(2, "Nhập ít nhất 2 ký tự").max(100) }).strict();

/** Tìm `Student` ĐÃ CÓ để cấp quyền. Quyền `onl:student:grant` (người không cấp được không cần tìm). Không tạo học viên. */
export const cauHinhTimUngVien: ActionConfig<z.infer<typeof timUngVienSchema>, UngVienCap[]> = {
  name: "onlTimUngVien",
  permission: "onl:student:grant",
  module: MODULE,
  entityType: "Student",
  auditAction: "READ",
  schema: timUngVienSchema,
  handler: async ({ input }) => ({ entityId: input.courseId, data: await timHocVienDeCap(db, input), daGhiAudit: true }),
};

// ───────── Đánh giá: câu hỏi · đề · chấm tay ─────────

export const cauHinhLuuCauHoi: ActionConfig<z.infer<typeof cauHoiSchema>, { id: string }> = {
  name: "onlLuuCauHoi",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlQuestion",
  auditAction: "UPDATE",
  schema: cauHoiSchema,
  handler: async ({ actor, input }) => {
    const r = await luuCauHoi(db, input, actor.userId);
    if (!r.ok) return loi(r);
    // Audit KHÔNG chép đáp án (chỉ loại câu + độ dài đề) — đáp án đúng không nên nằm ở nhiều nơi.
    return { entityId: r.id, data: { id: r.id }, newValues: { courseId: input.courseId, type: input.type, points: input.points ?? 1, laSua: !!input.id }, revalidate: duongDan(input.courseId) };
  },
};

export const docCauHoiSchema = z.object({ courseId: z.string().min(1), questionId: z.string().min(1) }).strict();

/** Đọc MỘT câu để SỬA (kèm đáp án — người soạn có quyền). Chỉ đọc. Quyền `onl:assessment:manage`. Câu của khoá khác ⇒ NOT_FOUND. */
export const cauHinhDocCauHoiDeSua: ActionConfig<z.infer<typeof docCauHoiSchema>, NonNullable<Awaited<ReturnType<typeof docCauHoiDeSua>>>> = {
  name: "onlDocCauHoiDeSua",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlQuestion",
  auditAction: "READ",
  schema: docCauHoiSchema,
  handler: async ({ input }) => {
    const r = await docCauHoiDeSua(db, input.courseId, input.questionId);
    if (!r) throw new ActionError("NOT_FOUND", "Không tìm thấy câu hỏi trong khoá này");
    return { entityId: input.questionId, data: r, daGhiAudit: true };
  },
};

// ───────── Nhập câu hỏi từ Excel (QoImport) ─────────

const tepNhapSchema = z.object({ courseId: z.string().min(1), tepBase64: z.string().min(1).max(1_000_000) }).strict();

/** Dòng kiểm trả về CHO MÀN HÌNH: không kèm nội dung câu (đáp án) — bản ghi thật được dựng lại ở máy chủ khi nhập, không tin kết quả xem trước từ client. */
export type DongXemTruocNhap = { sheet: string; dong: number; loai: string; deBai: string; loi: string | null };
export type XemTruocNhap = Omit<KetQuaKiemNhap, "chiTiet"> & { chiTiet: DongXemTruocNhap[] };

async function kiemTep(tepBase64: string, courseId: string): Promise<KetQuaKiemNhap> {
  let sheets: Record<string, string[][]>;
  try {
    sheets = docTepXlsx(tepBase64);
  } catch (e) {
    throw new ActionError("VALIDATION_ERROR", e instanceof Error ? e.message : "Không đọc được tệp");
  }
  // Câu trùng với ngân hàng của CHÍNH khoá này (chưa lưu trữ) — không đọc khoá khác.
  const daCo = await db.onlQuestion.findMany({ where: { courseId, status: "ACTIVE" }, select: { stem: true } });
  return danhDauCauTrung(kiemBangTinh(sheets), daCo.map((c) => c.stem));
}

export const cauHinhKiemTraNhapCauHoi: ActionConfig<z.infer<typeof tepNhapSchema>, XemTruocNhap> = {
  name: "onlKiemTraNhapCauHoi",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlQuestion",
  auditAction: "READ",
  schema: tepNhapSchema,
  handler: async ({ input }) => {
    const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
    if (!khoa) throw new ActionError("NOT_FOUND", "Khoá không tồn tại");
    const r = await kiemTep(input.tepBase64, input.courseId);
    // Chỉ ĐỌC và không lưu tệp: không có gì để ghi sổ.
    return { entityId: input.courseId, data: { ...r, chiTiet: r.chiTiet.map((d) => ({ sheet: d.sheet, dong: d.dong, loai: d.loai, deBai: d.deBai, loi: d.loi ?? null })) }, daGhiAudit: true };
  },
};

export const nhapCauHoiSchema = z
  .object({
    courseId: z.string().min(1),
    tepBase64: z.string().min(1).max(1_000_000),
    boQuaLoi: z.boolean(),
    /** "Đích" của thiết kế: gắn các câu vừa nhập vào đề này (thuộc khoá). Vắng/null = chỉ vào ngân hàng câu hỏi. */
    deThiId: z.string().min(1).nullable().optional(),
    /** "Gắn nhãn đợt nhập": mặc định CÓ. Tắt ⇒ nhật ký không mang nhãn. */
    ganNhan: z.boolean().optional(),
  })
  .strict();
export const cauHinhNhapCauHoi: ActionConfig<z.infer<typeof nhapCauHoiSchema>, { soDaNhap: number; soBoQua: number; soGanVaoDe: number; nhan: string | null }> = {
  name: "onlNhapCauHoi",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlQuestion",
  auditAction: "CREATE",
  schema: nhapCauHoiSchema,
  handler: async ({ actor, input }) => {
    const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
    if (!khoa) throw new ActionError("NOT_FOUND", "Khoá không tồn tại");
    // Kiểm LẠI ở máy chủ từ chính tệp — không tin bản xem trước mà client đã thấy.
    const r = await kiemTep(input.tepBase64, input.courseId);
    if (r.loiChung) throw new ActionError("VALIDATION_ERROR", r.loiChung);
    if (r.loi > 0 && !input.boQuaLoi) throw new ActionError("VALIDATION_ERROR", `Còn ${r.loi} dòng lỗi — sửa tệp rồi tải lại, hoặc chọn bỏ qua dòng lỗi để nhập phần hợp lệ`);
    const cau = r.chiTiet.flatMap((d) => (d.cau ? [d.cau] : []));
    const w = await nhapCauHoi(db, { courseId: input.courseId, cau, deThiId: input.deThiId ?? null }, actor.userId);
    if (!w.ok) return loi(w);
    const nhan = input.ganNhan === false ? null : `IMP-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}`;
    // Audit KHÔNG chép nội dung câu/đáp án — chỉ số lượng và nhãn đợt nhập (câu hỏi không có cột nhãn đợt: nhãn chỉ nằm ở nhật ký).
    return { entityId: input.courseId, data: { soDaNhap: w.soDaNhap, soBoQua: r.loi, soGanVaoDe: w.soGanVaoDe, nhan }, newValues: { courseId: input.courseId, soDaNhap: w.soDaNhap, soBoQua: r.loi, soGanVaoDe: w.soGanVaoDe, deThiId: input.deThiId ?? null, nhan, boQuaLoi: input.boQuaLoi }, revalidate: duongDan(input.courseId) };
  },
};

export const luuTruCauHoiSchema = z.object({ courseId: z.string().min(1), questionId: z.string().min(1) }).strict();
export const cauHinhLuuTruCauHoi: ActionConfig<z.infer<typeof luuTruCauHoiSchema>, { ok: true }> = {
  name: "onlLuuTruCauHoi",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlQuestion",
  auditAction: "DELETE",
  requireReason: true,
  schema: luuTruCauHoiSchema,
  handler: async ({ input }) => {
    const r = await luuTruCauHoi(db, input.courseId, input.questionId);
    if (!r.ok) return loi(r);
    return { entityId: input.questionId, data: { ok: true }, revalidate: duongDan(input.courseId) };
  },
};

export const cauHinhLuuDeThi: ActionConfig<z.infer<typeof deThiSchema>, { id: string }> = {
  name: "onlLuuDeThi",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlAssessment",
  auditAction: "UPDATE",
  schema: deThiSchema,
  handler: async ({ actor, input }) => {
    const r = await luuDeThi(db, input, actor.userId);
    if (!r.ok) return loi(r);
    return { entityId: r.id, data: { id: r.id }, newValues: { courseId: input.courseId, kind: input.kind, title: input.title, passPercent: input.passPercent, status: input.status, soCau: input.cau.length }, revalidate: duongDan(input.courseId) };
  },
};

export const docLuotSchema = z.object({ attemptId: z.string().min(1) }).strict();
/** Người chấm xem bài làm + câu tự luận (không trả đáp án của câu tự động). Quyền `onl:assessment:grade`. */
export const cauHinhDocLuotDeCham: ActionConfig<z.infer<typeof docLuotSchema>, NonNullable<Awaited<ReturnType<typeof docLuotDeCham>>>> = {
  name: "onlDocLuotDeCham",
  permission: "onl:assessment:grade",
  module: MODULE,
  entityType: "OnlAttempt",
  auditAction: "READ",
  schema: docLuotSchema,
  handler: async ({ input }) => {
    const r = await docLuotDeCham(db, input.attemptId);
    if (!r) throw new ActionError("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");
    return { entityId: input.attemptId, data: r, daGhiAudit: true };
  },
};

export const cauHinhChamLaiTay: ActionConfig<z.infer<typeof chamLaiTaySchema>, { lan: number; scorePercent: number; passed: boolean; vuaCapChungNhan: boolean; canhBaoChungNhanDaCap: boolean }> = {
  name: "onlChamLaiTay",
  permission: "onl:assessment:grade",
  module: MODULE,
  entityType: "OnlAttempt",
  auditAction: "REGRADE",
  schema: chamLaiTaySchema,
  handler: async ({ actor, input }) => {
    const r = await chamLaiTay(db, { attemptId: input.attemptId, diem: input.diem, feedback: input.feedback ?? null, lyDo: input.lyDo, graderUserId: actor.userId, now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: input.attemptId, data: { lan: r.lan, scorePercent: r.scorePercent, passed: r.passed, vuaCapChungNhan: r.vuaCapChungNhan, canhBaoChungNhanDaCap: r.canhBaoChungNhanDaCap }, newValues: { lan: r.lan, scorePercent: r.scorePercent, passed: r.passed, diem: input.diem }, revalidate: ["/elearning/online"] };
  },
};

export const cauHinhChamTay: ActionConfig<z.infer<typeof chamTaySchema>, { scorePercent: number; passed: boolean; vuaCapChungNhan: boolean }> = {
  name: "onlChamTay",
  permission: "onl:assessment:grade",
  module: MODULE,
  entityType: "OnlAttempt",
  auditAction: "GRADE",
  schema: chamTaySchema,
  handler: async ({ actor, input }) => {
    const r = await chamTay(db, { attemptId: input.attemptId, diem: input.diem, feedback: input.feedback ?? null, graderUserId: actor.userId, now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: input.attemptId, data: { scorePercent: r.scorePercent, passed: r.passed, vuaCapChungNhan: r.vuaCapChungNhan }, newValues: { scorePercent: r.scorePercent, passed: r.passed, diem: input.diem }, revalidate: ["/elearning/online"] };
  },
};

// ───────── Sản phẩm + khung chấm (V10.0, Q6) ─────────

export const chamSanPhamSchema = z
  .object({
    submissionId: z.string().min(1),
    /** Có khung chấm: điểm TỪNG tiêu chí (đủ + đúng). Không khung: dùng `diemTrucTiep`. */
    scores: z.record(z.string(), z.number()).optional(),
    diemTrucTiep: z.number().int().optional(),
    feedback: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

export const cauHinhChamSanPham: ActionConfig<z.infer<typeof chamSanPhamSchema>, { points: number; toiDa: number }> = {
  name: "onlChamSanPham",
  permission: "onl:assessment:grade",
  module: MODULE,
  entityType: "OnlSubmission",
  auditAction: "GRADE",
  schema: chamSanPhamSchema,
  handler: async ({ actor, input }) => {
    const r = await chamSanPham(db, { submissionId: input.submissionId, graderUserId: actor.userId, scores: input.scores, diemTrucTiep: input.diemTrucTiep, feedback: input.feedback ?? null, now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: input.submissionId, data: { points: r.points, toiDa: r.toiDa }, newValues: { points: r.points, scores: input.scores ?? null }, revalidate: ["/elearning/online"] };
  },
};

export const yeuCauNopLaiSchema = z.object({ submissionId: z.string().min(1), lyDo: z.string().trim().min(10, "Nêu lý do (≥ 10 ký tự)").max(1000) }).strict();

export const cauHinhYeuCauNopLai: ActionConfig<z.infer<typeof yeuCauNopLaiSchema>, { ok: true }> = {
  name: "onlYeuCauNopLai",
  permission: "onl:assessment:grade",
  module: MODULE,
  entityType: "OnlSubmission",
  auditAction: "UPDATE",
  schema: yeuCauNopLaiSchema,
  handler: async ({ actor, input }) => {
    const r = await yeuCauNopLai(db, { submissionId: input.submissionId, graderUserId: actor.userId, lyDo: input.lyDo });
    if (!r.ok) return loi(r);
    return { entityId: input.submissionId, data: { ok: true as const }, newValues: { status: "RESUBMIT_REQUESTED", lyDo: input.lyDo }, revalidate: ["/elearning/online"] };
  },
};

export const luuKhungChamSchema = z.object({ id: z.string().min(1).optional(), courseId: z.string().min(1), code: z.string(), title: z.string(), criteria: z.array(z.object({ id: z.string(), name: z.string(), max: z.number() })), archived: z.boolean().optional() }).strict();

export const cauHinhLuuKhungCham: ActionConfig<z.infer<typeof luuKhungChamSchema>, { id: string }> = {
  name: "onlLuuKhungCham",
  permission: "onl:assessment:manage",
  module: MODULE,
  entityType: "OnlRubric",
  auditAction: "UPDATE",
  schema: luuKhungChamSchema,
  handler: async ({ actor, input }) => {
    const r = await luuKhungCham(db, input, actor.userId);
    if (!r.ok) return loi(r);
    return { entityId: r.id, data: { id: r.id }, newValues: { code: input.code, criteria: input.criteria }, revalidate: ["/elearning/online"] };
  },
};

// ───────── Phôi chứng nhận Online (V10.0, Q2) ─────────

export const duyetMauSchema = z.object({ templateId: z.string().min(1) }).strict();

export const cauHinhDuyetMau: ActionConfig<z.infer<typeof duyetMauSchema>, { thayThe: string | null }> = {
  name: "onlDuyetMauChungNhan",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCertificateTemplate",
  auditAction: "PUBLISH",
  schema: duyetMauSchema,
  handler: async ({ actor, input }) => {
    const r = await duyetMau(db, { templateId: input.templateId, actorUserId: actor.userId });
    if (!r.ok) return loi(r);
    return { entityId: input.templateId, data: { thayThe: r.thayThe }, newValues: { status: "APPROVED", thayThe: r.thayThe }, revalidate: ["/elearning/online"] };
  },
};

export const banMoiBoCucSchema = z.object({ templateId: z.string().min(1), fields: z.record(z.string(), z.unknown()) }).strict();

export const cauHinhTaoBanMoiBoCuc: ActionConfig<z.infer<typeof banMoiBoCucSchema>, { id: string; version: number; canhBao: { muc: string; thongBao: string }[] }> = {
  name: "onlTaoBanMoiBoCucChungNhan",
  permission: "onl:course:manage",
  module: MODULE,
  entityType: "OnlCertificateTemplate",
  auditAction: "CREATE",
  schema: banMoiBoCucSchema,
  handler: async ({ actor, input }) => {
    const r = await taoBanMoiTuBan(db, { templateId: input.templateId, fields: input.fields, actorUserId: actor.userId });
    if (!r.ok) return loi(r);
    return { entityId: r.id, data: { id: r.id, version: r.version, canhBao: r.canhBao.map((c) => ({ muc: c.muc, thongBao: c.thongBao })) }, newValues: { version: r.version }, revalidate: ["/elearning/online"] };
  },
};

// ───────── Chứng nhận (tay) ─────────

export const chungNhanSchema = z.object({ courseId: z.string().min(1), studentId: z.string().min(1) }).strict();

export const cauHinhCapChungNhanTay: ActionConfig<z.infer<typeof chungNhanSchema>, { code: string }> = {
  name: "onlCapChungNhanTay",
  permission: "onl:certificate:issue",
  module: MODULE,
  entityType: "OnlCertificate",
  auditAction: "CREATE",
  requireReason: true,
  schema: chungNhanSchema,
  handler: async ({ actor, input, reason }) => {
    const r = await capChungNhanTay(db, { courseId: input.courseId, studentId: input.studentId, actorUserId: actor.userId, reason: reason ?? "", now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: r.code, data: { code: r.code }, newValues: { courseId: input.courseId, studentId: input.studentId }, revalidate: duongDan(input.courseId) };
  },
};

export const cauHinhThuHoiChungNhan: ActionConfig<z.infer<typeof chungNhanSchema>, { ok: true }> = {
  name: "onlThuHoiChungNhan",
  permission: "onl:certificate:issue",
  module: MODULE,
  entityType: "OnlCertificate",
  auditAction: "REVOKE",
  requireReason: true,
  schema: chungNhanSchema,
  handler: async ({ actor, input, reason }) => {
    const r = await thuHoiChungNhan(db, { courseId: input.courseId, studentId: input.studentId, actorUserId: actor.userId, reason: reason ?? "", now: new Date() });
    if (!r.ok) return loi(r);
    return { entityId: `${input.courseId}:${input.studentId}`, data: { ok: true }, revalidate: duongDan(input.courseId) };
  },
};
