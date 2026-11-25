// @vitest-environment jsdom
/**
 * [HDNAV-L*] Layout khung Hoá đơn — HÀNH VI của RSC (gọi hàm layout thật với các loader giả), không grep mã nguồn.
 *
 * Canh những thứ chỉ layout quyết: cờ tắt ⇒ 404; chưa đăng nhập / không quyền nào ⇒ KHÔNG nạp gì (không lộ tên cơ sở,
 * pháp nhân) và trả nguyên trang con; tab theo quyền KÈM đối chứng dương; danh sách cơ sở trao cho thanh phạm vi đúng là
 * thứ loader đã lọc phạm vi trả về.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PAGE_GATES } from "@/lib/auth/page-gates";

const h = vi.hoisted(() => ({
  laBat: true,
  session: { user: { id: "u-an" } } as { user: { id: string } } | null,
  coHoaDon: true,
  coCauHinh: true,
  coSo: [] as { id: string; ma: string; ten: string }[],
  napCoSo: vi.fn(),
  docCauHinh: vi.fn(),
  resolveActor: vi.fn(),
  tomTat: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/auth/check-permission", () => ({
  // Hai cổng có cùng action ("payments:confirm") nên chỉ phân biệt được theo CHÍNH mảng cổng — đúng thứ layout truyền vào.
  checkAnyPermission: async (cong: unknown) => (cong === PAGE_GATES["/payments/hoa-don/cau-hinh"] ? h.coCauHinh : h.coHoaDon),
}));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: async () => h.laBat }));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({ napCoSoLocHoaDon: h.napCoSo }));
vi.mock("@/lib/finance/hoa-don/cau-hinh-co-so-db", () => ({ docCauHinhDangBat: h.docCauHinh }));
vi.mock("./_components/hoa-don-nav", () => ({
  HoaDonNav: ({ hien }: { hien: string[] }) => <div data-testid="nav" data-hien={hien.join(",")} />,
}));
vi.mock("./_components/hoa-don-scope-bar", () => ({
  HoaDonScopeBar: (p: { userId: string; cacCoSo: { id: string }[]; phapNhan: Record<string, { loai: string }>; thangHienTai: string }) => (
    <div data-testid="bar" data-user={p.userId} data-co-so={p.cacCoSo.map((c) => c.id).join(",")} data-pn={Object.keys(p.phapNhan).join(",")} data-thang={p.thangHienTai} />
  ),
}));

// Đi qua hàm THẬT (các ca khác vẫn đọc pháp nhân thật), chỉ ghi lại đầu vào để canh NGÀY mà layout truyền xuống.
vi.mock("./_components/phap-nhan-hien-thi", async (goc) => {
  const g = await goc<typeof import("./_components/phap-nhan-hien-thi")>();
  return {
    ...g,
    tomTatPhapNhanTheoCoSo: (i: Parameters<typeof g.tomTatPhapNhanTheoCoSo>[0]) => {
      h.tomTat(i);
      return g.tomTatPhapNhanTheoCoSo(i);
    },
  };
});

import HoaDonLayout from "./layout";

async function dung() {
  const cay = await HoaDonLayout({ children: <p>NOI-DUNG-TRANG</p> });
  return render(cay);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.laBat = true;
  h.session = { user: { id: "u-an" } };
  h.coHoaDon = true;
  h.coCauHinh = true;
  h.coSo = [
    { id: "cs1", ma: "CS1", ten: "Cơ sở 1" },
    { id: "cs2", ma: "CS2", ten: "Cơ sở 2" },
  ];
  h.resolveActor.mockResolvedValue({ id: "u-an" });
  h.napCoSo.mockImplementation(async () => h.coSo);
  h.docCauHinh.mockResolvedValue([]);
});

describe("[HDNAV-L1] cổng của layout", () => {
  it("cờ TẮT ⇒ notFound() và KHÔNG nạp gì", async () => {
    h.laBat = false;
    await expect(dung()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.napCoSo).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập ⇒ chỉ trả trang con (trang tự redirect); không nạp cơ sở", async () => {
    h.session = null;
    await dung();
    expect(screen.getByText("NOI-DUNG-TRANG")).toBeTruthy();
    expect(screen.queryByTestId("nav")).toBeNull();
    expect(screen.queryByTestId("bar")).toBeNull();
    expect(h.napCoSo).not.toHaveBeenCalled();
  });

  it("đăng nhập nhưng KHÔNG có quyền nào của khu ⇒ trang con trần; không lộ cơ sở / pháp nhân", async () => {
    h.coHoaDon = false;
    h.coCauHinh = false;
    await dung();
    expect(screen.getByText("NOI-DUNG-TRANG")).toBeTruthy();
    expect(screen.queryByTestId("bar")).toBeNull();
    expect(h.napCoSo).not.toHaveBeenCalled();
    expect(h.docCauHinh).not.toHaveBeenCalled();
  });
});

describe("[HDNAV-L2] tab theo quyền — đối chứng dương cho mọi ca vắng mặt", () => {
  it("đủ quyền ⇒ ba tab", async () => {
    await dung();
    expect(screen.getByTestId("nav").getAttribute("data-hien")).toBe("hoa-don,canh-bao,cau-hinh");
  });

  it("thiếu quyền Cấu hình ⇒ không có tab Cấu hình, hai tab kia VẪN có", async () => {
    h.coCauHinh = false;
    await dung();
    expect(screen.getByTestId("nav").getAttribute("data-hien")).toBe("hoa-don,canh-bao");
  });

  it("thiếu quyền Hoá đơn nhưng có quyền Cấu hình ⇒ chỉ tab Cấu hình", async () => {
    h.coHoaDon = false;
    await dung();
    expect(screen.getByTestId("nav").getAttribute("data-hien")).toBe("cau-hinh");
  });

  it("Nhật ký không bao giờ có trong tập tab layout trao đi", async () => {
    await dung();
    expect(screen.getByTestId("nav").getAttribute("data-hien")).not.toContain("nhat-ky");
  });
});

describe("[HDNAV-L3] thanh phạm vi nhận ĐÚNG dữ liệu đã lọc phạm vi", () => {
  it("cơ sở = đúng thứ napCoSoLocHoaDon(actor) trả về (actor của chính người xem), không thêm không bớt", async () => {
    await dung();
    expect(h.resolveActor).toHaveBeenCalledWith("u-an");
    expect(h.napCoSo).toHaveBeenCalledWith({ id: "u-an" });
    expect(screen.getByTestId("bar").getAttribute("data-co-so")).toBe("cs1,cs2");
    expect(screen.getByTestId("bar").getAttribute("data-user")).toBe("u-an");
  });

  it("pháp nhân tính cho MỌI cơ sở được phép (thiếu cấu hình vẫn có mục THIEU), cấu hình đọc theo đúng danh sách cơ sở đó", async () => {
    await dung();
    expect(screen.getByTestId("bar").getAttribute("data-pn")).toBe("cs1,cs2");
    expect(h.docCauHinh).toHaveBeenCalledWith({ id: "u-an" }, ["cs1", "cs2"]);
  });

  it("người chỉ được một cơ sở ⇒ thanh phạm vi chỉ nhận một cơ sở đó", async () => {
    h.coSo = [{ id: "cs2", ma: "CS2", ten: "Cơ sở 2" }];
    await dung();
    expect(screen.getByTestId("bar").getAttribute("data-co-so")).toBe("cs2");
    expect(screen.getByTestId("bar").getAttribute("data-pn")).toBe("cs2");
  });

  it("tháng mặc định có dạng YYYY-MM", async () => {
    await dung();
    expect(screen.getByTestId("bar").getAttribute("data-thang")).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it("trang con được vẽ bên trong khung, dưới <h1> duy nhất", async () => {
    await dung();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hoá đơn điện tử");
    expect(screen.getByText("NOI-DUNG-TRANG")).toBeTruthy();
  });
});

describe("[HDNAV-L4] layout tính NGÀY và THÁNG theo lịch Việt Nam (UTC+7), không theo UTC", () => {
  // Mốc 18:00 UTC = 01:00 SÁNG HÔM SAU ở Việt Nam. Cấu hình hiệu lực "từ ngày mai VN" phải đã có hiệu lực; dùng ngày UTC
  // thì pháp nhân bị tính lùi một ngày (cơ sở báo THIẾU dù đã khai) trong 7 giờ sáng mỗi ngày.
  const thoiGian = (iso: string, chay: () => Promise<void>) => async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
    try {
      await chay();
    } finally {
      vi.useRealTimers();
    }
  };

  it(
    "00:00–07:00 giờ VN (17:00–24:00 UTC): ngày trao cho pháp nhân là NGÀY VN, tháng hiện tại là THÁNG VN",
    thoiGian("2026-08-31T18:00:00Z", async () => {
      await dung();
      expect(h.tomTat).toHaveBeenCalledTimes(1);
      expect(h.tomTat.mock.calls[0]![0].ngay).toBe("2026-09-01"); // UTC sẽ là 2026-08-31
      expect(screen.getByTestId("bar").getAttribute("data-thang")).toBe("2026-09"); // UTC sẽ là 2026-08
    }),
  );

  it(
    "đối chứng: giữa ngày VN (03:00 UTC = 10:00 VN) ngày UTC và ngày VN trùng nhau",
    thoiGian("2026-08-31T03:00:00Z", async () => {
      await dung();
      expect(h.tomTat.mock.calls[0]![0].ngay).toBe("2026-08-31");
      expect(screen.getByTestId("bar").getAttribute("data-thang")).toBe("2026-08");
    }),
  );
});
