/**
 * `TrialEnrollment.scheduledSessionId = NULL` NGHĨA LÀ GÌ — trả lời ở MỘT chỗ.
 *
 * ── VÌ SAO CÓ TỆP NÀY (sự cố 23/09/2026) ────────────────────────────────────────────
 * Lượt dựng màn "case trial" đổi nghĩa của NULL từ "học cả lớp" sang "chưa xếp case" —
 * nhưng CHỈ trên màn admin. Ba nơi khác vẫn giữ nghĩa cũ, và một lượt kiểm chứng trên
 * app thật đo được cùng một bé mang ba mô tả:
 *   · hồ sơ lead   : "học toàn bộ buổi của lớp"
 *   · màn lớp admin: "chưa thuộc case nào, nên chưa ai điểm danh được"
 *   · site GV      : bé hiện trong case của MỌI giáo viên có case trong lớp
 * Không lỗi nào ném, không test nào đỏ — mỗi màn tự nhất quán với chính nó.
 *
 * ── LUẬT: NGHĨA PHỤ THUỘC LOẠI LỚP ─────────────────────────────────────────────────
 *   · Lớp THEO KHUNG (cột `TrialClassV2.theoKhung`, mô hình case từ 22/09/2026): một lớp
 *     là một ngày × một khung, bên trong nhiều case CHẠY SONG SONG của nhiều Sale. "Học
 *     cả lớp" ở đây nghĩa là dự cả case của người khác — không ai muốn, không ai xếp.
 *     ⇒ NULL = CHƯA XẾP CASE.
 *   · Lớp SLOT CŨ (không khung): một lớp là nhiều buổi nối tiếp, bé học lần lượt.
 *     ⇒ NULL = HỌC CẢ LỚP, đúng chốt 28/08 của chủ dự án.
 *
 * Vì sao không đổi nghĩa cho mọi lớp: lớp theo khung CHỈ tồn tại từ nhánh này, còn lớp
 * cũ là toàn bộ dữ liệu đang chạy trên prod — và theo chú thích trong repo, từ 28/08
 * gần như mọi ghi danh trên prod đều NULL. Đổi nghĩa toàn cục là rút gần hết bé khỏi
 * bảng của giáo viên cho tới khi có người xếp case tay cho từng bé.
 *
 * ⚠️ HAI BẢN SAO KHÔNG TRÁNH ĐƯỢC: câu `where` của Prisma không gọi được hàm JS, nên
 * `lib/lms/teacher-schedule.ts` và `lib/trial/nhac-buoi.ts` diễn đạt lại luật này bằng
 * `trialClass: LOP_CU_WHERE`. Dùng ĐÚNG hằng đó, đừng gõ lại điều kiện tại chỗ.
 */

// Chỉ `import type` — tệp này được component phía trình duyệt dùng (`bang-case.tsx`),
// kéo Prisma Client thật vào bundle client là lỗi build câm ở Next.
import type { Prisma } from "@prisma/client";

export type LopKhung = { theoKhung: boolean };

/**
 * Lớp mở theo khung giờ (mô hình case) hay lớp slot cũ — đọc CỘT ĐÁNH DẤU, không đoán.
 *
 * ~~`Boolean(startTime) && Boolean(endTime)`~~ **[SỬA 23/09/2026, cùng ngày]** Đoán từ
 * hai cột giờ là SAI với lớp tạo trước 28/08: hai cột đó NOT NULL từ 15/06 tới 28/08,
 * và migration 28/08 chỉ DROP NOT NULL, không xoá giá trị — nên lớp slot cũ vẫn mang
 * giờ ở cấp lớp. Đo được trên lớp UAT dựng "giống PROD" (`uat-lopthu-CS1-1`): màn lớp
 * in "Chưa xếp case (5)" cho 5 bé đang HỌC CẢ LỚP. Nay đọc `TrialClassV2.theoKhung`
 * (migration 20260923110000, mặc định FALSE, chỉ `createTrialClass` ghi TRUE).
 */
export function laLopTheoKhung(lop: LopKhung): boolean {
  return lop.theoKhung === true;
}

/** Bản `where` của "lớp slot CŨ" — dùng trong câu Prisma, khớp ĐÚNG `laLopTheoKhung`. */
export const LOP_CU_WHERE: Prisma.TrialClassV2WhereInput = { theoKhung: false };

/**
 * Bé có thuộc case/buổi `sessionId` không — tức có được điểm danh, chấm phiếu, nhắc
 * lịch ở case đó không.
 */
export function thuocCase(
  e: { scheduledSessionId: string | null },
  sessionId: string,
  lopTheoKhung: boolean,
): boolean {
  if (e.scheduledSessionId === sessionId) return true;
  return e.scheduledSessionId === null && !lopTheoKhung;
}

/**
 * Bé học CẢ LỚP — chỉ có ở lớp slot cũ. Màn admin liệt kê những bé này MỘT lần ở khối
 * riêng, thay vì nhân bản vào bảng gỡ của từng buổi.
 */
export function laHocCaLop(e: { scheduledSessionId: string | null }, lopTheoKhung: boolean): boolean {
  return e.scheduledSessionId === null && !lopTheoKhung;
}

/**
 * Bé "Chưa xếp case": còn học (ACTIVE) nhưng không có case nào đang sống để điểm danh.
 *
 * Hai nguồn, cả hai đều có thật:
 *   1. NULL ở lớp theo khung — xếp vào lớp mà chưa chọn case.
 *   2. Trỏ vào một case ĐÃ HUỶ — ở MỌI loại lớp. Huỷ case không đụng ghi danh (cố ý:
 *      giữ vết bé từng ở case nào), nên thiếu vế này thì bé kẹt trong thẻ case đã huỷ,
 *      không vào khối nào, và không còn ô nào để chuyển đi.
 */
export function laChuaXepCase(
  e: { scheduledSessionId: string | null; status: string },
  lopTheoKhung: boolean,
  idCaseDaHuy: ReadonlySet<string>,
): boolean {
  if (e.status !== "ACTIVE") return false;
  if (e.scheduledSessionId === null) return lopTheoKhung;
  return idCaseDaHuy.has(e.scheduledSessionId);
}
