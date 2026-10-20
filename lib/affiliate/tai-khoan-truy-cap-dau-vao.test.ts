// [ATK-*] — AFF-L3a: LUẬT «TÀI KHOẢN TRUY CẬP CỔNG» của đối tác (hàm thuần). User ≠ AffiliateParty: nhiều–nhiều; một trạng thái truy cập; một người đại diện chưa gỡ.
// Mỗi ca "không được" có đối chứng dương cạnh nó (một ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng hẳn).
import { describe, expect, it } from "vitest";
import {
  LY_DO_TOI_THIEU_TRUY_CAP,
  doiDaiDienSchema,
  goSchema,
  kiemDoiDaiDien,
  kiemGoLienKet,
  kiemLienKet,
  kiemMoLaiCong,
  kiemTamNgung,
  kiemUserLienKetDuoc,
  lienKetSchema,
  thaoTacKhaDung,
  timUserSchema,
  userIdLegacy,
  type UserDeKiem,
} from "./tai-khoan-truy-cap-dau-vao";

const PHU_HUYNH: UserDeKiem = { isActive: true, deletedAt: null, accountStatus: "ACTIVE", role: "PARENT", roles: ["PARENT"] };
const LY_DO_DU = "Đã trao đổi với đối tác, tạm ngừng cổng";

describe("[ATK-01] ai liên kết được: chỉ tài khoản PHỤ HUYNH còn hoạt động (cổng đối tác nằm trong cổng phụ huynh)", () => {
  it("đối chứng dương: phụ huynh hoạt động ⇒ được; chưa kích hoạt (PENDING_ACTIVATION) cũng được", () => {
    expect(kiemUserLienKetDuoc(PHU_HUYNH)).toEqual({ ok: true });
    expect(kiemUserLienKetDuoc({ ...PHU_HUYNH, accountStatus: "PENDING_ACTIVATION" })).toEqual({ ok: true });
    expect(kiemUserLienKetDuoc({ ...PHU_HUYNH, roles: [] })).toEqual({ ok: true }); // dữ liệu cũ chỉ có `role`
  });
  const bang: { ten: string; user: UserDeKiem | null; khoa: string }[] = [
    { ten: "không có tài khoản", user: null, khoa: "Không tìm thấy" },
    { ten: "đã xoá mềm", user: { ...PHU_HUYNH, deletedAt: new Date("2026-10-01T00:00:00.000Z") }, khoa: "vô hiệu hoá" },
    { ten: "isActive=false", user: { ...PHU_HUYNH, isActive: false }, khoa: "vô hiệu hoá" },
    { ten: "bị khoá (DISABLED)", user: { ...PHU_HUYNH, accountStatus: "DISABLED" }, khoa: "khoá" },
    { ten: "nhân viên (role chính)", user: { ...PHU_HUYNH, role: "SALES_CSM", roles: [] }, khoa: "nhân viên" },
    { ten: "phụ huynh kiêm nhân viên (roles[])", user: { ...PHU_HUYNH, roles: ["PARENT", "TEACHER"] }, khoa: "nhân viên" },
  ];
  for (const c of bang) {
    it(`từ chối: ${c.ten}`, () => {
      const r = kiemUserLienKetDuoc(c.user);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.loi).toContain(c.khoa);
        expect(r.truong).toBe("userId");
      }
    });
  }
});

describe("[ATK-02] liên kết: mỗi cặp một dòng; gỡ rồi liên kết lại = MỞ LẠI dòng cũ; một người đại diện chưa gỡ", () => {
  const dau = { doiTac: { status: "ACTIVE" as const }, user: PHU_HUYNH, hienCo: null, vai: "MEMBER" as const, daiDienHienTai: null };
  it("đối chứng dương: tạo mới / mở lại", () => {
    expect(kiemLienKet(dau)).toEqual({ ok: true, viec: "TAO" });
    expect(kiemLienKet({ ...dau, hienCo: { role: "MEMBER", status: "REVOKED" } })).toEqual({ ok: true, viec: "MO_LAI" });
    expect(kiemLienKet({ ...dau, vai: "REPRESENTATIVE" })).toEqual({ ok: true, viec: "TAO" }); // chưa có đại diện ⇒ được
  });
  it("một User vẫn liên kết được với NHIỀU đối tác (không cấm «đã ở đối tác khác») — luật chọn được ghi ở đầu tệp", () => {
    expect(kiemLienKet({ ...dau })).toMatchObject({ ok: true });
  });
  it("từ chối: đã liên kết (ACTIVE hoặc SUSPENDED); đối tác ENDED / không có; đã có người đại diện", () => {
    for (const status of ["ACTIVE", "SUSPENDED"] as const) {
      const r = kiemLienKet({ ...dau, hienCo: { role: "MEMBER", status } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.loi).toContain("đã được liên kết");
    }
    expect(kiemLienKet({ ...dau, doiTac: { status: "ENDED" } })).toMatchObject({ ok: false, truong: "partyId" });
    expect(kiemLienKet({ ...dau, doiTac: null })).toMatchObject({ ok: false, truong: "partyId" });
    const dd = kiemLienKet({ ...dau, vai: "REPRESENTATIVE", daiDienHienTai: { userId: "u-khac" } });
    expect(dd).toMatchObject({ ok: false, truong: "vai" });
    if (!dd.ok) expect(dd.loi).toContain("Đổi người đại diện");
  });
  it("đối tác chưa hoạt động (PENDING/DRAFT/SUSPENDED) vẫn nhận liên kết — liên kết không kèm quyền phát link", () => {
    for (const status of ["DRAFT", "PENDING", "SUSPENDED"] as const) expect(kiemLienKet({ ...dau, doiTac: { status } })).toMatchObject({ ok: true });
  });
});

describe("[ATK-03] gỡ · tạm ngừng · mở lại: lý do ≥ 10 ký tự cho thao tác huỷ/ngừng; mở lại kiểm lại tài khoản", () => {
  it("lý do tối thiểu là hằng 10 (khớp CHECK `AffiliatePartyUser_ly_do_chk`)", () => {
    expect(LY_DO_TOI_THIEU_TRUY_CAP).toBe(10);
  });
  it("gỡ: đối chứng dương có lý do đủ; thiếu / ngắn / toàn khoảng trắng ⇒ từ chối đúng ô lyDo; đã gỡ ⇒ từ chối", () => {
    expect(kiemGoLienKet({ status: "ACTIVE", lyDo: LY_DO_DU })).toEqual({ ok: true });
    expect(kiemGoLienKet({ status: "SUSPENDED", lyDo: LY_DO_DU })).toEqual({ ok: true });
    for (const lyDo of [null, "", "ngắn", "          ", "chín ký t"]) expect(kiemGoLienKet({ status: "ACTIVE", lyDo })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(kiemGoLienKet({ status: "REVOKED", lyDo: LY_DO_DU })).toMatchObject({ ok: false, truong: "trangThai" });
  });
  it("tạm ngừng: chỉ từ ACTIVE; cần lý do", () => {
    expect(kiemTamNgung({ status: "ACTIVE", lyDo: LY_DO_DU })).toEqual({ ok: true });
    expect(kiemTamNgung({ status: "ACTIVE", lyDo: "ngắn" })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(kiemTamNgung({ status: "SUSPENDED", lyDo: LY_DO_DU })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemTamNgung({ status: "REVOKED", lyDo: LY_DO_DU })).toMatchObject({ ok: false, truong: "trangThai" });
  });
  it("mở lại: chỉ từ SUSPENDED và tài khoản VẪN liên kết được (đã thành nhân viên / bị khoá ⇒ từ chối, cổng vẫn 404 với họ)", () => {
    expect(kiemMoLaiCong({ status: "SUSPENDED", user: PHU_HUYNH })).toEqual({ ok: true });
    expect(kiemMoLaiCong({ status: "SUSPENDED", user: { ...PHU_HUYNH, roles: ["PARENT", "TEACHER"] } })).toMatchObject({ ok: false, truong: "userId" });
    expect(kiemMoLaiCong({ status: "SUSPENDED", user: { ...PHU_HUYNH, accountStatus: "DISABLED" } })).toMatchObject({ ok: false, truong: "userId" });
    expect(kiemMoLaiCong({ status: "ACTIVE", user: PHU_HUYNH })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(kiemMoLaiCong({ status: "REVOKED", user: PHU_HUYNH })).toMatchObject({ ok: false, truong: "trangThai" });
  });
});

describe("[ATK-04] đổi người đại diện: người mới phải đang ACTIVE, đã liên kết, chưa phải đại diện", () => {
  const moi = { userId: "u2", role: "MEMBER" as const, status: "ACTIVE" as const };
  const cu = { userId: "u1", role: "REPRESENTATIVE" as const, status: "ACTIVE" as const };
  it("đối chứng dương", () => {
    expect(kiemDoiDaiDien({ moi, hienTai: cu })).toEqual({ ok: true });
    expect(kiemDoiDaiDien({ moi, hienTai: null })).toEqual({ ok: true }); // chưa có đại diện ⇒ đặt người đầu
  });
  it("từ chối: chưa liên kết · đã gỡ · tạm ngừng · đã là đại diện", () => {
    expect(kiemDoiDaiDien({ moi: null, hienTai: cu })).toMatchObject({ ok: false });
    expect(kiemDoiDaiDien({ moi: { ...moi, status: "REVOKED" }, hienTai: cu })).toMatchObject({ ok: false });
    expect(kiemDoiDaiDien({ moi: { ...moi, status: "SUSPENDED" }, hienTai: cu })).toMatchObject({ ok: false });
    expect(kiemDoiDaiDien({ moi: { ...cu }, hienTai: cu })).toMatchObject({ ok: false });
  });
});

describe("[ATK-05] cột legacy `Affiliate.userId` = người đại diện CHƯA GỠ (gỡ / đổi người ⇒ đổi theo; không có ⇒ null)", () => {
  const d = (userId: string, role: "REPRESENTATIVE" | "MEMBER", status: "ACTIVE" | "SUSPENDED" | "REVOKED") => ({ userId, role, status });
  it("đối chứng dương: có đại diện ACTIVE ⇒ chính người đó; tạm ngừng vẫn tính (chưa gỡ)", () => {
    expect(userIdLegacy([d("u1", "REPRESENTATIVE", "ACTIVE"), d("u2", "MEMBER", "ACTIVE")])).toBe("u1");
    expect(userIdLegacy([d("u1", "REPRESENTATIVE", "SUSPENDED")])).toBe("u1");
  });
  it("gỡ người đại diện ⇒ null (KHÔNG rơi sang thành viên); không ai ⇒ null", () => {
    expect(userIdLegacy([d("u1", "REPRESENTATIVE", "REVOKED"), d("u2", "MEMBER", "ACTIVE")])).toBeNull();
    expect(userIdLegacy([])).toBeNull();
  });
});

describe("[ATK-06] nút trên dòng: vẽ từ bảng thao tác, thao tác bị chặn có CÂU LÝ DO", () => {
  const khaDung = (p: Parameters<typeof thaoTacKhaDung>[0]) => thaoTacKhaDung(p).map((t) => `${t.thaoTac}${t.lyDoChan ? "!" : ""}`);
  it("ACTIVE thành viên: tạm ngừng · đặt đại diện · gỡ", () => {
    expect(khaDung({ role: "MEMBER", status: "ACTIVE", doiTacKetThuc: false })).toEqual(["TAM_NGUNG", "DAT_DAI_DIEN", "GO"]);
  });
  it("ACTIVE đại diện: không có «đặt đại diện» (đã là đại diện)", () => {
    expect(khaDung({ role: "REPRESENTATIVE", status: "ACTIVE", doiTacKetThuc: false })).toEqual(["TAM_NGUNG", "GO"]);
  });
  it("SUSPENDED: mở lại · (đặt đại diện bị chặn kèm lý do) · gỡ", () => {
    expect(khaDung({ role: "MEMBER", status: "SUSPENDED", doiTacKetThuc: false })).toEqual(["MO_LAI", "DAT_DAI_DIEN!", "GO"]);
  });
  it("đối tác ENDED: tạm ngừng / mở lại bị chặn kèm lý do, vẫn gỡ được; REVOKED không có thao tác nào", () => {
    expect(khaDung({ role: "MEMBER", status: "ACTIVE", doiTacKetThuc: true })).toEqual(["TAM_NGUNG!", "DAT_DAI_DIEN", "GO"]);
    expect(khaDung({ role: "MEMBER", status: "REVOKED", doiTacKetThuc: false })).toEqual([]);
  });
});

describe("[ATK-07] đầu vào server action (zod strict; vai BẮT BUỘC — luật 7)", () => {
  it("liên kết: thiếu vai ⇒ lỗi (không mặc định); vai lạ ⇒ lỗi; trường thừa ⇒ lỗi; đủ ⇒ qua", () => {
    expect(lienKetSchema.safeParse({ partyId: "p", userId: "u", vai: "MEMBER" }).success).toBe(true);
    expect(lienKetSchema.safeParse({ partyId: "p", userId: "u" }).success).toBe(false);
    expect(lienKetSchema.safeParse({ partyId: "p", userId: "u", vai: "ADMIN" }).success).toBe(false);
    expect(lienKetSchema.safeParse({ partyId: "p", userId: "u", vai: "MEMBER", status: "ACTIVE" }).success).toBe(false);
  });
  it("gỡ: mốc updatedAt BẮT BUỘC và phải là ngày hợp lệ", () => {
    expect(goSchema.safeParse({ id: "a", updatedAtDaThay: "2026-10-13T03:00:00.000Z", lyDo: LY_DO_DU }).success).toBe(true);
    expect(goSchema.safeParse({ id: "a", lyDo: LY_DO_DU }).success).toBe(false);
    expect(goSchema.safeParse({ id: "a", updatedAtDaThay: "không-phải-ngày", lyDo: LY_DO_DU }).success).toBe(false);
  });
  it("đổi đại diện + ô tìm: mốc bắt buộc; ô tìm có trần độ dài", () => {
    expect(doiDaiDienSchema.safeParse({ partyId: "p", id: "a", updatedAtDaThay: "2026-10-13T03:00:00.000Z" }).success).toBe(true);
    expect(doiDaiDienSchema.safeParse({ partyId: "p", id: "a" }).success).toBe(false);
    expect(timUserSchema.safeParse({ partyId: "p", q: "an" }).success).toBe(true);
    expect(timUserSchema.safeParse({ partyId: "p", q: "x".repeat(500) }).success).toBe(false);
  });
});
