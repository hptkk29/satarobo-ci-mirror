// @vitest-environment jsdom
/**
 * [DPU-*] — giao diện cổng DISC của phụ huynh trên phần tử thật. DỮ LIỆU GIẢ. Mọi ca "KHÔNG thấy X" có đối chứng dương.
 *   [DPU-01] trạng thái rỗng: lời nhắn + CTA tới địa chỉ truyền vào (tuyệt đối); danh sách KHÔNG hiện
 *   [DPU-02] tổng quan + danh sách: tên, ngày, liên kết chi tiết đúng id, phân trang đúng hướng
 *   [DPU-03] chi tiết: biểu đồ có chữ mô tả đủ 4 nhóm, ghi chú "xu hướng, không phải chẩn đoán", không nhãn cố định lên trẻ
 *   [DPU-04] so sánh theo thời gian: có chênh lệch khi cùng phiên bản; khác phiên bản nói rõ không so sánh; một lần làm ⇒ lời mời
 *   [DPU-05] điểm không đọc được ⇒ nói thật, không vẽ biểu đồ số 0; có báo cáo ⇒ có nút tải, không ⇒ không nút
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ChiTietLuotDisc } from "./chi-tiet-luot-disc";
import { DanhSachLuotDisc, GhiChuXuHuong, LichSuDisc, TongQuanGiaDinh, TrangRongDisc } from "./tong-quan-disc";
import { RadarDisc, ThanhDiem } from "./bieu-do-disc";
import { dungLichSu, type LuotDisc, type TrangLuot } from "@/lib/disc/portal-doc";

afterEach(cleanup);

const nguoi = (vai: "PHU_HUYNH" | "HOC_SINH", ten: string, d: [number, number, number, number] | null, pb = "v1", ma = "BD-GIA"): LuotDisc["nguoi"][number] => ({
  vaiTro: vai,
  hoTen: ten,
  namSinh: vai === "PHU_HUYNH" ? 1985 : 2016,
  bacHoc: vai === "PHU_HUYNH" ? null : "3",
  nguoiLonQuanSat: false,
  diem: d ? { D: d[0], I: d[1], S: d[2], C: d[3] } : null,
  maBoDe: d ? ma : null,
  phienBanBoDe: d ? pb : null,
});
const luot = (id: string, ngay: string, ns: LuotDisc["nguoi"]): LuotDisc => ({ id, taoLuc: new Date(ngay), engineVersion: "gia-1", nguoi: ns });

const L1 = luot("l1", "2026-11-01T05:00:00Z", [nguoi("PHU_HUYNH", "Phụ huynh Giả", [40, 30, 20, 10]), nguoi("HOC_SINH", "Bé Giả", [10, 20, 30, 40])]);
const L2 = luot("l2", "2026-12-01T05:00:00Z", [nguoi("PHU_HUYNH", "Phụ huynh Giả", [45, 25, 20, 10]), nguoi("HOC_SINH", "Bé Giả", [15, 20, 30, 35])]);

function trang(p: Partial<TrangLuot> = {}): TrangLuot {
  return { luot: [L2, L1], tong: 2, trang: 1, tongTrang: 1, moiTrang: 10, ...p };
}

describe("[DPU-01] trạng thái rỗng", () => {
  it("lời nhắn + CTA tuyệt đối; đối chứng: có dữ liệu ⇒ không còn trạng thái rỗng", () => {
    const { container, unmount } = render(<TrangRongDisc huongDanHref="https://satarobo.vn/disc" />);
    expect(screen.getByText(/chưa có kết quả DISC nào/i)).toBeTruthy();
    const cta = screen.getByRole("link", { name: /Làm bài DISC/ });
    expect(cta.getAttribute("href")).toBe("https://satarobo.vn/disc");
    expect(container.querySelector("[data-trang-thai='rong']")).toBeTruthy();
    unmount();
    const r = render(<DanhSachLuotDisc trang={trang()} />);
    expect(r.container.querySelector("[data-trang-thai='rong']")).toBeNull();
  });
});

describe("[DPU-02] tổng quan + danh sách", () => {
  it("mỗi thành viên một thẻ với kết quả MỚI nhất; liên kết đúng id", () => {
    render(<TongQuanGiaDinh lichSu={dungLichSu([L1, L2])} />);
    const the = document.querySelector("[data-nguoi='HOC_SINH|bé giả']") as HTMLElement;
    expect(the).toBeTruthy();
    expect(within(the).getByText(/01\/12\/2026/)).toBeTruthy();
    expect(within(the).getByRole("link", { name: /Xem kết quả đầy đủ/ }).getAttribute("href")).toBe("/portal/disc/l2");
  });

  it("danh sách: liên kết theo id, ngày giờ VN; phân trang chỉ hiện khi >1 trang, đúng hướng", () => {
    const { unmount } = render(<DanhSachLuotDisc trang={trang()} />);
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/portal/disc/l2", "/portal/disc/l1"]);
    expect(screen.queryByRole("navigation", { name: /Phân trang/ })).toBeNull();
    unmount();
    render(<DanhSachLuotDisc trang={trang({ tongTrang: 3, trang: 2, tong: 25 })} />);
    expect(screen.getByRole("link", { name: "Trang trước" }).getAttribute("href")).toBe("/portal/disc?trang=1");
    expect(screen.getByRole("link", { name: "Trang sau" }).getAttribute("href")).toBe("/portal/disc?trang=3");
  });
});

describe("[DPU-03] chi tiết + biểu đồ", () => {
  it("radar/thanh có chữ mô tả đủ D-I-S-C; có ghi chú xu hướng; không gắn nhãn cố định lên trẻ", () => {
    render(<ChiTietLuotDisc luot={L1} coBaoCao />);
    const radar = screen.getAllByRole("img").find((e) => e.getAttribute("data-bieu-do") === "radar")!;
    expect(radar.getAttribute("aria-label")).toMatch(/D 40, I 30, S 20, C 10|D 10, I 20, S 30, C 40/);
    expect(screen.getAllByRole("progressbar")).toHaveLength(8); // 2 người × 4 nhóm
    expect(screen.getByText(/xu hướng hành vi/i).textContent).toMatch(/không phải chẩn đoán/);
    // Không có câu kiểu "Bé thuộc nhóm/kiểu X"
    expect(document.body.textContent).not.toMatch(/thuộc (nhóm|kiểu|típ)|là (người|trẻ) (kiểu|nhóm)/i);
    expect(screen.getByRole("link", { name: /Mở báo cáo/ }).getAttribute("href")).toBe("/portal/disc/l1/bao-cao");
  });

  it("bảng điểm riêng lẻ: ThanhDiem + RadarDisc kẹp giá trị ngoài 0–100", () => {
    render(
      <>
        <ThanhDiem diem={{ D: 150, I: -5, S: 50, C: 49.6 }} ten="Bé" />
        <RadarDisc diem={{ D: 150, I: -5, S: 50, C: 49.6 }} ten="Bé" />
      </>,
    );
    const v = screen.getAllByRole("progressbar").map((e) => e.getAttribute("aria-valuenow"));
    expect(v).toEqual(["100", "0", "50", "50"]);
  });
});

describe("[DPU-04] so sánh theo thời gian", () => {
  it("cùng phiên bản ⇒ chênh lệch có dấu; đối chứng: một lần làm ⇒ lời mời, không bảng", () => {
    render(<LichSuDisc lichSu={dungLichSu([L1, L2])} />);
    expect(document.querySelectorAll("[data-so-sanh='co']").length).toBe(2);
    const soSanh = document.querySelector("[data-lich-su='HOC_SINH|bé giả'] [data-so-sanh='co']") as HTMLElement;
    expect(soSanh.textContent).toMatch(/D\s*\+5/);
    expect(soSanh.textContent).toMatch(/C\s*−5/);
    cleanup();
    render(<LichSuDisc lichSu={dungLichSu([L1])} />);
    expect(screen.getAllByText(/Mới có một lần làm/).length).toBe(2);
    expect(document.querySelector("table")).toBeNull();
  });

  it("khác phiên bản ⇒ nói rõ KHÔNG so sánh trực tiếp và không in chênh lệch", () => {
    const L3 = luot("l3", "2027-06-01T05:00:00Z", [nguoi("HOC_SINH", "Bé Giả", [90, 90, 90, 90], "v2")]);
    render(<LichSuDisc lichSu={dungLichSu([L1, L3])} />);
    const be = within(document.querySelector("[data-lich-su='HOC_SINH|bé giả']") as HTMLElement);
    expect(be.getByText(/phiên bản nên không so sánh trực tiếp/)).toBeTruthy();
    expect(document.querySelector("[data-lich-su='HOC_SINH|bé giả'] [data-so-sanh='co']")).toBeNull();
  });
});

describe("[DPU-05] điểm không đọc được / báo cáo", () => {
  it("điểm null ⇒ thông báo thật, không vẽ biểu đồ cho người đó; đối chứng: người còn lại có biểu đồ", () => {
    const hong = luot("h", "2026-11-01T05:00:00Z", [nguoi("PHU_HUYNH", "Phụ huynh Giả", [40, 30, 20, 10]), nguoi("HOC_SINH", "Bé Hỏng", null)]);
    render(<ChiTietLuotDisc luot={hong} coBaoCao={false} />);
    expect(document.querySelectorAll("[data-khong-doc-duoc]").length).toBe(1);
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: /Mở báo cáo/ })).toBeNull(); // coBaoCao=false ⇒ không nút
  });

  it("GhiChuXuHuong luôn có chữ 'không phải chẩn đoán'", () => {
    render(<GhiChuXuHuong />);
    expect(screen.getByText(/không phải chẩn đoán/)).toBeTruthy();
  });
});

describe("[DPU-D2] màu nhấn: mọi phần tử dùng accent phải nằm trong .portal-v2", () => {
  // Gốc lỗi (đo 01/11/2026 trên trình duyệt): trang DISC không bọc .portal-v2 nên --accent rơi về màu xám nhạt của shadcn
  // (oklch 0.97) ⇒ ngày trong bảng "Thay đổi theo thời gian" tương phản 1,09:1 (gần như vô hình), nút CTA xám.
  const phanTuAccent = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[class*='text-accent'], [class*='bg-accent']")];
  const khongNamNgoai = (container: HTMLElement) => phanTuAccent(container).filter((e) => !e.closest(".portal-v2"));
  it("trạng thái rỗng · tổng quan · lịch sử · danh sách · chi tiết", () => {
    const cac: [string, React.ReactElement][] = [
      ["rong", <TrangRongDisc key="a" huongDanHref="https://satarobo.vn/disc" />],
      ["tong-quan", <TongQuanGiaDinh key="b" lichSu={dungLichSu([L1, L2])} />],
      ["lich-su", <LichSuDisc key="c" lichSu={dungLichSu([L1, L2])} />],
      ["danh-sach", <DanhSachLuotDisc key="d" trang={trang()} />],
      ["chi-tiet", <ChiTietLuotDisc key="e" luot={L1} coBaoCao />],
    ];
    let tong = 0;
    for (const [ten, el] of cac) {
      const { container, unmount } = render(el);
      tong += phanTuAccent(container).length;
      expect(khongNamNgoai(container).map((e) => e.className), `${ten}: accent ngoài .portal-v2`).toEqual([]);
      unmount();
    }
    expect(tong, "đối chứng dương: bộ chọn có bắt được phần tử accent thật").toBeGreaterThan(3);
  });
});
