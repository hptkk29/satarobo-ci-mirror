// @vitest-environment node
/**
 * [CTP-DB-*] Phường/xã của phụ huynh trong cổng «để lại thông tin» + Tủ sách cổng phụ huynh — Postgres THẬT (08/11/2026).
 *   [CTP-DB-01] `boSungDiaChiLead`: lead chưa có phường/xã ⇒ điền (tỉnh + phường), có vết kiểm toán, DỘI sang học viên đang nối phiếu ("đổi 1 nơi thì đổi hết")
 *   [CTP-DB-02] đã có phường/xã ⇒ KHÔNG đụng (không ghi đè), học viên giữ nguyên
 *   [CTP-DB-03] `luuPhuongPhuHuynh`: phụ huynh đã có lead (kể cả lead ĐÃ ĐÓNG (DA_MAT), cũ hơn cửa sổ chống trùng — `findRecentDuplicate` KHÔNG thấy nó) ⇒ điền vào ĐÚNG lead đó, KHÔNG tạo lead thứ hai
 *   [CTP-DB-04] `phuHuynhDuocTai` / `docNguCanhTuSach`: SĐT lưu dạng `0…` hay `84…` đều khớp; chưa có phường ⇒ false; có phường ⇒ true; lớp của con lấy đúng
 *   [CTP-DB-05] tài khoản thiếu SĐT / họ tên ⇒ THIEU_THONG_TIN_TAI_KHOAN, không ghi gì; phường lạ ⇒ PHUONG_KHONG_HOP_LE
 * Dữ liệu GIẢ, tiền tố `CTP_`/`ctp-`; dọn theo tiền tố (không TRUNCATE).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers({ "user-agent": "vitest" }) }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { boSungDiaChiLead } from "../../lib/cong-thong-tin/tao-lead";
import { docNguCanhTuSach, luuPhuongPhuHuynh, phuHuynhDuocTai } from "../../lib/portal/tu-sach";

const db = new PrismaClient();
const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const P = "CTP_";
const SDT_84 = "84905550101";
const SDT_0 = "0905550101";

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const lid = leads.map((l) => l.id);
  if (lid.length) {
    await db.auditLog.deleteMany({ where: { entityId: { in: lid } } });
    await db.leadActivity.deleteMany({ where: { leadId: { in: lid } } }).catch(() => undefined);
  }
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  if (lid.length) {
    await db.leadAttribution.deleteMany({ where: { leadId: { in: lid } } }).catch(() => undefined);
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: lid } } }).catch(() => undefined);
    await db.lead.deleteMany({ where: { id: { in: lid } } });
  }
  await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
}

async function taoPhuHuynh(o: { phone?: string | null; name?: string | null } = {}) {
  return db.user.create({
    data: { email: `${P.toLowerCase()}${Math.random().toString(36).slice(2, 8)}@example.com`, name: o.name === undefined ? `${P}Phụ huynh` : o.name, phone: o.phone === undefined ? SDT_84 : o.phone, role: "PARENT", password: "x" },
  });
}
async function taoLead(o: { phone?: string; ward?: string | null; city?: string | null; status?: "MOI" | "DA_MAT"; ngayTao?: Date } = {}) {
  return db.lead.create({
    data: {
      parentName: `${P}Khách`,
      phone: o.phone ?? SDT_84,
      source: "web",
      status: o.status ?? "MOI",
      ward: o.ward === undefined ? null : o.ward,
      city: o.city === undefined ? null : o.city,
      ...(o.ngayTao ? { createdAt: o.ngayTao } : {}),
    },
  });
}

describeDb("[CTP-DB] phường/xã của phụ huynh — Postgres thật", () => {
  beforeEach(async () => {
    await don();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[CTP-DB-01] điền chỗ trống + vết kiểm toán + DỘI sang học viên đang nối", async () => {
    const lead = await taoLead();
    const hv = await db.student.create({ data: { name: `${P}Bé`, leadId: lead.id } });
    const ok = await boSungDiaChiLead(lead.id, { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: "12 Nguyễn Văn Linh", coSoGanNha: null }, "tu-sach", new Date("2026-11-08T03:00:00Z"));
    expect(ok).toBe(true);
    const sau = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([sau.city, sau.ward, sau.addressLine]).toEqual(["Tp Đà Nẵng", "Phường Hải Châu", "12 Nguyễn Văn Linh"]);
    const vet = await db.auditLog.count({ where: { entityId: lead.id, entityType: "Lead" } });
    expect(vet).toBeGreaterThanOrEqual(1);
    const hvSau = await db.student.findUniqueOrThrow({ where: { id: hv.id } });
    expect(hvSau.ward).toBe("Phường Hải Châu");
    expect(hvSau.city).toBe("Tp Đà Nẵng");
  });

  it("[CTP-DB-02] đã có phường/xã ⇒ không ghi đè; học viên giữ nguyên", async () => {
    const lead = await taoLead({ ward: "Phường Sơn Trà", city: "Tp Đà Nẵng" });
    const hv = await db.student.create({ data: { name: `${P}Bé`, leadId: lead.id, ward: "Phường Sơn Trà", city: "Tp Đà Nẵng" } });
    const ok = await boSungDiaChiLead(lead.id, { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: null, coSoGanNha: null }, "tu-sach", new Date("2026-11-08T03:00:00Z"));
    expect(ok).toBe(false);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).ward).toBe("Phường Sơn Trà");
    expect((await db.student.findUniqueOrThrow({ where: { id: hv.id } })).ward).toBe("Phường Sơn Trà");
  });

  it("[CTP-DB-03] phụ huynh có lead ĐÃ ĐÓNG (DA_MAT), cũ hơn cửa sổ chống trùng ⇒ điền vào đúng lead đó, không tạo lead thứ hai", async () => {
    const u = await taoPhuHuynh({ phone: SDT_84 });
    const cu = await taoLead({ phone: SDT_0, status: "DA_MAT", ngayTao: new Date("2025-01-05T00:00:00Z") }); // lưu dạng 0… (dữ liệu cũ)
    const truoc = await db.lead.count({ where: { parentName: { startsWith: P } } });
    const kq = await luuPhuongPhuHuynh(u.id, "Phường Hải Châu");
    expect(kq).toEqual({ ok: true });
    expect(await db.lead.count({ where: { parentName: { startsWith: P } } })).toBe(truoc);
    const sau = await db.lead.findUniqueOrThrow({ where: { id: cu.id } });
    expect(sau.ward).toBe("Phường Hải Châu");
    expect(sau.city).toBe("Tp Đà Nẵng");
  });

  it("[CTP-DB-04] điều kiện tải theo SĐT (0… hay 84…), lớp của con", async () => {
    const u = await taoPhuHuynh({ phone: SDT_84 });
    expect(await phuHuynhDuocTai(u.id)).toBe(false);
    expect((await docNguCanhTuSach(u.id)).coPhuong).toBe(false);
    await taoLead({ phone: SDT_0, ward: "Phường Hải Châu", city: "Tp Đà Nẵng" });
    expect(await phuHuynhDuocTai(u.id)).toBe(true);
    await db.student.create({ data: { name: `${P}Bé A`, parentUserId: u.id, currentGrade: 3 } });
    await db.student.create({ data: { name: `${P}Bé B`, parentUserId: u.id, currentGrade: null } });
    const nc = await docNguCanhTuSach(u.id);
    expect(nc.coPhuong).toBe(true);
    expect(nc.lopCuaCon).toEqual([{ ten: `${P}Bé A`, lop: 3 }]);
    expect(nc.phuongDs).toContain("Phường Hải Châu");
    // đối chứng âm: phụ huynh KHÁC không hưởng ké lead của người này
    const khac = await taoPhuHuynh({ phone: "84905550999" });
    expect(await phuHuynhDuocTai(khac.id)).toBe(false);
  });

  it("[CTP-DB-05] thiếu SĐT / họ tên ⇒ không ghi gì; phường lạ ⇒ PHUONG_KHONG_HOP_LE", async () => {
    const khongSdt = await taoPhuHuynh({ phone: null });
    const truoc = await db.lead.count({ where: { parentName: { startsWith: P } } });
    expect(await luuPhuongPhuHuynh(khongSdt.id, "Phường Hải Châu")).toEqual({ ok: false, ma: "THIEU_THONG_TIN_TAI_KHOAN" });
    const khongTen = await taoPhuHuynh({ name: null, phone: "84905550202" });
    expect(await luuPhuongPhuHuynh(khongTen.id, "Phường Hải Châu")).toEqual({ ok: false, ma: "THIEU_THONG_TIN_TAI_KHOAN" });
    const u = await taoPhuHuynh({ phone: "84905550303" });
    expect(await luuPhuongPhuHuynh(u.id, "Nơi không có thật")).toEqual({ ok: false, ma: "PHUONG_KHONG_HOP_LE" });
    expect(await db.lead.count({ where: { parentName: { startsWith: P } } })).toBe(truoc);
  });
});
