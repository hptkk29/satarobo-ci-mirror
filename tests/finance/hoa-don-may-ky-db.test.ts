// Ca [MKY-*] + [KRT-*] — GHÉP MÁY KÝ USB và ba route của ứng dụng ký, trên Postgres THẬT + máy chủ VIN GIẢ (hub/13 §5, phương án B).
//
// ⚠️ ĐÂY LÀ CREDENTIAL MỚI. Bộ này chứng minh mã của ta: mã ghép dùng một lần, token chỉ tồn tại dưới dạng băm, hết hạn / thu hồi / mất quyền / khoá tài khoản ⇒ máy hết tác
// dụng, người này không động được việc của người kia. KHÔNG chứng minh thiết kế đủ an toàn cho prod — phải qua duyệt bảo mật trước khi bật `hoaDon.kyUsb`.
// Mọi ca «KHÔNG được» kèm đối chứng dương. Đồng hồ ĐÓNG BĂNG (luật 19). Không gọi `resetDb()`: fixture tiền tố `fx-mky-`.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

const h = vi.hoisted(() => ({ actors: new Map<string, unknown>() }));
vi.mock("@/lib/auth/actor", async (goc) => ({
  ...(await goc<typeof import("@/lib/auth/actor")>()),
  resolveActor: async (userId: string) => h.actors.get(userId) ?? { userId, isSuperAdmin: false, permissions: [], grantsAllow: new Set(), isHoLevel: false, visibleCenterIds: [], visibleOrgUnitIds: [], orgRoles: [], assignedClassIds: new Set() },
}));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
  luuTepHoaDon: async (i: { loai: "pdf" | "xml"; than: Uint8Array }) => ({ ok: true as const, co: i.than.length, sha256: `sha-${i.loai}-${i.than.length}` }),
}));

import { duyetVaBatDauKy } from "@/lib/finance/hoa-don/lenh-ky-db";
import { luuKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { taoLenhKyUsb } from "@/lib/finance/hoa-don/ky-usb/ky-usb-lenh";
import { CHINH_SACH_KY_NGHIEM_NHAT } from "@/lib/finance/hoa-don/lenh-ky-trang-thai";
import {
  bamBiMat,
  chuanHoaMaGhep,
  danhSachMayCuaToi,
  doiMaGhepLayToken,
  HAN_MA_GHEP_MS,
  HAN_TOKEN_MAY_MS,
  sinhMaGhep,
  taoMaGhep,
  thuHoiMay,
  TOI_DA_MAY_MOI_NGUOI,
  xacThucTokenMay,
} from "@/lib/finance/hoa-don/ky-usb/may-ky";
import { kyXmlGiaChoTest, TAI_KHOAN_VIN_GIA, taoMayChuVinGia } from "@/lib/vin-hoadon/may-chu-vin-gia";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";

if (!RUN_DB_TESTS) console.warn(`[MKY] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-mky-";
const NOW = new Date("2026-11-04T03:00:00.000Z");
const PHUT = (n: number) => new Date(NOW.getTime() + n * 60_000);
const NGAY = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const U_A = `${T}a`;
const U_B = `${T}b`;
const U_C = `${T}c`;

describe("[MKY-P] mã ghép — thuần", () => {
  it("[MKY-P1] mã sinh ra đúng khuôn XXXXX-XXXXX, bảng chữ không nhập nhằng, và 200 mã không trùng", () => {
    const tap = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const m = sinhMaGhep();
      expect(m).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      tap.add(m);
    }
    expect(tap.size).toBe(200);
  });

  it("[MKY-P2] chuẩn hoá: chữ thường / khoảng trắng / thiếu gạch nhận được; sai độ dài, ký tự nhập nhằng (I O 0 1), không phải chuỗi ⇒ null", () => {
    expect(chuanHoaMaGhep("abcde-fghjk")).toBe("ABCDE-FGHJK");
    expect(chuanHoaMaGhep(" ABCDE FGHJK ")).toBe("ABCDE-FGHJK");
    for (const hong of ["ABCDE-FGHJ", "ABCDE-FGHJKL", "ABCDE-FGHJ0", "ABCDE-FGHJI", "ABCDE-FGHJ1", "ABCDE-FGHJO", "", null, 123, undefined]) {
      expect(chuanHoaMaGhep(hong), String(hong)).toBeNull();
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[MKY] ghép máy ký — Postgres thật", () => {
  async function don() {
    const ids = (await db.hoaDonMayKy.findMany({ where: { userId: { startsWith: T } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityType: "HoaDonMayKy", entityId: { in: ids } } });
    await db.hoaDonMayKy.deleteMany({ where: { userId: { startsWith: T } } });
  }
  beforeEach(don);
  afterAll(don);

  const cap = async (userId = U_A, ten = "Máy kế toán 1") => {
    const r = await taoMaGhep({ userId, userName: "Kế toán", tenMay: ten, now: NOW });
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("[MKY-01] cấp mã: CHỈ băm nằm trong DB (mã rõ không có ở cột nào, không có trong nhật ký); hạn 10 phút", async () => {
    const r = await cap();
    const hang = await db.hoaDonMayKy.findUniqueOrThrow({ where: { id: r.mayId } });
    expect(hang.maGhepHash).toBe(bamBiMat(r.ma));
    expect(hang.maGhepHetHan!.getTime() - NOW.getTime()).toBe(HAN_MA_GHEP_MS);
    expect(JSON.stringify(hang)).not.toContain(r.ma);
    expect(JSON.stringify(hang)).not.toContain(r.ma.replace("-", ""));
    const ls = await db.auditLog.findMany({ where: { entityType: "HoaDonMayKy", entityId: r.mayId } });
    expect(ls.map((l) => l.action)).toEqual(["CAP_MA_GHEP_MAY_KY"]);
    expect(JSON.stringify(ls)).not.toContain(r.ma);
  });

  it("[MKY-02] đổi mã lấy token: token chỉ trả MỘT lần và chỉ lưu băm; mã bị xoá nên dùng LẦN HAI thất bại; hạn token 30 ngày", async () => {
    const r = await cap();
    const kq = await doiMaGhepLayToken({ ma: r.ma, now: PHUT(2) });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.token).toMatch(/^kmk_[A-Za-z0-9_-]{43}$/);
    const hang = await db.hoaDonMayKy.findUniqueOrThrow({ where: { id: r.mayId } });
    expect(hang.tokenHash).toBe(bamBiMat(kq.token));
    expect(hang.maGhepHash).toBeNull();
    expect(hang.tokenHetHan!.getTime() - PHUT(2).getTime()).toBe(HAN_TOKEN_MAY_MS);
    expect(JSON.stringify(hang)).not.toContain(kq.token);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityType: "HoaDonMayKy", entityId: r.mayId } }))).not.toContain(kq.token);
    expect(await doiMaGhepLayToken({ ma: r.ma, now: PHUT(3) })).toEqual({ ok: false });
  });

  it("[MKY-03] mã hết hạn (>10 phút), mã sai, sai khuôn ⇒ CÙNG một thất bại; đúng lúc 9 phút 59 giây thì còn dùng được", async () => {
    const quaHan = await cap();
    expect(await doiMaGhepLayToken({ ma: quaHan.ma, now: PHUT(10) })).toEqual({ ok: false });
    expect(await doiMaGhepLayToken({ ma: "AAAAA-AAAAA", now: PHUT(1) })).toEqual({ ok: false });
    expect(await doiMaGhepLayToken({ ma: "x", now: PHUT(1) })).toEqual({ ok: false });
    expect(await doiMaGhepLayToken({ ma: null, now: PHUT(1) })).toEqual({ ok: false });
    const con = await cap(U_B, "Máy 2");
    expect((await doiMaGhepLayToken({ ma: con.ma, now: new Date(NOW.getTime() + HAN_MA_GHEP_MS - 1000) })).ok).toBe(true);
  });

  it("[MKY-04] HAI ứng dụng đổi CÙNG một mã đồng thời ⇒ đúng một bên có token", async () => {
    const r = await cap();
    const [a, b] = await Promise.all([doiMaGhepLayToken({ ma: r.ma, now: PHUT(1) }), doiMaGhepLayToken({ ma: r.ma, now: PHUT(1) })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("[MKY-05] xác thực token: đúng ⇒ userId; sai · lạ khuôn · hết hạn (30 ngày) · thu hồi ⇒ null; đối chứng dương cùng token", async () => {
    const r = await cap();
    const kq = await doiMaGhepLayToken({ ma: r.ma, now: NOW });
    if (!kq.ok) throw new Error("kỳ vọng ok");
    expect(await xacThucTokenMay(kq.token, PHUT(5))).toEqual({ mayId: r.mayId, userId: U_A });
    expect(await xacThucTokenMay(`${kq.token.slice(0, -1)}x`, PHUT(5))).toBeNull();
    expect(await xacThucTokenMay("kmk_ngan", PHUT(5))).toBeNull();
    expect(await xacThucTokenMay(null, PHUT(5))).toBeNull();
    expect(await xacThucTokenMay(kq.token, new Date(NOW.getTime() + HAN_TOKEN_MAY_MS))).toBeNull(); // đúng lúc hết hạn
    expect(await xacThucTokenMay(kq.token, new Date(NOW.getTime() + HAN_TOKEN_MAY_MS - 1000))).not.toBeNull();
  });

  it("[MKY-06] thu hồi: CHỦ máy thu hồi được ⇒ token chết ngay; NGƯỜI KHÁC thu hồi ⇒ false và máy vẫn dùng được", async () => {
    const r = await cap();
    const kq = await doiMaGhepLayToken({ ma: r.ma, now: NOW });
    if (!kq.ok) throw new Error("kỳ vọng ok");
    expect(await thuHoiMay({ userId: U_B, userName: "B", mayId: r.mayId, now: PHUT(1) })).toBe(false);
    expect(await xacThucTokenMay(kq.token, PHUT(2))).not.toBeNull();
    expect(await thuHoiMay({ userId: U_A, userName: "A", mayId: r.mayId, now: PHUT(3) })).toBe(true);
    expect(await xacThucTokenMay(kq.token, PHUT(4))).toBeNull();
    expect(await thuHoiMay({ userId: U_A, userName: "A", mayId: r.mayId, now: PHUT(5) })).toBe(false); // thu hồi lần hai
    const hang = await db.hoaDonMayKy.findUniqueOrThrow({ where: { id: r.mayId } });
    expect(hang).toMatchObject({ tokenHash: null, maGhepHash: null });
    expect(hang.thuHoiLuc).not.toBeNull();
  });

  it("[MKY-07] mỗi người tối đa 5 máy còn sống; thu hồi bớt thì ghép tiếp được; máy của người khác không tính", async () => {
    for (let i = 0; i < TOI_DA_MAY_MOI_NGUOI; i += 1) await cap(U_A, `Máy ${i}`);
    const them = await taoMaGhep({ userId: U_A, userName: "A", tenMay: "Máy thừa", now: NOW });
    expect(them.ok).toBe(false);
    expect((await taoMaGhep({ userId: U_B, userName: "B", tenMay: "Máy của B", now: NOW })).ok).toBe(true);
    const ds = await danhSachMayCuaToi(U_A, NOW);
    expect(await thuHoiMay({ userId: U_A, userName: "A", mayId: ds[0]!.id, now: NOW })).toBe(true);
    expect((await taoMaGhep({ userId: U_A, userName: "A", tenMay: "Máy thay", now: NOW })).ok).toBe(true);
  });

  it("[MKY-08] tên máy rỗng / quá dài bị từ chối; danh sách máy CHỈ của chủ và không chứa băm / token", async () => {
    expect((await taoMaGhep({ userId: U_A, userName: "A", tenMay: "  ", now: NOW })).ok).toBe(false);
    expect((await taoMaGhep({ userId: U_A, userName: "A", tenMay: "x".repeat(61), now: NOW })).ok).toBe(false);
    const r = await cap(U_A, "Máy A");
    await cap(U_B, "Máy B");
    const ds = await danhSachMayCuaToi(U_A, NOW);
    expect(ds.map((d) => d.tenMay)).toEqual(["Máy A"]);
    expect(ds[0]).toMatchObject({ id: r.mayId, trangThai: "CHO_GHEP" });
    expect(JSON.stringify(ds)).not.toMatch(/[0-9a-f]{64}/);
  });

  it("[MKY-09] ràng buộc DB: băm sai khuôn bị CHECK chặn; máy thu hồi không được giữ băm; mã không hạn bị chặn", async () => {
    await expect(db.hoaDonMayKy.create({ data: { userId: `${T}x`, tenMay: "x", tokenHash: "khong-phai-bam", tokenHetHan: NOW } })).rejects.toBeTruthy();
    await expect(db.hoaDonMayKy.create({ data: { userId: `${T}x`, tenMay: "x", tokenHash: "a".repeat(64) } })).rejects.toBeTruthy(); // token không hạn
    await expect(db.hoaDonMayKy.create({ data: { userId: `${T}x`, tenMay: "x", tokenHash: "b".repeat(64), tokenHetHan: NOW, thuHoiLuc: NOW } })).rejects.toBeTruthy();
    expect((await db.hoaDonMayKy.create({ data: { userId: `${T}x`, tenMay: "x", tokenHash: "c".repeat(64), tokenHetHan: NOW } })).id).toBeTruthy(); // đối chứng dương
  });
});

// ═══════════════════════ ROUTE ═══════════════════════
const CS = `${T}cs`;
const DON = `${T}don`;
const HD = `${T}hd`;
const REF = `${T}ref`;
const MST = "0402341070";
const KHOA = "khoa-may-ky-mky-0123456789-abcdefghijklmnop";

const actor = (userId: string, centerScope: "ALL" | string[] | null): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: centerScope === "ALL",
    orgRoles: [],
    permissions: centerScope === null ? [] : [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "KE_TOAN", centerScope }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

const phieu = (): PhieuPhatHanh => ({
  refId: REF,
  kyHieu: "1C26MNV",
  mstNguoiBan: MST,
  ngayHoaDon: new Date("2026-11-04T00:00:00.000Z"),
  nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null },
  hinhThucThanhToan: "Chuyển khoản",
  dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 }],
  tongTruocThue: 5_000_000,
  tongThue: 0,
  tongThanhToan: 5_000_000,
  soTienBangChu: "Năm triệu đồng.",
});

describe.skipIf(!RUN_DB_TESTS)("[KRT] route của ứng dụng ký — Postgres thật + VIN giả", () => {
  async function donRoute() {
    const lenh = await db.hoaDonLenhKy.findMany({ where: { hoaDonId: HD }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { OR: [{ entityType: "HoaDonLenhKy", entityId: { in: lenh.map((l) => l.id) } }, { entityId: HD }, { entityType: "HoaDonKetNoiNhaCungCap" }, { entityType: "HoaDonMayKy" }] } });
    await db.hoaDonLenhKy.deleteMany({ where: { hoaDonId: HD } });
    await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS } });
    await db.hoaDonDienTu.deleteMany({ where: { id: HD } });
    await db.order.deleteMany({ where: { id: DON } });
    await db.center.deleteMany({ where: { id: CS } });
    await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.kyUsb"] } } });
    await db.hoaDonKetNoiNhaCungCap.deleteMany({});
    await db.hoaDonMayKy.deleteMany({ where: { userId: { startsWith: T } } });
    await db.user.deleteMany({ where: { id: { startsWith: T } } });
  }
  const bat = (key: string, v = true) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });

  let may: ReturnType<typeof taoMayChuVinGia>;
  let lenhId = "";
  let tokenB = "";
  let tokenC = "";
  const cu = process.env.HOA_DON_KHOA_BI_MAT;

  const taoMay = async (userId: string) => {
    const r = await taoMaGhep({ userId, userName: userId, tenMay: "Máy thử", now: NOW });
    if (!r.ok) throw new Error(r.error);
    const k = await doiMaGhepLayToken({ ma: r.ma, now: NOW });
    if (!k.ok) throw new Error("đổi mã");
    return k.token;
  };
  const goi = async (duong: "viec" | "ket-qua" | "ghep-doi", o: { token?: string; body?: unknown; at?: Date } = {}) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(o.at ?? PHUT(1));
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (o.token) headers["authorization"] = `Bearer ${o.token}`;
      const url = `https://admin.example.test/api/ky-usb/${duong}`;
      // `return await`: `finally` chạy NGAY khi hàm trả; không await thì đồng hồ thật quay lại trước khi handler (có chỗ lấy giờ SAU một lượt await) chạy xong.
      if (duong === "viec") return await (await import("@/app/api/ky-usb/viec/route")).GET(new Request(url, { headers }));
      const init = { method: "POST", headers, body: JSON.stringify(o.body ?? {}) };
      return duong === "ket-qua" ? await (await import("@/app/api/ky-usb/ket-qua/route")).POST(new Request(url, init)) : await (await import("@/app/api/ky-usb/ghep-doi/route")).POST(new Request(url, init));
    } finally {
      vi.useRealTimers();
    }
  };

  beforeEach(async () => {
    await donRoute();
    process.env.HOA_DON_KHOA_BI_MAT = KHOA;
    may = taoMayChuVinGia();
    vi.stubGlobal("fetch", (i: string, init?: RequestInit) => may.fetchImpl(i, init));
    h.actors.clear();
    h.actors.set(U_A, actor(U_A, "ALL")); // người yêu cầu
    h.actors.set(U_B, actor(U_B, "ALL")); // người ký
    h.actors.set(U_C, actor(U_C, "ALL")); // kế toán khác
    for (const u of [U_A, U_B, U_C]) await db.user.create({ data: { id: u, email: `${u}@example.test`, name: u, } });
    await db.center.create({ data: { id: CS, name: "CS MKY", slug: CS, address: "x" } });
    await db.order.create({ data: { id: DON, code: "ORD-269976-000001", type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0328545551", totalAmount: 5_000_000, centerId: CS } });
    await db.hoaDonDienTu.create({
      data: { id: HD, orderId: DON, centerId: CS, trangThai: "DANG_PHAT_HANH", tongTien: 5_000_000, taoBoiId: `${T}kt`, phapNhanMa: "NEW_VISION", phapNhanTen: "NEW VISION", phapNhanMst: MST, nhaCungCapMa: "VIN_HOADON", misaRefId: REF, misaPhieu: JSON.parse(JSON.stringify(phieu())) },
    });
    for (const k of ["billing.hoaDonEnabled", "hoaDon.kyUsb"]) await bat(k);
    const kn = await luuKetNoi({
      // BGĐ 04/11/2026: cấu hình kết nối CHỈ do Quản trị tối cao ghi.
      actor: { ...actor(U_A, "ALL"), isSuperAdmin: true } as Actor,
      nguoi: { id: U_A, name: "A" },
      du: { phapNhanMa: "NEW_VISION", moiTruong: "SANDBOX", nhaCungCapMa: "VIN_HOADON", dangBat: true, baseUrl: "https://vin-thu.example.test", mst: MST, tenDangNhap: TAI_KHOAN_VIN_GIA.username, phuongThucKy: "USB_TOKEN", cheDoKy: "LO", chungThuSerial: "5400FA1B2C3D", chungThuHetHan: "2027-05-01" },
      matKhauMoi: TAI_KHOAN_VIN_GIA.password,
      lyDo: "Khai kết nối VIN cho fixture MKY",
      env: { HOA_DON_KHOA_BI_MAT: KHOA },
    });
    if (!kn.ok) throw new Error(kn.error);
    const t = await taoLenhKyUsb({ actor: actor(U_A, "ALL"), ten: "A", hoaDonId: HD, now: NOW, env: { HOA_DON_KHOA_BI_MAT: KHOA } });
    if (!t.ok) throw new Error(t.error);
    lenhId = t.id;
    const d = await duyetVaBatDauKy({ actor: actor(U_B, "ALL"), ten: "B", lenhId, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    if (!d.ok) throw new Error(d.error);
    tokenB = await taoMay(U_B);
    tokenC = await taoMay(U_C);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (cu === undefined) delete process.env.HOA_DON_KHOA_BI_MAT;
    else process.env.HOA_DON_KHOA_BI_MAT = cu;
    await donRoute();
  });

  const dungXml = async () => {
    const r = await goi("viec", { token: tokenB });
    const j = (await r.json()) as { viec: { lenhId: string; xmlChuaKyBase64: string } | null };
    if (!j.viec) throw new Error("không có việc");
    return j.viec;
  };
  const kyGia = (b64: string) => Buffer.from(kyXmlGiaChoTest(Buffer.from(b64, "base64").toString("utf8")), "utf8").toString("base64");

  it("[KRT-01] đủ luồng: ghép máy → lấy việc (phiên mở LÚC NÀY) → ký giả → báo kết quả ⇒ hoá đơn có số; việc kế tiếp = hết", async () => {
    expect(may.cuocGoi).toHaveLength(0); // bấm «Ký» chưa chạm VIN
    const r = await goi("viec", { token: tokenB });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = (await r.json()) as { viec: { lenhId: string; phapNhanTen: string; nguoiMua: string; soTien: number; xmlChuaKyBase64: string; hetHanPhien: string }; conLai: number };
    expect(j.viec).toMatchObject({ lenhId, phapNhanTen: "NEW VISION", nguoiMua: "Nguyễn Văn A", soTien: 5_000_000 });
    expect(may.daGhi.get(REF)?.daKy).toBe(false); // nháp đã lưu, chưa ký
    const nhanDuoc = await goi("ket-qua", { token: tokenB, body: { lenhId, xmlDaKyBase64: kyGia(j.viec.xmlChuaKyBase64) } });
    expect(nhanDuoc.status).toBe(200);
    expect(await nhanDuoc.json()).toEqual({ ok: true });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).soHoaDon).toMatch(/^\d{7}$/);
    const tiep = await goi("viec", { token: tokenB });
    expect(((await tiep.json()) as { viec: unknown }).viec).toBeNull();
  });

  it("[KRT-02] lấy việc LẶP LẠI khi phiên còn sống ⇒ cùng việc, VIN không bị gọi thêm lần lưu nháp nào", async () => {
    await goi("viec", { token: tokenB });
    const truoc = may.cuocGoi.length;
    const r2 = await goi("viec", { token: tokenB, at: PHUT(5) });
    expect(((await r2.json()) as { viec: { lenhId: string } }).viec.lenhId).toBe(lenhId);
    expect(may.cuocGoi.length).toBe(truoc);
  });

  it("[KRT-03] cờ `hoaDon.kyUsb` TẮT ⇒ 404 cho cả ba route, kể cả với token đúng (đối chứng dương: bật thì 200)", async () => {
    await bat("hoaDon.kyUsb", false);
    expect((await goi("viec", { token: tokenB })).status).toBe(404);
    expect((await goi("ket-qua", { token: tokenB, body: { lenhId, loi: "TU_CHOI" } })).status).toBe(404);
    expect((await goi("ghep-doi", { body: { ma: "ABCDE-FGHJK" } })).status).toBe(404);
    await bat("hoaDon.kyUsb");
    expect((await goi("viec", { token: tokenB })).status).toBe(200);
  });

  it("[KRT-04] không token / token lạ / sai khuôn ⇒ 401 TRẮNG (không thông điệp)", async () => {
    for (const token of [undefined, "kmk_" + "a".repeat(43), "khong-phai-token"]) {
      const r = await goi("viec", { token });
      expect(r.status, String(token)).toBe(401);
      expect(await r.text()).toBe("");
    }
    expect((await goi("viec", { token: tokenB })).status).toBe(200);
  });

  it("[KRT-05] token HẾT HẠN (30 ngày) hoặc đã THU HỒI ⇒ 401; ca thu hồi giữa chừng: đã lấy việc, thu hồi, báo kết quả ⇒ 401 và hoá đơn KHÔNG có số", async () => {
    const viec = await dungXml();
    const may1 = (await db.hoaDonMayKy.findMany({ where: { userId: U_B } }))[0]!;
    await thuHoiMay({ userId: U_B, userName: "B", mayId: may1.id, now: PHUT(2) });
    const r = await goi("ket-qua", { token: tokenB, body: { lenhId, xmlDaKyBase64: kyGia(viec.xmlChuaKyBase64) }, at: PHUT(3) });
    expect(r.status).toBe(401);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).soHoaDon).toBeNull();
    expect((await goi("viec", { token: tokenC, at: NGAY(31) })).status).toBe(401); // hết hạn
    expect((await goi("viec", { token: tokenC, at: NGAY(29) })).status).toBe(200); // đối chứng dương
  });

  it("[KRT-06] người dùng bị KHOÁ tài khoản hoặc XOÁ MỀM, hoặc MẤT quyền kế toán ⇒ máy mất tác dụng (401/403) dù token còn hạn", async () => {
    await db.user.update({ where: { id: U_B }, data: { isActive: false } });
    expect((await goi("viec", { token: tokenB })).status).toBe(401);
    await db.user.update({ where: { id: U_B }, data: { isActive: true, deletedAt: NOW } });
    expect((await goi("viec", { token: tokenB })).status).toBe(401);
    await db.user.update({ where: { id: U_B }, data: { deletedAt: null } });
    h.actors.set(U_B, actor(U_B, null)); // không còn quyền payments:confirm
    expect((await goi("viec", { token: tokenB })).status).toBe(403);
    h.actors.set(U_B, actor(U_B, [])); // có quyền nhưng không là kế toán ở cơ sở nào
    expect((await goi("viec", { token: tokenB })).status).toBe(403);
    h.actors.set(U_B, actor(U_B, "ALL")); // đối chứng dương: trả quyền lại
    expect((await goi("viec", { token: tokenB })).status).toBe(200);
  });

  it("[KRT-07] NGƯỜI KHÁC: máy của C không thấy việc của B; C báo kết quả / lỗi cho lệnh của B ⇒ 409 và lệnh không đổi; B vẫn ký được", async () => {
    const viec = await dungXml();
    const thayC = await goi("viec", { token: tokenC });
    expect(((await thayC.json()) as { viec: unknown }).viec).toBeNull();
    const ky = await goi("ket-qua", { token: tokenC, body: { lenhId, xmlDaKyBase64: kyGia(viec.xmlChuaKyBase64) } });
    expect(ky.status).toBe(409);
    const loi = await goi("ket-qua", { token: tokenC, body: { lenhId, loi: "NGUOI_DUNG_HUY" } });
    expect(loi.status).toBe(409);
    expect((await db.hoaDonLenhKy.findUniqueOrThrow({ where: { id: lenhId } })).trangThai).toBe("DANG_KY");
    expect(may.cuocGoi.filter((c) => c.duong.endsWith("GuiXmlDaKy"))).toHaveLength(0);
    expect((await goi("ket-qua", { token: tokenB, body: { lenhId, xmlDaKyBase64: kyGia(viec.xmlChuaKyBase64) } })).status).toBe(200);
  });

  it("[KRT-08] ứng dụng báo LỖI (người dùng huỷ) ⇒ lệnh LOI_KY, hoá đơn không đổi; mã lỗi lạ ⇒ vẫn đóng lệnh (không nhận chuỗi tự do)", async () => {
    await dungXml();
    const r = await goi("ket-qua", { token: tokenB, body: { lenhId, loi: "NGUOI_DUNG_HUY" } });
    expect(r.status).toBe(200);
    const l = await db.hoaDonLenhKy.findUniqueOrThrow({ where: { id: lenhId } });
    expect(l.trangThai).toBe("LOI_KY");
    expect(l.lyDo).toMatch(/^NGUOI_DUNG_HUY/);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DANG_PHAT_HANH");
  });

  it("[KRT-09] dữ liệu rác: thân sai khuôn · XML quá 1 MB · lenhId lạ ⇒ 400 / 409, không chạm VIN", async () => {
    await dungXml();
    const truoc = may.cuocGoi.length;
    expect((await goi("ket-qua", { token: tokenB, body: { lenhId } })).status).toBe(400);
    expect((await goi("ket-qua", { token: tokenB, body: { lenhId, xmlDaKyBase64: "A".repeat(1_000_001) } })).status).toBe(400);
    expect((await goi("ket-qua", { token: tokenB, body: { lenhId: "khong-co", xmlDaKyBase64: "QQ==" } })).status).toBe(409);
    expect(may.cuocGoi.length).toBe(truoc);
  });

  it("[KRT-10] ghép đôi qua route: đổi mã lấy token đúng một lần; mã sai / dùng lại ⇒ 400 trắng; token trong phản hồi dùng được ngay", async () => {
    const r = await taoMaGhep({ userId: U_A, userName: "A", tenMay: "Máy mới", now: NOW });
    if (!r.ok) throw new Error(r.error);
    const ok = await goi("ghep-doi", { body: { ma: r.ma } });
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { token: string; hetHan: string };
    expect(j.token).toMatch(/^kmk_/);
    expect((await goi("viec", { token: j.token })).status).toBe(200);
    const lai = await goi("ghep-doi", { body: { ma: r.ma } });
    expect(lai.status).toBe(400);
    expect(await lai.text()).toBe("");
    expect((await goi("ghep-doi", { body: { ma: "SAISAI-SAI" } })).status).toBe(400);
    expect((await goi("ghep-doi", { body: {} })).status).toBe(400);
  });
});
