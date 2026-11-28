import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { docNhapOnline, luuNhapOnline } from "@/lib/mobile-api/dich-vu/online-nhap";
import { luuNhapSchema } from "@/lib/mobile-api/online-thi/hop-dong";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ studentId: string; courseId: string; lessonId: string; attemptId: string }> };

/** GET …/attempts/:attemptId/draft — TIẾP TỤC: `{trangThai, hetGioLuc, giayConLai, draftRevision, nhap[{questionId,revision,savedAt,dapAn}], de|null, gianDoan, luotThayThe, luotConLai…}`. Giờ theo MÁY CHỦ. Có thể chốt lười lượt quá hạn. */
export async function GET(req: Request, ctx: Ctx) {
  const { studentId, courseId, lessonId, attemptId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await docNhapOnline(hs, nguoi, courseId, lessonId, attemptId)));
}

/**
 * PUT …/attempts/:attemptId/draft {requestId, deviceId?, items:[{questionId, answer, baseRevision}]} — lưu CÁC CÂU ĐỔI (không phải cả bài). Chỉ học viên (chế độ học sinh của chính em).
 * 200 + `items[]` THEO TỪNG CÂU: SAVED{revision} · CONFLICT/AHEAD{serverRevision,serverAnswer} · SAI_KIEU · CAU_KHONG_THUOC_LUOT · KHONG_XAC_DINH — câu hợp lệ vẫn được lưu khi câu khác sai.
 * Lỗi cả yêu cầu: 409 HET_GIO/LUOT_DA_CHOT/LUOT_BI_GIAN_DOAN · 403 quyền · 404 lượt · 422 lược đồ · 429 + Retry-After.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { studentId, courseId, lessonId, attemptId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, luuNhapSchema, async (hs, nguoi, _c, than) => traThanhCong(await luuNhapOnline(hs, nguoi, courseId, lessonId, attemptId, than)));
}
