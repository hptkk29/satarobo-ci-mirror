// @vitest-environment node
// [BL5-ACT] Cổng của Server Action vòng đời bảo lưu (liên hệ · thông báo chính thức · gia hạn · khôi phục): đăng nhập → ĐÚNG quyền →
// tầm nhìn cơ sở → mới gọi dịch vụ. Luật nghiệp vụ đã có ca Postgres ở `tests/finance/bao-luu-vong-doi.test.ts`.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  quyen: new Set<string>(),
  dangNhap: true,
  hoSo: null as unknown,
  fn: {
    lienHe: vi.fn(), thongBao: vi.fn(), deNghi: vi.fn(), duyet: vi.fn(), tuChoi: vi.fn(), khoiPhuc: vi.fn(),
    baoChoDuyet: vi.fn(async () => 1), baoKetQua: vi.fn(async () => 1),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/bao-luu/feature", () => ({ laBaoLuuBat: vi.fn(async () => true) }));
vi.mock("@/lib/finance/bao-luu-tien", () => ({ apDungDoiHanBaoLuu: vi.fn(async () => ({ ok: true, soNgay: 0, soDotDaDoi: 0, donDaCham: [], donCoChuaBatCo: 0 })) }));
vi.mock("@/lib/auth", () => ({ auth: async () => (h.dangNhap ? { user: { id: "u-toi", name: "Tôi" } } : null) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (a: string) => h.quyen.has(a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ id: "u-toi" }) }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ student: { findFirst: async () => ({ id: "hv1" }) }, studentReserve: { findUnique: async () => h.hoSo }, user: { findMany: async () => [] } }),
}));
vi.mock("@/lib/bao-luu/dich-vu", () => ({ lapHoSo: vi.fn(), duyetHoSo: vi.fn(), tuChoiHoSo: vi.fn(), huyHoSo: vi.fn() }));
vi.mock("@/lib/bao-luu/thong-bao", () => ({
  baoChoDuyet: vi.fn(), baoDaDuyet: vi.fn(), baoTuChoi: vi.fn(),
  baoGiaHanChoDuyet: (...a: unknown[]) => h.fn.baoChoDuyet(...(a as [])),
  baoGiaHanKetQua: (...a: unknown[]) => h.fn.baoKetQua(...(a as [])),
}));
vi.mock("@/lib/bao-luu/vong-doi", () => ({
  KENH_THONG_BAO: ["ZNS", "EMAIL", "THU_TAY"],
  ghiLienHe: h.fn.lienHe, ghiThongBaoChinhThuc: h.fn.thongBao, deNghiGiaHan: h.fn.deNghi, duyetGiaHan: h.fn.duyet, tuChoiGiaHan: h.fn.tuChoi, khoiPhuc: h.fn.khoiPhuc,
}));

// Phiên 6: ba dịch vụ mới (phục học · tạm dừng lớp · yêu cầu hoàn) — giả để file này không kéo `getSetting` → `next/cache`.
vi.mock("@/lib/bao-luu/phuc-hoc-db", () => ({ baoPhucHoc: vi.fn(), chuyenSangTrungTam: vi.fn(), goiYLopPhucHoc: vi.fn(), phucHoc: vi.fn() }));
vi.mock("@/lib/bao-luu/tam-dung-lop", () => ({ tamDungLop: vi.fn() }));
vi.mock("@/lib/bao-luu/yeu-cau-hoan", () => ({ sinhYeuCauHoan: vi.fn() }));

import {
  lienHeBaoLuuAction, thongBaoChinhThucAction, deNghiGiaHanAction, duyetGiaHanAction, tuChoiGiaHanAction, khoiPhucBaoLuuAction,
} from "./_actions";

const HS = (extra: object = {}) => ({ id: "r1", centerId: "cs1", createdByUserId: "nguoi-lap", studentId: "hv1", student: { name: "An" }, enrollment: null, ...extra });
const ID = { reserveId: "r1" };
const dichVu = () => Object.values(h.fn).filter((f) => f !== h.fn.baoChoDuyet && f !== h.fn.baoKetQua);
const chuaGoi = () => dichVu().forEach((f) => expect(f).not.toHaveBeenCalled());

beforeEach(() => {
  h.quyen = new Set();
  h.dangNhap = true;
  h.hoSo = HS();
  for (const f of Object.values(h.fn)) f.mockReset();
  h.fn.lienHe.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.fn.thongBao.mockResolvedValue({ ok: true, data: { reserveId: "r1", hanPhanHoi: new Date() } });
  h.fn.deNghi.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.fn.duyet.mockResolvedValue({ ok: true, data: { reserveId: "r1", denNgay: new Date("2026-05-10T03:00:00Z") } });
  h.fn.tuChoi.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.fn.khoiPhuc.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.fn.baoChoDuyet.mockResolvedValue(1);
  h.fn.baoKetQua.mockResolvedValue(1);
});

const TAT_CA = async () => [
  await lienHeBaoLuuAction({ ...ID, ghiChu: "gọi phụ huynh" }),
  await thongBaoChinhThucAction({ ...ID, kenh: "ZNS" }),
  await deNghiGiaHanAction({ ...ID, denNgay: "2026-05-10", lyDo: "xin thêm một tháng" }),
  await duyetGiaHanAction(ID),
  await tuChoiGiaHanAction({ ...ID, lyDo: "chưa đủ minh chứng" }),
  await khoiPhucBaoLuuAction({ ...ID, denNgay: "2026-05-10", lyDo: "BGĐ cho phép khôi phục" }),
];

describe("[BL5-ACT] cổng của Server Action vòng đời bảo lưu", () => {
  it("[BL5-ACT-01] chưa đăng nhập ⇒ cả sáu action từ chối, dịch vụ không được gọi", async () => {
    h.dangNhap = false;
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve", "bao-luu:extend", "bao-luu:exception"]);
    for (const r of await TAT_CA()) expect(r).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    chuaGoi();
  });

  it("[BL5-ACT-02] thiếu quyền ⇒ từ chối: liên hệ cần create|approve · thông báo CHÍNH THỨC cần approve (create KHÔNG đủ) · duyệt gia hạn cần extend · khôi phục cần exception", async () => {
    h.quyen = new Set(["bao-luu:view"]);
    for (const r of await TAT_CA()) expect(r.ok).toBe(false);
    chuaGoi();

    h.quyen = new Set(["bao-luu:create"]); // người lập: liên hệ + đề nghị gia hạn được, còn lại KHÔNG
    expect((await thongBaoChinhThucAction({ ...ID, kenh: "ZNS" })).ok).toBe(false);
    expect((await duyetGiaHanAction(ID)).ok).toBe(false);
    expect((await khoiPhucBaoLuuAction({ ...ID, denNgay: "2026-05-10", lyDo: "BGĐ cho phép khôi phục" })).ok).toBe(false);
    expect(h.fn.thongBao).not.toHaveBeenCalled();
    expect(h.fn.duyet).not.toHaveBeenCalled();
    expect(h.fn.khoiPhuc).not.toHaveBeenCalled();
    expect((await lienHeBaoLuuAction({ ...ID, ghiChu: "gọi phụ huynh" })).ok).toBe(true);
    expect((await deNghiGiaHanAction({ ...ID, denNgay: "2026-05-10", lyDo: "xin thêm một tháng" })).ok).toBe(true);

    h.quyen = new Set(["bao-luu:approve"]); // QLCS không có exception ⇒ không khôi phục được
    expect((await khoiPhucBaoLuuAction({ ...ID, denNgay: "2026-05-10", lyDo: "BGĐ cho phép khôi phục" })).ok).toBe(false);
    expect(h.fn.khoiPhuc).not.toHaveBeenCalled();
  });

  it("[BL5-ACT-03] IDOR: hồ sơ NGOÀI tầm nhìn cơ sở (scopedDb trả null) ⇒ 'không tìm thấy', dịch vụ không được gọi", async () => {
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve", "bao-luu:extend", "bao-luu:exception"]);
    h.hoSo = null;
    for (const r of await TAT_CA()) expect(r).toMatchObject({ ok: false, error: "Không tìm thấy hồ sơ bảo lưu" });
    chuaGoi();
  });

  it("[BL5-ACT-04] vượt trần tổng thời gian: có lý do mà thiếu `bao-luu:exception` ⇒ TỪ CHỐI rõ ràng; có quyền ⇒ chuyển xuống dịch vụ", async () => {
    h.quyen = new Set(["bao-luu:create"]);
    const r = await deNghiGiaHanAction({ ...ID, denNgay: "2026-05-10", lyDo: "xin thêm một tháng", vuotTranLyDo: "ca đặc biệt" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("Quản trị tối cao") });
    expect(h.fn.deNghi).not.toHaveBeenCalled();
    h.quyen = new Set(["bao-luu:create", "bao-luu:exception"]);
    expect((await deNghiGiaHanAction({ ...ID, denNgay: "2026-05-10", lyDo: "xin thêm một tháng", vuotTranLyDo: "ca đặc biệt" })).ok).toBe(true);
    expect(h.fn.deNghi).toHaveBeenCalledWith(expect.objectContaining({ vuotTranLyDo: "ca đặc biệt" }), expect.anything(), expect.any(Date));
  });

  it("[BL5-ACT-05] từ chối đề nghị gia hạn: người có `extend` từ chối được; người KHÔNG có `extend` chỉ rút được đề nghị của CHÍNH MÌNH", async () => {
    h.hoSo = HS({ extendRequest: { requestedById: "nguoi-khac" } });
    h.quyen = new Set(["bao-luu:create"]);
    expect(await tuChoiGiaHanAction({ ...ID, lyDo: "chưa đủ minh chứng" })).toMatchObject({ ok: false });
    expect(h.fn.tuChoi).not.toHaveBeenCalled();

    h.hoSo = HS({ extendRequest: { requestedById: "u-toi" } });
    expect((await tuChoiGiaHanAction({ ...ID, lyDo: "tôi rút đề nghị này" })).ok).toBe(true);
    expect(h.fn.tuChoi).toHaveBeenCalledTimes(1);

    h.fn.tuChoi.mockClear();
    h.hoSo = HS({ extendRequest: { requestedById: "nguoi-khac" } });
    h.quyen = new Set(["bao-luu:extend"]);
    expect((await tuChoiGiaHanAction({ ...ID, lyDo: "chưa đủ minh chứng" })).ok).toBe(true);
    expect(h.fn.tuChoi).toHaveBeenCalledTimes(1);
  });

  it("[BL5-ACT-06] đủ quyền ⇒ dịch vụ được gọi và chuông báo đúng; ngày sai định dạng / lý do ngắn bị chặn trước dịch vụ", async () => {
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve", "bao-luu:extend", "bao-luu:exception"]);
    for (const r of await TAT_CA()) expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.fn.baoChoDuyet).toHaveBeenCalledTimes(1); // đề nghị gia hạn ⇒ báo QLCS
    expect(h.fn.baoKetQua).toHaveBeenCalledTimes(2); // duyệt + từ chối

    for (const f of dichVu()) f.mockClear();
    expect((await deNghiGiaHanAction({ ...ID, denNgay: "2026-13-45", lyDo: "xin thêm một tháng" })).ok).toBe(false);
    expect((await deNghiGiaHanAction({ ...ID, denNgay: "2026-05-10", lyDo: "ko" })).ok).toBe(false);
    expect((await khoiPhucBaoLuuAction({ ...ID, denNgay: "2026-05-10", lyDo: "ngắn" })).ok).toBe(false);
    expect((await lienHeBaoLuuAction({ ...ID, ghiChu: "ko" })).ok).toBe(false);
    chuaGoi();
  });

  it("[BL5-ACT-07] dịch vụ từ chối ⇒ action trả ĐÚNG câu của dịch vụ và KHÔNG báo chuông kết quả", async () => {
    h.quyen = new Set(["bao-luu:extend"]);
    h.fn.duyet.mockResolvedValue({ ok: false, loi: ["Bạn không được duyệt đề nghị gia hạn của chính mình."] });
    expect(await duyetGiaHanAction(ID)).toEqual({ ok: false, error: "Bạn không được duyệt đề nghị gia hạn của chính mình." });
    expect(h.fn.baoKetQua).not.toHaveBeenCalled();
  });
});
