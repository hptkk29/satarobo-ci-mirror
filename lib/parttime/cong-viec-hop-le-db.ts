// lib/parttime/cong-viec-hop-le-db.ts — ĐỌC tập cơ sở có việc Parttime HỢP LỆ của một người trong một ngày (H1). Chỉ đọc.
//
// Hai nơi gọi, CÙNG một hàm (lưới `[H1-W*]`):
//   · `recordTimeLog` (lượt quét) — chỉ khi KHÔNG có ô ca và KHÔNG có đơn phủ lịch (đường hiếm), để quyết cờ `CHAM_NGOAI_LICH`;
//   · `recomputeAttendanceDay` (bảng công ngày) — chỉ khi ngày có lượt mà không có ô ca làm việc, để engine không gắn lại cờ.
// Tiết đọc qua `docBangChungCuaToi` (P4 — đã nhận đúng phiên bản? buổi huỷ / đóng?) — KHÔNG dựng lại định nghĩa.
//
// Công tắc `shift.phanCongNhanLopBat` TẮT ⇒ tập rỗng, không câu tra nào chạm bảng Parttime. Lỗi bất kỳ ⇒ tập rỗng (= luật cũ: cờ vẫn
// gắn như trước) — không bao giờ làm hỏng một lượt chấm công hay một lần tính lại.
import "server-only";
import { db } from "@/lib/db";
import { docBangChungCuaToi } from "./bang-chung-cong-db";
import { chinhSachTaiNgay } from "./chinh-sach";
import { tietHopLe, trucHopLe } from "./cong-viec-hop-le";
import { docChinhSach, phanCongBat } from "./phan-cong-db";

/** `workDate` = ngày VN (nửa đêm UTC, như `vnDateOnly`). */
export async function coSoCoViecParttime(p: { userId: string; workDate: Date; now: Date }): Promise<Set<string>> {
  if (!(await phanCongBat())) return new Set();
  const ymd = p.workDate.toISOString().slice(0, 10);
  const cs = chinhSachTaiNgay(await docChinhSach(), ymd);
  if (!cs || cs.thamSo.loai !== "SR_QD_238") return new Set();
  const [tiet, truc] = await Promise.all([
    docBangChungCuaToi({ userId: p.userId, tu: ymd, den: ymd, now: p.now }),
    db.operationsDutyAssignment.findMany({
      where: { userId: p.userId, workDate: p.workDate },
      select: { centerId: true, status: true, assignmentVersion: true, acceptances: { select: { assignmentVersion: true, decision: true } } },
    }),
  ]);
  return new Set([...tiet.filter(tietHopLe).map((r) => r.centerId), ...truc.filter(trucHopLe).map((t) => t.centerId)]);
}
