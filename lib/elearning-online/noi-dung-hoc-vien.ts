import type { PrismaClient } from "@prisma/client";
import { kiemTraTruyCapChoPhuHuynh } from "./hoc-tap";
import { kiemNoiDungBai, type LoaiBai } from "./noi-dung";
import type { MaTruyCapDb } from "./quyen-hoc-db";

/**
 * E-LEARNING ONLINE — NỘI DUNG MỘT BÀI cho học viên (đầu ra nội dung đầu tiên đi qua CỔNG DUY NHẤT).
 *
 * Trước đây chỉ có cổng (`kiemTraTruyCapChoPhuHuynh`) mà KHÔNG có hàm nào trả nội dung bài ⇒ lát cắt "mở bài học hợp lệ" của B/A chưa có gì để gọi.
 *
 * Luật (mỗi cái có ca `[ONL-ND-*]` ở `tests/elearning/onl-lat-cat-hoc-vien-db.test.ts`):
 *  1. MỌI nhánh đi qua `kiemTraTruyCapChoPhuHuynh` (sở hữu phụ huynh + quyền + hạn + thu hồi + bài ẩn + thứ tự mở + không xem lại). Chưa qua cổng ⇒ KHÔNG đọc `contentJson`.
 *  2. Chỉ trả những gì học viên được thấy theo LOẠI bài:
 *     · READ  ⇒ thân bài (`body`);
 *     · VIDEO ⇒ KHÔNG BAO GIỜ trả khoá media/URL; chỉ `coVideo` + thời lượng. Muốn phát: `capVeMedia` (vé 120s, hỏi lại cổng khi đổi);
 *     · QUIZ/ASSIGNMENT/FINAL_EXAM ⇒ KHÔNG trả đề/đáp án/`assessmentId`; chỉ `coDe` + điểm đạt. Muốn làm: `batDauLamBai`.
 *  3. Đọc từ BẢN ĐANG CHẠY (không phải bản nháp) — cùng bản mà cổng đã kiểm.
 *  4. Chỉ ĐỌC: không ghi tiến độ (việc của `ghiTienDoBai`), không ghi nhật ký truy cập.
 */

type Db = PrismaClient;

export type NoiDungBaiHocVien =
  | { kind: "READ"; stableId: string; title: string; description: string | null; durationSec: number | null; body: string }
  | { kind: "VIDEO"; stableId: string; title: string; description: string | null; durationSec: number | null; coVideo: boolean }
  | { kind: "QUIZ" | "ASSIGNMENT" | "FINAL_EXAM"; stableId: string; title: string; description: string | null; durationSec: number | null; passPercent: number | null; coDe: boolean };

export type KetQuaNoiDungBai =
  | { ok: true; soBan: number; bai: NoiDungBaiHocVien }
  | { ok: false; ma: MaTruyCapDb | "SAI_PHU_HUYNH" };

export async function docNoiDungBaiChoHocVien(
  db: Db,
  input: { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; now: Date },
): Promise<KetQuaNoiDungBai> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return { ok: false, ma: cong.ma };

  const khoa = await db.onlCourse.findUnique({ where: { id: input.courseId }, select: { publishedVersionId: true } });
  if (!khoa?.publishedVersionId) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
  const b = await db.onlLesson.findFirst({
    where: { versionId: khoa.publishedVersionId, stableId: input.lessonStableId },
    select: { stableId: true, kind: true, title: true, description: true, durationSec: true, passPercent: true, contentJson: true, version: { select: { number: true } } },
  });
  if (!b) return { ok: false, ma: "BAI_KHONG_TON_TAI" };

  const co = { stableId: b.stableId, title: b.title, description: b.description, durationSec: b.durationSec };
  const kind = b.kind as LoaiBai;
  // `contentJson` hỏng/khác hình ⇒ coi như rỗng (đóng, không ném): học viên thấy bài trống chứ không thấy lỗi nội bộ.
  const nd = kiemNoiDungBai(kind, b.contentJson);
  const v: Record<string, unknown> = nd.ok ? nd.value : {};
  if (kind === "READ") return { ok: true, soBan: b.version.number, bai: { kind, ...co, body: typeof v.body === "string" ? v.body : "" } };
  if (kind === "VIDEO") return { ok: true, soBan: b.version.number, bai: { kind, ...co, coVideo: typeof v.mediaRef === "string" && v.mediaRef.length > 0 } };
  return { ok: true, soBan: b.version.number, bai: { kind, ...co, passPercent: b.passPercent, coDe: typeof v.assessmentId === "string" && v.assessmentId.length > 0 } };
}
