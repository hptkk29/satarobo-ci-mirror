// @vitest-environment jsdom
/**
 * [TS-UI-*] Trang «Tủ sách gia đình» (dựng THẬT: giao diện sinh từ artifact + view-model + hộp «để lại thông tin»; fetch được giả).
 *   [TS-UI-01] dựng được cả trang: 20 ebook, hero, không còn lời hứa «vở bài tập» mà dữ liệu không có
 *   [TS-UI-02] lọc ebook theo chủ đề
 *   [TS-UI-03] ngăn SGK: 237 cuốn theo lớp; «Đọc» mở trang NXBGD ở thẻ mới (noopener); KHÔNG có nút «Tải»; tìm theo tên
 *   [TS-UI-04] Tải PDF khi CHƯA để lại thông tin ⇒ mở hộp, KHÔNG gọi máy chủ tải; đã mở khoá ⇒ xin link rồi chuyển tới link
 *   [TS-UI-05] lỗi tải: chưa có tệp / mạng đứt ⇒ báo bằng lời (toast), không điều hướng
 *   [TS-UI-06] trình đọc: trang bìa → trang kế dùng ảnh thật; zoom 50–400%; hỏi đáp mở/đóng
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EBOOKS, soTrangDocThu } from "@/lib/tu-sach/ebook";
import { SGK } from "@/lib/tu-sach/sgk";
import { TuSachTrang } from "./tu-sach-trang";

const DM = { ok: true, thanhPho: ["Tp Đà Nẵng"], macDinh: "Tp Đà Nẵng", phuong: ["Phường Hải Châu"] };
let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;

const dung = (daMo = false) => render(<TuSachTrang daMoKhoa={daMo} />);
const goiTai = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/tu-sach/tai"));

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/dia-chi")) return { ok: true, json: async () => DM } as Response;
    if (String(url).startsWith("/api/tu-sach/tai")) return { ok: true, json: async () => ({ ok: true, url: "https://r2.example/sach.pdf?sig=1" }) } as Response;
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  open = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
  vi.stubGlobal("open", open);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("[TS-UI-01] dựng cả trang", () => {
  it("20 ebook với bìa + nút đọc/tải; tiêu đề trang; không còn lời hứa «sách giáo khoa và vở bài tập»", () => {
    dung();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Tủ sách gia đình/);
    expect(screen.getAllByRole("button", { name: /^Đọc thử / })).toHaveLength(20);
    expect(screen.getAllByRole("button", { name: /^Tải PDF / })).toHaveLength(20);
    expect(screen.getByAltText(`Bìa ebook “${EBOOKS[0]!.tieuDe}”`).getAttribute("src")).toBe("/tu-sach/bia/1.jpg");
    expect(document.body.textContent).not.toMatch(/sách giáo khoa và vở bài tập|SGK và vở bài tập|vở bài tập theo lớp/i);
  });
});

describe("[TS-UI-02] lọc chủ đề", () => {
  it("chọn «Gia đình» ⇒ chỉ ebook chủ đề đó", () => {
    dung();
    const n = EBOOKS.filter((e) => e.chuDe === "Gia đình").length;
    fireEvent.click(screen.getByRole("button", { name: /^Gia đình/ }));
    expect(screen.getAllByRole("button", { name: /^Đọc thử / })).toHaveLength(n);
    expect(document.body.textContent).toMatch(new RegExp(`Gia đình · ${n} cuốn · miễn phí`));
    fireEvent.click(screen.getByRole("button", { name: /^Tất cả/ }));
    expect(screen.getAllByRole("button", { name: /^Đọc thử / })).toHaveLength(20);
  });
});

describe("[TS-UI-03] ngăn sách giáo khoa", () => {
  const sangSgk = () => fireEvent.click(screen.getByRole("tab", { name: /Sách giáo khoa/ }));
  it("mặc định lớp 3: đủ số cuốn của lớp; «Đọc» mở NXBGD thẻ mới; không có nút Tải", () => {
    dung();
    sangSgk();
    const lop3 = SGK.filter((b) => b.lop === 3);
    const nutDoc = screen.getAllByRole("button", { name: /tại Nhà xuất bản Giáo dục Việt Nam$/ });
    expect(nutDoc.length).toBeGreaterThanOrEqual(lop3.length); // mỗi sách: nút bìa + nút «Đọc»
    const danhSach = document.querySelector("ul.ts-books") as HTMLElement;
    expect(danhSach.querySelectorAll("li.ts-book")).toHaveLength(lop3.length);
    expect(Array.from(danhSach.querySelectorAll("button")).filter((b) => /Tải/.test(b.textContent ?? "") || /Tải/.test(b.getAttribute("aria-label") ?? ""))).toEqual([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Đọc" })[0]!);
    expect(open).toHaveBeenCalledTimes(1);
    const [url, , feat] = open.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/taphuan\.nxbgd\.vn\//);
    expect(feat).toContain("noopener");
  });
  it("đổi lớp ⇒ danh sách đổi theo; tìm «toán» ⇒ chỉ sách Toán; không khớp ⇒ nói rõ", () => {
    dung();
    sangSgk();
    fireEvent.click(screen.getByRole("button", { name: "Lớp 10" }));
    expect(document.body.textContent).toMatch(new RegExp(`${SGK.filter((b) => b.lop === 10).length} cuốn sách giáo khoa`));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "toan" } });
    const lop10Toan = SGK.filter((b) => b.lop === 10 && /toán/i.test(b.ten)).length;
    expect(document.body.textContent).toMatch(new RegExp(`${lop10Toan} cuốn sách giáo khoa khớp`));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzzqq" } });
    expect(screen.getByText(/Chưa thấy cuốn nào khớp với “zzzzqq”/)).toBeTruthy();
  });
});

describe("[TS-UI-04] tải PDF qua cổng", () => {
  it("CHƯA để lại thông tin ⇒ mở hộp; KHÔNG gọi /api/tu-sach/tai", async () => {
    dung(false);
    fireEvent.click(screen.getAllByRole("button", { name: /^Tải PDF / })[0]!);
    expect(await screen.findByTestId("hop-de-lai-thong-tin")).toBeTruthy();
    expect(goiTai()).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });
  it("ĐÃ mở khoá ⇒ xin link rồi chuyển tới link ký (không qua hộp)", async () => {
    dung(true);
    fireEvent.click(screen.getAllByRole("button", { name: /^Tải PDF / })[2]!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://r2.example/sach.pdf?sig=1"));
    expect(goiTai()[0]![0]).toBe("/api/tu-sach/tai/3");
    expect(screen.queryByTestId("hop-de-lai-thong-tin")).toBeNull();
  });
  it("nút «Tải toàn bộ» của trình đọc tải đúng cuốn đang mở", async () => {
    dung(true);
    fireEvent.click(screen.getAllByRole("button", { name: /^Đọc thử / })[4]!);
    fireEvent.click(screen.getByRole("button", { name: /Tải toàn bộ/ }));
    await waitFor(() => expect(goiTai()[0]![0]).toBe("/api/tu-sach/tai/5"));
  });
});

describe("[TS-UI-05] lỗi tải", () => {
  it("chưa có tệp ⇒ nói «đang được cập nhật», không điều hướng", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ ok: false, loi: "CHUA_CO_TEP" }) }) as Response);
    dung(true);
    fireEvent.click(screen.getAllByRole("button", { name: /^Tải PDF / })[0]!);
    expect(await screen.findByText(/đang được cập nhật tệp tải về/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
  it("mạng đứt ⇒ báo thử lại", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("mạng");
    });
    dung(true);
    fireEvent.click(screen.getAllByRole("button", { name: /^Tải PDF / })[0]!);
    expect(await screen.findByText(/kiểm tra kết nối mạng/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("[TS-UI-07] đọc thử 1/4 số trang", () => {
  const e2 = EBOOKS[1]!;
  const gioiHan = soTrangDocThu(e2.soTrang);
  const mo = () => fireEvent.click(screen.getAllByRole("button", { name: /^Đọc thử / })[1]!);
  const sau = () => fireEvent.click(screen.getByRole("button", { name: /Trang sau/i }));
  const anhHienTai = () => (document.querySelector(".reader img[alt^=\"Trang \"]") as HTMLImageElement | null)?.getAttribute("src") ?? null;
  it("chưa để lại thông tin: lật tới hết phần đọc thử; trang kế tiếp mở hộp «để lại thông tin», ảnh KHÔNG đổi", () => {
    dung(false);
    mo();
    for (let i = 1; i < gioiHan; i++) sau();
    expect(anhHienTai()).toBe(`/api/tu-sach/trang/2/${gioiHan}`);
    sau();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(anhHienTai()).toBe(`/api/tu-sach/trang/2/${gioiHan}`);
  });
  it("đối chứng DƯƠNG: đã mở khoá ⇒ lật qua phần đọc thử, không hộp", () => {
    dung(true);
    mo();
    for (let i = 1; i <= gioiHan; i++) sau();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(anhHienTai()).toBe(`/api/tu-sach/trang/2/${gioiHan + 1}`);
  });
});

describe("[TS-UI-06] trình đọc + hỏi đáp", () => {
  it("mở cuốn 2: trang bìa dùng ảnh bìa; sang trang 2 dùng ảnh thật của máy chủ", () => {
    dung();
    fireEvent.click(screen.getAllByRole("button", { name: /^Đọc thử / })[1]!);
    expect(screen.getByAltText("Trang bìa").getAttribute("src")).toBe("/tu-sach/bia/2.jpg");
    fireEvent.click(screen.getByRole("button", { name: /Trang sau/i }));
    expect((screen.getByAltText(/^Trang 2 — /) as HTMLImageElement).getAttribute("src")).toBe("/api/tu-sach/trang/2/2");
  });
  it("phóng to/thu nhỏ trong khoảng 50–400%, «Vừa khung» về 100%", () => {
    dung();
    const zoomDe = () => document.querySelector(".rd-foot b")!.textContent;
    const nutTo = screen.getByRole("button", { name: /Phóng to/i });
    const nutNho = screen.getByRole("button", { name: /Thu nhỏ/i });
    expect(zoomDe()).toBe("100%");
    fireEvent.click(nutTo);
    expect(zoomDe()).toBe("125%");
    for (let i = 0; i < 20; i++) fireEvent.click(nutTo);
    expect(zoomDe()).toBe("400%");
    for (let i = 0; i < 30; i++) fireEvent.click(nutNho);
    expect(zoomDe()).toBe("50%");
    fireEvent.click(screen.getByRole("button", { name: /Vừa khung/ }));
    expect(zoomDe()).toBe("100%");
  });
  it("hỏi đáp: mở một câu thì đóng câu khác", () => {
    dung();
    const cau = screen.getAllByRole("button", { expanded: false }).filter((b) => /Tủ sách có những sách gì|Đọc trên điện thoại/.test(b.textContent ?? ""));
    fireEvent.click(cau[0]!);
    expect(screen.getByText(/Hai ngăn: 20 ebook/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Đọc trên điện thoại có rõ không/ }));
    expect(screen.queryByText(/Hai ngăn: 20 ebook/)).toBeNull();
    expect(screen.getAllByText(/chụm hai ngón hoặc bấm nút/).length).toBeGreaterThan(0);
  });
});
