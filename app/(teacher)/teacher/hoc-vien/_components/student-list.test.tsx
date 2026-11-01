// @vitest-environment jsdom
// Canh gác bộ lọc trạng thái ở danh sách Học viên — QA site GV vòng 1 (BUG-024).
//
// Ca quan trọng nhất là "lọc hai tầng": `groups` dựng TỪ `filtered`, nên lọc một tầng
// thôi sẽ làm dòng đếm đầu trang nói một đằng còn các khối nói một nẻo. Đó đúng là
// loại lệch mà vé này đang tố, nên đừng xoá ca đó khi refactor.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StudentList, type StudentRow } from "./student-list";

/** Em còn học lớp B nhưng ĐÃ NGHỈ lớp A — ca bẫy của `r.status` gộp. */
const NGHI_LOP_A: StudentRow = {
  id: "s1",
  name: "Đặng Công Trí",
  studentCode: "CS1.HV.0029",
  // status gộp "ưu tiên active" ⇒ ACTIVE, dù ở lớp A em đã nghỉ.
  status: "ACTIVE",
  classes: [
    { id: "cA", name: "Lớp A", status: "WITHDREW" },
    { id: "cB", name: "Lớp B", status: "ACTIVE" },
  ],
};

const DANG_HOC: StudentRow = {
  id: "s2",
  name: "Huỳnh Mai Nga",
  studentCode: "CS1.HV.0071",
  status: "ACTIVE",
  classes: [{ id: "cA", name: "Lớp A", status: "ACTIVE" }],
};

const DA_HOAN_THANH: StudentRow = {
  id: "s3",
  name: "Đinh Công Huy",
  studentCode: "CS1.HV.0102",
  status: "COMPLETED",
  classes: [{ id: "cA", name: "Lớp A", status: "COMPLETED" }],
};

describe("StudentList — bộ lọc trạng thái", () => {
  it("mặc định 'Đang học': em đã hoàn thành không nằm trong sĩ số", () => {
    render(<StudentList rows={[DANG_HOC, DA_HOAN_THANH]} />);
    expect(screen.getByText("Huỳnh Mai Nga")).toBeTruthy();
    expect(screen.queryByText("Đinh Công Huy")).toBeNull();
  });

  it("dòng đếm đầu trang khớp số em thực sự hiện ra", () => {
    render(<StudentList rows={[DANG_HOC, DA_HOAN_THANH]} />);
    // 1 em đang học — KHÔNG phải 2. Đây là chỗ lệch nếu chỉ lọc trong `groups`.
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("em nghỉ lớp A nhưng còn học lớp B: KHÔNG lọt vào khối lớp A", () => {
    // Ca chống hồi quy cho TẦNG `groups`: nếu ở đó xét `r.status` gộp (= ACTIVE) thay
    // vì `c.status` của từng lớp, em này sẽ hiện trong khối Lớp A dù đã nghỉ lớp đó.
    render(<StudentList rows={[NGHI_LOP_A, DANG_HOC]} />);

    const khoiLopA = screen
      .getAllByRole("heading", { level: 2 })
      .find((h) => h.textContent?.includes("Lớp A"));
    expect(khoiLopA).toBeTruthy();

    // Khối Lớp A chỉ được có Huỳnh Mai Nga; Đặng Công Trí thuộc khối Lớp B.
    const bangLopA = khoiLopA!.parentElement!;
    expect(bangLopA.textContent).toContain("Huỳnh Mai Nga");
    expect(bangLopA.textContent).not.toContain("Đặng Công Trí");
  });

  it("em nghỉ lớp A VẪN hiện ở khối lớp B — lọc trạng thái không được xoá em khỏi lớp đang học", () => {
    render(<StudentList rows={[NGHI_LOP_A, DANG_HOC]} />);
    const khoiLopB = screen
      .getAllByRole("heading", { level: 2 })
      .find((h) => h.textContent?.includes("Lớp B"));
    expect(khoiLopB).toBeTruthy();
    expect(khoiLopB!.parentElement!.textContent).toContain("Đặng Công Trí");
  });

  it("thanh công cụ có ĐỦ ba ô: lọc lớp, lọc trạng thái, chế độ xem", () => {
    render(<StudentList rows={[DANG_HOC, DA_HOAN_THANH]} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  it("không em nào đang học ⇒ empty state, không phải bảng rỗng có tiêu đề", () => {
    render(<StudentList rows={[DA_HOAN_THANH]} />);
    expect(screen.getByText("Không tìm thấy học viên")).toBeTruthy();
  });
});
