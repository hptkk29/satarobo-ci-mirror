import type { ScopedDb } from "@/lib/actions/factory";
import { cuonKhoaSauKhiXongBai } from "@/lib/elearning/rollup";

/**
 * GHI MỘT BÀI HỌC LÀ XONG — nguồn sự thật DUY NHẤT.
 *
 * ⚠️ Tệp này tồn tại vì luật dưới đây đã bị CHÉP BA LẦN (`reading-progress.ts`,
 * `video-heartbeat.ts`, `exam-taking.ts`), và EL-15c sắp chép lần thứ tư. Ba bản
 * chép đó đã trôi khỏi nhau ở đúng một chỗ, và chỗ đó tốn một vòng rà đối kháng để
 * tìm ra:
 *
 *   **Guard `REVOKED` nằm ở CALL-SITE, không nằm trong hàm ghi.** `cuonTienDoKhoa`
 *   không có nhánh `REVOKED` — đủ bài `DONE` là nó trả `COMPLETED`. Nên bất kỳ
 *   đường nào quên tự chặn sẽ LẬT NGƯỢC `REVOKED` thành `COMPLETED`: người đã bị
 *   rút khỏi khoá bỗng "hoàn thành" nó, trên báo cáo tuân thủ gửi thẳng quản lý
 *   trực tiếp, có ghi tên. Không lỗi, không cảnh báo. `exam-manual-grading.ts` đã
 *   mắc đúng lỗi đó ở EL-14e.
 *
 * Đưa guard VÀO TRONG hàm nghĩa là người viết đường ghi thứ tư không phải nhớ nó.
 *
 * ⚠️ Hàm này KHÔNG quyết định "bài đã xong hay chưa" — nó chỉ GHI. Điều kiện xong
 * là việc của từng loại bài (đọc đủ, xem đủ, thi đạt, chấm đạt), và nó khác nhau
 * theo loại nên không gom được.
 */

export type KetQuaGhiXong =
  | { ghi: true; vuaXongLanDau: boolean }
  /** Không ghi gì. `vi` nói lý do, để chỗ gọi báo lại cho đúng người. */
  | { ghi: false; vi: "THU_HOI" | "KHONG_CO_GHI_DANH" };

/**
 * Đánh dấu một bài học là XONG cho một lượt ghi danh.
 *
 * Idempotent: gọi lại lần hai không đẩy mốc `verifiedAt`/`completedAt` về sau, và
 * không phát lại lời chúc mừng.
 */
export async function ghiXongBai(
  db: ScopedDb,
  i: {
    enrollmentId: string;
    lessonId: string;
    userId: string;
    now: Date;
  },
): Promise<KetQuaGhiXong> {
  // ⚠️ Lượt ghi danh đọc QUA `scopedDb` — vừa là cổng cách ly, vừa là chỗ lấy
  // `status`. Nhận `status` từ chỗ gọi thì lại là một thứ nữa để nhớ.
  const gd = await db.trnEnrollment.findFirst({
    where: { id: i.enrollmentId },
    select: { id: true, status: true },
  });
  if (!gd) return { ghi: false, vi: "KHONG_CO_GHI_DANH" };

  // ⚠️ ĐÂY là guard mà ba bản chép trước để ở call-site. Xem chú thích đầu tệp.
  //
  // Điểm/tiến độ của chính bài đó VẪN được chỗ gọi ghi bình thường — người học đã
  // làm bài thật, xoá công đó đi là một sai lầm khác. Chỉ có việc CUỘN LÊN cấp
  // khoá là bị chặn.
  if (gd.status === "REVOKED") return { ghi: false, vi: "THU_HOI" };

  const cu = await db.trnLessonProgress.findUnique({
    where: {
      enrollmentId_lessonId: { enrollmentId: i.enrollmentId, lessonId: i.lessonId },
    },
    select: { verifiedAt: true },
  });
  const lanDau = cu?.verifiedAt == null;

  await db.trnLessonProgress.upsert({
    where: {
      enrollmentId_lessonId: { enrollmentId: i.enrollmentId, lessonId: i.lessonId },
    },
    update: {
      status: "DONE",
      lastActivityAt: i.now,
      // Chỉ ĐẶT MỘT LẦN: đây là mốc "lần đầu đạt", và làm lại sau đó không được
      // đẩy mốc về sau — nếu không thì một lượt thi lại vào tháng sau sẽ biến một
      // bài nộp đúng hạn thành nộp trễ.
      ...(lanDau ? { verifiedAt: i.now, completedAt: i.now } : {}),
    },
    create: {
      enrollmentId: i.enrollmentId,
      lessonId: i.lessonId,
      userId: i.userId,
      status: "DONE",
      firstStartedAt: i.now,
      lastActivityAt: i.now,
      verifiedAt: i.now,
      completedAt: i.now,
    },
  });

  // Chỉ cuộn khi VỪA xong lần đầu — cuộn mỗi lần làm lại là ba câu đếm cho một
  // việc đã xong, và một lời chúc mừng mới mỗi lần trong hộp thư người học.
  if (lanDau) await cuonKhoaSauKhiXongBai(i.enrollmentId, i.now);

  return { ghi: true, vuaXongLanDau: lanDau };
}
