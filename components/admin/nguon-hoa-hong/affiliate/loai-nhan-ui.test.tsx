// @vitest-environment jsdom
/**
 * [ALU-*] — BẢNG LOẠI · BẢNG NHÃN · SHEET TẠO/SỬA · HỘP THOẠI NGỪNG/BẬT LẠI trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [ALU-01] bảng loại + nhãn: nút GHI chỉ khi `coTheGhi` (đối chứng dương); KHÔNG nút xoá; số đối tác / số quy tắc; trạng thái; nút Ngừng ↔ Bật lại theo trạng thái
 *   [ALU-02] Sheet LOẠI: mã chuẩn hoá + KHÔNG đổi sau khi tạo (sửa không có ô mã, không gửi `code`); lỗi cạnh ô; payload đúng; lỗi máy chủ map đúng ô; nguồn mặc định
 *   [ALU-03] Sheet NHÃN: như trên
 *   [ALU-04] Ngừng / bật lại: ngừng đòi lý do ≥ 10 ký tự, bật lại không; câu nói đúng «đối tác cũ giữ nguyên»; gọi đúng tham số; «vừa đổi» có Tải lại
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/affiliate/_actions", () => ({
  taoDoiTacAction: vi.fn(),
  suaDoiTacAction: vi.fn(),
  doiTrangThaiDoiTacAction: vi.fn(),
  timNhanVienAction: vi.fn(),
  taoLoaiAction: vi.fn(),
  suaLoaiAction: vi.fn(),
  batTatLoaiAction: vi.fn(),
  taoNhanAction: vi.fn(),
  suaNhanAction: vi.fn(),
  batTatNhanAction: vi.fn(),
}));

import type { DongLoai, DongNhan } from "@/lib/affiliate/doc-doi-tac";
import type { KetQuaBatTatDanhMuc, KetQuaSuaDanhMuc, KetQuaTaoDanhMuc } from "@/lib/affiliate/ghi-loai-nhan";
import { BangLoai } from "../../../../app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bang-loai";
import { BangNhan } from "../../../../app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bang-nhan";
import { NutBatTatDanhMuc } from "./bat-tat-danh-muc";
import { LoaiSheet, NhanSheet } from "./loai-nhan-sheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOC = "2026-10-13T03:00:00.000Z";
const NGUON = [
  { id: "ng-1", ten: "Phụ huynh giới thiệu" },
  { id: "ng-2", ten: "Quảng cáo Facebook" },
];

const loai = (p: Partial<DongLoai> = {}): DongLoai => ({
  id: "l-1",
  ma: "KOL",
  ten: "Người có ảnh hưởng",
  moTa: null,
  canDuyet: true,
  xemTien: null,
  dangDung: true,
  thuTu: 100,
  nguonMacDinh: { id: "ng-1", ten: "Phụ huynh giới thiệu" },
  soDoiTac: 4,
  soQuyTac: 2,
  capNhatLuc: MOC,
  ...p,
});
const nhan = (p: Partial<DongNhan> = {}): DongNhan => ({ id: "n-1", ma: "GV", ten: "Giáo viên", moTa: null, dangDung: true, soDoiTac: 3, soQuyTac: 1, capNhatLuc: MOC, ...p });

const BANG_LOAI = (p: Partial<React.ComponentProps<typeof BangLoai>> = {}) => (
  <BangLoai dong={[loai()]} tong={1} trang={1} kichThuoc={25} hrefTrang={(t) => `/x?trang=${t}`} coTheGhi nguon={NGUON} {...p} />
);
const BANG_NHAN = (p: Partial<React.ComponentProps<typeof BangNhan>> = {}) => (
  <BangNhan dong={[nhan()]} tong={1} trang={1} kichThuoc={25} hrefTrang={(t) => `/x?trang=${t}`} coTheGhi {...p} />
);

// ═══ [ALU-01] bảng ═══════════════════════════════════════════════════════════════════════════════════
describe("[ALU-01] bảng Loại + Nhãn", () => {
  it("LOẠI: coTheGhi=false ⇒ KHÔNG Sửa / Ngừng / cột Thao tác; true ⇒ THẤY (đối chứng dương)", () => {
    render(BANG_LOAI({ coTheGhi: false, nguon: [] }));
    expect(screen.queryByRole("button", { name: /Sửa loại/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ngừng loại|Bật lại loại/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    cleanup();
    render(BANG_LOAI());
    expect(screen.getByRole("button", { name: "Sửa loại Người có ảnh hưởng" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ngừng loại Người có ảnh hưởng" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
  });

  it("NHÃN: coTheGhi=false ⇒ KHÔNG nút ghi; true ⇒ THẤY; cả hai bảng KHÔNG BAO GIỜ có nút xoá", () => {
    render(BANG_NHAN({ coTheGhi: false }));
    expect(screen.queryByRole("button", { name: /Sửa nhãn|Ngừng nhãn|Bật lại nhãn/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    cleanup();
    render(BANG_NHAN());
    expect(screen.getByRole("button", { name: "Sửa nhãn Giáo viên" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ngừng nhãn Giáo viên" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Xoá|Xóa/ })).toBeNull();
    cleanup();
    render(BANG_LOAI());
    expect(screen.queryByRole("button", { name: /Xoá|Xóa/ })).toBeNull();
  });

  it("loại đã ngừng ⇒ nút «Bật lại», nhãn «Đã ngừng»; đang dùng ⇒ «Ngừng», «Đang dùng» (nút nói đúng chiều)", () => {
    render(BANG_LOAI({ dong: [loai({ id: "a", ten: "Đang dùng X" }), loai({ id: "b", ten: "Ngừng Y", dangDung: false })], tong: 2 }));
    expect(screen.getByRole("button", { name: "Ngừng loại Đang dùng X" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bật lại loại Ngừng Y" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bật lại loại Đang dùng X" })).toBeNull();
    expect(screen.getByText("Đang dùng")).toBeTruthy();
    expect(screen.getByText("Đã ngừng")).toBeTruthy();
  });

  it("cột số thật: số đối tác + số quy tắc; nguồn mặc định hoặc «Không có — xem tay»; duyệt đối tác mới", () => {
    render(BANG_LOAI({ dong: [loai({ id: "a", soDoiTac: 4, soQuyTac: 2 }), loai({ id: "b", ten: "Không nguồn", nguonMacDinh: null, canDuyet: false, soDoiTac: 0, soQuyTac: 0 })], tong: 2 }));
    expect(screen.getByText("Phụ huynh giới thiệu")).toBeTruthy();
    expect(screen.getByText("Không có — xem tay")).toBeTruthy();
    expect(screen.getByText("Cần duyệt")).toBeTruthy();
    expect(screen.getByText("Hoạt động ngay")).toBeTruthy();
    const ten = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(ten).toEqual(expect.arrayContaining(["Loại", "Nguồn mặc định", "Đối tác mới", "Đối tác", "Quy tắc", "Trạng thái"]));
  });

  it("thanh trang chỉ khi > 1 trang (cả hai bảng)", () => {
    render(BANG_LOAI({ tong: 26 }));
    expect(screen.getByRole("navigation", { name: "Điều hướng trang" })).toBeTruthy();
    cleanup();
    render(BANG_NHAN({ tong: 26 }));
    expect(screen.getByRole("navigation", { name: "Điều hướng trang" })).toBeTruthy();
    cleanup();
    render(BANG_NHAN({ tong: 1 }));
    expect(screen.queryByRole("navigation", { name: "Điều hướng trang" })).toBeNull();
  });
});

// ═══ [ALU-02] Sheet LOẠI ═════════════════════════════════════════════════════════════════════════════
const OK_TAO: KetQuaTaoDanhMuc = { ok: true, id: "moi", ma: "KOL", capNhatLuc: MOC };
const OK_SUA: KetQuaSuaDanhMuc = { ok: true, doi: true, truongDoi: ["name"], capNhatLuc: MOC };

const mo = (ten: string) => fireEvent.click(screen.getByRole("button", { name: ten }));
const go = (nhanO: RegExp | string, v: string) => fireEvent.change(screen.getByLabelText(nhanO), { target: { value: v } });
const luu = (ten: string) => fireEvent.click(screen.getAllByRole("button", { name: ten }).at(-1)!);

describe("[ALU-02] LoaiSheet", () => {
  function dungTao(tao = vi.fn(async (_i: { vao: Record<string, unknown> }) => OK_TAO)) {
    render(
      <LoaiSheet nguon={NGUON} tao={tao} triggerAriaLabel="Tạo loại">
        Tạo loại
      </LoaiSheet>,
    );
    return tao;
  }

  it("TẠO: gõ mã ⇒ cho thấy mã SẼ LƯU và nói «không đổi được sau khi tạo»; mặc định CẦN DUYỆT và nói hệ quả", () => {
    dungTao();
    mo("Tạo loại");
    go(/^Mã/, "phụ huynh");
    expect(screen.getByText("PHU_HUYNH")).toBeTruthy();
    expect(screen.getAllByText(/không đổi được sau khi tạo/).length).toBeGreaterThanOrEqual(1);
    expect((screen.getByLabelText(/Cần duyệt/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/ở «Chờ duyệt» cho tới khi được duyệt/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Cần duyệt/));
    expect(screen.getByText(/Đối tác mới của loại này hoạt động ngay/)).toBeTruthy();
  });

  it("mã sai ⇒ câu lỗi sống ngay dưới ô", () => {
    dungTao();
    mo("Tạo loại");
    go(/^Mã/, "ab");
    expect(screen.getByText(/Mã cần 3–40 ký tự/)).toBeTruthy();
  });

  it("bấm Tạo khi trống ⇒ lỗi CẠNH ô (aria-invalid), `tao` KHÔNG gọi", async () => {
    const tao = dungTao();
    mo("Tạo loại");
    luu("Tạo loại");
    expect(await screen.findByText("Tên tối thiểu 2 ký tự.")).toBeTruthy();
    expect(screen.getByLabelText(/^Mã/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Tên loại/).getAttribute("aria-invalid")).toBe("true");
    expect(tao).not.toHaveBeenCalled();
  });

  it("lưu hợp lệ ⇒ `tao` ĐÚNG một lần với payload chuẩn (mã đã chuẩn hoá, null cho ô trống, requiresApproval/sortOrder khai tường minh); toast + refresh", async () => {
    // Cấy: gửi `sortOrder` dạng chuỗi · quên `requiresApproval` · gửi `defaultSourceGroupId: ""` ⇒ đỏ.
    const tao = dungTao();
    mo("Tạo loại");
    go(/^Mã/, "kol");
    go(/Tên loại/, "Người có ảnh hưởng");
    go(/Nguồn mặc định/, "ng-2");
    fireEvent.click(screen.getByLabelText(/Cần duyệt/)); // bỏ tick ⇒ không cần duyệt
    go(/Thứ tự hiển thị/, "20");
    luu("Tạo loại");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(tao).toHaveBeenCalledWith({ vao: { code: "KOL", name: "Người có ảnh hưởng", description: "", defaultSourceGroupId: "ng-2", requiresApproval: false, partnerCanViewAmount: null, sortOrder: 20 } });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining("Người có ảnh hưởng"));
  });

  it("để trống nguồn mặc định ⇒ gửi null (không gửi chuỗi rỗng)", async () => {
    const tao = dungTao();
    mo("Tạo loại");
    go(/^Mã/, "kol");
    go(/Tên loại/, "KOL");
    luu("Tạo loại");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(tao.mock.calls[0]![0].vao).toMatchObject({ defaultSourceGroupId: null });
  });

  it("máy chủ báo «mã đã có» ⇒ nằm CẠNH ô mã; Sheet vẫn mở; không refresh", async () => {
    const tao = dungTao(vi.fn(async () => ({ ok: false as const, loi: "Mã «KOL» đã có.", truong: "code" })));
    mo("Tạo loại");
    go(/^Mã/, "kol");
    go(/Tên loại/, "KOL");
    luu("Tạo loại");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    const loi = await screen.findByText("Mã «KOL» đã có.");
    expect(loi.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText(/^Mã/).getAttribute("aria-invalid")).toBe("true");
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("form", { name: "Tạo loại đối tác" })).toBeTruthy();
  });

  it("nguồn mặc định bị máy chủ từ chối ⇒ nằm cạnh ô nguồn", async () => {
    const tao = dungTao(vi.fn(async () => ({ ok: false as const, loi: "Nguồn «X» không dùng được làm nguồn mặc định (chỉ nguồn đang hoạt động và chọn được).", truong: "defaultSourceGroupId" })));
    mo("Tạo loại");
    go(/^Mã/, "kol");
    go(/Tên loại/, "KOL");
    go(/Nguồn mặc định/, "ng-1");
    luu("Tạo loại");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect((await screen.findByText(/không dùng được làm nguồn mặc định/)).id).toMatch(/defaultSourceGroupId-loi$/);
    expect(screen.getByLabelText(/Nguồn mặc định/).getAttribute("aria-invalid")).toBe("true");
  });

  function dungSua(d: DongLoai, nguon = NGUON, sua = vi.fn(async (_i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown> }) => OK_SUA)) {
    render(
      <LoaiSheet dong={d} nguon={nguon} sua={sua} triggerAriaLabel={`Sửa loại ${d.ten}`}>
        Sửa
      </LoaiSheet>,
    );
    return sua;
  }

  it("[ALU-XT] ô «Số tiền hoa hồng ở cổng đối tác»: ba lựa chọn, mặc định ẨN; chọn «Hiện» ⇒ payload `partnerCanViewAmount: true`; loại đang HIỆN ⇒ mở sửa đã chọn sẵn «Hiện» và gửi lại đúng giá trị", async () => {
    const tao = dungTao();
    mo("Tạo loại");
    const o = screen.getByLabelText(/Số tiền hoa hồng ở cổng đối tác/) as HTMLSelectElement;
    expect(o.value).toBe("THEO_CAP_TREN");
    expect([...o.options].map((x) => x.text)).toEqual(["Mặc định (ẩn)", "Hiện số tiền", "Ẩn số tiền"]);
    go(/^Mã/, "kol");
    go(/Tên loại/, "Người có ảnh hưởng");
    go(/Số tiền hoa hồng ở cổng đối tác/, "HIEN");
    luu("Tạo loại");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(tao.mock.calls[0]![0].vao).toMatchObject({ partnerCanViewAmount: true });
    cleanup();

    const sua = dungSua(loai({ xemTien: true }));
    mo("Sửa loại Người có ảnh hưởng");
    expect((screen.getByLabelText(/Số tiền hoa hồng ở cổng đối tác/) as HTMLSelectElement).value).toBe("HIEN");
    luu("Lưu thay đổi");
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    expect(sua.mock.calls[0]![0].vao).toMatchObject({ partnerCanViewAmount: true });
  });

  it("SỬA: mã chỉ ĐỌC (không có ô nhập mã), nói «không đổi sau khi tạo»; payload KHÔNG có `code`; gửi đúng id + mốc khoá lạc quan", async () => {
    const sua = dungSua(loai({ moTa: "mô tả cũ" }));
    mo("Sửa loại Người có ảnh hưởng");
    const ma = screen.getByLabelText(/^Mã/) as HTMLInputElement;
    expect(ma.readOnly).toBe(true);
    expect(ma.value).toBe("KOL");
    expect(screen.getByText("Mã không đổi sau khi tạo.")).toBeTruthy();
    go(/Tên loại/, "Tên mới");
    luu("Lưu thay đổi");
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    const goi = sua.mock.calls[0]![0];
    expect(goi).toMatchObject({ id: "l-1", updatedAtDaThay: MOC });
    expect(goi.vao).toEqual({ name: "Tên mới", description: "mô tả cũ", defaultSourceGroupId: "ng-1", requiresApproval: true, partnerCanViewAmount: null, sortOrder: 100 });
    expect("code" in goi.vao).toBe(false);
  });

  it("SỬA: nguồn mặc định hiện tại đã ngừng (không còn trong danh sách chọn) vẫn hiện kèm «đã ngừng» để lưu không lặng lẽ bỏ nó", () => {
    dungSua(loai({ nguonMacDinh: { id: "ng-cu", ten: "Nguồn cũ" } }), NGUON);
    mo("Sửa loại Người có ảnh hưởng");
    const chon = screen.getByLabelText(/Nguồn mặc định/) as HTMLSelectElement;
    expect(chon.value).toBe("ng-cu");
    expect([...chon.options].map((o) => o.textContent)).toContain("Nguồn cũ (đã ngừng)");
  });

  it("SỬA: «vừa đổi» ⇒ banner CÓ «Tải lại»; lỗi khác ⇒ banner KHÔNG nút", async () => {
    const s1 = dungSua(loai(), NGUON, vi.fn(async () => ({ ok: false as const, loi: "Loại đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" })));
    mo("Sửa loại Người có ảnh hưởng");
    luu("Lưu thay đổi");
    await waitFor(() => expect(s1).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Tải lại" })).toBeTruthy();
    cleanup();
    const s2 = dungSua(loai(), NGUON, vi.fn(async () => ({ ok: false as const, loi: "Không có quyền quản lý đối tác Affiliate (affiliates:manage).", truong: "quyen" })));
    mo("Sửa loại Người có ảnh hưởng");
    luu("Lưu thay đổi");
    await waitFor(() => expect(s2).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("alert")).textContent).toContain("affiliates:manage");
    expect(screen.queryByRole("button", { name: "Tải lại" })).toBeNull();
  });
});

// ═══ [ALU-03] Sheet NHÃN ═════════════════════════════════════════════════════════════════════════════
describe("[ALU-03] NhanSheet", () => {
  it("TẠO: payload chuẩn; thiếu tên ⇒ lỗi cạnh ô, không gọi", async () => {
    const tao = vi.fn(async (_i: { vao: Record<string, unknown> }) => OK_TAO);
    render(
      <NhanSheet tao={tao} triggerAriaLabel="Tạo nhãn">
        Tạo nhãn
      </NhanSheet>,
    );
    mo("Tạo nhãn");
    luu("Tạo nhãn");
    expect(await screen.findByText("Tên tối thiểu 2 ký tự.")).toBeTruthy();
    expect(screen.getByLabelText(/Tên nhãn/).getAttribute("aria-invalid")).toBe("true");
    expect(tao).not.toHaveBeenCalled();
    go(/^Mã/, "giáo viên");
    expect(screen.getByText("GIAO_VIEN")).toBeTruthy();
    go(/Tên nhãn/, "Giáo viên");
    luu("Tạo nhãn");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(tao).toHaveBeenCalledWith({ vao: { code: "GIÁO VIÊN", name: "Giáo viên", description: "" } });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
  });

  it("SỬA: mã chỉ đọc, payload KHÔNG có `code`, đúng id + mốc", async () => {
    const sua = vi.fn(async (_i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown> }) => OK_SUA);
    render(
      <NhanSheet dong={nhan()} sua={sua} triggerAriaLabel="Sửa nhãn Giáo viên">
        Sửa
      </NhanSheet>,
    );
    mo("Sửa nhãn Giáo viên");
    expect((screen.getByLabelText(/^Mã/) as HTMLInputElement).readOnly).toBe(true);
    go(/Tên nhãn/, "Giáo viên (mới)");
    luu("Lưu thay đổi");
    await waitFor(() => expect(sua).toHaveBeenCalledTimes(1));
    expect(sua.mock.calls[0]![0]).toEqual({ id: "n-1", updatedAtDaThay: MOC, vao: { name: "Giáo viên (mới)", description: "" } });
  });

  it("máy chủ báo «mã đã có» ⇒ cạnh ô mã", async () => {
    const tao = vi.fn(async () => ({ ok: false as const, loi: "Mã «GV» đã có.", truong: "code" }));
    render(
      <NhanSheet tao={tao} triggerAriaLabel="Tạo nhãn">
        Tạo nhãn
      </NhanSheet>,
    );
    mo("Tạo nhãn");
    go(/^Mã/, "gv1");
    go(/Tên nhãn/, "Giáo viên");
    luu("Tạo nhãn");
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect((await screen.findByText("Mã «GV» đã có.")).id).toMatch(/code-loi$/);
  });
});

// ═══ [ALU-04] ngừng / bật lại ═══════════════════════════════════════════════════════════════════════
const OK_BT = (dangDung: boolean): KetQuaBatTatDanhMuc => ({ ok: true, dangDung, capNhatLuc: MOC });
const muc = (p: Partial<{ dangDung: boolean }> = {}) => ({ id: "l-1", ten: "Người có ảnh hưởng", dangDung: true, capNhatLuc: MOC, ...p });

describe("[ALU-04] NutBatTatDanhMuc", () => {
  it("NGỪNG: nói «đối tác đang có giữ nguyên»; đòi lý do ≥ 10 ký tự — thiếu ⇒ lỗi cạnh ô, `ghi` KHÔNG gọi; đủ ⇒ gọi đúng tham số", async () => {
    const ghi = vi.fn(async (_i: { id: string; updatedAtDaThay: string; batLai: boolean; lyDo: string | null }) => OK_BT(false));
    render(<NutBatTatDanhMuc loai="loai" muc={muc()} ghi={ghi} />);
    fireEvent.click(screen.getByRole("button", { name: "Ngừng loại Người có ảnh hưởng" }));
    expect(screen.getByText(/Đối tác đang có giữ nguyên, không bị đổi hay xoá/)).toBeTruthy();
    const ly = screen.getByLabelText(/Lý do/);
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    expect(await screen.findByText(/Nhập lý do từ 10 ký tự/)).toBeTruthy();
    expect(ly.getAttribute("aria-invalid")).toBe("true");
    expect(ghi).not.toHaveBeenCalled();
    fireEvent.change(ly, { target: { value: "  Không còn dùng nữa nhé  " } });
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    await waitFor(() => expect(ghi).toHaveBeenCalledTimes(1));
    expect(ghi).toHaveBeenCalledWith({ id: "l-1", updatedAtDaThay: MOC, batLai: false, lyDo: "Không còn dùng nữa nhé" });
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalledTimes(1));
    expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining("Đã ngừng"));
  });

  it("BẬT LẠI: KHÔNG có ô lý do và không đòi; gọi `ghi` với batLai=true, lyDo null (đối chứng với ca ngừng)", async () => {
    const ghi = vi.fn(async (_i: { id: string; updatedAtDaThay: string; batLai: boolean; lyDo: string | null }) => OK_BT(true));
    render(<NutBatTatDanhMuc loai="nhan" muc={muc({ dangDung: false })} ghi={ghi} />);
    fireEvent.click(screen.getByRole("button", { name: "Bật lại nhãn Người có ảnh hưởng" }));
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bật lại" }));
    await waitFor(() => expect(ghi).toHaveBeenCalledTimes(1));
    expect(ghi).toHaveBeenCalledWith({ id: "l-1", updatedAtDaThay: MOC, batLai: true, lyDo: null });
  });

  it("«vừa đổi» ⇒ banner CÓ «Tải lại», không refresh; lỗi khác ⇒ banner KHÔNG nút; lỗi `lyDo` nằm cạnh ô lý do", async () => {
    const g1 = vi.fn(async (): Promise<KetQuaBatTatDanhMuc> => ({ ok: false, loi: "Loại đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    render(<NutBatTatDanhMuc loai="loai" muc={muc({ dangDung: false })} ghi={g1} />);
    fireEvent.click(screen.getByRole("button", { name: /Bật lại loại/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bật lại" }));
    expect(await screen.findByRole("button", { name: "Tải lại" })).toBeTruthy();
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    cleanup();

    const g2 = vi.fn(async (): Promise<KetQuaBatTatDanhMuc> => ({ ok: false, loi: "Không có quyền quản lý đối tác Affiliate (affiliates:manage).", truong: "quyen" }));
    render(<NutBatTatDanhMuc loai="loai" muc={muc({ dangDung: false })} ghi={g2} />);
    fireEvent.click(screen.getByRole("button", { name: /Bật lại loại/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bật lại" }));
    expect((await screen.findByRole("alert")).textContent).toContain("affiliates:manage");
    expect(screen.queryByRole("button", { name: "Tải lại" })).toBeNull();
    cleanup();

    const g3 = vi.fn(async (): Promise<KetQuaBatTatDanhMuc> => ({ ok: false, loi: "Nhập lý do từ 10 ký tự.", truong: "lyDo" }));
    render(<NutBatTatDanhMuc loai="loai" muc={muc()} ghi={g3} />);
    fireEvent.click(screen.getByRole("button", { name: /Ngừng loại/ }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "đủ mười ký tự nhé" } });
    fireEvent.click(screen.getByRole("button", { name: "Ngừng" }));
    expect((await screen.findByText("Nhập lý do từ 10 ký tự.")).id).toMatch(/loi-ly-do$/);
  });

  it("mạng hỏng ⇒ banner «Không lưu được lúc này», nút không treo", async () => {
    const ghi = vi.fn(async () => {
      throw new Error("mạng");
    });
    render(<NutBatTatDanhMuc loai="loai" muc={muc({ dangDung: false })} ghi={ghi} />);
    fireEvent.click(screen.getByRole("button", { name: /Bật lại loại/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bật lại" }));
    expect(await screen.findByText(/Không lưu được lúc này/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Bật lại" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
