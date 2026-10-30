// E-01 (OQ-5) — "giáo viên phụ trách" của MỘT buổi. Test viết TRƯỚC (luật cứng #5).
//
// Vì sao phải có helper + test cho một phép `??` ba tầng: repo đang có **4 thứ tự khác
// nhau** cho đúng câu hỏi này (đo 24/08) —
//   • `lib/lms/schedule-conflict.ts:109`      substitute ?? actual ?? class
//   • `lib/students/birthday-notify.ts:102`   substitute ?? actual ?? class
//   • `lib/lms/session-teacher-notify.ts:120` actual ?? substitute ?? class
//   • `lib/_handlers/r7-lifecycle.ts:62`,
//     `bao-cao/hieu-suat-gv/page.tsx:285`     actual ?? class   ← BỎ QUA dạy thay
// Cột "giáo viên phụ trách" của E-01 mà tự viết lại là repo có thứ tự THỨ NĂM, và con số
// của E-01 sẽ không khớp báo cáo hiệu suất GV. Chốt kỹ thuật 24/08: bản của
// `schedule-conflict` — người THẬT SỰ đứng lớp mới chịu trách nhiệm buổi đó.
//
// ⚠️ File này KHÔNG chuyển 4 chỗ cũ sang helper — đó là ticket riêng (đổi chúng làm số
// báo cáo hiệu suất GV nhảy, phải báo trước). Ở đây chỉ khoá thứ tự cho người dùng MỚI.
import { describe, it, expect } from "vitest";
import {
  resolveSessionTeacher,
  resolveSessionTeacherId,
} from "@/lib/lms/session-teacher";

describe("[E-01][OQ-5] thứ tự suy giáo viên phụ trách", () => {
  it("dạy thay THẮNG cả giáo viên thực tế lẫn giáo viên của lớp", () => {
    const r = resolveSessionTeacher({
      substituteTeacherId: "gv-thay",
      actualTeacherId: "gv-thuc-te",
      classTeacherId: "gv-lop",
    });
    expect(r).toEqual({ teacherId: "gv-thay", source: "SUBSTITUTE" });
  });

  it("không có dạy thay → giáo viên THỰC TẾ (người đã chốt buổi)", () => {
    const r = resolveSessionTeacher({
      substituteTeacherId: null,
      actualTeacherId: "gv-thuc-te",
      classTeacherId: "gv-lop",
    });
    expect(r).toEqual({ teacherId: "gv-thuc-te", source: "ACTUAL" });
  });

  it("buổi chưa diễn ra (chưa có ai chốt) → giáo viên CHÍNH của lớp", () => {
    const r = resolveSessionTeacher({ classTeacherId: "gv-lop" });
    expect(r).toEqual({ teacherId: "gv-lop", source: "CLASS" });
  });

  it("lớp chưa phân công giáo viên → null + nguồn NONE (không ném lỗi)", () => {
    expect(resolveSessionTeacher({})).toEqual({ teacherId: null, source: "NONE" });
    expect(
      resolveSessionTeacher({
        substituteTeacherId: null,
        actualTeacherId: null,
        classTeacherId: null,
      }),
    ).toEqual({ teacherId: null, source: "NONE" });
  });

  it("chuỗi RỖNG / toàn khoảng trắng KHÔNG được coi là đã phân công", () => {
    // `?? ` chỉ bắt null/undefined — "" lọt qua và biến thành một teacherId không tra
    // được tên, cột GV hiện trống mà không ai biết vì sao. Chặn ngay ở helper.
    const r = resolveSessionTeacher({
      substituteTeacherId: "",
      actualTeacherId: "   ",
      classTeacherId: "gv-lop",
    });
    expect(r).toEqual({ teacherId: "gv-lop", source: "CLASS" });
  });

  it("đọc được cả hình dạng lồng `class: { teacherId }` của Prisma", () => {
    const r = resolveSessionTeacher({
      actualTeacherId: null,
      class: { teacherId: "gv-lop" },
    });
    expect(r).toEqual({ teacherId: "gv-lop", source: "CLASS" });
  });

  it("`classTeacherId` tường minh thắng nhánh lồng khi cả hai cùng có", () => {
    const r = resolveSessionTeacher({
      classTeacherId: "gv-a",
      class: { teacherId: "gv-b" },
    });
    expect(r.teacherId).toBe("gv-a");
  });

  it("resolveSessionTeacherId là lối tắt của cùng một thứ tự", () => {
    expect(
      resolveSessionTeacherId({ substituteTeacherId: "x", classTeacherId: "y" }),
    ).toBe("x");
    expect(resolveSessionTeacherId({})).toBe(null);
  });
});
