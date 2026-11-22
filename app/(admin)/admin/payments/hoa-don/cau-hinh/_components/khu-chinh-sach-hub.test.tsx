// @vitest-environment jsdom
// Ca [KCS-*] — HÀNH VI của server component `KhuChinhSachHub` (S7, Invoice Hub): chỗ NỐI actor → cờ nút, cắt mô phỏng, nhánh thiếu pháp nhân.
// Lưới `[CSUI-W1]` chỉ ĐẾM văn bản (đảo hai đối số `duocGhiChinhSach` vẫn giữ số đếm ⇒ xanh); `[CSUI-01..]` render `ChinhSachHoaDon` với cờ TỰ GÕ nên không đi qua đây.
// Ở đây gọi component THẬT (async) với vị từ quyền THẬT (`quyen.ts`), chỉ giả: tầng đọc DB, bộ giải pháp nhân, và hai component con (để bắt props).
// Mỗi ca "vai A KHÔNG thấy X" đi kèm đối chứng dương ("vai B THẤY X") — luật 12.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Actor } from "@/lib/auth/actor";
import type { DongCauHinh } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";

const h = vi.hoisted(() => ({
  phapNhan: vi.fn(),
  docDs: vi.fn(),
  docLichSu: vi.fn(),
  docMoPhong: vi.fn(),
  docTen: vi.fn(),
  docNcc: vi.fn(),
  chinhSach: [] as Array<Record<string, unknown>>,
  ncc: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/finance/hoa-don/cau-hinh-co-so", async (goc) => ({ ...(await goc<typeof import("@/lib/finance/hoa-don/cau-hinh-co-so")>()), phapNhanPhatHanhChoCoSo: h.phapNhan }));
vi.mock("@/lib/finance/hoa-don/chinh-sach-db", () => ({
  docDanhSachChinhSach: h.docDs,
  docLichSuChinhSach: h.docLichSu,
  docMoPhongChoBan: h.docMoPhong,
  docTenNguoi: h.docTen,
}));
vi.mock("@/lib/finance/hoa-don/cau-hinh-nha-cung-cap-db", () => ({ docCauHinhNhaCungCap: h.docNcc }));
vi.mock("./chinh-sach-hoa-don", () => ({
  ChinhSachHoaDon: (p: Record<string, unknown>) => {
    h.chinhSach.push(p);
    return <div data-testid="chinh-sach" />;
  },
}));
vi.mock("./nha-cung-cap-chi-doc", () => ({
  NhaCungCapChiDoc: (p: Record<string, unknown>) => {
    h.ncc.push(p);
    return <div data-testid="ncc" />;
  },
}));

import { KhuChinhSachHub } from "./khu-chinh-sach-hub";

const quyen = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL" as const, orgUnitId: "ou", roleCode: "X", centerScope });
const actor = (userId: string, scope: "ALL" | string[] | null): Actor =>
  ({ userId, isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: scope === null ? [] : [quyen(scope)] }) as unknown as Actor;
const HO = actor("u-ho", "ALL");
const CS1 = actor("u-cs1", ["cs1"]);
const KHONG_QUYEN = actor("u-x", null);

const COSO = { id: "cs1", ma: "CS1", ten: "Trụ sở" };
const dongCh = (o: Partial<DongCauHinh> & { id: string }): DongCauHinh => ({ centerId: "cs1", phapNhanMa: "NEW_VISION", kyHieu: "1C26MNV", hieuLucTu: "2026-01-01", hieuLucDen: "2026-12-31", dangBat: true, ghiChu: null, taoBoiId: "u", capNhatBoiId: "u", capNhatLuc: "2026-11-01", ...o }) as DongCauHinh;

const banDb = (id: string, trangThai: string, o: { centerId?: string | null; nguoiTaoId?: string } = {}) => ({
  id,
  phapNhanMa: "NEW_VISION",
  centerId: o.centerId === undefined ? "cs1" : o.centerId,
  phienBan: 1,
  trangThai,
  hieuLucTu: "2026-07-01",
  hieuLucDen: null,
  noiDung: {},
  nguoiTaoId: o.nguoiTaoId ?? "u-tao",
  nguoiDuyetId: null,
  lyDo: null,
  taoLuc: "2026-11-01T00:00:00.000Z",
  capNhatLuc: "2026-11-01T00:00:00.000Z",
});

const ve = async (a: Actor, dong: DongCauHinh[] = [dongCh({ id: "d1" })]) => render(await KhuChinhSachHub({ actor: a, coSo: COSO, dong, homNay: "2026-11-01" }));
const propsChinhSach = () => h.chinhSach[h.chinhSach.length - 1]!;

beforeEach(() => {
  h.chinhSach.length = 0;
  h.ncc.length = 0;
  for (const m of [h.phapNhan, h.docDs, h.docLichSu, h.docMoPhong, h.docTen, h.docNcc]) m.mockReset();
  h.phapNhan.mockReturnValue({ ok: true, phapNhan: { ma: "NEW_VISION", ten: "NEW VISION", maSoThue: "0402341070" } });
  h.docDs.mockResolvedValue([]);
  h.docLichSu.mockResolvedValue([]);
  h.docTen.mockResolvedValue({});
  h.docNcc.mockResolvedValue([]);
  h.docMoPhong.mockImplementation(async (_a: Actor, id: string) => ({ ok: true, ketQua: { xemTruoc: true }, hash: `hash-${id}`, ban: {} }));
});
afterEach(() => cleanup());

describe("[KCS-01] cờ 'được soạn' nối ĐÚNG đầu: riêng ⇄ cơ sở đang xem, chung ⇄ null (đảo hai đối số phải đỏ)", () => {
  it("kế toán CS1: được soạn bản RIÊNG, KHÔNG được soạn bản DÙNG CHUNG", async () => {
    await ve(CS1);
    expect(propsChinhSach()).toMatchObject({ coTheSoanRieng: true, coTheSoanChung: false });
  });
  it("đối chứng dương: kế toán Hội sở được cả hai", async () => {
    await ve(HO);
    expect(propsChinhSach()).toMatchObject({ coTheSoanRieng: true, coTheSoanChung: true });
  });
  it("người không có quyền kế toán: không được cả hai", async () => {
    await ve(KHONG_QUYEN);
    expect(propsChinhSach()).toMatchObject({ coTheSoanRieng: false, coTheSoanChung: false });
  });
  it("kế toán cơ sở KHÁC (CS2) xem cơ sở CS1: không được soạn riêng cho CS1 và không được soạn chung", async () => {
    await ve(actor("u-cs2", ["cs2"]));
    expect(propsChinhSach()).toMatchObject({ coTheSoanRieng: false, coTheSoanChung: false });
  });
});

describe("[KCS-02] nạp theo đúng pháp nhân + cơ sở; cờ NÚT của từng bản tính bằng đúng vị từ dùng chung", () => {
  it("đọc danh sách theo (pháp nhân của cơ sở, cơ sở); nhà cung cấp theo [cơ sở]; chỉ dòng ĐANG BẬT vào bộ giải pháp nhân", async () => {
    await ve(HO, [dongCh({ id: "bat" }), dongCh({ id: "tat", dangBat: false })]);
    expect(h.docDs).toHaveBeenCalledWith(HO, { phapNhanMa: "NEW_VISION", centerId: "cs1" });
    expect(h.docNcc).toHaveBeenCalledWith(HO, ["cs1"]);
    const doiSo = h.phapNhan.mock.calls[0]![0] as { cauHinh: Array<{ id: string }>; centerId: string; ngay: string };
    expect(doiSo.cauHinh.map((d) => d.id)).toEqual(["bat"]);
    expect(doiSo).toMatchObject({ centerId: "cs1", ngay: "2026-11-01" });
  });
  it("bản CHỜ DUYỆT: kế toán Hội sở thấy Duyệt — kể cả khi là người soạn (luật người khác duyệt đã bỏ 02/11/2026); kế toán cơ sở KHÔNG (đối chứng âm)", async () => {
    h.docDs.mockResolvedValue([banDb("b1", "CHO_DUYET")]);
    await ve(HO);
    expect((propsChinhSach().ban as Array<{ hanhDong: { duyet: boolean } }>)[0]!.hanhDong.duyet).toBe(true);
    cleanup();
    await ve(actor("u-tao", "ALL")); // chính người soạn (`banDb` mặc định nguoiTaoId = "u-tao")
    expect((propsChinhSach().ban as Array<{ hanhDong: { duyet: boolean } }>)[0]!.hanhDong.duyet).toBe(true);
    cleanup();
    await ve(CS1);
    expect((propsChinhSach().ban as Array<{ hanhDong: { duyet: boolean; lyDoKhongDuyet: string } }>)[0]!.hanhDong).toMatchObject({ duyet: false, lyDoKhongDuyet: expect.stringMatching(/Hội sở/) });
  });
});

describe("[KCS-03] cắt mô phỏng: bản CHỜ DUYỆT KHÔNG BAO GIỜ bị cắt; bản NHÁP tối đa 8", () => {
  it("12 bản nháp + 2 chờ duyệt ⇒ dựng mô phỏng cho cả 2 bản chờ duyệt và đúng 8 bản nháp", async () => {
    const nhap = Array.from({ length: 12 }, (_, i) => banDb(`n${i}`, "NHAP"));
    h.docDs.mockResolvedValue([...nhap, banDb("c1", "CHO_DUYET"), banDb("c2", "CHO_DUYET")]);
    await ve(HO);
    const ids = h.docMoPhong.mock.calls.map((c) => c[1] as string);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
    expect(ids.filter((i) => i.startsWith("n"))).toHaveLength(8);
    expect(ids).toHaveLength(10);
    const ban = propsChinhSach().ban as Array<{ id: string; moPhong: { ok: boolean; hash?: string } | null }>;
    expect(ban.find((b) => b.id === "c1")!.moPhong).toMatchObject({ ok: true, hash: "hash-c1" });
    expect(ban.find((b) => b.id === "n0")!.moPhong).not.toBeNull();
    expect(ban.find((b) => b.id === "n11")!.moPhong).toBeNull();
  });
  it("12 bản CHỜ DUYỆT ⇒ dựng đủ 12 (cắt bản chờ duyệt là vẽ ra nút Duyệt không bao giờ bật)", async () => {
    h.docDs.mockResolvedValue(Array.from({ length: 12 }, (_, i) => banDb(`c${i}`, "CHO_DUYET")));
    await ve(HO);
    expect(h.docMoPhong).toHaveBeenCalledTimes(12);
    const ban = propsChinhSach().ban as Array<{ moPhong: unknown }>;
    expect(ban.every((b) => b.moPhong !== null)).toBe(true);
  });
  it("bản đã có hiệu lực / đã kết thúc: không tốn lượt dựng mô phỏng", async () => {
    h.docDs.mockResolvedValue([banDb("h1", "HIEU_LUC"), banDb("k1", "HET_HIEU_LUC"), banDb("t1", "TU_CHOI")]);
    await ve(HO);
    expect(h.docMoPhong).not.toHaveBeenCalled();
  });
  it("mô phỏng báo lỗi cho một bản ⇒ chuyển lỗi xuống đúng bản đó, không sập khu", async () => {
    h.docDs.mockResolvedValue([banDb("c1", "CHO_DUYET")]);
    h.docMoPhong.mockResolvedValue({ ok: false, loi: ["hỏng"], ban: {} });
    await ve(HO);
    expect((propsChinhSach().ban as Array<{ moPhong: unknown }>)[0]!.moPhong).toEqual({ ok: false, loi: ["hỏng"] });
  });
});

describe("[KCS-04] thiếu pháp nhân của cơ sở ⇒ NÓI THIẾU và không nạp gì (không đoán pháp nhân — OD-01)", () => {
  it("hiện EmptyState kèm lý do, không đọc DB chính sách / nhà cung cấp, không vẽ hai khu", async () => {
    h.phapNhan.mockReturnValue({ ok: false, error: "Cơ sở CS1 chưa khai pháp nhân." });
    await ve(HO);
    expect(screen.getByText("Chưa xác định được pháp nhân của cơ sở")).toBeTruthy();
    expect(screen.getByText(/Cơ sở CS1 chưa khai pháp nhân\./)).toBeTruthy();
    expect(h.docDs).not.toHaveBeenCalled();
    expect(h.docNcc).not.toHaveBeenCalled();
    expect(h.docMoPhong).not.toHaveBeenCalled();
    expect(h.chinhSach).toHaveLength(0);
    expect(h.ncc).toHaveLength(0);
  });
  it("đối chứng dương: có pháp nhân ⇒ vẽ cả hai khu, không EmptyState", async () => {
    await ve(HO);
    expect(screen.getByTestId("chinh-sach")).toBeTruthy();
    expect(screen.getByTestId("ncc")).toBeTruthy();
    expect(screen.queryByText("Chưa xác định được pháp nhân của cơ sở")).toBeNull();
  });
});
