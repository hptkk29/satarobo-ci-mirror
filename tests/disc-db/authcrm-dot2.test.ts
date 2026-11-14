// @vitest-environment node
/**
 * [DDB-AC-*] đợt 2 AUTH/CRM trên Postgres THẬT (ci_test). OTP là GIẢ (không gửi ZNS/SMS thật). Dữ liệu GIẢ.
 *   [DDB-AC-01] N3: kẻ có SĐT nhưng KHÔNG có mã nhận ⇒ otp.xacMinh KHÔNG được gọi (không đốt lượt OTP của chủ số), bộ đếm bài không nhúc nhích
 *   [DDB-AC-02] N3: lỗi OTP (kể cả khi mã đúng) ⇒ MA_KHONG_KHOP, không lộ nguyên văn lỗi OTP
 *   [DDB-AC-03] N7: ô tích của NGƯỜI GÕ không lật consent của lead CÓ SẴN; chỉ bật trên lead do chính bài tạo; ô tích của CHỦ SỐ thì bật
 *   [DDB-AC-04] N4: email người gõ khai chỉ vào lead khi bài CLAIMED ∧ email đã xác minh (cả hai), không ghi đè email có sẵn
 *   [DDB-AC-05] N11: User/Lead lưu dạng cũ `0…` vẫn được tìm thấy / bật tiếp thị đúng (không tạo User thứ hai, không im lặng 0 dòng)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers({ "user-agent": "vitest" }) }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";

import { gatEmailDaXacMinhChoLead } from "../../lib/disc/crm-email";
import { taoCongCrmThat, xacNhanTiepThiSauNhan } from "../../lib/disc/crm-that";
import { nhanBaiDisc } from "../../lib/disc/nhan";
import { taoNhanDeps } from "../../lib/disc/nhan-prisma";
import { nationalPhone } from "../../lib/phone";
import { KHOA, NAM_SINH_CON, NOW, RUN, assertCiTest, dauVao, depLuu, don, khoaIdem, luu, sdtChuan, sdtMoi } from "./_fx";

const describeDb = RUN ? describe : describe.skip;
const MA = "ABCDEFGHJK";

async function luuBai(sdt: string, o: Parameters<typeof dauVao>[1] = {}) {
  const key = khoaIdem("ac");
  const r = await luu(dauVao(sdt, { ...o, key }), depLuu(taoCongCrmThat(() => NOW), { sinhMa: () => MA }));
  if (!r.ok) throw new Error(`fixture lưu hỏng: ${r.loi}`);
  const ban = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key } });
  return ban;
}
const docLead = (id: string) => db.lead.findUniqueOrThrow({ where: { id } });

function depsGia(xacMinh: (sdt: string, code: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
  return { ...taoNhanDeps(NOW), khoaBam: () => KHOA, otp: { yeuCau: async () => ({ ok: true as const, cooldownSec: 60 }), xacMinh }, sauKhiNhan: undefined };
}

describeDb("[DDB-AC] đợt 2 authcrm trên Postgres thật", () => {
  beforeAll(async () => {
    await assertCiTest();
    await don();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[DDB-AC-01] N3: repro reviewer (otp 000000 + mã đoán bừa) ⇒ KHÔNG gọi otp.xacMinh, claimAttempts không đổi", async () => {
    const sdt = sdtMoi();
    const ban = await luuBai(sdt);
    const xacMinh = vi.fn(async () => ({ ok: false as const, error: "Mã không đúng. Còn 4 lần thử." }));
    for (let i = 0; i < 12; i++) {
      const r = await nhanBaiDisc({ soDienThoai: sdt, otp: "000000", maNhan: "AAAAAAAAAA", namSinhCon: String(NAM_SINH_CON), matKhau: "xxxxxxxx", phien: null, deps: depsGia(xacMinh) });
      expect(!r.ok && r.loi).toBe("MA_KHONG_KHOP");
    }
    expect(xacMinh).not.toHaveBeenCalled();
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: ban.id } })).claimAttempts).toBe(0);
    // đối chứng dương: ĐÚNG mã nhận ⇒ cổng cho qua và otp.xacMinh được gọi (đúng 1 lần)
    const ok = await nhanBaiDisc({ soDienThoai: sdt, otp: "123456", maNhan: MA, namSinhCon: String(NAM_SINH_CON), matKhau: "xxxxxxxx", phien: null, deps: depsGia(async () => ({ ok: false, error: "Mã đã hết hạn" })) });
    expect(!ok.ok && ok.loi).toBe("MA_KHONG_KHOP");
  });

  it("[DDB-AC-02] N3: mã đúng nhưng OTP sai ⇒ MA_KHONG_KHOP, thông điệp y hệt sai mã, và bộ đếm KHÔNG tăng (OTP sai dừng trước thách đố)", async () => {
    const sdt = sdtMoi();
    const ban = await luuBai(sdt);
    const xacMinh = vi.fn(async () => ({ ok: false as const, error: "Mã không đúng. Còn 4 lần thử." }));
    const r = await nhanBaiDisc({ soDienThoai: sdt, otp: "123456", maNhan: MA, namSinhCon: String(NAM_SINH_CON), matKhau: "xxxxxxxx", phien: null, deps: depsGia(xacMinh) });
    const sai = await nhanBaiDisc({ soDienThoai: sdt, otp: "123456", maNhan: "AAAAAAAAAA", namSinhCon: String(NAM_SINH_CON), matKhau: "xxxxxxxx", phien: null, deps: depsGia(xacMinh) });
    expect(xacMinh).toHaveBeenCalledTimes(1);
    expect(r).toEqual(sai);
    expect(JSON.stringify(r)).not.toMatch(/lần thử|Còn \d/);
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: ban.id } })).claimAttempts).toBe(0);
  });

  it("[DDB-AC-03] N7: lead CÓ SẴN không bị lật consent bởi ô tích của người gõ; lead do bài tạo thì bật; ô tích của chủ số thì bật cả lead có sẵn", async () => {
    // lead có sẵn: lưu lần 1 (không tích) ⇒ lead; lưu lần 2 cùng SĐT với ô tích ⇒ rơi vào lead cũ
    const sdt = sdtMoi();
    const b1 = await luuBai(sdt);
    const b2 = await luuBai(sdt, { tiepThi: true });
    expect(b2.leadId).toBe(b1.leadId);
    expect(b2.consentMarketing).toBe(true);
    expect(await xacNhanTiepThiSauNhan({ submissionId: b2.id, sdtChuan: sdtChuan(sdt) })).toBe("KHONG_DOI");
    expect((await docLead(b1.leadId!)).consentMarketing).toBe(false);
    // chủ số tự tích ở form nhận ⇒ đồng ý mới của chính họ
    expect(await xacNhanTiepThiSauNhan({ submissionId: b2.id, sdtChuan: sdtChuan(sdt), chuSoDongY: true })).toBe("DA_BAT");
    expect((await docLead(b1.leadId!)).consentMarketing).toBe(true);
    // đối chứng dương: lead MỚI do chính bài tạo + ô tích người gõ ⇒ bật như cũ (F-09)
    const sdt2 = sdtMoi();
    const b3 = await luuBai(sdt2, { tiepThi: true });
    expect((await docLead(b3.leadId!)).consentMarketing).toBe(false);
    expect(await xacNhanTiepThiSauNhan({ submissionId: b3.id, sdtChuan: sdtChuan(sdt2) })).toBe("DA_BAT");
    expect((await docLead(b3.leadId!)).consentMarketing).toBe(true);
  });

  it("[DDB-AC-04] N4: email chỉ vào lead khi (CLAIMED ∧ đã xác minh); chưa đủ ⇒ không; có email sẵn ⇒ không ghi đè", async () => {
    const sdt = sdtMoi();
    const ban = await luuBai(sdt, { email: "phu-huynh-gia@example.test" });
    expect((await docLead(ban.leadId!)).email).toBeNull(); // lúc lưu: không
    await db.discSubmission.update({ where: { id: ban.id }, data: { emailTo: "phu-huynh-gia@example.test", emailVerifiedAt: NOW } });
    expect(await gatEmailDaXacMinhChoLead(ban.id)).toBe("KHONG_DOI"); // đã xác minh email nhưng bài CHƯA được chủ số nhận
    expect((await docLead(ban.leadId!)).email).toBeNull();
    await db.discSubmission.update({ where: { id: ban.id }, data: { claimStatus: "CLAIMED", claimedAt: NOW } });
    expect(await gatEmailDaXacMinhChoLead(ban.id)).toBe("DA_GAT");
    expect((await docLead(ban.leadId!)).email).toBe("phu-huynh-gia@example.test");
    // không ghi đè
    await db.discSubmission.update({ where: { id: ban.id }, data: { emailTo: "khac@example.test" } });
    expect(await gatEmailDaXacMinhChoLead(ban.id)).toBe("KHONG_DOI");
    expect((await docLead(ban.leadId!)).email).toBe("phu-huynh-gia@example.test");
    // CLAIMED nhưng email CHƯA xác minh ⇒ không
    const sdt2 = sdtMoi();
    const b2 = await luuBai(sdt2, { email: "chua-xac-minh@example.test" });
    await db.discSubmission.update({ where: { id: b2.id }, data: { emailTo: "chua-xac-minh@example.test", claimStatus: "CLAIMED", claimedAt: NOW } });
    expect(await gatEmailDaXacMinhChoLead(b2.id)).toBe("KHONG_DOI");
    expect((await docLead(b2.leadId!)).email).toBeNull();
  });

  it("[DDB-AC-05] N11: User & Lead lưu dạng cũ 0… vẫn tìm thấy / bật tiếp thị (không tạo User thứ hai)", async () => {
    const sdt = sdtMoi(); // dạng nội địa 090…
    const u = await db.user.create({ data: { phone: nationalPhone(sdtChuan(sdt))!, role: "PARENT", roles: ["PARENT"], password: "x", accountStatus: "ACTIVE", isActive: true }, select: { id: true } });
    const tim = await taoNhanDeps(NOW).taiKhoan.tim(sdtChuan(sdt));
    expect(tim).toMatchObject({ id: u.id, trangThai: "ACTIVE", laPhuHuynh: true });
    // lead dạng cũ 0… (sdtMoi() trả dạng nội địa)
    const sdtL = sdtMoi();
    const ban = await luuBai(sdtL);
    await db.lead.update({ where: { id: ban.leadId! }, data: { phone: sdtL } });
    expect((await docLead(ban.leadId!)).phone).toBe(sdtL);
    // đối chứng âm: SĐT chủ số khác ⇒ không bật
    expect(await xacNhanTiepThiSauNhan({ submissionId: ban.id, sdtChuan: sdtChuan(sdtMoi()), chuSoDongY: true })).toBe("KHONG_DOI");
    expect((await docLead(ban.leadId!)).consentMarketing).toBe(false);
    expect(await xacNhanTiepThiSauNhan({ submissionId: ban.id, sdtChuan: sdtChuan(sdtL), chuSoDongY: true })).toBe("DA_BAT");
    expect((await docLead(ban.leadId!)).consentMarketing).toBe(true);
  });
});

