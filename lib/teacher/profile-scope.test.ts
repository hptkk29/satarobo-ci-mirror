// Canh gác phạm vi hồ sơ học viên — QA site GV vòng 1 (BUG-003).
import { describe, expect, it } from "vitest";

import {
  profileTabHref,
  resolveProfileScope,
  type ProfileClassRef,
} from "@/lib/teacher/profile-scope";

// Đặng Công Trí: 5 ghi danh, 4 lớp, 4 khoá — đúng ca QA đo.
const ENR: ProfileClassRef[] = [
  { classId: "c06", className: "T7 sáng", courseName: "Lập trình Robot" },
  { classId: "c09", className: "T7 sáng", courseName: "Luyện thi Robosim" },
  { classId: "c22", className: "Cảm biến & điều khiển", courseName: "Sata 3" },
  { classId: "c15", className: "CN sáng", courseName: "Lập trình Robot" },
  // Ghi danh THỨ HAI cùng lớp c06 (học lại) — chip vẫn phải là một.
  { classId: "c06", className: "T7 sáng", courseName: "Lập trình Robot" },
];

describe("resolveProfileScope", () => {
  it("không có classId ⇒ xem tất cả, đủ 4 lớp", () => {
    const s = resolveProfileScope(ENR, null);
    expect(s.activeClassId).toBe(null);
    expect(s.classIds).toHaveLength(4);
    expect(s.rejected).toBe(false);
  });

  it("classId hợp lệ ⇒ thu về đúng một lớp", () => {
    const s = resolveProfileScope(ENR, "c15");
    expect(s.activeClassId).toBe("c15");
    expect(s.classIds).toEqual(["c15"]);
    expect(s.rejected).toBe(false);
  });

  it("CHỐT IDOR: classId em không ghi danh ⇒ hạ về xem tất cả, KHÔNG dùng id lạ", () => {
    const s = resolveProfileScope(ENR, "lop-cua-nguoi-khac");
    expect(s.activeClassId).toBe(null);
    expect(s.rejected).toBe(true);
    expect(s.classIds).not.toContain("lop-cua-nguoi-khac");
  });

  it("chuỗi rỗng / khoảng trắng coi như không truyền", () => {
    expect(resolveProfileScope(ENR, "   ").activeClassId).toBe(null);
    expect(resolveProfileScope(ENR, "   ").rejected).toBe(false);
  });

  it("hai ghi danh cùng một lớp ⇒ MỘT chip", () => {
    const chips = resolveProfileScope(ENR, null).chips;
    expect(chips.filter((c) => c.classId === "c06")).toHaveLength(1);
    expect(chips).toHaveLength(4);
  });

  it("đảo thứ tự đầu vào ⇒ dãy chip GIỐNG HỆT", () => {
    const a = resolveProfileScope(ENR, null).chips.map((c) => c.classId);
    const b = resolveProfileScope([...ENR].reverse(), null).chips.map((c) => c.classId);
    expect(b).toEqual(a);
  });

  it("hai lớp TRÙNG TÊN khác id vẫn tất định và vẫn là hai chip", () => {
    // `Class.name` không unique trong schema — khử trùng theo tên là gộp nhầm.
    const trungTen: ProfileClassRef[] = [
      { classId: "z2", className: "T7 sáng", courseName: "Sata 1" },
      { classId: "z1", className: "T7 sáng", courseName: "Sata 1" },
    ];
    const a = resolveProfileScope(trungTen, null).chips.map((c) => c.classId);
    const b = resolveProfileScope([...trungTen].reverse(), null).chips.map((c) => c.classId);
    expect(a).toEqual(["z1", "z2"]);
    expect(b).toEqual(a);
  });

  it("không ghi danh nào ⇒ rỗng, không ném lỗi", () => {
    const s = resolveProfileScope([], "c06");
    expect(s.chips).toEqual([]);
    expect(s.classIds).toEqual([]);
    expect(s.rejected).toBe(true);
  });
});

describe("profileTabHref", () => {
  it("mang theo classId khi đang lọc — đổi tab không mất ngữ cảnh", () => {
    const href = profileTabHref({ studentId: "s1", tab: "nhan-xet", activeClassId: "c15" });
    expect(href).toContain("classId=c15");
    expect(href).toContain("ptab=nhan-xet");
    expect(href).toContain("s=s1");
  });

  it("không có lớp đang chọn ⇒ KHÔNG thêm classId rỗng vào URL", () => {
    const href = profileTabHref({ studentId: "s1", tab: "diem-danh", activeClassId: null });
    expect(href).not.toContain("classId");
  });
});
