// @vitest-environment node
// [BL6-ACT] Cổng của Server Action Phiên 6 (báo phục học · gợi ý lớp · xếp phục học · tạm dừng cả lớp · chuyển Trung tâm · yêu cầu hoàn):
// đăng nhập → ĐÚNG quyền → tầm nhìn cơ sở (hồ sơ VÀ lớp đích) → mới gọi dịch vụ. Luật nghiệp vụ đã có 21 ca Postgres ở `tests/finance/bao-luu-p6.test.ts`.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  quyen: new Set<string>(),
  dangNhap: true,
  hoSo: null as unknown,
  lop: { id: "lop1" } as { id: string } | null,
  fn: { bao: vi.fn(), goiY: vi.fn(), phucHoc: vi.fn(), tamDung: vi.fn(), trungTam: vi.fn(), hoan: vi.fn(), doiHan: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/bao-luu/feature", () => ({ laBaoLuuBat: vi.fn(async () => true) }));
vi.mock("@/lib/finance/bao-luu-tien", () => ({ apDungDoiHanBaoLuu: (...a: unknown[]) => h.fn.doiHan(...a) }));
vi.mock("@/lib/auth", () => ({ auth: async () => (h.dangNhap ? { user: { id: "u-toi", name: "Tôi" } } : null) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (a: string) => h.quyen.has(a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ id: "u-toi" }) }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    student: { findFirst: async () => ({ id: "hv1" }) },
    studentReserve: { findUnique: async () => h.hoSo },
    class: { findFirst: async () => h.lop },
    user: { findMany: async () => [] },
  }),
}));
vi.mock("@/lib/bao-luu/dich-vu", () => ({ lapHoSo: vi.fn(), duyetHoSo: vi.fn(), tuChoiHoSo: vi.fn(), huyHoSo: vi.fn() }));
vi.mock("@/lib/bao-luu/thong-bao", () => ({ baoChoDuyet: vi.fn(), baoDaDuyet: vi.fn(), baoTuChoi: vi.fn(), baoGiaHanChoDuyet: vi.fn(), baoGiaHanKetQua: vi.fn() }));
vi.mock("@/lib/bao-luu/vong-doi", () => ({
  KENH_THONG_BAO: ["ZNS", "EMAIL", "THU_TAY"],
  ghiLienHe: vi.fn(), ghiThongBaoChinhThuc: vi.fn(), deNghiGiaHan: vi.fn(), duyetGiaHan: vi.fn(), tuChoiGiaHan: vi.fn(), khoiPhuc: vi.fn(),
}));
vi.mock("@/lib/bao-luu/phuc-hoc-db", () => ({
  baoPhucHoc: (...a: unknown[]) => h.fn.bao(...a),
  goiYLopPhucHoc: (...a: unknown[]) => h.fn.goiY(...a),
  phucHoc: (...a: unknown[]) => h.fn.phucHoc(...a),
  chuyenSangTrungTam: (...a: unknown[]) => h.fn.trungTam(...a),
}));
vi.mock("@/lib/bao-luu/tam-dung-lop", () => ({ tamDungLop: (...a: unknown[]) => h.fn.tamDung(...a) }));
vi.mock("@/lib/bao-luu/yeu-cau-hoan", () => ({ sinhYeuCauHoan: (...a: unknown[]) => h.fn.hoan(...a) }));

import {
  baoPhucHocAction, goiYLopPhucHocAction, phucHocAction, tamDungLopAction, chuyenSangTrungTamAction, sinhYeuCauHoanAction,
} from "./_actions";

const HS = { id: "r1", centerId: "cs1", createdByUserId: "nguoi-lap", studentId: "hv1", student: { name: "An" }, enrollment: null };
const ID = { reserveId: "r1" };
const chuaGoi = () => {
  for (const [k, f] of Object.entries(h.fn)) if (k !== "doiHan") expect(f, k).not.toHaveBeenCalled();
};
const TAT_CA = async () => [
  await baoPhucHocAction({ ...ID, ghiChu: "phụ huynh gọi báo" }),
  await goiYLopPhucHocAction(ID),
  await phucHocAction({ ...ID, lopMoiId: "lop1" }),
  await tamDungLopAction({ classId: "lop1", ngayMoLai: null, lyDo: "giáo viên nghỉ đột xuất" }),
  await chuyenSangTrungTamAction({ ...ID, lyDo: "không có lớp phù hợp" }),
  await sinhYeuCauHoanAction({ ...ID, lyDo: "lớp ngừng hẳn" }),
];
const TAT_CA_QUYEN = ["bao-luu:create", "bao-luu:approve", "bao-luu:center-pause", "bao-luu:refund-request"];

beforeEach(() => {
  h.quyen = new Set();
  h.dangNhap = true;
  h.hoSo = HS;
  h.lop = { id: "lop1" };
  for (const f of Object.values(h.fn)) f.mockReset();
  h.fn.bao.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.fn.goiY.mockResolvedValue({ ok: true, data: { dungOBai: 20, dungSai: 2, lop: [] } });
  h.fn.phucHoc.mockResolvedValue({ ok: true, data: { huong: "KHOP", soBuoiBuDaSinh: 0, thieuBuoiBu: 0 } });
  h.fn.tamDung.mockResolvedValue({ ok: true, data: { soHocVien: 1, reserveIds: ["r9"], boQua: [] } });
  h.fn.trungTam.mockResolvedValue({ ok: true, data: { reserveId: "r1" } });
  h.fn.hoan.mockResolvedValue({ ok: true, data: { soTien: 7_000_000, biKepVeSoDaThu: false } });
  h.fn.doiHan.mockResolvedValue({ ok: true, soNgay: 0, soDotDaDoi: 0, donDaCham: [], donCoChuaBatCo: 0 });
});

describe("[BL6-ACT] cổng của Server Action phục học · tạm dừng lớp · yêu cầu hoàn", () => {
  it("[BL6-ACT-01] chưa đăng nhập ⇒ cả sáu action từ chối, dịch vụ không được gọi", async () => {
    h.dangNhap = false;
    h.quyen = new Set(TAT_CA_QUYEN);
    for (const r of await TAT_CA()) expect(r).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    chuaGoi();
  });

  it("[BL6-ACT-02] chỉ có `bao-luu:view` ⇒ cả sáu từ chối", async () => {
    h.quyen = new Set(["bao-luu:view"]);
    for (const r of await TAT_CA()) expect(r.ok).toBe(false);
    chuaGoi();
  });

  it("[BL6-ACT-03] từng quyền một: XẾP phục học + chuyển Trung tâm cần approve (create KHÔNG đủ) · tạm dừng lớp cần center-pause · hoàn cần refund-request; báo/gợi ý nhận create HOẶC approve", async () => {
    h.quyen = new Set(["bao-luu:create"]);
    expect((await phucHocAction({ ...ID, lopMoiId: "lop1" })).ok).toBe(false);
    expect((await chuyenSangTrungTamAction({ ...ID, lyDo: "không có lớp phù hợp" })).ok).toBe(false);
    expect((await tamDungLopAction({ classId: "lop1", ngayMoLai: null, lyDo: "giáo viên nghỉ đột xuất" })).ok).toBe(false);
    expect((await sinhYeuCauHoanAction({ ...ID, lyDo: "lớp ngừng hẳn" })).ok).toBe(false);
    expect(h.fn.phucHoc).not.toHaveBeenCalled();
    expect(h.fn.trungTam).not.toHaveBeenCalled();
    expect(h.fn.tamDung).not.toHaveBeenCalled();
    expect(h.fn.hoan).not.toHaveBeenCalled();
    expect((await baoPhucHocAction({ ...ID, ghiChu: "phụ huynh gọi báo" })).ok).toBe(true);
    expect((await goiYLopPhucHocAction(ID)).ok).toBe(true);

    h.quyen = new Set(["bao-luu:approve"]); // QLCS: không tạm dừng lớp / không hoàn nếu thiếu quyền riêng
    expect((await tamDungLopAction({ classId: "lop1", ngayMoLai: null, lyDo: "giáo viên nghỉ đột xuất" })).ok).toBe(false);
    expect((await sinhYeuCauHoanAction({ ...ID, lyDo: "lớp ngừng hẳn" })).ok).toBe(false);
    expect((await phucHocAction({ ...ID, lopMoiId: "lop1" })).ok).toBe(true);
    expect((await chuyenSangTrungTamAction({ ...ID, lyDo: "không có lớp phù hợp" })).ok).toBe(true);

    h.quyen = new Set(["bao-luu:center-pause"]);
    expect((await tamDungLopAction({ classId: "lop1", ngayMoLai: null, lyDo: "giáo viên nghỉ đột xuất" })).ok).toBe(true);
    h.quyen = new Set(["bao-luu:refund-request"]);
    expect((await sinhYeuCauHoanAction({ ...ID, lyDo: "lớp ngừng hẳn" })).ok).toBe(true);
  });

  it("[BL6-ACT-04] IDOR: hồ sơ NGOÀI tầm nhìn ⇒ 'không tìm thấy', dịch vụ không được gọi (5 action theo hồ sơ)", async () => {
    h.quyen = new Set(TAT_CA_QUYEN);
    h.hoSo = null;
    const rs = [
      await baoPhucHocAction({ ...ID, ghiChu: "phụ huynh gọi báo" }),
      await goiYLopPhucHocAction(ID),
      await phucHocAction({ ...ID, lopMoiId: "lop1" }),
      await chuyenSangTrungTamAction({ ...ID, lyDo: "không có lớp phù hợp" }),
      await sinhYeuCauHoanAction({ ...ID, lyDo: "lớp ngừng hẳn" }),
    ];
    for (const r of rs) expect(r).toMatchObject({ ok: false, error: "Không tìm thấy hồ sơ bảo lưu" });
    chuaGoi();
  });

  it("[BL6-ACT-05] IDOR lớp: lớp đích NGOÀI tầm nhìn ⇒ phục học và tạm dừng cả lớp bị chặn trước dịch vụ", async () => {
    h.quyen = new Set(TAT_CA_QUYEN);
    h.lop = null;
    expect(await phucHocAction({ ...ID, lopMoiId: "lop-khac" })).toMatchObject({ ok: false, error: "Không tìm thấy lớp" });
    expect(await tamDungLopAction({ classId: "lop-khac", ngayMoLai: null, lyDo: "giáo viên nghỉ đột xuất" })).toMatchObject({ ok: false, error: "Không tìm thấy lớp" });
    chuaGoi();
  });

  it("[BL6-ACT-06] dữ liệu xấu bị chặn trước dịch vụ: lý do/ghi chú ngắn, ngày mở lại sai định dạng hoặc không có thật", async () => {
    h.quyen = new Set(TAT_CA_QUYEN);
    expect((await baoPhucHocAction({ ...ID, ghiChu: "ko" })).ok).toBe(false);
    expect((await chuyenSangTrungTamAction({ ...ID, lyDo: "ko" })).ok).toBe(false);
    expect((await sinhYeuCauHoanAction({ ...ID, lyDo: "ko" })).ok).toBe(false);
    expect((await tamDungLopAction({ classId: "lop1", ngayMoLai: null, lyDo: "ko" })).ok).toBe(false);
    expect((await tamDungLopAction({ classId: "lop1", ngayMoLai: "07/11/2026", lyDo: "giáo viên nghỉ đột xuất" })).ok).toBe(false);
    expect(await tamDungLopAction({ classId: "lop1", ngayMoLai: "2026-13-45", lyDo: "giáo viên nghỉ đột xuất" })).toMatchObject({ ok: false, error: "Ngày dự kiến mở lại không hợp lệ" });
    chuaGoi();
  });

  it("[BL6-ACT-07] tạm dừng lớp: có ngày mở lại ⇒ dời hạn đợt thu CHO TỪNG hồ sơ sau commit; không ngày ⇒ không dời; dịch vụ báo bỏ qua ⇒ hiện trong cảnh báo", async () => {
    h.quyen = new Set(["bao-luu:center-pause"]);
    h.fn.tamDung.mockResolvedValue({ ok: true, data: { soHocVien: 2, reserveIds: ["r8", "r9"], boQua: [{ studentId: "hv3", ten: "Bình", lyDo: "đã có hồ sơ mở" }] } });
    const r = await tamDungLopAction({ classId: "lop1", ngayMoLai: "2026-11-07", lyDo: "giáo viên nghỉ đột xuất" });
    expect(r.ok).toBe(true);
    expect(h.fn.doiHan.mock.calls.map((c) => (c[0] as { reserveId: string }).reserveId)).toEqual(["r8", "r9"]);
    expect(r.ok && r.canhBao?.join(" ")).toContain("Bình");

    h.fn.doiHan.mockClear();
    await tamDungLopAction({ classId: "lop1", ngayMoLai: null, lyDo: "giáo viên nghỉ đột xuất" });
    expect(h.fn.doiHan).not.toHaveBeenCalled();
  });

  it("[BL6-ACT-08] dịch vụ từ chối ⇒ lỗi chuyển nguyên cho người dùng, KHÔNG dời hạn; hoàn bị kẹp ⇒ có cảnh báo", async () => {
    h.quyen = new Set(TAT_CA_QUYEN);
    h.fn.tamDung.mockResolvedValue({ ok: false, loi: ["Khoá học không áp dụng bảo lưu"] });
    expect(await tamDungLopAction({ classId: "lop1", ngayMoLai: "2026-11-07", lyDo: "giáo viên nghỉ đột xuất" })).toMatchObject({ ok: false, error: expect.stringContaining("không áp dụng") });
    expect(h.fn.doiHan).not.toHaveBeenCalled();

    h.fn.hoan.mockResolvedValue({ ok: true, data: { soTien: 3_000_000, biKepVeSoDaThu: true } });
    const r = await sinhYeuCauHoanAction({ ...ID, lyDo: "lớp ngừng hẳn" });
    expect(r.ok && r.canhBao?.[0]).toContain("kẹp");
  });
});
