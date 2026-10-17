// @vitest-environment jsdom
/**
 * Ca [RSX-*] — các bản vá GIAO DIỆN sau lượt rà đối kháng 25/09/2026. Mỗi ca dựng component
 * THẬT trong jsdom và khẳng định HÀNH VI (luật 11), không grep mã nguồn.
 *
 *   RSX-01  chỉ gửi ô ĐÃ ĐỔI (hàm thuần)          RSX-06  "Đổi lead" giữ đứa trẻ đang nối + hộp thoại mang .admin-scope
 *   RSX-02  form SỬA gửi đúng phần đã đổi          RSX-07  lead ở cơ sở khác ⇒ chỉ đúng người để hỏi
 *   RSX-03  đang sửa dở ⇒ KHÔNG dựng lại form      RSX-08  nút "Ghi danh" chỉ khi Đang học; dòng tiến độ nói MỘT số
 *   RSX-04  ảnh đang tải ⇒ khoá nút "Tạo"          RSX-09  ô chọn không bị tô xám "chỉ đọc"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const m = vi.hoisted(() => ({
  updateStudent: vi.fn(),
  createStudent: vi.fn(),
  ganLeadChoHocVien: vi.fn(),
  timLeadDeGanAction: vi.fn(),
  goLienKetLead: vi.fn(),
  dangTaiAnh: { bao: null as null | ((v: boolean) => void) },
}));

vi.mock("../../_actions", () => ({
  updateStudent: m.updateStudent,
  createStudent: m.createStudent,
}));
vi.mock("../../[id]/_lien-ket-lead-actions", () => ({
  ganLeadChoHocVien: m.ganLeadChoHocVien,
  timLeadDeGanAction: m.timLeadDeGanAction,
  goLienKetLead: m.goLienKetLead,
}));
vi.mock("../../[id]/_anh-dai-dien-actions", () => ({
  datAnhDaiDienHocVien: vi.fn(async () => ({ ok: true as const })),
}));
// Ảnh ở chế độ TẠO: thay bằng nút giả để giữ được cờ "đang tải" mà không cần XHR thật.
vi.mock("./anh-dai-dien", () => ({
  ChonAnhKhiTao: ({ onDangTai }: { onDangTai: (v: boolean) => void }) => {
    m.dangTaiAnh.bao = onDangTai;
    return <input type="hidden" name="avatarUrl" value="" />;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { act } from "react";
import type { LeadGoiY } from "@/lib/students/lead-nguon-types";
import { StudentForm, type StudentFormValue } from "../student-form";
import { chiGiuODaDoi, anhChupForm } from "./gui-o-da-doi";
import { GiuFormKhiDangSua } from "./giu-form-khi-dang-sua";
import { BoChonLead, NutMoChonLead } from "./chon-lead";
import { KhungLeadNguon } from "./khung-lead-nguon";
import { LopVaTienDo } from "./lop-va-tien-do";
import { O_NHAP } from "./o-nhap";

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
  parent2Name: null,
  parent2Phone: null,
  parent2Relation: null,
  // Địa chỉ ĐÃ theo danh mục mới — để [RSX-02] chỉ đo đúng một chuyện (ô nào đổi thì gửi ô
  // đó). Hồ sơ mang địa chỉ kiểu cũ có ca riêng [RSX-10].
  city: "Thành phố Đà Nẵng",
  ward: null,
  address: "12 Lê Lợi",
  allergies: ["Tôm"],
  healthNotes: "Hen nhẹ",
  notes: "Đón muộn thứ 5",
  orgUnitId: "ou_cs1",
};

function dungForm(student?: StudentFormValue) {
  return render(
    <StudentForm
      student={student}
      coTheDoiMa
      orgUnits={[{ id: "ou_cs1", name: "CS1 — Nguyễn Hữu Thọ" }]}
      provinces={[{ value: "48", label: "Thành phố Đà Nẵng" }]}
      initialWards={[]}
      homNay="2026-09-25"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.updateStudent.mockResolvedValue({});
  m.createStudent.mockResolvedValue({});
  m.ganLeadChoHocVien.mockResolvedValue({ ok: true, soODaDien: 0 });
});

describe("[RSX-01] chiGiuODaDoi", () => {
  it("bỏ ô KHÔNG đổi; giữ ô đã đổi, ô mới, và 3 ô bắt buộc", () => {
    const truoc = new FormData();
    for (const [k, v] of [
      ["name", "An"],
      ["parentName", "Hoa"],
      ["parentPhone", "0905"],
      ["school", "TH A"],
      ["status", "PAUSED"],
    ]) truoc.set(k, v);
    const sau = new FormData();
    for (const [k, v] of [
      ["name", "An"],
      ["parentName", "Hoa"],
      ["parentPhone", "0905"],
      ["school", "TH B"],
      ["status", "PAUSED"],
      ["notes", ""],
    ]) sau.set(k, v);
    const kq = chiGiuODaDoi(sau, anhChupForm(truoc));
    expect([...new Set(kq.keys())].sort()).toEqual(
      ["name", "notes", "parentName", "parentPhone", "school"].sort(),
    );
  });
});

describe("[RSX-02] form SỬA chỉ gửi ô đã đổi (+3 ô bắt buộc)", () => {
  it("đổi mỗi ô trường ⇒ trạng thái / địa chỉ / dị ứng… KHÔNG có mặt", async () => {
    const { container } = dungForm(HV);
    fireEvent.change(screen.getByRole("textbox", { name: "Trường đang học" }), {
      target: { value: "TH Lê Văn Tám" },
    });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(m.updateStudent).toHaveBeenCalledTimes(1));
    const fd = m.updateStudent.mock.calls[0]![1] as FormData;
    expect([...new Set(fd.keys())].sort()).toEqual(
      ["name", "parentName", "parentPhone", "school"].sort(),
    );
    expect(fd.get("school")).toBe("TH Lê Văn Tám");
  });

  // 26/09 — địa chỉ kiểu cũ ("TP Đà Nẵng", phường đã sáp nhập) hiện ra theo danh mục MỚI; lượt
  // lưu phải ghi ĐÚNG thứ màn hình đang cho thấy, không để DB giữ chữ cũ mà màn hình giấu đi.
  it("[RSX-10] hồ sơ địa chỉ kiểu cũ ⇒ lượt lưu gửi địa chỉ đã chuẩn hoá (và chỉ thế)", async () => {
    const { container } = dungForm({ ...HV, city: "TP Đà Nẵng", ward: "Phường Phước Ninh" });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(m.updateStudent).toHaveBeenCalledTimes(1));
    const fd = m.updateStudent.mock.calls[0]![1] as FormData;
    expect([...new Set(fd.keys())].sort()).toEqual(
      ["name", "parentName", "parentPhone", "city", "ward"].sort(),
    );
    expect(fd.get("city")).toBe("Thành phố Đà Nẵng");
    expect(fd.get("ward")).toBe("");
  });

  it("[RSX-10b] đối chứng: địa chỉ đã đúng danh mục ⇒ lưu suông KHÔNG gửi địa chỉ", async () => {
    const { container } = dungForm(HV);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(m.updateStudent).toHaveBeenCalledTimes(1));
    const fd = m.updateStudent.mock.calls[0]![1] as FormData;
    expect(fd.has("city")).toBe(false);
    expect(fd.has("ward")).toBe(false);
  });

  it("form TẠO vẫn gửi đủ tờ (không có ảnh chụp để so)", async () => {
    const { container } = dungForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Họ và tên học sinh" }), {
      target: { value: "Bé Mới" },
    });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(m.createStudent).toHaveBeenCalledTimes(1));
    const fd = m.createStudent.mock.calls[0]![0] as FormData;
    expect(fd.has("allergies")).toBe(true);
    expect(fd.has("orgUnitId")).toBe(true);
  });
});

describe("[RSX-03] GiuFormKhiDangSua", () => {
  const O = ({ v }: { v: string }) => <input aria-label="o" defaultValue={v} />;

  it("CHƯA chạm ⇒ khoá mới dựng lại form với giá trị mới", () => {
    const r = render(
      <GiuFormKhiDangSua khoa="a">
        <O v="cũ" />
      </GiuFormKhiDangSua>,
    );
    r.rerender(
      <GiuFormKhiDangSua khoa="b">
        <O v="mới" />
      </GiuFormKhiDangSua>,
    );
    expect((screen.getByLabelText("o") as HTMLInputElement).value).toBe("mới");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ĐANG SỬA ⇒ giữ chữ đang gõ + báo có bản mới; nút nạp lại thì nhận bản mới", () => {
    const r = render(
      <GiuFormKhiDangSua khoa="a">
        <O v="cũ" />
      </GiuFormKhiDangSua>,
    );
    fireEvent.change(screen.getByLabelText("o"), { target: { value: "đang gõ" } });
    r.rerender(
      <GiuFormKhiDangSua khoa="b">
        <O v="mới" />
      </GiuFormKhiDangSua>,
    );
    expect((screen.getByLabelText("o") as HTMLInputElement).value).toBe("đang gõ");
    const bao = screen.getByRole("status");
    fireEvent.click(within(bao).getByRole("button", { name: /Bỏ thay đổi/ }));
    expect((screen.getByLabelText("o") as HTMLInputElement).value).toBe("mới");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("[RSX-04] form TẠO: ảnh đang tải ⇒ không tạo được", () => {
  it("nút khoá + đổi nhãn; Enter cũng không gửi", async () => {
    const { container } = dungForm();
    act(() => m.dangTaiAnh.bao?.(true));
    const nut = screen.getByRole("button", { name: /Đang tải ảnh/ });
    expect((nut as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByText(/Ảnh đại diện đang tải lên/);
    expect(m.createStudent).not.toHaveBeenCalled();
    // Chờ khung hình của `baoLoi` chạy TRONG ca này (không để nó nổ sau khi ca đã xong):
    // khung lỗi phải nhận focus — kể cả ở môi trường không có `scrollIntoView` (jsdom).
    // CI 26/09 đỏ vì callback đó gọi `scrollIntoView` trần và ném SAU khi ca kết thúc.
    await act(() => new Promise<void>((xong) => requestAnimationFrame(() => xong())));
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });
});

const LEAD: LeadGoiY = {
  leadId: "lead_1",
  tenPhuHuynh: "Trần Thị Hoa",
  sdt: "0905123456",
  trangThai: "Đã đăng ký",
  ngayNhanLead: "2026-09-01T00:00:00.000Z",
  salePhuTrach: "Sale A",
  coSo: "CS1",
  lyDo: "TIM_KIEM",
  cacCon: [
    { id: "c1", ten: "Bé Một" },
    { id: "c2", ten: "Bé Hai" },
  ],
};

describe("[RSX-06] Đổi lead", () => {
  it("phiếu đang nối ⇒ ô con BẮT ĐẦU ở đứa đang nối; bấm Cập nhật giữ nguyên đứa đó", async () => {
    render(
      <BoChonLead
        studentId="hv_1"
        tenHocVien="Tên Không Khớp"
        goiY={[LEAD]}
        leadDangNoiId="lead_1"
        conDangNoiId="c2"
      />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("c2");
    fireEvent.click(screen.getByRole("button", { name: /Cập nhật/ }));
    await waitFor(() => expect(m.ganLeadChoHocVien).toHaveBeenCalledTimes(1));
    expect(m.ganLeadChoHocVien.mock.calls[0]![0]).toMatchObject({ leadId: "lead_1", leadChildId: "c2" });
  });

  it("hộp thoại (portal ra body) mang .admin-scope để token admin còn hiệu lực", async () => {
    render(
      <NutMoChonLead
        studentId="hv_1"
        tenHocVien="An"
        goiY={[]}
        leadDangNoiId="lead_1"
        conDangNoiId="c1"
        nhan="Đổi lead"
        className=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Đổi lead/ }));
    const hop = await screen.findByRole("dialog");
    expect(hop.className).toMatch(/\badmin-scope\b/);
  });
});

describe("[RSX-07] không được xem lead — chỉ đúng người để hỏi", () => {
  it("phiếu ở cơ sở KHÁC ⇒ không bảo đi hỏi leads:view-all (quản lý cơ sở mình cũng không mở được)", () => {
    const { container } = render(
      <KhungLeadNguon ketQua={{ kind: "KHONG_DUOC_XEM", lyDo: "CO_SO_KHAC" }} studentId="hv_1" tenHocVien="An" />,
    );
    expect(container.textContent).not.toContain("leads:view-all");
    expect(container.textContent).toContain("Hội sở");
  });

  it("phiếu của Sale khác ⇒ hỏi quản lý cơ sở (leads:view-all)", () => {
    const { container } = render(
      <KhungLeadNguon ketQua={{ kind: "KHONG_DUOC_XEM", lyDo: "SALE_KHAC" }} studentId="hv_1" tenHocVien="An" />,
    );
    expect(container.textContent).toContain("leads:view-all");
  });
});

describe("[RSX-08] Lớp & tiến độ", () => {
  const rong = { dangHoc: [], lichSu: [], buoiVang: [] };

  it("hồ sơ KHÔNG ở trạng thái Đang học ⇒ không có nút ghi danh (màn ghi danh không chọn được em)", () => {
    render(
      <LopVaTienDo studentId="hv_1" tenHocVien="An" {...rong} coTheGhiDanh trangThaiHocVien="PAUSED" />,
    );
    expect(screen.queryByRole("link", { name: /Ghi danh vào lớp/ })).toBeNull();
    expect(screen.getByText(/Bảo lưu/)).toBeTruthy();
  });

  it("Đang học + có quyền ⇒ có nút ghi danh", () => {
    render(
      <LopVaTienDo studentId="hv_1" tenHocVien="An" {...rong} coTheGhiDanh trangThaiHocVien="ACTIVE" />,
    );
    expect(screen.getByRole("link", { name: /Ghi danh vào lớp/ })).toBeTruthy();
  });

  it("tiêu đề + thanh + aria nói CÙNG một số (buổi EM đã học); vị trí LỚP ở dòng phụ", () => {
    render(
      <LopVaTienDo
        studentId="hv_1"
        tenHocVien="An"
        dangHoc={[
          {
            enrollmentId: "e1",
            lop: { id: "l1", ten: "Sata 4", ma: "CS1.01", khoa: "Sata 4", coSo: "CS1" },
            buoi: { total: 12, attended: 0, remaining: 12, absentNoMakeup: 0, currentSession: 10 },
            chiSo: null,
          },
        ]}
        lichSu={[]}
        buoiVang={[]}
        coTheGhiDanh={false}
        trangThaiHocVien="ACTIVE"
      />,
    );
    expect(screen.getByText("Đã học 0/12 buổi")).toBeTruthy();
    expect(screen.getByText(/Lớp đang ở buổi 10/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.queryByText(/^Buổi 10\/12$/)).toBeNull();
  });
});

describe("[RSX-09] ô chọn trông như ô SỬA ĐƯỢC", () => {
  it("lớp ô nhập không dùng biến thể read-only: (select luôn khớp :read-only)", () => {
    expect(O_NHAP).not.toMatch(/read-only:/);
    expect(O_NHAP).toMatch(/data-\[chi-doc\]:bg-muted/);
  });

  it("SĐT đang che ⇒ ô SĐT mang data-chi-doc + readOnly; ô khác không", () => {
    dungForm({ ...HV, parentPhone: "090xxxx456", parentPhoneMasked: true });
    const sdt = screen.getByRole("textbox", { name: /SĐT phụ huynh/ }) as HTMLInputElement;
    expect(sdt.hasAttribute("data-chi-doc")).toBe(true);
    expect(sdt.readOnly).toBe(true);
    const ten = screen.getByRole("textbox", { name: "Họ và tên học sinh" });
    expect(ten.hasAttribute("data-chi-doc")).toBe(false);
  });
});
