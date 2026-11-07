// @vitest-environment jsdom
// [TQTL-UI-*] «Tổng quan thiết lập» đầu trang Cấu hình — dựng THẬT (server component gọi như hàm async rồi render), đọc bằng dữ liệu giả của ba nguồn.
// Thứ cần canh: tiêu đề nói đúng việc còn lại · mỗi bước có nút «?» + lối nhảy tới đúng khu · người không có quyền thấy «không xem được» (không đoán) · cờ Hub tắt ⇒ không dòng bước 4.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  hoiSo: true,
  pham: "ALL" as "ALL" | string[],
  giai: vi.fn(),
  chinhSachKy: vi.fn(),
  dsChinhSach: vi.fn(),
}));

vi.mock("@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan", () => ({ giaiKetNoiChoPhapNhan: (...a: unknown[]) => h.giai(...a) }));
vi.mock("@/lib/finance/hoa-don/ket-noi/ket-noi-db", () => ({ docNhaCungCapDaChon: async () => "VIN_HOADON", laKeToanHoiSo: () => h.hoiSo }));
vi.mock("@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db", () => ({ docCacChinhSachKy: (...a: unknown[]) => h.chinhSachKy(...a) }));
vi.mock("@/lib/finance/hoa-don/chinh-sach-db", () => ({ docDanhSachChinhSach: (...a: unknown[]) => h.dsChinhSach(...a) }));
vi.mock("@/lib/finance/hoa-don/quyen", () => ({ phamViKeToan: () => h.pham }));

import { TongQuanThietLap } from "./tong-quan-thiet-lap";

const ACTOR = { userId: "u1" } as unknown as Actor;
const STEM = { ma: "STEM_ROBOTICS_AI", ten: "STEM Robotics & AI", phanMem: "VIN HOADON" } as const;
type Props = Parameters<typeof TongQuanThietLap>[0];
const BASE: Props = { actor: ACTOR, tenCoSo: "CS1 · Cơ sở 1", coSoId: "cs1", phapNhan: STEM, loiPhapNhan: null, kyHieu: "1C26SVS", canhBaoLech: null, hubBat: true };

async function ve(o: Partial<Props> = {}) {
  render(await TongQuanThietLap({ ...BASE, ...o }));
}

beforeEach(() => {
  h.hoiSo = true;
  h.pham = "ALL";
  h.giai.mockReset().mockResolvedValue({ nguon: "KHONG", lyDo: "Chưa cấu hình kết nối." });
  h.chinhSachKy.mockReset().mockResolvedValue([{ phapNhanMa: STEM.ma, tamDung: false, tamDungSuCo: false, hanMucMoiHoaDon: null, hanMucMoiNgay: null, soToiDa: null, cuaSoPhut: null, nguongTanSuat: null }]);
  h.dsChinhSach.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe("[TQTL-UI] tổng quan thiết lập", () => {
  it("[TQTL-UI-01] kết nối chưa dùng được ⇒ tiêu đề «Còn 1 việc…», 4 dòng theo thứ tự, mỗi dòng có «?» đúng bước và lối nhảy tới đúng khu", async () => {
    await ve();
    expect(screen.getByRole("heading", { name: /Còn 1 việc cần làm trước khi phát hành/ })).toBeTruthy();
    const dong = screen.getAllByRole("listitem");
    expect(dong).toHaveLength(4);
    expect(dong.map((d) => /Bước (\d)/.exec(d.textContent ?? "")?.[1])).toEqual(["1", "2", "3", "4"]);
    for (let b = 1; b <= 4; b++) expect(screen.getByRole("button", { name: `Xem hướng dẫn: Bước ${b}` })).toBeTruthy();
    // bước 2 cần làm: nút nói đúng việc và nhảy tới khu «Kết nối»
    const buoc2 = within(dong[1]!);
    expect(buoc2.getByText(/Cần làm/)).toBeTruthy();
    expect(buoc2.getByRole("link", { name: "Làm bước này" }).getAttribute("href")).toBe("#ket-noi-ky");
    expect(buoc2.getByText(/VIN-HOADON · Chưa cấu hình kết nối\./)).toBeTruthy();
    expect(within(dong[0]!).getByRole("link", { name: "Xem" }).getAttribute("href")).toBe("#phap-nhan-ky-hieu");
    expect(within(dong[2]!).getByRole("link").getAttribute("href")).toBe("#chinh-sach-ky");
    expect(within(dong[3]!).getByRole("link").getAttribute("href")).toBe("#cs-tieu-de");
  });

  it("[TQTL-UI-02] mọi thứ ổn ⇒ «Sẵn sàng phát hành» (ĐỐI CHỨNG của ca trên: cùng dữ liệu, chỉ đổi kết nối sang dùng được)", async () => {
    h.giai.mockResolvedValue({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "HSM", cheDoKy: "LO" });
    await ve();
    expect(screen.getByRole("heading", { name: "Sẵn sàng phát hành" })).toBeTruthy();
    expect(screen.queryByText(/Cần làm/)).toBeNull();
  });

  it("[TQTL-UI-03] người KHÔNG phải kế toán Hội sở ⇒ bước kết nối ghi «không xem được», KHÔNG gọi hàm đọc kết nối, KHÔNG đoán thiếu/ổn", async () => {
    h.hoiSo = false;
    h.pham = ["cs1"];
    await ve();
    expect(h.giai).not.toHaveBeenCalled();
    const buoc2 = within(screen.getAllByRole("listitem")[1]!);
    expect(buoc2.getByText("Chỉ kế toán Hội sở xem được phần này.")).toBeTruthy();
    expect(buoc2.getByText(/Không xem được/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Còn \d+ việc/ })).toBeNull();
  });

  it("[TQTL-UI-04] cờ Hub tắt ⇒ chỉ 3 dòng, và KHÔNG nạp danh sách chính sách", async () => {
    await ve({ hubBat: false });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(h.dsChinhSach).not.toHaveBeenCalled();
  });

  it("[TQTL-UI-05] chưa có pháp nhân phát hành ⇒ bước 1 «Chưa khai» mang câu lỗi thật; không đọc kết nối / chính sách của một pháp nhân không tồn tại", async () => {
    await ve({ phapNhan: null, loiPhapNhan: "Chưa xác định được ký hiệu hoá đơn của cơ sở." });
    expect(within(screen.getAllByRole("listitem")[0]!).getByText(/Chưa khai\. Chưa xác định được ký hiệu/)).toBeTruthy();
    expect(h.giai).not.toHaveBeenCalled();
    expect(h.chinhSachKy).not.toHaveBeenCalled();
  });

  it("[TQTL-UI-06] đang tạm dừng ký ⇒ tiêu đề nói thẳng «Đang tạm dừng ký — chưa phát hành được»", async () => {
    h.chinhSachKy.mockResolvedValue([{ phapNhanMa: STEM.ma, tamDung: true, tamDungSuCo: false, hanMucMoiHoaDon: null, hanMucMoiNgay: null, soToiDa: null, cuaSoPhut: null, nguongTanSuat: null }]);
    h.giai.mockResolvedValue({ nguon: "BANG", nhaCungCap: "VIN_HOADON", phuongThucKy: "HSM", cheDoKy: "LO" });
    await ve();
    expect(screen.getByRole("heading", { name: /Đang tạm dừng ký — chưa phát hành được/ })).toBeTruthy();
  });

  it("[TQTL-UI-07] Cây tổ chức lệch cấu hình cơ sở ⇒ bước 1 mang câu cảnh báo (không im lặng)", async () => {
    await ve({ canhBaoLech: "Cây tổ chức đang ghi Sata Robo, khác pháp nhân cơ sở đang phát hành — nhờ quản trị kiểm lại Cây tổ chức." });
    expect(within(screen.getAllByRole("listitem")[0]!).getByText(/Cây tổ chức đang ghi Sata Robo/)).toBeTruthy();
    expect(within(screen.getAllByRole("listitem")[0]!).getByText(/Cần lưu ý/)).toBeTruthy();
  });
});
