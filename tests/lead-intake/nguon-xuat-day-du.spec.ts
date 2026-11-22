// @vitest-environment node
/**
 * XUẤT TOÀN BỘ LEAD + NGUỒN ĐẦY ĐỦ (`lib/nguon/xuat-lead-day-du.ts`). Postgres LOCAL thật, scopedDb thật.
 *
 *   [XLD-01]  MỖI dòng lead có ĐÚNG số ô = số tiêu đề (lệch một ô là mọi cột sau đó trôi — lỗi câm); cột nguồn đầy đủ đúng giá trị: nguồn hiện hành · nguồn gốc · cách xác định · người giới thiệu · cảnh báo
 *   [XLD-02]  sheet con: con · tín hiệu nguồn · lịch sử trạng thái · nhật ký chăm sóc — nối về lead bằng «Mã lead»
 *   [XLD-03]  PII: không có quyền xem ⇒ KHÔNG chuỗi PII nào (SĐT/email/tên/ghi chú/FB/IP/ngày sinh/nhật ký) còn nguyên ở BẤT KỲ ô nào của BẤT KỲ sheet nào — dò cả tệp, không dò từng cột; sheet nhật ký chăm sóc vắng hẳn
 *   [XLD-04]  có quyền xem ⇒ nguyên văn (đối chứng dương của XLD-03 — nếu XLD-03 xanh chỉ vì dữ liệu rỗng thì ca này đỏ)
 *   [XLD-05]  `phoneHienDuoc=false` (DENY riêng trường phone) che SĐT dù có PII
 *   [XLD-06]  cách ly cơ sở: người xuất cấp cơ sở A không nhận lead cơ sở B; lead đã xoá mềm không xuất
 *   [XLD-07]  vượt một lô (CO_LO_XUAT) không sót, không trùng — keyset theo id
 *   [XLD-08]  `signals` không bị đổ nguyên JSON: khoá lạ trong signals không xuất hiện ở ô nào
 *   [XLD-09]  người giới thiệu là PHỤ HUYNH (khách) bị che tên khi thiếu quyền; có quyền ⇒ nguyên văn
 *   [XLD-11]  TỆP excel thật: đọc lại đủ sheet · tiêu đề đúng dòng · SĐT là TEXT giữ số 0 đầu · watermark
 *   [XLD-10]  nhật ký chăm sóc có HAI lớp chắn (không nạp + không đẩy sheet): bỏ một lớp thì lớp kia vẫn giữ — nên mỗi lớp cấy riêng phải làm XLD-03/10 đỏ khi ĐỦ HAI lớp bị gỡ
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `XLD` / `XLD_`. Mỗi ca tự dựng hiện trường (luật 18).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import ExcelJS from "exceljs";
import { CO_LO_XUAT, docLeadDayDu, type KetQuaXuatLeadDayDu } from "../../lib/nguon/xuat-lead-day-du";
import { dungTepLeadDayDu } from "../../lib/nguon/xuat-lead-day-du-tep";
import { seedUser } from "../e2e/_helpers/seed";
import { damBaoDanhMucGoc, type IdNhom } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "XLD_";
const CASE = 120_000;
const SDT = "0907123456";
const EMAIL = "xld.phuhuynh@example.com";
const TEN_PH = `${P}Nguyen Thi Lan`;
const FB = "https://facebook.com/xld.phuhuynh";
const GHI_CHU = "Khach hen goi lai sau 0907123456 nhe";

function actorCoSo(centerIds: string[]): Actor {
  return {
    userId: "xld-actor",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as Actor;
}

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade: quy nguồn · con · tín hiệu · lịch sử · nhật ký
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "xld-ph-" } } });
  await db.center.deleteMany({ where: { code: { startsWith: "XLD" } } });
}

/** Mọi ô (chuỗi) của MỌI sheet — để dò «PII còn sót ở đâu đó trong tệp». */
const moiO = (k: KetQuaXuatLeadDayDu): string[] => [...k.dongLead, ...k.bangPhu.flatMap((b) => b.dong)].flat().map(String);

describe.skipIf(!RUN)("Xuất toàn bộ lead + nguồn đầy đủ", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";

  async function dungLead(o: { centerId?: string; ten?: string; sdt?: string; deletedAt?: Date; signals?: object } = {}): Promise<string> {
    const l = await db.lead.create({
      data: {
        parentName: o.ten ?? TEN_PH,
        phone: o.sdt ?? SDT,
        email: EMAIL,
        facebookUrl: FB,
        childName: "Nguyen Van Be",
        childAge: 8,
        status: "MOI",
        centerId: o.centerId ?? cA,
        source: "sale-form-app",
        note: GHI_CHU,
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0 XLD-agent",
        parentDob: new Date("1988-04-09T00:00:00.000Z"),
        utmSource: "facebook",
        deletedAt: o.deletedAt ?? null,
      },
      select: { id: true },
    });
    const g = nhom.EMPLOYEE_REFERRAL;
    const nv = await db.employee.create({
      data: { employeeCode: `${P}NV${Math.floor(Math.random() * 1e6)}`, fullName: "Nguyen Nhan Su", jobTitle: "Tu van", department: "TUYEN_SINH", centerId: o.centerId ?? cA, status: "ACTIVE" },
      select: { id: true, employeeCode: true },
    });
    await db.leadAttribution.create({
      data: {
        leadId: l.id,
        groupId: g,
        originalGroupId: nhom.PAID_ADS,
        identificationMethod: "EMPLOYEE_REFERRAL",
        matchedRule: "NV_GIOI_THIEU",
        reasonText: "Ma NV giới thiệu hợp lệ",
        referrerKind: "EMPLOYEE",
        referrerEmployeeId: nv.id,
        referrerRoleCode: "SALE",
        canhBao: ["SDT_NHAN_VIEN"],
        conversionEntry: "sale-form-app",
        attributedAt: new Date("2026-08-01T00:00:00.000Z"),
        signals: (o.signals ?? { nhanGoc: "Chi Lan 0907123456 gioi thieu", xemTay: ["THIEU_SALE_PH"], khoaNguon: true, bi_mat_khong_duoc_xuat: "KHOA_LA_XYZ" }) as object,
      },
    });
    await db.leadChild.create({ data: { leadId: l.id, fullName: "Nguyen Van Be", dob: new Date("2018-03-02T00:00:00.000Z"), ageYears: 8, gender: "MALE", schoolName: "TH Test", gradeLevel: "3", note: "be thich robot", trialStatus: "NONE", status: "NEW" } });
    await db.leadTouchpoint.create({ data: { leadId: l.id, kind: "TAO_LEAD", conversionEntry: "sale-form-app", claimedGroupId: g } });
    await db.leadStatusHistory.create({ data: { leadId: l.id, fromStatus: null, toStatus: "MOI", changedByName: "He thong", source: "admin", reason: "ly do co SDT 0907123456" } });
    await db.leadActivity.create({ data: { leadId: l.id, actorName: "Sale A", type: "NOTE", content: "Goi lan 1 so 0907123456 khong nghe may" } });
    return l.id;
  }

  const cot = (k: KetQuaXuatLeadDayDu, ten: string) => k.cotLead.indexOf(ten);
  const o = (k: KetQuaXuatLeadDayDu, dong: (string | number)[], ten: string) => {
    const i = cot(k, ten);
    expect(i, `không có cột «${ten}»`).toBeGreaterThanOrEqual(0);
    return dong[i];
  };
  const quyenDay = { canViewPii: true, phoneHienDuoc: true };
  const khongQuyen = { canViewPii: false, phoneHienDuoc: false };

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cA = (await db.center.create({ data: { code: "XLD-A", name: "XLD A", slug: "xld-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "XLD-B", name: "XLD B", slug: "xld-b", address: "b", city: "" } })).id;
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, CASE);

  it("[XLD-01] mỗi dòng đủ số ô bằng số tiêu đề; cột nguồn đầy đủ đúng giá trị", async () => {
    const id = await dungLead();
    const k = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    expect(k.tong).toBe(1);
    expect(new Set(k.cotLead).size, "tiêu đề cột không được trùng").toBe(k.cotLead.length);
    for (const d of k.dongLead) expect(d.length).toBe(k.cotLead.length);
    const d = k.dongLead[0]!;
    expect(o(k, d, "Mã lead")).toBe(id);
    const hienHanh = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhom.EMPLOYEE_REFERRAL }, select: { name: true } });
    const gocBanDau = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhom.PAID_ADS }, select: { name: true } });
    expect(o(k, d, "NGUỒN hiện hành")).toBe(hienHanh.name);
    expect(o(k, d, "Mã nguồn hiện hành")).toBe("EMPLOYEE_REFERRAL");
    expect(o(k, d, "NGUỒN GỐC ban đầu")).toBe(gocBanDau.name);
    expect(o(k, d, "Cách xác định nguồn")).toBe("Nhân sự giới thiệu");
    expect(o(k, d, "Luật quy nguồn thắng")).toBe("NV_GIOI_THIEU");
    expect(o(k, d, "Loại người giới thiệu")).toBe("Nhân sự");
    expect(o(k, d, "Người giới thiệu")).toBe("Nguyen Nhan Su");
    expect(String(o(k, d, "Mã người giới thiệu"))).toMatch(/^XLD_NV/);
    expect(o(k, d, "Vai người giới thiệu lúc ghi")).toBe("SALE");
    expect(o(k, d, "Cảnh báo")).toMatch(/SĐT/i);
    expect(o(k, d, "Lý do cần xem tay")).toMatch(/Sale/);
    expect(o(k, d, "Nguồn đang khoá")).toBe("CÓ");
    // Đường vào được ĐỔI TÊN hiển thị như trên màn (khoá lưu `sale-form-app` không đổi).
    expect(o(k, d, "Đường vào")).toBe("nhap-khach-hang");
    expect(o(k, d, "Cơ sở")).toBe("XLD A");
    expect(o(k, d, "Số con khai")).toBe(1);
    expect(o(k, d, "Số tín hiệu nguồn")).toBe(1);
  }, CASE);

  it("[XLD-02] sheet con nối về lead bằng Mã lead; đủ bốn sheet khi có quyền xem", async () => {
    const id = await dungLead();
    const k = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    expect(k.bangPhu.map((b) => b.ten)).toEqual(["Con", "Tin hieu nguon", "Lich su trang thai", "Lich su cham soc"]);
    for (const b of k.bangPhu) {
      expect(b.dong.length, b.ten).toBe(1);
      expect(b.dong[0]!.length, `${b.ten}: số ô ≠ số tiêu đề`).toBe(b.cot.length);
      expect(b.dong[0]![0], b.ten).toBe(id);
    }
    const con = k.bangPhu[0]!;
    expect(con.dong[0]![con.cot.indexOf("Họ tên con")]).toBe("Nguyen Van Be");
    expect(con.dong[0]![con.cot.indexOf("Trạng thái phễu")]).toBe("Mới");
    const tin = k.bangPhu[1]!;
    expect(tin.dong[0]![tin.cot.indexOf("Loại tín hiệu")]).toBe("Tạo lead");
    expect(tin.dong[0]![tin.cot.indexOf("Đường vào")]).toBe("nhap-khach-hang");
  }, CASE);

  it("[XLD-03] KHÔNG có quyền xem PII ⇒ không chuỗi PII nào còn ở bất kỳ ô nào của bất kỳ sheet nào; sheet nhật ký chăm sóc vắng hẳn", async () => {
    await dungLead();
    const k = await docLeadDayDu(actorCoSo([cA]), khongQuyen);
    expect(k.daChePii).toBe(true);
    const tatCa = moiO(k).join("\n");
    for (const pii of [SDT, EMAIL, "xld.phuhuynh", "Nguyen Thi Lan", "Nguyen Van Be", FB, "203.0.113.7", "XLD-agent", "Khach hen goi lai", "be thich robot", "1988", "2018", "Goi lan 1", "Chi Lan"]) {
      expect(tatCa, `PII «${pii}» còn nguyên trong tệp`).not.toContain(pii);
    }
    expect(k.bangPhu.map((b) => b.ten)).not.toContain("Lich su cham soc");
  }, CASE);

  it("[XLD-04] CÓ quyền xem ⇒ nguyên văn (đối chứng dương của XLD-03)", async () => {
    await dungLead();
    const k = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    expect(k.daChePii).toBe(false);
    const d = k.dongLead[0]!;
    expect(o(k, d, "SĐT")).toBe(SDT);
    expect(o(k, d, "Email")).toBe(EMAIL);
    expect(o(k, d, "Phụ huynh")).toBe(TEN_PH);
    expect(o(k, d, "Link Facebook")).toBe(FB);
    expect(o(k, d, "Ngày sinh PH")).toBe("09/04/1988");
    expect(o(k, d, "IP")).toBe("203.0.113.7");
    expect(o(k, d, "Ghi chú")).toBe(GHI_CHU);
    expect(o(k, d, "Nhãn nguồn gốc người nhập gõ")).toBe("Chi Lan 0907123456 gioi thieu");
    expect(k.bangPhu.find((b) => b.ten === "Lich su cham soc")!.dong[0]![4]).toMatch(/0907123456/);
  }, CASE);

  it("[XLD-05] trường `phone` bị DENY riêng (phoneHienDuoc=false) ⇒ che SĐT dù có quyền xem PII; các trường khác vẫn rõ", async () => {
    await dungLead();
    const k = await docLeadDayDu(actorCoSo([cA]), { canViewPii: true, phoneHienDuoc: false });
    const d = k.dongLead[0]!;
    expect(o(k, d, "SĐT")).not.toBe(SDT);
    expect(String(o(k, d, "SĐT"))).not.toContain("123456");
    expect(o(k, d, "Email")).toBe(EMAIL);
  }, CASE);

  it("[XLD-06] cách ly cơ sở: A không nhận lead của B; lead đã xoá mềm không xuất; đối chứng dương: người cấp cả hai cơ sở thấy đủ", async () => {
    const a = await dungLead({ centerId: cA, ten: `${P}A`, sdt: "0907000001" });
    await dungLead({ centerId: cB, ten: `${P}B`, sdt: "0907000002" });
    await dungLead({ centerId: cA, ten: `${P}Xoa`, sdt: "0907000003", deletedAt: new Date("2026-09-01T00:00:00.000Z") });
    const ra = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    const idA = ra.dongLead.map((d) => d[0]);
    expect(idA).toContain(a);
    expect(ra.dongLead.map((d) => String(o(ra, d, "Cơ sở")))).toEqual(["XLD A"]);
    const ca = await docLeadDayDu(actorCoSo([cA, cB]), quyenDay);
    expect(ca.dongLead.map((d) => String(o(ca, d, "Phụ huynh"))).sort()).toEqual([`${P}A`, `${P}B`]);
  }, CASE);

  it("[XLD-07] vượt một lô: không sót, không trùng", async () => {
    const n = CO_LO_XUAT + 17;
    const ids: string[] = [];
    // Dựng nhanh bằng createMany (không cần quan hệ phụ) — chỉ đo keyset qua ranh giới lô.
    await db.lead.createMany({ data: Array.from({ length: n }, (_, i) => ({ parentName: `${P}Lo${i}`, phone: `0907${String(200_000 + i)}`, status: "MOI" as const, centerId: cA })) });
    const rows = await db.lead.findMany({ where: { parentName: { startsWith: `${P}Lo` } }, select: { id: true } });
    for (const r of rows) ids.push(r.id);
    const k = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    const ra = k.dongLead.map((d) => String(d[0]));
    expect(ra.length).toBe(n);
    expect(new Set(ra).size).toBe(n);
    expect(new Set(ra)).toEqual(new Set(ids));
    // Lead chưa có dòng quy nguồn vẫn xuất, ô nguồn nói thật.
    expect(String(o(k, k.dongLead[0]!, "NGUỒN hiện hành"))).toBe("(chưa quy nguồn)");
  }, 240_000);

  it("[XLD-09] người giới thiệu là PHỤ HUYNH (khách) ⇒ che tên khi không có quyền xem PII; có quyền ⇒ nguyên văn (đối chứng dương)", async () => {
    const id = await dungLead();
    const ph = await seedUser({ email: `xld-ph-${Date.now()}@ci.test`, role: "PARENT", name: "Tran Thi Hoa Khach", phone: null });
    await db.leadAttribution.update({
      where: { leadId: id },
      data: { groupId: nhom.PARENT_REFERRAL, referrerKind: "PARENT", referrerEmployeeId: null, referrerRoleCode: null, referrerParentUserId: ph.id, identificationMethod: "PARENT_REFERRAL", matchedRule: "PH_GIOI_THIEU" },
    });
    const co = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    expect(o(co, co.dongLead[0]!, "Loại người giới thiệu")).toBe("Phụ huynh");
    expect(o(co, co.dongLead[0]!, "Người giới thiệu")).toBe("Tran Thi Hoa Khach");
    const khong = await docLeadDayDu(actorCoSo([cA]), khongQuyen);
    expect(o(khong, khong.dongLead[0]!, "Người giới thiệu")).not.toContain("Hoa Khach");
    expect(moiO(khong).join("\n")).not.toContain("Hoa Khach");
  }, CASE);

  it("[XLD-10] nhật ký chăm sóc: HAI lớp chắn độc lập — không quyền ⇒ sheet vắng VÀ không nạp dòng nào; có quyền ⇒ có đủ dòng", async () => {
    await dungLead();
    const khong = await docLeadDayDu(actorCoSo([cA]), khongQuyen);
    expect(khong.bangPhu.some((b) => b.ten === "Lich su cham soc")).toBe(false);
    expect(moiO(khong).join("\n")).not.toContain("khong nghe may");
    const co = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    expect(co.bangPhu.find((b) => b.ten === "Lich su cham soc")!.dong).toHaveLength(1);
  }, CASE);
  it("[XLD-11] TỆP excel thật: đọc lại đủ sheet; tiêu đề đúng dòng; SĐT là TEXT giữ số 0 đầu; số dòng khớp; watermark có mặt", async () => {
    await dungLead();
    const k = await docLeadDayDu(actorCoSo([cA]), quyenDay);
    const buf = await dungTepLeadDayDu(k, "WM-TEST-XLD").xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Du lieu", "Con", "Tin hieu nguon", "Lich su trang thai", "Lich su cham soc", "_watermark"]);
    const ws = wb.getWorksheet("Du lieu")!;
    // Dòng 1 = tiêu đề tệp, dòng 2 trống, dòng 3 = hàng tiêu đề cột, dòng 4 = lead đầu tiên.
    const tieuDe = (ws.getRow(3).values as unknown[]).slice(1).map(String);
    expect(tieuDe).toEqual(k.cotLead);
    const dong = ws.getRow(4);
    const iSdt = k.cotLead.indexOf("SĐT") + 1;
    expect(dong.getCell(iSdt).value).toBe(SDT); // chuỗi "0907123456", không phải số 907123456
    expect(dong.getCell(iSdt).numFmt).toBe("@");
    expect(dong.getCell(k.cotLead.indexOf("Mã lead") + 1).value).toBe(k.dongLead[0]![0]);
    expect(String(wb.getWorksheet("_watermark")!.getRow(1).getCell(1).value)).toBe("WM-TEST-XLD");
    // Không quyền ⇒ bốn sheet (không có «Lich su cham soc»).
    const kk = await docLeadDayDu(actorCoSo([cA]), khongQuyen);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await dungTepLeadDayDu(kk, "x").xlsx.writeBuffer()) as ArrayBuffer);
    expect(wb2.worksheets.map((w) => w.name)).not.toContain("Lich su cham soc");
  }, CASE);
  it("[XLD-08] `signals` không bị đổ nguyên JSON: khoá lạ không xuất hiện ở ô nào", async () => {
    await dungLead();
    for (const q of [quyenDay, khongQuyen]) {
      const k = await docLeadDayDu(actorCoSo([cA]), q);
      const tatCa = moiO(k).join("\n");
      expect(tatCa).not.toContain("KHOA_LA_XYZ");
      expect(tatCa).not.toContain("bi_mat_khong_duoc_xuat");
    }
  }, CASE);
});
