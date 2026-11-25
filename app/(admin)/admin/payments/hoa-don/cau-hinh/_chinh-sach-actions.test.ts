// Ca [CSA-*] — cổng của các action chính sách hoá đơn có phiên bản (lát S7, Invoice Hub). Thứ cần đo: người KHÔNG đúng phạm vi / không đúng vai thì
// KHÔNG chạm tầng ghi; đúng người thì chạm, với đúng tham số. Ca [CSA-W*] là lưới ghim mã nguồn (neo vào LỜI GỌI, đếm SỐ LẦN, bỏ chú thích).
// Dịch vụ ghi đã được đo trên Postgres thật ở `tests/finance/hoa-don-chinh-sach-db.test.ts`; ở đây dịch vụ là giả.
import { readFileSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  auth: vi.fn(async () => ({ user: { id: "u1", name: "Kế toán A" } }) as unknown),
  checkPermission: vi.fn(async (_k: string) => true),
  resolveActor: vi.fn(),
  revalidatePath: vi.fn(),
  taoNhap: vi.fn(),
  guiDuyet: vi.fn(),
  duyet: vi.fn(),
  tuChoi: vi.fn(),
  hetHieuLuc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHubChinhSachBat: h.bat }));
vi.mock("@/lib/finance/hoa-don/chinh-sach-db", () => ({
  taoNhap: h.taoNhap,
  guiDuyet: h.guiDuyet,
  duyet: h.duyet,
  tuChoi: h.tuChoi,
  hetHieuLuc: h.hetHieuLuc,
}));

import {
  duyetChinhSachAction,
  guiDuyetChinhSachAction,
  hetHieuLucChinhSachAction,
  taoNhapChinhSachAction,
  tuChoiChinhSachAction,
} from "./_chinh-sach-actions";

const quyen = (centerScope: "ALL" | string[]) => ({ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope });
const actor = (centerScope: "ALL" | string[] | null): Actor =>
  ({ userId: "u1", isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: centerScope === null ? [] : [quyen(centerScope)] }) as unknown as Actor;

const OK = { ok: true as const, id: "cs1", phienBan: 1, trangThai: "NHAP" as const };
const NOI_DUNG = { anhXaThue: [], thoiDiemLap: "DO_KE_TOAN_CHOT" };
const TAO = { phapNhanMa: "NEW_VISION", centerId: "cs1", hieuLucTu: "2026-07-01", hieuLucDen: null, noiDung: NOI_DUNG, lyDo: "Đã soát cùng kế toán" };

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.auth.mockResolvedValue({ user: { id: "u1", name: "Kế toán A" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue(actor(["cs1"]));
  for (const f of [h.taoNhap, h.guiDuyet, h.duyet, h.tuChoi, h.hetHieuLuc]) f.mockResolvedValue(OK);
});

const dichVu = () => [h.taoNhap, h.guiDuyet, h.duyet, h.tuChoi, h.hetHieuLuc];
const khongChamDichVu = () => dichVu().forEach((f) => expect(f).not.toHaveBeenCalled());

describe("[CSA-01] cổng chung: cờ → đăng nhập → payments:confirm", () => {
  const CAC = [
    ["tạo nháp", () => taoNhapChinhSachAction(TAO)],
    ["gửi duyệt", () => guiDuyetChinhSachAction({ id: "a", lyDo: "Đã soát cùng kế toán" })],
    ["duyệt", () => duyetChinhSachAction({ id: "a", lyDo: "Đã soát cùng kế toán", hashMoPhong: "h" })],
    ["từ chối", () => tuChoiChinhSachAction({ id: "a", lyDo: "Chưa đúng phạm vi" })],
    ["kết thúc", () => hetHieuLucChinhSachAction({ id: "a", lyDo: "Thay phiên bản mới", ngayKetThuc: "2026-12-31" })],
  ] as const;
  it.each(CAC)("%s: cờ TẮT ⇒ từ chối, không hỏi phiên, không chạm dịch vụ", async (_t, chay) => {
    h.bat.mockResolvedValue(false);
    h.resolveActor.mockResolvedValue(actor("ALL"));
    expect(await chay()).toMatchObject({ ok: false, error: expect.stringMatching(/chưa được bật/) });
    expect(h.auth).not.toHaveBeenCalled();
    khongChamDichVu();
  });
  it.each(CAC)("%s: chưa đăng nhập ⇒ từ chối", async (_t, chay) => {
    h.auth.mockResolvedValue(null);
    expect(await chay()).toEqual({ ok: false, error: "Chưa đăng nhập" });
    khongChamDichVu();
  });
  it.each(CAC)("%s: thiếu payments:confirm ⇒ từ chối", async (_t, chay) => {
    h.checkPermission.mockResolvedValue(false);
    h.resolveActor.mockResolvedValue(actor("ALL"));
    expect(await chay()).toMatchObject({ ok: false, error: expect.stringMatching(/payments:confirm/) });
    expect(h.checkPermission).toHaveBeenCalledWith("payments:confirm");
    khongChamDichVu();
  });
  it("đối chứng dương: Hội sở có đủ ⇒ cả năm action chạm dịch vụ đúng một lần", async () => {
    h.resolveActor.mockResolvedValue(actor("ALL"));
    for (const [, chay] of CAC) expect(await chay()).toMatchObject({ ok: true });
    dichVu().forEach((f) => expect(f).toHaveBeenCalledTimes(1));
  });
});

describe("[CSA-02] tạo nháp: đúng phạm vi mới chạm dịch vụ", () => {
  it("kế toán ĐÚNG cơ sở ⇒ gọi dịch vụ với người thao tác + dữ liệu + danh sách pháp nhân hợp lệ; làm mới màn", async () => {
    expect(await taoNhapChinhSachAction(TAO)).toEqual({ ok: true, data: { id: "cs1", phienBan: 1, trangThai: "NHAP" } });
    expect(h.taoNhap).toHaveBeenCalledTimes(1);
    const a = h.taoNhap.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).toMatchObject({ ten: "Kế toán A", phapNhanMa: "NEW_VISION", centerId: "cs1", hieuLucTu: "2026-07-01", hieuLucDen: null, lyDo: "Đã soát cùng kế toán" });
    expect(a.phapNhanHopLe).toEqual(expect.arrayContaining(["NEW_VISION"]));
    expect(h.revalidatePath).toHaveBeenCalledWith("/payments/hoa-don/cau-hinh");
  });
  it("kế toán CS1 tạo cho CS2 ⇒ từ chối, KHÔNG chạm dịch vụ, không làm mới màn", async () => {
    expect(await taoNhapChinhSachAction({ ...TAO, centerId: "cs2" })).toMatchObject({ ok: false });
    khongChamDichVu();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
  it("kế toán cơ sở tạo bản DÙNG CHUNG (centerId null) ⇒ từ chối; Hội sở ⇒ ĐƯỢC (đối chứng dương)", async () => {
    expect(await taoNhapChinhSachAction({ ...TAO, centerId: null })).toMatchObject({ ok: false, error: expect.stringMatching(/Hội sở/) });
    khongChamDichVu();
    h.resolveActor.mockResolvedValue(actor("ALL"));
    expect(await taoNhapChinhSachAction({ ...TAO, centerId: null })).toMatchObject({ ok: true });
    expect(h.taoNhap).toHaveBeenCalledTimes(1);
  });
  it("người có payments:confirm ở KHÔNG cơ sở nào (scope rỗng) ⇒ từ chối", async () => {
    h.resolveActor.mockResolvedValue(actor([]));
    expect(await taoNhapChinhSachAction(TAO)).toMatchObject({ ok: false });
    khongChamDichVu();
  });
  it("payload sai hình dạng (ngày sai, thiếu lý do, id rỗng) ⇒ 'Yêu cầu không hợp lệ' trước mọi cổng", async () => {
    expect(await taoNhapChinhSachAction({ ...TAO, hieuLucTu: "01/07/2026" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(await taoNhapChinhSachAction({ ...TAO, lyDo: undefined })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(await guiDuyetChinhSachAction({ id: "", lyDo: "x" })).toEqual({ ok: false, error: "Yêu cầu không hợp lệ" });
    expect(h.auth).not.toHaveBeenCalled();
  });
});

describe("[CSA-03] duyệt / từ chối / kết thúc: CHỈ kế toán Hội sở", () => {
  const CAC = [
    ["duyệt", h.duyet, () => duyetChinhSachAction({ id: "a", lyDo: "Đã xem mô phỏng", hashMoPhong: "abc" })],
    ["từ chối", h.tuChoi, () => tuChoiChinhSachAction({ id: "a", lyDo: "Chưa đúng phạm vi" })],
    ["kết thúc", h.hetHieuLuc, () => hetHieuLucChinhSachAction({ id: "a", lyDo: "Thay phiên bản mới", ngayKetThuc: "2026-12-31" })],
  ] as const;
  it.each(CAC)("%s: kế toán CƠ SỞ ⇒ từ chối, không chạm dịch vụ; Hội sở ⇒ chạm đúng một lần (đối chứng dương)", async (_t, dv, chay) => {
    h.resolveActor.mockResolvedValue(actor(["cs1"]));
    expect(await chay()).toMatchObject({ ok: false, error: expect.stringMatching(/Hội sở/) });
    expect(dv).not.toHaveBeenCalled();
    h.resolveActor.mockResolvedValue(actor("ALL"));
    expect(await chay()).toMatchObject({ ok: true });
    expect(dv).toHaveBeenCalledTimes(1);
  });
  it("duyệt: băm mô phỏng + lý do + người thao tác đi nguyên xuống dịch vụ (client không gửi tập mẫu hay người tạo)", async () => {
    h.resolveActor.mockResolvedValue(actor("ALL"));
    await duyetChinhSachAction({ id: "a", lyDo: "Đã xem mô phỏng", hashMoPhong: "abc", nguoiTaoId: "gia-mao", tapMau: [1] });
    const a = h.duyet.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).toMatchObject({ id: "a", lyDo: "Đã xem mô phỏng", hashMoPhongUi: "abc", ten: "Kế toán A" });
    expect(a).not.toHaveProperty("nguoiTaoId");
    expect(a).not.toHaveProperty("tapMau");
  });
  it("duyệt không kèm băm (null) vẫn tới dịch vụ để dịch vụ từ chối bằng CHUA_MO_PHONG — action không tự bỏ qua", async () => {
    h.resolveActor.mockResolvedValue(actor("ALL"));
    await duyetChinhSachAction({ id: "a", lyDo: "Đã xem mô phỏng", hashMoPhong: null });
    expect((h.duyet.mock.calls[0]![0] as Record<string, unknown>).hashMoPhongUi).toBeNull();
  });
  it("dịch vụ từ chối ⇒ action trả nguyên mã + thông điệp, KHÔNG làm mới màn", async () => {
    h.resolveActor.mockResolvedValue(actor("ALL"));
    h.duyet.mockResolvedValue({ ok: false, ma: "MO_PHONG_LECH", error: "Mô phỏng bạn đã xem không còn khớp" });
    expect(await duyetChinhSachAction({ id: "a", lyDo: "Đã xem mô phỏng", hashMoPhong: "abc" })).toEqual({ ok: false, error: "Mô phỏng bạn đã xem không còn khớp", ma: "MO_PHONG_LECH" });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[CSA-04] gửi duyệt: phạm vi do DỊCH VỤ kiểm trên dòng đọc lại từ DB (action chỉ có id)", () => {
  it("action chuyển id + lý do + người thao tác; không tự suy cơ sở từ client", async () => {
    await guiDuyetChinhSachAction({ id: "a", lyDo: "Đã soát cùng kế toán", centerId: "cs-khac" });
    const a = h.guiDuyet.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).toMatchObject({ id: "a", lyDo: "Đã soát cùng kế toán", ten: "Kế toán A" });
    expect(a).not.toHaveProperty("centerId");
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ────────────────────────────────────────────────────

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(duongDan(process.cwd(), p), "utf8"));
const demLanGoi = (ma: string, re: RegExp) => (ma.match(re) ?? []).length;
const TEP_ACTION = "app/(admin)/admin/payments/hoa-don/cau-hinh/_chinh-sach-actions.ts";

describe("[CSA-W1] lưới ghim dây nối của action", () => {
  const ma = doc(TEP_ACTION);
  it("mọi action đi qua cổng chung: 5 lời gọi `await congChinhSach()`, và `checkPermission(\"payments:confirm\")` đúng 1 lời gọi (trong wrapper)", () => {
    expect(demLanGoi(ma, /\bawait\s+congChinhSach\s*\(\s*\)/g)).toBe(5);
    expect(demLanGoi(ma, /\bcheckPermission\s*\(\s*"payments:confirm"\s*\)/g)).toBe(1);
    expect(demLanGoi(ma, /\blaHubChinhSachBat\s*\(\s*\)/g)).toBe(1);
  });
  it("vị từ quyền: `duocDuyetChinhSach(` đúng 3 lần (duyệt, từ chối, kết thúc); `duocGhiChinhSach(` đúng 1 lần (tạo nháp)", () => {
    expect(demLanGoi(ma, /\bduocDuyetChinhSach\s*\(/g)).toBe(3);
    expect(demLanGoi(ma, /\bduocGhiChinhSach\s*\(/g)).toBe(1);
  });
  it("không kiểm quyền inline (so vai / so centerId) và không import db trần", () => {
    expect(ma).not.toMatch(/\.roles?\s*(?:===|!==|\.includes)/);
    expect(ma).not.toMatch(/\.centerId\s*(?:===|!==)/);
    expect(ma).not.toMatch(/from\s*"@\/lib\/db"/);
    expect(ma).not.toMatch(/\.(?:create|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  });
  it("chỉ xuất đúng năm action (không có hàm sửa cột nhạy cảm, không có hàm 'sửa bản hiệu lực')", () => {
    const ten = [...ma.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]).sort();
    expect(ten).toEqual(["duyetChinhSachAction", "guiDuyetChinhSachAction", "hetHieuLucChinhSachAction", "taoNhapChinhSachAction", "tuChoiChinhSachAction"]);
    expect(demLanGoi(ma, /\bexport\b/g)).toBe(5);
  });
  it("mỗi action gọi ĐÚNG MỘT hàm dịch vụ tương ứng, và chỉ làm mới đúng màn Cấu hình khi thành công (qua `dich`)", () => {
    for (const f of ["taoNhap", "guiDuyet", "duyet", "tuChoi", "hetHieuLuc"]) expect(demLanGoi(ma, new RegExp(`\\bawait\\s+${f}\\s*\\(`, "g")), f).toBe(1);
    expect(demLanGoi(ma, /\brevalidatePath\s*\(\s*"\/payments\/hoa-don\/cau-hinh"\s*\)/g)).toBe(1);
  });
});

describe("[CSA-W2] cột nhạy cảm của CauHinhHoaDonCoSo CHỈ-ĐỌC ở lát S7", () => {
  const NHAY_CAM = ["legalEntityId", "nhaCungCapMa", "moiTruongNcc", "loaiHoaDon", "phuongThucKy", "khoaBiMat", "chungThuHetHan", "cheDoHub"];
  it("tệp đọc riêng chỉ có `select`/`findMany`, không có phép ghi", () => {
    const ma = doc("lib/finance/hoa-don/cau-hinh-nha-cung-cap-db.ts");
    expect(ma).not.toMatch(/\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw)\s*\(/);
    for (const c of NHAY_CAM) expect(ma, c).toContain(c);
  });
  it("đường ghi cũ (`luuCauHinh`) vẫn ghi theo danh sách cột CỨNG và KHÔNG nhắc cột nhạy cảm nào", () => {
    const ma = doc("lib/finance/hoa-don/cau-hinh-co-so-db.ts");
    for (const c of NHAY_CAM) expect(ma, c).not.toContain(c);
    expect(doc("app/(admin)/admin/payments/hoa-don/cau-hinh/_actions.ts")).not.toMatch(new RegExp(NHAY_CAM.join("|")));
  });
  it("action chính sách không nhắc cột nhạy cảm nào", () => {
    expect(doc(TEP_ACTION)).not.toMatch(new RegExp(NHAY_CAM.join("|")));
  });
});
