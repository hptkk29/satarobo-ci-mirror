// @vitest-environment jsdom
/**
 * Ca [HSF-*] — HỢP ĐỒNG giữa form "Hồ sơ học viên" và `docFormHocVien` [25/09/2026].
 *
 * `docFormHocVien` (`../../_lib/doc-form.ts`) đọc theo SỰ CÓ MẶT của khoá:
 *   · vắng mặt ⇒ không đụng cột;   · có mặt mà rỗng ⇒ XOÁ cột.
 * Nên form chỉ đúng khi nó gửi ĐÚNG tập khoá: thiếu một ô đang hiện là sửa không lưu (lời
 * hứa suông); dư một ô đã gỡ (vd `district` rỗng) là xoá âm thầm dữ liệu cũ của mọi hồ sơ
 * được bấm Lưu. Cả hai lỗi đều không ném, không làm typecheck đỏ.
 *
 * Bộ này dựng form THẬT trong jsdom rồi đọc `FormData` THẬT của nó — không grep mã nguồn
 * (luật 11): khẳng định thứ trình duyệt sẽ gửi, rồi chạy nó qua đúng đường server đọc
 * (`docFormHocVien` → `studentUpdateSchema` → `chiGiuKhoaCoMat`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  updateStudent: vi.fn(),
  createStudent: vi.fn(),
}));

vi.mock("../../_actions", () => ({
  updateStudent: m.updateStudent,
  createStudent: m.createStudent,
}));
vi.mock("../../[id]/_anh-dai-dien-actions", () => ({
  datAnhDaiDienHocVien: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { chiGiuKhoaCoMat, docFormHocVien } from "../../_lib/doc-form";
import { studentUpdateSchema } from "@/lib/validators/student";
import { StudentForm, type StudentFormValue } from "../student-form";

const TINH = [{ value: "48", label: "Thành phố Đà Nẵng" }];

/** Hồ sơ CŨ điển hình: tỉnh gõ tay kiểu cũ ("TP …") + phường không còn trong danh mục mới. */
const HV: StudentFormValue = {
  id: "hv_1",
  name: "Nguyễn Minh An",
  studentCode: "CS1-26-ABCD",
  dateOfBirth: "2016-05-10",
  gender: "MALE",
  currentGrade: 4,
  school: "Tiểu học Trần Văn Ơn",
  status: "PAUSED",
  parentName: "Trần Thị Hoa",
  parentPhone: "0905123456",
  parentPhoneMasked: false,
  parentRelation: "Mẹ",
  parentGender: "FEMALE",
  parentDob: "1988-02-03",
  parentEmail: "hoa@example.com",
  parentFacebookUrl: "https://www.facebook.com/hoa.tran",
  parentNationalId: null,
  parent2Name: "Nguyễn Văn Bình",
  parent2Phone: "0912000111",
  parent2Relation: "Bố",
  city: "TP Đà Nẵng",
  ward: "Phường Phước Ninh",
  address: "12 Lê Lợi",
  allergies: ["Tôm"],
  healthNotes: "Hen nhẹ",
  notes: "Đón muộn thứ 5",
  orgUnitId: "ou_cs1",
};

function dung(student?: StudentFormValue, coTheDoiMa = true) {
  render(
    <StudentForm
      student={student}
      coTheDoiMa={coTheDoiMa}
      orgUnits={[{ id: "ou_cs1", name: "CS1 — Nguyễn Hữu Thọ" }]}
      provinces={TINH}
      initialWards={[]}
      homNay="2026-09-25"
      thongTinTrungTam={student ? { lopDangHoc: [], ngayNhapHoc: null } : undefined}
    />,
  );
  const form = screen.getByRole("form", {
    name: student ? "Sửa hồ sơ học viên" : "Tạo học viên mới",
  }) as HTMLFormElement;
  return form;
}

/** Khoá D3 đã GỠ khỏi form — dữ liệu cũ phải được để yên (vắng mặt ⇒ không đụng). */
const KHOA_DA_GO = [
  "bloodType",
  "district",
  "preferredOrgUnitId",
  "enrollmentDate",
  "phone",
  "email",
] as const;

/** Mọi ô ĐANG HIỆN trên form sửa — thiếu một khoá là sửa ô đó không bao giờ lưu. */
const KHOA_HIEN = [
  "name",
  "studentCode",
  "status",
  "gender",
  "dateOfBirth",
  "currentGrade",
  "school",
  "parentName",
  "parentPhone",
  "parentRelation",
  "parentGender",
  "parentDob",
  "parentEmail",
  "parentFacebookUrl",
  "parent2Name",
  "parent2Phone",
  "parent2Relation",
  "city",
  "ward",
  "address",
  "orgUnitId",
  "notes",
  "healthNotes",
  "allergies",
] as const;

beforeEach(() => {
  m.updateStudent.mockReset();
  m.createStudent.mockReset();
  // jsdom không có scrollIntoView — form cuộn tới khung lỗi sau khi server trả lỗi.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Form hồ sơ học viên — tập khoá gửi đi", () => {
  it("[HSF-01] chế độ SỬA: KHÔNG gửi khoá đã gỡ (D3) và KHÔNG gửi avatarUrl (ảnh đổi bằng nút riêng)", () => {
    const fd = new FormData(dung(HV));
    for (const k of [...KHOA_DA_GO, "avatarUrl"]) {
      expect(fd.has(k), `form sửa không được gửi "${k}"`).toBe(false);
    }
  });

  it("[HSF-02] chế độ SỬA: gửi ĐỦ mọi ô đang hiện, và mọi khoá gửi đi đều là khoá docFormHocVien đọc", () => {
    const fd = new FormData(dung(HV));
    for (const k of KHOA_HIEN) {
      expect(fd.has(k), `thiếu khoá "${k}" — sửa ô này sẽ không bao giờ được lưu`).toBe(true);
    }
    // Khoá gõ sai tên (vd "parentFacebook") lọt qua mọi typecheck và bị bỏ im lặng ở server.
    const tho = docFormHocVien(fd, "update") as Record<string, unknown>;
    for (const k of new Set(fd.keys())) {
      expect(Object.hasOwn(tho, k), `khoá "${k}" không được docFormHocVien đọc`).toBe(true);
    }
  });

  // ĐẢO 26/09 (chủ dự án: "không lấy thông tin cũ nữa"): địa chỉ chỉ còn danh mục MỚI. Tỉnh
  // "TP Đà Nẵng" dịch sang đúng mục danh mục; phường không có trong danh mục mới ⇒ ô trống.
  // Mọi ô KHÁC vẫn đi nguyên xuống như cũ.
  it("[HSF-03] mở hồ sơ cũ: địa chỉ ra danh mục MỚI, mọi ô khác giữ nguyên", () => {
    const fd = new FormData(dung(HV));
    expect(fd.get("city")).toBe("Thành phố Đà Nẵng");
    expect(fd.get("ward")).toBe("");
    // Không còn option "(dữ liệu cũ)" nào trên màn.
    expect(document.body.textContent ?? "").not.toMatch(/dữ liệu cũ/);

    const tho = docFormHocVien(fd, "update");
    const parsed = studentUpdateSchema.safeParse(tho);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const data = chiGiuKhoaCoMat(parsed.data!, tho);

    expect(data).toMatchObject({
      name: HV.name,
      studentCode: HV.studentCode,
      status: "PAUSED",
      gender: "MALE",
      dateOfBirth: new Date("2016-05-10T00:00:00Z"),
      currentGrade: 4,
      school: HV.school,
      parentName: HV.parentName,
      parentPhone: HV.parentPhone,
      parentRelation: "Mẹ",
      parentGender: "FEMALE",
      parentDob: new Date("1988-02-03T00:00:00Z"),
      parentEmail: HV.parentEmail,
      parentFacebookUrl: HV.parentFacebookUrl,
      parent2Name: HV.parent2Name,
      parent2Phone: HV.parent2Phone,
      parent2Relation: "Bố",
      city: "Thành phố Đà Nẵng",
      ward: null,
      address: HV.address,
      orgUnitId: HV.orgUnitId,
      notes: HV.notes,
      healthNotes: HV.healthNotes,
      allergies: ["Tôm"],
    });
    for (const k of KHOA_DA_GO) expect(Object.hasOwn(data, k), k).toBe(false);
  });

  it("[HSF-04] chế độ TẠO: có ô ảnh `avatarUrl`, KHÔNG có `status` (schema tự đặt Đang học)", () => {
    const fd = new FormData(dung());
    expect(fd.has("avatarUrl")).toBe(true);
    expect(fd.has("status")).toBe(false);
    for (const k of KHOA_DA_GO) expect(fd.has(k), k).toBe(false);
  });

  it("[HSF-05] SĐT bị che theo quyền ⇒ ô CHỈ ĐỌC (không để người dùng gõ lại trên chuỗi mask)", () => {
    dung({ ...HV, parentPhone: "090xxxx456", parentPhoneMasked: true });
    expect(screen.getByLabelText("SĐT phụ huynh")).toHaveAttribute("readonly");
  });

  it("[HSF-05b] đối chứng: SĐT không bị che ⇒ ô sửa được", () => {
    dung(HV);
    expect(screen.getByLabelText("SĐT phụ huynh")).not.toHaveAttribute("readonly");
  });

  // 26/09 — chủ dự án: "mã học viên không được chỉnh sửa, chỉ admin được chỉnh".
  it("[HSF-07] không có quyền đổi mã ⇒ ô mã CHỈ ĐỌC và KHÔNG gửi khoá studentCode (sửa lẫn tạo)", () => {
    const fd = new FormData(dung(HV, false));
    expect(fd.has("studentCode")).toBe(false);
    const o = screen.getByLabelText("Mã học viên") as HTMLInputElement;
    expect(o).toHaveAttribute("readonly");
    expect(o.value).toBe(HV.studentCode);
  });

  it("[HSF-07b] đối chứng dương: CÓ quyền ⇒ ô sửa được và gửi studentCode", () => {
    const fd = new FormData(dung(HV, true));
    expect(fd.get("studentCode")).toBe(HV.studentCode);
    expect(screen.getByLabelText("Mã học viên")).not.toHaveAttribute("readonly");
  });

  it("[HSF-07c] tạo mới không có quyền ⇒ không có khoá studentCode (hệ thống tự sinh)", () => {
    const fd = new FormData(dung(undefined, false));
    expect(fd.has("studentCode")).toBe(false);
  });

  // 26/09 — "Quan hệ với học sinh thì dropdown".
  it("[HSF-08] ô Quan hệ là Ô CHỌN; giá trị cũ không nhận ra được giữ thành một mục riêng", () => {
    dung({ ...HV, parentRelation: "Ba", parent2Relation: "bố" });
    const o = screen.getByLabelText("Quan hệ với học sinh") as HTMLSelectElement;
    expect(o.tagName).toBe("SELECT");
    // "Ba" (bố — tiếng miền Nam) ≠ "Bà": KHÔNG đoán, giữ nguyên để lượt lưu không đổi lặng lẽ.
    expect(o.value).toBe("Ba");
    const ph2 = screen.getByLabelText("Quan hệ") as HTMLSelectElement;
    expect(ph2.tagName).toBe("SELECT");
    // "bố" nhận ra được ⇒ chọn đúng mục "Bố".
    expect(ph2.value).toBe("Bố");
    const nhan = [...o.options].map((x) => x.value);
    for (const q of ["Mẹ", "Bố", "Ông", "Bà", "Người giám hộ"]) expect(nhan).toContain(q);
  });
});

describe("Form hồ sơ học viên — server trả lỗi", () => {
  it("[HSF-06] lỗi validate KHÔNG xoá chữ vừa gõ (React 19 tự reset form sau <form action>)", async () => {
    m.updateStudent.mockResolvedValue({ error: "Mã học viên đã tồn tại" });
    const form = dung(HV);
    const o = screen.getByLabelText("Họ và tên học sinh") as HTMLInputElement;
    fireEvent.change(o, { target: { value: "Nguyễn Minh An Mới" } });

    fireEvent.submit(form);

    const loi = await screen.findByRole("alert");
    expect(loi).toHaveTextContent("Mã học viên đã tồn tại");
    await waitFor(() => expect(m.updateStudent).toHaveBeenCalledTimes(1));
    const [id, fd] = m.updateStudent.mock.calls[0] as [string, FormData];
    expect(id).toBe("hv_1");
    expect(fd.get("name")).toBe("Nguyễn Minh An Mới");
    // Thứ người dùng thấy sau lỗi: vẫn là chữ họ vừa gõ.
    expect((screen.getByLabelText("Họ và tên học sinh") as HTMLInputElement).value).toBe(
      "Nguyễn Minh An Mới",
    );
  });
});
