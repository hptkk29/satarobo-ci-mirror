// @vitest-environment node
/**
 * [DBP-DB-*] Hồ sơ do PHỤ HUYNH sửa ở cổng ⇒ dội sang MỌI bản sao — Postgres THẬT (14/11/2026).
 *   Chủ dự án 14/11: nhập một nơi thì các nơi khác tự có; địa chỉ phụ huynh vừa lưu thì thắng ở mọi nơi.
 *   [DBP-DB-01] sửa tên + địa chỉ ⇒ User · MỌI học viên của hộ · phiếu lead nguồn · anh/chị/em cùng phiếu đều đổi, có vết kiểm toán trên lead
 *   [DBP-DB-02] phiếu lead cùng SĐT nhưng CHƯA nối học viên nào vẫn đổi (và dội sang học viên đang nối nó)
 *   [DBP-DB-03] chưa có học viên nào ⇒ vẫn đổi phiếu lead cùng SĐT
 *   [DBP-DB-04] chỉ sửa tên ⇒ địa chỉ ở lead KHÔNG bị đụng (ô vắng mặt ≠ xoá trắng)
 *   [DBP-DB-05] xoá trắng địa chỉ ⇒ dòng địa chỉ ở lead về null, phường/xã (ô không sửa được ở màn này) GIỮ NGUYÊN
 *   [DBP-DB-06] phụ huynh sửa hồ sơ CON ⇒ đứa con trong phiếu lead + HV khác cùng nối đứa con đó đổi theo
 *   [DBP-DB-07] đổi SĐT đăng nhập ⇒ `Lead.phone` của phiếu ĐÃ NỐI đổi theo (dạng chuẩn 84…); phiếu cùng SĐT CŨ mà chưa nối thì KHÔNG đổi hộ
 *   [DBP-DB-08] hộ KHÁC (SĐT khác) không bị đụng
 *   [DBP-DB-09] phụ huynh sửa hồ sơ CON ⇒ thành viên Sổ DISC đã NỐI đổi lớp + năm sinh (tên gọi giữ nguyên; thành viên không nối không đụng)
 *   [DBP-DB-10] lưu không đổi lớp/năm sinh, hoặc xoá trắng ở hồ sơ ⇒ Sổ giữ nguyên
 *   [DBP-DB-11] phụ huynh đổi lớp ở SỔ ⇒ Student + đứa con trong phiếu lead đổi theo, có vết kiểm toán
 *   [DBP-DB-12] lưu lại thành viên với lớp CŨ / lớp mầm non / vừa nối mới ⇒ KHÔNG đè lớp học viên
 *   [DBP-DB-13] nhân viên sửa hồ sơ học viên ⇒ Sổ DISC KHÔNG đổi (nhân viên không ghi vào bảng DISC)
 * Dữ liệu GIẢ, tiền tố `DBP_`/`dbp-`; dọn theo tiền tố (không TRUNCATE).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers({ "user-agent": "vitest" }) }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { ghiHoSoPhuHuynh, ghiPhTrongTx } from "../../lib/portal/ghi-ho-so-ph";
import { updateChildDetail } from "../../lib/portal/child-detail";
import { luuThanhVien } from "../../lib/disc/so-gia-dinh/ghi";
import { chiSoCuaVai } from "../../lib/disc/so-gia-dinh/doc";
import { ghiHoSoHocVien, SNAPSHOT_HO_SO } from "../../lib/students/ghi-ho-so";

const db = new PrismaClient();
const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const P = "DBP_";
const SDT_84 = "84905550202";
const SDT_0 = "0905550202";
const SDT_KHAC = "84905550303";

async function don() {
  // Sổ DISC của các tài khoản thử (tiền tố email `dbp_`): xoá audit của thành viên rồi xoá sổ (thành viên đi theo, onDelete Cascade).
  const nguoi = await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } });
  if (nguoi.length) {
    const so = await db.discGiaDinh.findMany({ where: { ownerUserId: { in: nguoi.map((n) => n.id) } }, select: { id: true } });
    if (so.length) {
      const tv = await db.discThanhVien.findMany({ where: { giaDinhId: { in: so.map((s) => s.id) } }, select: { id: true } });
      await db.auditLog.deleteMany({ where: { entityId: { in: [...tv.map((t) => t.id), ...so.map((s) => s.id)] } } });
      await db.discGiaDinh.deleteMany({ where: { id: { in: so.map((s) => s.id) } } });
    }
  }
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const lid = leads.map((l) => l.id);
  const hv = await db.student.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  const ids = [...lid, ...hv.map((s) => s.id)];
  if (ids.length) await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  if (lid.length) {
    await db.leadChild.deleteMany({ where: { leadId: { in: lid } } });
    await db.leadAttribution.deleteMany({ where: { leadId: { in: lid } } }).catch(() => undefined);
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: lid } } }).catch(() => undefined);
    await db.lead.deleteMany({ where: { id: { in: lid } } });
  }
  await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
}

async function taoPh(phone: string | null = SDT_84) {
  return db.user.create({
    data: { email: `${P.toLowerCase()}${Math.random().toString(36).slice(2, 8)}@example.com`, name: `${P}Tên cũ`, phone, role: "PARENT", password: "x", address: "Số cũ" },
  });
}
async function taoLead(o: { phone?: string; ward?: string | null; city?: string | null; addressLine?: string | null } = {}) {
  return db.lead.create({
    data: {
      parentName: `${P}Tên cũ`,
      phone: o.phone ?? SDT_84,
      source: "web",
      status: "MOI",
      ward: o.ward ?? null,
      city: o.city ?? null,
      addressLine: o.addressLine === undefined ? "Số cũ" : o.addressLine,
    },
  });
}
async function taoHv(userId: string, leadId: string | null, ten: string, ex: { leadChildId?: string | null; phone?: string } = {}) {
  return db.student.create({
    data: {
      name: `${P}${ten}`,
      parentUserId: userId,
      leadId,
      leadChildId: ex.leadChildId ?? null,
      parentName: `${P}Tên cũ`,
      parentPhone: ex.phone ?? SDT_0,
      address: "Số cũ",
    },
  });
}
const tu = (id: string) => ({ id, name: "Phụ huynh DBP" });

describeDb("[DBP-DB] cổng PH sửa hồ sơ ⇒ mọi bản sao — Postgres thật", () => {
  beforeEach(async () => {
    await don();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[DBP-DB-01] tên + địa chỉ ⇒ User, mọi học viên, phiếu lead, anh/chị/em; có vết kiểm toán", async () => {
    const u = await taoPh();
    const lead = await taoLead({ ward: "Phường Hải Châu", city: "Tp Đà Nẵng" });
    const a = await taoHv(u.id, lead.id, "Bé A");
    const b = await taoHv(u.id, lead.id, "Bé B");
    const khac = await db.student.create({ data: { name: `${P}Anh khác tài khoản`, leadId: lead.id, parentName: `${P}Tên cũ`, address: "Số cũ" } });

    await ghiHoSoPhuHuynh({ userId: u.id, actor: tu(u.id), sua: { name: `${P}Tên mới`, address: "99 Địa chỉ mới" } });

    const user = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect([user.name, user.address]).toEqual([`${P}Tên mới`, "99 Địa chỉ mới"]);
    for (const id of [a.id, b.id, khac.id]) {
      const s = await db.student.findUniqueOrThrow({ where: { id } });
      expect([s.parentName, s.address], id).toEqual([`${P}Tên mới`, "99 Địa chỉ mới"]);
    }
    const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([l.parentName, l.addressLine, l.ward, l.city]).toEqual([`${P}Tên mới`, "99 Địa chỉ mới", "Phường Hải Châu", "Tp Đà Nẵng"]);
    const vet = await db.auditLog.findMany({ where: { entityId: lead.id, entityType: "Lead" } });
    expect(vet.length).toBeGreaterThanOrEqual(1);
  });

  it("[DBP-DB-02] phiếu lead cùng SĐT, chưa nối học viên ⇒ vẫn đổi, và dội sang học viên đang nối nó", async () => {
    const u = await taoPh();
    const lead = await taoLead();
    const noi = await db.student.create({ data: { name: `${P}Bé nối phiếu`, leadId: lead.id, parentName: `${P}Tên cũ`, address: "Số cũ" } });
    await taoHv(u.id, null, "Bé chưa nối"); // học viên của tài khoản KHÔNG nối phiếu nào

    await ghiHoSoPhuHuynh({ userId: u.id, actor: tu(u.id), sua: { name: `${P}Tên mới`, address: "7 Mới" } });

    const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([l.parentName, l.addressLine]).toEqual([`${P}Tên mới`, "7 Mới"]);
    const s = await db.student.findUniqueOrThrow({ where: { id: noi.id } });
    expect([s.parentName, s.address]).toEqual([`${P}Tên mới`, "7 Mới"]);
  });

  it("[DBP-DB-03] chưa có học viên nào ⇒ vẫn đổi phiếu lead cùng SĐT", async () => {
    const u = await taoPh();
    const lead = await taoLead();
    await ghiHoSoPhuHuynh({ userId: u.id, actor: tu(u.id), sua: { name: `${P}Tên mới`, address: "3 Mới" } });
    const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([l.parentName, l.addressLine]).toEqual([`${P}Tên mới`, "3 Mới"]);
  });

  it("[DBP-DB-04] chỉ sửa tên ⇒ địa chỉ ở lead và học viên KHÔNG bị đụng", async () => {
    const u = await taoPh();
    const lead = await taoLead({ addressLine: "Giữ nguyên" });
    const a = await taoHv(u.id, lead.id, "Bé A");
    await db.student.update({ where: { id: a.id }, data: { address: "Giữ nguyên" } });
    await ghiHoSoPhuHuynh({ userId: u.id, actor: tu(u.id), sua: { name: `${P}Chỉ đổi tên` } });
    const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([l.parentName, l.addressLine]).toEqual([`${P}Chỉ đổi tên`, "Giữ nguyên"]);
    const s = await db.student.findUniqueOrThrow({ where: { id: a.id } });
    expect(s.address).toBe("Giữ nguyên");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).address).toBe("Số cũ");
  });

  it("[DBP-DB-05] xoá trắng địa chỉ ⇒ dòng địa chỉ về null, phường/xã giữ nguyên", async () => {
    const u = await taoPh();
    const lead = await taoLead({ ward: "Phường Hải Châu", city: "Tp Đà Nẵng" });
    const a = await taoHv(u.id, lead.id, "Bé A");
    await ghiHoSoPhuHuynh({ userId: u.id, actor: tu(u.id), sua: { address: null } });
    const l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([l.addressLine, l.ward, l.city]).toEqual([null, "Phường Hải Châu", "Tp Đà Nẵng"]);
    expect((await db.student.findUniqueOrThrow({ where: { id: a.id } })).address).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).address).toBeNull();
  });

  it("[DBP-DB-06] sửa hồ sơ CON ⇒ đứa con trong phiếu + HV khác cùng nối đứa con đó", async () => {
    const u = await taoPh();
    const lead = await taoLead();
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${P}Bé con`, gradeLevel: "Lớp 1", schoolName: "Trường cũ" } });
    const a = await taoHv(u.id, lead.id, "Bé A", { leadChildId: con.id });
    const song = await db.student.create({ data: { name: `${P}Bản sao`, leadId: lead.id, leadChildId: con.id, school: "Trường cũ", currentGrade: 1 } });

    await updateChildDetail(
      a.id,
      { dateOfBirth: new Date("2018-05-20T03:00:00.000Z"), gender: "FEMALE", currentGrade: 3, school: "Trường mới", healthNotes: null, allergies: [] },
      tu(u.id),
    );

    const c = await db.leadChild.findUniqueOrThrow({ where: { id: con.id } });
    expect([c.gradeLevel, c.schoolName, c.gender]).toEqual(["Lớp 3", "Trường mới", "Nữ"]);
    const s = await db.student.findUniqueOrThrow({ where: { id: song.id } });
    expect([s.currentGrade, s.school]).toEqual([3, "Trường mới"]);
  });

  it("[DBP-DB-07] đổi SĐT đăng nhập ⇒ phiếu ĐÃ NỐI đổi theo; phiếu cùng SĐT cũ mà chưa nối KHÔNG đổi hộ", async () => {
    const u = await taoPh();
    const noi = await taoLead();
    await taoHv(u.id, noi.id, "Bé A");
    const chuaNoi = await taoLead({ phone: SDT_84 });
    await db.lead.update({ where: { id: chuaNoi.id }, data: { parentName: `${P}Phiếu chưa nối` } });

    await db.$transaction(async (tx) => {
      await ghiPhTrongTx({
        tx,
        userId: u.id,
        soDienThoai: null,
        data: { parentPhone: "0905550999" },
        doi: { parentPhone: "0905550999" },
        actor: tu(u.id),
      });
    });

    expect((await db.lead.findUniqueOrThrow({ where: { id: noi.id } })).phone).toBe("84905550999");
    expect((await db.lead.findUniqueOrThrow({ where: { id: chuaNoi.id } })).phone).toBe(SDT_84);
  });

  // ── Sổ gia đình DISC ↔ hồ sơ con (14/11/2026) ──────────────────────────────────────────────
  async function taoSoNoi(userId: string, student: { id: string }, lop: string | null, namSinh: number | null) {
    const g = await db.discGiaDinh.create({ data: { ownerUserId: userId, ten: `${P}Gia đình` } });
    await db.discThanhVien.create({ data: { giaDinhId: g.id, ten: `${P}Chủ sổ`, vaiTro: chiSoCuaVai("me"), thuTu: 0, laChuSo: true } });
    const tv = await db.discThanhVien.create({ data: { giaDinhId: g.id, ten: "Bống", vaiTro: chiSoCuaVai("con"), lop, namSinh, thuTu: 1, studentId: student.id } });
    return { g, tv };
  }

  it("[DBP-DB-09] phụ huynh sửa hồ sơ CON ⇒ thành viên Sổ đã NỐI đổi lớp + năm sinh; tên gọi trong Sổ giữ nguyên; thành viên không nối không bị đụng", async () => {
    const u = await taoPh();
    const a = await taoHv(u.id, null, "Bé A");
    const { g, tv } = await taoSoNoi(u.id, a, "1", 2019);
    const khac = await db.discThanhVien.create({ data: { giaDinhId: g.id, ten: "Không nối", vaiTro: chiSoCuaVai("con"), lop: "1", namSinh: 2019, thuTu: 2 } });

    await updateChildDetail(a.id, { dateOfBirth: new Date("2017-05-20T03:00:00.000Z"), gender: null, currentGrade: 3, school: null, healthNotes: null, allergies: [] }, tu(u.id));

    const sau = await db.discThanhVien.findUniqueOrThrow({ where: { id: tv.id } });
    expect([sau.lop, sau.namSinh, sau.ten]).toEqual(["3", 2017, "Bống"]);
    const kh = await db.discThanhVien.findUniqueOrThrow({ where: { id: khac.id } });
    expect([kh.lop, kh.namSinh]).toEqual(["1", 2019]);
  });

  it("[DBP-DB-10] lưu hồ sơ con KHÔNG đổi lớp/năm sinh ⇒ Sổ giữ nguyên; xoá trắng lớp ở hồ sơ ⇒ Sổ giữ nguyên", async () => {
    const u = await taoPh();
    const a = await taoHv(u.id, null, "Bé A");
    await db.student.update({ where: { id: a.id }, data: { currentGrade: 3, dateOfBirth: new Date("2017-05-20T03:00:00.000Z") } });
    const { tv } = await taoSoNoi(u.id, a, "5", 2015); // Sổ do phụ huynh khai KHÁC hồ sơ (vd bé học vượt)

    await updateChildDetail(a.id, { dateOfBirth: new Date("2017-05-20T03:00:00.000Z"), gender: null, currentGrade: 3, school: "Trường mới", healthNotes: null, allergies: [] }, tu(u.id));
    let s = await db.discThanhVien.findUniqueOrThrow({ where: { id: tv.id } });
    expect([s.lop, s.namSinh]).toEqual(["5", 2015]);

    await updateChildDetail(a.id, { dateOfBirth: null, gender: null, currentGrade: null, school: "Trường mới", healthNotes: null, allergies: [] }, tu(u.id));
    s = await db.discThanhVien.findUniqueOrThrow({ where: { id: tv.id } });
    expect([s.lop, s.namSinh]).toEqual(["5", 2015]);
  });

  it("[DBP-DB-11] phụ huynh đổi lớp ở SỔ ⇒ Student.currentGrade + đứa con trong phiếu lead đổi theo, có vết kiểm toán", async () => {
    const u = await taoPh();
    const lead = await taoLead();
    const con = await db.leadChild.create({ data: { leadId: lead.id, fullName: `${P}Bé con`, gradeLevel: "Lớp 3" } });
    const a = await taoHv(u.id, lead.id, "Bé A", { leadChildId: con.id });
    await db.student.update({ where: { id: a.id }, data: { currentGrade: 3 } });
    const { tv } = await taoSoNoi(u.id, a, "3", 2017);

    const r = await luuThanhVien(u.id, { id: tv.id, ten: "Bống", vaiTro: "con", lop: "4", namSinh: 2017, studentId: a.id }, new Date("2026-11-14T03:00:00.000Z"));
    expect(r.ok).toBe(true);

    expect((await db.student.findUniqueOrThrow({ where: { id: a.id } })).currentGrade).toBe(4);
    expect((await db.leadChild.findUniqueOrThrow({ where: { id: con.id } })).gradeLevel).toBe("Lớp 4");
    expect((await db.discThanhVien.findUniqueOrThrow({ where: { id: tv.id } })).lop).toBe("4");
    expect(await db.auditLog.count({ where: { entityId: a.id } })).toBeGreaterThan(0);
  });

  it("[DBP-DB-12] lưu lại thành viên với lớp CŨ ⇒ KHÔNG đè lớp học viên (nhân viên vừa sửa); lớp mầm non / thành viên vừa nối mới ⇒ không đẩy", async () => {
    const u = await taoPh();
    const a = await taoHv(u.id, null, "Bé A");
    await db.student.update({ where: { id: a.id }, data: { currentGrade: 6 } }); // nhân viên đã sửa lên lớp 6
    const { g, tv } = await taoSoNoi(u.id, a, "3", 2017);

    await luuThanhVien(u.id, { id: tv.id, ten: "Bống mới", vaiTro: "con", lop: "3", namSinh: 2017, studentId: a.id }, new Date("2026-11-14T03:00:00.000Z"));
    expect((await db.student.findUniqueOrThrow({ where: { id: a.id } })).currentGrade).toBe(6);

    await luuThanhVien(u.id, { id: tv.id, ten: "Bống mới", vaiTro: "con", lop: "mam-non", namSinh: 2017, studentId: a.id }, new Date("2026-11-14T03:00:00.000Z"));
    expect((await db.student.findUniqueOrThrow({ where: { id: a.id } })).currentGrade).toBe(6);

    // thành viên vừa NỐI mới (chưa nối trước đó) cho học viên khác: hồ sơ là nguồn, Sổ không đẩy ngược
    const b = await taoHv(u.id, null, "Bé B");
    await db.student.update({ where: { id: b.id }, data: { currentGrade: 2 } });
    const moi = await db.discThanhVien.create({ data: { giaDinhId: g.id, ten: "Chưa nối", vaiTro: chiSoCuaVai("con"), lop: "1", thuTu: 3 } });
    await luuThanhVien(u.id, { id: moi.id, ten: "Chưa nối", vaiTro: "con", lop: "9", studentId: b.id }, new Date("2026-11-14T03:00:00.000Z"));
    expect((await db.student.findUniqueOrThrow({ where: { id: b.id } })).currentGrade).toBe(2);
  });

  it("[DBP-DB-13] admin/nhân viên sửa HỒ SƠ HỌC VIÊN ⇒ Sổ DISC KHÔNG đổi (nhân viên không ghi vào bảng DISC)", async () => {
    const u = await taoPh();
    const a = await taoHv(u.id, null, "Bé A");
    const { tv } = await taoSoNoi(u.id, a, "1", 2019);
    const truoc = await db.student.findUniqueOrThrow({ where: { id: a.id }, select: SNAPSHOT_HO_SO });

    await ghiHoSoHocVien({ studentId: a.id, truoc, data: { currentGrade: 8, dateOfBirth: new Date("2012-01-01T03:00:00.000Z") }, actor: { id: null, name: "Nhân viên DBP" } });

    expect((await db.student.findUniqueOrThrow({ where: { id: a.id } })).currentGrade).toBe(8);
    const s = await db.discThanhVien.findUniqueOrThrow({ where: { id: tv.id } });
    expect([s.lop, s.namSinh]).toEqual(["1", 2019]);
  });

  it("[DBP-DB-08] hộ KHÁC (SĐT khác) không bị đụng", async () => {
    const u = await taoPh();
    const nguoiKhac = await taoPh(SDT_KHAC);
    const leadKhac = await taoLead({ phone: SDT_KHAC, addressLine: "Của hộ khác" });
    const hvKhac = await taoHv(nguoiKhac.id, leadKhac.id, "Bé hộ khác", { phone: "0905550303" });
    await taoLead(); // phiếu của hộ này

    await ghiHoSoPhuHuynh({ userId: u.id, actor: tu(u.id), sua: { name: `${P}Tên mới`, address: "Mới" } });

    const l = await db.lead.findUniqueOrThrow({ where: { id: leadKhac.id } });
    expect([l.parentName, l.addressLine]).toEqual([`${P}Tên cũ`, "Của hộ khác"]);
    const s = await db.student.findUniqueOrThrow({ where: { id: hvKhac.id } });
    expect([s.parentName, s.address]).toEqual([`${P}Tên cũ`, "Số cũ"]);
    void SDT_0;
  });
});
