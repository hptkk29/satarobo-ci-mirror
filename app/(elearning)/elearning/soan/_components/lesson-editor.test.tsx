// @vitest-environment jsdom
/**
 * [LTB-*] B-11 ở TRÌNH SOẠN: (1) dòng báo "lưu sẽ tạo bản nháp mới" hiện đúng khi bài nằm trong bản đã khoá; (2) sau khi lưu mà server TÁCH BẢN, trang chuyển
 * sang bài của bản nháp (router.replace) — và KHÔNG chuyển khi không tách / khi lưu lỗi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));
const luuBaiDocAction = vi.fn();
vi.mock("../_actions", () => ({ luuBaiDocAction: (i: unknown) => luuBaiDocAction(i) }));
vi.mock("@/components/blog/markdown-renderer", () => ({ MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div> }));

const { LessonEditor } = await import("./lesson-editor");
const { BaoTruocTachBan } = await import("./bao-truoc-tach-ban");

beforeEach(() => {
  replace.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  luuBaiDocAction.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("[LTB-01] dòng báo trước", () => {
  it("bài trong bản đã khoá ⇒ có dòng 'Lưu sẽ tạo bản nháp mới' và nói người học vẫn đọc bản cũ", () => {
    render(<BaoTruocTachBan seTachBan />);
    expect(screen.getByText("Lưu sẽ tạo bản nháp mới")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/người đang học vẫn đọc nguyên văn bản cũ/);
  });
  it("🔴 đối chứng: bài chưa vào bản nào ⇒ KHÔNG có dòng báo (không dọa người soạn khoá nháp)", () => {
    const { container } = render(<BaoTruocTachBan seTachBan={false} />);
    expect(container.textContent).toBe("");
  });
});

describe("[LTB-02] chuyển trang sau khi lưu", () => {
  const ve = () => render(<LessonEditor lessonId="bai-cu" titleBanDau="Tên" contentBanDau="Nội dung" seTachBan={false} dauTrang={<h1>Đầu trang</h1>} />);
  const bamLuu = () => fireEvent.click(screen.getByRole("button", { name: "Lưu bài" }));

  it("🔴 server tách bản ⇒ router.replace sang ĐÚNG id bài mới (không phải id cũ) + thông báo nói bản đang phát hành giữ nguyên", async () => {
    luuBaiDocAction.mockResolvedValue({ ok: true, data: { lessonId: "bai-moi", daTachBan: true } });
    ve();
    bamLuu();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/elearning/soan/bai-moi");
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/bản đang phát hành giữ nguyên/));
    expect(luuBaiDocAction).toHaveBeenCalledWith({ lessonId: "bai-cu", title: "Tên", contentMd: "Nội dung" });
  });

  it("🔴 không tách bản ⇒ KHÔNG chuyển trang", async () => {
    luuBaiDocAction.mockResolvedValue({ ok: true, data: { lessonId: "bai-cu", daTachBan: false } });
    ve();
    bamLuu();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã lưu bài"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("🔴 lưu lỗi ⇒ không chuyển trang, hiện lỗi, giữ bản nháp trên máy", async () => {
    luuBaiDocAction.mockResolvedValue({ ok: false, error: { code: "CONFLICT", message: "Khoá đang chờ duyệt" } });
    ve();
    bamLuu();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Khoá đang chờ duyệt"));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("[LTB-03] bố cục QtSoanDoc: đầu trang + nút Lưu bài cùng hàng, dòng báo nằm trong trình soạn", () => {
  it("🔴 seTachBan ⇒ có dòng báo ngay dưới đầu trang; không ⇒ không (đối chứng)", () => {
    const { unmount } = render(<LessonEditor lessonId="b" titleBanDau="T" contentBanDau="N" seTachBan dauTrang={<h1>Đầu trang</h1>} />);
    expect(screen.getByText("Lưu sẽ tạo bản nháp mới")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Đầu trang" })).toBeTruthy();
    unmount();
    render(<LessonEditor lessonId="b" titleBanDau="T" contentBanDau="N" seTachBan={false} dauTrang={<h1>Đầu trang</h1>} />);
    expect(screen.queryByText("Lưu sẽ tạo bản nháp mới")).toBeNull();
  });
  it("hai khối 'Soạn' và 'Xem trước — đúng cách người học sẽ thấy'; thanh định dạng có đủ 7 nút có nhãn", () => {
    render(<LessonEditor lessonId="b" titleBanDau="T" contentBanDau="N" seTachBan={false} dauTrang={<h1>x</h1>} />);
    expect(screen.getByRole("region", { name: "Soạn" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Xem trước — đúng cách người học sẽ thấy" })).toBeTruthy();
    const thanh = screen.getByRole("toolbar", { name: "Định dạng Markdown" });
    expect(Array.from(thanh.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"))).toEqual(["Đậm", "Nghiêng", "Tiêu đề", "Danh sách", "Trích dẫn", "Mã", "Liên kết"]);
  });
  it("ngưỡng đọc nói bằng phút khi từ 1 phút trở lên", () => {
    render(<LessonEditor lessonId="b" titleBanDau="T" contentBanDau={"từ ".repeat(900)} seTachBan={false} dauTrang={<h1>x</h1>} />);
    expect(screen.getByText(/Ngưỡng đọc của bài này:/).textContent).toMatch(/\d+ phút/);
  });
  it("🔴 bản nháp trên máy: có banner + Khôi phục / Bỏ bản nháp (đúng nhãn thiết kế)", async () => {
    window.localStorage.setItem("el:soan-bai:b", JSON.stringify({ title: "Cũ", noiDung: "Nội dung chưa lưu" }));
    render(<LessonEditor lessonId="b" titleBanDau="T" contentBanDau="N" seTachBan={false} dauTrang={<h1>x</h1>} />);
    expect(await screen.findByText("Có bản nháp chưa lưu trên máy này")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Khôi phục" }));
    expect((screen.getByLabelText("Nội dung bài, định dạng Markdown") as HTMLTextAreaElement).value).toBe("Nội dung chưa lưu");
    expect(screen.queryByText("Có bản nháp chưa lưu trên máy này")).toBeNull();
  });
});
