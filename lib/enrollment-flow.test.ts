import { describe, it, expect } from "vitest";
import type { OrgUnitType } from "@prisma/client";
import {
  nonEnrollableCenterIds,
  notHeadOfficeWhere,
  buildStudentCourseChain,
  isHeadOfficePick,
  crossCenterError,
} from "./enrollment-flow";

// Chủ dự án chốt 04/08/2026: chỉ xếp học viên CS mình vào lớp CS mình.
describe("crossCenterError", () => {
  it("cùng cơ sở → cho phép", () => {
    expect(crossCenterError("cs1", "cs1")).toBeNull();
  });

  it("khác cơ sở → chặn", () => {
    expect(crossCenterError("cs1", "cs2")).toMatch(/cơ sở khác/);
  });

  it("[GUARD TỰ TẮT] lớp chưa gán cơ sở → chặn, KHÔNG mở toang", () => {
    // Bản cũ `if (cls.centerId && ...)` biến lớp không cơ sở thành lớp nhận mọi CS.
    expect(crossCenterError(null, "cs2")).toMatch(/Lớp chưa gán cơ sở/);
  });

  it("học viên chưa gán cơ sở → chặn kèm câu chỉ đường", () => {
    expect(crossCenterError("cs1", null)).toMatch(/Học viên chưa gán cơ sở/);
  });

  it("thiếu cả hai → vẫn chặn", () => {
    expect(crossCenterError(null, null)).not.toBeNull();
  });
});

// Chủ dự án chốt 04/08/2026: Hội sở KHÔNG nhận lead / học viên / lớp học.
describe("isHeadOfficePick", () => {
  const HO = ["hoi-so"];

  it("chọn cơ sở dạy học → hợp lệ", () => {
    expect(isHeadOfficePick("ou-cs1", "co-so-nguyen-huu-tho", HO)).toBe(false);
  });

  it("chọn thẳng Center Hội sở → chặn", () => {
    expect(isHeadOfficePick("ou-ho", "hoi-so", HO)).toBe(true);
  });

  it("[LỌT ÊM] chọn đơn vị Hội sở → centerIdForOrgUnit trả null → vẫn phải chặn", () => {
    // Đây là ca nguy hiểm nhất: KHÔNG có lỗi nào, bản ghi ra không cơ sở rồi biến mất
    // khỏi mọi màn lọc theo cơ sở. Phải nhận diện qua "có orgUnitId mà centerId null".
    expect(isHeadOfficePick("ou-ho", null, HO)).toBe(true);
  });

  it("không chọn gì (lead web chờ chia) → KHÔNG chặn", () => {
    // Lead từ form web hợp lệ khi chưa có cơ sở — bộ chia sẽ gán sau.
    expect(isHeadOfficePick(null, null, HO)).toBe(false);
  });

  it("cây OrgUnit chưa dựng → không khoá nhầm (danh sách rỗng)", () => {
    expect(isHeadOfficePick("ou-cs1", "co-so-bat-ky", [])).toBe(false);
  });
});

// FL2-05 — "cơ sở nhận học viên" = Center CÓ OrgUnit type=CENTER trỏ tới.
// Ca prod 10/07: Center(hoi-so) MỒ CÔI — không OrgUnit nào trỏ tới nó, nên bản cũ
// (đi từ OrgUnit ra, đòi type != CENTER && centerId != null) không thể thấy.
describe("nonEnrollableCenterIds", () => {
  const ou = (type: OrgUnitType, centerId: string | null, deletedAt: Date | null = null) => ({
    type,
    centerId,
    deletedAt,
  });
  const cs = (...ids: string[]) => ids.map((id) => ({ id }));

  it("[PROD 10/07] Center mồ côi (không OrgUnit nào trỏ tới) → bị loại", () => {
    const ids = nonEnrollableCenterIds(cs("c-cs1", "c-cs2", "hoi-so"), [
      ou("ROOT", null),
      ou("HO", null), // ĐÚNG như seed-orgunit.ts: HO không có centerId
      ou("CENTER", "c-cs1"),
      ou("CENTER", "c-cs2"),
    ]);
    expect(ids).toEqual(["hoi-so"]);
  });

  it("tương thích ngược: nếu ai đó nối OrgUnit(HO).centerId thì vẫn loại (type ≠ CENTER)", () => {
    const ids = nonEnrollableCenterIds(cs("c-cs1", "c-ho"), [ou("HO", "c-ho"), ou("CENTER", "c-cs1")]);
    expect(ids).toEqual(["c-ho"]);
  });

  it("mở cơ sở mới: thêm OrgUnit type=CENTER trỏ vào Center đó → tự nhận HV, không sửa code", () => {
    expect(nonEnrollableCenterIds(cs("c-cs3"), [ou("CENTER", "c-cs3")])).toEqual([]);
  });

  it("OrgUnit type=CENTER đã xoá mềm → Center của nó thành mồ côi → bị loại", () => {
    const ids = nonEnrollableCenterIds(cs("c-cs1", "c-cs2"), [
      ou("CENTER", "c-cs1"),
      ou("CENTER", "c-cs2", new Date()),
    ]);
    expect(ids).toEqual(["c-cs2"]);
  });

  it("chưa dựng cây OrgUnit ⇒ trả [] (fail-open) — không khoá sạch mọi picker", () => {
    expect(nonEnrollableCenterIds(cs("c-cs1", "c-cs2"), [ou("ROOT", null)])).toEqual([]);
    expect(nonEnrollableCenterIds(cs("c-cs1"), [])).toEqual([]);
  });
});

describe("notHeadOfficeWhere", () => {
  it("rỗng khi không có cơ sở cần loại (no-op)", () => {
    expect(notHeadOfficeWhere([])).toEqual({});
  });

  it("giữ row centerId=null, chỉ loại đúng cơ sở Hội sở", () => {
    expect(notHeadOfficeWhere(["c-ho"])).toEqual({
      OR: [{ centerId: null }, { centerId: { notIn: ["c-ho"] } }],
    });
  });
});

// FL2-06 — dây chuyền HS → khoá đang học → lớp.
describe("buildStudentCourseChain", () => {
  const e = (courseId: string, courseName: string, classId: string, name: string, classCode: string | null = null) => ({
    courseId,
    course: { name: courseName },
    classId,
    class: { name, classCode },
  });

  it("gom enrollment theo khoá, mỗi khoá liệt kê lớp đang theo", () => {
    const chain = buildStudentCourseChain([
      e("co-1", "Sata 1", "cl-1", "Lớp A", "A01"),
      e("co-1", "Sata 1", "cl-2", "Lớp B", null),
      e("co-2", "Sata 2", "cl-3", "Lớp C", "C03"),
    ]);
    expect(chain).toHaveLength(2);
    expect(chain[0]).toEqual({
      courseId: "co-1",
      courseName: "Sata 1",
      classes: [
        { classId: "cl-1", label: "Lớp A (A01)" },
        { classId: "cl-2", label: "Lớp B" },
      ],
    });
    expect(chain[1].classes).toEqual([{ classId: "cl-3", label: "Lớp C (C03)" }]);
  });

  it("khử trùng lớp trong cùng khoá", () => {
    const chain = buildStudentCourseChain([
      e("co-1", "Sata 1", "cl-1", "Lớp A"),
      e("co-1", "Sata 1", "cl-1", "Lớp A"),
    ]);
    expect(chain[0].classes).toHaveLength(1);
  });

  it("không enrollment → dây chuyền rỗng", () => {
    expect(buildStudentCourseChain([])).toEqual([]);
  });
});
