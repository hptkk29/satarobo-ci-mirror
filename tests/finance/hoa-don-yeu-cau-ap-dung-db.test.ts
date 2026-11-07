// Ca [YCD-*] — ÁP DỤNG thông tin người mua đã xác nhận VÀO ĐƠN (Invoice Hub S11) TRÊN POSTGRES THẬT: xác nhận yêu cầu + ghi `Order.invoice*` trong MỘT giao dịch.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-yeu-cau-ap-dung-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố `fx-yca-`; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Mọi ca "KHÔNG được" kèm đối chứng dương. Đồng hồ ĐÓNG BĂNG.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { GioiHanChongDoan } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua";
import { guiThongTinPhuHuynh, nhapThayBoiSale, taoYeuCau, type KetQuaTao } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db";
import { apDungYeuCauVaoDon } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-ap-dung-db";
import { docYeuCauMoiNhatChoDon } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db";

if (!RUN_DB_TESTS) console.warn(`[YCD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-yca-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const DON1 = `${T}don1`;
const NOW = new Date("2026-11-02T03:00:00.000Z");
const G: GioiHanChongDoan = { toiDaSaiToken: 5, toiDaLanMo: 50, khoaPhut: 15 };
const TEN_PH = "Nguyễn Thị Phụ Huynh YCDX";
const DIA_CHI = "114 Hoàng Diệu YCDX, Đà Nẵng";
const EMAIL_PH = "ph.ycdx@example.com";

const actorCo = (userId: string, centerScope: string[]): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
const KT1 = actorCo(`${T}kt1`, [CS1]);
const KT2 = actorCo(`${T}kt2`, [CS2]);
const ng = (a: Actor) => ({ id: a.userId, name: `Người ${a.userId}` });

async function don() {
  const ids = (await db.hoaDonYeuCauNguoiMua.findMany({ where: { orderId: { startsWith: T } }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "HoaDonYeuCauNguoiMua", entityId: { in: ids } }, { entityType: "Order", entityId: { startsWith: T } }] } });
  await db.hoaDonYeuCauNguoiMua.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}
async function dungFixture() {
  await don();
  for (const [id, ten] of [[CS1, "CS1 YCD"], [CS2, "CS2 YCD"]] as const) await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  await db.order.create({
    data: {
      id: DON1,
      code: "ORD-269975-000001",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "Khách YCD",
      customerPhone: "0328545331",
      customerAddress: "Địa chỉ cũ",
      customerWard: "Phường cũ",
      customerCity: "Thành phố cũ",
      totalAmount: 5_000_000,
      centerId: CS1,
      invoiceBuyerName: "Người mua cũ",
      invoiceEmail: "cu@example.com",
    },
  });
}
async function tao(): Promise<Extract<KetQuaTao, { ok: true }>> {
  const r = await taoYeuCau({ actor: KT1, nguoi: ng(KT1), orderId: DON1, phamVi: "DON", ttlPhut: 240, now: NOW });
  if (!r.ok) throw new Error(`fixture: ${r.ma}`);
  return r;
}
// ⚠️ [03/11/2026] Phụ huynh gửi xong là dữ liệu vào ĐƠN ngay (`cotDonTuPhuHuynh`) — trừ các ô PH KHÔNG đổi so với bản điền sẵn. Bộ này kiểm bước «Áp dụng» (`apDungYeuCauVaoDon`) — đường thư viện
// còn lại, không nút nào gọi — nên mô phỏng «PH gửi nguyên bản điền sẵn» (`banDau: du`): yêu cầu có dữ liệu mà ĐƠN chưa bị đụng, đúng tiền đề của bước Áp dụng. Đường ghi thẳng vào đơn có bộ riêng: [YCW-*].
const phGui = (t: Extract<KetQuaTao, { ok: true }>, du: Record<string, string>) =>
  guiThongTinPhuHuynh({ id: t.id, token: t.token, gioiHan: G, du, banDau: du, donY: { phienBanDieuKhoan: "dk-test" }, now: NOW });
const CCCD_PH = "048123456789";
const DU_CA_NHAN = { loai: "CA_NHAN", ten: TEN_PH, diaChi: DIA_CHI, email: EMAIL_PH, cccd: CCCD_PH };
const ap = (id: string, o: { actor?: Actor; khi?: "TU_CHOI" | "GHI_DE" } = {}) =>
  apDungYeuCauVaoDon({ actor: o.actor ?? KT1, nguoi: ng(o.actor ?? KT1), id, khiDonDaDoi: o.khi ?? "TU_CHOI", now: NOW });
const donNay = () => db.order.findUniqueOrThrow({ where: { id: DON1 } });
const yeuCau = (id: string) => db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id } });
const tien = async () => JSON.stringify([await db.payment.findMany({ where: { orderId: DON1 } }), await db.hoaDonDienTu.findMany({ where: { orderId: DON1 } })]);

beforeEach(async () => {
  if (RUN_DB_TESTS) await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});
const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[YCD-01] áp dụng cá nhân / doanh nghiệp vào cột của đơn", () => {
  it("cá nhân: tên + email + địa chỉ vào đúng cột, xoá đơn vị / MST, phường / thành phố; yêu cầu thành DA_AP_DUNG; audit trên đơn chỉ nêu TÊN cột", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    const r = await ap(t.id);
    expect(r).toMatchObject({ ok: true, orderId: DON1 });
    expect(await donNay()).toMatchObject({
      invoiceBuyerName: TEN_PH,
      invoiceCompanyName: null,
      invoiceTaxCode: null,
      invoiceEmail: EMAIL_PH,
      customerAddress: DIA_CHI,
      customerWard: null,
      customerCity: null,
    });
    expect((await yeuCau(t.id)).trangThai).toBe("DA_AP_DUNG");
    const au = await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON1, action: "AP_DUNG_YEU_CAU_NGUOI_MUA" } });
    expect(au).toHaveLength(1);
    expect(JSON.stringify(au[0])).not.toContain(TEN_PH);
    expect(JSON.stringify(au[0])).not.toContain(EMAIL_PH);
    expect(JSON.stringify(au[0])).toContain("invoiceBuyerName");
  });

  it("doanh nghiệp: tên đơn vị + MST + email; tên người mua cũ GIỮ NGUYÊN", async () => {
    const t = await tao();
    await phGui(t, { loai: "DOANH_NGHIEP", ten: "Công ty TNHH YCDX", diaChi: DIA_CHI, maSoThue: "0401234567", email: "ketoan.ycdx@example.com" });
    expect((await ap(t.id)).ok).toBe(true);
    // email doanh nghiệp là BẮT BUỘC (luật 02/11/2026) nên được GHI; tên người mua cũ GIỮ NGUYÊN (doanh nghiệp không đụng ô của cá nhân)
    expect(await donNay()).toMatchObject({ invoiceCompanyName: "Công ty TNHH YCDX", invoiceTaxCode: "0401234567", invoiceBuyerName: "Người mua cũ", invoiceEmail: "ketoan.ycdx@example.com" });
  });

  it("Sale nhập thay rồi áp dụng cũng được (nguồn ô không làm đổi cách ghi)", async () => {
    const t = await tao();
    expect((await nhapThayBoiSale({ actor: KT1, nguoi: ng(KT1), id: t.id, du: DU_CA_NHAN, now: NOW })).ok).toBe(true);
    expect((await ap(t.id)).ok).toBe(true);
    expect((await donNay()).invoiceBuyerName).toBe(TEN_PH);
  });
});

chay("[YCD-02] từ chối = ROLLBACK cả xác nhận lẫn ghi đơn", () => {
  it("chưa đủ thông tin ⇒ THIEU_THONG_TIN; đơn nguyên vẹn; yêu cầu vẫn DANG_MO; đối chứng: bổ sung đủ thì áp dụng được", async () => {
    const t = await tao();
    await phGui(t, { loai: "CA_NHAN", ten: TEN_PH });
    const truoc = await donNay();
    expect(await ap(t.id)).toMatchObject({ ok: false, ma: "THIEU_THONG_TIN" });
    expect(await donNay()).toEqual(truoc);
    expect((await yeuCau(t.id)).trangThai).toBe("DANG_MO");
    await nhapThayBoiSale({ actor: KT1, nguoi: ng(KT1), id: t.id, du: { diaChi: DIA_CHI }, now: NOW });
    expect(await ap(t.id)).toMatchObject({ ok: false, ma: "THIEU_THONG_TIN" }); // vẫn thiếu CCCD ba/mẹ (BẮT BUỘC — luật 02/11/2026): có địa chỉ chưa đủ
    expect(await donNay()).toEqual(truoc);
    await nhapThayBoiSale({ actor: KT1, nguoi: ng(KT1), id: t.id, du: { cccd: CCCD_PH }, now: NOW });
    expect((await ap(t.id)).ok).toBe(true);
  });

  it("đơn bị sửa SAU khi tạo yêu cầu: TU_CHOI ⇒ DON_DA_DOI, đơn + yêu cầu nguyên vẹn; GHI_DE ⇒ áp dụng", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    await db.order.update({ where: { id: DON1 }, data: { invoiceEmail: "ke-toan-sua@example.com" } });
    const truoc = await donNay();
    const tu = await ap(t.id);
    expect(tu).toMatchObject({ ok: false, ma: "DON_DA_DOI" });
    expect(!tu.ok && tu.error).toContain("invoiceEmail");
    expect(JSON.stringify(tu)).not.toContain("ke-toan-sua@example.com");
    expect(await donNay()).toEqual(truoc);
    expect((await yeuCau(t.id)).trangThai).toBe("DANG_MO");
    expect((await ap(t.id, { khi: "GHI_DE" })).ok).toBe(true);
    expect((await donNay()).invoiceEmail).toBe(EMAIL_PH);
  });

  it("hoá đơn đang PHÁT HÀNH (DANG_PHAT_HANH) ⇒ HOA_DON_DANG_PHAT_HANH, không đổi gì; đối chứng: hoá đơn NHAP thì cho phép", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    await db.hoaDonDienTu.create({ data: { id: `${T}hd1`, orderId: DON1, centerId: CS1, trangThai: "DANG_PHAT_HANH", tongTien: 5_000_000, taoBoiId: `${T}kt1` } });
    const truoc = await donNay();
    expect(await ap(t.id)).toMatchObject({ ok: false, ma: "HOA_DON_DANG_PHAT_HANH" });
    expect(await donNay()).toEqual(truoc);
    await db.hoaDonDienTu.update({ where: { id: `${T}hd1` }, data: { trangThai: "NHAP" } });
    expect((await ap(t.id)).ok).toBe(true);
  });
});

chay("[YCD-03] hoá đơn đã phát hành: cảnh báo, KHÔNG sửa hoá đơn / tiền", () => {
  it("đơn có hoá đơn DA_XAC_NHAN ⇒ áp dụng được kèm danh sách hoá đơn còn hiệu lực (để UI nói «chỉ áp cho hoá đơn mới»); hoá đơn + Payment trước/sau giống hệt", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    await db.hoaDonDienTu.create({
      data: { id: `${T}hd2`, orderId: DON1, centerId: CS1, trangThai: "DA_XAC_NHAN", tongTien: 5_000_000, taoBoiId: `${T}kt1`, kyHieu: "1C26TSR", soHoaDon: "127", xacNhanLuc: NOW },
    });
    const truoc = await tien();
    const r = await ap(t.id);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.hoaDonConHieuLuc).toEqual([{ id: `${T}hd2`, trangThai: "DA_XAC_NHAN", so: "1C26TSR-127" }]);
    expect(await tien()).toBe(truoc);
  });
});

chay("[YCD-04] cô lập cơ sở + đua", () => {
  it("kế toán cơ sở KHÁC không áp dụng được (KHONG_CO_QUYEN, đơn nguyên vẹn); đối chứng: đúng cơ sở thì được", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    const truoc = await donNay();
    expect(await ap(t.id, { actor: KT2 })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await donNay()).toEqual(truoc);
    expect((await ap(t.id)).ok).toBe(true);
  });

  it("hai người cùng áp dụng ⇒ đúng MỘT thắng, đơn ghi đúng một lần (một dòng audit)", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    const kq = await Promise.all([ap(t.id), ap(t.id), ap(t.id)]);
    expect(kq.filter((k) => k.ok)).toHaveLength(1);
    expect(kq.filter((k) => !k.ok).every((k) => !k.ok && k.ma === "DA_DONG")).toBe(true);
    expect(await db.auditLog.count({ where: { entityType: "Order", entityId: DON1, action: "AP_DUNG_YEU_CAU_NGUOI_MUA" } })).toBe(1);
  });
});

chay("[YCD-05] đọc yêu cầu mới nhất cho màn đơn: đúng phạm vi, không rò khoá, KHÔNG trả ô nào của phụ huynh", () => {
  it("trạng thái theo vòng đời; chưa ai gửi ⇒ guiLuc=null, phDaNhap=false; sau khi PH gửi ⇒ guiLuc có, phDaNhap=true", async () => {
    expect(await docYeuCauMoiNhatChoDon(KT1, DON1, NOW)).toBeNull();
    const t = await tao();
    const r0 = await docYeuCauMoiNhatChoDon(KT1, DON1, NOW);
    expect(r0).toMatchObject({ id: t.id, trangThai: "DANG_MO", guiLuc: null, dangKhoa: false, linkHetHan: false, phDaNhap: false, tuXuatLuc: null });
    await phGui(t, DU_CA_NHAN);
    const r1 = await docYeuCauMoiNhatChoDon(KT1, DON1, NOW);
    expect(r1).toMatchObject({ phDaNhap: true });
    expect(r1?.guiLuc).not.toBeNull();
  });

  it("[YCD-05b] `phDaNhap` nhớ lần gửi của yêu cầu CŨ: cấp lại mã (yêu cầu mới chưa ai gửi) thì vẫn là «đã nhập» — dữ liệu PH đã nằm trên đơn", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    await db.hoaDonYeuCauNguoiMua.update({ where: { id: t.id }, data: { trangThai: "THU_HOI" } });
    const t2 = await taoYeuCau({ actor: KT1, nguoi: ng(KT1), orderId: DON1, phamVi: "DON", ttlPhut: 240, now: new Date(NOW.getTime() + 60_000) });
    if (!t2.ok) throw new Error("fixture");
    const r = await docYeuCauMoiNhatChoDon(KT1, DON1, NOW);
    expect(r).toMatchObject({ id: t2.id, guiLuc: null, phDaNhap: true });
  });

  it("hết hạn liên kết được báo (đồng hồ truyền vào); cấp lại thì yêu cầu MỚI NHẤT được trả về", async () => {
    const t = await tao();
    const muon = new Date(NOW.getTime() + 241 * 60_000);
    expect((await docYeuCauMoiNhatChoDon(KT1, DON1, muon))?.linkHetHan).toBe(true);
    expect((await docYeuCauMoiNhatChoDon(KT1, DON1, NOW))?.linkHetHan).toBe(false);
    await db.hoaDonYeuCauNguoiMua.update({ where: { id: t.id }, data: { trangThai: "THU_HOI" } });
    const t2 = await taoYeuCau({ actor: KT1, nguoi: ng(KT1), orderId: DON1, phamVi: "DON", ttlPhut: 240, now: new Date(NOW.getTime() + 5 * 60_000) });
    if (!t2.ok) throw new Error("fixture");
    expect((await docYeuCauMoiNhatChoDon(KT1, DON1, NOW))?.id).toBe(t2.id);
  });

  it("kế toán cơ sở KHÁC thấy null (cùng kết quả «không có yêu cầu»), kể cả `phDaNhap`; đối chứng: đúng cơ sở thấy", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    expect(await docYeuCauMoiNhatChoDon(KT2, DON1, NOW)).toBeNull();
    expect(await docYeuCauMoiNhatChoDon(KT1, DON1, NOW)).not.toBeNull();
  });

  it("kết quả KHÔNG chứa tokenHash / ipGui / uaGui / donY / token thô, và KHÔNG một giá trị ô nào của phụ huynh (tên, CCCD, địa chỉ, email)", async () => {
    const t = await tao();
    await phGui(t, DU_CA_NHAN);
    const j = JSON.stringify(await docYeuCauMoiNhatChoDon(KT1, DON1, NOW));
    const hang = await yeuCau(t.id);
    expect(j).not.toContain(hang.tokenHash);
    expect(j).not.toContain(t.token);
    for (const k of ["tokenHash", "ipGui", "uaGui", "donY", "giaTriGocHash", "duLieuGui"]) expect(j).not.toContain(k);
    for (const v of [TEN_PH, CCCD_PH, DIA_CHI, EMAIL_PH]) expect(j, v).not.toContain(v);
  });
});

// ── [YCD-06] CỘT MỚI 02/11/2026: CCCD ba/mẹ · SĐT · khối học viên — ghi đúng cột, đúng ngữ nghĩa với hộp thoại «Người mua trên hoá đơn», che PII ở màn nhân viên ──
const DU_DAY_DU = { ...DU_CA_NHAN, sdt: "0905 123 456", tenHocVien: "Nguyễn Văn Bé YCDX", ngaySinhHocVien: "2016-08-03", cccdHocVien: "048987654321" };

chay("[YCD-06] áp dụng CCCD + SĐT + khối học viên vào ĐÚNG cột của đơn", () => {
  it("cá nhân đủ ô: CCCD ba/mẹ → customerCccd; SĐT → invoiceParentPhone; học viên → invoiceStudent*; ngày sinh là ngày thật; `customerPhone` (chìa đối khớp tiền) KHÔNG đổi", async () => {
    const t = await tao();
    await phGui(t, DU_DAY_DU);
    const truoc = await donNay();
    expect((await ap(t.id)).ok).toBe(true);
    const sau = await donNay();
    expect(sau).toMatchObject({
      customerCccd: CCCD_PH,
      invoiceParentPhone: "0905123456",
      invoiceStudentName: "Nguyễn Văn Bé YCDX",
      invoiceStudentCccd: "048987654321",
    });
    expect(sau.invoiceStudentDob?.toISOString().slice(0, 10)).toBe("2016-08-03");
    expect(sau.customerPhone).toBe(truoc.customerPhone); // ⛔ chìa đối khớp tiền theo SĐT — phụ huynh không bao giờ ghi đè
    expect(sau.customerPhone).toBe("0328545331");
  });
  it("ô tuỳ chọn trống ⇒ KHÔNG xoá giá trị đơn đã có (SĐT / học viên đã khai giữ nguyên)", async () => {
    await db.order.update({ where: { id: DON1 }, data: { invoiceParentPhone: "0911111111", invoiceStudentName: "Em đã khai trước" } });
    const t = await tao(); // băm lúc tạo đã thấy hai giá trị này
    await phGui(t, DU_CA_NHAN); // PH không điền SĐT / học viên
    expect((await ap(t.id)).ok).toBe(true);
    expect(await donNay()).toMatchObject({ customerCccd: CCCD_PH, invoiceParentPhone: "0911111111", invoiceStudentName: "Em đã khai trước" });
  });
  it("doanh nghiệp: ô của cá nhân (CCCD, SĐT, học viên) KHÔNG được ghi lên đơn dù PH lỡ gửi", async () => {
    const t = await tao();
    await phGui(t, { loai: "DOANH_NGHIEP", ten: "Công ty TNHH YCDX", diaChi: DIA_CHI, maSoThue: "0401234567", email: "kt.ycdx@example.com", cccd: CCCD_PH, sdt: "0905123456", tenHocVien: "Bé" });
    expect((await ap(t.id)).ok).toBe(true);
    expect(await donNay()).toMatchObject({ customerCccd: null, invoiceParentPhone: null, invoiceStudentName: null, invoiceStudentCccd: null });
  });
  it("CCCD / SĐT / học viên bị kế toán GÕ TAY trong lúc chờ ⇒ áp dụng KHÔNG ghi đè im lặng: DON_DA_DOI nói đúng tên cột, đơn nguyên vẹn; GHI_DE thì ghi; đối chứng: không ai sửa ⇒ không báo", async () => {
    const t = await tao();
    await phGui(t, DU_DAY_DU);
    await db.order.update({ where: { id: DON1 }, data: { customerCccd: "048000000001", invoiceParentPhone: "0922222222", invoiceStudentName: "Tên kế toán gõ" } });
    const truoc = await donNay();
    const r = await ap(t.id);
    expect(r).toMatchObject({ ok: false, ma: "DON_DA_DOI" });
    expect(!r.ok && r.error).toMatch(/customerCccd/);
    expect(!r.ok && r.error).toMatch(/invoiceParentPhone/);
    expect(!r.ok && r.error).toMatch(/invoiceStudentName/);
    expect(await donNay()).toEqual(truoc);
    expect((await yeuCau(t.id)).trangThai).toBe("DANG_MO");
    expect((await ap(t.id, { khi: "GHI_DE" })).ok).toBe(true);
    expect(await donNay()).toMatchObject({ customerCccd: CCCD_PH, invoiceParentPhone: "0905123456", invoiceStudentName: "Nguyễn Văn Bé YCDX" });
  });
  it("audit trên đơn chỉ nêu TÊN cột — không một giá trị CCCD / SĐT / ngày sinh nào", async () => {
    const t = await tao();
    await phGui(t, DU_DAY_DU);
    await ap(t.id);
    const au = JSON.stringify(await db.auditLog.findMany({ where: { entityType: "Order", entityId: DON1, action: "AP_DUNG_YEU_CAU_NGUOI_MUA" } }));
    for (const v of [CCCD_PH, "048987654321", "0905123456", "0905 123 456", "2016-08-03"]) expect(au, v).not.toContain(v);
    expect(au).toContain("customerCccd"); // đối chứng dương: tên cột có
  });
});

chay("[YCD-07] giờ tự xuất hiển thị cho nhân viên (`tuXuatLuc`): chỉ khi công tắc bật ∧ PH đã gửi ∧ yêu cầu còn mở", () => {
  const dat = async (key: string, v: unknown) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v as never }, update: { valueJson: v as never } });
  it("tắt ⇒ null; bật + đã gửi ⇒ lần gửi cuối + n giờ (n lấy từ cấu hình); yêu cầu đã đóng ⇒ null", async () => {
    const khoa = ["billing.hoaDonEnabled", "hoaDon.tuXuatBat", "hoaDon.tuXuatSauGio"];
    const cu = await db.systemSetting.findMany({ where: { key: { in: khoa } } });
    try {
      const t = await tao();
      await phGui(t, DU_CA_NHAN);
      await dat("billing.hoaDonEnabled", true);
      await dat("hoaDon.tuXuatBat", false);
      expect((await docYeuCauMoiNhatChoDon(KT1, DON1, NOW))?.tuXuatLuc).toBeNull();
      await dat("hoaDon.tuXuatBat", true);
      await dat("hoaDon.tuXuatSauGio", 3);
      expect((await docYeuCauMoiNhatChoDon(KT1, DON1, NOW))?.tuXuatLuc).toBe(new Date(NOW.getTime() + 3 * 3_600_000).toISOString());
      await db.hoaDonYeuCauNguoiMua.update({ where: { id: t.id }, data: { trangThai: "DA_AP_DUNG" } });
      expect((await docYeuCauMoiNhatChoDon(KT1, DON1, NOW))?.tuXuatLuc).toBeNull();
    } finally {
      for (const k of khoa) {
        const g = cu.find((x) => x.key === k);
        if (g) await dat(k, g.valueJson);
        else await db.systemSetting.deleteMany({ where: { key: k } });
      }
    }
  });
});
