// @vitest-environment node
// [BL3-ACT] Server Action của module Bảo lưu: đăng nhập → ĐÚNG quyền → tầm nhìn cơ sở → mới gọi dịch vụ.
//
// Dịch vụ (`lib/bao-luu/dich-vu.ts`) bị giả: luật nghiệp vụ đã có 29 ca Postgres ở `tests/finance/bao-luu-hoso.test.ts`.
// Ở đây chỉ khẳng định THỨ TỰ CỔNG của lớp mỏng: thiếu quyền / ngoài tầm nhìn thì dịch vụ KHÔNG được gọi — vì dịch vụ ghi
// bằng `db` trần (scopedDb không che write), nên lớp này là cổng IDOR duy nhất.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  quyen: new Set<string>(),
  dangNhap: true,
  hocVien: { id: "hv1" } as { id: string } | null,
  hoSo: { id: "r1", centerId: "cs1", createdByUserId: "nguoi-lap", studentId: "hv1", student: { name: "An" }, enrollment: null } as unknown,
  lap: vi.fn(),
  duyet: vi.fn(),
  tuChoi: vi.fn(),
  huy: vi.fn(),
  baoChoDuyet: vi.fn(async () => 1),
  baoDaDuyet: vi.fn(async () => 1),
  baoTuChoi: vi.fn(async () => 1),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/bao-luu/feature", () => ({ laBaoLuuBat: vi.fn(async () => true) }));
vi.mock("@/lib/finance/bao-luu-tien", () => ({ apDungDoiHanBaoLuu: vi.fn(async () => ({ ok: true, soNgay: 0, soDotDaDoi: 0, donDaCham: [], donCoChuaBatCo: 0 })) }));
vi.mock("@/lib/auth", () => ({ auth: async () => (h.dangNhap ? { user: { id: "u-toi", name: "Tôi" } } : null) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (a: string) => h.quyen.has(a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ id: "u-toi" }) }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    student: { findFirst: async () => h.hocVien },
    studentReserve: { findUnique: async () => h.hoSo },
    user: { findMany: async () => [] },
  }),
}));
vi.mock("@/lib/bao-luu/dich-vu", () => ({ lapHoSo: h.lap, duyetHoSo: h.duyet, tuChoiHoSo: h.tuChoi, huyHoSo: h.huy }));
vi.mock("@/lib/bao-luu/thong-bao", () => ({
  baoChoDuyet: h.baoChoDuyet, baoDaDuyet: h.baoDaDuyet, baoTuChoi: h.baoTuChoi, baoGiaHanChoDuyet: vi.fn(), baoGiaHanKetQua: vi.fn(),
}));
// Phiên 5: `_actions.ts` còn nạp dịch vụ vòng đời — giả cả cụm để file này không kéo `getSetting` → `next/cache`.
vi.mock("@/lib/bao-luu/vong-doi", () => ({
  KENH_THONG_BAO: ["ZNS", "EMAIL", "THU_TAY"],
  ghiLienHe: vi.fn(), ghiThongBaoChinhThuc: vi.fn(), deNghiGiaHan: vi.fn(), duyetGiaHan: vi.fn(), tuChoiGiaHan: vi.fn(), khoiPhuc: vi.fn(),
}));

// Phiên 6: ba dịch vụ mới (phục học · tạm dừng lớp · yêu cầu hoàn) — giả để file này không kéo `getSetting` → `next/cache`.
vi.mock("@/lib/bao-luu/phuc-hoc-db", () => ({ baoPhucHoc: vi.fn(), chuyenSangTrungTam: vi.fn(), goiYLopPhucHoc: vi.fn(), phucHoc: vi.fn() }));
vi.mock("@/lib/bao-luu/tam-dung-lop", () => ({ tamDungLop: vi.fn() }));
vi.mock("@/lib/bao-luu/yeu-cau-hoan", () => ({ sinhYeuCauHoan: vi.fn() }));

import { lapBaoLuuAction, duyetBaoLuuAction, tuChoiBaoLuuAction, huyBaoLuuAction } from "./_actions";

const LAP = {
  studentId: "hv1",
  enrollmentIds: ["gd1"],
  reasonCode: "FAMILY" as const,
  reasonNote: "",
  expectedReturnDate: null,
  firstAbsentDate: null,
  applicationFileKey: "bao-luu/2026-10/aaaaaaaa11111111.pdf",
  evidenceFileKeys: [],
};
const LY_DO = { reserveId: "r1", lyDo: "đủ năm ký tự" };

beforeEach(() => {
  h.quyen = new Set();
  h.dangNhap = true;
  h.hocVien = { id: "hv1" };
  h.hoSo = { id: "r1", centerId: "cs1", createdByUserId: "nguoi-lap", studentId: "hv1", student: { name: "An" }, enrollment: null };
  for (const f of [h.lap, h.duyet, h.tuChoi, h.huy, h.baoChoDuyet, h.baoDaDuyet, h.baoTuChoi]) f.mockReset();
  h.lap.mockResolvedValue({ ok: true, data: { reserveIds: ["r1"], canhBao: [] } });
  h.duyet.mockResolvedValue({ ok: true, data: { reserveId: "r1", startedAt: new Date("2026-10-07T03:00:00Z") } });
  h.tuChoi.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.huy.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.baoChoDuyet.mockResolvedValue(1);
  h.baoDaDuyet.mockResolvedValue(1);
  h.baoTuChoi.mockResolvedValue(1);
});

const dichVu = () => [h.lap, h.duyet, h.tuChoi, h.huy];
const chuaGoiDichVu = () => dichVu().forEach((f) => expect(f).not.toHaveBeenCalled());

describe("[BL3-ACT] cổng của Server Action bảo lưu", () => {
  it("[BL3-ACT-01] chưa đăng nhập ⇒ cả bốn action từ chối, dịch vụ không được gọi", async () => {
    h.dangNhap = false;
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve"]);
    for (const r of [await lapBaoLuuAction(LAP), await duyetBaoLuuAction({ reserveId: "r1", lui: false }), await tuChoiBaoLuuAction(LY_DO), await huyBaoLuuAction(LY_DO)]) {
      expect(r).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    }
    chuaGoiDichVu();
  });

  it("[BL3-ACT-02] thiếu quyền ⇒ từ chối: lập cần create; duyệt/từ chối cần approve (create KHÔNG đủ); huỷ cần create hoặc approve", async () => {
    h.quyen = new Set(["bao-luu:view"]);
    expect((await lapBaoLuuAction(LAP)).ok).toBe(false);
    expect((await duyetBaoLuuAction({ reserveId: "r1", lui: false })).ok).toBe(false);
    expect((await tuChoiBaoLuuAction(LY_DO)).ok).toBe(false);
    expect((await huyBaoLuuAction(LY_DO)).ok).toBe(false);

    h.quyen = new Set(["bao-luu:create"]); // người lập KHÔNG được duyệt/từ chối dù có quyền lập
    expect((await duyetBaoLuuAction({ reserveId: "r1", lui: false })).ok).toBe(false);
    expect((await tuChoiBaoLuuAction(LY_DO)).ok).toBe(false);
    chuaGoiDichVu();

    h.quyen = new Set(["bao-luu:approve"]); // người duyệt KHÔNG được lập
    expect((await lapBaoLuuAction(LAP)).ok).toBe(false);
    chuaGoiDichVu();
  });

  it("[BL3-ACT-03] đối chứng dương: đủ quyền ⇒ dịch vụ ĐƯỢC gọi và chuông báo đúng người", async () => {
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve"]);
    const lap = await lapBaoLuuAction(LAP);
    expect(lap).toMatchObject({ ok: true, ids: ["r1"] });
    expect(h.baoChoDuyet).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "u-toi");

    expect((await duyetBaoLuuAction({ reserveId: "r1", lui: true })).ok).toBe(true);
    expect(h.duyet).toHaveBeenCalledWith({ reserveId: "r1", lui: true, ghiChu: null }, { id: "u-toi", name: "Tôi" }, expect.any(Date));
    expect(h.baoDaDuyet).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "nguoi-lap", "07/10/2026");

    expect((await tuChoiBaoLuuAction(LY_DO)).ok).toBe(true);
    expect(h.baoTuChoi).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "nguoi-lap", "đủ năm ký tự");
  });

  it("[BL3-ACT-04] IDOR: học viên / hồ sơ NGOÀI tầm nhìn cơ sở (scopedDb trả null) ⇒ 'không tìm thấy', dịch vụ không được gọi", async () => {
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve"]);
    h.hocVien = null;
    h.hoSo = null;
    expect(await lapBaoLuuAction(LAP)).toMatchObject({ ok: false, error: "Không tìm thấy học viên" });
    expect(await duyetBaoLuuAction({ reserveId: "r1", lui: false })).toMatchObject({ ok: false, error: "Không tìm thấy hồ sơ bảo lưu" });
    expect((await tuChoiBaoLuuAction(LY_DO)).ok).toBe(false);
    expect((await huyBaoLuuAction(LY_DO)).ok).toBe(false);
    chuaGoiDichVu();
  });

  it("[BL3-ACT-05] huỷ: người chỉ có create chỉ huỷ được hồ sơ của CHÍNH MÌNH; người duyệt huỷ được của ai trong tầm nhìn", async () => {
    h.quyen = new Set(["bao-luu:create"]);
    expect(await huyBaoLuuAction(LY_DO)).toMatchObject({ ok: false, error: "Bạn chỉ huỷ được hồ sơ do chính bạn lập" });
    expect(h.huy).not.toHaveBeenCalled();

    h.hoSo = { id: "r1", centerId: "cs1", createdByUserId: "u-toi", studentId: "hv1", student: { name: "An" }, enrollment: null };
    expect((await huyBaoLuuAction(LY_DO)).ok).toBe(true);
    expect(h.huy).toHaveBeenCalledTimes(1);

    h.huy.mockClear();
    h.hoSo = { id: "r1", centerId: "cs1", createdByUserId: "nguoi-lap", studentId: "hv1", student: { name: "An" }, enrollment: null };
    h.quyen = new Set(["bao-luu:approve"]);
    expect((await huyBaoLuuAction(LY_DO)).ok).toBe(true);
    expect(h.huy).toHaveBeenCalledTimes(1);
  });

  it("[BL3-ACT-06] vượt trần thời hạn: có lý do mà thiếu `bao-luu:exception` ⇒ TỪ CHỐI rõ ràng (không lặng lẽ bỏ qua); có quyền ⇒ chuyển xuống dịch vụ", async () => {
    h.quyen = new Set(["bao-luu:create"]);
    expect(await lapBaoLuuAction({ ...LAP, vuotTranLyDo: "ca đặc biệt" })).toMatchObject({ ok: false, error: expect.stringContaining("Quản trị tối cao") });
    expect(h.lap).not.toHaveBeenCalled();

    h.quyen = new Set(["bao-luu:create", "bao-luu:exception"]);
    expect((await lapBaoLuuAction({ ...LAP, vuotTranLyDo: "ca đặc biệt" })).ok).toBe(true);
    expect(h.lap).toHaveBeenCalledWith(expect.objectContaining({ vuotTran: { lyDo: "ca đặc biệt" } }), expect.anything(), expect.any(Date));

    h.lap.mockClear();
    await lapBaoLuuAction(LAP); // không khai lý do ⇒ không bao giờ truyền vuotTran, kể cả khi CÓ quyền
    expect(h.lap).toHaveBeenCalledWith(expect.objectContaining({ vuotTran: null }), expect.anything(), expect.any(Date));
  });

  it("[BL3-ACT-07] ngày sai định dạng / lý do quá ngắn ⇒ từ chối trước khi chạm dịch vụ", async () => {
    h.quyen = new Set(["bao-luu:create", "bao-luu:approve"]);
    expect((await lapBaoLuuAction({ ...LAP, expectedReturnDate: "07/10/2026" })).ok).toBe(false);
    expect((await lapBaoLuuAction({ ...LAP, firstAbsentDate: "2026-13-45" })).ok).toBe(false);
    expect((await lapBaoLuuAction({ ...LAP, enrollmentIds: [] })).ok).toBe(false);
    expect((await tuChoiBaoLuuAction({ reserveId: "r1", lyDo: "ko" })).ok).toBe(false);
    expect((await huyBaoLuuAction({ reserveId: "r1", lyDo: "   " })).ok).toBe(false);
    chuaGoiDichVu();
  });

  it("[BL3-ACT-08] dịch vụ từ chối (maker–checker, nợ…) ⇒ action trả ĐÚNG câu của dịch vụ và KHÔNG báo chuông", async () => {
    h.quyen = new Set(["bao-luu:approve"]);
    h.duyet.mockResolvedValue({ ok: false, loi: ["Bạn không được duyệt hồ sơ của chính mình.", "Nợ quá 8 ngày."] });
    const r = await duyetBaoLuuAction({ reserveId: "r1", lui: false });
    expect(r).toEqual({ ok: false, error: "Bạn không được duyệt hồ sơ của chính mình.\nNợ quá 8 ngày." });
    expect(h.baoDaDuyet).not.toHaveBeenCalled();
  });
});
