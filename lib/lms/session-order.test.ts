// Khoá 2 luật của lib/lms/session-order (yêu cầu 21/08):
//   R1 "buổi thứ mấy"  — hạng theo NGÀY trong TỪNG lớp, tính trên TOÀN BỘ buổi.
//   R2 thứ tự hiển thị — buổi đã xong cả 3 việc lùi xuống sau buổi còn nợ / chưa tới.
// Hai luật này trước 21/08 không có test nào bám: sort nằm rải ở `orderBy` của 4 query
// và số buổi thì chưa tồn tại, nên CI xanh không chứng minh được gì.
import { describe, it, expect } from "vitest";
import {
  attendanceCoversRoster,
  buildSessionMediaCoverage,
  buildSessionNumberMap,
  mediaCoversAttendees,
  compareSessionWorkOrder,
  isSessionWorkComplete,
  nhanTrangThaiBuoi,
  sessionNumberLabel,
  sortSessionsForWork,
} from "./session-order";

const d = (iso: string) => new Date(iso);

describe("buildSessionNumberMap — buổi thứ mấy", () => {
  it("đánh số 1-based theo ngày tăng dần, KHÔNG theo thứ tự mảng đầu vào", () => {
    // Cố tình đưa vào theo `date desc` — đúng thứ tự mà mọi query hiện tại đang trả về.
    const map = buildSessionNumberMap([
      { id: "c", date: d("2026-08-17T01:00:00Z") },
      { id: "a", date: d("2026-08-03T01:00:00Z") },
      { id: "b", date: d("2026-08-10T01:00:00Z") },
    ]);
    expect([...map.entries()].sort()).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("đánh số ĐỘC LẬP theo từng lớp", () => {
    const map = buildSessionNumberMap([
      { id: "l1-s1", classId: "l1", date: d("2026-08-03T01:00:00Z") },
      { id: "l2-s1", classId: "l2", date: d("2026-08-04T01:00:00Z") },
      { id: "l1-s2", classId: "l1", date: d("2026-08-10T01:00:00Z") },
      { id: "l2-s2", classId: "l2", date: d("2026-08-11T01:00:00Z") },
    ]);
    expect(map.get("l1-s1")).toBe(1);
    expect(map.get("l1-s2")).toBe(2);
    expect(map.get("l2-s1")).toBe(1);
    expect(map.get("l2-s2")).toBe(2);
  });

  it("hai buổi TRÙNG ngày ra số ổn định (tie-break theo id), không đảo giữa các lần render", () => {
    const rows = [
      { id: "zz", date: d("2026-08-03T01:00:00Z") },
      { id: "aa", date: d("2026-08-03T01:00:00Z") },
    ];
    expect(buildSessionNumberMap(rows).get("aa")).toBe(1);
    expect(buildSessionNumberMap([...rows].reverse()).get("aa")).toBe(1);
  });

  it("nhận cả chuỗi ISO lẫn Date; ngày hỏng không làm vỡ bảng tra", () => {
    const map = buildSessionNumberMap([
      { id: "b", date: "2026-08-10T01:00:00Z" },
      { id: "a", date: "khong-phai-ngay" },
    ]);
    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(1); // ngày hỏng quy về 0 → đứng đầu, KHÔNG bị rơi khỏi map
  });

  it("số tính trên CỬA SỔ đã cắt sẽ SAI — đây là lý do caller phải nạp đủ buổi của lớp", () => {
    const all = [
      { id: "s1", date: d("2026-08-03T01:00:00Z") },
      { id: "s2", date: d("2026-08-10T01:00:00Z") },
      { id: "s3", date: d("2026-08-17T01:00:00Z") },
    ];
    expect(buildSessionNumberMap(all).get("s3")).toBe(3);
    // Cùng buổi đó, nếu dựng map từ 2 dòng gần nhất (kiểu `take: N`) thì thành "Buổi 2".
    expect(buildSessionNumberMap(all.slice(1)).get("s3")).toBe(2);
  });
});

describe("sessionNumberLabel", () => {
  it("có số → 'Buổi N'; không tra được → '—'", () => {
    expect(sessionNumberLabel(7)).toBe("Buổi 7");
    expect(sessionNumberLabel(null)).toBe("—");
    expect(sessionNumberLabel(undefined)).toBe("—");
    expect(sessionNumberLabel(0)).toBe("—");
  });
});

describe("isSessionWorkComplete — đủ CẢ BA việc mới là xong", () => {
  const base = { attendanceDone: true, feedbackDone: true, photoDone: true };
  it("đủ ba → true", () => {
    expect(isSessionWorkComplete(base)).toBe(true);
  });
  it("thiếu bất kỳ việc nào → false", () => {
    expect(isSessionWorkComplete({ ...base, attendanceDone: false })).toBe(false);
    expect(isSessionWorkComplete({ ...base, feedbackDone: false })).toBe(false);
    expect(isSessionWorkComplete({ ...base, photoDone: false })).toBe(false);
  });
});

describe("compareSessionWorkOrder / sortSessionsForWork — việc còn nợ lên trước", () => {
  it("buổi đã hoàn thành lùi xuống SAU buổi chưa hoàn thành", () => {
    expect(
      compareSessionWorkOrder({ number: 1, complete: true }, { number: 9, complete: false }),
    ).toBeGreaterThan(0);
  });

  it("trong cùng nhóm: số buổi TĂNG dần", () => {
    expect(
      compareSessionWorkOrder({ number: 2, complete: false }, { number: 5, complete: false }),
    ).toBeLessThan(0);
  });

  it("buổi chưa tra được số xếp cuối nhóm của nó", () => {
    expect(
      compareSessionWorkOrder({ number: null, complete: false }, { number: 99, complete: false }),
    ).toBeGreaterThan(0);
  });

  it("sắp cả mảng: chưa xong (1,2,3) rồi mới tới đã xong (1,2) — không sửa mảng gốc", () => {
    const rows = [
      { id: "b1-xong", no: 1, done: true },
      { id: "b3", no: 3, done: false },
      { id: "b2-xong", no: 2, done: true },
      { id: "b5", no: 5, done: false },
    ];
    const goc = [...rows];
    const out = sortSessionsForWork(rows, (r) => ({ number: r.no, complete: r.done }));
    expect(out.map((r) => r.id)).toEqual(["b3", "b5", "b1-xong", "b2-xong"]);
    expect(rows).toEqual(goc);
  });

  it("buổi TƯƠNG LAI (chưa tới, chưa xong việc) nằm TRÊN buổi cũ đã xong — đúng yêu cầu 21/08", () => {
    const out = sortSessionsForWork(
      [
        { id: "buoi-2-da-xong", no: 2, done: true },
        { id: "buoi-12-sap-toi", no: 12, done: false },
      ],
      (r) => ({ number: r.no, complete: r.done }),
    );
    expect(out[0].id).toBe("buoi-12-sap-toi");
  });
});

describe("attendanceCoversRoster — điểm danh đã phủ hết sĩ số chưa", () => {
  it("mọi HV trong sĩ số đều có bản ghi → true", () => {
    expect(attendanceCoversRoster(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("thiếu 1 HV → false, dù TỔNG số bản ghi đủ nhờ học viên HỌC BÙ", () => {
    // 2 bản ghi / sĩ số 2, nhưng "b" chưa được chấm còn "x" là HV lớp khác học bù.
    expect(attendanceCoversRoster(["a", "x"], ["a", "b"])).toBe(false);
  });

  it("HV học bù dôi ra KHÔNG làm sai kết quả", () => {
    expect(attendanceCoversRoster(["a", "b", "x"], ["a", "b"])).toBe(true);
  });

  it("sĩ số rỗng → false (lớp chưa có ai thì không có gì để gọi là điểm danh xong)", () => {
    expect(attendanceCoversRoster(["a"], [])).toBe(false);
    expect(attendanceCoversRoster([], [])).toBe(false);
  });

  it("chưa chấm ai → false", () => {
    expect(attendanceCoversRoster([], ["a", "b"])).toBe(false);
  });

  it("nhận Set lẫn mảng", () => {
    expect(attendanceCoversRoster(new Set(["a", "b"]), new Set(["a"]))).toBe(true);
  });
});

describe("mediaCoversAttendees — ảnh/video phủ hết học viên đi học chưa", () => {
  const A = ["a", "b"];
  it("mỗi em đi học đều có ảnh gắn thẻ → true", () => {
    expect(
      mediaCoversAttendees({ attendedStudentIds: A, taggedStudentIds: A, hasClassWide: false }),
    ).toBe(true);
  });

  it("buổi CÓ ảnh nhưng chỉ chụp 1 em → false (đây là điểm khác luật cũ)", () => {
    expect(
      mediaCoversAttendees({ attendedStudentIds: A, taggedStudentIds: ["a"], hasClassWide: false }),
    ).toBe(false);
  });

  it("ảnh CHUNG CẢ LỚP tính cho mọi em → true dù không gắn thẻ ai", () => {
    expect(
      mediaCoversAttendees({ attendedStudentIds: A, taggedStudentIds: [], hasClassWide: true }),
    ).toBe(true);
  });

  it("em VẮNG không nằm trong attendedStudentIds nên không kéo kết quả xuống", () => {
    // "c" vắng, không cần ảnh — chỉ a,b được truyền vào.
    expect(
      mediaCoversAttendees({ attendedStudentIds: A, taggedStudentIds: ["a", "b"], hasClassWide: false }),
    ).toBe(true);
  });

  it("chưa ai đi học (chưa điểm danh / cả lớp vắng) → false", () => {
    expect(
      mediaCoversAttendees({ attendedStudentIds: [], taggedStudentIds: ["a"], hasClassWide: true }),
    ).toBe(false);
  });
});

describe("buildSessionMediaCoverage", () => {
  it("gom thẻ học viên + cờ ảnh cả lớp theo từng buổi", () => {
    const m = buildSessionMediaCoverage([
      { classSessionId: "s1", isClassWide: false, tags: [{ studentId: "a" }] },
      { classSessionId: "s1", isClassWide: false, tags: [{ studentId: "b" }] },
      { classSessionId: "s2", isClassWide: true, tags: [] },
    ]);
    expect([...(m.get("s1")?.tagged ?? [])].sort()).toEqual(["a", "b"]);
    expect(m.get("s1")?.classWide).toBe(false);
    expect(m.get("s2")?.classWide).toBe(true);
  });

  it("ảnh KHÔNG gắn buổi bị bỏ qua — không quy được về buổi nào", () => {
    const m = buildSessionMediaCoverage([
      { classSessionId: null, isClassWide: true, tags: [{ studentId: "a" }] },
    ]);
    expect(m.size).toBe(0);
  });
});

// ── D0 (07/09/2026) — nhãn trạng thái buổi phải ĐỌC status, không suy ra ────────
//
// Bug đang khoá: tab Điểm danh in nhãn xanh "Hoàn tất" ngay khi xong ba việc, trong
// khi `ClassSession.status` vẫn SCHEDULED. Đo trên prod: 2 COMPLETED / 287 SCHEDULED
// trong 4 tháng — giáo viên không quên bấm, màn hình đã nói với họ là xong.
describe("nhanTrangThaiBuoi — nguồn nhãn là status, ba việc chỉ là mức sẵn sàng", () => {
  it("ĐỦ BA VIỆC mà status còn SCHEDULED thì KHÔNG BAO GIỜ là 'đã dạy'", () => {
    const n = nhanTrangThaiBuoi({ status: "SCHEDULED", daQuaNgay: true, workDone: true });
    expect(n.loai).toBe("chua-chot");
    // Đây là dòng chặn bug D0. Nó đỏ nghĩa là nhãn suy-ra đã quay lại.
    expect(n.loai).not.toBe("da-day");
    expect(n).toEqual({ loai: "chua-chot", sanSangChot: true });
  });

  it("IN_PROGRESS đã qua ngày cũng là chưa chốt — không phải riêng SCHEDULED", () => {
    expect(nhanTrangThaiBuoi({ status: "IN_PROGRESS", daQuaNgay: true, workDone: true })).toEqual({
      loai: "chua-chot",
      sanSangChot: true,
    });
  });

  it("thiếu việc thì vẫn chưa chốt, nhưng KHÔNG sẵn sàng", () => {
    expect(nhanTrangThaiBuoi({ status: "SCHEDULED", daQuaNgay: true, workDone: false })).toEqual({
      loai: "chua-chot",
      sanSangChot: false,
    });
  });

  it("chỉ COMPLETED mới là 'đã dạy' — kể cả khi ba việc chưa xong", () => {
    expect(nhanTrangThaiBuoi({ status: "COMPLETED", daQuaNgay: true, workDone: false })).toEqual({
      loai: "da-day",
    });
  });

  it("CANCELLED thắng mọi thứ khác", () => {
    expect(nhanTrangThaiBuoi({ status: "CANCELLED", daQuaNgay: true, workDone: true })).toEqual({
      loai: "da-huy",
    });
  });

  it("buổi TƯƠNG LAI còn SCHEDULED là bình thường, không phải việc còn nợ", () => {
    expect(nhanTrangThaiBuoi({ status: "SCHEDULED", daQuaNgay: false, workDone: false })).toEqual({
      loai: "chua-toi-gio",
    });
  });

  it("buổi tương lai đã huỷ vẫn là 'đã huỷ', không rơi về 'chưa tới giờ'", () => {
    expect(nhanTrangThaiBuoi({ status: "CANCELLED", daQuaNgay: false, workDone: false })).toEqual({
      loai: "da-huy",
    });
  });
});
