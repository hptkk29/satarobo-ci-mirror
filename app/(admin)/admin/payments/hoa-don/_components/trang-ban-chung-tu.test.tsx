// @vitest-environment jsdom
/**
 * [TBC-*] `TrangBanChungTu` — thân CHUNG của tab "Hoá đơn" và tab "Cảnh báo & sai sót" (S5b). HÀNH VI của RSC: gọi hàm
 * thật với các loader giả, bắt `redirect()` (ném NEXT_REDIRECT:<url>) và đọc URL đích; bàn chứng từ được thay bằng một
 * cái vỏ ghi lại props nhận được. `[HDNAV-W4]` chỉ grep ba câu trong mã — không canh được ĐẦU RA của chúng.
 *
 * Mỗi ca "KHÔNG làm X" đi kèm ca "làm X" ở đúng điều kiện bên cạnh (đối chứng dương). Đồng hồ được đóng băng bằng
 * `vi.setSystemTime` — tháng mặc định là 2026-09 (giờ VN).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

type Co = { id: string; ma: string; ten: string };
type DongGia = {
  key: string;
  ngan: string;
  ngayThu: string;
  ghiNhanLuc: string;
  hoaDon: { id: string } | null;
  hoaDonNhap: boolean;
  coSoId: string;
  coSo: { ma: string };
  cauHinhCoSo: null;
  hanhDong: { taiLen: { bat: boolean } };
};

const h = vi.hoisted(() => ({
  cacCoSo: [] as { id: string; ma: string; ten: string }[],
  dong: [] as unknown[],
  tuHoaDon: null as { coSoId: string; thang: string } | null,
  resolveActor: vi.fn(),
  napHangCho: vi.fn(),
  thangCuaHoaDon: vi.fn(),
  goiY: vi.fn(),
  oSo: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async () => true }));
vi.mock("@/lib/finance/hoa-don/hang-cho", () => ({
  napCoSoLocHoaDon: async () => h.cacCoSo,
  napHangChoHoaDon: h.napHangCho,
  thangCuaHoaDonTrongTamNhin: h.thangCuaHoaDon,
}));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: () => true }));
vi.mock("@/lib/finance/hoa-don/quyen", () => ({ phamViKeToan: () => "ALL" }));
vi.mock("@/lib/finance/hoa-don/goi-y-so-db", () => ({ goiYSoChoLanThu: h.goiY }));
vi.mock("@/lib/finance/hoa-don/o-so-hoa-don", () => ({ oSoDienSan: h.oSo }));
vi.mock("./ban-chung-tu", () => ({
  BanChungTu: (p: {
    khuVuc: string;
    ngan: string;
    dem: Record<string, number>;
    dongTrongNgan: { key: string }[];
    dangChon: { key: string } | null;
    chonKhongThay: boolean;
    chuaChonCoSo: boolean;
    thieuCoSo: number;
    loc: { url: unknown; coSo: string | null; thang: string; thangMacDinh: string; cacCoSo: Co[] };
    goiYBanDau: unknown;
  }) => (
    <div
      data-testid="ban"
      data-khu-vuc={p.khuVuc}
      data-ngan={p.ngan}
      data-dang-chon={p.dangChon?.key ?? ""}
      data-chon-khong-thay={String(p.chonKhongThay)}
      data-chua-chon-co-so={String(p.chuaChonCoSo)}
      data-trong-ngan={p.dongTrongNgan.map((d) => d.key).join(",")}
      data-dem={JSON.stringify(p.dem)}
      data-loc={JSON.stringify({ url: p.loc.url, coSo: p.loc.coSo, thang: p.loc.thang, thangMacDinh: p.loc.thangMacDinh })}
      data-goi-y={p.goiYBanDau ? "co" : ""}
    />
  ),
}));

import { TrangBanChungTu } from "./trang-ban-chung-tu";

const CS1: Co = { id: "cs1", ma: "CS1", ten: "Cơ sở 1" };
const CS2: Co = { id: "cs2", ma: "CS2", ten: "Cơ sở 2" };

function dongGia(key: string, ngan: string, rieng: Partial<DongGia> = {}): DongGia {
  return {
    key,
    ngan,
    ngayThu: "2026-09-01",
    ghiNhanLuc: "2026-09-01T03:00:00.000Z",
    hoaDon: null,
    hoaDonNhap: false,
    coSoId: "cs1",
    coSo: { ma: "CS1" },
    cauHinhCoSo: null,
    hanhDong: { taiLen: { bat: false } },
    ...rieng,
  };
}

type Sp = Parameters<typeof TrangBanChungTu>[0]["sp"];
type KhuVuc = Parameters<typeof TrangBanChungTu>[0]["khuVuc"];

/** Dựng trang; ném lại lỗi nếu trang ném (kể cả NEXT_REDIRECT). */
async function dung(sp: Sp, khuVuc: KhuVuc = "hoa-don") {
  const cay = await TrangBanChungTu({ sp, userId: "u-an", khuVuc });
  return render(cay);
}

/** URL đích của lần `redirect()`; ném nếu trang KHÔNG chuyển hướng. */
async function chuyenDen(sp: Sp, khuVuc: KhuVuc = "hoa-don"): Promise<URL> {
  try {
    await TrangBanChungTu({ sp, userId: "u-an", khuVuc });
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return new URL(m[1]!, "http://x");
    throw e;
  }
  throw new Error("trang KHÔNG chuyển hướng");
}

const ban = () => screen.getByTestId("ban");
const loc = () =>
  JSON.parse(ban().getAttribute("data-loc")!) as {
    url: { coSo: string | null; thang: string | null; sapXep: string | null };
    coSo: string | null;
    thang: string;
    thangMacDinh: string;
  };
const cua = (u: URL) => Object.fromEntries(u.searchParams.entries());

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T05:00:00Z")); // 12:00 VN ngày 15/09 ⇒ tháng mặc định 2026-09
  h.cacCoSo = [CS1, CS2];
  h.dong = [];
  h.tuHoaDon = null;
  h.resolveActor.mockResolvedValue({ id: "u-an" });
  h.napHangCho.mockImplementation(async () => ({ dong: h.dong, thieuCoSo: 0, khoOk: true }));
  h.thangCuaHoaDon.mockImplementation(async () => h.tuHoaDon);
  h.goiY.mockResolvedValue({ ok: true });
  h.oSo.mockReturnValue({ kyHieu: null, ngayPhatHanh: null });
});
afterEach(() => vi.useRealTimers());

describe("[TBC-01] ?hoaDon= chuẩn hoá URL — tháng người dùng đã chọn KHÔNG bị ghi đè bởi tháng của hoá đơn", () => {
  beforeEach(() => {
    h.tuHoaDon = { coSoId: "cs1", thang: "2026-08" };
  });

  it("không ghi ?thang= ⇒ redirect mang cơ sở + tháng CỦA HOÁ ĐƠN, giữ ?hoaDon=", async () => {
    const u = await chuyenDen({ hoaDon: "hd1" });
    expect(u.pathname).toBe("/payments/hoa-don");
    expect(cua(u)).toEqual({ hoaDon: "hd1", coSo: "cs1", thang: "2026-08" });
  });

  it("CÓ ?thang= ⇒ redirect giữ tháng NGƯỜI DÙNG chọn, không đổi sang tháng hoá đơn", async () => {
    const u = await chuyenDen({ hoaDon: "hd1", thang: "2026-03" });
    expect(cua(u)).toEqual({ hoaDon: "hd1", thang: "2026-03", coSo: "cs1" });
  });

  it("đã có cơ sở trên URL (không phải chuẩn hoá): bộ lọc dùng tháng NGƯỜI DÙNG chọn; đối chứng: không chọn ⇒ tháng hoá đơn", async () => {
    await dung({ hoaDon: "hd1", coSo: "cs1", thang: "2026-03" });
    expect(loc().thang).toBe("2026-03");
    expect(h.napHangCho.mock.calls[0]![1].boLoc).toEqual({ coSo: "cs1", thang: "2026-03" });
    cleanup();
    await dung({ hoaDon: "hd1", coSo: "cs1" });
    expect(loc().thang).toBe("2026-08");
    expect(h.napHangCho.mock.calls[1]![1].boLoc).toEqual({ coSo: "cs1", thang: "2026-08" });
  });
});

describe("[TBC-02] ?hoaDon= chuẩn hoá — chỉ khi ĐÚNG điều kiện, và luôn mang tháng", () => {
  it("hoá đơn tháng trước: URL chuẩn hoá mang đủ cơ sở + tháng (thiếu tháng ⇒ hoá đơn 'không còn trong danh sách')", async () => {
    h.tuHoaDon = { coSoId: "cs2", thang: "2026-07" };
    const u = await chuyenDen({ hoaDon: "hd9" });
    expect(u.searchParams.get("coSo")).toBe("cs2");
    expect(u.searchParams.get("thang")).toBe("2026-07");
  });

  it("chuyển hướng giữ khu vực của CHÍNH trang (tab Cảnh báo ở lại tab Cảnh báo)", async () => {
    h.tuHoaDon = { coSoId: "cs1", thang: "2026-08" };
    const u = await chuyenDen({ hoaDon: "hd1" }, "canh-bao");
    expect(u.pathname).toBe("/payments/hoa-don/canh-bao");
  });

  it("đã có ?coSo= ⇒ KHÔNG chuyển hướng (trang dựng bình thường)", async () => {
    h.tuHoaDon = { coSoId: "cs1", thang: "2026-08" };
    await dung({ hoaDon: "hd1", coSo: "cs1" });
    expect(ban().getAttribute("data-khu-vuc")).toBe("hoa-don");
  });

  it("đã có ?chon= ⇒ KHÔNG chuẩn hoá và KHÔNG tra tháng hoá đơn (khoá lần thu thắng)", async () => {
    h.tuHoaDon = { coSoId: "cs1", thang: "2026-08" };
    await dung({ hoaDon: "hd1", chon: "k1", coSo: "cs1" });
    expect(h.thangCuaHoaDon).not.toHaveBeenCalled();
    expect(loc().thang).toBe("2026-09");
  });

  it("hoá đơn NGOÀI tầm nhìn (loader trả null) ⇒ không chuyển hướng, không bịa cơ sở/tháng", async () => {
    h.tuHoaDon = null;
    await dung({ hoaDon: "hd-la" });
    expect(ban().getAttribute("data-chua-chon-co-so")).toBe("true");
    expect(loc().coSo).toBeNull();
    expect(loc().thang).toBe("2026-09");
  });
});

describe("[TBC-03] chuyển hướng khi ngăn lạc sang khu vực khác — GIỮ ngăn và mọi tham số", () => {
  it("ngăn ghi thẳng trên URL (URL cũ ?ngan=lech ở tab Hoá đơn) ⇒ chuyển sớm, chưa nạp gì", async () => {
    const u = await chuyenDen({ ngan: "lech", coSo: "cs1", thang: "2026-08" });
    expect(u.pathname).toBe("/payments/hoa-don/canh-bao");
    expect(cua(u)).toEqual({ ngan: "lech", coSo: "cs1", thang: "2026-08" });
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.napHangCho).not.toHaveBeenCalled();
  });

  it("chiều ngược lại: tab Cảnh báo nhận ?ngan=da-xuat ⇒ sang tab Hoá đơn", async () => {
    const u = await chuyenDen({ ngan: "da-xuat" }, "canh-bao");
    expect(u.pathname).toBe("/payments/hoa-don");
    expect(u.searchParams.get("ngan")).toBe("da-xuat");
  });

  it("đối chứng: ngăn thuộc CHÍNH khu vực ⇒ không chuyển hướng", async () => {
    await dung({ ngan: "da-xuat", coSo: "cs1" });
    expect(ban().getAttribute("data-ngan")).toBe("da-xuat");
    cleanup();
    await dung({ ngan: "lech", coSo: "cs1" }, "canh-bao");
    expect(ban().getAttribute("data-ngan")).toBe("lech");
  });

  it("?chon= trỏ dòng nằm ở khu vực KHÁC ⇒ chuyển sang đó và URL mới MANG NGĂN của dòng (mất ngăn là tab đích mở nhầm ngăn)", async () => {
    h.dong = [dongGia("k1", "lech")];
    const u = await chuyenDen({ chon: "k1", coSo: "cs1" });
    expect(u.pathname).toBe("/payments/hoa-don/canh-bao");
    expect(cua(u)).toEqual({ chon: "k1", coSo: "cs1", ngan: "lech" });
  });

  it("đối chứng: dòng ?chon= ở CHÍNH khu vực ⇒ không chuyển, mở đúng ngăn của dòng", async () => {
    h.dong = [dongGia("k1", "da-xuat")];
    await dung({ chon: "k1", coSo: "cs1" });
    expect(ban().getAttribute("data-ngan")).toBe("da-xuat");
    expect(ban().getAttribute("data-dang-chon")).toBe("k1");
  });

  it("không ngăn, không dòng chọn ⇒ ngăn ĐẦU của khu vực (Cảnh báo mở ở 'Lệch số', không rơi sang tab kia)", async () => {
    await dung({ coSo: "cs1" }, "canh-bao");
    expect(ban().getAttribute("data-ngan")).toBe("lech");
    cleanup();
    await dung({ coSo: "cs1" }, "hoa-don");
    expect(ban().getAttribute("data-ngan")).toBe("cho");
  });
});

describe("[TBC-04] link 'Chứng từ ngân hàng' — chỉ ở tab Hoá đơn, mang phạm vi đang xem", () => {
  it("tab Hoá đơn: có link, MANG cơ sở + tháng + sắp xếp đang xem", async () => {
    await dung({ coSo: "cs1", thang: "2026-08", sapXep: "cu-nhat" });
    const a = screen.getByRole("link", { name: "Chứng từ ngân hàng" });
    expect(a.getAttribute("href")).toBe("/payments/hoa-don/chung-tu-ngan-hang?coSo=cs1&thang=2026-08&sapXep=cu-nhat");
  });

  it("tab Cảnh báo: KHÔNG có link đó (đối chứng là ca trên)", async () => {
    await dung({ coSo: "cs1", thang: "2026-08" }, "canh-bao");
    expect(screen.queryByRole("link", { name: "Chứng từ ngân hàng" })).toBeNull();
  });

  it("tháng mặc định không ghi lên URL; chưa chọn cơ sở ⇒ link trần", async () => {
    await dung({ coSo: "cs2" });
    expect(screen.getByRole("link", { name: "Chứng từ ngân hàng" }).getAttribute("href")).toBe(
      "/payments/hoa-don/chung-tu-ngan-hang?coSo=cs2",
    );
    cleanup();
    await dung({});
    expect(screen.getByRole("link", { name: "Chứng từ ngân hàng" }).getAttribute("href")).toBe("/payments/hoa-don/chung-tu-ngan-hang");
  });
});

describe("[TBC-05] sắp xếp 'cũ nhất' đi vào URL phạm vi và thứ tự dòng", () => {
  beforeEach(() => {
    h.dong = [
      dongGia("a", "cho", { ngayThu: "2026-09-01" }),
      dongGia("b", "cho", { ngayThu: "2026-09-03" }),
      dongGia("c", "cho", { ngayThu: "2026-09-02" }),
    ];
  });

  it("?sapXep=cu-nhat ⇒ url.sapXep='cu-nhat' VÀ dòng xếp cũ nhất trước", async () => {
    await dung({ coSo: "cs1", sapXep: "cu-nhat" });
    expect(loc().url.sapXep).toBe("cu-nhat");
    expect(ban().getAttribute("data-trong-ngan")).toBe("a,c,b");
  });

  it("đối chứng: không ghi / giá trị lạ ⇒ url.sapXep=null, mới nhất trước", async () => {
    await dung({ coSo: "cs1" });
    expect(loc().url.sapXep).toBeNull();
    expect(ban().getAttribute("data-trong-ngan")).toBe("b,c,a");
    cleanup();
    await dung({ coSo: "cs1", sapXep: "bay-ba" });
    expect(loc().url.sapXep).toBeNull();
  });
});

describe("[TBC-06] chonKhongThay — báo 'dòng đã chọn không còn' đúng lúc", () => {
  it("?chon= không khớp dòng nào ⇒ true", async () => {
    h.dong = [dongGia("k1", "cho")];
    await dung({ chon: "k-lac", coSo: "cs1" });
    expect(ban().getAttribute("data-chon-khong-thay")).toBe("true");
    expect(ban().getAttribute("data-dang-chon")).toBe("");
  });

  it("?hoaDon= không khớp dòng nào (đã có cơ sở) ⇒ true", async () => {
    h.dong = [dongGia("k1", "da-xuat", { hoaDon: { id: "hd1" } })];
    await dung({ hoaDon: "hd-khac", coSo: "cs1" });
    expect(ban().getAttribute("data-chon-khong-thay")).toBe("true");
  });

  it("đối chứng: ?chon= khớp dòng ⇒ false; ?hoaDon= khớp dòng ⇒ false", async () => {
    h.dong = [dongGia("k1", "da-xuat", { hoaDon: { id: "hd1" } })];
    await dung({ chon: "k1", coSo: "cs1" });
    expect(ban().getAttribute("data-chon-khong-thay")).toBe("false");
    expect(ban().getAttribute("data-dang-chon")).toBe("k1");
    cleanup();
    await dung({ hoaDon: "hd1", coSo: "cs1" });
    expect(ban().getAttribute("data-chon-khong-thay")).toBe("false");
    expect(ban().getAttribute("data-dang-chon")).toBe("k1");
  });

  it("không chọn gì ⇒ false (kể cả khi chẳng có dòng nào để thấy)", async () => {
    h.dong = [];
    await dung({ coSo: "cs1" });
    expect(ban().getAttribute("data-chon-khong-thay")).toBe("false");
    cleanup();
    h.dong = [dongGia("k1", "cho")];
    await dung({ coSo: "cs1" });
    expect(ban().getAttribute("data-chon-khong-thay")).toBe("false");
  });
});

describe("[TBC-07] nhiều cơ sở mà CHƯA chọn ⇒ không nạp gì; có cơ sở ⇒ nạp đúng bộ lọc", () => {
  it("chưa chọn: không gọi loader hàng chờ, báo chuaChonCoSo", async () => {
    await dung({});
    expect(h.napHangCho).not.toHaveBeenCalled();
    expect(ban().getAttribute("data-chua-chon-co-so")).toBe("true");
  });

  it("chọn cơ sở trong phạm vi ⇒ nạp với đúng cơ sở + tháng mặc định (giờ VN)", async () => {
    await dung({ coSo: "cs2" });
    expect(h.napHangCho).toHaveBeenCalledTimes(1);
    expect(h.napHangCho.mock.calls[0]![1].boLoc).toEqual({ coSo: "cs2", thang: "2026-09" });
    expect(ban().getAttribute("data-chua-chon-co-so")).toBe("false");
  });

  it("cơ sở NGOÀI phạm vi ⇒ coi như chưa chọn (không nạp)", async () => {
    await dung({ coSo: "cs-la" });
    expect(h.napHangCho).not.toHaveBeenCalled();
  });

  it("một cơ sở duy nhất ⇒ tự chọn", async () => {
    h.cacCoSo = [CS2];
    await dung({});
    expect(h.napHangCho.mock.calls[0]![1].boLoc.coSo).toBe("cs2");
  });
});

describe("[TBC-08] tháng mặc định theo lịch VN, không theo UTC", () => {
  it("00:30 sáng ngày 01/10 giờ VN (17:30 UTC ngày 30/09) ⇒ tháng mặc định là 2026-10", async () => {
    vi.setSystemTime(new Date("2026-09-30T17:30:00Z"));
    await dung({ coSo: "cs1" });
    expect(loc().thangMacDinh).toBe("2026-10");
    expect(h.napHangCho.mock.calls[0]![1].boLoc.thang).toBe("2026-10");
    expect(loc().url.thang).toBeNull(); // trùng mặc định ⇒ không ghi lên URL
  });

  it("đối chứng: giữa ngày ⇒ vẫn là tháng đó; tháng khác mặc định thì GHI lên URL", async () => {
    await dung({ coSo: "cs1", thang: "2026-08" });
    expect(loc().thangMacDinh).toBe("2026-09");
    expect(loc().url.thang).toBe("2026-08");
  });
});

describe("[TBC-09] số đếm và ngăn trao cho bàn chứng từ", () => {
  it("số đếm tính trên TOÀN BỘ dòng nạp về (hai khu vực dùng chung một lượt nạp), danh sách chỉ dòng của ngăn đang mở", async () => {
    h.dong = [dongGia("a", "cho"), dongGia("b", "cho"), dongGia("c", "lech")];
    await dung({ coSo: "cs1" });
    const dem = JSON.parse(ban().getAttribute("data-dem")!) as Record<string, number>;
    expect(dem.cho).toBe(2);
    expect(dem.lech).toBe(1);
    expect(ban().getAttribute("data-trong-ngan")).toBe("a,b");
  });
});
