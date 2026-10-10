// GĐ2 — [LT-U-06].
//
// Vì sao khoá riêng hàm đếm này: nút "Lưu điểm danh" chỉ được mở khi CẢ LỚP đã đánh
// dấu. Lưu dở dang thì buổi trông như đã điểm danh trong khi vài em không có bản ghi
// nào, mà tiến độ học thử của lead lại tính theo SỐ BẢN GHI có mặt — đếm sai ở đây là
// lead bị kẹt hoặc bị đẩy trạng thái sớm.
import { describe, it, expect } from "vitest";
import { demSoEmChuaDanhDau } from "./attendance";
import type { EnrollmentRow, TrialAttendanceMark } from "./types";

function hocVien(id: string): EnrollmentRow {
  return {
    id,
    leadChildId: `child-${id}`,
    childName: `Bé ${id}`,
    parentName: null,
    phone: null,
    leadId: null,
    status: "ACTIVE",
    // GĐ3 — bốn field của "ca" trải nghiệm; hàm đếm không dùng tới nhưng type đòi đủ.
    scheduledSessionId: null,
    gvDeXuatId: null,
    gvPhanCongId: null,
    rescheduleCount: 0,
    // 23/09 — hai field của luật "ai gỡ được bé này". Hàm đếm không dùng tới nhưng
    // type đòi đủ, và đòi đủ là cố ý: quên khai ở đường THẬT thì `tsc` chỉ ra ngay.
    saleTen: null,
    quyenGo: { duoc: true },
    quyenChuyen: { duoc: true },
    // 26/09 — khoá học của bé; hàm đếm không dùng tới.
    khoaHocId: null,
    khoaTuLead: false,
    khoaHocTen: null,
  };
}

type Nhap = Record<string, { status: TrialAttendanceMark | null }>;

describe("[LT-U-06] đếm số em chưa đánh dấu", () => {
  const lop = [hocVien("a"), hocVien("b"), hocVien("c")];

  it("chưa ai được đánh dấu → đếm đủ sĩ số", () => {
    expect(demSoEmChuaDanhDau(lop, {})).toBe(3);
  });

  it("đánh dấu hết → 0", () => {
    const nhap: Nhap = {
      a: { status: "PRESENT" },
      b: { status: "ABSENT" },
      c: { status: "PRESENT" },
    };
    expect(demSoEmChuaDanhDau(lop, nhap)).toBe(0);
  });

  it("đánh dấu dở → đếm đúng phần còn thiếu", () => {
    expect(demSoEmChuaDanhDau(lop, { a: { status: "PRESENT" } })).toBe(2);
  });

  it("status null vẫn tính là CHƯA đánh dấu", () => {
    // Đây là ca dễ sai nhất: bỏ chọn xong thì khoá vẫn tồn tại nhưng giá trị là null.
    // Nếu đếm bằng Object.keys thì em này bị coi là đã đánh dấu.
    const nhap: Nhap = {
      a: { status: null },
      b: { status: "PRESENT" },
      c: { status: "ABSENT" },
    };
    expect(demSoEmChuaDanhDau(lop, nhap)).toBe(1);
  });

  it("nháp thừa của em không còn trong lớp thì không ảnh hưởng", () => {
    // Gỡ một em khỏi lớp xong nháp cũ vẫn nằm lại trong state.
    const nhap: Nhap = {
      a: { status: "PRESENT" },
      b: { status: "PRESENT" },
      c: { status: "PRESENT" },
      "da-go": { status: "ABSENT" },
    };
    expect(demSoEmChuaDanhDau(lop, nhap)).toBe(0);
  });

  it("lớp rỗng → 0", () => {
    expect(demSoEmChuaDanhDau([], {})).toBe(0);
  });
});
