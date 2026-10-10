// @vitest-environment jsdom
// components/hoc-bu/diem-danh-be.test.tsx — T16: màn điểm danh hai tầng của buổi dạy bù, render THẬT.
//
// Vì sao render thật: luật "có mặt ⇒ vẫn phải chọn xong/chưa xong TỪNG bài" nằm trong state của component (nút đã bấm hay chưa), không ở hàm nào
// test thuần với tới được. Test này khẳng định thứ người dùng THẤY và thứ action NHẬN.
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Hộp thoại phiếu (dùng chung với site giáo viên) import server action lưu phiếu buổi chính — chặn ở đây; đường lưu học bù đi qua `luuPhieu`.
vi.mock("@/app/(admin)/admin/sessions/[id]/_actions", () => ({ saveSessionEval: vi.fn() }));

import { DiemDanhBe, type HanhDongBe } from "@/components/hoc-bu/diem-danh-be";
import type { BeChiTiet, MucChiTiet } from "@/lib/hoc-bu/case-chi-tiet";

const muc = (id: string, tenBai: string, over: Partial<MucChiTiet> = {}): MucChiTiet => ({
  id,
  makeupNeedId: `need-${id}`,
  lessonId: `l-${id}`,
  tenBai,
  result: "PLANNED",
  danhGia: null,
  rubric: null,
  duAn: "Dự án thử",
  cachXep: "LUOT",
  ngayVang: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

const BOI_CANH = { khoa: "Sata 3", ngayHienThi: "15/10/2026" };

const be = (over: Partial<BeChiTiet> = {}): BeChiTiet => ({
  id: "p1",
  studentId: "s1",
  hocVien: "Nguyễn An",
  lop: ["Sata 3 · Thứ 2"],
  status: "PENDING",
  version: 4,
  nhanXetChung: null,
  muc: [muc("m5", "Bài 5"), muc("m6", "Bài 6"), muc("m7", "Bài 7")],
  mucDaNha: [],
  ...over,
});

function hanhDong(over: Partial<HanhDongBe> = {}): HanhDongBe & { diemDanh: ReturnType<typeof vi.fn> } {
  return {
    diemDanh: vi.fn(async () => ({ ok: true as const })),
    sua: vi.fn(async () => ({ ok: true as const })),
    luuPhieu: vi.fn(async () => ({ ok: true as const })),
    goBe: vi.fn(async () => ({ ok: true as const })),
    ...over,
  } as HanhDongBe & { diemDanh: ReturnType<typeof vi.fn> };
}

const nhomBai = (ten: string) => screen.getByRole("group", { name: `Kết quả ${ten}` });
const bam = (ten: string, nut: string) => fireEvent.click(within(nhomBai(ten)).getByRole("button", { name: nut }));

beforeEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("[DDB-UI] điểm danh hai tầng", () => {
  it("[DDB-UI-01] bé chờ điểm danh: mỗi bài có cặp nút Xong / Chưa xong, chưa chọn nút nào", () => {
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hanhDong()} />);
    for (const ten of ["Bài 5", "Bài 6", "Bài 7"]) {
      const g = nhomBai(ten);
      for (const b of within(g).getAllByRole("button")) expect(b).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("[DDB-UI-02] có mặt khi chưa chọn kết quả từng bài ⇒ KHÔNG gọi action, nói bài nào còn thiếu", async () => {
    const hd = hanhDong();
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hd} />);
    bam("Bài 5", "Đã học xong");
    fireEvent.click(screen.getByRole("button", { name: /Có mặt — lưu kết quả/ }));
    const canh = await screen.findByRole("alert");
    expect(canh).toHaveTextContent("Bài 6, Bài 7");
    expect(canh).not.toHaveTextContent("Bài 5");
    expect(hd.diemDanh).not.toHaveBeenCalled();
  });

  it("[DDB-UI-03] chọn 5 và 6 xong, 7 chưa xong ⇒ action nhận ĐÚNG từng bài (không suy từ có mặt); điểm danh KHÔNG còn ô chữ nhận xét", async () => {
    const hd = hanhDong();
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hd} />);
    bam("Bài 5", "Đã học xong");
    bam("Bài 6", "Đã học xong");
    bam("Bài 7", "Chưa xong");
    // Nhận xét là PHIẾU lập SAU khi lưu điểm danh (như bên giáo viên) — form điểm danh không có ô chữ nào cho bài.
    expect(screen.queryByLabelText(/Đánh giá Bài/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Có mặt — lưu kết quả/ }));
    await waitFor(() => expect(hd.diemDanh).toHaveBeenCalledTimes(1));
    expect(hd.diemDanh).toHaveBeenCalledWith({
      participantId: "p1",
      coMat: true,
      ketQuaMuc: {
        m5: { ketQua: "COMPLETED", danhGia: null },
        m6: { ketQua: "COMPLETED", danhGia: null },
        m7: { ketQua: "NOT_COMPLETED", danhGia: null },
      },
      nhanXetChung: null,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("[DDB-UI-04] Vắng ⇒ gửi coMat=false với ketQuaMuc rỗng, không đòi chọn bài", async () => {
    const hd = hanhDong();
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hd} />);
    fireEvent.click(screen.getByRole("button", { name: /^Vắng$/ }));
    await waitFor(() => expect(hd.diemDanh).toHaveBeenCalledWith({ participantId: "p1", coMat: false, ketQuaMuc: {}, nhanXetChung: null }));
  });

  it("[DDB-UI-05] action từ chối ⇒ hiện lỗi của máy chủ, không làm mới trang như đã lưu", async () => {
    const hd = hanhDong({ diemDanh: vi.fn(async () => ({ ok: false as const, error: "Chưa tới giờ dạy bù" })) });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be({ muc: [muc("m5", "Bài 5")] })]} moDiemDanh coTheNhap hanhDong={hd} />);
    bam("Bài 5", "Chưa xong");
    fireEvent.click(screen.getByRole("button", { name: /Có mặt — lưu kết quả/ }));
    expect(await screen.findByText("Chưa tới giờ dạy bù")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("[DDB-UI-06] mất kết nối (action ném) ⇒ báo 'chưa lưu được', không im lặng", async () => {
    const hd = hanhDong({ diemDanh: vi.fn(async () => { throw new Error("net"); }) });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be({ muc: [muc("m5", "Bài 5")] })]} moDiemDanh coTheNhap hanhDong={hd} />);
    bam("Bài 5", "Đã học xong");
    fireEvent.click(screen.getByRole("button", { name: /Có mặt — lưu kết quả/ }));
    expect(await screen.findByText(/chưa lưu được/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("[DDB-UI-07] chỉ XEM (Sale): không có nút điểm danh / sửa / đánh giá; kết quả và đánh giá vẫn đọc được", () => {
    const b = be({
      status: "PRESENT",
      muc: [muc("m5", "Bài 5", { result: "COMPLETED", danhGia: "Rất tốt" }), muc("m6", "Bài 6", { result: "NOT_COMPLETED" })],
    });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap={false} hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Rất tốt")).toBeInTheDocument();
    expect(screen.getByText("Đã học xong")).toBeInTheDocument();
    expect(screen.getByText(/Chưa xong — sẽ xếp bù lại/)).toBeInTheDocument();
  });

  it("[DDB-UI-07b] chỉ XEM mà bé còn CHỜ điểm danh: không nút điểm danh / vắng / gỡ, không ô đánh giá — chỉ nhãn trạng thái", () => {
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap={false} hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Chờ điểm danh")).toBeInTheDocument();
    expect(screen.getAllByText("Chờ học")).toHaveLength(3);
  });

  it("[DDB-UI-08] không có `hanhDong.sua` (không quyền sửa) ⇒ bé đã điểm danh KHÔNG có nút Sửa điểm danh", () => {
    const b = be({ status: "PRESENT", muc: [muc("m5", "Bài 5", { result: "COMPLETED" })] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap hanhDong={hanhDong({ sua: undefined })} />);
    expect(screen.queryByRole("button", { name: /Sửa điểm danh/ })).toBeNull();
  });

  it("[DDB-UI-09] sửa điểm danh: lý do dưới 10 ký tự ⇒ KHÔNG gọi; đủ ⇒ gửi kèm phiên bản và lý do", async () => {
    const hd = hanhDong();
    const b = be({ status: "PRESENT", version: 7, muc: [muc("m5", "Bài 5", { result: "NOT_COMPLETED" })] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap hanhDong={hd} />);
    fireEvent.click(screen.getByRole("button", { name: /Sửa điểm danh/ }));
    bam("Bài 5", "Đã học xong");
    fireEvent.change(screen.getByLabelText(/Lý do sửa điểm danh/), { target: { value: "ngắn quá" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu: có mặt/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lý do sửa");
    expect(hd.sua).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Lý do sửa điểm danh/), { target: { value: "Giáo viên bấm nhầm bài" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu: có mặt/ }));
    await waitFor(() => expect(hd.sua).toHaveBeenCalledTimes(1));
    expect(hd.sua).toHaveBeenCalledWith({
      participantId: "p1",
      coMat: true,
      ketQuaMuc: { m5: { ketQua: "COMPLETED", danhGia: null } },
      nhanXetChung: null,
      phienBan: 7,
      lyDo: "Giáo viên bấm nhầm bài",
    });
  });

  it("[DDB-UI-10] sửa thành VẮNG: không đòi kết quả từng bài, gửi coMat=false", async () => {
    const hd = hanhDong();
    const b = be({ status: "PRESENT", muc: [muc("m5", "Bài 5", { result: "COMPLETED" })] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap hanhDong={hd} />);
    fireEvent.click(screen.getByRole("button", { name: /Sửa điểm danh/ }));
    fireEvent.change(screen.getByLabelText(/Lý do sửa điểm danh/), { target: { value: "Bé thực ra không tới lớp" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu: vắng/ }));
    await waitFor(() => expect(hd.sua).toHaveBeenCalledTimes(1));
    expect(hd.sua).toHaveBeenCalledWith(expect.objectContaining({ coMat: false, ketQuaMuc: {}, phienBan: b.version }));
  });

  it("[DDB-UI-10b] sửa thành VẮNG khi có bài CHƯA có kết quả (PLANNED): vẫn lưu được — vắng không cần kết quả bài nào", async () => {
    const hd = hanhDong();
    const b = be({ status: "PRESENT", muc: [muc("m5", "Bài 5", { result: "COMPLETED" }), muc("m6", "Bài 6", { result: "PLANNED" })] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap hanhDong={hd} />);
    fireEvent.click(screen.getByRole("button", { name: /Sửa điểm danh/ }));
    fireEvent.change(screen.getByLabelText(/Lý do sửa điểm danh/), { target: { value: "Bé thực ra không tới lớp" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu: vắng/ }));
    await waitFor(() => expect(hd.sua).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    // Cùng tình huống nhưng chọn 'có mặt' thì PHẢI bị chặn vì Bài 6 chưa có kết quả.
    cleanup();
    const hd2 = hanhDong();
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap hanhDong={hd2} />);
    fireEvent.click(screen.getByRole("button", { name: /Sửa điểm danh/ }));
    fireEvent.change(screen.getByLabelText(/Lý do sửa điểm danh/), { target: { value: "Bé thực ra có tới lớp" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu: có mặt/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bài 6");
    expect(hd2.sua).not.toHaveBeenCalled();
  });

  it("[DDB-UI-11] PHIẾU nhận xét: bài đã có kết quả có nút 'Nhận xét' (chưa phiếu) / 'Xem phiếu' + Xuất PDF (đã phiếu); lưu gửi đánh giá chung + bảng 9 tiêu chí, KHÔNG đụng điểm danh", async () => {
    const hd = hanhDong();
    const b = be({
      status: "PRESENT",
      muc: [muc("m5", "Bài 5", { result: "COMPLETED", danhGia: "Tạm ổn", rubric: { a: 4 } }), muc("m6", "Bài 6", { result: "NOT_COMPLETED" })],
    });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh={false} coTheNhap hanhDong={hd} />);
    // Bài 5 đã có phiếu ⇒ 'Xem phiếu' + link PDF; bài 6 chưa ⇒ 'Nhận xét', không PDF.
    expect(screen.getAllByRole("button", { name: /Xem phiếu/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Nhận xét/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /Xuất PDF/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Xuất PDF/ })).toHaveAttribute("href", "/hoc-bu/phieu/m5");
    // Lập phiếu bài 6.
    fireEvent.click(screen.getByRole("button", { name: /^Nhận xét/ }));
    fireEvent.change(screen.getByLabelText(/Đánh giá chung/), { target: { value: "Cần luyện thêm" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu nhận xét/ }));
    await waitFor(() => expect(hd.luuPhieu).toHaveBeenCalledTimes(1));
    const goi = vi.mocked(hd.luuPhieu!).mock.calls[0]![0];
    expect(goi).toMatchObject({ caseStudentId: "m6", danhGia: "Cần luyện thêm" });
    expect(Object.keys(goi.rubric)).toHaveLength(9); // đủ 9 tiêu chí — cùng hình dạng phiếu buổi chính
    expect(hd.sua).not.toHaveBeenCalled();
    expect(hd.diemDanh).not.toHaveBeenCalled();
  });

  it("[DDB-UI-12] không lập được phiếu khi chưa điểm danh / bài chưa có kết quả; Sale (chỉ xem) thấy trạng thái + PDF, không có nút lập", () => {
    const chuaDiemDanh = be({ status: "PENDING" });
    const { unmount } = render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[chuaDiemDanh]} moDiemDanh={false} coTheNhap hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button", { name: /Nhận xét|Xem phiếu/ })).toBeNull();
    unmount();
    const daCoPhieu = be({ status: "PRESENT", muc: [muc("m5", "Bài 5", { result: "COMPLETED", danhGia: "Tạm ổn" }), muc("m6", "Bài 6", { result: "COMPLETED" })] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[daCoPhieu]} moDiemDanh={false} coTheNhap={false} hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Đã nhận xét")).toBeInTheDocument();
    expect(screen.getByText("Chưa nhận xét")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Xuất PDF/ })).toHaveLength(1); // chỉ bài ĐÃ có phiếu
  });

  it("[DDB-UI-13] gỡ bé: chỉ khi có `goBe`, và chỉ trước khi điểm danh", async () => {
    const hd = hanhDong();
    const { unmount } = render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hd} />);
    fireEvent.click(screen.getByRole("button", { name: /Gỡ bé khỏi case/ }));
    await waitFor(() => expect(hd.goBe).toHaveBeenCalledWith("p1"));
    unmount();
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hanhDong({ goBe: undefined })} />);
    expect(screen.queryByRole("button", { name: /Gỡ bé khỏi case/ })).toBeNull();
  });

  it("[DDB-UI-14] bé đã điểm danh KHÔNG hiện lại form điểm danh lần đầu", () => {
    const b = be({ status: "ABSENT", muc: [muc("m5", "Bài 5", { result: "RELEASED" })] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b]} moDiemDanh coTheNhap hanhDong={hanhDong()} />);
    expect(screen.queryByRole("button", { name: /Có mặt — lưu kết quả/ })).toBeNull();
    expect(screen.getByText("Vắng")).toBeInTheDocument();
  });

  it("[DDB-UI-15] bài đã nhả khỏi case được nói rõ là quay lại danh sách cần bù; bé bị gỡ chỉ liệt kê", () => {
    const b = be({ mucDaNha: [muc("m9", "Bài 9", { result: "RELEASED" })] });
    const go = be({ id: "p2", hocVien: "Trần Bình", status: "REMOVED", muc: [] });
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[b, go]} moDiemDanh coTheNhap hanhDong={hanhDong()} />);
    expect(screen.getByText(/Đã nhả khỏi case: Bài 9/)).toBeInTheDocument();
    expect(screen.getByText(/Đã gỡ khỏi case: Trần Bình/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Học viên Trần Bình")).toBeNull();
  });

  it("[DDB-UI-16] mọi nút thao tác cao ≥ 44px (min-h-11) để GV bấm bằng ngón tay trong lớp", () => {
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[be()]} moDiemDanh coTheNhap hanhDong={hanhDong()} />);
    for (const nut of screen.getAllByRole("button")) expect(nut.className, nut.textContent ?? "").toMatch(/min-h-11/);
  });

  it("[DDB-UI-17] case trống ⇒ nói thẳng, không vẽ danh sách rỗng", () => {
    render(<DiemDanhBe boiCanh={BOI_CANH} hrefPhieuGoc="/hoc-bu/phieu/" be={[]} moDiemDanh coTheNhap hanhDong={hanhDong()} />);
    expect(screen.getByText("Case chưa có học viên nào.")).toBeInTheDocument();
  });
});
