import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { cuonTienDoKhoa } from "@/lib/elearning/course-completion";

/**
 * EL-06 — CUỘN TIẾN ĐỘ BÀI LÊN CẤP KHOÁ, gọi sau mỗi lần một bài được chốt xong.
 *
 * ⚠️ Gọi ở đường GHI, không tính lại lúc ĐỌC. Tính lúc đọc thì hai màn hình khác
 * nhau có thể ra hai con số khác nhau, và không có mốc nào để nói "hoàn thành lúc
 * mấy giờ" — mà chính mốc đó là thứ báo cáo tuân thủ đứng lên.
 *
 * ⚠️ Hàm này KHÔNG ném lỗi ra ngoài. Nó chạy sau khi tiến độ bài đã ghi xong; để
 * nó làm hỏng lời gọi là biến một việc phụ thành lý do người học mất tiến độ vừa
 * học. Lỗi ghi log và đi tiếp — lần chốt bài kế tiếp sẽ cuộn lại.
 */
export async function cuonKhoaSauKhiXongBai(
  enrollmentId: string,
  now: Date,
): Promise<{ status: string; vuaHoanThanh: boolean } | null> {
  try {
    const e = await db.trnEnrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        id: true,
        courseId: true,
        status: true,
        dueAtOriginal: true,
        progressPercent: true,
        // ⚠️ PHẢI đọc. Đây là vế THỨ HAI của phép bù SLA — phần miễn trừ vì NGƯỜI
        // CHẤM trễ. Ghi mà không đọc thì cả phép bù chỉ nới được hạn nộp, còn
        // người bị bỏ quên năm ngày vẫn bị đếm là TRỄ trên báo cáo tuân thủ gửi
        // thẳng quản lý trực tiếp, CÓ GHI TÊN. Kế hoạch §9.3 luật 2 gọi đúng tên:
        // "thiếu (b) thì (a) vô nghĩa".
        slaGraceDays: true,
      },
    });
    if (!e) return null;

    // ⚠️ Cờ "bài bắt buộc" nằm trên `TrnCourseVersionLesson.required` — tức trên
    // BẢN CHỐT PHIÊN BẢN của khoá, không trên chính bài. Đó là thiết kế đúng
    // (BR-013: mỗi phiên bản ghim tập bài của nó), nhưng nó nghĩa là phép đếm
    // phải đi qua phiên bản mà lượt giao đã ghim.
    const versionId = await versionCuaLuot(e.id);

    const soBaiBatBuoc = versionId
      ? await db.trnCourseVersionLesson.count({
          where: { versionId, required: true, lesson: { deletedAt: null } },
        })
      : // Chưa ghim phiên bản (khoá chưa xuất bản bản nào — hiện trạng ở GĐ1):
        // coi MỌI bài còn sống của khoá là bắt buộc. Đây là phía CHẶT: đếm ít
        // hơn thực tế sẽ cho người ta "hoàn thành" khi chưa học hết.
        await db.trnLesson.count({
          where: { deletedAt: null, module: { courseId: e.courseId } },
        });

    const soBaiDaXong = await db.trnLessonProgress.count({
      where: {
        enrollmentId: e.id,
        status: "DONE",
        lesson: {
          deletedAt: null,
          ...(versionId
            ? { versionLessons: { some: { versionId, required: true } } }
            : {}),
        },
      },
    });

    const r = cuonTienDoKhoa({
      soBaiBatBuoc,
      soBaiDaXong,
      statusHienTai: e.status,
      dueAtOriginal: e.dueAtOriginal,
      slaGraceDays: e.slaGraceDays,
      now,
    });

    const doi =
      r.status !== e.status || r.progressPercent !== e.progressPercent || r.vuaHoanThanh;
    if (!doi) return { status: r.status, vuaHoanThanh: false };

    await db.trnEnrollment.update({
      where: { id: e.id },
      data: {
        status: r.status,
        progressPercent: r.progressPercent,
        isLate: r.isLate,
        lastActivityAt: now,
        // `completedAt` đặt MỘT LẦN, đúng lần đầu đạt.
        ...(r.vuaHoanThanh ? { completedAt: now } : {}),
      },
    });

    if (r.vuaHoanThanh) {
      await publishEvent(
        "elearning.enrollment.completed",
        { enrollmentId: e.id, status: r.status },
        { dedupeKey: `el.done:${e.id}` },
      );
    }

    return { status: r.status, vuaHoanThanh: r.vuaHoanThanh };
  } catch (err) {
    console.warn("[elearning] cuộn tiến độ khoá thất bại", enrollmentId, err);
    return null;
  }
}

/**
 * Phiên bản khoá mà lượt ghi danh này ghim.
 *
 * `TrnEnrollment` không mang cột phiên bản; nó đi qua lượt giao. Cả
 * `assignmentId` lẫn `courseVersionId` đều nullable (lượt ghi danh có thể sinh
 * từ công nhận tương đương hay yêu cầu vị trí), nên `null` ở đây là chuyện bình
 * thường chứ không phải lỗi.
 */
async function versionCuaLuot(enrollmentId: string): Promise<string | null> {
  const e = await db.trnEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { assignment: { select: { courseVersionId: true } } },
  });
  return e?.assignment?.courseVersionId ?? null;
}
