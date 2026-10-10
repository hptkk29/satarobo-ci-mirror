/**
 * [NHH-FE-10] — `docSoHangChoTheoTab`: số hàng chờ cho pill tab và route gốc.
 *
 * Hàm này CHỈ đếm cho tab mà người xem THẤY (quyền ∧ cờ): không tốn một câu SQL cho tab họ không có, và không để
 * lộ số của tab đó. Đợt cấy 08/10 (W11): bỏ điều kiện `scope.tabMoDuoc("nguon")` ra XANH — không ca nào gọi hàm này
 * (nó nằm ngoài mọi test) trong khi nó chạy trên MỌI trang của module.
 *
 * `demHangChoNguon` bị giả lập: đường đếm thật đã có ca DB (`tests/lead-intake/nguon-hang-cho.spec.ts`); ở đây chỉ
 * canh QUYẾT ĐỊNH "có đếm hay không" và "đếm với tham số nào" — nên khẳng định cả số lần gọi lẫn tham số.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

vi.mock("@/lib/nguon/doc-hang-cho", () => ({ demHangChoNguon: vi.fn() }));
vi.mock("@/lib/hoa-hong/chinh-sach-doc", () => ({ demHangChoChinhSach: vi.fn() }));
vi.mock("@/lib/hoa-hong/ky-doc", () => ({ demHangChoChanTheoTamNhin: vi.fn() }));
vi.mock("@/lib/hoa-hong/khieu-nai-man", () => ({ demKhieuNaiChoTab: vi.fn() }));
vi.mock("@/lib/hoa-hong/hang-cho-so-doc", () => ({ demHangChoSo: vi.fn() }));

import { demHangChoChinhSach } from "@/lib/hoa-hong/chinh-sach-doc";
import { demHangChoChanTheoTamNhin } from "@/lib/hoa-hong/ky-doc";
import { demKhieuNaiChoTab } from "@/lib/hoa-hong/khieu-nai-man";
import { demHangChoSo } from "@/lib/hoa-hong/hang-cho-so-doc";
import { demHangChoNguon } from "@/lib/nguon/doc-hang-cho";
import { docSoHangChoTheoTab } from "./hang-cho";
import { dungNguonHoaHongScope, type ModuleKey } from "./scope";

const actor = { userId: "u-test" } as unknown as Actor;
const dem = vi.mocked(demHangChoNguon);
const demCs = vi.mocked(demHangChoChinhSach);
const demKy = vi.mocked(demHangChoChanTheoTamNhin);
const demKn = vi.mocked(demKhieuNaiChoTab);
const demSo = vi.mocked(demHangChoSo);

function scopeCua(quyen: ModuleKey[], co: { nguon: boolean; engine: boolean }) {
  return dungNguonHoaHongScope({
    quyen: new Set(quyen),
    co,
    centerIds: { Lead: "ALL", CommissionPeriod: "ALL", CommissionTransaction: "ALL" },
    cacCoSo: [],
  });
}

beforeEach(() => {
  dem.mockReset();
  dem.mockResolvedValue(7);
  demCs.mockReset();
  demCs.mockResolvedValue(3);
  demKy.mockReset();
  demKy.mockResolvedValue(5);
  demKn.mockReset();
  demKn.mockResolvedValue(5);
  demSo.mockReset();
  demSo.mockResolvedValue({ canXuLy: 5, dem: { CHAN_KHOA_KY: 4, CHUA_PHAN_GIAI_NGUOI_HUONG: 1, SO_DU_AM: 0 }, demTheoLoai: { CHUA_PHAN_GIAI_NGUOI_HUONG: 1, CHO_CHINH_SACH: 1, VUOT_TRAN: 1, THIEU_DU_LIEU_THANH_TOAN: 1, CHO_DIEU_CHINH: 1, SO_DU_AM: 0 } });
});

describe("[NHH-FE-10] docSoHangChoTheoTab — chỉ đếm tab người xem THẤY", () => {
  it("thấy tab Nguồn (sources:view ∧ cờ nguồn) ⇒ { nguon: N }, đếm đúng MỘT lần, toàn tầm nhìn (coSoId null)", async () => {
    const kq = await docSoHangChoTheoTab(actor, scopeCua(["sources:view"], { nguon: true, engine: false }));
    expect(kq).toEqual({ nguon: 7 });
    expect(dem).toHaveBeenCalledTimes(1);
    expect(dem).toHaveBeenCalledWith(actor, null);
  });

  it("KHÔNG có sources:view ⇒ {} và KHÔNG chạm câu đếm (đối chứng dương: ca trên có quyền thì đếm)", async () => {
    const kq = await docSoHangChoTheoTab(actor, scopeCua(["commission:view-self"], { nguon: true, engine: true }));
    expect(kq).toEqual({});
    expect(dem).not.toHaveBeenCalled();
  });

  it("cờ nguồn TẮT dù có quyền ⇒ {} và không đếm", async () => {
    const kq = await docSoHangChoTheoTab(actor, scopeCua(["sources:view"], { nguon: false, engine: true }));
    expect(kq).toEqual({});
    expect(dem).not.toHaveBeenCalled();
  });

  it("tab Sổ có khoá (hàm đếm `canXuLy`); cả năm tab cùng hiện khi người xem đủ quyền — vắng khoá chỉ khi không thấy tab / không có việc", async () => {
    const kq = await docSoHangChoTheoTab(
      actor,
      scopeCua(["sources:view", "commission_policies:view", "commission:view-center", "commission_periods:manage", "commission_disputes:review"], { nguon: true, engine: true }),
    );
    expect(Object.keys(kq).sort()).toEqual(["chinh-sach", "khieu-nai", "ky", "nguon", "so"]);
  });

  it("[NHH-DSP-H1] tab Khiếu nại: người giữ quyền DUYỆT ⇒ { khieu-nai: N }, đếm MỘT lần với actor; chỉ có view-self (không duyệt) ⇒ không đếm, VẮNG khoá; cờ engine TẮT ⇒ không đếm", async () => {
    const duyet = await docSoHangChoTheoTab(actor, scopeCua(["commission_disputes:review"], { nguon: false, engine: true }));
    expect(duyet).toEqual({ "khieu-nai": 5 });
    expect(demKn).toHaveBeenCalledTimes(1);
    expect(demKn).toHaveBeenCalledWith(actor);

    demKn.mockClear();
    // đối chứng: thấy tab (view-self) nhưng KHÔNG duyệt ⇒ không có hàng chờ để đếm
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission:view-self"], { nguon: false, engine: true }))).toEqual({});
    // cờ engine tắt ⇒ không thấy tab ⇒ không đếm
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission_disputes:review"], { nguon: true, engine: false }))).toEqual({});
    expect(demKn).not.toHaveBeenCalled();
  });

  it("[NHH-DSP-H1b] số 0 của tab Khiếu nại được trả nguyên là 0; `null` từ hàm đếm (không duyệt) thì VẮNG khoá", async () => {
    demKn.mockResolvedValueOnce(0);
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission_disputes:review"], { nguon: false, engine: true }))).toEqual({ "khieu-nai": 0 });
    demKn.mockResolvedValueOnce(null);
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission_disputes:review"], { nguon: false, engine: true }))).toEqual({});
  });

  it("[NHH-SO-W11c] tab Sổ: số hàng chờ = tổng MỌI việc đang mở (không phải số chặn) và CHỈ cho người có view-center; Sale (chỉ view-self) KHÔNG có khoá và không tốn câu đếm", async () => {
    const thay = await docSoHangChoTheoTab(actor, scopeCua(["commission:view-center"], { nguon: false, engine: true }));
    expect(thay).toEqual({ so: 5, ky: 5 }); // view-center cũng mở tab Kỳ — pill Kỳ là số CHẶN, pill Sổ là số CẦN XỬ LÝ (hai nghĩa khác nhau)
    expect(demSo).toHaveBeenCalledTimes(1);
    expect(demSo).toHaveBeenCalledWith(actor, null);
    demSo.mockClear();
    // đối chứng ÂM: vào được tab Sổ (view-self) nhưng KHÔNG có hàng chờ ⇒ không khoá, không đếm
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission:view-self"], { nguon: true, engine: true }))).toEqual({});
    // cờ engine tắt ⇒ tab không mở được ⇒ không đếm dù có quyền
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission:view-center"], { nguon: true, engine: false }))).toEqual({});
    expect(demSo).not.toHaveBeenCalled();
  });

  it("[NHH-FE-10b] tab Chính sách: thấy (commission_policies:view ∧ cờ engine) ⇒ đếm MỘT lần với actor; không thấy ⇒ không đếm", async () => {
    const thay = await docSoHangChoTheoTab(actor, scopeCua(["commission_policies:view"], { nguon: false, engine: true }));
    expect(thay).toEqual({ "chinh-sach": 3 });
    expect(demCs).toHaveBeenCalledTimes(1);
    expect(demCs.mock.calls[0]![0]).toBe(actor);
    expect(demCs.mock.calls[0]![1]).toBeInstanceOf(Date);

    demCs.mockClear();
    // đối chứng: cờ engine TẮT, hoặc thiếu quyền ⇒ không đếm, không có khoá
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission_policies:view"], { nguon: true, engine: false }))).toEqual({});
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission:view-self"], { nguon: true, engine: true }))).toEqual({});
    expect(demCs).not.toHaveBeenCalled();
  });

  it("số 0 được trả nguyên là 0 (tab THẤY và hàng chờ rỗng ≠ tab không thấy)", async () => {
    dem.mockResolvedValue(0);
    const kq = await docSoHangChoTheoTab(actor, scopeCua(["sources:view"], { nguon: true, engine: false }));
    expect(kq).toEqual({ nguon: 0 });
  });
});

describe("[NHH-KY-HC-01] tab Kỳ: pill = hàng chờ CHẶN của các kỳ chưa khoá trong tầm nhìn", () => {
  it("thấy tab Kỳ (commission_periods:manage ∧ cờ engine) ⇒ { ky: N }, đếm đúng MỘT lần với actor của người xem", async () => {
    const kq = await docSoHangChoTheoTab(actor, scopeCua(["commission_periods:manage"], { nguon: false, engine: true }));
    expect(kq).toEqual({ ky: 5 });
    expect(demKy).toHaveBeenCalledTimes(1);
    expect(demKy).toHaveBeenCalledWith(actor);
  });

  it("KHÔNG thấy (thiếu quyền, hoặc cờ engine tắt) ⇒ không đếm, không có khoá; số 0 vẫn được trả nguyên", async () => {
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission:view-self"], { nguon: true, engine: true }))).toEqual({});
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission_periods:manage"], { nguon: true, engine: false }))).toEqual({});
    expect(demKy).not.toHaveBeenCalled();
    demKy.mockResolvedValue(0);
    expect(await docSoHangChoTheoTab(actor, scopeCua(["commission:view-center"], { nguon: false, engine: true }))).toEqual({ ky: 0, so: 5 });
  });
});
