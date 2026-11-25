// @vitest-environment node
/**
 * EL-05 — BỘ LỌC TẬP NGƯỜI HỌC (§10.2, sáu luật cứng).
 *
 * Đây là nơi một lỗi im lặng đắt nhất toàn module: bộ lọc sai không văng lỗi, nó
 * chỉ giao bài cho SAI NGƯỜI — hoặc bỏ sót người phải học. Ở quy mô 15 nhân sự,
 * cả hai chiều đều không ai nhận ra bằng mắt.
 *
 * Nên gần như mọi case dưới đây kiểm ĐÚNG MỘT THỨ: khi luật thiếu thông tin thì
 * tập người học phải HẸP LẠI hoặc BÁO, không bao giờ được NỞ RA.
 */
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  CHUA_KHAI,
  khopChucDanh,
  luatToWhere,
  cacLuatToWhere,
  chieuLocThieuNen,
  LoiLuatLoc,
} from "@/lib/elearning/assignment-rule";

const MOC = new Date("2026-08-23T00:00:00.000Z");

describe("luật 2 — trạng thái làm việc mặc định CHỈ `ACTIVE`", () => {
  it("luật không nói gì về trạng thái ⇒ vẫn ép `ACTIVE`", () => {
    // Bỏ qua mặc định này nghĩa là người đã nghỉ việc vẫn nhận bài bắt buộc, vẫn
    // vào tử số/mẫu số báo cáo. Prod hiện 15/15 ACTIVE nên KHÔNG có gì báo động
    // khi làm sai — đúng thứ chỉ test giữ được.
    const w = luatToWhere({}, { mode: "STATIC", now: MOC });
    expect(w.status).toEqual({ in: ["ACTIVE"] });
  });

  it("khai rõ trạng thái thì theo người dùng, không cộng thêm mặc định", () => {
    const w = luatToWhere(
      { employmentStatus: ["ACTIVE", "ON_LEAVE"] },
      { mode: "STATIC", now: MOC },
    );
    expect(w.status).toEqual({ in: ["ACTIVE", "ON_LEAVE"] });
  });
});

describe("luật 4 — `Chưa khai` loại hợp đồng là GIÁ TRỊ THẬT", () => {
  it("chọn `CHUA_KHAI` ⇒ where bắt cả bản ghi NULL", () => {
    // Prod: FULLTIME 9 · PARTTIME 3 · chưa khai 3. Không có nhánh NULL thì 3
    // người đó vô hình với MỌI luật lọc loại hợp đồng.
    const w = luatToWhere(
      { contractType: ["FULLTIME", CHUA_KHAI] },
      { mode: "STATIC", now: MOC },
    );
    expect(w.OR).toContainEqual({ contractType: null });
    expect(w.OR).toContainEqual({ contractType: { in: ["FULLTIME"] } });
  });

  it("KHÔNG chọn `CHUA_KHAI` ⇒ tuyệt đối không kéo NULL vào", () => {
    const w = luatToWhere(
      { contractType: ["FULLTIME"] },
      { mode: "STATIC", now: MOC },
    );
    expect(JSON.stringify(w)).not.toContain('"contractType":null');
  });

  it("chọn RIÊNG `CHUA_KHAI` vẫn ra luật chạy được", () => {
    const w = luatToWhere(
      { contractType: [CHUA_KHAI] },
      { mode: "STATIC", now: MOC },
    );
    expect(w.OR).toEqual([{ contractType: null }]);
  });
});

describe("luật 1 — chức danh đọc `Employee.jobTitle`, so khớp chuẩn hoá", () => {
  it("khớp bất kể hoa/thường và khoảng trắng thừa", () => {
    // `jobTitle` là chuỗi tự do, không danh mục: prod có thể mang cả "Giáo viên",
    // "giáo viên" lẫn " Giáo Viên ". Người giao bài chọn MỘT nhãn và phải trúng
    // hết — nếu không, người bị sót không hề biết mình bị sót.
    const that = ["Giáo viên", "giáo viên", " Giáo Viên ", "Trợ giảng"];
    expect(khopChucDanh(["Giáo viên"], that).sort()).toEqual(
      [" Giáo Viên ", "Giáo viên", "giáo viên"].sort(),
    );
  });

  it("chọn nhãn KHÔNG có thật ⇒ khớp KHÔNG AI, không phải khớp tất cả", () => {
    // Nhánh nguy hiểm: `in: []` viết ẩu thành bỏ hẳn điều kiện thì luật rỗng
    // nghĩa là "mọi người" — giao nhầm cho toàn công ty.
    const w = luatToWhere(
      { jobTitle: ["Chức danh không tồn tại"] },
      { mode: "STATIC", now: MOC, chucDanhCoThat: ["Giáo viên"] },
    );
    expect(w.jobTitle).toEqual({ in: [] });
  });

  it("KHÔNG truyền danh sách có thật ⇒ vẫn khớp đúng chữ đã chọn", () => {
    const w = luatToWhere(
      { jobTitle: ["Giáo viên"] },
      { mode: "STATIC", now: MOC },
    );
    expect(w.jobTitle).toEqual({ in: ["Giáo viên"] });
  });
});

describe("luật 3 — cấm vị ngữ trạng-thái-học-tập trong luật ĐỘNG", () => {
  it("`courseCompleted` trong lượt giao ĐỘNG ⇒ ném lỗi có mã", () => {
    // Tự tham chiếu: hoàn thành khoá X làm người ta RỜI tập, rời tập thành
    // REVOKED, REVOKED lại đưa họ vào tập — vòng lặp mỗi đêm, và người học nhận
    // thông báo thu hồi/giao lại luân phiên không dứt.
    expect(() =>
      luatToWhere(
        { courseCompleted: { courseId: "c1", da: true } },
        { mode: "DYNAMIC", now: MOC },
      ),
    ).toThrow(LoiLuatLoc);
  });

  it("cùng luật đó trong lượt giao TĨNH thì hợp lệ", () => {
    const w = luatToWhere(
      { courseCompleted: { courseId: "c1", da: true } },
      { mode: "STATIC", now: MOC, daHoanThanh: { c1: ["u1", "u2"] } },
    );
    expect(JSON.stringify(w)).toContain("u1");
  });

  it("THIẾU danh sách người đã hoàn thành ⇒ ném lỗi, không đoán bừa", () => {
    // `TrnEnrollment.userId` là cột trần, không có quan hệ Prisma sang `User`,
    // nên người gọi phải tra sẵn. Coi "thiếu dữ liệu" là "không ai hoàn thành"
    // nghe vô hại — nhưng với vế `da: false` ("CHƯA hoàn thành khoá X") nó biến
    // luật thành KHỚP TẤT CẢ.
    expect(() =>
      luatToWhere(
        { courseCompleted: { courseId: "c1", da: false } },
        { mode: "STATIC", now: MOC },
      ),
    ).toThrow(LoiLuatLoc);
  });
});

describe("chiều lọc chưa có nền dữ liệu phải BÁO, không im lặng bỏ qua", () => {
  it("`team` và `capBac` bị từ chối kèm lý do", () => {
    // Repo không có bảng Team, cũng không có cột cấp bậc L1–L5. Nhận rồi bỏ qua
    // là tệ nhất: người giao bài tin mình đã lọc theo team, hệ thống thì giao
    // cho toàn bộ nhóm rộng hơn.
    for (const chieu of chieuLocThieuNen()) {
      expect(() =>
        luatToWhere({ [chieu]: ["x"] }, { mode: "STATIC", now: MOC }),
      ).toThrow(LoiLuatLoc);
    }
  });

  it("khoá lạ / gõ sai tên chiều ⇒ từ chối, KHÔNG bỏ qua im lặng", () => {
    // Bỏ qua khoá lạ luôn làm tập NỞ RA: điều kiện người ta tưởng đang có thật
    // ra không tồn tại.
    expect(() =>
      luatToWhere({ phongBan: ["x"] }, { mode: "STATIC", now: MOC }),
    ).toThrow(LoiLuatLoc);
  });
});

describe("§7.12 — một người nhiều vai: khớp nếu BẤT KỲ vai nào khớp", () => {
  it("bắt cả `role` chính lẫn mảng `roles`", () => {
    const w = luatToWhere({ lmsRole: ["TEACHER"] }, { mode: "STATIC", now: MOC });
    const s = JSON.stringify(w.userAccount);
    expect(s).toContain("hasSome");
    expect(s).toContain("TEACHER");
  });
});

describe("thâm niên — người chưa khai ngày vào làm không được lọt", () => {
  it("`joinedAt` NULL không khớp luật thâm niên", () => {
    const w = luatToWhere({ seniorityDaysMin: 30 }, { mode: "STATIC", now: MOC });
    expect(w.joinedAt).toMatchObject({ not: null });
  });

  it("`seniorityDaysMin: 30` ⇒ vào làm TRƯỚC mốc 30 ngày", () => {
    const w = luatToWhere({ seniorityDaysMin: 30 }, { mode: "STATIC", now: MOC });
    const lte = (w.joinedAt as { lte: Date }).lte;
    expect(lte.toISOString()).toBe("2026-07-24T00:00:00.000Z");
  });
});

describe("ghép điều kiện: trong một luật là VÀ, giữa các luật là HOẶC", () => {
  it("nhiều điều kiện trong một luật nằm chung một object (VÀ)", () => {
    const w = luatToWhere(
      { centerId: ["cs1"], departmentId: ["d1"] },
      { mode: "STATIC", now: MOC },
    );
    expect(w.centerId).toEqual({ in: ["cs1"] });
    expect(w.departmentId).toEqual({ in: ["d1"] });
  });

  it("nhiều luật nối bằng HOẶC", () => {
    const w = cacLuatToWhere([{ centerId: ["cs1"] }, { centerId: ["cs2"] }], {
      mode: "STATIC",
      now: MOC,
    });
    expect(w.OR).toHaveLength(2);
  });

  it("KHÔNG có luật nào ⇒ khớp KHÔNG AI", () => {
    // Lượt giao chỉ có danh sách cá nhân là hợp lệ; nhưng phần LUẬT của nó phải
    // ra tập rỗng, không phải toàn công ty.
    const w = cacLuatToWhere([], { mode: "STATIC", now: MOC });
    expect(w).toEqual({ id: { in: [] } });
  });
});

describe("where sinh ra phải là trường CÓ THẬT của Prisma", () => {
  /**
   * Case này sinh ra từ một lỗi thật của chính tệp trên: bản đầu dựng
   * `userAccount.trnEnrollments` — một quan hệ KHÔNG TỒN TẠI (`TrnEnrollment.userId`
   * là cột trần). `pnpm typecheck` XANH, vì object nằm trong spread nên TS không
   * kiểm thừa thuộc tính; lỗi chỉ nổ lúc chạy, trên màn giao bài, ở prod.
   *
   * Nên guard này soi tên trường theo DMMF thay vì tin vào trình biên dịch.
   */
  const truong = (model: string) =>
    new Set(
      (Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields ?? []).map(
        (f) => f.name,
      ),
    );
  const TOAN_TU = new Set([
    "in", "notIn", "not", "lt", "lte", "gt", "gte", "equals", "contains",
    "hasSome", "hasEvery", "some", "none", "every", "is", "isNot", "mode",
    "AND", "OR", "NOT", "startsWith", "endsWith",
  ]);

  function soi(w: unknown, model: string, duong = "") {
    if (!w || typeof w !== "object") return;
    for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
      if (TOAN_TU.has(k)) {
        const con = model;
        if (Array.isArray(v)) v.forEach((x) => soi(x, con, duong + "." + k));
        else soi(v, con, duong + "." + k);
        continue;
      }
      const fs = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields;
      const f = fs?.find((x) => x.name === k);
      expect(truong(model).has(k), `${model}${duong}.${k} không tồn tại`).toBe(true);
      if (f?.kind === "object") soi(v, f.type, duong + "." + k);
    }
  }

  it("mọi khoá trong where đều có trong DMMF", () => {
    const cases: unknown[] = [
      luatToWhere({ lmsRole: ["TEACHER"], teacherRank: ["SENIOR"] }, { mode: "STATIC", now: MOC }),
      luatToWhere({ contractType: ["FULLTIME", CHUA_KHAI] }, { mode: "STATIC", now: MOC }),
      luatToWhere({ seniorityDaysMin: 30, seniorityDaysMax: 900 }, { mode: "STATIC", now: MOC }),
      // CẢ HAI vế `da`: bản đầu của guard này chỉ phủ `da: false` và đã BỎ LỌT
      // đúng con bug nó sinh ra để bắt (nhánh `da: true` dựng quan hệ không có
      // thật). Một nhánh không được chạy là một nhánh không được canh.
      luatToWhere(
        { lmsRole: ["TEACHER"], courseCompleted: { courseId: "c1", da: false } },
        { mode: "STATIC", now: MOC, daHoanThanh: { c1: ["u1"] } },
      ),
      luatToWhere(
        { lmsRole: ["TEACHER"], courseCompleted: { courseId: "c1", da: true } },
        { mode: "STATIC", now: MOC, daHoanThanh: { c1: ["u1"] } },
      ),
      luatToWhere(
        { centerId: ["cs1"], departmentId: ["d1"], jobTitle: ["Giáo viên"], managerEmployeeId: ["e1"], salaryRank: [3], salaryLevel: [2] },
        { mode: "STATIC", now: MOC },
      ),
      cacLuatToWhere([{ centerId: ["cs1"] }, { departmentId: ["d1"] }], { mode: "STATIC", now: MOC }),
    ];
    for (const w of cases) soi(w, "Employee");
  });
});
