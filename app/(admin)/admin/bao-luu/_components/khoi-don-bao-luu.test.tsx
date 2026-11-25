// @vitest-environment jsdom
/**
 * [MDU-*] `<KhoiDonBaoLuu/>` — khối "Bước 1: In đơn cho phụ huynh ký". Test HÀNH VI của giao diện (không grep mã):
 *  · nút khoá kèm LÝ DO nói đúng nguyên nhân (cơ sở chưa có mẫu / chưa chọn khoá) — không vẽ nút rồi để người ta bấm mới biết;
 *  · điền sẵn theo form; ô Sale đã sửa tay GIỮ khi form đổi, ô chưa đụng thì đi theo form; "Điền lại" bỏ chỉnh tay;
 *  · tải .docx gửi ĐÚNG bộ giá trị đang hiện (một nguồn cho cả giấy lẫn file).
 * Luật điền/mẫu ở `lib/bao-luu/mau-don.test.ts`; cổng quyền của route ở `app/api/admin/bao-luu/mau-don/route.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { KhoiDonBaoLuu, type DuLieuDonChoForm } from "./khoi-don-bao-luu";

const DU: DuLieuDonChoForm = {
  maMau: "CS1",
  hocVien: { hoTen: "Trần Minh Khang", ma: "HV0042", ngaySinhYmd: "2016-03-12" },
  phuHuynh: { hoTen: "Nguyễn Thị Lan", quanHe: "Mẹ", dienThoai: "0905123456", email: null },
  ghiDanh: [
    { id: "g1", tenKhoa: "Sata 3", tenLop: "Lớp A", maLop: "CS1.03", giaoVien: "GV A" },
    { id: "g2", tenKhoa: "Sata 4", tenLop: "Lớp B", maLop: "CS1.05", giaoVien: null },
    // Hai khoá NGẮN theo nghĩa của giấy (mã lớp ngắn, cùng một giáo viên): mọi ô còn vừa ⇒ không danh sách.
    { id: "g5", tenKhoa: "Sata 3", tenLop: "Lớp E", maLop: "03", giaoVien: "GV A" },
    { id: "g6", tenKhoa: "Sata 4", tenLop: "Lớp F", maLop: "05", giaoVien: "GV A" },
    // Hai khoá dài để dựng ca "ô vượt ⇒ danh sách bên dưới".
    { id: "g3", tenKhoa: "Sata 5 — Điện tử cơ bản và cảm biến", tenLop: "Lớp C", maLop: "CS1.07", giaoVien: "Trần Tuấn Kiệt" },
    { id: "g4", tenKhoa: "Sata 6 — Lập trình điều khiển nâng cao", tenLop: "Lớp D", maLop: "CS1.09", giaoVien: "Nguyễn Bích Trà" },
  ],
};
const FORM = { chon: ["g1"], lyDo: "FAMILY" as const, ghiChu: "", ngayHenBatDau: "", ngayQuayLai: "2027-01-20", ngayNghiDau: "" };

const o = (khoa: string) => document.getElementById(`bl-don-${khoa}`) as HTMLInputElement;
const nutIn = () => screen.getByRole("button", { name: /Xem và in đơn/ }) as HTMLButtonElement;
const nutDocx = () => screen.getByRole("button", { name: /Tải file Word/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("[MDU-01] khoá nút kèm lý do đúng nguyên nhân", () => {
  it("cơ sở chưa có mẫu ⇒ cả hai nút khoá + câu nói rõ; KHÔNG rơi về mẫu khác", () => {
    render(<KhoiDonBaoLuu studentId="hv1" du={{ ...DU, maMau: null }} form={FORM} />);
    expect(nutIn().disabled).toBe(true);
    expect(nutDocx().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/chưa có mẫu đơn bảo lưu/);
  });

  it("vừa thiếu mẫu vừa chưa chọn khoá ⇒ nói THIẾU MẪU (chọn khoá xong vẫn không in được thì lời nhắc 'chọn khoá' là lời hứa suông)", () => {
    render(<KhoiDonBaoLuu studentId="hv1" du={{ ...DU, maMau: null }} form={{ ...FORM, chon: [] }} />);
    expect(screen.getByRole("status").textContent).toMatch(/chưa có mẫu đơn bảo lưu/);
    expect(screen.getByRole("status").textContent).not.toMatch(/Chọn khoá/);
  });

  it("chưa chọn khoá ⇒ khoá nút, lý do là 'chọn khoá'; chọn rồi ⇒ mở", () => {
    const { rerender } = render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={{ ...FORM, chon: [] }} />);
    expect(nutIn().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Chọn khoá bảo lưu/);
    rerender(<KhoiDonBaoLuu studentId="hv1" du={DU} form={FORM} />);
    expect(nutIn().disabled).toBe(false);
    expect(nutDocx().disabled).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("[MDU-02] điền sẵn và chỉnh tay", () => {
  it("điền theo hồ sơ + form; 'Bảo lưu từ ngày' để trống khi không hẹn; lý do FAMILY được tích", () => {
    render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={FORM} />);
    expect(o("ph.hoTen").value).toBe("Nguyễn Thị Lan");
    expect(o("hv.ngaySinh").value).toBe("12/03/2016");
    expect(o("hv.khoa").value).toBe("Sata 3");
    expect(o("tg.hocLaiDuKien").value).toBe("20/01/2027");
    expect(o("tg.baoLuuTu").value).toBe("");
    expect((screen.getByLabelText("Gia đình có việc dài ngày") as HTMLInputElement).checked).toBe(true);
  });

  it("ô đã sửa tay GIỮ khi form đổi; ô chưa đụng theo form; 'Điền lại' bỏ chỉnh tay", () => {
    const { rerender } = render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={FORM} />);
    fireEvent.change(o("ph.quanHe"), { target: { value: "Mẹ ruột" } });
    expect(screen.getByText("(đã sửa tay)")).toBeTruthy();
    rerender(<KhoiDonBaoLuu studentId="hv1" du={DU} form={{ ...FORM, chon: ["g5", "g6"], ngayQuayLai: "2027-02-01" }} />);
    expect(o("ph.quanHe").value).toBe("Mẹ ruột");
    expect(o("hv.khoa").value).toBe("Sata 3 (lớp 03); Sata 4 (lớp 05)");
    expect(o("tg.hocLaiDuKien").value).toBe("01/02/2027");
    fireEvent.click(screen.getByRole("button", { name: "Điền lại từ hồ sơ" }));
    expect(o("ph.quanHe").value).toBe("Mẹ");
    expect(screen.queryByText("(đã sửa tay)")).toBeNull();
  });

  it("tích thêm một ô lý do như trên giấy (nhiều ô)", () => {
    render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={FORM} />);
    fireEvent.click(screen.getByLabelText("Ốm đau, sức khỏe (*)"));
    expect((screen.getByLabelText("Ốm đau, sức khỏe (*)") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Gia đình có việc dài ngày") as HTMLInputElement).checked).toBe(true);
  });

  it("giá trị quá dài cho một cột ⇒ cảnh báo lệch dòng (không chặn)", () => {
    render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={FORM} />);
    fireEvent.change(o("hv.lop"), { target: { value: "L".repeat(60) } });
    expect(screen.getByText(/Word sẽ lệch dòng/)).toBeTruthy();
    expect(nutDocx().disabled).toBe(false);
  });
});

describe("[MDU-04] khoá dài: ô ghi câu trỏ + danh sách khoá sửa được", () => {
  const BA = { ...FORM, chon: ["g1", "g3", "g4"] };
  const ds = () => document.getElementById("bl-don-ds") as HTMLTextAreaElement | null;

  it("hai khoá ngắn: không có ô danh sách; ba khoá dài: ô ghi câu trỏ và hiện danh sách từng khoá", () => {
    const { rerender } = render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={{ ...FORM, chon: ["g5", "g6"] }} />);
    expect(ds()).toBeNull();
    rerender(<KhoiDonBaoLuu studentId="hv1" du={DU} form={BA} />);
    expect(o("hv.khoa").value).toBe("Xem danh sách khoá bên dưới");
    expect(ds()!.value.split("\n")).toEqual([
      "Sata 3 (lớp CS1.03) — GV: GV A",
      "Sata 5 — Điện tử cơ bản và cảm biến (lớp CS1.07) — GV: Trần Tuấn Kiệt",
      "Sata 6 — Lập trình điều khiển nâng cao (lớp CS1.09) — GV: Nguyễn Bích Trà",
    ]);
  });

  it("hơn 4 khoá: cảnh báo đơn sẽ sang trang hai; đúng 3 khoá thì không", () => {
    const { rerender } = render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={BA} />);
    expect(screen.queryByText(/Hơn 4 khoá/)).toBeNull();
    rerender(<KhoiDonBaoLuu studentId="hv1" du={DU} form={{ ...FORM, chon: ["g1", "g2", "g3", "g4", "g5"] }} />);
    expect(screen.getByText(/Hơn 4 khoá: đơn sẽ sang trang hai/)).toBeTruthy();
  });

  it("sửa tay ô khỏi câu trỏ ⇒ ô danh sách biến mất (không in khối lạc chỗ)", () => {
    render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={BA} />);
    fireEvent.change(o("hv.khoa"), { target: { value: "Sata 3, 5, 6" } });
    fireEvent.change(o("hv.giaoVien"), { target: { value: "Ba giáo viên" } });
    expect(ds()).toBeNull();
  });

  it("tải .docx gửi cả danh sách đã sửa tay", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(new Response("{}", { status: 500 }));
    render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={BA} />);
    fireEvent.change(ds()!, { target: { value: "Dòng một\nDòng hai" } });
    fireEvent.click(nutDocx());
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.don.danhSachKhoa).toEqual(["Dòng một", "Dòng hai"]);
    expect(body.don.hocVien.khoa).toBe("Xem danh sách khoá bên dưới");
  });
});

describe("[MDU-03] tải .docx gửi đúng bộ giá trị đang hiện", () => {
  it("POST đúng studentId + giá trị đã sửa tay; lỗi từ server hiện nguyên văn, không tải gì", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(new Response(JSON.stringify({ error: "Mẫu đơn của cơ sở này đã đổi cấu trúc nên chưa điền được. Báo người vận hành." }), { status: 500 }));
    const { toast } = await import("sonner");
    render(<KhoiDonBaoLuu studentId="hv1" du={DU} form={FORM} />);
    fireEvent.change(o("ph.quanHe"), { target: { value: "Bà ngoại" } });
    fireEvent.click(nutDocx());
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/admin/bao-luu/mau-don");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.studentId).toBe("hv1");
    expect(body.don.phuHuynh.quanHe).toBe("Bà ngoại");
    expect(body.don.hocVien.khoa).toBe("Sata 3");
    expect(body.don.lyDo).toEqual(["FAMILY"]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("đã đổi cấu trúc")));
  });
});
