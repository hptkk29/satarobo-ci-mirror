// @vitest-environment jsdom
// Khung "Thêm thành viên / Thêm đồng loạt" — chọn người, lọc, chọn TỪNG nhóm lớp, gửi đúng id.
//
// Phần quyền và ghi DB nằm ở tests/chat/members-admin.spec.ts; ở đây khoá HÀNH VI giao diện:
//   • lọc theo nhóm vai / cơ sở / từ khoá (có bỏ dấu) ra đúng người;
//   • "Chọn … đang lọc" chỉ chọn những người ĐANG HIỆN, không chọn cả danh sách;
//   • người đã ở trong nhóm (chế độ một nhóm) bị khoá — không chọn thêm được;
//   • gửi đúng `conversationIds` + `userIds`; nút xám khi thiếu người/nhóm;
//   • lỗi theo nhóm hiển thị riêng, không nuốt cả lượt.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { refresh, listStaff, listGroups, addMembers, toastSuccess, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  listStaff: vi.fn(),
  listGroups: vi.fn(),
  addMembers: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/chat/_actions", () => ({
  listAddableStaffAction: listStaff,
  listAddableGroupsAction: listGroups,
  addMembersAction: addMembers,
}));

import { AddMembersSheet, chuanHoa } from "./add-members-sheet";

const STAFF = [
  { userId: "u-van", name: "Tô Thị Thuý Vân", roleLabels: ["Quản lý lớp học"], buckets: ["GIAO_VU", "SALE"], centerId: "cs2", centerName: "Cơ sở Hoàng Diệu" },
  { userId: "u-diep", name: "Huỳnh Thị Diệu", roleLabels: ["Quản lý lớp học"], buckets: ["GIAO_VU", "SALE"], centerId: "cs1", centerName: "Cơ sở Nguyễn Hữu Thọ" },
  { userId: "u-trang", name: "Dương Thị Mỹ Trang", roleLabels: ["Quản lý cơ sở"], buckets: ["QLCS"], centerId: null, centerName: null },
  { userId: "u-gv", name: "Hoàng Phan Tuấn Kiệt", roleLabels: ["Giáo viên"], buckets: ["GIAO_VIEN"], centerId: "cs2", centerName: "Cơ sở Hoàng Diệu" },
];
const GROUPS = [
  { conversationId: "c1", title: "sata4.18h.T4.CS2", status: "ACTIVE", centerId: "cs2", centerName: "Cơ sở Hoàng Diệu", memberCount: 7 },
  { conversationId: "c2", title: "sata3.14h.CN.CS2", status: "ACTIVE", centerId: "cs2", centerName: "Cơ sở Hoàng Diệu", memberCount: 5 },
  { conversationId: "c3", title: "sata6.9h.T7.CS1", status: "ACTIVE", centerId: "cs1", centerName: "Cơ sở Nguyễn Hữu Thọ", memberCount: 9 },
];

function mount(mode: Parameters<typeof AddMembersSheet>[0]["mode"] = { kind: "bulk" }) {
  return render(<AddMembersSheet mode={mode} open onOpenChange={() => {}} />);
}

/** Danh sách có `aria-label` (mỗi vế của khung là một <ul> riêng). */
const people = () => screen.getByRole("list", { name: "Danh sách nhân viên" });
const groups = () => screen.getByRole("list", { name: "Danh sách nhóm lớp" });

beforeEach(() => {
  vi.clearAllMocks();
  listStaff.mockResolvedValue({ ok: true, data: { staff: STAFF, alreadyIn: [] } });
  listGroups.mockResolvedValue({ ok: true, data: GROUPS });
  addMembers.mockResolvedValue({
    ok: true,
    data: {
      addedTotal: 2,
      groups: [
        { conversationId: "c1", title: "sata4.18h.T4.CS2", added: 2, alreadyIn: 0, error: null },
        { conversationId: "c3", title: "sata6.9h.T7.CS1", added: 0, alreadyIn: 0, error: { code: "CONVERSATION_ARCHIVED", message: "Lớp đã kết thúc — nhóm chỉ để xem lại." } },
      ],
    },
  });
});

describe("chuanHoa", () => {
  it("[AMS-01] bỏ dấu + đ để gõ 'van' ra 'Vân', 'dieu' ra 'Diệu'", () => {
    expect(chuanHoa("Tô Thị Thuý Vân")).toBe("to thi thuy van");
    expect(chuanHoa("Điệu")).toBe("dieu");
  });
});

describe("AddMembersSheet — đồng loạt", () => {
  it("[AMS-02] tải danh sách một lần khi mở và hiện cả hai vế (Người · Nhóm lớp)", async () => {
    mount();
    expect(await within(people()).findByText("Tô Thị Thuý Vân")).toBeTruthy();
    expect(within(groups()).getByText("sata4.18h.T4.CS2")).toBeTruthy();
    expect(listStaff).toHaveBeenCalledTimes(1);
    expect(listGroups).toHaveBeenCalledTimes(1);
  });

  it("[AMS-03] lọc theo nhóm vai: bấm 'Quản lý cơ sở' chỉ còn chị Trang", async () => {
    mount();
    await within(people()).findByText("Tô Thị Thuý Vân");
    fireEvent.click(screen.getByRole("button", { name: "Quản lý cơ sở" }));
    expect(within(people()).getByText("Dương Thị Mỹ Trang")).toBeTruthy();
    expect(within(people()).queryByText("Tô Thị Thuý Vân")).toBeNull();
  });

  it("[AMS-04] lọc theo từ khoá KHÔNG DẤU: gõ 'dieu' ra Huỳnh Thị Diệu", async () => {
    mount();
    await within(people()).findByText("Tô Thị Thuý Vân");
    fireEvent.change(screen.getByLabelText("Tìm nhân viên"), { target: { value: "dieu" } });
    expect(within(people()).getByText("Huỳnh Thị Diệu")).toBeTruthy();
    expect(within(people()).queryByText("Dương Thị Mỹ Trang")).toBeNull();
  });

  it("[AMS-05] 'Chọn N người đang lọc' chỉ chọn những người ĐANG HIỆN, không chọn cả danh sách", async () => {
    mount();
    await within(people()).findByText("Tô Thị Thuý Vân");
    fireEvent.click(screen.getByRole("button", { name: "Giáo vụ" }));
    fireEvent.click(screen.getByRole("button", { name: /Chọn 2 người đang lọc/ }));
    const boxes = within(people()).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.checked)).toBe(true);
    // Bỏ lọc: hai người kia (Trang, Kiệt) KHÔNG được chọn kèm.
    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    const all = within(people()).getAllByRole("checkbox") as HTMLInputElement[];
    expect(all.filter((b) => b.checked)).toHaveLength(2);
  });

  it("[AMS-06] nút 'Thêm vào nhóm' xám cho tới khi có CẢ người lẫn nhóm", async () => {
    mount();
    await within(people()).findByText("Tô Thị Thuý Vân");
    const submit = screen.getByRole("button", { name: /Thêm vào nhóm/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(people()).getByText("Tô Thị Thuý Vân"));
    expect(submit.disabled).toBe(true); // mới có người, chưa có nhóm
    fireEvent.click(within(groups()).getByText("sata4.18h.T4.CS2"));
    expect(submit.disabled).toBe(false);
  });

  it("[AMS-07] chọn từng nhóm lớp + lọc cơ sở rồi chọn 'đang lọc' ⇒ gửi đúng id", async () => {
    mount();
    await within(people()).findByText("Tô Thị Thuý Vân");
    fireEvent.click(within(people()).getByText("Tô Thị Thuý Vân"));
    fireEvent.click(within(people()).getByText("Dương Thị Mỹ Trang"));
    // Hai chip cơ sở xuất hiện ở vế nhóm (có ≥2 cơ sở).
    fireEvent.click(screen.getByRole("button", { name: "Cơ sở Hoàng Diệu" }));
    fireEvent.click(screen.getByRole("button", { name: /Chọn 2 nhóm đang lọc/ }));
    fireEvent.click(screen.getByRole("button", { name: /Thêm vào nhóm/ }));

    await waitFor(() => expect(addMembers).toHaveBeenCalledTimes(1));
    const arg = addMembers.mock.calls[0]![0] as { conversationIds: string[]; userIds: string[] };
    expect([...arg.conversationIds].sort()).toEqual(["c1", "c2"]); // KHÔNG có c3 (CS1)
    expect([...arg.userIds].sort()).toEqual(["u-trang", "u-van"]);
  });

  it("[AMS-08] kết quả theo từng nhóm: nhóm lỗi hiện lỗi riêng, nhóm thành công hiện số người thêm", async () => {
    mount();
    await within(people()).findByText("Tô Thị Thuý Vân");
    fireEvent.click(within(people()).getByText("Tô Thị Thuý Vân"));
    fireEvent.click(within(groups()).getByText("sata4.18h.T4.CS2"));
    fireEvent.click(within(groups()).getByText("sata6.9h.T7.CS1"));
    fireEvent.click(screen.getByRole("button", { name: /Thêm vào nhóm/ }));

    expect(await screen.findByText(/1 nhóm không thêm được/)).toBeTruthy();
    expect(screen.getByText("Lớp đã kết thúc — nhóm chỉ để xem lại.")).toBeTruthy();
    expect(screen.getByText("Thêm 2")).toBeTruthy();
    expect(refresh).toHaveBeenCalled(); // màn phía sau cập nhật số thành viên
  });
});

describe("AddMembersSheet — một nhóm", () => {
  it("[AMS-09] chế độ một nhóm: KHÔNG có vế chọn nhóm; người đã trong nhóm bị khoá", async () => {
    listStaff.mockResolvedValue({ ok: true, data: { staff: STAFF, alreadyIn: ["u-gv"] } });
    mount({ kind: "single", conversationId: "c1", conversationTitle: "sata4.18h.T4.CS2" });
    await within(people()).findByText("Tô Thị Thuý Vân");
    expect(screen.queryByRole("list", { name: "Danh sách nhóm lớp" })).toBeNull();
    expect(listGroups).not.toHaveBeenCalled();
    expect(listStaff).toHaveBeenCalledWith("c1");
    const row = within(people()).getByText("Hoàng Phan Tuấn Kiệt").closest("label")!;
    const box = within(row as HTMLElement).getByRole("checkbox") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(within(row as HTMLElement).getByText("Đã trong nhóm")).toBeTruthy();
  });

  it("[AMS-10] lỗi tải danh sách hiện thông báo + nút Thử lại, không treo ở 'Đang tải'", async () => {
    listStaff.mockResolvedValueOnce({ ok: false, error: { code: "PERMISSION_DENIED", message: "Chỉ quản trị viên được thêm hoặc gỡ thành viên nhóm." } });
    mount({ kind: "single", conversationId: "c1", conversationTitle: "x" });
    expect(await screen.findByText(/Chỉ quản trị viên được thêm hoặc gỡ/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeTruthy();
  });
});
