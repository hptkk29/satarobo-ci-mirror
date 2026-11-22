// @vitest-environment jsdom
/**
 * [HDNAV-S*] Thanh phạm vi DUY NHẤT của khu Hoá đơn (cơ sở + tháng + pháp nhân đang thao tác) — S5b.
 *
 * Luật giữ nguyên từ màn cũ: NHIỀU cơ sở mà CHƯA chọn ⇒ không nạp gì (an toàn); thanh này chỉ là mặt trước của
 * quyết định ấy (`chonCoSoLamViec`), server vẫn là bên quyết. Gợi ý "cơ sở lần trước" KHÔNG BAO GIỜ tự áp.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pathname: "/payments/hoa-don",
  query: "",
  push: vi.fn(),
  replace: vi.fn(),
  // Kho giả trong bộ nhớ: `tests/setup.ts` thay localStorage bằng cái vỏ rỗng khi jsdom không có (Node mới), nên
  // đọc/ghi `window.localStorage` thật sẽ không giữ được gì — ca về gợi ý phải tự cấp kho.
  kho: new Map<string, string>(),
  khoHong: false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(h.query),
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: vi.fn() }),
}));

vi.mock("./pham-vi-hoa-don", async (goc) => ({
  ...(await goc<typeof import("./pham-vi-hoa-don")>()),
  khoTrinhDuyet: () => ({
    getItem: (k: string) => {
      if (h.khoHong) throw new Error("SecurityError");
      return h.kho.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (h.khoHong) throw new Error("QuotaExceededError");
      h.kho.set(k, v);
    },
  }),
}));

import { HoaDonScopeBar } from "./hoa-don-scope-bar";
import { khoaGoiYCoSo } from "./pham-vi-hoa-don";

const CS1 = { id: "cs1", ma: "CS1", ten: "Cơ sở 1" };
const CS2 = { id: "cs2", ma: "CS2", ten: "Cơ sở 2" };
const PN = {
  cs1: { loai: "CO" as const, ten: "Công ty CP Công nghệ Giáo dục Sata Robo", maSoThue: "0402222222", kyHieu: "1C26TSR" },
  cs2: { loai: "THIEU" as const, lyDo: "Chưa khai cấu hình hoá đơn cho cơ sở này." },
};

function dung(o: Partial<React.ComponentProps<typeof HoaDonScopeBar>> = {}) {
  return render(<HoaDonScopeBar userId="u-an" cacCoSo={[CS1, CS2]} phapNhan={PN} thangHienTai="2026-09" {...o} />);
}
const oCoSo = () => screen.getByLabelText("Cơ sở") as HTMLSelectElement;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.kho.clear();
  h.khoHong = false;
  h.pathname = "/payments/hoa-don";
  h.query = "";
});

describe("[HDNAV-S1] cơ sở: một ô chọn, bày đúng phạm vi được truyền, KHÔNG có 'Tất cả cơ sở'", () => {
  it("nhiều cơ sở ⇒ select liệt kê đúng các cơ sở; đang chọn cs1 ⇒ value=cs1 và hiện TÊN cơ sở", () => {
    h.query = "coSo=cs1";
    dung();
    expect([...oCoSo().options].map((x) => [x.value, x.textContent])).toEqual([
      ["cs1", "CS1 · Cơ sở 1"],
      ["cs2", "CS2 · Cơ sở 2"],
    ]);
    expect(oCoSo().value).toBe("cs1");
  });

  it("NHIỀU cơ sở mà CHƯA chọn ⇒ 'Chọn cơ sở…' + lời nhắc nói rõ danh sách chưa nạp; không hiện pháp nhân", () => {
    dung();
    expect([...oCoSo().options].map((x) => x.textContent)).toEqual(["Chọn cơ sở…", "CS1 · Cơ sở 1", "CS2 · Cơ sở 2"]);
    expect(oCoSo().value).toBe("");
    expect(screen.getByText(/chưa chọn cơ sở/i)).toBeTruthy();
    expect(screen.queryByText(/0402222222/)).toBeNull();
  });

  it("cơ sở trên URL NGOÀI phạm vi (đổi vai, link cũ) ⇒ coi như chưa chọn, không bày tên cơ sở lạ", () => {
    h.query = "coSo=cs-khac";
    dung();
    expect(oCoSo().value).toBe("");
    expect(screen.queryByText(/cs-khac/)).toBeNull();
  });

  it("cơ sở lạ trên URL KHÔNG được nhớ làm gợi ý (kho chỉ nhận cơ sở đã qua phạm vi)", () => {
    h.query = "coSo=cs-khac";
    dung();
    expect([...h.kho.values()]).toEqual([]);
  });

  it("MỘT cơ sở mà URL mang cơ sở lạ ⇒ vẫn là cơ sở duy nhất (cùng luật chonCoSoLamViec của server), không trống", () => {
    h.query = "coSo=cs-khac";
    dung({ cacCoSo: [CS1] });
    expect(screen.getByText("CS1 · Cơ sở 1")).toBeTruthy();
    expect(screen.getByText(/Công ty CP Công nghệ Giáo dục Sata Robo/)).toBeTruthy();
  });

  it("MỘT cơ sở ⇒ không có ô chọn nhưng VẪN hiện tên cơ sở và pháp nhân (tự chọn, như server)", () => {
    dung({ cacCoSo: [CS1] });
    expect(screen.queryByLabelText("Cơ sở")).toBeNull();
    expect(screen.getByText("CS1 · Cơ sở 1")).toBeTruthy();
    expect(screen.getByText(/Công ty CP Công nghệ Giáo dục Sata Robo/)).toBeTruthy();
  });

  it("không được giao cơ sở nào ⇒ nói thẳng, không ô chọn", () => {
    dung({ cacCoSo: [], phapNhan: {} });
    expect(screen.queryByLabelText("Cơ sở")).toBeNull();
    expect(screen.getByText(/chưa được giao cơ sở nào/i)).toBeTruthy();
    // Đối chứng dương nằm ở ca "NHIỀU cơ sở mà CHƯA chọn" phía trên (câu cảnh báo có mặt). Ở đây nó phải VẮNG:
    // không có cơ sở nào để chọn thì bảo "hãy chọn một cơ sở" là lời hứa suông.
    expect(screen.queryByText(/chưa chọn cơ sở/i)).toBeNull();
  });

  it("MỘT cơ sở ⇒ không bao giờ có cảnh báo 'chưa chọn cơ sở' (đã tự chọn)", () => {
    dung({ cacCoSo: [CS1] });
    expect(screen.queryByText(/chưa chọn cơ sở/i)).toBeNull();
  });
});

describe("[HDNAV-S2] đổi cơ sở = router.push (có mục lịch sử), bỏ dòng chọn, giữ ngăn + tháng", () => {
  it("chọn cs2 từ ngăn Đã xuất, tháng 8, đang chọn một dòng", () => {
    h.query = "ngan=da-xuat&chon=dot%3Aa&hoaDon=hd1&coSo=cs1&thang=2026-08";
    dung();
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don?ngan=da-xuat&coSo=cs2&thang=2026-08");
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("từ trạng thái chưa chọn ⇒ chỉ mang cơ sở", () => {
    dung();
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don?coSo=cs2");
  });

  it("chọn lại đúng 'Chọn cơ sở…' (value rỗng) không làm gì", () => {
    dung();
    fireEvent.change(oCoSo(), { target: { value: "" } });
    expect(h.push).not.toHaveBeenCalled();
  });

  it("đang ở trang Cấu hình ⇒ push về CHÍNH trang Cấu hình với cơ sở mới", () => {
    h.pathname = "/payments/hoa-don/cau-hinh";
    h.query = "coSo=cs1";
    dung();
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don/cau-hinh?coSo=cs2");
  });
});

describe("[HDNAV-S3] ô tháng chỉ ở nơi CÓ tác dụng", () => {
  it("ngăn Đã xuất ⇒ có ô tháng; đổi ⇒ push, giữ cơ sở", () => {
    h.query = "ngan=da-xuat&coSo=cs1";
    dung();
    const o = screen.getByLabelText("Tháng") as HTMLSelectElement;
    expect(o.value).toBe("2026-09");
    expect(o.options.length).toBe(12);
    fireEvent.change(o, { target: { value: "2026-08" } });
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don?ngan=da-xuat&coSo=cs1&thang=2026-08");
  });

  it("chọn lại tháng MẶC ĐỊNH ⇒ thang biến khỏi URL", () => {
    h.query = "ngan=khong-xuat&coSo=cs1&thang=2026-08";
    dung();
    fireEvent.change(screen.getByLabelText("Tháng"), { target: { value: "2026-09" } });
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don?ngan=khong-xuat&coSo=cs1");
  });

  it("tháng cũ nằm ngoài 12 tháng gần nhất vẫn có trong ô (không đổi giá trị đang xem)", () => {
    h.query = "ngan=da-xuat&coSo=cs1&thang=2024-02";
    dung();
    expect((screen.getByLabelText("Tháng") as HTMLSelectElement).value).toBe("2024-02");
  });

  it("ngăn Đã xuất / Không xuất mà CHƯA chọn cơ sở (nhiều cơ sở) ⇒ KHÔNG có ô tháng (trang không nạp gì — ô tháng sẽ là lời hứa suông)", () => {
    h.query = "ngan=da-xuat";
    const a = dung();
    expect(oCoSo().value).toBe(""); // đúng là chưa chọn
    expect(screen.queryByLabelText("Tháng")).toBeNull();
    a.unmount();
    h.query = "ngan=khong-xuat&coSo=cs-khac"; // cơ sở ngoài phạm vi cũng coi như chưa chọn
    const b = dung();
    expect(screen.queryByLabelText("Tháng")).toBeNull();
    b.unmount();
    // đối chứng dương: cùng ngăn, chọn cơ sở ⇒ ô tháng hiện
    h.query = "ngan=da-xuat&coSo=cs1";
    dung();
    expect(screen.getByLabelText("Tháng")).toBeTruthy();
  });

  it("đối chứng: ngăn việc tồn / Cảnh báo / Cấu hình ⇒ KHÔNG có ô tháng", () => {
    h.query = "ngan=cho&coSo=cs1";
    const a = dung();
    expect(screen.queryByLabelText("Tháng")).toBeNull();
    a.unmount();
    h.pathname = "/payments/hoa-don/canh-bao";
    h.query = "ngan=da-xuat&coSo=cs1";
    const b = dung();
    expect(screen.queryByLabelText("Tháng")).toBeNull();
    b.unmount();
    h.pathname = "/payments/hoa-don/cau-hinh";
    dung();
    expect(screen.queryByLabelText("Tháng")).toBeNull();
  });
});

describe("[HDNAV-S4] pháp nhân đang thao tác — đọc từ dữ liệu truyền vào, thiếu thì NÓI thiếu", () => {
  it("cơ sở có pháp nhân ⇒ tên + MST + ký hiệu", () => {
    h.query = "coSo=cs1";
    dung();
    const dong = screen.getByText(/Công ty CP Công nghệ Giáo dục Sata Robo/).closest("p")!;
    expect(dong.textContent).toContain("0402222222");
    expect(dong.textContent).toContain("1C26TSR");
  });

  it("cơ sở THIẾU cấu hình ⇒ in lý do + link sang Cấu hình MANG cơ sở; KHÔNG bịa tên pháp nhân", () => {
    h.query = "coSo=cs2&thang=2026-08";
    dung();
    expect(screen.getByText(/Chưa khai cấu hình hoá đơn cho cơ sở này/)).toBeTruthy();
    expect(screen.queryByText(/Công ty CP Công nghệ Giáo dục Sata Robo/)).toBeNull();
    const link = screen.getByRole("link", { name: /Khai ở Cấu hình/ });
    expect(link.getAttribute("href")).toBe("/payments/hoa-don/cau-hinh?coSo=cs2&thang=2026-08");
  });

  it("đổi cơ sở thì pháp nhân đổi theo (không dính pháp nhân của cơ sở trước)", () => {
    h.query = "coSo=cs1";
    const { rerender } = dung();
    expect(screen.queryByText(/Chưa khai cấu hình hoá đơn/)).toBeNull();
    h.query = "coSo=cs2";
    rerender(<HoaDonScopeBar userId="u-an" cacCoSo={[CS1, CS2]} phapNhan={PN} thangHienTai="2026-09" />);
    expect(screen.getByText(/Chưa khai cấu hình hoá đơn/)).toBeTruthy();
    expect(screen.queryByText(/Công ty CP Công nghệ Giáo dục Sata Robo/)).toBeNull();
  });
});

describe("[HDNAV-S5] gợi ý 'cơ sở lần trước' — chỉ gợi ý, theo tài khoản, không tự áp", () => {
  it("chọn cơ sở ⇒ nhớ vào khoá có userId", () => {
    dung();
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(h.kho.get(khoaGoiYCoSo("u-an"))).toBe("cs2");
  });

  it("VÀO bằng link (không qua ô chọn) ⇒ cơ sở trên URL cũng được nhớ; cơ sở đổi theo URL thì gợi ý đổi theo", () => {
    h.query = "coSo=cs1";
    const { rerender } = dung();
    expect(h.kho.get(khoaGoiYCoSo("u-an"))).toBe("cs1");
    expect(h.push).not.toHaveBeenCalled(); // không phải do bấm ô chọn
    h.query = "coSo=cs2";
    rerender(<HoaDonScopeBar userId="u-an" cacCoSo={[CS1, CS2]} phapNhan={PN} thangHienTai="2026-09" />);
    expect(h.kho.get(khoaGoiYCoSo("u-an"))).toBe("cs2");
  });

  it("MỘT cơ sở (tự chọn, URL không mang gì) ⇒ vẫn nhớ cơ sở đó", () => {
    dung({ cacCoSo: [CS2] });
    expect(h.kho.get(khoaGoiYCoSo("u-an"))).toBe("cs2");
  });

  it("chưa chọn + có gợi ý hợp lệ ⇒ hiện NÚT gợi ý; mở trang KHÔNG tự điều hướng; bấm mới đi", () => {
    h.kho.set(khoaGoiYCoSo("u-an"), "cs2");
    dung();
    const nut = screen.getByRole("button", { name: /CS2 · Cơ sở 2/ });
    expect(h.push).not.toHaveBeenCalled(); // an toàn: không tự mở cơ sở
    fireEvent.click(nut);
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don?coSo=cs2");
  });

  it("gợi ý của TÀI KHOẢN KHÁC không hiện", () => {
    h.kho.set(khoaGoiYCoSo("u-binh"), "cs2");
    dung();
    expect(screen.queryByRole("button", { name: /CS2 · Cơ sở 2/ })).toBeNull();
  });

  it("gợi ý trỏ cơ sở ngoài phạm vi hiện tại ⇒ không hiện", () => {
    h.kho.set(khoaGoiYCoSo("u-an"), "cs-da-mat-quyen");
    dung();
    expect(screen.queryByRole("button", { name: /Dùng lại/ })).toBeNull();
  });

  it("đã chọn cơ sở ⇒ không nhắc gợi ý nữa", () => {
    h.kho.set(khoaGoiYCoSo("u-an"), "cs2");
    h.query = "coSo=cs1";
    dung();
    expect(screen.queryByRole("button", { name: /Dùng lại/ })).toBeNull();
  });

  it("kho trình duyệt ném lỗi ⇒ thanh vẫn dựng, chọn cơ sở vẫn đi", () => {
    h.khoHong = true;
    dung();
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(h.push).toHaveBeenCalledWith("/payments/hoa-don?coSo=cs2");
  });
});

describe("[HDNAV-S6] trạng thái đang đổi phạm vi NÓI THẬT cho công nghệ hỗ trợ (aria-busy)", () => {
  const vung = () => screen.getByRole("region", { name: "Phạm vi làm việc" });

  it("đứng yên ⇒ aria-busy=false (thuộc tính CÓ MẶT và mang giá trị 'false', không vắng)", () => {
    h.query = "coSo=cs1";
    dung();
    expect(vung().getAttribute("aria-busy")).toBe("false");
    expect(vung().getAttribute("data-dang-doi")).toBe("false");
  });

  it("đang điều hướng (router.push chưa xong) ⇒ aria-busy=true và vùng báo đang đổi; đối chứng là ca trên", () => {
    h.push.mockReturnValueOnce(new Promise<void>(() => {})); // chuyển tiếp không bao giờ xong
    dung();
    fireEvent.change(oCoSo(), { target: { value: "cs2" } });
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(vung().getAttribute("aria-busy")).toBe("true");
    expect(vung().getAttribute("data-dang-doi")).toBe("true");
  });
});
