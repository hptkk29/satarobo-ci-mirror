// @vitest-environment node
/**
 * [DDB-STN-*] đưa thông tin đã khai ở trang công khai sang tài khoản cổng SAU KHI NHẬN BÀI, trên Postgres THẬT (ci_test / satarobo_test).
 *   [DDB-STN-01] nhận bài ⇒ tên tài khoản = tên phụ huynh đã khai; bé vào LeadChild của phiếu (tuổi, «Lớp 4»); Sổ gia đình có chủ sổ + bé;
 *                và KHÔNG có học viên (Student) nào cho tài khoản — cổng vẫn là bản miễn phí
 *   [DDB-STN-02] idempotent: chạy lại ⇒ không nhân đôi LeadChild / thành viên / sổ
 *   [DDB-STN-03] tài khoản đã có học viên cùng tên ⇒ nối studentId vào sổ, KHÔNG tạo LeadChild, KHÔNG tạo học viên mới
 *   [DDB-STN-04] tài khoản đã có tên ⇒ không đè
 *   [DDB-STN-05] bài CHƯA nhận (PENDING_CLAIM) ⇒ không ghi gì
 *   [DDB-STN-06] bài chưa nối phiếu (leadId null) ⇒ không LeadChild nhưng vẫn có sổ + bé
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { dongBoThongTinSauNhan } from "../../lib/disc/thong-tin-sau-nhan-db";
import { VAI_GIA_DINH } from "../../lib/disc/so-gia-dinh/vai";
import { NAM_SINH_CON, NOW, P, RUN, TEN_CON, assertCiTest, crmKhong, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const taoNguoi: string[] = [];
let seq = 0;

/** Bài đã lưu (+ phiếu khách nếu `coPhieu`) và ĐÃ nhận bởi một tài khoản mới (hoặc tài khoản truyền vào). */
async function baiDaNhan(o: { coPhieu?: boolean; daNhan?: boolean; tenTaiKhoan?: string | null; userId?: string } = {}) {
  const sdt = sdtMoi();
  const key = khoaIdem("stn");
  const r = await luu(dauVao(sdt, { key }), depLuu(crmKhong, { sinhMa: () => "ABCDEFGHJK" }));
  if (!r.ok) throw new Error(`fixture lưu hỏng: ${r.loi}`);
  const bai = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key }, select: { id: true } });
  let leadId: string | null = null;
  if (o.coPhieu !== false) {
    const lead = await db.lead.create({
      data: { parentName: `${P} Phụ huynh`, phone: sdtChuan(sdt), source: "WEB", status: "MOI", eventId: `${P}-stn-${Date.now().toString(36)}-${(seq += 1)}` },
      select: { id: true },
    });
    leadId = lead.id;
    await db.discSubmission.update({ where: { id: bai.id }, data: { leadId } });
  }
  const userId =
    o.userId ??
    (
      await db.user.create({
        data: { phone: sdtChuan(sdt), role: "PARENT", roles: ["PARENT"], password: "x", accountStatus: "ACTIVE", isActive: true, name: o.tenTaiKhoan ?? null },
        select: { id: true },
      })
    ).id;
  taoNguoi.push(userId);
  if (o.daNhan !== false) await db.discSubmission.update({ where: { id: bai.id }, data: { claimStatus: "CLAIMED", claimedUserId: userId, claimedAt: NOW } });
  return { submissionId: bai.id, userId, leadId };
}

const soCua = (userId: string) =>
  db.discGiaDinh.findUnique({ where: { ownerUserId: userId }, select: { id: true, thanhVien: { where: { deletedAt: null }, orderBy: { thuTu: "asc" }, select: { ten: true, vaiTro: true, lop: true, namSinh: true, laChuSo: true, studentId: true } } } });

describeDb("[DDB-STN] thông tin sau khi nhận bài trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
  });
  afterAll(async () => {
    await db.discGiaDinh.deleteMany({ where: { ownerUserId: { in: taoNguoi } } }); // thành viên đi theo (cascade)
    await db.student.deleteMany({ where: { parentUserId: { in: taoNguoi } } });
    await don();
    await db.user.deleteMany({ where: { id: { in: taoNguoi }, lastLoginAt: null } });
    await db.$disconnect();
  });

  it("[DDB-STN-01] tên tài khoản + bé vào phiếu + sổ có chủ sổ và bé; KHÔNG tạo học viên", async () => {
    const b = await baiDaNhan();
    const kq = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    expect(kq).toMatchObject({ boQua: null, datTen: true, leadChildDaTao: 1, soDaTao: true, thanhVienDaThem: 1 });

    expect((await db.user.findUniqueOrThrow({ where: { id: b.userId }, select: { name: true } })).name).toBe(`${P} Phụ huynh`);

    const be = await db.leadChild.findMany({ where: { leadId: b.leadId! }, select: { fullName: true, ageYears: true, gradeLevel: true, note: true } });
    expect(be).toHaveLength(1);
    expect(be[0]).toMatchObject({ fullName: TEN_CON, ageYears: 2026 - NAM_SINH_CON, gradeLevel: "Lớp 4" });
    expect(be[0]!.note).toContain(String(NAM_SINH_CON));

    const so = await soCua(b.userId);
    expect(so?.thanhVien).toHaveLength(2);
    expect(so!.thanhVien[0]).toMatchObject({ laChuSo: true, vaiTro: VAI_GIA_DINH.indexOf("me"), namSinh: 1988 }); // vai ME khai ở trang công khai
    expect(so!.thanhVien[1]).toMatchObject({ ten: TEN_CON, vaiTro: VAI_GIA_DINH.indexOf("con"), lop: "4", namSinh: NAM_SINH_CON, laChuSo: false, studentId: null });

    // Điều QUAN TRỌNG của thiết kế: không học viên ⇒ cổng giữ bản miễn phí cho tới khi đăng ký khoá học.
    expect(await db.student.count({ where: { parentUserId: b.userId } })).toBe(0);
  });

  it("[DDB-STN-02] chạy lại ⇒ không nhân đôi", async () => {
    const b = await baiDaNhan();
    await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    const lan2 = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    expect(lan2).toMatchObject({ datTen: false, leadChildDaTao: 0, soDaTao: false, thanhVienDaThem: 0 });
    expect(await db.leadChild.count({ where: { leadId: b.leadId! } })).toBe(1);
    expect((await soCua(b.userId))?.thanhVien).toHaveLength(2);
    expect(await db.discGiaDinh.count({ where: { ownerUserId: b.userId } })).toBe(1);
  });

  it("[DDB-STN-03] đã có học viên cùng tên ⇒ nối studentId, không LeadChild, không học viên mới", async () => {
    const u = await db.user.create({ data: { phone: sdtChuan(sdtMoi()), role: "PARENT", roles: ["PARENT"], password: "x", accountStatus: "ACTIVE", isActive: true }, select: { id: true } });
    const hv = await db.student.create({ data: { name: TEN_CON.toUpperCase(), parentUserId: u.id }, select: { id: true } });
    const b = await baiDaNhan({ userId: u.id });
    const kq = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    expect(kq.leadChildDaTao).toBe(0);
    expect(await db.leadChild.count({ where: { leadId: b.leadId! } })).toBe(0);
    expect((await soCua(u.id))?.thanhVien.find((m) => !m.laChuSo)?.studentId).toBe(hv.id);
    expect(await db.student.count({ where: { parentUserId: u.id } })).toBe(1);
  });

  it("[DDB-STN-04] tài khoản đã có tên ⇒ không đè", async () => {
    const b = await baiDaNhan({ tenTaiKhoan: "Mẹ Su" });
    const kq = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    expect(kq.datTen).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: b.userId }, select: { name: true } })).name).toBe("Mẹ Su");
  });

  it("[DDB-STN-05] bài CHƯA nhận ⇒ không ghi gì", async () => {
    const b = await baiDaNhan({ daNhan: false });
    const kq = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    expect(kq.boQua).toBe("KHONG_DUOC_NHAN");
    expect(await soCua(b.userId)).toBeNull();
    expect(await db.leadChild.count({ where: { leadId: b.leadId! } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: b.userId }, select: { name: true } })).name).toBeNull();
  });

  it("[DDB-STN-07] bài đã gắn người nhận nhưng KHÔNG còn ở trạng thái CLAIMED (đã thu hồi / hết hạn) ⇒ không ghi gì", async () => {
    // Ca riêng cho điều kiện trạng thái: [DDB-STN-05] chỉ chạm điều kiện «chưa có người nhận» nên không chứng minh được vế này.
    for (const trangThai of ["REVOKED", "EXPIRED"] as const) {
      const b = await baiDaNhan();
      await db.discSubmission.update({ where: { id: b.submissionId }, data: { claimStatus: trangThai } });
      const kq = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
      expect(kq.boQua, trangThai).toBe("KHONG_DUOC_NHAN");
      expect(await soCua(b.userId), trangThai).toBeNull();
      expect(await db.leadChild.count({ where: { leadId: b.leadId! } }), trangThai).toBe(0);
    }
  });

  it("[DDB-STN-06] bài chưa nối phiếu ⇒ không LeadChild nhưng vẫn có sổ + bé", async () => {
    const b = await baiDaNhan({ coPhieu: false });
    const kq = await dongBoThongTinSauNhan({ submissionId: b.submissionId, now: NOW });
    expect(kq).toMatchObject({ leadChildDaTao: 0, soDaTao: true, thanhVienDaThem: 1 });
    expect((await soCua(b.userId))?.thanhVien).toHaveLength(2);
  });
});
