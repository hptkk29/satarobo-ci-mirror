/**
 * [PNQ-DB] Quản trị PHÁP NHÂN của Cây tổ chức — DB thật (24/10/2026). Thiết kế: docs/ke-toan-hoa-don/THIET-KE-PHAP-NHAN-VA-KY-HIEU.md §A.
 *
 * Khoá: MST trùng (kể cả pháp nhân đã xoá) · MST khoá khi đã có hoá đơn / cấu hình hoá đơn dựa vào · lý do bắt buộc · mọi thao tác ghi
 * AUDIT cùng transaction · không xoá pháp nhân gốc / còn đơn vị · gắn đơn vị chỉ với pháp nhân còn dùng được ·
 * **hoá đơn lịch sử KHÔNG đổi một byte** khi đổi quan hệ cơ sở–pháp nhân. Tự dựng fixture theo tiền tố, tự dọn; KHÔNG `resetDb()`.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { doiTrangThaiPhapNhan, docDanhSachPhapNhan, docLichSuPhapNhan, ganPhapNhanChoDonVi, suaPhapNhan, taoPhapNhan, xoaPhapNhan } from "../../lib/org/legal-entity-admin";
import { updateOrgUnit } from "../../lib/org/org-service";
import { OrgRuleError } from "../../lib/org/types";

const db = new PrismaClient();
const P = "PNQ-";
const NGUOI = { id: "pnq-nguoi", name: "Quản trị UAT" };
const LY_DO = "Cập nhật theo thông tin xuất hoá đơn chủ dự án cung cấp";
// MST thử: 10 số, tiền tố 99 để không đụng dữ liệu thật.
const MST = { A: "9900000011", B: "9900000012", C: "9900000013" };
const CT = `${P}CT`; // trung tâm (OrgUnit) — mã đơn vị

async function don() {
  const pn = await db.legalEntity.findMany({ where: { legalName: { startsWith: P } }, select: { id: true } });
  const ids = pn.map((p) => p.id);
  const dv = await db.orgUnit.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const dvIds = dv.map((d) => d.id);
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...ids, ...dvIds] } }, { actorId: NGUOI.id }] } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: { startsWith: P } } });
  await db.center.deleteMany({ where: { id: { startsWith: P } } });
  if (dvIds.length) await db.orgUnit.deleteMany({ where: { id: { in: dvIds } } });
  if (ids.length) await db.legalEntity.deleteMany({ where: { id: { in: ids } } });
}

async function tao(ten: string, mst: string) {
  return (await taoPhapNhan({ taxCode: mst, legalName: `${P}${ten}`, address: "x", nguoi: NGUOI })).id;
}

async function donVi(code = CT, legalEntityId: string | null = null) {
  return db.orgUnit.create({ data: { id: `${P}${code}`, code: `${P}${code}`, name: `${P}${code}`, type: "CENTER", path: `/${P.toLowerCase()}${code.toLowerCase()}/`, depth: 1, legalEntityId } });
}

const loi = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof OrgRuleError) return e.code;
    throw e;
  }
};
const hanhDong = async (entityId: string) => (await db.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, reason: true, actorName: true, oldValues: true, newValues: true } }));

describe.skipIf(!RUN_DB_TESTS)("[PNQ-DB] quản trị pháp nhân", () => {
  beforeEach(don);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[PNQ-DB-01] thêm: audit ghi người + giá trị mới; MST sai định dạng / trùng (kể cả đã xoá) bị chặn, gợi ý 'Mở lại'", async () => {
    const id = await tao("A", MST.A);
    const [a] = await hanhDong(id);
    expect(a).toMatchObject({ action: "TAO_PHAP_NHAN", actorName: NGUOI.name });
    expect(a!.newValues).toMatchObject({ taxCode: MST.A, legalName: `${P}A`, isActive: true });
    expect(await loi(taoPhapNhan({ taxCode: "123", legalName: `${P}X`, nguoi: NGUOI }))).toBe("LEGAL_TAXCODE_INVALID");
    expect(await loi(taoPhapNhan({ taxCode: MST.A, legalName: `${P}Y`, nguoi: NGUOI }))).toBe("LEGAL_TAXCODE_CONFLICT");
    await xoaPhapNhan({ id, lyDo: LY_DO, nguoi: NGUOI });
    await expect(taoPhapNhan({ taxCode: MST.A, legalName: `${P}Y`, nguoi: NGUOI })).rejects.toThrow(/Mở lại/);
  });

  it("[PNQ-DB-02] sửa: lý do bắt buộc; đổi tên ghi audit cũ→mới + lý do; không đổi gì ⇒ từ chối", async () => {
    const id = await tao("A", MST.A);
    expect(await loi(suaPhapNhan({ id, legalName: `${P}A2`, lyDo: "ngắn", nguoi: NGUOI }))).toBe("LEGAL_REASON_REQUIRED");
    await suaPhapNhan({ id, legalName: `${P}A2`, lyDo: LY_DO, nguoi: NGUOI });
    const ds = await hanhDong(id);
    expect(ds.at(-1)).toMatchObject({ action: "SUA_PHAP_NHAN", reason: LY_DO });
    expect(ds.at(-1)!.oldValues).toMatchObject({ legalName: `${P}A` });
    expect(ds.at(-1)!.newValues).toMatchObject({ legalName: `${P}A2` });
    expect(await loi(suaPhapNhan({ id, legalName: `${P}A2`, lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_NO_CHANGE");
  });

  it("[PNQ-DB-03] MST: đổi được khi CHƯA ai dựa vào; KHOÁ khi đã có hoá đơn; KHOÁ khi có dòng cấu hình hoá đơn tham chiếu pháp nhân phát hành cùng MST", async () => {
    const id = await tao("A", MST.A);
    await suaPhapNhan({ id, taxCode: MST.B, lyDo: LY_DO, nguoi: NGUOI });
    expect((await db.legalEntity.findUniqueOrThrow({ where: { id } })).taxCode).toBe(MST.B);

    // Hoá đơn ĐÃ lưu với MST này ⇒ khoá.
    await db.center.create({ data: { id: `${P}cs`, code: `${P}CS`, name: `${P}cs`, slug: `${P.toLowerCase()}cs`, address: "x" } });
    await db.order.create({ data: { id: `${P}don`, code: `${P}ORD`, type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0999000111", totalAmount: 1000, centerId: `${P}cs` } });
    await db.hoaDonDienTu.create({ data: { orderId: `${P}don`, centerId: `${P}cs`, trangThai: "DA_XAC_NHAN", kyHieu: "1C99PNQ", soHoaDon: "1", phapNhanMst: MST.B, ngayPhatHanh: new Date("2099-01-05T00:00:00Z"), tongTien: 0, taoBoiId: NGUOI.id } });
    expect(await loi(suaPhapNhan({ id, taxCode: MST.C, lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_TAXCODE_LOCKED");
    expect((await db.legalEntity.findUniqueOrThrow({ where: { id } })).taxCode).toBe(MST.B);
    // Đổi TÊN vẫn được (không đổi danh tính pháp lý).
    await suaPhapNhan({ id, legalName: `${P}A9`, lyDo: LY_DO, nguoi: NGUOI });

    // Dòng cấu hình hoá đơn tham chiếu pháp nhân PHÁT HÀNH có MST 0402341070 (NEW_VISION trong mã) ⇒ khoá cùng MST đó.
    const id2 = await tao("B", "0402341070").catch(async () => (await db.legalEntity.findUniqueOrThrow({ where: { taxCode: "0402341070" } })).id);
    await db.cauHinhHoaDonCoSo.create({ data: { centerId: `${P}cs`, phapNhanMa: "NEW_VISION", kyHieu: "1C99STM", hieuLucTu: new Date("2099-01-01"), hieuLucDen: new Date("2099-12-31"), taoBoiId: NGUOI.id, capNhatBoiId: NGUOI.id } });
    expect(await loi(suaPhapNhan({ id: id2, taxCode: MST.C, lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_TAXCODE_LOCKED");
    // Dọn pháp nhân thật nếu chính test này vừa tạo (tên tiền tố PNQ-); nếu đã có sẵn thì KHÔNG đụng.
    const dong = await db.legalEntity.findUniqueOrThrow({ where: { id: id2 } });
    if (!dong.legalName.startsWith(P)) expect(dong.taxCode).toBe("0402341070");
  });

  it("[PNQ-DB-04] ngừng / mở lại / xoá: lý do bắt buộc; gốc được bảo vệ; còn đơn vị ⇒ không xoá (kèm danh sách); mở lại cả pháp nhân đã xoá", async () => {
    const id = await tao("A", MST.A);
    expect(await loi(doiTrangThaiPhapNhan({ id, hanhDong: "NGUNG", lyDo: "x", nguoi: NGUOI }))).toBe("LEGAL_REASON_REQUIRED");
    await donVi(CT, id);
    await expect(xoaPhapNhan({ id, lyDo: LY_DO, nguoi: NGUOI })).rejects.toThrow(new RegExp(`${P}${CT}`));
    expect((await db.legalEntity.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    await db.orgUnit.update({ where: { id: `${P}${CT}` }, data: { legalEntityId: null } });
    await xoaPhapNhan({ id, lyDo: LY_DO, nguoi: NGUOI });
    expect((await db.legalEntity.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    await doiTrangThaiPhapNhan({ id, hanhDong: "MO_LAI", lyDo: LY_DO, nguoi: NGUOI });
    expect(await db.legalEntity.findUniqueOrThrow({ where: { id } })).toMatchObject({ deletedAt: null, isActive: true });
    expect((await hanhDong(id)).map((h) => h.action)).toEqual(["TAO_PHAP_NHAN", "XOA_PHAP_NHAN", "MO_LAI_PHAP_NHAN"]);
    // Pháp nhân GỐC: không ngừng / không xoá. DB chưa có pháp nhân gốc (DB nháp) ⇒ tự dựng MỘT cái để ca KHÔNG rỗng — bản đầu chỉ chạy
    // khi DB có sẵn một cái, nên cấy lỗi "xoá được pháp nhân gốc" không ca nào đỏ. DB đã có gốc thật ⇒ dùng nó và KHÔI PHỤC nếu bị hỏng.
    const coSan = await db.legalEntity.findFirst({ where: { isPrimary: true }, select: { id: true, deletedAt: true, isActive: true } });
    const gocId = coSan?.id ?? (await db.legalEntity.create({ data: { taxCode: MST.C, legalName: `${P}GOC`, isPrimary: true }, select: { id: true } })).id;
    try {
      expect(await loi(doiTrangThaiPhapNhan({ id: gocId, hanhDong: "NGUNG", lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_PRIMARY_PROTECTED");
      expect(await loi(xoaPhapNhan({ id: gocId, lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_PRIMARY_PROTECTED");
    } finally {
      if (coSan) await db.legalEntity.update({ where: { id: coSan.id }, data: { deletedAt: coSan.deletedAt, isActive: coSan.isActive } });
    }
  });

  it("[PNQ-DB-05] gắn đơn vị: chỉ pháp nhân còn dùng được; audit ghi CŨ→MỚI + lý do; gắn lại đúng cái đang có bị từ chối", async () => {
    const a = await tao("A", MST.A);
    const b = await tao("B", MST.B);
    await donVi(CT, a);
    expect(await loi(ganPhapNhanChoDonVi({ orgUnitId: `${P}${CT}`, legalEntityId: b, lyDo: "ngắn", nguoi: NGUOI }))).toBe("LEGAL_REASON_REQUIRED");
    expect(await loi(ganPhapNhanChoDonVi({ orgUnitId: `${P}${CT}`, legalEntityId: a, lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_NO_CHANGE");
    await doiTrangThaiPhapNhan({ id: b, hanhDong: "NGUNG", lyDo: LY_DO, nguoi: NGUOI });
    expect(await loi(ganPhapNhanChoDonVi({ orgUnitId: `${P}${CT}`, legalEntityId: b, lyDo: LY_DO, nguoi: NGUOI }))).toBe("LEGAL_INACTIVE");
    await doiTrangThaiPhapNhan({ id: b, hanhDong: "MO_LAI", lyDo: LY_DO, nguoi: NGUOI });
    await ganPhapNhanChoDonVi({ orgUnitId: `${P}${CT}`, legalEntityId: b, lyDo: LY_DO, nguoi: NGUOI });
    expect((await db.orgUnit.findUniqueOrThrow({ where: { id: `${P}${CT}` } })).legalEntityId).toBe(b);
    const gan = (await hanhDong(`${P}${CT}`)).find((h) => h.action === "GAN_PHAP_NHAN_CHO_DON_VI");
    expect(gan).toMatchObject({ reason: LY_DO });
    expect(gan!.oldValues).toMatchObject({ phapNhan: { taxCode: MST.A } });
    expect(gan!.newValues).toMatchObject({ phapNhan: { taxCode: MST.B } });
  });

  it("[PNQ-DB-06] HOÁ ĐƠN LỊCH SỬ KHÔNG ĐỔI một byte khi đổi tên pháp nhân / đổi quan hệ cơ sở–pháp nhân / ngừng / xoá", async () => {
    const a = await tao("A", MST.A);
    const b = await tao("B", MST.B);
    await db.center.create({ data: { id: `${P}cs`, code: `${P}CS`, name: `${P}cs`, slug: `${P.toLowerCase()}cs`, address: "x" } });
    await db.order.create({ data: { id: `${P}don`, code: `${P}ORD`, type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0999000111", totalAmount: 1000, centerId: `${P}cs` } });
    await db.hoaDonDienTu.create({ data: { orderId: `${P}don`, centerId: `${P}cs`, trangThai: "DA_XAC_NHAN", kyHieu: "1C99PNQ", soHoaDon: "7", phapNhanMa: "SATA_ROBO", phapNhanTen: "Sata Robo", phapNhanMst: MST.A, ngayPhatHanh: new Date("2099-01-05T00:00:00Z"), tongTien: 500, taoBoiId: NGUOI.id } });
    await donVi(CT, a);
    const doc = async () => JSON.stringify(await db.hoaDonDienTu.findMany({ where: { orderId: `${P}don` }, orderBy: { id: "asc" } }));
    const truoc = await doc();
    await suaPhapNhan({ id: a, legalName: `${P}A-doi-ten`, lyDo: LY_DO, nguoi: NGUOI });
    await ganPhapNhanChoDonVi({ orgUnitId: `${P}${CT}`, legalEntityId: b, lyDo: LY_DO, nguoi: NGUOI });
    await doiTrangThaiPhapNhan({ id: a, hanhDong: "NGUNG", lyDo: LY_DO, nguoi: NGUOI });
    await ganPhapNhanChoDonVi({ orgUnitId: `${P}${CT}`, legalEntityId: null, lyDo: LY_DO, nguoi: NGUOI });
    await xoaPhapNhan({ id: b, lyDo: LY_DO, nguoi: NGUOI });
    expect(await doc()).toBe(truoc);
    // Và đối chứng: các thao tác trên THẬT SỰ đã chạy (audit có đủ) — không phải "không làm gì nên không đổi".
    expect((await docLichSuPhapNhan()).filter((m) => m.nguoi === NGUOI.name).length).toBeGreaterThanOrEqual(7);
  });

  it("[PNQ-DB-07] đường 'Sửa đơn vị' (updateOrgUnit) nay GHI AUDIT khi đổi pháp nhân; gửi lại giá trị cũ ⇒ không audit; không truyền ngữ cảnh ⇒ hành vi cũ (không audit)", async () => {
    const a = await tao("A", MST.A);
    const b = await tao("B", MST.B);
    const dv = await donVi(CT, a);
    await updateOrgUnit(dv.id, { legalEntityId: a }, { nguoi: NGUOI });
    expect((await hanhDong(dv.id)).filter((h) => h.action === "GAN_PHAP_NHAN_CHO_DON_VI")).toHaveLength(0);
    await updateOrgUnit(dv.id, { legalEntityId: b }, { nguoi: NGUOI });
    const ds = (await hanhDong(dv.id)).filter((h) => h.action === "GAN_PHAP_NHAN_CHO_DON_VI");
    expect(ds).toHaveLength(1);
    expect(ds[0]!.oldValues).toMatchObject({ phapNhan: { taxCode: MST.A } });
    expect(ds[0]!.newValues).toMatchObject({ phapNhan: { taxCode: MST.B } });
    await updateOrgUnit(dv.id, { legalEntityId: a });
    expect((await db.orgUnit.findUniqueOrThrow({ where: { id: dv.id } })).legalEntityId).toBe(a);
    expect((await hanhDong(dv.id)).filter((h) => h.action === "GAN_PHAP_NHAN_CHO_DON_VI")).toHaveLength(1);
  });

  it("[PNQ-DB-08] danh sách: số đơn vị / hoá đơn đang dựa vào đếm đúng; pháp nhân đã xoá vẫn hiện (để Mở lại)", async () => {
    const a = await tao("A", MST.A);
    await donVi(CT, a);
    let ds = await docDanhSachPhapNhan();
    expect(ds.find((p) => p.id === a)?.tacDong).toEqual({ donVi: 1, hoaDon: 0, cauHinhHoaDon: 0 });
    await db.orgUnit.update({ where: { id: `${P}${CT}` }, data: { legalEntityId: null } });
    await xoaPhapNhan({ id: a, lyDo: LY_DO, nguoi: NGUOI });
    ds = await docDanhSachPhapNhan();
    expect(ds.find((p) => p.id === a)).toMatchObject({ deletedAt: expect.any(Date) });
  });
});
