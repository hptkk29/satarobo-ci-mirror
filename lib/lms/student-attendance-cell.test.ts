// Canh gác ô trạng thái điểm danh trong hồ sơ học viên — QA site GV vòng 1 (BUG-001).
import { describe, expect, it } from "vitest";

import { studentAttendanceCell } from "@/lib/lms/student-attendance-cell";

const HOM_NAY_HET = Date.UTC(2026, 7, 28, 16, 59, 59); // 23:59:59 giờ VN 28/08/2026
const HOM_QUA = Date.UTC(2026, 5, 28); // 28/06/2026 — đúng buổi QA đo
const NGAY_MAI = Date.UTC(2026, 8, 5);

const base = {
  sessionStatus: "TAUGHT",
  todayEndMs: HOM_NAY_HET,
};

describe("studentAttendanceCell", () => {
  it("buổi ĐÃ QUA mà chưa chấm ⇒ 'Chưa điểm danh', KHÔNG phải 'Chưa diễn ra'", () => {
    // Đây là chính xác ca QA đo: buổi 28/06 đã dạy, em chưa được chấm, hồ sơ in
    // "Chưa diễn ra" suốt hai tháng.
    expect(
      studentAttendanceCell({ ...base, sessionDateMs: HOM_QUA }),
    ).toEqual({ kind: "NOT_MARKED" });
  });

  it("buổi ở TƯƠNG LAI ⇒ 'Chưa diễn ra'", () => {
    expect(
      studentAttendanceCell({ ...base, sessionDateMs: NGAY_MAI }),
    ).toEqual({ kind: "NOT_YET" });
  });

  it("buổi ĐÚNG HÔM NAY vẫn là chưa diễn ra cho tới hết ngày", () => {
    expect(
      studentAttendanceCell({ ...base, sessionDateMs: HOM_NAY_HET - 1 }),
    ).toEqual({ kind: "NOT_MARKED" });
    // Ngay sau mốc hết ngày thì thuộc về tương lai.
    expect(
      studentAttendanceCell({ ...base, sessionDateMs: HOM_NAY_HET + 1 }),
    ).toEqual({ kind: "NOT_YET" });
  });

  it("đã chấm ⇒ in đúng trạng thái đã chấm", () => {
    expect(
      studentAttendanceCell({
        ...base,
        sessionDateMs: HOM_QUA,
        attendanceStatus: "PRESENT",
      }),
    ).toEqual({ kind: "MARKED", status: "PRESENT" });
  });

  it("đã chấm THẮNG mọi suy luận khác — kể cả buổi sau bị huỷ", () => {
    // Bản ghi là sự thật đã xảy ra; huỷ buổi về sau không xoá được việc em đã tới.
    expect(
      studentAttendanceCell({
        ...base,
        sessionStatus: "CANCELLED",
        sessionDateMs: HOM_QUA,
        attendanceStatus: "LATE",
      }),
    ).toEqual({ kind: "MARKED", status: "LATE" });
  });

  it("đã chấm THẮNG cả khi em sau đó nghỉ học", () => {
    expect(
      studentAttendanceCell({
        ...base,
        sessionDateMs: HOM_QUA,
        attendanceStatus: "PRESENT",
        enrollmentStatus: "WITHDREW",
      }),
    ).toEqual({ kind: "MARKED", status: "PRESENT" });
  });

  it("buổi huỷ, chưa chấm ⇒ 'Đã huỷ'", () => {
    expect(
      studentAttendanceCell({
        ...base,
        sessionStatus: "CANCELLED",
        sessionDateMs: HOM_QUA,
      }),
    ).toEqual({ kind: "CANCELLED" });
  });

  it("em đã NGHỈ HỌC, buổi quá khứ chưa chấm ⇒ 'Không áp dụng', không phải việc còn nợ", () => {
    expect(
      studentAttendanceCell({
        ...base,
        sessionDateMs: HOM_QUA,
        enrollmentStatus: "WITHDREW",
      }),
    ).toEqual({ kind: "NOT_APPLICABLE" });
  });

  it("BẢO LƯU (PAUSED) VẪN thuộc lớp ⇒ vẫn là 'Chưa điểm danh'", () => {
    // PAUSED nằm trong ENROLLMENT_ACTIVE_STATUSES — bảo lưu là tạm dừng nhưng vẫn
    // thuộc lớp. Xếp nhầm sang "Không áp dụng" là giấu mất việc còn nợ.
    expect(
      studentAttendanceCell({
        ...base,
        sessionDateMs: HOM_QUA,
        enrollmentStatus: "PAUSED",
      }),
    ).toEqual({ kind: "NOT_MARKED" });
  });

  it("không truyền enrollmentStatus ⇒ coi như còn học", () => {
    expect(
      studentAttendanceCell({ ...base, sessionDateMs: HOM_QUA, enrollmentStatus: null }),
    ).toEqual({ kind: "NOT_MARKED" });
  });
});
