// Ca [YCM-DB-*] — YÊU CẦU THU THẬP THÔNG TIN NGƯỜI MUA (Invoice Hub đợt 2, S11 phần độc lập) TRÊN POSTGRES THẬT.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-yeu-cau-nguoi-mua-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố `fx-ycm-`; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Mọi ca "KHÔNG được" kèm đối chứng dương.
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi `now` là hằng tuyệt đối truyền vào; dịch vụ không đọc đồng hồ.
// Luật thuần (hợp nhất ô, chống đoán, hạn, quyền) có ca riêng ở `lib/finance/hoa-don/yeu-cau-nguoi-mua.test.ts`; ở đây đo thứ CHỈ có ở DB thật: chỉ mục từng phần "một yêu cầu mở mỗi đơn",
// khoá tư vấn + `updateMany` có điều kiện (đua), cô lập cơ sở, bộ đếm sống sót qua token sai, AuditLog sạch, và bảng tiền / hoá đơn không bị đụng.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { GioiHanChongDoan } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua";
import { bamToken, giaTriGocHash, tachMaLienKet } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-token";
import {
  guiThongTinPhuHuynh,
  huyYeuCau,
  moBangToken,
  nhapThayBoiSale,
  quetHetHan,
  taoYeuCau,
  sangLoi,
  xacNhanYeuCau,
  xacNhanYeuCauTrongTx,
  TuChoi,
  type KetQuaTao,
} from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db";

if (!RUN_DB_TESTS) console.warn(`[YCM-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ycm-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON1 = `${T}don1`; // CS1
const DON2 = `${T}don2`; // CS2
const DON3 = `${T}don3`; // CS1
const NOW = new Date("2026-11-02T03:00:00.000Z");
const phut = (n: number, goc: Date = NOW) => new Date(goc.getTime() + n * 60_000);
const G: GioiHanChongDoan = { toiDaSaiToken: 3, toiDaLanMo: 2, khoaPhut: 30 };
const G_RONG: GioiHanChongDoan = { toiDaSaiToken: 3, toiDaLanMo: 50, khoaPhut: 30 };

// Giá trị riêng để quét rò rỉ (audit / log KHÔNG được chứa giá trị ô).
const TEN_PH = "Nguyễn Thị Phụ Huynh YCMX";
const DIA_CHI_PH = "114 Hoàng Diệu YCMX, Đà Nẵng";
const EMAIL_PH = "ph.ycmx@example.com";
const MST_DN = "0401234567";

type Quyen = { action: string; centerScope: "ALL" | string[] };
const actorCo = (userId: string, quyen: Quyen[]): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: quyen.some((q) => q.centerScope === "ALL"),
    orgRoles: [],
    permissions: quyen.map((q) => ({ action: q.action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: q.centerScope })),
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

const KT_CS1 = actorCo(`${T}kt-cs1`, [{ action: "payments:confirm", centerScope: [CS1] }]);
const KT_CS2 = actorCo(`${T}kt-cs2`, [{ action: "payments:confirm", centerScope: [CS2] }]);
const SALE_CS1 = actorCo(`${T}sale-cs1`, [{ action: "payments:record", centerScope: [CS1] }, { action: "orders:view-pii", centerScope: [CS1] }]);
const SALE_THIEU_PII = actorCo(`${T}sale-thieu`, [{ action: "payments:record", centerScope: [CS1] }]);
const GV = actorCo(`${T}gv`, [{ action: "classes:view", centerScope: [CS1] }]);
const HO = actorCo(`${T}ho`, [{ action: "payments:confirm", centerScope: "ALL" }]);
const ng = (a: Actor) => ({ id: a.userId, name: `Người ${a.userId}` });

const tbl = () => db.hoaDonYeuCauNguoiMua;
const hang = (id: string) => tbl().findUniqueOrThrow({ where: { id } });
const kiemKhoaCoDinh = async () => (await tbl().findMany({ where: { orderId: { startsWith: T } }, orderBy: { id: "asc" } })).length;

async function don() {
  const ids = (await tbl().findMany({ where: { OR: [{ orderId: { startsWith: T } }, { id: { startsWith: T } }] }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { entityType: "HoaDonYeuCauNguoiMua", entityId: { in: ids } } });
  await tbl().deleteMany({ where: { OR: [{ orderId: { startsWith: T } }, { id: { startsWith: T } }] } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const [id, ten] of [[CS1, "CS1 YCM"], [CS2, "CS2 YCM"]] as const) await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  for (const [id, coSo, ma, ten, mst, email] of [
    [DON1, CS1, "ORD-269971-000001", "Nguyễn Thị Gốc", "0999888777", "goc@example.com"],
    [DON2, CS2, "ORD-269971-000002", "Trần Văn Hai", null, null],
    [DON3, CS1, "ORD-269971-000003", "Lê Văn Ba", null, null],
  ] as const) {
    await db.order.create({
      data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: "Khách hàng YCM", customerPhone: "0328545331", totalAmount: 5_000_000, centerId: coSo, invoiceBuyerName: ten, invoiceTaxCode: mst, invoiceEmail: email },
    });
  }
}

async function tao(o: { actor?: Actor; orderId?: string; ttlPhut?: number; now?: Date } = {}): Promise<Extract<KetQuaTao, { ok: true }>> {
  const a = o.actor ?? KT_CS1;
  const r = await taoYeuCau({ actor: a, nguoi: ng(a), orderId: o.orderId ?? DON1, phamVi: "DON", ttlPhut: o.ttlPhut ?? 240, now: o.now ?? NOW });
  if (!r.ok) throw new Error(`Dựng fixture thất bại: ${r.ma} — ${r.error}`);
  return r;
}
const mo = (t: Extract<KetQuaTao, { ok: true }>, o: { token?: string; g?: GioiHanChongDoan; now?: Date } = {}) =>
  moBangToken({ id: t.id, token: o.token ?? t.token, gioiHan: o.g ?? G_RONG, now: o.now ?? NOW });
// ⚠️ [03/11/2026] Bộ này kiểm DỊCH VỤ YÊU CẦU (bản ghi `duLieuGui`, vòng đời, hợp nhất theo ô) — không kiểm đường ghi vào đơn. Phụ huynh gửi xong thì các ô ĐỔI so với bản điền sẵn vào ĐƠN ngay;
// ở đây mô phỏng «PH gửi nguyên bản điền sẵn» (`banDau: du`) để đơn không bị đụng và các ca "đơn / hoá đơn / tiền trước-sau y hệt" vẫn đo đúng phần dịch vụ. Đường ghi vào đơn: bộ [YCW-*].
const gui = (t: Extract<KetQuaTao, { ok: true }>, du: Record<string, string>, o: { token?: string; g?: GioiHanChongDoan; now?: Date; banDau?: Record<string, string> } = {}) =>
  guiThongTinPhuHuynh({ id: t.id, token: o.token ?? t.token, gioiHan: o.g ?? G_RONG, du, banDau: o.banDau ?? du, hocVienThem: [], hocVienThemBanDau: [], donY: { phienBanDieuKhoan: "dk-test-1" }, now: o.now ?? NOW });
const thay = (actor: Actor, id: string, du: Record<string, string>, now: Date = NOW) => nhapThayBoiSale({ actor, nguoi: ng(actor), id, du, now });
const xacNhan = (actor: Actor, id: string, now: Date = NOW) => xacNhanYeuCau({ actor, nguoi: ng(actor), id, now });
const CCCD_PH = "048123456789";
const DU_CA_NHAN = { loai: "CA_NHAN", ten: TEN_PH, diaChi: DIA_CHI_PH, email: EMAIL_PH, cccd: CCCD_PH };
const lichSu = (id: string) => db.auditLog.findMany({ where: { entityType: "HoaDonYeuCauNguoiMua", entityId: id }, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  if (RUN_DB_TESTS) await dungFixture();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[YCM-DB-01] vòng đời đầy đủ: tạo → mở → PH gửi → Sale nhập thay → xác nhận", () => {
  it("mỗi bước đúng trạng thái + audit; xác nhận trả người mua đã chuẩn hoá; chỉ một yêu cầu, không chạm bảng khác", async () => {
    const t = await tao();
    expect(await hang(t.id)).toMatchObject({ centerId: CS1, orderId: DON1, phamVi: "DON", trangThai: "DANG_MO", soLanMo: 0, soLanSai: 0, khoaDen: null, guiLuc: null, duLieuGui: null, taoBoiId: KT_CS1.userId });
    expect((await hang(t.id)).hetHanLuc.toISOString()).toBe(phut(240).toISOString());
    expect(tachMaLienKet(t.maLienKet)).toEqual({ id: t.id, token: t.token });

    const m = await mo(t);
    expect(m).toMatchObject({ ok: true, yeuCau: { id: t.id, phamVi: "DON", o: {} } });
    expect((await hang(t.id)).soLanMo).toBe(1);

    const g = await gui(t, DU_CA_NHAN, { now: phut(5) });
    expect(g).toEqual({ ok: true, oDaDoi: ["loai", "ten", "diaChi", "email", "cccd"], oXungDot: [], ghiVaoDon: "KHONG_DOI" }); // `gui` mô phỏng PH gửi nguyên bản điền sẵn ⇒ đơn không bị đụng
    expect(await hang(t.id)).toMatchObject({ trangThai: "DANG_MO", guiLuc: phut(5), donY: { phienBanDieuKhoan: "dk-test-1" } });

    // Mở lại: thấy các ô đã điền (để điền sẵn).
    const m2 = await mo(t, { now: phut(6) });
    expect(m2.ok && m2.yeuCau.o.ten?.giaTri).toBe(TEN_PH);

    expect(await thay(SALE_CS1, t.id, { loai: "CA_NHAN", maSoThue: MST_DN }, phut(7))).toMatchObject({ ok: true, oDaDoi: ["loai", "maSoThue"], oXungDot: [] }); // ai ghi sau thắng: cùng giá trị khác nguồn ⇒ ô chuyển sang Sale, không xung đột
    const kq = await xacNhan(SALE_CS1, t.id, phut(8));
    expect(kq).toMatchObject({ ok: true, id: t.id, orderId: DON1, centerId: CS1 });
    if (kq.ok) {
      // loại 'CA_NHAN' (nay do Sale ghi sau) ⇒ MST của cá nhân bị bỏ khi chốt.
      expect(kq.nguoiMua).toEqual({ loai: "CA_NHAN", ten: TEN_PH, diaChi: DIA_CHI_PH, email: EMAIL_PH, maSoThue: null, cccd: CCCD_PH, sdt: null, tenHocVien: null, ngaySinhHocVien: null, cccdHocVien: null });
      expect(kq.nguonTheoO).toMatchObject({ loai: "SALE_NHAP_THAY", ten: "PHU_HUYNH", maSoThue: "SALE_NHAP_THAY" });
    }
    expect(await hang(t.id)).toMatchObject({ trangThai: "DA_AP_DUNG" });
    expect((await lichSu(t.id)).map((a) => a.action)).toEqual([
      "TAO_YEU_CAU_NGUOI_MUA",
      "PHU_HUYNH_GUI_THONG_TIN_NGUOI_MUA",
      "SALE_NHAP_THAY_THONG_TIN_NGUOI_MUA",
      "XAC_NHAN_YEU_CAU_NGUOI_MUA",
    ]);
    expect(await kiemKhoaCoDinh()).toBe(1);
  });

  it("đã xác nhận ⇒ token đúng cũng không mở / gửi được nữa (DA_DONG) và nhân viên không nhập thêm / huỷ / xác nhận lại", async () => {
    const t = await tao();
    await gui(t, DU_CA_NHAN);
    expect((await xacNhan(KT_CS1, t.id)).ok).toBe(true);
    expect(await mo(t)).toMatchObject({ ok: false, ma: "DA_DONG" });
    expect(await gui(t, { ten: "Tên khác muộn" })).toMatchObject({ ok: false, ma: "DA_DONG" });
    expect(await thay(KT_CS1, t.id, { diaChi: "Địa chỉ khác muộn" })).toMatchObject({ ok: false, ma: "DA_DONG" });
    expect(await xacNhan(KT_CS1, t.id)).toMatchObject({ ok: false, ma: "DA_DONG" });
    expect(await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, lyDo: "Huỷ sau khi đã xác nhận", now: NOW })).toMatchObject({ ok: false, ma: "DA_DONG" });
    expect((await hang(t.id)).trangThai).toBe("DA_AP_DUNG");
  });

  it("giá trị gốc của đơn được BĂM lúc tạo (muối theo id), không lưu giá trị thô", async () => {
    const t = await tao();
    const r = await hang(t.id);
    const dau = await db.order.findUniqueOrThrow({ where: { id: DON1 }, select: { invoiceBuyerName: true, invoiceCompanyName: true, invoiceTaxCode: true, invoiceEmail: true, customerCccd: true, invoiceParentPhone: true, invoiceStudentName: true, invoiceStudentCccd: true } });
    expect(r.giaTriGocHash).toEqual(giaTriGocHash(t.id, dau));
    const txt = JSON.stringify(r.giaTriGocHash);
    for (const thô of ["Nguyễn Thị Gốc", "0999888777", "goc@example.com"]) expect(txt.toLowerCase()).not.toContain(thô.toLowerCase());
    expect((r.giaTriGocHash as Record<string, unknown>).invoiceCompanyName).toBeNull();
  });
});

chay("[YCM-DB-02] token: chỉ hash nằm ở DB; đúng / sai / của yêu cầu khác / id lạ", () => {
  it("DB giữ đúng sha256(token), không giữ token; token đúng mở được và tăng soLanMo", async () => {
    const t = await tao();
    expect((await hang(t.id)).tokenHash).toBe(bamToken(t.token));
    expect((await hang(t.id)).tokenHash).not.toContain(t.token);
    expect(await mo(t)).toMatchObject({ ok: true });
    expect((await hang(t.id)).soLanMo).toBe(1);
  });
  it("token sai ⇒ KHONG_HOP_LE và bộ đếm sai TĂNG (commit sống sót, không bị rollback); id lạ cùng một mã", async () => {
    const t = await tao();
    const khac = await tao({ orderId: DON3 });
    expect(await mo(t, { token: khac.token })).toEqual({ ok: false, ma: "KHONG_HOP_LE", error: expect.any(String) });
    expect((await hang(t.id)).soLanSai).toBe(1);
    expect((await hang(khac.id)).soLanSai).toBe(0); // chỉ yêu cầu bị gõ sai mới đếm
    expect(await moBangToken({ id: "id-khong-ton-tai-123", token: t.token, gioiHan: G_RONG, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await moBangToken({ id: "x", token: t.token, gioiHan: G_RONG, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await mo(t, { token: "khong-phai-token" })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect((await hang(t.id)).soLanSai).toBe(2);
    expect((await hang(t.id)).soLanMo).toBe(0);
  });
  it("gửi dữ liệu với token sai ⇒ KHONG_HOP_LE, KHÔNG ghi dữ liệu, đếm sai (đối chứng: token đúng thì ghi được)", async () => {
    const t = await tao();
    const khac = await tao({ orderId: DON3 });
    expect(await gui(t, DU_CA_NHAN, { token: khac.token })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await hang(t.id)).toMatchObject({ duLieuGui: null, guiLuc: null, soLanSai: 1 });
    expect(await gui(t, DU_CA_NHAN)).toMatchObject({ ok: true });
    expect((await hang(t.id)).duLieuGui).not.toBeNull();
  });
  it("sau khi cấp lại (huỷ + tạo mới) token CŨ không mở được yêu cầu mới và token mới không mở được yêu cầu cũ", async () => {
    const cu = await tao();
    expect((await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: cu.id, lyDo: "Cấp lại liên kết mới", now: NOW })).ok).toBe(true);
    const moi = await tao();
    expect(await moBangToken({ id: moi.id, token: cu.token, gioiHan: G_RONG, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await moBangToken({ id: cu.id, token: moi.token, gioiHan: G_RONG, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await mo(cu)).toMatchObject({ ok: false, ma: "DA_DONG" }); // token đúng của yêu cầu đã huỷ
    expect(await mo(moi)).toMatchObject({ ok: true });
  });
});

chay("[YCM-DB-03] hạn dùng: đúng giây hạn là hết; trước 1 ms còn", () => {
  it("mở / gửi tại hạn − 1 ms ⇒ được; tại đúng hạn ⇒ HET_HAN và không ghi gì", async () => {
    const t = await tao({ ttlPhut: 60 });
    const han = phut(60);
    expect(await mo(t, { now: new Date(han.getTime() - 1) })).toMatchObject({ ok: true });
    expect(await gui(t, { ten: "Tên trước hạn" }, { now: new Date(han.getTime() - 1) })).toMatchObject({ ok: true });
    const truoc = await hang(t.id);
    expect(await mo(t, { now: han })).toMatchObject({ ok: false, ma: "HET_HAN" });
    expect(await gui(t, { ten: "Tên sau hạn" }, { now: han })).toMatchObject({ ok: false, ma: "HET_HAN" });
    const sau = await hang(t.id);
    expect(sau.soLanMo).toBe(truoc.soLanMo);
    expect(sau.duLieuGui).toEqual(truoc.duLieuGui);
  });
  it("TTL do người gọi quyết (không hằng ẩn): TTL 5 phút ⇒ hạn đúng +5 phút; TTL không hợp lệ ⇒ ném RangeError và KHÔNG tạo hàng nào", async () => {
    const t = await tao({ ttlPhut: 5 });
    expect((await hang(t.id)).hetHanLuc.toISOString()).toBe(phut(5).toISOString());
    const truoc = await kiemKhoaCoDinh();
    await expect(taoYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), orderId: DON3, phamVi: "DON", ttlPhut: 0, now: NOW })).rejects.toThrow(RangeError);
    await expect(taoYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), orderId: DON3, phamVi: "DON", ttlPhut: 10 ** 7, now: NOW })).rejects.toThrow(RangeError);
    expect(await kiemKhoaCoDinh()).toBe(truoc);
  });
});

chay("[YCM-DB-04] chống đoán: khoá cứng sau N lần sai, ở DB", () => {
  it("dưới ngưỡng vẫn mở được và đúng token XOÁ bộ đếm; đủ N lần sai ⇒ khoá tới now + khoaPhut kèm đúng MỘT dòng audit khoá", async () => {
    const t = await tao();
    await mo(t, { token: "sai-1", g: G });
    await mo(t, { token: "sai-2", g: G });
    expect((await hang(t.id)).soLanSai).toBe(2); // N-1 = 2 < 3
    expect(await mo(t, { g: G, now: phut(1) })).toMatchObject({ ok: true }); // đối chứng: dưới ngưỡng vẫn mở
    expect(await hang(t.id)).toMatchObject({ soLanSai: 0, khoaDen: null });

    await mo(t, { token: "sai-3", g: G, now: phut(2) });
    await mo(t, { token: "sai-4", g: G, now: phut(2) });
    expect(await hang(t.id)).toMatchObject({ soLanSai: 2, khoaDen: null });
    await mo(t, { token: "sai-5", g: G, now: phut(2) }); // lần thứ 3 liên tiếp
    const khoa = await hang(t.id);
    expect(khoa.soLanSai).toBe(3);
    expect(khoa.khoaDen?.toISOString()).toBe(phut(32).toISOString());
    expect((await lichSu(t.id)).filter((a) => a.action === "KHOA_YEU_CAU_NGUOI_MUA")).toHaveLength(1);
  });
  it("đang khoá: token ĐÚNG cũng bị chặn (KHOA); token sai không đếm thêm cũng không gia hạn khoá; hết khoá đúng giây ⇒ mở lại được", async () => {
    const t = await tao();
    for (let i = 0; i < 3; i += 1) await mo(t, { token: `sai-${i}`, g: G, now: phut(1) });
    const khoaDen = (await hang(t.id)).khoaDen!;
    expect(khoaDen.toISOString()).toBe(phut(31).toISOString());

    expect(await mo(t, { g: G, now: phut(10) })).toMatchObject({ ok: false, ma: "KHOA" });
    expect(await gui(t, { ten: "Tên lúc bị khoá" }, { g: G, now: phut(10) })).toMatchObject({ ok: false, ma: "KHOA" });
    await mo(t, { token: "sai-trong-luc-khoa", g: G, now: phut(20) });
    const giuNguyen = await hang(t.id);
    expect(giuNguyen.soLanSai).toBe(3);
    expect(giuNguyen.khoaDen?.toISOString()).toBe(khoaDen.toISOString());
    expect(giuNguyen.duLieuGui).toBeNull();

    expect(await mo(t, { g: G, now: khoaDen })).toMatchObject({ ok: true }); // đúng giây hết khoá
    expect(await hang(t.id)).toMatchObject({ soLanSai: 0, khoaDen: null });
  });
  it("token sai vào yêu cầu đã đóng không đếm, không ghi gì (đối chứng: DANG_MO thì đếm)", async () => {
    const t = await tao();
    await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, lyDo: "Huỷ để thử đếm sai", now: NOW });
    const truoc = await hang(t.id);
    expect(await mo(t, { token: "sai" })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await hang(t.id)).toEqual(truoc);
    const t2 = await tao({ orderId: DON3 });
    await mo(t2, { token: "sai" });
    expect((await hang(t2.id)).soLanSai).toBe(1);
  });
  it("số lần MỞ: lần thứ M mở được, lần M+1 bị chặn VUOT_SO_LAN_MO; GỬI dữ liệu vẫn được (không tính vào số lần mở)", async () => {
    const t = await tao();
    expect(await mo(t, { g: G })).toMatchObject({ ok: true });
    expect(await mo(t, { g: G })).toMatchObject({ ok: true });
    expect(await mo(t, { g: G })).toMatchObject({ ok: false, ma: "VUOT_SO_LAN_MO" });
    expect((await hang(t.id)).soLanMo).toBe(2);
    expect(await gui(t, { ten: "Vẫn gửi được" }, { g: G })).toMatchObject({ ok: true });
  });
});

chay("[YCM-DB-05] một yêu cầu mở mỗi đơn: chỉ mục từng phần ở DB là trọng tài", () => {
  it("lần tạo thứ hai trên cùng đơn ⇒ DA_CO_YEU_CAU_MO, không có hàng thứ hai; huỷ rồi tạo lại ⇒ ĐƯỢC; đơn khác không bị ảnh hưởng", async () => {
    const t1 = await tao();
    const lan2 = await taoYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), orderId: DON1, phamVi: "DON", ttlPhut: 240, now: NOW });
    expect(lan2).toMatchObject({ ok: false, ma: "DA_CO_YEU_CAU_MO" });
    expect(await kiemKhoaCoDinh()).toBe(1);
    expect((await tao({ orderId: DON3 })).ok).toBe(true); // đối chứng: đơn khác tạo được
    expect((await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t1.id, lyDo: "Huỷ để cấp lại cho đơn", now: NOW })).ok).toBe(true);
    const lai = await tao();
    expect(lai.id).not.toBe(t1.id);
    expect((await hang(t1.id)).trangThai).toBe("THU_HOI");
    expect((await hang(lai.id)).trangThai).toBe("DANG_MO");
  });
  it("hai lượt tạo ĐỒNG THỜI cho cùng đơn ⇒ đúng một thắng, một DA_CO_YEU_CAU_MO", async () => {
    const kq = await Promise.all([KT_CS1, SALE_CS1, HO].map((a) => taoYeuCau({ actor: a, nguoi: ng(a), orderId: DON1, phamVi: "DON", ttlPhut: 240, now: NOW })));
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok && k.ma === "DA_CO_YEU_CAU_MO")).toHaveLength(2);
    expect(await kiemKhoaCoDinh()).toBe(1);
  });
});

chay("[YCM-DB-06] xung đột Sale ↔ phụ huynh THEO Ô — hai thứ tự", () => {
  it("Sale nhập TRƯỚC, PH gửi SAU ⇒ ai ghi sau thắng: PH đè ô tranh chấp, ô PH không đụng thì giữ của Sale; xung đột ghi nhận", async () => {
    const t = await tao();
    expect(await thay(SALE_CS1, t.id, { loai: "CA_NHAN", ten: "Tên do Sale gõ", diaChi: "Địa chỉ do Sale gõ ở đây", cccd: CCCD_PH }, phut(1))).toMatchObject({ ok: true, oXungDot: [] });
    expect(await gui(t, { ten: TEN_PH, email: EMAIL_PH }, { now: phut(2) })).toMatchObject({ ok: true, oDaDoi: ["ten", "email"], oXungDot: ["ten"] });
    const o = (await xacNhan(SALE_CS1, t.id, phut(3))) as Extract<Awaited<ReturnType<typeof xacNhan>>, { ok: true }>;
    expect(o.nguoiMua).toMatchObject({ ten: TEN_PH, diaChi: "Địa chỉ do Sale gõ ở đây", email: EMAIL_PH });
    expect(o.nguonTheoO).toEqual({ loai: "SALE_NHAP_THAY", ten: "PHU_HUYNH", diaChi: "SALE_NHAP_THAY", email: "PHU_HUYNH", cccd: "SALE_NHAP_THAY" });
  });
  it("[ĐẢO 03/11] PH gửi TRƯỚC, Sale nhập thay SAU ⇒ Sale ĐÈ cả ô PH đã điền (lỡ PH ghi sai thì Sale sửa được); xung đột ghi nhận với `thang` = Sale", async () => {
    const t = await tao();
    await gui(t, { loai: "CA_NHAN", ten: TEN_PH, cccd: CCCD_PH }, { now: phut(1) });
    const s = await thay(SALE_CS1, t.id, { ten: "Tên Sale sửa lại", diaChi: "Địa chỉ Sale nhập thay", loai: "CA_NHAN" }, phut(2));
    expect(s).toEqual({ ok: true, oDaDoi: ["loai", "ten", "diaChi"], oXungDot: ["ten"] });
    const o = (await xacNhan(KT_CS1, t.id, phut(3))) as Extract<Awaited<ReturnType<typeof xacNhan>>, { ok: true }>;
    expect(o.nguoiMua).toMatchObject({ loai: "CA_NHAN", ten: "Tên Sale sửa lại", diaChi: "Địa chỉ Sale nhập thay" });
    expect(o.nguonTheoO).toEqual({ loai: "SALE_NHAP_THAY", ten: "SALE_NHAP_THAY", diaChi: "SALE_NHAP_THAY", cccd: "PHU_HUYNH" }); // ô Sale không đụng (CCCD) vẫn của PH
  });
  it("Sale nhập đúng giá trị PH đã điền ⇒ ô chuyển sang nguồn Sale (không xung đột); Sale gõ LẠI đúng giá trị của chính mình ⇒ không ghi dòng audit nào và `updatedAt` không đổi", async () => {
    const t = await tao();
    await gui(t, { ten: TEN_PH }, { now: phut(1) });
    expect(await thay(SALE_CS1, t.id, { ten: TEN_PH }, phut(2))).toEqual({ ok: true, oDaDoi: ["ten"], oXungDot: [] });
    const truoc = await hang(t.id);
    const nTruoc = (await lichSu(t.id)).length;
    expect(await thay(SALE_CS1, t.id, { ten: TEN_PH }, phut(3))).toEqual({ ok: true, oDaDoi: [], oXungDot: [] });
    expect((await hang(t.id)).updatedAt).toEqual(truoc.updatedAt);
    expect((await lichSu(t.id)).length).toBe(nTruoc);
  });
  it("PH gửi và Sale nhập thay ĐỒNG THỜI trên cùng yêu cầu ⇒ không mất bản ghi nào (khoá tư vấn tuần tự hoá đọc-sửa-ghi); ô tranh chấp thuộc về người ghi SAU, ô rời nhau hợp lại đủ", async () => {
    const thang = new Set<string>();
    for (let lan = 0; lan < 6; lan += 1) {
      await dungFixture();
      const t = await tao();
      const [a, b] = await Promise.all([gui(t, { ten: TEN_PH, email: EMAIL_PH }, { now: phut(1) }), thay(SALE_CS1, t.id, { ten: "Tên Sale gõ", diaChi: "Địa chỉ Sale gõ", loai: "CA_NHAN", cccd: CCCD_PH }, phut(1))]);
      expect(a.ok && b.ok).toBe(true);
      const o = (await xacNhan(SALE_CS1, t.id, phut(2))) as Extract<Awaited<ReturnType<typeof xacNhan>>, { ok: true }>;
      expect(o.nguoiMua).toMatchObject({ loai: "CA_NHAN", diaChi: "Địa chỉ Sale gõ", email: EMAIL_PH }); // ô rời nhau: đủ ở mọi thứ tự
      // Ô tranh chấp: giá trị và NGUỒN phải khớp nhau (không có trạng thái nửa vời «giá trị của PH mà nguồn là Sale»), và là một trong hai bên.
      expect(o.nguoiMua.ten === TEN_PH ? "PHU_HUYNH" : "SALE_NHAP_THAY").toBe(o.nguonTheoO.ten);
      expect([TEN_PH, "Tên Sale gõ"]).toContain(o.nguoiMua.ten);
      thang.add(o.nguonTheoO.ten as string);
    }
    expect(thang.size).toBeGreaterThan(0);
  });
  it("dữ liệu sai bị từ chối TRƯỚC khi chạm DB: không ghi, không đếm; khoá lạ (kể cả tên trường giấy tờ tuỳ thân) không bao giờ được lưu", async () => {
    const t = await tao();
    const truoc = await hang(t.id);
    expect(await gui(t, { email: "khong-phai-email", maSoThue: "123" })).toMatchObject({ ok: false, ma: "DU_LIEU_SAI", loiTheoO: { email: expect.any(String), maSoThue: expect.any(String) } });
    expect(await gui(t, { ten: "  ", diaChi: "" })).toMatchObject({ ok: false, ma: "KHONG_CO_DU_LIEU" });
    expect(await thay(SALE_CS1, t.id, { email: "x" })).toMatchObject({ ok: false, ma: "DU_LIEU_SAI" });
    expect(await hang(t.id)).toEqual(truoc);
    // CCCD (ô hợp lệ từ 02/11/2026) ĐƯỢC lưu trong `duLieuGui`; khoá giấy tờ LẠ vẫn không bao giờ được lưu.
    expect(await gui(t, { ten: TEN_PH, cccd: "012345678901", soGiayTo: "B1234567" } as Record<string, string>)).toMatchObject({ ok: true, oDaDoi: ["ten", "cccd"] });
    const luu = JSON.stringify((await hang(t.id)).duLieuGui);
    expect(luu).not.toMatch(/giayTo|B1234567/i);
    expect(luu).toContain("012345678901"); // đối chứng dương: ô hợp lệ có được lưu
    // CCCD KHÔNG có cột riêng ở bảng yêu cầu — chỉ nằm trong JSON bị NULL hoá sau N ngày (xem [YCM-DB-09])
    const cot = await db.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'HoaDonYeuCauNguoiMua' AND column_name ILIKE '%cccd%'`;
    expect(cot).toEqual([]);
  });
});

chay("[YCM-DB-07] xác nhận: đủ & hợp lệ mới chốt; hai người cùng xác nhận ⇒ đúng một thắng", () => {
  it("thiếu ô bắt buộc / doanh nghiệp thiếu MST ⇒ THIEU_THONG_TIN, trạng thái KHÔNG đổi; điền đủ ⇒ ĐƯỢC", async () => {
    const t = await tao();
    expect(await xacNhan(KT_CS1, t.id)).toMatchObject({ ok: false, ma: "THIEU_THONG_TIN" });
    await thay(SALE_CS1, t.id, { loai: "DOANH_NGHIEP", ten: "Công ty TNHH Thử Nghiệm", diaChi: "114 Hoàng Diệu, Đà Nẵng" });
    expect(await xacNhan(KT_CS1, t.id)).toMatchObject({ ok: false, ma: "THIEU_THONG_TIN", error: expect.stringContaining("maSoThue") });
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
    await thay(SALE_CS1, t.id, { maSoThue: MST_DN });
    expect(await xacNhan(KT_CS1, t.id)).toMatchObject({ ok: false, ma: "THIEU_THONG_TIN", error: expect.stringContaining("email") }); // email doanh nghiệp BẮT BUỘC (luật 02/11/2026)
    await thay(SALE_CS1, t.id, { email: "ketoan@thunghiem.example.com" });
    const ok = await xacNhan(KT_CS1, t.id);
    expect(ok).toMatchObject({ ok: true, nguoiMua: { loai: "DOANH_NGHIEP", maSoThue: MST_DN, email: "ketoan@thunghiem.example.com", cccd: null } });
  });
  it("hai nhân viên bấm xác nhận ĐỒNG THỜI ⇒ đúng một ok, người kia DA_DONG; đúng MỘT dòng audit xác nhận", async () => {
    for (let lan = 0; lan < 5; lan += 1) {
      await dungFixture();
      const t = await tao();
      await gui(t, DU_CA_NHAN);
      const [a, b, c] = await Promise.all([xacNhan(KT_CS1, t.id), xacNhan(SALE_CS1, t.id), xacNhan(HO, t.id)]);
      expect([a, b, c].filter((x) => x.ok)).toHaveLength(1);
      expect([a, b, c].filter((x) => !x.ok && x.ma === "DA_DONG")).toHaveLength(2);
      expect((await lichSu(t.id)).filter((x) => x.action === "XAC_NHAN_YEU_CAU_NGUOI_MUA")).toHaveLength(1);
    }
  });
  it("xác nhận chỉ ghi dữ liệu vào CHÍNH yêu cầu: đơn / hoá đơn / thu tiền trước-sau y hệt", async () => {
    const chup = async () => ({
      orders: JSON.stringify(await db.order.findMany({ where: { id: { startsWith: T } }, orderBy: { id: "asc" } })),
      hoaDon: await db.hoaDonDienTu.count({ where: { orderId: { startsWith: T } } }),
      payment: await db.payment.count({ where: { orderId: { startsWith: T } } }),
    });
    const truoc = await chup();
    const t = await tao();
    await mo(t);
    await gui(t, DU_CA_NHAN);
    await thay(SALE_CS1, t.id, { maSoThue: MST_DN });
    await xacNhan(KT_CS1, t.id);
    const t2 = await tao({ orderId: DON3 });
    await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t2.id, lyDo: "Huỷ để đo bảng khác", now: NOW });
    await quetHetHan({ now: phut(100_000), giuDuLieuNgay: 30, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 1000 });
    expect(await chup()).toEqual(truoc);
  });
});

chay("[YCM-DB-08] cô lập cơ sở tuyệt đối + quyền", () => {
  it("nhân viên CS2 KHÔNG tạo / nhập thay / xác nhận / huỷ được yêu cầu của CS1, trạng thái & dữ liệu không đổi; nhân viên CS1 và HO thì ĐƯỢC (đối chứng dương)", async () => {
    // Tạo trên đơn CS1 bởi kế toán CS2
    expect(await taoYeuCau({ actor: KT_CS2, nguoi: ng(KT_CS2), orderId: DON1, phamVi: "DON", ttlPhut: 240, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await kiemKhoaCoDinh()).toBe(0);
    const t = await tao();
    await gui(t, DU_CA_NHAN);
    const truoc = await hang(t.id);
    const nAudit = (await lichSu(t.id)).length;
    expect(await thay(KT_CS2, t.id, { diaChi: "Địa chỉ từ cơ sở khác" })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await xacNhan(KT_CS2, t.id)).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await huyYeuCau({ actor: KT_CS2, nguoi: ng(KT_CS2), id: t.id, lyDo: "Cố huỷ từ cơ sở khác", now: NOW })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await hang(t.id)).toEqual(truoc);
    expect((await lichSu(t.id)).length).toBe(nAudit);
    // Yêu cầu không tồn tại cho cùng mã lỗi với yêu cầu của cơ sở khác (không lộ sự tồn tại).
    expect(await xacNhan(KT_CS2, "id-khong-co-that")).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    // Đối chứng dương.
    expect((await thay(KT_CS1, t.id, { diaChi: "Địa chỉ do kế toán CS1" })).ok).toBe(true);
    expect((await xacNhan(HO, t.id)).ok).toBe(true);
    const t2 = await tao({ orderId: DON2, actor: KT_CS2 });
    expect(await hang(t2.id)).toMatchObject({ centerId: CS2 });
    expect((await huyYeuCau({ actor: HO, nguoi: ng(HO), id: t2.id, lyDo: "HO huỷ yêu cầu của CS2", now: NOW })).ok).toBe(true);
  });
  it("quyền: sale thiếu `orders:view-pii`, giáo viên, người không quyền nào ⇒ KHÔNG_CÓ_QUYỀN ở mọi thao tác; sale đủ hai quyền ⇒ được", async () => {
    const t = await tao();
    for (const a of [SALE_THIEU_PII, GV]) {
      expect(await taoYeuCau({ actor: a, nguoi: ng(a), orderId: DON3, phamVi: "DON", ttlPhut: 240, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
      expect(await thay(a, t.id, { ten: "Không được ghi" })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
      expect(await xacNhan(a, t.id)).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    }
    expect((await hang(t.id)).duLieuGui).toBeNull();
    expect((await tao({ actor: SALE_CS1, orderId: DON3 })).ok).toBe(true);
  });
  it("`centerId` của yêu cầu = cơ sở của ĐƠN (đọc từ DB), không phải của người tạo: HO tạo cho đơn CS2 ⇒ CS2", async () => {
    const t = await tao({ actor: HO, orderId: DON2 });
    expect((await hang(t.id)).centerId).toBe(CS2);
    expect(await taoYeuCau({ actor: HO, nguoi: ng(HO), orderId: "don-khong-co", phamVi: "DON", ttlPhut: 240, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
  });
  it("huỷ cần lý do đủ dài (không đổi trạng thái nếu ngắn); đủ dài ⇒ THU_HOI + lý do vào audit", async () => {
    const t = await tao();
    expect(await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, lyDo: "ngắn", now: NOW })).toMatchObject({ ok: false, ma: "LY_DO_NGAN" });
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
    expect((await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, lyDo: "Khách yêu cầu cấp lại", now: NOW })).ok).toBe(true);
    const a = (await lichSu(t.id)).find((x) => x.action === "HUY_YEU_CAU_NGUOI_MUA")!;
    expect(a.reason).toBe("Khách yêu cầu cấp lại");
    expect(a.actorId).toBe(KT_CS1.userId);
  });
  it("nhân viên nhập thay / xác nhận được CẢ khi liên kết đã quá hạn (TTL là hạn của liên kết công khai) nhưng chưa quét", async () => {
    const t = await tao({ ttlPhut: 10 });
    const muon = phut(60);
    expect((await thay(SALE_CS1, t.id, DU_CA_NHAN, muon)).ok).toBe(true);
    expect((await xacNhan(SALE_CS1, t.id, muon)).ok).toBe(true);
  });
});

chay("[YCM-DB-09] quét hết hạn + xoá dữ liệu quá thời hạn", () => {
  it("quá hạn mà PH CHƯA gửi ⇒ HET_HAN; quá hạn mà PH ĐÃ gửi ⇒ GIỮ DANG_MO (chờ nhân viên) và được đếm; chưa quá hạn ⇒ không đụng", async () => {
    const chuaGui = await tao({ ttlPhut: 10 });
    const daGui = await tao({ ttlPhut: 10, orderId: DON3 });
    await gui(daGui, DU_CA_NHAN, { now: phut(1) });
    const conHan = await tao({ ttlPhut: 600, orderId: DON2, actor: KT_CS2 });
    const kq = await quetHetHan({ now: phut(11), giuDuLieuNgay: 30, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 1000 });
    expect(kq.hetHan).toBeGreaterThanOrEqual(1);
    expect(kq.choXuLyQuaHan).toBeGreaterThanOrEqual(1);
    expect((await hang(chuaGui.id)).trangThai).toBe("HET_HAN");
    expect((await hang(daGui.id)).trangThai).toBe("DANG_MO");
    expect((await hang(conHan.id)).trangThai).toBe("DANG_MO");
    expect((await lichSu(chuaGui.id)).map((a) => a.action)).toEqual(["TAO_YEU_CAU_NGUOI_MUA", "HET_HAN_YEU_CAU_NGUOI_MUA"]);
    // sau khi HET_HAN, đơn tạo lại được
    expect((await tao()).ok).toBe(true);
    // chạy lại ⇒ không đổi thêm (idempotent)
    const lai = await quetHetHan({ now: phut(11), giuDuLieuNgay: 30, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 1000 });
    expect(lai.hetHan).toBe(0);
    expect((await lichSu(chuaGui.id)).filter((a) => a.action === "HET_HAN_YEU_CAU_NGUOI_MUA")).toHaveLength(1);
  });
  it("dữ liệu `duLieuGui` của yêu cầu ĐÃ ĐÓNG quá N ngày ⇒ NULL; chưa đủ N ngày ⇒ giữ; yêu cầu còn DANG_MO ⇒ không bao giờ xoá", async () => {
    const cu = await tao();
    await gui(cu, DU_CA_NHAN, { now: phut(1) });
    await xacNhan(KT_CS1, cu.id, phut(2)); // DA_AP_DUNG, updatedAt = phut(2)
    const moiDong = await tao({ orderId: DON3 });
    await gui(moiDong, DU_CA_NHAN, { now: phut(1) });
    await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: moiDong.id, lyDo: "Huỷ để thử thời hạn giữ", now: new Date(NOW.getTime() + 25 * 86_400_000) });
    const dangMo = await tao({ orderId: DON2, actor: KT_CS2 });
    await gui(dangMo, DU_CA_NHAN, { now: phut(1) });

    const ngay31 = new Date(NOW.getTime() + 31 * 86_400_000);
    const kq = await quetHetHan({ now: ngay31, giuDuLieuNgay: 30, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 1000 });
    expect(kq.daXoaDuLieu).toBeGreaterThanOrEqual(1);
    expect((await hang(cu.id)).duLieuGui).toBeNull(); // đóng cách 31 ngày
    expect((await hang(moiDong.id)).duLieuGui).not.toBeNull(); // mới đóng cách 6 ngày ⇒ giữ (đối chứng)
    expect((await hang(dangMo.id)).duLieuGui).not.toBeNull(); // DANG_MO ⇒ không xoá
    expect((await lichSu(cu.id)).map((a) => a.action)).toContain("XOA_DU_LIEU_QUA_HAN_YEU_CAU_NGUOI_MUA");
    // đủ N ngày kể từ lúc huỷ ⇒ xoá nốt
    await quetHetHan({ now: new Date(NOW.getTime() + 56 * 86_400_000), giuDuLieuNgay: 30, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 1000 });
    expect((await hang(moiDong.id)).duLieuGui).toBeNull();
    // Tham số hỏng ⇒ ném, không xoá gì
    await expect(quetHetHan({ now: ngay31, giuDuLieuNgay: 0, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 10 })).rejects.toThrow(RangeError);
  });
});

chay("[YCM-DB-11] quét: theo phạm vi cơ sở; tự đóng yêu cầu đã gửi mà không ai xử lý CHỈ khi đường gọi chọn số ngày", () => {
  const QUET = { giuDuLieuNgay: 30, lo: 1000 } as const;
  it("phạm vi [CS1] không đụng yêu cầu CS2; phạm vi RỖNG ⇒ không làm gì (fail-closed); đúng phạm vi ⇒ đóng", async () => {
    const cs1 = await tao({ ttlPhut: 10 });
    const cs2 = await tao({ ttlPhut: 10, orderId: DON2, actor: KT_CS2 });
    expect(await quetHetHan({ now: phut(11), ...QUET, choXuLyToiDaNgay: null, phamVi: [] })).toEqual({ hetHan: 0, daXoaDuLieu: 0, choXuLyQuaHan: 0 });
    expect((await hang(cs1.id)).trangThai).toBe("DANG_MO");
    expect((await hang(cs2.id)).trangThai).toBe("DANG_MO");
    await quetHetHan({ now: phut(11), ...QUET, choXuLyToiDaNgay: null, phamVi: [CS1] });
    expect((await hang(cs1.id)).trangThai).toBe("HET_HAN");
    expect((await hang(cs2.id)).trangThai).toBe("DANG_MO"); // ngoài phạm vi
    await quetHetHan({ now: phut(11), ...QUET, choXuLyToiDaNgay: null, phamVi: [CS2] });
    expect((await hang(cs2.id)).trangThai).toBe("HET_HAN"); // đối chứng: đúng phạm vi thì đóng
  });
  it("`choXuLyToiDaNgay` = null: yêu cầu ĐÃ GỬI quá hạn ở yên mãi (chỉ được đếm); = số ngày: đóng khi gửi quá ngần ấy ngày, và chưa đủ ngày thì giữ (đối chứng)", async () => {
    const t = await tao({ ttlPhut: 10 });
    await gui(t, DU_CA_NHAN, { now: phut(1) });
    const NGAY = 86_400_000;
    const a = await quetHetHan({ now: new Date(NOW.getTime() + 400 * NGAY), ...QUET, choXuLyToiDaNgay: null, phamVi: [CS1] });
    expect(a.hetHan).toBe(0);
    expect(a.choXuLyQuaHan).toBe(1);
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
    const chua = await quetHetHan({ now: new Date(NOW.getTime() + 2 * NGAY), ...QUET, choXuLyToiDaNgay: 3, phamVi: [CS1] });
    expect(chua.hetHan).toBe(0);
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
    const du = await quetHetHan({ now: new Date(NOW.getTime() + 4 * NGAY), ...QUET, choXuLyToiDaNgay: 3, phamVi: [CS1] });
    expect(du.hetHan).toBe(1);
    expect((await hang(t.id)).trangThai).toBe("HET_HAN");
    expect((await hang(t.id)).duLieuGui).not.toBeNull(); // mới đóng ⇒ dữ liệu còn tới hết `giuDuLieuNgay`
    await quetHetHan({ now: new Date(NOW.getTime() + 35 * NGAY), ...QUET, choXuLyToiDaNgay: 3, phamVi: [CS1] });
    expect((await hang(t.id)).duLieuGui).toBeNull();
    expect((await tao()).ok).toBe(true); // đơn được giải phóng
  });
  it("tham số hỏng ⇒ ném RangeError (không biến thành 'không bao giờ đóng')", async () => {
    for (const x of [0, -1, 1.5]) await expect(quetHetHan({ now: NOW, ...QUET, choXuLyToiDaNgay: x, phamVi: [CS1] })).rejects.toThrow(RangeError);
    await expect(quetHetHan({ now: NOW, ...QUET, choXuLyToiDaNgay: 3, phamVi: [CS1] })).resolves.toBeDefined();
  });
});

chay("[YCM-DB-12] `xacNhanYeuCauTrongTx`: ghép với phép ghi đơn trong MỘT giao dịch ⇒ cùng thành công hoặc cùng rollback", () => {
  const donTen = async () => (await db.order.findUniqueOrThrow({ where: { id: DON1 }, select: { invoiceBuyerName: true } })).invoiceBuyerName;
  const sanSang = async () => {
    const t = await tao();
    await gui(t, DU_CA_NHAN);
    return t;
  };

  it("lõi + ghi `Order.invoiceBuyerName` cùng giao dịch ⇒ cả hai có hiệu lực", async () => {
    const t = await sanSang();
    const r = await db.$transaction(async (tx) => {
      const x = await xacNhanYeuCauTrongTx(tx, { actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, now: phut(1) });
      await tx.order.update({ where: { id: x.orderId }, data: { invoiceBuyerName: x.nguoiMua.ten } });
      return x;
    });
    expect(r.nguoiMua.ten).toBe(TEN_PH);
    expect((await hang(t.id)).trangThai).toBe("DA_AP_DUNG");
    expect(await donTen()).toBe(TEN_PH);
  });
  it("ghi đơn LỖI sau khi lõi chạy ⇒ yêu cầu VẪN DANG_MO, không có dòng audit xác nhận, đơn không đổi (không có 'đã áp dụng mà đơn chưa đổi')", async () => {
    const t = await sanSang();
    const truoc = await donTen();
    await expect(
      db.$transaction(async (tx) => {
        const x = await xacNhanYeuCauTrongTx(tx, { actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, now: phut(1) });
        await tx.order.update({ where: { id: x.orderId }, data: { invoiceBuyerName: x.nguoiMua.ten } });
        throw new Error("sập sau khi ghi đơn");
      }),
    ).rejects.toThrow("sập sau khi ghi đơn");
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
    expect(await donTen()).toBe(truoc);
    expect((await lichSu(t.id)).map((a) => a.action)).not.toContain("XAC_NHAN_YEU_CAU_NGUOI_MUA");
    // đối chứng: làm lại không lỗi ⇒ xác nhận được (yêu cầu không bị kẹt)
    expect((await xacNhanYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, now: phut(2) })).ok).toBe(true);
  });
  it("lõi TỪ CHỐI (thiếu thông tin) bằng NÉM `TuChoi` ⇒ phép ghi đơn đặt TRƯỚC lõi cũng rollback; bắt ngoài giao dịch bằng `sangLoi` ra mã lỗi nghiệp vụ", async () => {
    const t = await tao(); // chưa có ô nào
    const truoc = await donTen();
    let loi: unknown;
    try {
      await db.$transaction(async (tx) => {
        await tx.order.update({ where: { id: DON1 }, data: { invoiceBuyerName: "Ghi trước lõi" } });
        await xacNhanYeuCauTrongTx(tx, { actor: KT_CS1, nguoi: ng(KT_CS1), id: t.id, now: phut(1) });
      });
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(TuChoi);
    expect(sangLoi(loi as InstanceType<typeof TuChoi>)).toMatchObject({ ok: false, ma: "THIEU_THONG_TIN" });
    expect(await donTen()).toBe(truoc);
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
  });
  it("lõi vẫn cô lập cơ sở: kế toán CS2 gọi lõi trên yêu cầu CS1 ⇒ NÉM KHONG_CO_QUYEN, không đổi gì", async () => {
    const t = await sanSang();
    await expect(db.$transaction((tx) => xacNhanYeuCauTrongTx(tx, { actor: KT_CS2, nguoi: ng(KT_CS2), id: t.id, now: phut(1) }))).rejects.toMatchObject({ ma: "KHONG_CO_QUYEN" });
    expect((await hang(t.id)).trangThai).toBe("DANG_MO");
  });
});

chay("[YCM-DB-10] token thô và giá trị ô KHÔNG rò vào DB / audit / log", () => {
  it("chạy cả vòng đời (kể cả token sai, khoá, quét) rồi quét: token thô không nằm ở hàng nào, audit nào, log nào; giá trị ô không nằm ở audit / log; tên ô thì có (đối chứng dương)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
    const t = await tao();
    const sai = "sai-token-thu-nghiem-ycmx";
    for (let i = 0; i < 3; i += 1) await mo(t, { token: `${sai}-${i}`, g: G, now: phut(1) });
    await mo(t, { g: G, now: phut(40) });
    await gui(t, { ...DU_CA_NHAN, ten: TEN_PH }, { g: G, now: phut(41) });
    await thay(SALE_CS1, t.id, { loai: "DOANH_NGHIEP", ten: "Tên Sale YCMX", maSoThue: MST_DN }, phut(42));
    await xacNhan(KT_CS1, t.id, phut(43));
    const t2 = await tao({ orderId: DON3 });
    await huyYeuCau({ actor: KT_CS1, nguoi: ng(KT_CS1), id: t2.id, lyDo: "Huỷ để quét rò rỉ", now: phut(44) });
    await quetHetHan({ now: phut(100_000), giuDuLieuNgay: 30, choXuLyToiDaNgay: null, phamVi: [CS1, CS2], lo: 1000 });

    const hangs = JSON.stringify(await tbl().findMany({ where: { orderId: { startsWith: T } } }));
    const audits = JSON.stringify(await db.auditLog.findMany({ where: { entityType: "HoaDonYeuCauNguoiMua", entityId: { in: [t.id, t2.id] } } }));
    const logs = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const token of [t.token, t2.token]) {
      expect(hangs).not.toContain(token);
      expect(audits).not.toContain(token);
      expect(logs).not.toContain(token);
      expect(audits).not.toContain(bamToken(token)); // cả hash cũng không vào audit
    }
    expect(hangs).toContain(bamToken(t.token)); // đối chứng: hash thì có ở hàng
    // CCCD ba/mẹ (từ 02/11/2026) cũng KHÔNG được lọt vào audit / log — chỉ TÊN ô ("cccd") được phép có mặt.
    for (const v of [TEN_PH, DIA_CHI_PH, EMAIL_PH, MST_DN, "Tên Sale YCMX", CCCD_PH]) {
      expect(audits).not.toContain(v);
      expect(logs).not.toContain(v);
    }
    // đối chứng dương: audit mang TÊN ô đã đổi
    const gAudit = (await lichSu(t.id)).find((a) => a.action === "PHU_HUYNH_GUI_THONG_TIN_NGUOI_MUA")!;
    expect(gAudit.newValues).toMatchObject({ trangThai: "DANG_MO", oDaDoi: ["loai", "ten", "diaChi", "email", "cccd"] });
    expect(gAudit.actorId).toBeNull();
    // quét bằng SQL: không cột nào của hàng chứa token thô
    const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "HoaDonYeuCauNguoiMua" t WHERE t::text LIKE ${"%" + t.token + "%"}`;
    expect(Number(n)).toBe(0);
  });
});
