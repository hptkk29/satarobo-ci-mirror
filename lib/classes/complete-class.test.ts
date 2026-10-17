import { describe, it, expect } from "vitest";
import type { EnrollmentStatus } from "@prisma/client";
import { canTransition } from "@/lib/enrollments/status";
import {
  COMPLETABLE_ENROLLMENT_STATUSES,
  CLASS_CLOSE_ENROLLMENT_STATUSES,
  splitEnrollmentsForCompletion,
  describeSkipped,
} from "./complete-class";

const row = (id: string, status: EnrollmentStatus) => ({ id, status });

describe("[CLC] chia ghi danh khi hoàn thành lớp", () => {
  it("[CLC-01] chỉ STUDYING/ACTIVE được hoàn thành; giữ nguyên thứ tự", () => {
    const { eligible } = splitEnrollmentsForCompletion([
      row("a", "STUDYING"),
      row("b", "PAUSED"),
      row("c", "ACTIVE"),
      row("d", "CONFIRMED"),
    ]);
    expect(eligible.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("[CLC-02] gộp nhóm bỏ qua theo trạng thái, có nhãn tiếng Việt", () => {
    const { skipped } = splitEnrollmentsForCompletion([
      row("a", "PAUSED"),
      row("b", "CONFIRMED"),
      row("c", "PAUSED"),
      row("d", "STUDYING"),
    ]);
    expect(skipped).toEqual([
      { status: "PAUSED", label: "đang bảo lưu", count: 2 },
      { status: "CONFIRMED", label: "đã xếp lớp, chưa vào học", count: 1 },
    ]);
    expect(describeSkipped(skipped)).toBe("2 em đang bảo lưu, 1 em đã xếp lớp, chưa vào học");
  });

  it("[CLC-03] lớp không còn ai đang học → eligible rỗng, không ném", () => {
    const res = splitEnrollmentsForCompletion([]);
    expect(res.eligible).toEqual([]);
    expect(res.skipped).toEqual([]);
    expect(describeSkipped(res.skipped)).toBe("");
  });

  // ⚠️ Ca GIỮ HAI FILE KHỚP NHAU. `completeClassAction` lọc theo
  // COMPLETABLE_ENROLLMENT_STATUSES rồi mới gọi `canTransition(status,"COMPLETED")`.
  // Thêm một trạng thái vào danh sách mà state machine không cho đi (PAUSED là ca
  // sát nhất) thì `canTransition` `continue` IM LẶNG: người bấm nhận "đã hoàn thành
  // N em" trong khi DB đổi ít hơn, và không lỗi nào báo. Ca này đỏ ngay tại chỗ.
  it("[CLC-04] mọi trạng thái trong COMPLETABLE đều đi được sang COMPLETED", () => {
    for (const s of COMPLETABLE_ENROLLMENT_STATUSES) {
      expect(canTransition(s, "COMPLETED"), `${s} → COMPLETED`).toBe(true);
    }
  });

  it("[CLC-05] COMPLETABLE là tập con của tập 'còn thuộc lớp'", () => {
    for (const s of COMPLETABLE_ENROLLMENT_STATUSES) {
      expect(CLASS_CLOSE_ENROLLMENT_STATUSES).toContain(s);
    }
  });
});
