// @vitest-environment jsdom
// Canh gác hook đưa bộ lọc lên URL — QA site GV vòng 1 (BUG-019).
//
// Bộ này viết lại sau khi bản đầu HỎNG trên trình duyệt: nó đọc URL trong một effect
// sau hydrate, và `?trangThai=ALL` bị ghi đè trước khi kịp có tác dụng (phân trang ra
// 2 trang thay vì 3). Test cũ vẫn xanh vì nó tự dựng URL rồi tự render — không tái hiện
// được cuộc đua với ô Select. Bài học: những ca dưới đây kiểm HỢP ĐỒNG (giá trị ban đầu
// đến từ tham số, không từ `window`), còn phần "chạy thật" phải đo trên trình duyệt.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { gopLocBanDau, useLocTrenUrl } from "./use-loc-tren-url";

const MAC_DINH = { q: "", trangThai: "ALL" };

function datUrl(search: string) {
  window.history.replaceState(null, "", `/teacher/lop${search}`);
}

beforeEach(() => {
  datUrl("");
});

describe("gopLocBanDau — hợp đồng giá trị ban đầu", () => {
  it("không truyền gì ⇒ đúng mặc định", () => {
    expect(gopLocBanDau(MAC_DINH)).toEqual(MAC_DINH);
  });

  it("giá trị từ server ghi đè mặc định", () => {
    expect(gopLocBanDau(MAC_DINH, { trangThai: "COMPLETED" })).toEqual({
      q: "",
      trangThai: "COMPLETED",
    });
  });

  it("ca từng HỎNG: giá trị trùng tên với hằng ALL vẫn phải được nhận", () => {
    // `?trangThai=ALL` là ca bản đầu bỏ qua trên trình duyệt.
    expect(gopLocBanDau({ q: "", trangThai: "DANG_PHU_TRACH" }, { trangThai: "ALL" }))
      .toEqual({ q: "", trangThai: "ALL" });
  });

  it("chuỗi rỗng / undefined ⇒ rơi về mặc định, KHÔNG thành chuỗi rỗng", () => {
    expect(gopLocBanDau(MAC_DINH, { trangThai: "" })).toEqual(MAC_DINH);
    expect(gopLocBanDau(MAC_DINH, { trangThai: undefined })).toEqual(MAC_DINH);
  });

  it("bỏ qua khoá lạ không có trong mặc định", () => {
    const r = gopLocBanDau(MAC_DINH, { la: "x" } as Record<string, string>);
    expect(r).toEqual(MAC_DINH);
    expect("la" in r).toBe(false);
  });
});

describe("useLocTrenUrl", () => {
  it("giá trị ban đầu có NGAY ở lượt render đầu — không chờ effect", () => {
    const { result } = renderHook(() =>
      useLocTrenUrl(MAC_DINH, { trangThai: "COMPLETED" }),
    );
    // Không `act` thêm, không chờ: đọc thẳng sau lượt render đầu tiên.
    expect(result.current.gia_tri.trangThai).toBe("COMPLETED");
    expect(result.current.dang_loc).toBe(true);
  });

  it("KHÔNG tự đọc window.location — chỉ nhận qua tham số", () => {
    // Bản đầu đọc `window.location.search`; nay URL có tham số mà không truyền
    // `banDau` thì hook phải giữ mặc định. Đây là điều kiện để server và client
    // render giống nhau.
    datUrl("?trangThai=COMPLETED");
    const { result } = renderHook(() => useLocTrenUrl(MAC_DINH));
    expect(result.current.gia_tri.trangThai).toBe("ALL");
  });

  it("đổi giá trị ⇒ ghi lên URL", () => {
    const { result } = renderHook(() => useLocTrenUrl(MAC_DINH));
    act(() => result.current.dat("trangThai", "COMPLETED"));
    expect(window.location.search).toContain("trangThai=COMPLETED");
  });

  it("giá trị mặc định KHÔNG lên query string — URL sạch", () => {
    const { result } = renderHook(() => useLocTrenUrl(MAC_DINH));
    act(() => result.current.dat("trangThai", "ALL"));
    expect(window.location.search).toBe("");
  });

  it("GIỮ NGUYÊN tham số lạ — không đá bay ngữ cảnh màn khác", () => {
    datUrl("?s=hv-1&ptab=nhan-xet");
    const { result } = renderHook(() => useLocTrenUrl(MAC_DINH));
    act(() => result.current.dat("q", "trí"));
    expect(window.location.search).toContain("s=hv-1");
    expect(window.location.search).toContain("ptab=nhan-xet");
  });

  it("quay về mặc định ⇒ XOÁ tham số, không để lại rác", () => {
    const { result } = renderHook(() => useLocTrenUrl(MAC_DINH));
    act(() => result.current.dat("trangThai", "COMPLETED"));
    act(() => result.current.dat("trangThai", "ALL"));
    expect(window.location.search).not.toContain("trangThai");
  });

  it("phát lại ĐÚNG giá trị đang có ⇒ không ghi URL (ca ô Select lúc hydrate)", () => {
    // Chính cú gọi thừa này, cộng với việc đọc URL trong effect, là nguyên nhân lỗi cũ.
    const { result } = renderHook(() =>
      useLocTrenUrl(MAC_DINH, { trangThai: "COMPLETED" }),
    );
    const rs = vi.spyOn(window.history, "replaceState");
    act(() => result.current.dat("trangThai", "COMPLETED"));
    expect(rs).not.toHaveBeenCalled();
    expect(result.current.gia_tri.trangThai).toBe("COMPLETED");
    rs.mockRestore();
  });

  it("dùng replaceState, KHÔNG đẩy mục lịch sử mới", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useLocTrenUrl(MAC_DINH));
    act(() => result.current.dat("q", "abc"));
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it("xoa_het trả mọi khoá về mặc định và dọn URL", () => {
    const { result } = renderHook(() =>
      useLocTrenUrl(MAC_DINH, { q: "x", trangThai: "COMPLETED" }),
    );
    act(() => result.current.xoa_het());
    expect(result.current.gia_tri).toEqual(MAC_DINH);
    expect(window.location.search).toBe("");
    expect(result.current.dang_loc).toBe(false);
  });
});
