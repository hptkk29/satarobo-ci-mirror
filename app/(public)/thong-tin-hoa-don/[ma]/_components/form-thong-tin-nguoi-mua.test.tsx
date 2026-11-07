// @vitest-environment jsdom
// Ca [FTT-*] — BIỂU MẪU công khai "thông tin người mua hoá đơn" (S11). jsdom + Server Action GIẢ. Mọi ca "KHÔNG được" kèm đối chứng dương.
//
// [02/11/2026 — chủ dự án] Biểu mẫu lấy theo khối «Người mua trên hoá đơn»: cá nhân BẮT BUỘC họ tên ba/mẹ · CCCD ba/mẹ · địa chỉ (tuỳ chọn SĐT, email, khối học viên);
// doanh nghiệp BẮT BUỘC tên · MST · địa chỉ · email. Ô nhạy cảm KHÔNG bao giờ được điền sẵn.
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ gui: vi.fn() }));
vi.mock("../_actions", () => ({ guiThongTinNguoiMuaAction: h.gui }));

import { FormThongTinNguoiMua } from "./form-thong-tin-nguoi-mua";
import { NHAN_DONG_Y, NOI_DUNG_QUYEN_RIENG_TU } from "../_hang-so";

const MA = "yeu-cau-1234.token";
const hoi = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const gõ = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const NHAN_TEN_CA_NHAN = "Họ và tên của ba/mẹ";
const NHAN_CCCD = /Số CCCD của ba\/mẹ/;
const NHAN_EMAIL = /Email nhận hoá đơn/;

function dienDu(o: { ten?: string; diaChi?: string; cccd?: string; dongY?: boolean } = {}) {
  gõ(hoi(/Họ và tên của ba\/mẹ|Tên doanh nghiệp/), o.ten ?? "Nguyễn Thị Phụ Huynh");
  gõ(hoi(/^Địa chỉ/), o.diaChi ?? "114 Hoàng Diệu, Đà Nẵng");
  if (screen.queryByLabelText(NHAN_CCCD)) gõ(hoi(NHAN_CCCD), o.cccd ?? "048123456789");
  if (o.dongY !== false) fireEvent.click(hoi(NHAN_DONG_Y));
}
const nutGui = () => screen.getByRole("button", { name: /Gửi thông tin|Đang gửi/ }) as HTMLButtonElement;

// ⚠️ Có ngoặc nhọn: `beforeEach(() => h.gui.mockReset())` TRẢ VỀ chính mock, và vitest coi hàm trả về từ beforeEach là việc dọn dẹp rồi GỌI nó sau ca — ca «mạng đứt» đỏ vì mock ném.
beforeEach(() => {
  h.gui.mockReset();
});
afterEach(cleanup);

describe("[FTT-01] cấu trúc: ô theo LOẠI người mua", () => {
  it("mặc định cá nhân: họ tên ba/mẹ + CCCD + SĐT + địa chỉ + email + khối học viên, KHÔNG có ô MST; chọn doanh nghiệp ⇒ nhãn đổi, HIỆN MST, ẩn ô của cá nhân; chọn lại cá nhân ⇒ ngược lại", () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    expect(hoi(NHAN_TEN_CA_NHAN)).toBeTruthy();
    expect(hoi(NHAN_CCCD)).toBeTruthy();
    expect(hoi(/Số điện thoại của ba\/mẹ/)).toBeTruthy();
    expect(hoi(/Họ và tên học viên/)).toBeTruthy();
    expect(hoi(/Ngày sinh học viên/)).toBeTruthy();
    expect(hoi(/Số CCCD của học viên/)).toBeTruthy();
    expect(screen.queryByLabelText(/Mã số thuế/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Doanh nghiệp"));
    expect(hoi("Tên doanh nghiệp")).toBeTruthy();
    expect(screen.queryByLabelText(NHAN_TEN_CA_NHAN)).toBeNull();
    expect(hoi(/Mã số thuế/)).toBeTruthy();
    for (const ẩn of [NHAN_CCCD, /Số điện thoại của ba\/mẹ/, /Họ và tên học viên/, /Ngày sinh học viên/, /Số CCCD của học viên/]) expect(screen.queryByLabelText(ẩn), String(ẩn)).toBeNull();
    fireEvent.click(screen.getByLabelText("Cá nhân"));
    expect(screen.queryByLabelText(/Mã số thuế/)).toBeNull();
    expect(hoi(NHAN_CCCD)).toBeTruthy();
  });
  it("CHỈ CCCD là giấy tờ tuỳ thân có mặt: không ô nào về CMND / hộ chiếu / giấy tờ khác — ở cả hai loại; ô CCCD không gợi ý tự điền của trình duyệt", () => {
    const { container } = render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    const CAM = /can.?cuoc|căn cước|cmnd|chứng minh|hộ chiếu|passport|giấy tờ|identity|national/i;
    const quet = () =>
      [...container.querySelectorAll("input,textarea,select")]
        .map((e) => [e.getAttribute("name"), e.id, e.getAttribute("placeholder"), e.getAttribute("autocomplete"), container.querySelector(`label[for="${e.id}"]`)?.textContent].join(" "))
        .join(" | ");
    expect(quet()).not.toMatch(CAM);
    fireEvent.click(screen.getByLabelText("Doanh nghiệp"));
    expect(quet()).not.toMatch(CAM);
    expect(quet()).toMatch(/o-mst/); // đối chứng: bộ quét thật sự nhìn thấy ô MST vừa hiện
    fireEvent.click(screen.getByLabelText("Cá nhân"));
    expect(hoi(NHAN_CCCD).getAttribute("autocomplete")).toBe("off");
    expect(hoi(NHAN_CCCD).getAttribute("inputmode")).toBe("numeric");
    expect([...container.querySelectorAll("input,textarea")].map((e) => e.getAttribute("name"))).toEqual(
      expect.arrayContaining(["loai", "ten", "cccd", "sdt", "diaChi", "email", "tenHocVien", "ngaySinhHocVien", "cccdHocVien", "dongY"]),
    );
  });
  it("mọi ô nhập có nhãn gắn bằng htmlFor/id (getByLabelText tìm được) và có autoComplete / inputMode đúng", () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    expect(hoi(NHAN_TEN_CA_NHAN).getAttribute("autocomplete")).toBe("name");
    expect(hoi(/^Địa chỉ/).getAttribute("autocomplete")).toBe("street-address");
    const email = hoi(NHAN_EMAIL);
    expect(email.type).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(hoi(/Số điện thoại của ba\/mẹ/).type).toBe("tel");
    expect(hoi(/Ngày sinh học viên/).type).toBe("date");
    fireEvent.click(screen.getByLabelText("Doanh nghiệp"));
    expect(hoi("Tên doanh nghiệp").getAttribute("autocomplete")).toBe("organization");
    expect(hoi(/Mã số thuế/).getAttribute("inputmode")).toBe("numeric");
  });
  it("«không bắt buộc» đúng chỗ: cá nhân ⇒ email · SĐT · khối học viên; doanh nghiệp ⇒ email KHÔNG còn nhãn «không bắt buộc»; có câu quyền riêng tư NGAY TRÊN nút gửi + hộp đồng ý", () => {
    const { container } = render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    expect(screen.getAllByText(/không bắt buộc/).length).toBeGreaterThanOrEqual(3);
    expect(hoi(NHAN_CCCD).closest("div")?.textContent).not.toMatch(/không bắt buộc/); // đối chứng: CCCD ba/mẹ là BẮT BUỘC
    const cauRiengTu = screen.getByText(NOI_DUNG_QUYEN_RIENG_TU);
    const nut = nutGui();
    expect(cauRiengTu.compareDocumentPosition(nut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("input[type=checkbox]")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Doanh nghiệp"));
    expect(screen.queryByText(/không bắt buộc/)).toBeNull();
    expect(screen.getByLabelText(NHAN_EMAIL).closest("div")?.textContent).not.toMatch(/không bắt buộc/);
  });
  it("câu quyền riêng tư KHÔNG còn nói «không thu thập căn cước» (form thu CCCD ⇒ câu cũ sẽ nói dối)", () => {
    expect(NOI_DUNG_QUYEN_RIENG_TU).not.toMatch(/không thu thập/i);
    expect(NOI_DUNG_QUYEN_RIENG_TU).toMatch(/căn cước/);
  });
});

describe("[FTT-02] điền sẵn từ đơn / hồ sơ / lead — KHÔNG bao giờ điền sẵn hai ô CCCD (SĐT + ngày sinh học viên thì CÓ, chủ dự án chốt 03/11/2026)", () => {
  it("điền sẵn tên · địa chỉ · email; loại doanh nghiệp ⇒ hiện MST đã có; đối chứng: không điền sẵn ⇒ ô rỗng", () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{ loai: "DOANH_NGHIEP", ten: "Công ty Sata", diaChi: "211 Nguyễn Hữu Thọ", email: "kt@example.com", maSoThue: "0401234567" }} />);
    expect(hoi("Tên doanh nghiệp").value).toBe("Công ty Sata");
    expect(hoi(/^Địa chỉ/).value).toBe("211 Nguyễn Hữu Thọ");
    expect(hoi(NHAN_EMAIL).value).toBe("kt@example.com");
    expect(hoi(/Mã số thuế/).value).toBe("0401234567");
    cleanup();
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    expect(hoi(NHAN_TEN_CA_NHAN).value).toBe("");
  });
  it("⛔ dù máy chủ có lỡ gửi xuống HAI ô CCCD, biểu mẫu vẫn để chúng TRỐNG (lộ liên kết không được lộ CCCD); SĐT + ngày sinh học viên + ô thường thì điền sẵn — đối chứng dương", () => {
    render(
      <FormThongTinNguoiMua
        ma={MA}
        datTruoc={{ loai: "CA_NHAN", ten: "Nguyễn Thị Gốc", cccd: "048123456789", sdt: "0905123456", tenHocVien: "Bé Gốc", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" }}
      />,
    );
    expect(hoi(NHAN_CCCD).value).toBe("");
    expect(hoi(/Số CCCD của học viên/).value).toBe("");
    expect(hoi(/Số điện thoại của ba\/mẹ/).value).toBe("0905123456");
    expect(hoi(/Ngày sinh học viên/).value).toBe("2016-08-03");
    expect(hoi(/Họ và tên học viên/).value).toBe("Bé Gốc");
    expect(hoi(NHAN_TEN_CA_NHAN).value).toBe("Nguyễn Thị Gốc");
  });
  it("hộp đồng ý KHÔNG bao giờ được tick sẵn (kể cả khi đã điền sẵn mọi ô)", () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{ loai: "CA_NHAN", ten: "Nguyễn Thị Gốc", diaChi: "114 Hoàng Diệu" }} />);
    expect(hoi(NHAN_DONG_Y).checked).toBe(false);
  });
});

describe("[FTT-03] lỗi theo ô, aria, focus — KHÔNG gọi máy chủ khi biểu mẫu sai", () => {
  it("gửi trống ⇒ lỗi dưới từng ô BẮT BUỘC (tên, CCCD, địa chỉ) + dưới hộp đồng ý, `aria-invalid` + `aria-describedby` trỏ đúng lời, KHÔNG gọi action; focus vào ô lỗi đầu tiên", async () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    fireEvent.click(nutGui());
    const ten = hoi(NHAN_TEN_CA_NHAN);
    await waitFor(() => expect(ten.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Nhập họ và tên của ba/mẹ").id).toBe("o-ten-loi");
    expect(ten.getAttribute("aria-describedby")).toContain("o-ten-loi");
    expect(hoi(NHAN_CCCD).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Nhập số CCCD của ba/mẹ").id).toBe("o-cccd-loi");
    expect(hoi(/^Địa chỉ/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Bạn cần đồng ý để chúng tôi xuất hoá đơn")).toBeTruthy();
    expect(hoi(NHAN_DONG_Y).getAttribute("aria-invalid")).toBe("true");
    // ô tuỳ chọn để trống KHÔNG báo lỗi (đối chứng)
    expect(hoi(/Số điện thoại của ba\/mẹ/).getAttribute("aria-invalid")).toBeNull();
    expect(h.gui).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(ten));
  });
  it("cá nhân thiếu CCCD ⇒ lỗi dưới ô CCCD, focus vào đó; đối chứng: điền CCCD đúng ⇒ gọi action", async () => {
    h.gui.mockResolvedValue({ ok: true });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu({ cccd: "" });
    fireEvent.click(nutGui());
    await waitFor(() => expect(hoi(NHAN_CCCD).getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(hoi(NHAN_CCCD)));
    expect(h.gui).not.toHaveBeenCalled();
    gõ(hoi(NHAN_CCCD), "048123456789");
    fireEvent.click(nutGui());
    await waitFor(() => expect(h.gui).toHaveBeenCalledTimes(1));
  });
  it("CCCD sai định dạng ⇒ lỗi định dạng (không phải lỗi thiếu)", async () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu({ cccd: "12345" });
    fireEvent.click(nutGui());
    await waitFor(() => expect(hoi(NHAN_CCCD).getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(/Số CCCD gồm 12 chữ số/)).toBeTruthy();
    expect(h.gui).not.toHaveBeenCalled();
  });
  it("doanh nghiệp thiếu MST ⇒ lỗi dưới ô MST; thiếu EMAIL ⇒ lỗi dưới ô email; đối chứng: điền đủ ⇒ gọi action", async () => {
    h.gui.mockResolvedValue({ ok: true });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    fireEvent.click(screen.getByLabelText("Doanh nghiệp"));
    dienDu({ ten: "Công ty TNHH Sata" });
    fireEvent.click(nutGui());
    await waitFor(() => expect(screen.getByText("Nhập mã số thuế của doanh nghiệp")).toBeTruthy());
    expect(screen.getByText("Nhập email để nhận hoá đơn của doanh nghiệp")).toBeTruthy();
    expect(h.gui).not.toHaveBeenCalled();
    gõ(hoi(/Mã số thuế/), "0401234567");
    gõ(hoi(NHAN_EMAIL), "ketoan@sata.example.com");
    fireEvent.click(nutGui());
    await waitFor(() => expect(h.gui).toHaveBeenCalledTimes(1));
  });
  it("email sai định dạng ⇒ lỗi dưới ô email (không bắt buộc ở cá nhân nhưng đã nhập thì phải đúng)", async () => {
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu();
    gõ(hoi(NHAN_EMAIL), "khong-phai-email");
    fireEvent.click(nutGui());
    await waitFor(() => expect(hoi(NHAN_EMAIL).getAttribute("aria-invalid")).toBe("true"));
    expect(h.gui).not.toHaveBeenCalled();
  });
});

describe("[FTT-04] gửi: khoá nút, chống bấm đôi, dữ liệu đúng, các kết cục", () => {
  it("đang gửi ⇒ nút bị khoá + đổi chữ; bấm đôi chỉ gọi MỘT lần; xong ⇒ màn «Đã nhận thông tin» nêu nhân viên sẽ kiểm tra, không hứa thời hạn", async () => {
    let xong!: (v: unknown) => void;
    h.gui.mockReturnValue(new Promise((r) => (xong = r)));
    const { container } = render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu();
    fireEvent.click(nutGui());
    await waitFor(() => expect(nutGui().disabled).toBe(true));
    expect(nutGui().textContent).toMatch(/Đang gửi/);
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.click(nutGui());
    expect(h.gui).toHaveBeenCalledTimes(1);
    xong({ ok: true });
    await waitFor(() => expect(screen.getByText(/Đã nhận thông tin/)).toBeTruthy());
    expect(screen.getByText(/kiểm tra thông tin rồi mới xuất hoá đơn/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+\s*(giờ|ngày|phút)|trong vòng|24h/i);
    expect(screen.queryByRole("button", { name: /Gửi thông tin/ })).toBeNull();
  });
  it("gửi đúng mã liên kết + các ô (gồm CCCD ba/mẹ và khối học viên đã gõ); cá nhân KHÔNG mang MST của lần chọn doanh nghiệp trước đó là việc của máy chủ — client vẫn gửi nguyên và máy chủ bỏ", async () => {
    h.gui.mockResolvedValue({ ok: true });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu({ ten: "Trần Văn Ba" });
    gõ(hoi(/Số điện thoại của ba\/mẹ/), "0905123456");
    gõ(hoi(/Họ và tên học viên/), "Trần Văn Bé");
    gõ(hoi(/Ngày sinh học viên/), "2016-08-03");
    gõ(hoi(/Số CCCD của học viên/), "048987654321");
    fireEvent.click(nutGui());
    await waitFor(() => expect(h.gui).toHaveBeenCalledTimes(1));
    expect(h.gui).toHaveBeenCalledWith(
      MA,
      expect.objectContaining({
        loai: "CA_NHAN",
        ten: "Trần Văn Ba",
        diaChi: "114 Hoàng Diệu, Đà Nẵng",
        cccd: "048123456789",
        sdt: "0905123456",
        tenHocVien: "Trần Văn Bé",
        ngaySinhHocVien: "2016-08-03",
        cccdHocVien: "048987654321",
        dongY: true,
      }),
    );
  });
  it("[FTT-04b] gửi KÈM `banDau` = đúng bản điền sẵn PH nhìn thấy lúc mở (máy chủ so để biết ô nào PH THẬT SỰ sửa); không có điền sẵn ⇒ `banDau` rỗng", async () => {
    h.gui.mockResolvedValue({ ok: true });
    const dienSan = { loai: "CA_NHAN", ten: "Nguyễn Thị Điền Sẵn", diaChi: "114 Hoàng Diệu, Đà Nẵng", sdt: "0905123456" } as const;
    render(<FormThongTinNguoiMua ma={MA} datTruoc={dienSan} />);
    gõ(hoi(NHAN_CCCD), "048123456789");
    gõ(hoi(NHAN_TEN_CA_NHAN), "Nguyễn Thị Đã Sửa");
    fireEvent.click(hoi(NHAN_DONG_Y));
    fireEvent.click(nutGui());
    await waitFor(() => expect(h.gui).toHaveBeenCalledTimes(1));
    const gui = h.gui.mock.calls[0]![1] as Record<string, unknown>;
    expect(gui.ten).toBe("Nguyễn Thị Đã Sửa"); // giá trị PH đang gõ
    expect(gui.banDau).toEqual(dienSan); // bản điền sẵn NGUYÊN VĂN, không bị ô PH sửa làm đổi
    cleanup();
    h.gui.mockClear();
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu({ ten: "Trần Văn Ba" });
    fireEvent.click(nutGui());
    await waitFor(() => expect(h.gui).toHaveBeenCalledTimes(1));
    expect((h.gui.mock.calls[0]![1] as Record<string, unknown>).banDau).toEqual({});
  });
  it("máy chủ báo lỗi theo ô ⇒ hiện dưới đúng ô + KHÔNG chuyển sang màn thành công; đối chứng ở ca trên", async () => {
    h.gui.mockResolvedValue({ ok: false, kieu: "DU_LIEU", thongDiep: "x", loi: { theoO: { diaChi: "Địa chỉ quá ngắn" } } });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu();
    fireEvent.click(nutGui());
    await waitFor(() => expect(screen.getByText("Địa chỉ quá ngắn")).toBeTruthy());
    expect(screen.queryByText(/Đã nhận thông tin/)).toBeNull();
    expect(nutGui().disabled).toBe(false);
  });
  it("liên kết hết hạn giữa chừng ⇒ quay về thông điệp CHUNG, biểu mẫu biến mất", async () => {
    h.gui.mockResolvedValue({ ok: false, kieu: "KHONG_CON_HIEU_LUC", thongDiep: "Liên kết không còn hiệu lực. Vui lòng nhờ nhân viên Sata Robo cấp lại liên kết mới." });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu();
    fireEvent.click(nutGui());
    await waitFor(() => expect(screen.getByText("Liên kết không còn hiệu lực")).toBeTruthy());
    expect(screen.getByText(/nhờ nhân viên Sata Robo cấp lại/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Địa chỉ/)).toBeNull();
  });
  it("tạm khoá / quá nhanh / hệ thống bận ⇒ thông báo `role=alert` TẠI CHỖ, giữ nguyên dữ liệu đã gõ, mở lại nút để thử", async () => {
    h.gui.mockResolvedValue({ ok: false, kieu: "KHOA", thongDiep: "Liên kết đang tạm khoá. Vui lòng thử lại sau ít phút hoặc nhờ nhân viên Sata Robo cấp mã mới." });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu();
    fireEvent.click(nutGui());
    const canhBao = await screen.findByRole("alert");
    expect(canhBao.textContent).toMatch(/tạm khoá/);
    expect(hoi(/^Địa chỉ/).value).toBe("114 Hoàng Diệu, Đà Nẵng");
    expect(hoi(NHAN_CCCD).value).toBe("048123456789"); // dữ liệu nhạy cảm đã gõ cũng không bị nuốt
    expect(nutGui().disabled).toBe(false);
  });
  it("mạng đứt (action ném) ⇒ lời «mất kết nối» tại chỗ, mở lại nút, KHÔNG nuốt dữ liệu", async () => {
    h.gui.mockImplementation(async () => {
      throw new Error("Failed to fetch");
    });
    render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    dienDu();
    fireEvent.click(nutGui());
    expect((await screen.findByRole("alert")).textContent).toMatch(/Mất kết nối/);
    expect(nutGui().disabled).toBe(false);
    expect(hoi(NHAN_TEN_CA_NHAN).value).toBe("Nguyễn Thị Phụ Huynh");
  });
});

describe("[FTT-05] vùng bấm và kích thước chữ trên điện thoại", () => {
  it("ô nhập và nút cao ≥ 44px (h-11 / h-12) và chữ 16px (text-base) để iOS không tự phóng to — gồm cả ô CCCD, SĐT, ngày sinh", () => {
    const { container } = render(<FormThongTinNguoiMua ma={MA} datTruoc={{}} />);
    const o = container.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"], input[type="tel"], input[type="date"]');
    expect(o.length).toBe(7); // ten · cccd · sdt · email · tên HV · ngày sinh HV · CCCD HV (địa chỉ là textarea)
    for (const el of o) {
      expect(el.className, el.name).toMatch(/\bh-11\b/);
      expect(el.className, el.name).toMatch(/\btext-base\b/);
    }
    expect(nutGui().className).toMatch(/\bh-12\b/);
    for (const nhan of container.querySelectorAll("label[for]")) {
      if (nhan.querySelector("input")) expect(nhan.className).toMatch(/min-h-11/);
    }
  });
});
