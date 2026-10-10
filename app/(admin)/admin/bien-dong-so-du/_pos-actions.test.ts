/**
 * [POSA-*] — cổng QUYỀN của bốn Server Action import giao dịch thẻ (`_pos-actions.ts`), và
 * (từ [POSA-05], 30/09/2026 — nợ 4) VÒNG ĐỜI của một lượt import: mở lượt = ghi lô 1, không
 * bao giờ để lại lượt 0 dòng; thử lại tái dùng lượt dở; kết thúc đặt XONG / DUNG_GIUA_CHUNG.
 *
 * Vì sao có ca quyền: cấy thử bỏ `checkPermission` trong `nhapLoPosAction` lúc rà 29/09 thì
 * 87/87 ca còn lại VẪN XANH — quyền ở đầu action không có khoá nào. Phép ghi tiền thật nằm ở
 * `nhapLoPos`, nên thứ phải canh là: thiếu quyền `payments:import-pos` ⇒ bị từ chối NGAY,
 * TRƯỚC khi chạm actor / DB / `nhapLoPos`.
 *
 * Đầu vào của ca từ chối cố ý hợp lệ về mặt schema (đúng thứ một kẻ gọi thật gửi), để nếu
 * cổng quyền bị gỡ thì action chạy TIẾP tới phép ghi — chứ không dừng nhờ lỗi schema và
 * che mất lỗ hổng. Mọi module chạm DB đều được giả lập (chạy trong `pnpm test:unit`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KetQuaNhapLo } from "@/lib/payments/pos/ket-qua-lo";

type LuotGia = {
  id: string;
  importedById: string;
  trangThai: "DANG_NHAP" | "XONG" | "DUNG_GIUA_CHUNG";
  soLoTong: number;
  soLoXong: number;
};

const LUOT_MAC_DINH: LuotGia = { id: "batch_1", importedById: "u_kt", trangThai: "DANG_NHAP", soLoTong: 3, soLoXong: 1 };

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "u_kt", name: "Kế toán HO", email: "kt@x.vn" } })),
  checkPermission: vi.fn(async (_a: string) => true),
  resolveActor: vi.fn(async (_id: string) => ({ userId: "u_kt" })),
  batchCreate: vi.fn(async (_a: unknown) => ({ id: "batch_1" })),
  batchFind: vi.fn(async (_a: unknown): Promise<LuotGia | null> => null),
  batchUpdateMany: vi.fn(async (_a: unknown) => ({ count: 1 })),
  batchDeleteMany: vi.fn(async (_a: unknown) => ({ count: 1 })),
  revalidatePath: vi.fn((_p: string) => undefined),
  posFind: vi.fn(async (_a: unknown) => null),
  // GĐ3: kết quả lô mang `lech` BẮT BUỘC (action đọc nó để ghi audit) — mock trả ĐỦ hình dạng.
  nhapLoPos: vi.fn(
    async (_a: unknown): Promise<KetQuaNhapLo> => ({
      moi: 0,
      capNhat: 0,
      tuKhop: 0,
      canXuLy: 0,
      boQua: 0,
      loi: [],
      lech: [],
      soDemLuot: { moi: 0, capNhat: 0, tuKhop: 0, canXuLy: 0, boQua: 0 },
    }),
  ),
  dongCanhBao: vi.fn(async (_a: unknown) => 0),
  writeAudit: vi.fn(async (_a: unknown) => ({})),
  dongBo: vi.fn(async (_a: unknown) => ({ daKiem: 0, loi: 0 })),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/audit/log", () => ({ getAuditActor: () => ({ actorId: "u_kt", actorName: "Kế toán HO" }) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/db-scope", () => ({
  passesScope: () => true,
  scopedDb: () => ({
    posImportBatch: {
      create: h.batchCreate,
      findUnique: h.batchFind,
      updateMany: h.batchUpdateMany,
      deleteMany: h.batchDeleteMany,
    },
    posCardTransaction: { findUnique: h.posFind },
  }),
}));
vi.mock("@/lib/payments/pos/pham-vi-nhap", () => ({
  LOI_PHAM_VI_NHAP_POS: "phạm vi",
  nhapPosDuocMoiCoSo: () => true,
}));
vi.mock("@/lib/payments/pos/nhap-lo-pos", () => ({ nhapLoPos: h.nhapLoPos }));
vi.mock("@/lib/payments/pos/dong-canh-bao-pos", () => ({ dongCanhBaoHuyPos: h.dongCanhBao }));
// GĐ1 POS (06/10/2026): kết thúc lượt import đồng bộ phiếu thu thẻ — chạm DB, giả lập.
vi.mock("@/lib/payments/pos/dong-bo-sau-nhap", () => ({ dongBoPhieuPosSauNhap: h.dongBo }));

import {
  batDauNhapPosAction,
  dongCanhBaoHuyPosAction,
  ketThucNhapPosAction,
  nhapLoPosAction,
} from "./_pos-actions";

const DONG_HOP_LE = {
  maGiaoDich: "FXPOSA0000000001",
  thoiGian: "2026-09-29T03:00:00.000Z",
  loaiGiaoDich: "Thanh toán",
  trangThai: "Thành công",
  hinhThuc: "Thẻ",
  soTien: 1_234_000,
  dienGiai: "Hoc phi",
  maChuanChi: null,
  maGiaoDichThe: null,
  maGiaoDichGoc: null,
  trangThaiHoanHuy: null,
  maDonHang: null,
  maQuay: null,
  maThietBi: "FXPOSAMAY01",
  soTheMasked: null,
  loaiThe: null,
  maHachToan: null,
  phiGiaoDich: null,
};

const MO_LUOT = { tenFile: "f.xlsx", soDong: 3, soLo: 3, dong: [DONG_HOP_LE], dongHuyCuaFile: [] };
const LO_2 = { batchId: "batch_1", lo: 2, dong: [DONG_HOP_LE], dongHuyCuaFile: [] };

/** Kết quả lô RỖNG — hình dạng đầy đủ của `KetQuaNhapLo` (GĐ3 thêm `lech` + `soDemLuot` bắt buộc). */
const KQ_RONG: KetQuaNhapLo = {
  moi: 0,
  capNhat: 0,
  tuKhop: 0,
  canXuLy: 0,
  boQua: 0,
  loi: [],
  lech: [],
  soDemLuot: { moi: 0, capNhat: 0, tuKhop: 0, canXuLy: 0, boQua: 0 },
};
const kqRong = (): KetQuaNhapLo => ({ ...KQ_RONG, loi: [], lech: [], soDemLuot: { ...KQ_RONG.soDemLuot } });

async function chayBonAction() {
  return {
    batDau: await batDauNhapPosAction(MO_LUOT),
    nhapLo: await nhapLoPosAction(LO_2),
    ketThuc: await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" }),
    dongCanhBao: await dongCanhBaoHuyPosAction({ id: "pos_1", ghiChu: "Đã gỡ gắn và hoàn tiền" }),
  };
}

/** Đối số của lần gọi thứ `i` của một mock Prisma. */
function goi(m: { mock: { calls: unknown[][] } }, i = 0) {
  return m.mock.calls[i]?.[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
}

function datLai() {
  vi.clearAllMocks();
  h.checkPermission.mockResolvedValue(true);
  h.batchFind.mockResolvedValue({ ...LUOT_MAC_DINH });
  h.batchUpdateMany.mockResolvedValue({ count: 1 });
  h.batchDeleteMany.mockResolvedValue({ count: 1 });
  h.nhapLoPos.mockResolvedValue(kqRong());
  h.writeAudit.mockResolvedValue({});
}

describe("[POSA] quyền payments:import-pos ở ĐẦU bốn action import thẻ", () => {
  beforeEach(datLai);

  it("[POSA-01] thiếu quyền ⇒ cả bốn action từ chối, KHÔNG chạm actor / DB / nhapLoPos", async () => {
    h.checkPermission.mockResolvedValue(false);
    const kq = await chayBonAction();
    for (const [ten, r] of Object.entries(kq)) {
      expect(r.ok, `${ten} phải bị từ chối`).toBe(false);
      expect((r as { error: string }).error, `${ten}: lý do phải là QUYỀN, không phải lỗi schema`).toMatch(
        /Kế toán Hội sở/,
      );
    }
    expect(h.resolveActor).not.toHaveBeenCalled();
    expect(h.batchCreate).not.toHaveBeenCalled();
    expect(h.batchUpdateMany).not.toHaveBeenCalled();
    expect(h.nhapLoPos, "phép ghi tiền không được chạy khi thiếu quyền").not.toHaveBeenCalled();
    expect(h.dongCanhBao).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("[POSA-02] hỏi ĐÚNG quyền `payments:import-pos` (không quyền khác)", async () => {
    h.checkPermission.mockResolvedValue(false);
    await chayBonAction();
    expect(h.checkPermission).toHaveBeenCalledTimes(4);
    expect(new Set(h.checkPermission.mock.calls.map((c) => c[0]))).toEqual(new Set(["payments:import-pos"]));
  });

  it("[POSA-03] ĐỐI CHỨNG DƯƠNG: có quyền ⇒ lô hợp lệ đi tới nhapLoPos", async () => {
    const r = await nhapLoPosAction(LO_2);
    expect(r.ok).toBe(true);
    expect(h.nhapLoPos).toHaveBeenCalledTimes(1);
    const b = await batDauNhapPosAction(MO_LUOT);
    // GĐ3 — mock trả ĐỦ hình dạng `KetQuaLoPos` (`lech` bắt buộc); action trả nguyên kết quả lô.
    expect(b).toEqual({ ok: true, batchId: "batch_1", ketQua: KQ_RONG });
    expect(h.nhapLoPos).toHaveBeenCalledTimes(2);
  });

  it("[POSA-04] chưa đăng nhập ⇒ từ chối trước cả quyền", async () => {
    h.auth.mockResolvedValueOnce(null as never);
    const r = await nhapLoPosAction(LO_2);
    expect(r.ok).toBe(false);
    expect(h.checkPermission).not.toHaveBeenCalled();
    expect(h.nhapLoPos).not.toHaveBeenCalled();
  });
});

describe("[POSA-LUOT] vòng đời một lượt import (nợ 4 — 30/09/2026)", () => {
  beforeEach(datLai);

  it("[POSA-05] mở lượt = tạo lượt KÈM ghi lô 1 trong CÙNG action: soLoTong khai, soLoXong = 1", async () => {
    // Mã TRƯỚC bản vá: `batDauNhapPosAction({ tenFile, soDong })` chỉ tạo lượt; lô 1 gửi ở action
    // sau — lô 1 hỏng / mất mạng là để lại một lượt 0 dòng, mỗi lần thử lại thêm một.
    const r = await batDauNhapPosAction(MO_LUOT);
    expect(r.ok).toBe(true);
    expect(goi(h.batchCreate).data).toMatchObject({ tenFile: "f.xlsx", importedById: "u_kt", soLoTong: 3 });
    expect(h.nhapLoPos).toHaveBeenCalledTimes(1);
    // GĐ3 (V11, sửa CÓ CHỦ ĐÍCH): `soLoXong` + số đếm ghi trong MỘT câu có điều kiện `soLoXong < lo`
    // BÊN TRONG `nhapLoPos` — action truyền CHỈ SỐ lô, không tự ghi `soLoXong` nữa. Bản cũ ghim
    // `updateMany({ where: { soLoXong: { lt: 1 } }, data: { soLoXong: 1 } })` ở action: số đếm (cộng
    // không điều kiện trong `nhapLoPos`) vẫn cộng lần hai khi lô bị gửi lại.
    expect(h.nhapLoPos.mock.calls[0]?.[0]).toMatchObject({ batchId: "batch_1", nguoiNhapId: "u_kt", lo: 1 });
    expect(h.batchUpdateMany, "action không tự ghi soLoXong").not.toHaveBeenCalled();
    expect(h.revalidatePath, "không làm mới trang giữa lượt").not.toHaveBeenCalled();
  });

  it("[POSA-06] lô 1 ném lỗi ⇒ XOÁ lượt vừa tạo (không để lại lượt 0 dòng), lỗi vẫn nổi lên", async () => {
    h.nhapLoPos.mockRejectedValueOnce(new Error("mất kết nối DB"));
    await expect(batDauNhapPosAction(MO_LUOT)).rejects.toThrow("mất kết nối DB");
    expect(h.batchDeleteMany).toHaveBeenCalledTimes(1);
    expect(goi(h.batchDeleteMany).where).toEqual({ id: "batch_1", soLoXong: 0 });
  });

  it("[POSA-06b] xoá lượt thất bại (đã có dòng POS trỏ vào — khoá ngoại) ⇒ KHÔNG che lỗi gốc", async () => {
    h.nhapLoPos.mockRejectedValueOnce(new Error("lỗi gốc"));
    h.batchDeleteMany.mockRejectedValueOnce(new Error("P2003 foreign key"));
    await expect(batDauNhapPosAction(MO_LUOT)).rejects.toThrow("lỗi gốc");
  });

  it("[POSA-07] lô 1 rỗng / soLo không hợp lệ ⇒ từ chối TRƯỚC khi tạo lượt", async () => {
    const cacCa = [
      { ...MO_LUOT, dong: [] },
      { ...MO_LUOT, soLo: 0 },
      { ...MO_LUOT, soDong: 2, soLo: 3 },
    ];
    for (const sai of cacCa) {
      const r = await batDauNhapPosAction(sai);
      expect(r.ok, JSON.stringify({ soLo: sai.soLo, soDong: sai.soDong, dong: sai.dong.length })).toBe(false);
    }
    expect(h.batchCreate).not.toHaveBeenCalled();
    expect(h.nhapLoPos).not.toHaveBeenCalled();
  });

  it("[POSA-08] lô gửi vào lượt ĐÃ XONG ⇒ từ chối, không ghi gì", async () => {
    h.batchFind.mockResolvedValueOnce({ ...LUOT_MAC_DINH, trangThai: "XONG", soLoXong: 3 });
    const r = await nhapLoPosAction(LO_2);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/đã kết thúc/) });
    expect(h.nhapLoPos).not.toHaveBeenCalled();
    expect(h.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("[POSA-08b] chỉ số lô vượt số lô đã khai ⇒ từ chối", async () => {
    const r = await nhapLoPosAction({ ...LO_2, lo: 4 });
    expect(r.ok).toBe(false);
    expect(h.nhapLoPos).not.toHaveBeenCalled();
  });

  it("[POSA-08c] lượt của NGƯỜI KHÁC ⇒ 'Không tìm thấy lượt import' ở cả nhapLo lẫn ketThuc", async () => {
    h.batchFind.mockResolvedValue({ ...LUOT_MAC_DINH, importedById: "u_khac" });
    expect(await nhapLoPosAction(LO_2)).toEqual({ ok: false, error: "Không tìm thấy lượt import" });
    expect(await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" })).toEqual({
      ok: false,
      error: "Không tìm thấy lượt import",
    });
    expect(h.nhapLoPos).not.toHaveBeenCalled();
    expect(h.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("[POSA-09] THỬ LẠI lượt đã dừng: về DANG_NHAP TRƯỚC khi ghi lô, rồi nhapLoPos nhận đúng chỉ số lô", async () => {
    h.batchFind.mockResolvedValueOnce({ ...LUOT_MAC_DINH, trangThai: "DUNG_GIUA_CHUNG" });
    const thuTu: string[] = [];
    h.batchUpdateMany.mockImplementation(async (a: unknown) => {
      thuTu.push(`update:${JSON.stringify((a as { data: unknown }).data)}`);
      return { count: 1 };
    });
    h.nhapLoPos.mockImplementationOnce(async () => {
      thuTu.push("nhapLoPos");
      return kqRong();
    });
    const r = await nhapLoPosAction(LO_2);
    expect(r.ok).toBe(true);
    // GĐ3 (V11, sửa CÓ CHỦ ĐÍCH): không còn câu `update:{"soLoXong":2}` thứ ba ở action — `soLoXong` đi
    // cùng số đếm trong `nhapLoPos` (một câu có điều kiện). Thứ tự DANG_NHAP → nhapLoPos giữ nguyên.
    expect(thuTu).toEqual(['update:{"trangThai":"DANG_NHAP"}', "nhapLoPos"]);
    expect(goi(h.batchUpdateMany, 0).where).toEqual({ id: "batch_1", trangThai: "DUNG_GIUA_CHUNG" });
    expect(h.nhapLoPos.mock.calls[0]?.[0]).toMatchObject({ batchId: "batch_1", lo: 2 });
    expect(h.batchCreate, "thử lại KHÔNG tạo lượt mới").not.toHaveBeenCalled();
  });

  it("[POSA-09b] lượt ĐANG_NHAP bình thường ⇒ KHÔNG có phép ghi trạng thái thừa trước lô", async () => {
    await nhapLoPosAction(LO_2);
    // GĐ3 (V11): action không ghi `soLoXong` riêng ⇒ không còn phép ghi nào của action trên lượt.
    expect(h.batchUpdateMany).not.toHaveBeenCalled();
    expect(h.nhapLoPos.mock.calls[0]?.[0]).toMatchObject({ lo: 2 });
  });

  it("[POSA-10] ketThuc XONG: điều kiện chống đua đủ lô + đúng người, làm mới trang một lượt", async () => {
    h.batchFind.mockResolvedValueOnce({ ...LUOT_MAC_DINH, soLoXong: 3 });
    const r = await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(r).toEqual({ ok: true });
    const u = goi(h.batchUpdateMany);
    expect(u.where).toEqual({
      id: "batch_1",
      importedById: "u_kt",
      trangThai: { not: "XONG" },
      soLoXong: { gte: 3 },
    });
    expect(u.data).toMatchObject({ trangThai: "XONG" });
    expect(u.data.xongLuc).toBeInstanceOf(Date);
    // `lamMoi()` = hai đường của CÙNG trang (có và không có tiền tố /admin) — gọi một lần.
    expect(h.revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/admin/bien-dong-so-du", "/bien-dong-so-du"]);
  });

  it("[POSA-10b] ketThuc XONG khi còn thiếu lô (updateMany đổi 0 dòng) ⇒ từ chối, nói rõ x/y", async () => {
    h.batchFind.mockResolvedValueOnce({ ...LUOT_MAC_DINH, soLoXong: 2 });
    h.batchUpdateMany.mockResolvedValueOnce({ count: 0 });
    const r = await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/2\/3 lô/) });
  });

  it("[POSA-11] ketThuc DUNG_GIUA_CHUNG: chỉ đổi lượt đang DANG_NHAP của chính người này", async () => {
    const r = await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "DUNG_GIUA_CHUNG" });
    expect(r).toEqual({ ok: true });
    expect(goi(h.batchUpdateMany)).toEqual({
      where: { id: "batch_1", importedById: "u_kt", trangThai: "DANG_NHAP" },
      data: { trangThai: "DUNG_GIUA_CHUNG" },
    });
  });
});

describe("[POSA-POS1] kết thúc lượt import đồng bộ phiếu thu thẻ (GĐ1 POS, T11)", () => {
  beforeEach(datLai);

  it("ketThuc XONG ⇒ đồng bộ ĐÚNG MỘT lần, kèm người bấm; thiếu quyền / lượt người khác ⇒ KHÔNG đồng bộ", async () => {
    await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(h.dongBo).toHaveBeenCalledTimes(1);
    const arg = h.dongBo.mock.calls[0]![0] as { now: Date; nguoiBam: { id: string }; nguoiKiemId: string | null };
    expect(arg.now).toBeInstanceOf(Date);
    expect(arg.nguoiBam.id).toBe("u_kt");
    // GĐ2 [POS2-LOG-07]: người nhập file vào nhật ký kiểm (nguồn IMPORT).
    expect(arg.nguoiKiemId).toBe("u_kt");

    h.dongBo.mockClear();
    h.checkPermission.mockResolvedValue(false);
    await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(h.dongBo, "thiếu quyền").not.toHaveBeenCalled();

    h.checkPermission.mockResolvedValue(true);
    h.batchFind.mockResolvedValueOnce({ ...LUOT_MAC_DINH, importedById: "u_khac" });
    await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(h.dongBo, "lượt của người khác").not.toHaveBeenCalled();
  });

  it("[POSA-VA-01] ketThuc DUNG_GIUA_CHUNG ⇒ KHÔNG đồng bộ phiếu thu thẻ trên dữ liệu DỞ (dòng Hủy có thể còn ở lô chưa vào)", async () => {
    const r = await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "DUNG_GIUA_CHUNG" });
    expect(r).toEqual({ ok: true });
    expect(h.dongBo).not.toHaveBeenCalled();
    // Đối chứng dương: XONG thì có đồng bộ.
    await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(h.dongBo).toHaveBeenCalledTimes(1);
  });

  it("đồng bộ LỖI ⇒ lượt import vẫn ok + vẫn làm mới trang (lỗi chỉ vào nhật ký)", async () => {
    h.dongBo.mockRejectedValueOnce(new Error("DB chập"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await ketThucNhapPosAction({ batchId: "batch_1", ketQua: "XONG" });
    expect(r).toEqual({ ok: true });
    expect(h.revalidatePath).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GĐ3 POS (docs/pos-gd3-thiet-ke.md §1, §2.3, §5) — lối vào server + báo lệch + chỉ số lô.
// ─────────────────────────────────────────────────────────────────────────────
describe("[POS3-A] action nhập file: hợp đồng lối vào, audit lệch, chỉ số lô", () => {
  beforeEach(datLai);

  const LECH = [{ maGiaoDich: DONG_HOP_LE.maGiaoDich, truong: "soTien" as const, daGhiNhan: "2.000", trongFile: "1" }];

  it("[POS3-A-01] dòng THIẾU khoá (thiếu cột) ⇒ từ chối TRƯỚC khi tạo lượt, lỗi nêu đúng khoá", async () => {
    const { phiGiaoDich: _bo, ...thieu } = DONG_HOP_LE;
    const r = await batDauNhapPosAction({ ...MO_LUOT, dong: [thieu] });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("phiGiaoDich");
    expect(h.batchCreate, "không mở lượt").not.toHaveBeenCalled();
    expect(h.nhapLoPos).not.toHaveBeenCalled();
    const r2 = await nhapLoPosAction({ ...LO_2, dong: [thieu] });
    expect(r2.ok).toBe(false);
    expect(h.batchFind).not.toHaveBeenCalled();
    // Đối chứng dương: đủ khoá ⇒ có tạo lượt, có ghi lô.
    expect((await batDauNhapPosAction(MO_LUOT)).ok).toBe(true);
    expect(h.batchCreate).toHaveBeenCalledTimes(1);
    expect(h.nhapLoPos).toHaveBeenCalledTimes(1);
  });

  it("[POS3-A-02] thoiGian KHÔNG múi giờ ⇒ từ chối trước khi tạo lượt / trước khi đọc lượt", async () => {
    const khongMui = { ...DONG_HOP_LE, thoiGian: "2026-09-29T10:00:00" };
    const r = await batDauNhapPosAction({ ...MO_LUOT, dong: [khongMui] });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("thoiGian");
    expect(h.batchCreate).not.toHaveBeenCalled();
    const r2 = await nhapLoPosAction({ ...LO_2, dong: [khongMui] });
    expect(r2.ok).toBe(false);
    expect(h.batchFind).not.toHaveBeenCalled();
    expect(h.nhapLoPos).not.toHaveBeenCalled();
    // Đối chứng dương: cùng giờ, CÓ múi ⇒ đi tiếp.
    expect((await nhapLoPosAction({ ...LO_2, dong: [{ ...DONG_HOP_LE, thoiGian: "2026-09-29T10:00:00+07:00" }] })).ok).toBe(true);
  });

  it("[POS3-A-03] lô có LỆCH ⇒ ghi ĐÚNG MỘT dòng audit/lô; không lệch ⇒ không ghi; audit lỗi ⇒ action vẫn ok", async () => {
    for (const [ten, chay, lo] of [
      ["batDau", () => batDauNhapPosAction(MO_LUOT), 1],
      ["nhapLo", () => nhapLoPosAction(LO_2), 2],
    ] as const) {
      h.writeAudit.mockClear();
      h.nhapLoPos.mockResolvedValueOnce({ ...kqRong(), capNhat: 1, lech: LECH });
      const r = await chay();
      expect(r.ok, ten).toBe(true);
      expect(h.writeAudit, ten).toHaveBeenCalledTimes(1);
      const a = h.writeAudit.mock.calls[0]![0] as {
        module: string;
        entityType: string;
        entityId: string;
        action: string;
        newValues: { lo: number; lech: unknown };
        actor: { id: string };
      };
      expect(a).toMatchObject({
        module: "finance",
        entityType: "PosImportBatch",
        entityId: "batch_1",
        action: "POS_IMPORT_LECH_DA_GHI_NHAN",
        actor: { id: "u_kt" },
      });
      expect(a.newValues, ten).toEqual({ lo, lech: LECH });
      // Kết quả lô vẫn về màn (khối báo lệch trong panel đọc nó).
      expect((r as { ketQua: KetQuaNhapLo }).ketQua.lech, ten).toEqual(LECH);
    }

    // Không lệch ⇒ không ghi audit.
    h.writeAudit.mockClear();
    await batDauNhapPosAction(MO_LUOT);
    await nhapLoPosAction(LO_2);
    expect(h.writeAudit).not.toHaveBeenCalled();

    // Ghi audit LỖI ⇒ lô đã ghi xong rồi, action KHÔNG được báo hỏng.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.writeAudit.mockRejectedValueOnce(new Error("audit chập"));
    h.nhapLoPos.mockResolvedValueOnce({ ...kqRong(), lech: LECH });
    expect((await nhapLoPosAction(LO_2)).ok).toBe(true);
    h.writeAudit.mockRejectedValueOnce(new Error("audit chập"));
    h.nhapLoPos.mockResolvedValueOnce({ ...kqRong(), lech: LECH });
    expect((await batDauNhapPosAction(MO_LUOT)).ok).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[POS3-A-04] batDau truyền lo = 1; nhapLo truyền đúng chỉ số lô khách gửi", async () => {
    await batDauNhapPosAction(MO_LUOT);
    expect(h.nhapLoPos.mock.calls[0]?.[0]).toMatchObject({ lo: 1 });
    h.nhapLoPos.mockClear();
    h.batchFind.mockResolvedValueOnce({ ...LUOT_MAC_DINH, soLoTong: 7 });
    await nhapLoPosAction({ ...LO_2, lo: 7 });
    expect(h.nhapLoPos.mock.calls[0]?.[0]).toMatchObject({ batchId: "batch_1", lo: 7 });
  });
});
