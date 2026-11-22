/**
 * "Ô nào THẬT SỰ đổi trong lượt sửa này".
 *
 * Vì sao module này cần test riêng: nó là thứ quyết định một lượt bấm Lưu có sinh dòng
 * lịch sử hay không. Sai về phía NỚI thì mỗi lần bấm Lưu suông đẻ một dòng "đã sửa" giả và
 * panel loãng thành vô dụng; sai về phía SIẾT thì lượt sửa thật biến mất khỏi lịch sử. Cả
 * hai hướng đều KHÔNG ném lỗi và không làm ca nào khác đỏ.
 */
import { describe, expect, it } from "vitest";
import { NHAN_TRUONG_CON, NHAN_TRUONG_LEAD, truongDaDoi } from "./truong-doi";

const NHAN = { a: "ô A", b: "ô B", c: "ô C" };

describe("[TD-01] chỉ kể ô THẬT SỰ đổi", () => {
  it("ô giữ nguyên ⇒ không kể", () => {
    expect(truongDaDoi({ a: "x", b: "y" }, { a: "x", b: "y" }, NHAN)).toEqual([]);
  });

  it("ô đổi ⇒ kể đúng ô đó", () => {
    expect(truongDaDoi({ a: "x", b: "y" }, { a: "x", b: "z" }, NHAN)).toEqual(["ô B"]);
  });

  it("⚠️ ô KHÔNG có trong phiếu gửi lên ⇒ KHÔNG kể", () => {
    // Biểu mẫu gửi cả phiếu mỗi lần lưu, nhưng có đường chỉ gửi một phần (ví dụ ô ghi
    // chú). Coi ô vắng mặt là "đã xoá thành trống" là kể một việc người dùng không làm.
    expect(truongDaDoi({ a: "x", b: "y" }, { a: "x" }, NHAN)).toEqual([]);
  });

  it("ô không có NHÃN ⇒ không kể (không lọt tên cột kỹ thuật ra câu)", () => {
    expect(truongDaDoi({ zzz: "1" }, { zzz: "2" }, NHAN)).toEqual([]);
  });
});

describe("[TD-02] ⚠️ `null` (DB) và `\"\"` (biểu mẫu) là CÙNG một nghĩa 'chưa điền'", () => {
  it.each([
    [null, ""],
    ["", null],
    [null, "   "],
    [undefined, ""],
    [null, undefined],
  ])("cũ=%s mới=%s ⇒ không kể", (cu, moi) => {
    // Không gộp hai dạng trống thì mỗi lượt bấm Lưu trên hồ sơ có ô để trống đều sinh một
    // dòng "đã sửa" — và đó là phần lớn hồ sơ thật.
    expect(truongDaDoi({ a: cu }, { a: moi }, NHAN)).toEqual([]);
  });

  it("trống → CÓ giá trị ⇒ kể (đây là lượt điền thật)", () => {
    expect(truongDaDoi({ a: null }, { a: "0905" }, NHAN)).toEqual(["ô A"]);
  });

  it("có giá trị → trống ⇒ kể (đây là lượt XOÁ thật)", () => {
    expect(truongDaDoi({ a: "0905" }, { a: "" }, NHAN)).toEqual(["ô A"]);
  });
});

describe("[TD-03] số và ngày so theo GIÁ TRỊ, không theo kiểu", () => {
  it("số 8 và chuỗi \"8\" là một (biểu mẫu trả chuỗi, DB trả số)", () => {
    expect(truongDaDoi({ a: 8 }, { a: "8" }, NHAN)).toEqual([]);
    expect(truongDaDoi({ a: 8 }, { a: 9 }, NHAN)).toEqual(["ô A"]);
  });

  it("hai `Date` CÙNG thời điểm là một, dù là hai đối tượng khác nhau", () => {
    // So bằng `!==` trần thì hai `Date` cùng giá trị luôn "khác nhau" ⇒ mọi lượt lưu hồ sơ
    // có ngày sinh đều bị kể là đã sửa.
    const d1 = new Date("2018-05-04T00:00:00.000Z");
    const d2 = new Date("2018-05-04T00:00:00.000Z");
    expect(truongDaDoi({ a: d1 }, { a: d2 }, NHAN)).toEqual([]);
  });

  it("`Date` và chuỗi ISO cùng thời điểm là một", () => {
    const d = new Date("2018-05-04T00:00:00.000Z");
    expect(truongDaDoi({ a: d }, { a: "2018-05-04T00:00:00.000Z" }, NHAN)).toEqual([]);
  });

  it("`Date` khác thời điểm ⇒ kể", () => {
    expect(
      truongDaDoi(
        { a: new Date("2018-05-04T00:00:00.000Z") },
        { a: new Date("2019-05-04T00:00:00.000Z") },
        NHAN,
      ),
    ).toEqual(["ô A"]);
  });

  it("một bên là ngày KHÔNG đọc được ⇒ so bằng chuỗi, không kết luận bừa", () => {
    const d = new Date("2018-05-04T00:00:00.000Z");
    expect(truongDaDoi({ a: d }, { a: "khong-phai-ngay" }, NHAN)).toEqual(["ô A"]);
    expect(truongDaDoi({ a: "khong-phai-ngay" }, { a: "khong-phai-ngay" }, NHAN)).toEqual([]);
  });
});

describe("[TD-04] bảng nhãn nói tiếng Việt", () => {
  it("nhãn của CON và của LEAD đều là tiếng Việt thường, không phải tên cột", () => {
    for (const [khoa, nhan] of [
      ...Object.entries(NHAN_TRUONG_CON),
      ...Object.entries(NHAN_TRUONG_LEAD),
    ]) {
      expect(nhan, `nhãn của ${khoa} rỗng`).toBeTruthy();
      // Không lọt tên cột kiểu `interestedCourseId` / `parentName` ra câu người đọc.
      expect(nhan, `nhãn của ${khoa} còn là tên cột: ${nhan}`).not.toMatch(/^[a-z]+[A-Z]/);
      expect(nhan).not.toContain("Id");
    }
  });

  it("phủ đủ 9 ô mà `leadChildData` ghi — thiếu ô nào thì ô đó không bao giờ được kể", () => {
    // `updateLeadChild` gọi `truongDaDoi(child, data, NHAN_TRUONG_CON)`; khoá nào không có
    // nhãn thì vòng lặp bỏ qua, nên một ô thiếu nhãn là một ô âm thầm không vào lịch sử.
    for (const k of [
      "fullName",
      "dob",
      "ageYears",
      "gender",
      "schoolName",
      "gradeLevel",
      "interestedCourseId",
      "interestedCenterId",
      "note",
    ]) {
      expect(NHAN_TRUONG_CON[k], `thiếu nhãn cho ${k}`).toBeTruthy();
    }
  });
});
