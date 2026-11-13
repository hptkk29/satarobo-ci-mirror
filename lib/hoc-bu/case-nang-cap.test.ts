// [NC-*] — kế hoạch NÂNG case đời cũ lên mô hình T07 (THUẦN). Dry-run của script in đúng kết quả của hàm này, nên nó là thứ phải đúng nhất.
import { describe, expect, it } from "vitest";
import { canNangCap, lapKeHoachNangCap, resultTuStatusCu, tang1TuTrangThaiCu, type CaseDuLieuNangCap } from "@/lib/hoc-bu/case-nang-cap-db";

const muc = (id: string, studentId: string, status: "PLACED" | "PRESENT" | "ABSENT" | "RELEASED", o: Partial<CaseDuLieuNangCap["muc"][number]> = {}) => ({
  id,
  status,
  participantId: null,
  studentId,
  missedLessonId: "b6",
  missedSessionId: `bg-${id}`,
  originalAttendanceId: `att-${id}`,
  completedAt: null,
  ...o,
});
const caseCu = (o: Partial<CaseDuLieuNangCap> = {}): CaseDuLieuNangCap => ({
  id: "c1",
  lessonId: "b6",
  baiChinhConTon: true,
  lessonIds: [],
  participants: [],
  muc: [],
  ...o,
});

describe("[NC] nâng case đời cũ", () => {
  it("[NC-01] suy tầng 1 của bé từ trạng thái cũ các mục: còn chờ ⇒ PENDING · có mặt ⇒ PRESENT · toàn vắng ⇒ ABSENT · toàn gỡ ⇒ REMOVED", () => {
    expect(tang1TuTrangThaiCu(["PLACED"])).toBe("PENDING");
    expect(tang1TuTrangThaiCu(["PLACED", "PRESENT"])).toBe("PENDING");
    expect(tang1TuTrangThaiCu(["PRESENT", "ABSENT"])).toBe("PRESENT");
    expect(tang1TuTrangThaiCu(["ABSENT"])).toBe("ABSENT");
    expect(tang1TuTrangThaiCu(["RELEASED", "RELEASED"])).toBe("REMOVED");
    expect(resultTuStatusCu("PLACED")).toBe("PLANNED");
    expect(resultTuStatusCu("PRESENT")).toBe("COMPLETED");
    expect(resultTuStatusCu("ABSENT")).toBe("RELEASED");
  });

  it("[NC-02] case đời cũ ⇒ dựng bộ bài (bài chính), bé tham gia và nối từng mục; `result` + bản gương `status` theo đúng bảng; completedAt chỉ cho mục xong", () => {
    const hoan = new Date("2026-10-02T12:00:00.000Z");
    const kh = lapKeHoachNangCap(
      caseCu({
        muc: [muc("m1", "hv1", "PLACED"), muc("m2", "hv2", "PRESENT", { completedAt: hoan }), muc("m3", "hv3", "ABSENT", { completedAt: hoan })],
      }),
    );
    expect(kh.taoBoBai).toBe(true);
    expect(kh.beMoi).toEqual([
      { studentId: "hv1", attendanceStatus: "PENDING" },
      { studentId: "hv2", attendanceStatus: "PRESENT" },
      { studentId: "hv3", attendanceStatus: "ABSENT" },
    ]);
    expect(kh.mucNoi.map((m) => [m.id, m.result, m.status, m.completedAt])).toEqual([
      ["m1", "PLANNED", "PLACED", null],
      ["m2", "COMPLETED", "PRESENT", hoan],
      ["m3", "RELEASED", "ABSENT", null], // bé vắng buổi bù: mục đã nhả, bản gương vẫn ABSENT (đúng nghĩa cũ); không mượn completedAt của dòng
    ]);
    expect(kh.mucNoi[0]).toMatchObject({ lessonId: "b6", originalSessionId: "bg-m1", originalAttendanceId: "att-m1" });
    expect(kh.batThuong).toEqual([]);
    expect(canNangCap(kh)).toBe(true);
  });

  it("[NC-03] case đã nâng đủ ⇒ không có việc; case chỉ thiếu mục nối bé ⇒ chỉ nối, KHÔNG tạo lại bộ bài / bé đã có", () => {
    expect(canNangCap(lapKeHoachNangCap(caseCu({ lessonIds: ["b6"], participants: [{ id: "p1", studentId: "hv1" }], muc: [muc("m1", "hv1", "PLACED", { participantId: "p1" })] })))).toBe(false);
    const kh = lapKeHoachNangCap(caseCu({ lessonIds: ["b6"], participants: [{ id: "p1", studentId: "hv1" }], muc: [muc("m1", "hv1", "PLACED")] }));
    expect(kh.taoBoBai).toBe(false);
    expect(kh.beMoi).toEqual([]);
    expect(kh.mucNoi.map((m) => m.id)).toEqual(["m1"]);
  });

  it("[NC-04] mục có bài NGOÀI bộ bài ⇒ BÁO LECH_BAI chứ không tự thêm bài vào case; bài chính không còn ⇒ BAI_KHONG_TON_TAI và không dựng bộ bài", () => {
    const lech = lapKeHoachNangCap(caseCu({ muc: [muc("m1", "hv1", "PLACED"), muc("m2", "hv2", "PLACED", { missedLessonId: "b7" })] }));
    expect(lech.batThuong).toEqual([{ loai: "LECH_BAI", id: "m2", chiTiet: expect.stringContaining("b7") }]);
    expect(lech.mucNoi.find((m) => m.id === "m2")?.lessonId).toBe("b7"); // chụp ĐÚNG bài bé thực vắng, không sửa cho khớp case
    const mat = lapKeHoachNangCap(caseCu({ baiChinhConTon: false, muc: [muc("m1", "hv1", "PLACED")] }));
    expect(mat.taoBoBai).toBe(false);
    expect(mat.batThuong.map((b) => b.loai)).toContain("BAI_KHONG_TON_TAI");
    // Mục không có bài (null) không bị coi là lệch.
    expect(lapKeHoachNangCap(caseCu({ muc: [muc("m1", "hv1", "PLACED", { missedLessonId: null })] })).batThuong).toEqual([]);
  });

  it("[NC-05] một bé nhiều mục ⇒ MỘT bé tham gia; tầng 1 tính trên mọi mục của bé", () => {
    const kh = lapKeHoachNangCap(caseCu({ muc: [muc("m1", "hv1", "PRESENT"), muc("m2", "hv1", "PLACED")] }));
    expect(kh.beMoi).toEqual([{ studentId: "hv1", attendanceStatus: "PENDING" }]);
    expect(kh.mucNoi).toHaveLength(2);
  });
});
