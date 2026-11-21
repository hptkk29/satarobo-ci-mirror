// Ca [LKD-*] — SIGNATURE ENGINE của hoá đơn (Invoice Hub S9: lệnh ký) TRÊN POSTGRES THẬT. KHÔNG ký thật, không nhà cung cấp, không PIN/khoá.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-lenh-ky-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố `fx-lky-`; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH.
// Mọi ca "KHÔNG được" kèm đối chứng dương. Đồng hồ ĐÓNG BĂNG (luật 19): `now` được truyền vào.
// Lệnh ký nhận id cuid (không mang tiền tố) ⇒ dọn bằng cách gom id theo `hoaDonId` có tiền tố.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  CHINH_SACH_KY_NGHIEM_NHAT,
  type ChinhSachDuyetKy,
  type PhuongThucKy,
} from "@/lib/finance/hoa-don/lenh-ky-trang-thai";
import { bamDuLieuCanKy, type BoKy } from "@/lib/finance/hoa-don/lenh-ky-bo-ky";
import { taoBoKyGia } from "@/lib/finance/hoa-don/lenh-ky-bo-ky-gia";
import { duyetVaBatDauKy, ghiLoiKy, hoanTatKy, huyLenhKy, quetHetHan, taoLenhKy } from "@/lib/finance/hoa-don/lenh-ky-db";
import { khoaNgoaiLeTucThoi } from "@/lib/finance/hoa-don/ngoai-le-tuc-thoi";

if (!RUN_DB_TESTS) console.warn(`[LKD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-lky-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON1 = `${T}don1`; // CS1
const DON2 = `${T}don2`; // CS2
const DON3 = `${T}don3`; // CS1
const HD1 = `${T}hd1`; // CS1
const HD2 = `${T}hd2`; // CS2
const HD3 = `${T}hd3`; // CS1 (hoá đơn thứ hai cùng cơ sở)
const NOW = new Date("2026-11-02T03:00:00.000Z");
const PHUT = (n: number) => new Date(NOW.getTime() + n * 60_000);
const HASH = bamDuLieuCanKy("du-lieu-can-ky-lky-fixture");
const DAU_BI_MAT = "DAU-HIEU-BI-MAT-LKY-77";
const LY_DO_HUY = "Khách đổi pháp nhân, tạo lệnh khác";
const NGHIEM = CHINH_SACH_KY_NGHIEM_NHAT;

const actorKeToan = (userId: string, centerScope: "ALL" | string[]): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: centerScope === "ALL",
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "KE_TOAN", centerScope }],
    visibleCenterIds: centerScope === "ALL" ? [] : centerScope,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
const kt1a = actorKeToan(`${T}kt1a`, [CS1]);
const kt1b = actorKeToan(`${T}kt1b`, [CS1]);
const kt1c = actorKeToan(`${T}kt1c`, [CS1]);
const kt2 = actorKeToan(`${T}kt2`, [CS2]);
const ktHo = actorKeToan(`${T}ho`, "ALL");
/** Có TẦM NHÌN CS1 qua quyền khác (sale) nhưng KHÔNG phải kế toán. */
const saleCs1: Actor = {
  userId: `${T}sale`,
  isSuperAdmin: false,
  isHoLevel: false,
  orgRoles: [],
  permissions: [{ action: "payments:record", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [CS1] }],
  visibleCenterIds: [CS1],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Actor;

async function don() {
  const lenh = await db.hoaDonLenhKy.findMany({ where: { OR: [{ hoaDonId: { startsWith: T } }, { centerId: { in: [CS1, CS2] } }] }, select: { id: true } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: { in: [CS1, CS2] } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"] } } });
  await db.orgUnit.deleteMany({ where: { code: { startsWith: `${T}ou` } } });
  await db.auditLog.deleteMany({ where: { entityType: "HoaDonLenhKy", entityId: { in: lenh.map((l) => l.id) } } });
  await db.hoaDonLenhKy.deleteMany({ where: { id: { in: lenh.map((l) => l.id) } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const [id, ten] of [[CS1, "CS1 LKY"], [CS2, "CS2 LKY"]] as const) await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  for (const [id, ma, coSo] of [[DON1, "ORD-269974-000001", CS1], [DON2, "ORD-269974-000002", CS2], [DON3, "ORD-269974-000003", CS1]] as const) {
    await db.order.create({ data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: "Phụ huynh LKY", customerPhone: "0328545551", totalAmount: 5_000_000, centerId: coSo } });
  }
  for (const [id, donId, coSo] of [[HD1, DON1, CS1], [HD2, DON2, CS2], [HD3, DON3, CS1]] as const) {
    await db.hoaDonDienTu.create({ data: { id, orderId: donId, centerId: coSo, trangThai: "NHAP", tongTien: 5_000_000, taoBoiId: `${T}kt` } });
  }
  await db.payment.create({ data: { id: `${T}pay1`, orderId: DON1, amount: 5_000_000, method: "CASH", paidDate: NOW, centerId: CS1 } });
}

const tao = (actor: Actor, o: Partial<Parameters<typeof taoLenhKy>[0]> = {}) =>
  taoLenhKy({ actor, ten: "KT", hoaDonId: HD1, phuongThuc: "USB_TOKEN", duLieuCanKyHash: HASH, ttlPhut: 30, now: NOW, ...o });
const duyet = (actor: Actor, lenhId: string, o: Partial<Parameters<typeof duyetVaBatDauKy>[0]> = {}) =>
  duyetVaBatDauKy({ actor, ten: "KT", lenhId, chinhSach: NGHIEM, now: PHUT(1), ...o });
const hoanTat = (actor: Actor, lenhId: string, boKy: BoKy, o: Partial<Parameters<typeof hoanTatKy>[0]> = {}) =>
  hoanTatKy({ actor, ten: "KT", lenhId, boKy, chinhSach: NGHIEM, now: PHUT(2), ...o });

async function taoOk(actor: Actor, o: Partial<Parameters<typeof taoLenhKy>[0]> = {}): Promise<string> {
  const kq = await tao(actor, o);
  if (!kq.ok) throw new Error(`taoLenhKy phải ok: ${kq.ma}`);
  return kq.id;
}
async function denDangKy(nguoiTao: Actor, nguoiDuyet: Actor, o: Partial<Parameters<typeof taoLenhKy>[0]> = {}): Promise<string> {
  const id = await taoOk(nguoiTao, o);
  const kq = await duyet(nguoiDuyet, id);
  if (!kq.ok) throw new Error(`duyetVaBatDauKy phải ok: ${kq.ma}`);
  return id;
}

const lenhTheoHoaDon = (hoaDonId: string) => db.hoaDonLenhKy.findMany({ where: { hoaDonId }, orderBy: { createdAt: "asc" } });
const lenh = (id: string) => db.hoaDonLenhKy.findUniqueOrThrow({ where: { id } });
const auditCua = (id: string) => db.auditLog.findMany({ where: { entityType: "HoaDonLenhKy", entityId: id }, orderBy: { createdAt: "asc" } });
const tatCaAudit = async () => {
  const ids = (await db.hoaDonLenhKy.findMany({ where: { hoaDonId: { startsWith: T } }, select: { id: true } })).map((l) => l.id);
  return db.auditLog.findMany({ where: { entityType: "HoaDonLenhKy", entityId: { in: ids } } });
};
const chup = async () =>
  JSON.stringify({
    hoaDon: await db.hoaDonDienTu.findMany({ where: { id: { startsWith: T } }, orderBy: { id: "asc" } }),
    don: await db.order.findMany({ where: { id: { startsWith: T } }, orderBy: { id: "asc" } }),
    thu: await db.payment.findMany({ where: { orderId: { startsWith: T } }, orderBy: { id: "asc" } }),
  });

beforeEach(async () => {
  if (RUN_DB_TESTS) await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[LKD-01] vòng đời: CHO_KY → DANG_KY → DA_KY, mỗi bước một dòng audit cùng giao dịch, chỉ lưu HASH", () => {
  it("đi trọn vòng; cơ sở lấy từ HOÁ ĐƠN; người yêu cầu / người ký đúng; hạn lệnh = now + ttl", async () => {
    const id = await taoOk(kt1a);
    let r = await lenh(id);
    expect(r).toMatchObject({
      hoaDonId: HD1,
      centerId: CS1,
      phuongThuc: "USB_TOKEN",
      trangThai: "CHO_KY",
      nguoiYeuCauId: kt1a.userId,
      nguoiKyId: null,
      duLieuCanKyHash: HASH,
      maGiaoDich: null,
      chungThuHetHan: null,
    });
    expect(r.hetHanLuc?.toISOString()).toBe(PHUT(30).toISOString());

    const d = await duyet(kt1b, id);
    expect(d).toMatchObject({ ok: true, trangThai: "DANG_KY", nguoiKyId: kt1b.userId });
    r = await lenh(id);
    expect(r).toMatchObject({ trangThai: "DANG_KY", nguoiKyId: kt1b.userId });

    const bo = taoBoKyGia("THANH_CONG");
    const h = await hoanTat(kt1b, id, bo);
    expect(h).toMatchObject({ ok: true, trangThai: "DA_KY", maGiaoDich: "GD-GIA-1" });
    r = await lenh(id);
    expect(r).toMatchObject({ trangThai: "DA_KY", maGiaoDich: "GD-GIA-1", nguoiKyId: kt1b.userId });
    expect(r.chungThuHetHan?.toISOString().slice(0, 10)).toBe("2027-11-02");
    expect(bo.cacHashDaNhan).toEqual([HASH]); // bộ ký chỉ nhận HASH

    const a = await auditCua(id);
    expect(a.map((x) => x.action)).toEqual(["TAO_LENH_KY_HOA_DON", "DUYET_BAT_DAU_KY_HOA_DON", "HOAN_TAT_KY_HOA_DON"]);
    expect(a.map((x) => (x.newValues as { trangThai: string }).trangThai)).toEqual(["CHO_KY", "DANG_KY", "DA_KY"]);
    expect((a[1]!.oldValues as { trangThai: string }).trangThai).toBe("CHO_KY");
    expect((a[2]!.oldValues as { trangThai: string }).trangThai).toBe("DANG_KY");
    expect(a.map((x) => x.actorId)).toEqual([kt1a.userId, kt1b.userId, kt1b.userId]);
  });

  it("audit KHÔNG mang hash dữ liệu cần ký (chỉ id / trạng thái / phương thức)", async () => {
    const id = await denDangKy(kt1a, kt1b);
    await hoanTat(kt1b, id, taoBoKyGia("THANH_CONG"));
    const json = JSON.stringify((await auditCua(id)).map((x) => [x.oldValues, x.newValues, x.reason]));
    expect(json).not.toContain(HASH);
    expect(json).not.toMatch(/[0-9a-f]{64}/);
    expect(json).toContain("USB_TOKEN"); // đối chứng dương: audit CÓ nội dung hữu ích
  });

  it("ĐỐI CHỨNG: lệnh ký KHÔNG sửa hoá đơn / đơn / khoản thu — ảnh chụp ba bảng trước-sau GIỐNG HỆT qua cả vòng đời, kể cả các lượt bị từ chối", async () => {
    const truoc = await chup();
    const id = await taoOk(kt1a);
    await duyet(kt1a, id); // bị từ chối (tách nhiệm vụ)
    await duyet(kt2, id); // bị từ chối (chéo cơ sở)
    await duyet(kt1b, id);
    await hoanTat(kt1b, id, taoBoKyGia("NEM"));
    const id2 = await denDangKy(kt1a, kt1b, { hoaDonId: HD3 });
    await hoanTat(kt1b, id2, taoBoKyGia("THANH_CONG"));
    await tao(kt1a, { hoaDonId: HD2, phuongThuc: "THU_CONG" }); // kt1a không có quyền CS2 ⇒ bị từ chối, không để lại dấu vết
    await huyLenhKy({ actor: ktHo, ten: "HO", lenhId: await taoOk(ktHo, { hoaDonId: HD2 }), lyDo: LY_DO_HUY, now: PHUT(3) });
    expect(await chup()).toBe(truoc);
  });
});

chay("[LKD-02] HAI người cùng duyệt một lệnh ⇒ đúng MỘT thắng (ghi có điều kiện trạng thái cũ)", () => {
  it("nhiều vòng đua: mỗi vòng đúng một ok, đúng MỘT dòng audit DUYỆT, người ký = người thắng", async () => {
    for (let vong = 0; vong < 8; vong++) {
      await dungFixture();
      const id = await taoOk(kt1a);
      const kq = await Promise.all([duyet(kt1b, id), duyet(kt1c, id)]);
      expect(kq.filter((k) => k.ok), `vòng ${vong}`).toHaveLength(1);
      const thua = kq.find((k) => !k.ok);
      expect(thua && !thua.ok && ["DA_DOI", "CHUYEN"].includes(thua.ma)).toBe(true);
      const r = await lenh(id);
      const nguoiThang = kq[0]!.ok ? kt1b.userId : kt1c.userId;
      expect(r).toMatchObject({ trangThai: "DANG_KY", nguoiKyId: nguoiThang });
      expect((await auditCua(id)).filter((a) => a.action === "DUYET_BAT_DAU_KY_HOA_DON")).toHaveLength(1);
    }
  });

  it("huỷ và duyệt đua nhau: đúng một thắng, trạng thái cuối khớp với audit của người thắng", async () => {
    for (let vong = 0; vong < 6; vong++) {
      await dungFixture();
      const id = await taoOk(kt1a);
      const [d, h] = await Promise.all([duyet(kt1b, id), huyLenhKy({ actor: kt1c, ten: "KT", lenhId: id, lyDo: LY_DO_HUY, now: PHUT(1) })]);
      expect([d.ok, h.ok].filter(Boolean), `vòng ${vong}`).toHaveLength(1);
      const r = await lenh(id);
      expect(r.trangThai).toBe(d.ok ? "DANG_KY" : "HUY");
      const act = (await auditCua(id)).map((a) => a.action).filter((a) => a !== "TAO_LENH_KY_HOA_DON");
      expect(act).toEqual([d.ok ? "DUYET_BAT_DAU_KY_HOA_DON" : "HUY_LENH_KY_HOA_DON"]);
    }
  });
});

chay("[LKD-03] MỘT lệnh sống mỗi hoá đơn", () => {
  it("lệnh thứ hai cho cùng hoá đơn ⇒ DA_CO_LENH_SONG, không thêm dòng; đối chứng: hoá đơn KHÁC vẫn tạo được; sau khi lệnh cũ bị HUỶ thì tạo được lệnh mới", async () => {
    const id1 = await taoOk(kt1a);
    expect(await tao(kt1b)).toMatchObject({ ok: false, ma: "DA_CO_LENH_SONG" });
    expect(await lenhTheoHoaDon(HD1)).toHaveLength(1);
    // vẫn chặn khi lệnh cũ đã sang DANG_KY (cũng là trạng thái sống)
    await duyet(kt1b, id1);
    expect(await tao(kt1b)).toMatchObject({ ok: false, ma: "DA_CO_LENH_SONG" });
    expect((await tao(kt1a, { hoaDonId: HD3 })).ok).toBe(true);
  });

  it("sau HUY, LOI_KY, DA_KY hay HET_HAN lệnh cũ không còn chặn: tạo được lệnh mới", async () => {
    const a = await taoOk(kt1a);
    expect((await huyLenhKy({ actor: kt1b, ten: "KT", lenhId: a, lyDo: LY_DO_HUY, now: PHUT(1) })).ok).toBe(true);
    const b = await denDangKy(kt1a, kt1b);
    await hoanTat(kt1b, b, taoBoKyGia("TU_CHOI"));
    expect((await lenh(b)).trangThai).toBe("LOI_KY");
    const c = await denDangKy(kt1a, kt1b);
    await hoanTat(kt1b, c, taoBoKyGia("THANH_CONG"));
    expect((await lenh(c)).trangThai).toBe("DA_KY");
    expect((await tao(kt1a)).ok).toBe(true);
    expect(await lenhTheoHoaDon(HD1)).toHaveLength(4);
  });

  it("ĐUA khi tạo: ba lượt tạo đồng thời cho một hoá đơn ⇒ đúng một ok, còn lại DA_CO_LENH_SONG (P2002 của chỉ mục từng phần được dịch, không ném)", async () => {
    const kq = await Promise.all([tao(kt1a), tao(kt1b), tao(kt1c)]);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok && k.ma === "DA_CO_LENH_SONG")).toHaveLength(2);
    expect(await lenhTheoHoaDon(HD1)).toHaveLength(1);
    expect((await tatCaAudit()).filter((a) => a.action === "TAO_LENH_KY_HOA_DON")).toHaveLength(1);
  });
});

chay("[LKD-04] TÁCH NHIỆM VỤ + chính sách duyệt (mặc định fail-closed)", () => {
  it("mặc định: cùng người yêu cầu rồi tự duyệt ⇒ TACH_NHIEM_VU, DB không đổi, không audit mới; đối chứng: người khác duyệt được", async () => {
    const id = await taoOk(kt1a);
    expect(await duyet(kt1a, id)).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
    expect(await lenh(id)).toMatchObject({ trangThai: "CHO_KY", nguoiKyId: null });
    expect(await auditCua(id)).toHaveLength(1);
    expect((await duyet(kt1b, id)).ok).toBe(true);
  });

  it("ĐỐI CHỨNG DƯƠNG: chính sách CỦA CƠ SỞ ĐÓ khai `khacNguoi.USB_TOKEN = false` ⇒ cùng người được; chính sách của cơ sở KHÁC thì không giúp gì", async () => {
    const id = await taoOk(kt1a);
    const choCs2: ChinhSachDuyetKy = { theoCoSo: { [CS2]: { khacNguoi: { USB_TOKEN: false } } } };
    expect(await duyet(kt1a, id, { chinhSach: choCs2 })).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
    const choCs1: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { khacNguoi: { USB_TOKEN: false } } } };
    expect(await duyet(kt1a, id, { chinhSach: choCs1 })).toMatchObject({ ok: true });
  });

  it("HSM tự ký: chỉ khi cơ sở của hoá đơn khai `hsmTuKy: true`; đối chứng: mặc định thì người yêu cầu KHÔNG tự duyệt được HSM; CS1 bật không giúp CS2", async () => {
    const choCs1: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { hsmTuKy: true } } };
    const mac = await taoOk(kt1a, { phuongThuc: "HSM_NHA_CUNG_CAP" });
    expect(await duyet(kt1a, mac)).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
    expect(await duyet(kt1a, mac, { chinhSach: choCs1 })).toMatchObject({ ok: true, trangThai: "DANG_KY", nguoiKyId: kt1a.userId });
    expect((await hoanTat(kt1a, mac, taoBoKyGia("THANH_CONG"), { chinhSach: choCs1 })).ok).toBe(true);
    // CS2: chính sách chỉ mở cho CS1
    const cs2 = await taoOk(kt2, { hoaDonId: HD2, phuongThuc: "HSM_NHA_CUNG_CAP" });
    expect(await duyet(kt2, cs2, { chinhSach: choCs1 })).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
  });

  it("dữ liệu KHÔNG nới được USB token: `hsmTuKy: true` của cơ sở vẫn bắt USB phải khác người", async () => {
    const choCs1: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { hsmTuKy: true } } };
    const id = await taoOk(kt1a, { phuongThuc: "USB_TOKEN" });
    expect(await duyet(kt1a, id, { chinhSach: choCs1 })).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
  });

  it("chính sách siết SAU khi lệnh đã sang DANG_KY: hoàn tất lại kiểm tách nhiệm vụ ⇒ từ chối, bộ ký KHÔNG được gọi (đối chứng: chính sách cũ thì chạy)", async () => {
    const nho: ChinhSachDuyetKy = { theoCoSo: { [CS1]: { khacNguoi: { USB_TOKEN: false } } } };
    const id = await taoOk(kt1a);
    expect((await duyet(kt1a, id, { chinhSach: nho })).ok).toBe(true);
    const bo = taoBoKyGia("THANH_CONG");
    expect(await hoanTat(kt1a, id, bo, { chinhSach: NGHIEM })).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
    expect(bo.soLanGoi).toBe(0);
    expect((await lenh(id)).trangThai).toBe("DANG_KY");
    expect((await hoanTat(kt1a, id, bo, { chinhSach: nho })).ok).toBe(true);
  });
});

chay("[LKD-05] CÁCH LY CƠ SỞ: kế toán CS1 không thao tác được lệnh CS2", () => {
  it("tạo: kế toán CS2 / sale CS1 không tạo được lệnh cho hoá đơn CS1, và DB không có dòng nào; đối chứng: kế toán CS1 và Hội sở tạo được", async () => {
    expect(await tao(kt2)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await tao(saleCs1)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await tao(kt1a, { hoaDonId: `${T}khong-co` })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await lenhTheoHoaDon(HD1)).toHaveLength(0);
    expect(await tatCaAudit()).toHaveLength(0);
    expect((await tao(kt1a)).ok).toBe(true);
    expect((await tao(ktHo, { hoaDonId: HD2 })).ok).toBe(true);
  });

  it("cơ sở của lệnh lấy từ HOÁ ĐƠN: Hội sở tạo cho hoá đơn CS2 ⇒ lệnh mang centerId CS2", async () => {
    const id = await taoOk(ktHo, { hoaDonId: HD2 });
    expect((await lenh(id)).centerId).toBe(CS2);
  });

  it("duyệt / hoàn tất / huỷ lệnh của cơ sở khác ⇒ KHONG_THAY, trạng thái không đổi, không audit mới, bộ ký không được gọi; đối chứng: đúng cơ sở và Hội sở thì được", async () => {
    const a = await taoOk(kt1a);
    expect(await duyet(kt2, a)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await huyLenhKy({ actor: kt2, ten: "KT2", lenhId: a, lyDo: LY_DO_HUY, now: PHUT(1) })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await duyet(saleCs1, a)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await lenh(a)).toMatchObject({ trangThai: "CHO_KY", nguoiKyId: null });
    expect(await auditCua(a)).toHaveLength(1);

    const b = await denDangKy(kt1a, kt1b, { hoaDonId: HD3 });
    const bo = taoBoKyGia("THANH_CONG");
    expect(await hoanTat(kt2, b, bo)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await ghiLoiKy({ actor: kt2, ten: "KT2", lenhId: b, maLoi: "TU_CHOI", now: PHUT(2) })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(bo.soLanGoi).toBe(0);
    expect((await lenh(b)).trangThai).toBe("DANG_KY");

    expect((await duyet(ktHo, a)).ok).toBe(true);
    expect((await hoanTat(kt1b, b, bo)).ok).toBe(true);
  });

  it("quét hết hạn có PHẠM VI: người quét chỉ CS1 không đụng lệnh CS2 quá hạn; 'ALL' thì có", async () => {
    const a = await taoOk(kt1a, { ttlPhut: 5 });
    const b = await taoOk(kt2, { hoaDonId: HD2, ttlPhut: 5 });
    const sau = PHUT(10);
    expect(await quetHetHan({ now: sau, phamVi: [CS1] })).toMatchObject({ soLenh: 1 });
    expect((await lenh(a)).trangThai).toBe("HET_HAN");
    expect((await lenh(b)).trangThai).toBe("CHO_KY");
    expect(await quetHetHan({ now: sau, phamVi: [] })).toMatchObject({ soLenh: 0 });
    expect(await quetHetHan({ now: sau, phamVi: "ALL" })).toMatchObject({ soLenh: 1 });
    expect((await lenh(b)).trangThai).toBe("HET_HAN");
  });
});

chay("[LKD-06] HẾT HẠN", () => {
  it("đúng tại mốc hết hạn không duyệt được (HET_HAN), lệnh vẫn CHO_KY chờ quét; còn 1 phút trước mốc thì duyệt được", async () => {
    const id = await taoOk(kt1a, { ttlPhut: 30 });
    expect(await duyet(kt1b, id, { now: PHUT(30) })).toMatchObject({ ok: false, ma: "HET_HAN" });
    expect(await lenh(id)).toMatchObject({ trangThai: "CHO_KY", nguoiKyId: null });
    expect((await duyet(kt1b, id, { now: PHUT(29) })).ok).toBe(true);
  });

  it("hoàn tất khi lệnh đã quá hạn ⇒ HET_HAN và bộ ký KHÔNG được gọi (đối chứng: trước hạn thì gọi)", async () => {
    const id = await denDangKy(kt1a, kt1b);
    const bo = taoBoKyGia("THANH_CONG");
    expect(await hoanTat(kt1b, id, bo, { now: PHUT(31) })).toMatchObject({ ok: false, ma: "HET_HAN" });
    expect(bo.soLanGoi).toBe(0);
    expect((await hoanTat(kt1b, id, bo, { now: PHUT(5) })).ok).toBe(true);
    expect(bo.soLanGoi).toBe(1);
  });

  it("quetHetHan: CHO_KY và DANG_KY quá hạn ⇒ HET_HAN kèm audit 'Hệ thống'; lệnh chưa hạn / đã kết thúc KHÔNG bị đụng; chạy lại không làm gì thêm", async () => {
    const quaHan = await taoOk(kt1a, { ttlPhut: 5 });
    const dangKy = await denDangKy(kt1a, kt1b, { hoaDonId: HD3, ttlPhut: 5 });
    const conHan = await taoOk(ktHo, { hoaDonId: HD2, ttlPhut: 120 });
    const kq = await quetHetHan({ now: PHUT(10), phamVi: "ALL" });
    expect(kq.soLenh).toBe(2);
    expect((await lenh(quaHan)).trangThai).toBe("HET_HAN");
    expect((await lenh(dangKy)).trangThai).toBe("HET_HAN");
    expect((await lenh(conHan)).trangThai).toBe("CHO_KY");
    const a = (await auditCua(quaHan)).at(-1)!;
    expect(a).toMatchObject({ action: "HET_HAN_LENH_KY_HOA_DON", actorId: null });
    expect((a.oldValues as { trangThai: string }).trangThai).toBe("CHO_KY");
    expect((a.newValues as { trangThai: string }).trangThai).toBe("HET_HAN");
    expect((await auditCua(dangKy)).at(-1)!.oldValues).toMatchObject({ trangThai: "DANG_KY" });
    expect(await quetHetHan({ now: PHUT(10), phamVi: "ALL" })).toMatchObject({ soLenh: 0 });
  });

  it("quét không đụng lệnh đã DA_KY dù hạn lệnh đã qua (đối chứng của điều kiện trạng thái)", async () => {
    const id = await denDangKy(kt1a, kt1b, { ttlPhut: 5 });
    await hoanTat(kt1b, id, taoBoKyGia("THANH_CONG"), { now: PHUT(3) });
    expect(await quetHetHan({ now: PHUT(60), phamVi: "ALL" })).toMatchObject({ soLenh: 0 });
    expect((await lenh(id)).trangThai).toBe("DA_KY");
  });

  it("lệnh KHÔNG có hạn (hàng chèn tay) bị coi là quá hạn: không duyệt được, quét sẽ đóng nó", async () => {
    const id = await taoOk(kt1a);
    await db.hoaDonLenhKy.update({ where: { id }, data: { hetHanLuc: null } });
    expect(await duyet(kt1b, id)).toMatchObject({ ok: false, ma: "HET_HAN" });
    expect(await quetHetHan({ now: NOW, phamVi: "ALL" })).toMatchObject({ soLenh: 1 });
    expect((await lenh(id)).trangThai).toBe("HET_HAN");
  });

  it("tạo lệnh mới khi lệnh sống cũ ĐÃ QUÁ HẠN mà chưa ai quét ⇒ lệnh cũ đóng HET_HAN (có audit) và lệnh mới được tạo; đối chứng: lệnh cũ CÒN hạn ⇒ DA_CO_LENH_SONG", async () => {
    const cu = await taoOk(kt1a, { ttlPhut: 5 });
    expect(await tao(kt1b, { now: PHUT(4) })).toMatchObject({ ok: false, ma: "DA_CO_LENH_SONG" });
    const moi = await tao(kt1b, { now: PHUT(6) });
    expect(moi.ok).toBe(true);
    expect((await lenh(cu)).trangThai).toBe("HET_HAN");
    expect((await auditCua(cu)).at(-1)).toMatchObject({ action: "HET_HAN_LENH_KY_HOA_DON" });
    expect(await lenhTheoHoaDon(HD1)).toHaveLength(2);
  });
});

chay("[LKD-07] BỘ KÝ lỗi ⇒ LOI_KY, KHÔNG rò thông điệp gốc", () => {
  it("bộ ký NÉM: lệnh sang LOI_KY, mã cố định; dấu bí mật trong thông điệp KHÔNG có ở dòng lệnh, audit hay giá trị trả về; đối chứng: bộ ký bình thường ⇒ DA_KY", async () => {
    const id = await denDangKy(kt1a, kt1b);
    const bo = taoBoKyGia("NEM", { dauThongDiepNem: DAU_BI_MAT });
    const kq = await hoanTat(kt1b, id, bo);
    expect(kq).toMatchObject({ ok: false, ma: "LOI_KY", trangThai: "LOI_KY" });
    const r = await lenh(id);
    expect(r.trangThai).toBe("LOI_KY");
    expect(r.lyDo).toMatch(/^NEM_LOI — /);
    expect(r.maGiaoDich).toBeNull();
    for (const noiDung of [JSON.stringify(r), JSON.stringify(await tatCaAudit()), JSON.stringify(kq)]) expect(noiDung).not.toContain(DAU_BI_MAT);
    expect((await auditCua(id)).at(-1)).toMatchObject({ action: "LOI_KY_HOA_DON" });
    // đối chứng: hoá đơn khác, bộ ký tốt
    const id2 = await denDangKy(kt1a, kt1b, { hoaDonId: HD3 });
    expect((await hoanTat(kt1b, id2, taoBoKyGia("THANH_CONG"))).ok).toBe(true);
  });

  it("bộ ký TỪ CHỐI: LOI_KY với mã TU_CHOI; thông điệp riêng của nhà ký không được lưu", async () => {
    const id = await denDangKy(kt1a, kt1b);
    const kq = await hoanTat(kt1b, id, taoBoKyGia("TU_CHOI", { dauThongDiepNem: DAU_BI_MAT }));
    expect(kq).toMatchObject({ ok: false, ma: "LOI_KY" });
    const r = await lenh(id);
    expect(r).toMatchObject({ trangThai: "LOI_KY" });
    expect(r.lyDo).toMatch(/^TU_CHOI — /);
    expect(JSON.stringify([r, await tatCaAudit(), kq])).not.toContain(DAU_BI_MAT);
  });

  it("bộ ký trả kết quả sai khuôn (ok nhưng mã giao dịch rác) ⇒ LOI_KY / PHAN_HOI_KHONG_HOP_LE, không lưu nửa vời", async () => {
    const id = await denDangKy(kt1a, kt1b);
    const rac: BoKy = {
      nangLuc: { providerSupports: "CO", adapterImplements: true, ghiChu: "[R] giả" },
      ky: async () => ({ ok: true, maGiaoDich: "co khoang trang & ky tu la", chungThuHetHan: "2027-11-02" }),
    };
    expect(await hoanTat(kt1b, id, rac)).toMatchObject({ ok: false, ma: "LOI_KY" });
    const r = await lenh(id);
    expect(r).toMatchObject({ trangThai: "LOI_KY", maGiaoDich: null, chungThuHetHan: null });
    expect(r.lyDo).toMatch(/^PHAN_HOI_KHONG_HOP_LE — /);
  });

  it("ghiLoiKy: ghi lỗi chủ động DANG_KY → LOI_KY; mã lạ rơi về KHONG_RO; lệnh CHO_KY thì từ chối (đối chứng)", async () => {
    const cho = await taoOk(kt1a);
    expect(await ghiLoiKy({ actor: kt1b, ten: "KT", lenhId: cho, maLoi: "TU_CHOI", now: PHUT(2) })).toMatchObject({ ok: false, ma: "CHUYEN" });
    expect((await lenh(cho)).trangThai).toBe("CHO_KY");
    await duyet(kt1b, cho);
    expect(await ghiLoiKy({ actor: kt1b, ten: "KT", lenhId: cho, maLoi: "CHUNG_THU_HET_HAN", now: PHUT(2) })).toMatchObject({ ok: true, trangThai: "LOI_KY" });
    expect((await lenh(cho)).lyDo).toMatch(/^CHUNG_THU_HET_HAN — /);
  });

  it("bộ ký CHƯA NỐI (providerSupports=CO nhưng adapterImplements=false) ⇒ CHUA_NOI_BO_KY, không gọi, lệnh vẫn DANG_KY; đối chứng: bộ đã nối chạy được", async () => {
    const id = await denDangKy(kt1a, kt1b);
    const chuaNoi = taoBoKyGia("THANH_CONG", { nangLuc: { providerSupports: "CO", adapterImplements: false, ghiChu: "[R] chưa nối" } });
    expect(await hoanTat(kt1b, id, chuaNoi)).toMatchObject({ ok: false, ma: "CHUA_NOI_BO_KY" });
    expect(chuaNoi.soLanGoi).toBe(0);
    expect((await lenh(id)).trangThai).toBe("DANG_KY");
    expect((await hoanTat(kt1b, id, taoBoKyGia("THANH_CONG"))).ok).toBe(true);
  });

  it("chỉ NGƯỜI ĐÃ NHẬN KÝ mới hoàn tất; lệnh chưa duyệt (CHO_KY) không hoàn tất được — bộ ký không được gọi; đối chứng: đúng người thì ký", async () => {
    const cho = await taoOk(kt1a);
    const bo = taoBoKyGia("THANH_CONG");
    expect(await hoanTat(kt1b, cho, bo)).toMatchObject({ ok: false, ma: "CHUYEN" });
    await duyet(kt1b, cho);
    expect(await hoanTat(kt1c, cho, bo)).toMatchObject({ ok: false, ma: "KHONG_PHAI_NGUOI_KY" });
    expect(bo.soLanGoi).toBe(0);
    expect((await hoanTat(kt1b, cho, bo)).ok).toBe(true);
    expect(bo.soLanGoi).toBe(1);
  });

  it("ĐUA với bộ ký: trong lúc bộ ký chạy lệnh bị quét sang HET_HAN ⇒ KHÔNG ghi đè thành DA_KY (DA_DOI), trả mã giao dịch mồ côi cho người gọi ghi log; audit không có HOAN_TAT", async () => {
    const id = await denDangKy(kt1a, kt1b);
    const lat: BoKy = {
      nangLuc: { providerSupports: "CO", adapterImplements: true, ghiChu: "[R] giả" },
      ky: async () => {
        await db.hoaDonLenhKy.update({ where: { id }, data: { trangThai: "HET_HAN" } });
        return { ok: true, maGiaoDich: "GD-MO-COI-1", chungThuHetHan: "2027-11-02" };
      },
    };
    const kq = await hoanTat(kt1b, id, lat);
    expect(kq).toMatchObject({ ok: false, ma: "DA_DOI", maGiaoDichMoCoi: "GD-MO-COI-1" });
    expect(await lenh(id)).toMatchObject({ trangThai: "HET_HAN", maGiaoDich: null });
    expect((await auditCua(id)).map((a) => a.action)).not.toContain("HOAN_TAT_KY_HOA_DON");
  });
});

chay("[LKD-08] HUỶ lệnh", () => {
  it("huỷ CHO_KY: cần lý do ≥ 10 ký tự; lệnh sang HUY kèm lý do + audit; đối chứng: lý do đủ dài thì được", async () => {
    const id = await taoOk(kt1a);
    expect(await huyLenhKy({ actor: kt1a, ten: "KT", lenhId: id, lyDo: "ngắn", now: PHUT(1) })).toMatchObject({ ok: false, ma: "LY_DO" });
    expect((await lenh(id)).trangThai).toBe("CHO_KY");
    expect(await huyLenhKy({ actor: kt1a, ten: "KT", lenhId: id, lyDo: LY_DO_HUY, now: PHUT(1) })).toMatchObject({ ok: true, trangThai: "HUY" });
    expect(await lenh(id)).toMatchObject({ trangThai: "HUY", lyDo: LY_DO_HUY });
    expect((await auditCua(id)).at(-1)).toMatchObject({ action: "HUY_LENH_KY_HOA_DON", reason: LY_DO_HUY });
  });

  it("KHÔNG huỷ được lệnh DANG_KY (bộ ký có thể đang chạy) và lệnh đã kết thúc; đối chứng: huỷ CHO_KY được", async () => {
    const dang = await denDangKy(kt1a, kt1b);
    expect(await huyLenhKy({ actor: kt1b, ten: "KT", lenhId: dang, lyDo: LY_DO_HUY, now: PHUT(1) })).toMatchObject({ ok: false, ma: "CHUYEN" });
    expect((await lenh(dang)).trangThai).toBe("DANG_KY");
    await hoanTat(kt1b, dang, taoBoKyGia("THANH_CONG"));
    expect(await huyLenhKy({ actor: kt1b, ten: "KT", lenhId: dang, lyDo: LY_DO_HUY, now: PHUT(3) })).toMatchObject({ ok: false, ma: "CHUYEN" });
    expect((await lenh(dang)).trangThai).toBe("DA_KY");
    const cho = await taoOk(kt1a, { hoaDonId: HD3 });
    expect((await huyLenhKy({ actor: kt1b, ten: "KT", lenhId: cho, lyDo: LY_DO_HUY, now: PHUT(1) })).ok).toBe(true);
  });

  it("lệnh không tồn tại ⇒ KHONG_THAY (không ném)", async () => {
    expect(await huyLenhKy({ actor: ktHo, ten: "HO", lenhId: `${T}khong-co`, lyDo: LY_DO_HUY, now: PHUT(1) })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await duyet(ktHo, `${T}khong-co`)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
  });
});

chay("[LKD-09] ĐẦU VÀO tạo lệnh bị kiểm TRƯỚC mọi phép đọc/ghi", () => {
  it("không phải hash / phương thức lạ / ttl sai ⇒ DU_LIEU, không có dòng nào; đối chứng: đầu vào đúng thì tạo được", async () => {
    for (const bay of [{ duLieuCanKyHash: "PIN:1234" }, { duLieuCanKyHash: "123456" }, { phuongThuc: "KY_BANG_TAY" as PhuongThucKy }, { ttlPhut: 0 }, { ttlPhut: 99_999 }, { ttlPhut: 1.5 }]) {
      expect(await tao(kt1a, bay)).toMatchObject({ ok: false, ma: "DU_LIEU" });
    }
    expect(await lenhTheoHoaDon(HD1)).toHaveLength(0);
    expect((await tao(kt1a)).ok).toBe(true);
  });

  it("người gọi KHÔNG có chỗ nào để truyền centerId (cơ sở của lệnh luôn đến từ hoá đơn) — kể cả khi cố nhét thêm trường", async () => {
    const kq = await taoLenhKy({
      actor: ktHo,
      ten: "HO",
      hoaDonId: HD1,
      phuongThuc: "THU_CONG",
      duLieuCanKyHash: HASH,
      ttlPhut: 30,
      now: NOW,
      ...({ centerId: CS2 } as object),
    });
    expect(kq.ok).toBe(true);
    expect((await lenhTheoHoaDon(HD1))[0]!.centerId).toBe(CS1);
  });
});

chay("[LKD-10] lỗi ký báo NGOẠI LỆ ngay cho kế toán đúng cơ sở (cờ Hub + cơ sở thí điểm)", () => {
  async function batThiDiem() {
    await db.orgUnit.create({ data: { id: `${T}ou-1`, type: "CENTER", code: `${T}ou-1`, name: "ĐV LKY 1", centerId: CS1, path: `/${T}ou-1/`, depth: 1 } });
    for (const key of ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"]) await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: true }, update: { valueJson: true } });
  }
  const nlCs1 = () => db.hoaDonNgoaiLe.findMany({ where: { centerId: CS1 }, orderBy: { dedupeKey: "asc" } });

  it("bộ ký lỗi ⇒ ngoại lệ LOI_KY (CAN_XU_LY) gắn hoá đơn, khoá theo id lệnh; chạy lại không đẻ trùng; lệnh KÝ THÀNH CÔNG ⇒ không có (đối chứng)", async () => {
    await batThiDiem();
    const id = await denDangKy(kt1a, kt1b);
    await hoanTat(kt1b, id, taoBoKyGia("TU_CHOI"));
    const nl = await nlCs1();
    expect(nl).toHaveLength(1);
    expect(nl[0]).toMatchObject({ loai: "LOI_KY", muc: "CAN_XU_LY", hoaDonId: HD1, orderId: DON1, trangThai: "MO", dedupeKey: khoaNgoaiLeTucThoi("LOI_KY", HD1, id) });
    expect(JSON.stringify(nl)).not.toContain(DAU_BI_MAT);
    const id2 = await denDangKy(kt1a, kt1b, { hoaDonId: HD3 });
    await hoanTat(kt1b, id2, taoBoKyGia("THANH_CONG"));
    expect(await nlCs1()).toHaveLength(1);
  });

  it("ghiLoiKy chủ động cũng báo; cờ thí điểm TẮT ⇒ không ngoại lệ nào dù lệnh vẫn sang LOI_KY", async () => {
    const id = await denDangKy(kt1a, kt1b);
    await ghiLoiKy({ actor: kt1b, ten: "KT", lenhId: id, maLoi: "KHONG_KET_NOI", now: PHUT(2) });
    expect((await lenh(id)).trangThai).toBe("LOI_KY");
    expect(await nlCs1()).toHaveLength(0);
    await batThiDiem();
    const id2 = await denDangKy(kt1a, kt1b, { hoaDonId: HD3 });
    await ghiLoiKy({ actor: kt1b, ten: "KT", lenhId: id2, maLoi: "KHONG_KET_NOI", now: PHUT(2) });
    expect((await nlCs1()).map((x) => x.loai)).toEqual(["LOI_KY"]);
  });
});
