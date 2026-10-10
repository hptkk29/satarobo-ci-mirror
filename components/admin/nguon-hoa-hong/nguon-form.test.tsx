// @vitest-environment jsdom
/**
 * [NGF-*] NguonForm (Tạo / Sửa nguồn) — trên PHẦN TỬ THẬT (jsdom), hàm lưu / tìm được TIÊM. Luật ĐƯỢC / KHÔNG ĐƯỢC đã có ca thuần ([FRN-*]) và ca Postgres ([FUI-DB-04]);
 * ở đây khoá thứ chỉ DOM mới nói được: lỗi hiện CẠNH ô, ô khoá `disabled` kèm lý do, nút Lưu nói thật, payload gửi đi.
 *
 *   [NGF-01] tạo: bấm Tạo khi trống ⇒ lỗi cạnh ba ô bắt buộc, KHÔNG gọi máy chủ
 *   [NGF-02] tạo thành công: payload ĐÚNG (mã HOA, số, null, nháp mặc định), toast, quay về danh sách
 *   [NGF-03] lỗi máy chủ đặt cạnh ĐÚNG ô; sửa ô ⇒ lỗi cũ biến mất (không đứng đó nói dối)
 *   [NGF-04] nhóm nguồn lấy từ schema (không SYSTEM); mặc định cửa sổ được NÓI; giải thích «tham gia hoa hồng»
 *   [NGF-05] sửa: ô khoá `disabled` KÈM lý do (nguồn hệ thống / đã dùng); ĐỐI CHỨNG nguồn sạch sửa được
 *   [NGF-06] sửa: Lưu khoá khi chưa đổi gì; đổi tên ⇒ gửi ĐÚNG {name}, mốc khoá lạc quan, không lý do
 *   [NGF-07] sửa: đổi nhạy cảm ⇒ hiện ô lý do ≥ 10 ký tự; thiếu ⇒ lỗi cạnh ô, không gọi
 *   [NGF-08] sửa: đổi ai-nhận-tiền thiếu quyền kích hoạt ⇒ Lưu khoá + câu nêu TÊN khoá; ĐỐI CHỨNG có quyền ⇒ Lưu được + cảnh báo
 *   [NGF-09] sửa: «vừa được người khác đổi» ⇒ banner + Tải lại
 *   [NGF-10] người phụ trách: chọn / bỏ / gửi id; nhãn «Người phụ trách», không pill vai
 *   [NGF-09b] tạo: «Kích hoạt ngay» nói thật (chặn cạnh ô + chân; khoá nút khi thiếu quyền kích hoạt)
 *   [NGF-11] sửa: tắt «tham gia hoa hồng» khi chính sách riêng có dòng thu hút bị chặn cạnh ô
 *   [NGF-12] 375px: nhãn công tắc là label của chính công tắc, nút nhỏ ≥44px, ô khoá không còn gợi ý, «Theo sự kiện» nói thật
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions", () => ({ taoNguonAction: vi.fn(), suaNguonAction: vi.fn(), doiTrangThaiNguonAction: vi.fn(), luuPageMappingAction: vi.fn() }));
vi.mock("@/app/(admin)/admin/leads/nguon-actions", () => ({ moGanNguonAction: vi.fn(), doiNguonLeadAction: vi.fn(), timNguoiGioiThieuAction: vi.fn() }));

import { LOAI_NGUON_CHON, truongBiKhoa } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import type { DonViChon } from "@/lib/nguon/doc-form-nguon";
import type { BoiCanhSua, NguonFormView } from "@/lib/nguon/form-nguon";
import type { KetQuaSuaNguonAction, KetQuaTaoNguonAction } from "@/lib/nguon/ket-qua-action";
import { NguonForm } from "./nguon-form";
import type { HamTim } from "./referrer-picker";

// Công tắc (Radix Switch) đo kích thước bằng ResizeObserver mà jsdom không có.
class ResizeObserverGia {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverGia;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DON_VI: DonViChon[] = [
  { id: "ou-ho", ma: "HO", ten: "Hội sở", loai: "HO", doSau: 0 },
  { id: "ou-cs1", ma: "CS1", ten: "Cơ sở 1", loai: "CENTER", doSau: 1 },
];
const LY_DO = "Chủ dự án chốt ngày 09/10";
const MOC = "2026-10-09T02:00:00.123Z";

const nguonMau = (p: Partial<NguonFormView> = {}): NguonFormView => ({
  id: "g1",
  code: "TIKTOK_ADS",
  name: "TikTok Ads",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  status: "ACTIVE",
  isSystem: false,
  sortOrder: 120,
  attributionWindowDays: null,
  commissionEnabled: false,
  ownerOrgUnitId: null,
  ownerEmployee: null,
  effectiveFrom: null,
  effectiveTo: null,
  capNhatLuc: MOC,
  daDung: { attribution: false, touchpoint: false, phienBanChinhSach: false, so: false, page: false, nhomNhanSuMacDinh: false, daDung: false },
  ...p,
});
const boiCanhMau = (p: Partial<BoiCanhSua> = {}): BoiCanhSua => ({
  laDichMacDinh: false,
  nowIso: "2026-10-09T03:00:00.000Z",
  coQuyenKichHoat: true,
  dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false },
  ...p,
});

const taoOk: KetQuaTaoNguonAction = { ok: true, id: "g9", code: "TIKTOK_ADS", updatedAt: MOC, canhBao: [] };
const suaOk: KetQuaSuaNguonAction = { ok: true, doi: true, updatedAt: MOC, canhBao: [] };

type LuuTaoGia = (vao: unknown) => Promise<KetQuaTaoNguonAction>;
type LuuSuaGia = (i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaSuaNguonAction>;
const formTao = (luuTao: LuuTaoGia = vi.fn(async () => taoOk), tim?: HamTim, boiCanhTao = { ruleChuChay: false, coQuyenKichHoat: true }) =>
  render(<NguonForm cheDo="tao" donVi={DON_VI} thuTuGoiY={140} cuaSoMacDinhNgay={90} boiCanhTao={boiCanhTao} luuTao={luuTao} tim={tim} />);
const formSua = (nguon: NguonFormView, boiCanh = boiCanhMau(), luuSua: LuuSuaGia = vi.fn(async () => suaOk), tim?: HamTim) =>
  render(<NguonForm cheDo="sua" nguon={nguon} donVi={DON_VI} thuTuGoiY={140} cuaSoMacDinhNgay={90} boiCanh={boiCanh} luuSua={luuSua} tim={tim} />);

const ten = () => screen.getByLabelText("Tên nguồn") as HTMLInputElement;
const ma = () => screen.getByLabelText("Mã nguồn") as HTMLInputElement;
const nhom = () => screen.getByLabelText("Nhóm nguồn") as HTMLSelectElement;
const nhapChu = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });
const bamTao = () => fireEvent.click(screen.getByRole("button", { name: "Tạo nguồn" }));
const bamLuu = () => fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

describe("[NGF-01] tạo — bắt buộc", () => {
  it("bấm Tạo khi trống ⇒ lỗi CẠNH tên · mã · nhóm; KHÔNG gọi máy chủ; ô lỗi đầu tiên mang aria-invalid", async () => {
    const luu = vi.fn(async () => taoOk);
    formTao(luu);
    bamTao();
    await waitFor(() => expect(ten().getAttribute("aria-invalid")).toBe("true"));
    expect(ma().getAttribute("aria-invalid")).toBe("true");
    expect(nhom().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Chọn nhóm nguồn.")).toBeTruthy();
    expect(screen.getByText(/Tên nguồn tối thiểu/)).toBeTruthy();
    expect(luu).not.toHaveBeenCalled();
    // ô đúng thì KHÔNG bị tô lỗi (đối chứng): thứ tự hiển thị mặc định 140 hợp lệ
    expect((screen.getByLabelText("Thứ tự hiển thị") as HTMLInputElement).getAttribute("aria-invalid")).toBeNull();
  });
});

describe("[NGF-02] tạo thành công", () => {
  it("payload: mã HOA không khoảng trắng, số là số, rỗng là null, mặc định NHÁP; toast + quay về danh sách", async () => {
    const luu = vi.fn(async () => taoOk);
    formTao(luu);
    nhapChu(ten(), "  TikTok Ads ");
    nhapChu(ma(), "tiktok_ads");
    nhapChu(nhom(), "MARKETING");
    nhapChu(screen.getByLabelText(/Cửa sổ ghi công/), "60");
    bamTao();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect((luu.mock.calls[0] as unknown[])[0]).toMatchObject({
      code: "TIKTOK_ADS",
      name: "TikTok Ads",
      sourceType: "MARKETING",
      referrerRequirement: "NONE",
      requiresNote: false,
      selectable: true,
      sortOrder: 140,
      trangThai: "DRAFT",
      attributionWindowDays: 60,
      commissionEnabled: false,
      ownerOrgUnitId: null,
      ownerEmployeeId: null,
      effectiveFrom: null,
      effectiveTo: null,
      description: null,
    });
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/nguon-hoa-hong/nguon?xem=tat-ca"));
    expect(TOAST.success).toHaveBeenCalledWith(expect.stringContaining("TikTok Ads"));
  });

  it("chọn «Kích hoạt ngay» + «Phụ huynh giới thiệu» + công tắc ⇒ payload đổi đúng", async () => {
    const luu = vi.fn(async () => taoOk);
    formTao(luu);
    nhapChu(ten(), "Giới thiệu mới");
    nhapChu(ma(), "GT_MOI");
    nhapChu(nhom(), "REFERRAL");
    fireEvent.click(screen.getByRole("radio", { name: /Kích hoạt ngay/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Phụ huynh giới thiệu/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bắt buộc giải trình" }));
    nhapChu(screen.getByLabelText("Phạm vi đơn vị"), "ou-cs1");
    nhapChu(screen.getByLabelText("Hiệu lực từ ngày"), "2026-11-01");
    bamTao();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect((luu.mock.calls[0] as unknown[])[0]).toMatchObject({
      trangThai: "ACTIVE",
      referrerRequirement: "PARENT",
      commissionEnabled: true,
      requiresNote: true,
      ownerOrgUnitId: "ou-cs1",
      effectiveFrom: "2026-10-31T17:00:00.000Z",
    });
  });

  it("máy chủ trả cảnh báo «người phụ trách chưa có tài khoản» ⇒ toast cảnh báo bằng câu người thường đọc", async () => {
    const luu = vi.fn(async (): Promise<KetQuaTaoNguonAction> => ({ ...taoOk, canhBao: ["NGUOI_PHU_TRACH_CHUA_CO_TAI_KHOAN"] }));
    formTao(luu);
    nhapChu(ten(), "Nguồn có chủ");
    nhapChu(ma(), "NGUON_CO_CHU");
    nhapChu(nhom(), "PARTNER");
    bamTao();
    await waitFor(() => expect(TOAST.warning).toHaveBeenCalledWith(expect.stringContaining("chưa có tài khoản")));
  });
});

describe("[NGF-03] lỗi máy chủ cạnh ô, tự xoá khi sửa ô", () => {
  it("«mã đã có» hiện CẠNH ô mã (không phải toast / banner); gõ lại mã ⇒ lỗi biến mất; ô khác không bị tô", async () => {
    const luu = vi.fn(async (): Promise<KetQuaTaoNguonAction> => ({ ok: false, error: "Mã «PAID_ADS» đã có (mã không phân biệt hoa/thường).", field: "code" }));
    formTao(luu);
    nhapChu(ten(), "Quảng cáo 2");
    nhapChu(ma(), "paid_ads");
    nhapChu(nhom(), "MARKETING");
    bamTao();
    const loi = await screen.findByText(/Mã «PAID_ADS» đã có/);
    expect(loi.getAttribute("role")).toBe("alert");
    expect(ma().getAttribute("aria-invalid")).toBe("true");
    expect(ten().getAttribute("aria-invalid")).toBeNull();
    expect(TOAST.error).not.toHaveBeenCalled();
    nhapChu(ma(), "paid_ads_2");
    await waitFor(() => expect(screen.queryByText(/Mã «PAID_ADS» đã có/)).toBeNull());
    expect(ma().getAttribute("aria-invalid")).toBeNull();
  });

  it("lỗi không thuộc ô nào (ngoại lệ mạng) ⇒ banner nói thẳng, form giữ nguyên dữ liệu đã nhập", async () => {
    const luu = vi.fn(async (): Promise<KetQuaTaoNguonAction> => {
      throw new Error("mạng đứt");
    });
    formTao(luu);
    nhapChu(ten(), "Nguồn thử mạng");
    nhapChu(ma(), "NGUON_MANG");
    nhapChu(nhom(), "OTHER");
    bamTao();
    expect((await screen.findByRole("alert")).textContent).toContain("Không lưu được lúc này");
    expect(ten().value).toBe("Nguồn thử mạng");
    expect(ROUTER.push).not.toHaveBeenCalled();
  });

  it("lỗi «chặn kích hoạt nguồn không người phụ trách» đặt cạnh ô người phụ trách", async () => {
    const luu = vi.fn(async (): Promise<KetQuaTaoNguonAction> => ({ ok: false, error: "Đang có chính sách hoa hồng trả cho người phụ trách nguồn — khai người phụ trách.", field: "ownerEmployeeId" }));
    formTao(luu);
    nhapChu(ten(), "Nguồn cần chủ");
    nhapChu(ma(), "NGUON_CAN_CHU");
    nhapChu(nhom(), "PARTNER");
    fireEvent.click(screen.getByRole("radio", { name: /Kích hoạt ngay/ }));
    bamTao();
    const loi = await screen.findByText(/trả cho người phụ trách nguồn/);
    expect(loi.getAttribute("role")).toBe("alert");
  });
});

describe("[NGF-04] danh mục lựa chọn và lời giải thích", () => {
  it("nhóm nguồn = ĐÚNG tập `LOAI_NGUON_CHON` của schema (không thêm, không bớt, KHÔNG có «Hệ thống»)", () => {
    formTao();
    const gia = Array.from(nhom().options)
      .map((o) => o.value)
      .filter((v) => v !== "");
    expect(gia).toEqual([...LOAI_NGUON_CHON]);
    expect(Array.from(nhom().options).some((o) => o.textContent === "Hệ thống")).toBe(false);
  });

  it("cửa sổ để trống = mặc định hệ thống và NÓI số mặc định; công tắc hoa hồng có câu giải thích một dòng", () => {
    formTao();
    expect(screen.getByText(/dùng mặc định của hệ thống \(90 ngày/)).toBeTruthy();
    expect((screen.getByLabelText(/Cửa sổ ghi công/) as HTMLInputElement).placeholder).toBe("Mặc định 90");
    expect(screen.getByText(/Bật thì mới dùng được các dòng thu hút \(có tỉ lệ\) của chính sách riêng của nguồn này; dòng «loại trừ».*chính sách chung/)).toBeTruthy();
  });

  it("5 cách xác định nguồn đều có mặt, mặc định «Không cần chọn người»; thứ tự gợi ý điền sẵn", () => {
    formTao();
    for (const nhan of ["Không cần chọn người", "Phụ huynh giới thiệu", "Nhân sự giới thiệu", "Đối tác giới thiệu", "Theo sự kiện"]) {
      expect(screen.getByRole("radio", { name: new RegExp(nhan) })).toBeTruthy();
    }
    expect((screen.getByRole("radio", { name: /Không cần chọn người/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Thứ tự hiển thị") as HTMLInputElement).value).toBe("140");
  });

  it("cây đơn vị: danh sách lấy từ `donVi` truyền vào, con thụt vào so với cha", () => {
    formTao();
    const sel = screen.getByLabelText("Phạm vi đơn vị") as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["", "ou-ho", "ou-cs1"]);
    expect(sel.options[2]!.textContent).toMatch(/^\u00A0\u00A0Cơ sở 1 \(CS1\)$/);
  });
});

describe("[NGF-05] sửa — ô khoá kèm lý do", () => {
  const dung = { attribution: true, touchpoint: false, phienBanChinhSach: false, so: false, page: false, nhomNhanSuMacDinh: false, daDung: true };

  it("nguồn HỆ THỐNG đã dùng: mã · nhóm · cách xác định · giải trình bị `disabled` và mỗi ô NÓI lý do (đúng câu của `truongBiKhoa`); tên · cửa sổ · hoa hồng · chủ vẫn sửa được", () => {
    const n = nguonMau({ code: "PAID_ADS", name: "Nguồn từ Quảng Cáo", isSystem: true, daDung: dung });
    formSua(n);
    const khoa = new Map(truongBiKhoa({ code: n.code, isSystem: true, daDung: true }).map((k) => [k.truong, k.lyDo]));
    expect(ma().disabled).toBe(true);
    expect(nhom().disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Phụ huynh giới thiệu/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Bắt buộc giải trình" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Chọn được ở ô nhập" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(khoa.get("code")!).length).toBeGreaterThan(0);
    expect(screen.getAllByText(khoa.get("sourceType")!).length).toBeGreaterThan(0);
    // đối chứng dương: các ô hệ thống được sửa
    expect(ten().disabled).toBe(false);
    expect((screen.getByLabelText(/Cửa sổ ghi công/) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Thứ tự hiển thị") as HTMLInputElement).disabled).toBe(false);
  });

  it("nguồn tự tạo ĐÃ DÙNG: mã khoá kèm lý do «đã có lead, chính sách…»; ĐỐI CHỨNG nguồn tự tạo CHƯA dùng: mã sửa được, không lý do khoá", () => {
    formSua(nguonMau({ daDung: dung }));
    expect(ma().disabled).toBe(true);
    expect(screen.getByText(/Nguồn đã có lead, chính sách, sổ hoa hồng hoặc Page tham chiếu/)).toBeTruthy();
    cleanup();
    formSua(nguonMau());
    expect(ma().disabled).toBe(false);
    expect(nhom().disabled).toBe(false);
    expect(screen.queryByText(/Nguồn đã có lead, chính sách/)).toBeNull();
  });

  it("UNKNOWN: công tắc hoa hồng khoá kèm câu «không bao giờ có hoa hồng theo nguồn»; ô nhóm nguồn hiện «Hệ thống»", () => {
    formSua(nguonMau({ code: "UNKNOWN", name: "Không rõ nguồn", isSystem: true, sourceType: "SYSTEM", selectable: false }));
    expect((screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/UNKNOWN không bao giờ có hoa hồng theo nguồn/)).toBeTruthy();
    expect(nhom().value).toBe("SYSTEM");
  });

  // Siết UNKNOWN (Q2 · 09/10): chỉ tên · mô tả · thứ tự. Bản đầu của form chỉ nối `disabled` cho mã/nhóm/cách xác định/giải trình/chọn được/hoa hồng, nên cửa sổ · người phụ trách · đơn vị ·
  // ngày hiệu lực vẫn vẽ SỬA ĐƯỢC rồi bấm Lưu mới bị từ chối — đúng lời hứa suông của luật 12 (ảnh chụp thật bắt được, DOM test cũ thì không vì chưa ai hỏi ô ấy).
  it("[NGF-05b] UNKNOWN: cửa sổ · đơn vị · ngày hiệu lực `disabled` KÈM lý do; người phụ trách chỉ đọc (không «Bỏ / Đổi», không ô tìm); tên · mô tả · thứ tự vẫn sửa được", () => {
    const n = nguonMau({ code: "UNKNOWN", name: "Không rõ nguồn", isSystem: true, sourceType: "SYSTEM", selectable: false, daDung: { ...dung } });
    formSua({ ...n, ownerEmployee: { id: "e1", ten: "Trần Thị Chủ", maNv: "NV001", coTaiKhoan: true } });
    const khoa = new Map(truongBiKhoa({ code: "UNKNOWN", isSystem: true, daDung: true }).map((k) => [k.truong, k.lyDo]));
    expect((screen.getByLabelText(/Cửa sổ ghi công/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Phạm vi đơn vị") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Hiệu lực từ ngày") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Hết hiệu lực từ ngày") as HTMLInputElement).disabled).toBe(true);
    for (const k of ["attributionWindowDays", "ownerOrgUnitId", "ownerEmployeeId"] as const) {
      expect(khoa.get(k), k).toMatch(/UNKNOWN/);
      expect(screen.getAllByText(khoa.get(k)!).length, `lý do khoá ${k}`).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Trần Thị Chủ/)).toBeTruthy(); // vẫn thấy giá trị hiện có
    expect(screen.queryByRole("button", { name: /Bỏ người phụ trách/ })).toBeNull();
    expect(screen.queryByPlaceholderText(/Gõ tên hoặc mã nhân viên/)).toBeNull();
    expect(ten().disabled).toBe(false);
    expect((screen.getByLabelText("Thứ tự hiển thị") as HTMLInputElement).disabled).toBe(false);
  });

  it("[NGF-05c] ĐỐI CHỨNG DƯƠNG: nguồn hệ thống KHÁC (PAID_ADS) vẫn sửa được cửa sổ · đơn vị · người phụ trách («Bỏ / Đổi» bấm được); ngày hiệu lực khoá kèm lý do", () => {
    const n = nguonMau({ code: "PAID_ADS", name: "Nguồn từ Quảng Cáo", isSystem: true, daDung: dung, ownerEmployee: { id: "e1", ten: "Trần Thị Chủ", maNv: "NV001", coTaiKhoan: true } });
    formSua(n);
    expect((screen.getByLabelText(/Cửa sổ ghi công/) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText("Phạm vi đơn vị") as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /Bỏ người phụ trách/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("Hiệu lực từ ngày") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Hết hiệu lực từ ngày") as HTMLInputElement).disabled).toBe(true);
  });

  it("giá trị hiện có được điền sẵn: tên, cửa sổ riêng, ngày hiệu lực theo NGÀY VN, người phụ trách, đơn vị", () => {
    formSua(
      nguonMau({
        attributionWindowDays: 45,
        effectiveTo: "2026-12-31T17:00:00.000Z",
        ownerOrgUnitId: "ou-cs1",
        ownerEmployee: { id: "e1", ten: "Trần Thị Chủ", maNv: "NV001", coTaiKhoan: true },
      }),
    );
    expect(ten().value).toBe("TikTok Ads");
    expect((screen.getByLabelText(/Cửa sổ ghi công/) as HTMLInputElement).value).toBe("45");
    expect((screen.getByLabelText("Hết hiệu lực từ ngày") as HTMLInputElement).value).toBe("2027-01-01");
    expect((screen.getByLabelText("Phạm vi đơn vị") as HTMLSelectElement).value).toBe("ou-cs1");
    expect(screen.getByText("Trần Thị Chủ")).toBeTruthy();
    expect(screen.getByText(/NV001/)).toBeTruthy();
  });
});

describe("[NGF-06] sửa — Lưu nói thật", () => {
  it("chưa đổi gì ⇒ nút Lưu KHOÁ kèm câu «Chưa có thay đổi»; đổi tên ⇒ Lưu mở và gửi ĐÚNG {name} + mốc khoá lạc quan, không lý do", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau(), boiCanhMau(), luu);
    expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Chưa có thay đổi nào để lưu.")).toBeTruthy();
    nhapChu(ten(), "TikTok Ads (đổi tên)");
    await waitFor(() => expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByLabelText(/Lý do/)).toBeNull(); // đổi tên không đòi lý do
    bamLuu();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(luu).toHaveBeenCalledWith({ id: "g1", updatedAtDaThay: MOC, vao: { name: "TikTok Ads (đổi tên)" }, lyDo: null });
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/nguon-hoa-hong/nguon/TIKTOK_ADS"));
    expect(TOAST.success).toHaveBeenCalled();
  });

  it("máy chủ báo «không đổi gì» ⇒ toast thông tin, không quay đi", async () => {
    const luu = vi.fn(async (): Promise<KetQuaSuaNguonAction> => ({ ok: true, doi: false, updatedAt: MOC, canhBao: [] }));
    formSua(nguonMau(), boiCanhMau(), luu);
    nhapChu(ten(), "Tên khác");
    bamLuu();
    await waitFor(() => expect(TOAST.info).toHaveBeenCalledWith("Không có gì thay đổi."));
    expect(ROUTER.push).not.toHaveBeenCalled();
  });
});

describe("[NGF-07] sửa — đổi nhạy cảm đòi lý do", () => {
  it("đổi cửa sổ ⇒ ô lý do xuất hiện; Lưu với lý do ngắn ⇒ lỗi cạnh ô lý do, KHÔNG gọi; đủ ⇒ gọi với lý do đã trim", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau(), boiCanhMau(), luu);
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    nhapChu(screen.getByLabelText(/Cửa sổ ghi công/), "30");
    const lyDo = await screen.findByLabelText(/Lý do/);
    nhapChu(lyDo, "ngắn");
    bamLuu();
    await waitFor(() => expect(lyDo.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(/cần lý do từ 10 ký tự/)).toBeTruthy();
    expect(luu).not.toHaveBeenCalled();
    nhapChu(lyDo, `  ${LY_DO}  `);
    await waitFor(() => expect(lyDo.getAttribute("aria-invalid")).toBeNull());
    bamLuu();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(luu).toHaveBeenCalledWith({ id: "g1", updatedAtDaThay: MOC, vao: { attributionWindowDays: 30 }, lyDo: LY_DO });
  });

  it("cửa sổ không hợp lệ (0) ⇒ lỗi cạnh ô cửa sổ, tiếng Việt, không gọi", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau(), boiCanhMau(), luu);
    nhapChu(screen.getByLabelText(/Cửa sổ ghi công/), "0");
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    bamLuu();
    expect(await screen.findByText("Cửa sổ ghi công phải ≥ 1 ngày.")).toBeTruthy();
    expect(luu).not.toHaveBeenCalled();
  });

  it("đích MẶC ĐỊNH của quy nguồn: tắt «chọn được» ⇒ lỗi cạnh công tắc (cùng cổng với máy chủ); nguồn thường tắt được kèm cảnh báo «lead mới sẽ không chọn được»", async () => {
    const mac = nguonMau({ code: "PAID_ADS", isSystem: false });
    formSua(mac, boiCanhMau({ laDichMacDinh: true }));
    fireEvent.click(screen.getByRole("switch", { name: "Chọn được ở ô nhập" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    bamLuu();
    expect(await screen.findByText(/đang là nguồn MẶC ĐỊNH của quy nguồn/)).toBeTruthy();
    cleanup();
    formSua(nguonMau());
    fireEvent.click(screen.getByRole("switch", { name: "Chọn được ở ô nhập" }));
    expect(await screen.findByText(/Lead MỚI sẽ không chọn được nguồn này/)).toBeTruthy();
  });
});

describe("[NGF-08] sửa — đổi ai nhận tiền", () => {
  const dinhTien = { chinhSachRieng: true, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false };
  const daCoChinhSach = { attribution: true, touchpoint: false, phienBanChinhSach: true, so: false, page: false, nhomNhanSuMacDinh: false, daDung: true };

  it("thiếu `commission_policies:activate` ⇒ nút Lưu KHOÁ và thanh dưới NÓI TÊN khoá; không gọi máy chủ", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau({ daDung: daCoChinhSach }), boiCanhMau({ dinhTien, coQuyenKichHoat: false }), luu);
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    await waitFor(() => expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(screen.getByRole("group", { name: "Thao tác" })).getByRole("status").textContent).toContain("commission_policies:activate");
    bamLuu();
    expect(luu).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG DƯƠNG: có quyền ⇒ Lưu mở, CẢNH BÁO «đổi ai nhận tiền» hiện, và lượt lưu đi tới máy chủ", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau({ daDung: daCoChinhSach }), boiCanhMau({ dinhTien, coQuyenKichHoat: true }), luu);
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    await waitFor(() => expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/là đổi ai nhận tiền/)).toBeTruthy();
    expect(screen.queryByText(/commission_policies:activate/)).toBeNull();
    bamLuu();
    await waitFor(() => expect(luu).toHaveBeenCalledWith(expect.objectContaining({ vao: { commissionEnabled: true }, lyDo: LY_DO })));
  });

  it("nguồn CHƯA dính tiền: thiếu quyền kích hoạt KHÔNG chặn, không cảnh báo tiền", async () => {
    formSua(nguonMau(), boiCanhMau({ coQuyenKichHoat: false }));
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    await waitFor(() => expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/là đổi ai nhận tiền/)).toBeNull();
  });

  it("máy chủ vẫn từ chối vì thiếu quyền (dữ liệu cũ) ⇒ banner nguyên văn, form giữ nguyên", async () => {
    const luu = vi.fn(async (): Promise<KetQuaSuaNguonAction> => ({ ok: false, error: "… cần thêm quyền kích hoạt chính sách (commission_policies:activate). …", field: "quyen" }));
    formSua(nguonMau(), boiCanhMau(), luu);
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    bamLuu();
    expect((await screen.findByRole("alert")).textContent).toContain("commission_policies:activate");
    expect(ROUTER.push).not.toHaveBeenCalled();
  });
});

describe("[NGF-09] khoá lạc quan", () => {
  it("«vừa được người khác thay đổi» ⇒ banner + «Tải lại dữ liệu mới» (làm mới trang) và nói thẳng là chỗ đang sửa sẽ mất", async () => {
    const luu = vi.fn(async (): Promise<KetQuaSuaNguonAction> => ({ ok: false, error: "Nguồn vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "vuaDoi" }));
    formSua(nguonMau(), boiCanhMau(), luu);
    nhapChu(ten(), "Tên mới");
    bamLuu();
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("vừa được người khác thay đổi");
    expect(banner.textContent).toContain("sẽ mất khi tải lại");
    fireEvent.click(within(banner).getByRole("button", { name: "Tải lại dữ liệu mới" }));
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("gửi ĐÚNG mốc `capNhatLuc` đã thấy lúc mở trang (không phải giờ bấm)", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau({ capNhatLuc: "2026-09-01T01:02:03.456Z" }), boiCanhMau(), luu);
    nhapChu(ten(), "Tên mới");
    bamLuu();
    await waitFor(() => expect(luu).toHaveBeenCalledWith(expect.objectContaining({ updatedAtDaThay: "2026-09-01T01:02:03.456Z" })));
  });
});

describe("[NGF-10] người phụ trách", () => {
  const TIM: HamTim = vi.fn(async () => ({
    ok: true as const,
    ketQua: [{ loai: "NHAN_SU" as const, employeeId: "emp-7", ten: "Lê Văn Phụ", ma: "NV007", vai: "SALE" as const }],
  }));

  it("nhãn «Người phụ trách» (không phải «Nhân sự giới thiệu»); chọn người ⇒ gửi employeeId; kết quả KHÔNG hiện pill vai (vai chỉ có nghĩa với người giới thiệu)", async () => {
    const luu = vi.fn(async () => taoOk);
    formTao(luu, TIM);
    expect(screen.queryByText("Nhân sự giới thiệu", { selector: "label" })).toBeNull();
    const o = screen.getByRole("combobox", { name: "Người phụ trách" });
    fireEvent.change(o, { target: { value: "Lê Văn" } });
    const dong = await screen.findByRole("option", { name: /Lê Văn Phụ/ }, { timeout: 2000 });
    expect(within(dong).queryByText("Sale/Tư vấn")).toBeNull();
    fireEvent.click(dong);
    expect(screen.getByText("Lê Văn Phụ")).toBeTruthy();
    nhapChu(ten(), "Nguồn có chủ");
    nhapChu(ma(), "NGUON_CHU_MOI");
    nhapChu(nhom(), "PARTNER");
    bamTao();
    await waitFor(() => expect(luu).toHaveBeenCalled());
    expect((luu.mock.calls[0] as unknown[])[0]).toMatchObject({ ownerEmployeeId: "emp-7" });
  });

  it("sửa: «Bỏ / Đổi» gỡ người đang gán ⇒ payload ownerEmployeeId=null (cần lý do — đổi nhạy cảm)", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau({ ownerEmployee: { id: "e1", ten: "Trần Thị Chủ", maNv: "NV001", coTaiKhoan: true } }), boiCanhMau(), luu, TIM);
    expect(screen.getByText("Trần Thị Chủ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ người phụ trách Trần Thị Chủ" }));
    expect(screen.queryByText("Trần Thị Chủ")).toBeNull();
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    bamLuu();
    await waitFor(() => expect(luu).toHaveBeenCalledWith(expect.objectContaining({ vao: { ownerEmployeeId: null }, lyDo: LY_DO })));
  });

  it("người phụ trách chưa có tài khoản ⇒ dòng tóm tắt nói «phần hoa hồng của người này sẽ treo»", () => {
    formSua(nguonMau({ ownerEmployee: { id: "e2", ten: "Phạm Chưa TK", maNv: "NV002", coTaiKhoan: false } }));
    expect(screen.getByText(/Chưa có tài khoản — phần hoa hồng của người này sẽ treo ở hàng chờ/)).toBeTruthy();
  });
});

describe("[NGF-09b] «Kích hoạt ngay» NÓI THẬT trước khi bấm Tạo (W2, res2 R2-M1) + tắt hoa hồng khi có dòng thu hút", () => {
  // Cấy: bỏ `chanKhiTao` khỏi resolver ⇒ ca a đỏ (lỗi chỉ hiện sau khi máy chủ từ chối); bỏ `chanLuu` của chế độ tạo ⇒ ca b đỏ.
  const dienDu = () => {
    nhapChu(ten(), "Nguồn kích hoạt");
    nhapChu(ma(), "NGUON_KICH_HOAT");
    nhapChu(nhom(), "PARTNER");
    fireEvent.click(screen.getByRole("radio", { name: /Kích hoạt ngay/ }));
  };

  it("a. rule chủ-nguồn đang chạy + «Kích hoạt ngay» + chưa chọn người phụ trách ⇒ lỗi cạnh ô, KHÔNG gọi máy chủ; chọn «Lưu nháp» ⇒ tạo được (đối chứng dương)", async () => {
    const luu = vi.fn(async () => taoOk);
    render(<NguonForm cheDo="tao" donVi={DON_VI} thuTuGoiY={140} cuaSoMacDinhNgay={90} boiCanhTao={{ ruleChuChay: true, coQuyenKichHoat: true }} luuTao={luu} />);
    dienDu();
    bamTao();
    expect((await screen.findAllByText(/trả cho người phụ trách nguồn/)).length).toBeGreaterThan(0);
    // lý do cũng hiện Ở CHÂN, cạnh nút Tạo (ô «Người phụ trách» nằm xa nút — chụp thật 10/10)
    expect(within(screen.getByRole("group", { name: "Thao tác" })).getByRole("status").textContent).toContain("trả cho người phụ trách nguồn");
    expect(luu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Lưu nháp/ }));
    bamTao();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
  });

  it("b. thiếu `commission_policies:activate` + nguồn ACTIVE có người phụ trách + rule chủ-nguồn chạy ⇒ nút Tạo KHOÁ, thanh dưới nêu TÊN khoá; có quyền, hoặc không có rule ⇒ nút mở (đối chứng dương)", async () => {
    const TIM: HamTim = vi.fn(async () => ({ ok: true as const, ketQua: [{ loai: "NHAN_SU" as const, employeeId: "emp-7", ten: "Lê Văn Phụ", ma: "NV007", vai: "SALE" as const }] }));
    const veForm = (boiCanhTao: { ruleChuChay: boolean; coQuyenKichHoat: boolean }) =>
      render(<NguonForm cheDo="tao" donVi={DON_VI} thuTuGoiY={140} cuaSoMacDinhNgay={90} boiCanhTao={boiCanhTao} luuTao={vi.fn(async () => taoOk)} tim={TIM} />);
    const chonChu = async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Người phụ trách" }), { target: { value: "Lê Văn" } });
      fireEvent.click(await screen.findByRole("option", { name: /Lê Văn Phụ/ }, { timeout: 2000 }));
    };
    veForm({ ruleChuChay: true, coQuyenKichHoat: false });
    dienDu();
    await chonChu();
    await waitFor(() => expect((screen.getByRole("button", { name: "Tạo nguồn" }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(screen.getByRole("group", { name: "Thao tác" })).getByRole("status").textContent).toContain("commission_policies:activate");
    cleanup();
    veForm({ ruleChuChay: true, coQuyenKichHoat: true });
    dienDu();
    await chonChu();
    await waitFor(() => expect((screen.getByRole("button", { name: "Tạo nguồn" }) as HTMLButtonElement).disabled).toBe(false));
    cleanup();
    veForm({ ruleChuChay: false, coQuyenKichHoat: false });
    dienDu();
    await chonChu();
    await waitFor(() => expect((screen.getByRole("button", { name: "Tạo nguồn" }) as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("[NGF-11] sửa — tắt «tham gia hoa hồng» khi chính sách riêng có dòng thu hút bị CHẶN cạnh ô (W2, res1 R1-M1)", () => {
  const coThuHut = { chinhSachRieng: true, coDongThuHutRieng: true, ruleChuNguonBatKy: false, ruleChuChay: false };
  const daCoChinhSach = { attribution: true, touchpoint: false, phienBanChinhSach: true, so: false, page: false, nhomNhanSuMacDinh: false, daDung: true };

  it("TẮT cờ + có dòng thu hút ⇒ lỗi cạnh ô «thu hút», Lưu không đi tới máy chủ — kể cả người có đủ quyền kích hoạt; nguồn KHÔNG có dòng thu hút ⇒ Lưu mở", async () => {
    const luu = vi.fn(async () => suaOk);
    formSua(nguonMau({ commissionEnabled: true, daDung: daCoChinhSach }), boiCanhMau({ dinhTien: coThuHut, coQuyenKichHoat: true }), luu);
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    expect((await screen.findAllByText(/dòng thu hút/)).length).toBeGreaterThan(0);
    // lý do cũng hiện Ở CHÂN, cạnh nút Lưu — công tắc nằm xa nút (chụp thật 10/10)
    expect(within(screen.getByRole("group", { name: "Thao tác" })).getByRole("status").textContent).toContain("dòng thu hút");
    bamLuu();
    expect(luu).not.toHaveBeenCalled();
    cleanup();
    const luu2 = vi.fn(async () => suaOk);
    formSua(nguonMau({ commissionEnabled: true, daDung: daCoChinhSach }), boiCanhMau({ dinhTien: { ...coThuHut, coDongThuHutRieng: false }, coQuyenKichHoat: true }), luu2);
    fireEvent.click(screen.getByRole("switch", { name: "Có tham gia hoa hồng theo nguồn" }));
    nhapChu(await screen.findByLabelText(/Lý do/), LY_DO);
    await waitFor(() => expect((screen.getByRole("button", { name: "Lưu thay đổi" }) as HTMLButtonElement).disabled).toBe(false));
    bamLuu();
    await waitFor(() => expect(luu2).toHaveBeenCalledTimes(1));
  });
});

describe("[NGF-12] 375px — công tắc bấm được bằng chữ, nút nhỏ đạt vùng chạm, gợi ý không đứng dưới ô đã khoá (W4)", () => {
  it("nhãn công tắc là <label htmlFor> của CHÍNH công tắc: bấm chữ ⇒ công tắc đổi (không chỉ bấm được thanh 20px)", () => {
    formTao();
    const sw = screen.getByRole("switch", { name: "Chọn được ở ô nhập" });
    const truoc = sw.getAttribute("aria-checked");
    const nhan = screen.getByText("Chọn được ở ô nhập", { selector: "label" });
    expect(nhan.getAttribute("for")).toBe(sw.id);
    fireEvent.click(nhan);
    expect(sw.getAttribute("aria-checked")).not.toBe(truoc);
    // vùng bấm của cả dòng ≥ 44px
    expect(nhan.closest("label")!.className).toContain("min-h-11");
  });

  it("công tắc BỊ KHOÁ: bấm chữ KHÔNG đổi gì (đối chứng ca trên)", () => {
    const g = nguonMau({ code: "UNKNOWN", isSystem: true });
    formSua(g);
    const sw = screen.getByRole("switch", { name: "Chọn được ở ô nhập" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    const truoc = sw.getAttribute("aria-checked");
    fireEvent.click(screen.getByText("Chọn được ở ô nhập", { selector: "label" }));
    expect(sw.getAttribute("aria-checked")).toBe(truoc);
  });

  it("«Bỏ / Đổi» và «Tải lại dữ liệu mới» cao ≥44px dưới md (h-11 md:h-8)", async () => {
    const luu = vi.fn(async (): Promise<KetQuaSuaNguonAction> => ({ ok: false, error: "Nguồn vừa được người khác thay đổi — hãy tải lại rồi thử lại.", field: "vuaDoi" }));
    formSua(nguonMau({ ownerEmployee: { id: "e1", ten: "Trần Thị Chủ", maNv: "NV001", coTaiKhoan: true } }), boiCanhMau(), luu, undefined);
    const boDoi = screen.getByRole("button", { name: "Bỏ người phụ trách Trần Thị Chủ" });
    expect(boDoi.className).toContain("h-11");
    expect(boDoi.className).toContain("md:h-8");
    nhapChu(ten(), "Tên mới");
    bamLuu();
    const taiLai = await screen.findByRole("button", { name: "Tải lại dữ liệu mới" });
    expect(taiLai.className).toContain("h-11");
    expect(taiLai.className).toContain("md:h-8");
  });

  it("ô đã khoá (nguồn hệ thống: cửa sổ ghi công / hiệu lực) KHÔNG còn câu «Để trống = …» dưới ô; ô mở thì còn (đối chứng)", () => {
    formSua(nguonMau({ code: "UNKNOWN", isSystem: true }));
    expect((screen.getByLabelText(/Cửa sổ ghi công/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(/Để trống = dùng mặc định của hệ thống/)).toBeNull();
    expect(screen.queryByText(/Để trống = có hiệu lực ngay/)).toBeNull();
    cleanup();
    formSua(nguonMau());
    expect(screen.getByText(/Để trống = dùng mặc định của hệ thống/)).toBeTruthy();
  });

  it("«Theo sự kiện» NÓI THẬT: chưa có danh sách sự kiện nên ô nhập chưa hỏi thêm gì; các lựa chọn khác không mang câu đó", () => {
    formTao();
    const sk = screen.getByText("Theo sự kiện").closest("label") as HTMLElement;
    expect(sk.textContent).toMatch(/chưa có danh sách sự kiện/i);
    expect(sk.textContent).not.toMatch(/gắn với một sự kiện cụ thể/);
    const ph = screen.getByText("Phụ huynh giới thiệu").closest("label") as HTMLElement;
    expect(ph.textContent).not.toMatch(/chưa có danh sách sự kiện/i);
  });
});
