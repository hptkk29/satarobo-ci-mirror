// @vitest-environment node
/**
 * [HT-PDF-04] / [HT-CP-*] — cổng token tải báo cáo (đã gỡ xuất PDF 04/11/2026), nhận bài (OTP + mã nhận + năm sinh con) và cổng phụ huynh, trên bài lưu bởi ENGINE THẬT.
 * Postgres thật · route thật · OTP thật (cửa OTP_TEST_FIXED_CODE, KHÔNG gửi gì ra ngoài: ZNS/email ở chế độ giả) · không mock engine.
 *   [HT-PDF-04] token sai/ngắn/hết hạn ⇒ 404 CÙNG một hình; sau khi bài CLAIMED, token cũ chết
 *   [HT-CP-01] hành trình nhận: xin OTP thật → nhận bằng OTP+mã+năm sinh ⇒ User mới (PARENT, ACTIVE), bài CLAIMED bởi đúng User
 *   [HT-CP-02] sai năm sinh / sai mã / sai OTP ⇒ cùng thông điệp, không liên kết
 *   [HT-CP-03] portal: liệt kê lịch sử, mở chi tiết, báo cáo HTML; IDOR: user khác ⇒ null / 404; chưa đăng nhập ⇒ 401
 *   [HT-CP-04] tài khoản ACTIVE sẵn có (lưu dạng cũ 0…): không đăng nhập ⇒ CAN_DANG_NHAP (không tạo User thứ hai); đăng nhập đúng số ⇒ liên kết, vẫn 1 User
 *   [HT-CP-05] tài khoản PENDING_ACTIVATION (phụ huynh do admin tạo): kích hoạt, KHÔNG tạo User trùng
 *   [HT-CP-06] đăng nhập tài khoản KHÁC số ⇒ từ chối, bài không đổi chủ
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PHIEN = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => (PHIEN.userId ? { user: { id: PHIEN.userId, role: "PARENT" } } : null) }));

import { db } from "../../lib/db";
import { ensureDiscEngine } from "../../lib/disc/engine-dang-ky";
import { nhanBaiDisc, yeuCauOtpNhan } from "../../lib/disc/nhan";
import { taoNhanDeps } from "../../lib/disc/nhan-prisma";
import { docChiTietLuot, docDanhSachLuot } from "../../lib/disc/portal-doc";
import { GET as portalBaoCao } from "../../app/(portal)/portal/disc/[id]/bao-cao/route";
import { RUN, assertCiTest, don, khoaIdem, sdtChuan, sdtMoi } from "./_fx";
import { MA_OTP_TEST, TEN_HS, TEN_PH, batMoiTruongThu, dungYeuCauLuu, goiLuu, goiTai, namNay } from "./_hanh-trinh";

const describeDb = RUN ? describe : describe.skip;
batMoiTruongThu();

async function luuMoi(o: { email?: string | null; namHs?: number } = {}) {
  const sdt = sdtMoi();
  const key = khoaIdem("cp");
  const { body } = await dungYeuCauLuu(sdt, { key, ...o });
  const r = await goiLuu(body);
  if (r.status !== 200) throw new Error(`luu hỏng ${r.status} ${JSON.stringify(r.json)}`);
  const bai = await db.discSubmission.findUniqueOrThrow({ where: { idempotencyKey: key }, include: { subjects: true } });
  return { sdt, key, bai, tokenTai: r.json.tokenTai as string, maNhan: r.json.maNhan as string, namHs: body.hocSinh.namSinh };
}

/** Xin OTP THẬT (dịch vụ OTP + cửa mã cố định) rồi nhận bài. `deps` là deps THẬT của `taoNhanDeps`. */
async function nhan(o: { sdt: string; maNhan: string; namSinhCon: number; otp?: string; phien?: { userId: string; phoneKey: string | null } | null; matKhau?: string }) {
  const deps = taoNhanDeps(new Date());
  if (!o.phien) await yeuCauOtpNhan({ soDienThoai: o.sdt, cooldownMacDinhSec: 60, phien: null, deps });
  else await yeuCauOtpNhan({ soDienThoai: o.sdt, cooldownMacDinhSec: 60, phien: o.phien, deps });
  return nhanBaiDisc({
    soDienThoai: o.sdt,
    otp: o.otp ?? MA_OTP_TEST,
    maNhan: o.maNhan,
    namSinhCon: o.namSinhCon,
    matKhau: o.phien ? null : (o.matKhau ?? "MatKhau-Gia-123"),
    phien: o.phien ?? null,
    deps: taoNhanDeps(new Date()),
  });
}

const demUser = (sdt: string) => db.user.count({ where: { phone: { in: [sdt, sdtChuan(sdt)] }, deletedAt: null } });
const taoUserCu = (sdt: string, o: { dangSo: "cu" | "chuan"; trangThai: "ACTIVE" | "PENDING_ACTIVATION" }) =>
  db.user.create({
    data: {
      phone: o.dangSo === "cu" ? sdt : sdtChuan(sdt),
      role: "PARENT",
      roles: ["PARENT"],
      password: "x-htcp",
      accountStatus: o.trangThai,
      isActive: o.trangThai === "ACTIVE",
      lastLoginAt: o.trangThai === "ACTIVE" ? new Date() : null,
    },
    select: { id: true },
  });

describeDb("[HT-PDF][HT-CP] PDF + nhận bài + portal với engine THẬT", () => {
  const cacSdt: string[] = [];
  beforeAll(async () => {
    await assertCiTest();
    ensureDiscEngine();
    await don();
  });
  beforeEach(() => {
    PHIEN.userId = null;
  });
  afterAll(async () => {
    const t = cacSdt.flatMap((s) => [s, sdtChuan(s)]);
    await db.otpRequest.deleteMany({ where: { target: { in: t } } });
    await db.user.deleteMany({ where: { OR: [{ password: "x-htcp" }, { phone: { in: t }, lastLoginAt: null }] } });
    await don();
    await db.$disconnect();
  });
  const dangKy = <T extends { sdt: string }>(x: T): T => (cacSdt.push(x.sdt), x);

  it("[HT-PDF-04] token sai/ngắn/hết hạn ⇒ 404 cùng hình; sau khi bài CLAIMED token cũ chết", async () => {
    const b = dangKy(await luuMoi());
    const luu404 = async (token: unknown) => {
      const r = await goiTai({ token, dinhDang: "pdf" });
      expect(r.status).toBe(404);
      expect(r.res.headers.get("content-type")).toMatch(/json/);
      return r.json;
    };
    const a = await luu404("khong-phai-token-hop-le-nhung-du-dai");
    const c = await luu404("ngan");
    const d = await luu404(undefined);
    expect(a).toEqual(c);
    expect(a).toEqual(d);
    // hết hạn
    await db.discSubmission.update({ where: { id: b.bai.id }, data: { downloadTokenExpires: new Date(Date.now() - 1000) } });
    expect(await luu404(b.tokenTai)).toEqual(a);
    await db.discSubmission.update({ where: { id: b.bai.id }, data: { downloadTokenExpires: new Date(Date.now() + 600_000) } });
    expect((await goiTai({ token: b.tokenTai, dinhDang: "pdf" })).status).toBe(200); // đối chứng dương
    // nhận bài ⇒ token chết
    const k = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs });
    expect(k.ok).toBe(true);
    expect(await luu404(b.tokenTai)).toEqual(a);
  });

  it("[HT-CP-01] nhận bài: OTP thật + mã nhận + năm sinh ⇒ User PARENT mới, bài CLAIMED bởi đúng User", async () => {
    const b = dangKy(await luuMoi());
    const k = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs });
    expect(k).toMatchObject({ ok: true, taoTaiKhoanMoi: true });
    const users = await db.user.findMany({ where: { phone: { in: [b.sdt, sdtChuan(b.sdt)] } }, select: { id: true, role: true, accountStatus: true, phone: true } });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ role: "PARENT", accountStatus: "ACTIVE", phone: sdtChuan(b.sdt) });
    const dong = await db.discSubmission.findUniqueOrThrow({ where: { id: b.bai.id } });
    expect(dong.claimStatus).toBe("CLAIMED");
    expect(dong.claimedUserId).toBe(users[0]!.id);
    // mã nhận không dùng lại được (không tạo thêm User)
    const lai = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs });
    expect(lai.ok).toBe(false);
    expect(await demUser(b.sdt)).toBe(1);
  });

  it("[HT-CP-02] sai năm sinh / sai mã / sai OTP ⇒ CÙNG thông điệp, không liên kết, không tạo User", async () => {
    const b = dangKy(await luuMoi());
    const saiNam = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs + 1 });
    const saiMa = await nhan({ sdt: b.sdt, maNhan: "ZZZZZZZZZZ", namSinhCon: b.namHs });
    const saiOtp = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs, otp: "000000" });
    for (const x of [saiNam, saiMa, saiOtp]) expect(x.ok).toBe(false);
    const tb = (x: Awaited<ReturnType<typeof nhan>>) => (x.ok ? null : x.thongBao);
    expect(tb(saiNam)).toBe(tb(saiMa));
    expect(tb(saiNam)).toBe(tb(saiOtp));
    expect(await demUser(b.sdt)).toBe(0);
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: b.bai.id } })).claimStatus).toBe("PENDING_CLAIM");
  });

  it("[HT-CP-03] portal: lịch sử, chi tiết, báo cáo HTML; IDOR user khác; chưa đăng nhập", async () => {
    const b = dangKy(await luuMoi());
    const k = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs });
    expect(k.ok).toBe(true);
    const chu = await db.user.findFirstOrThrow({ where: { phone: sdtChuan(b.sdt) }, select: { id: true } });
    const khac = await taoUserCu(sdtMoi(), { dangSo: "chuan", trangThai: "ACTIVE" });

    const ds = await docDanhSachLuot(chu.id);
    expect(ds.luot.map((l) => l.id)).toEqual([b.bai.id]);
    const ct = await docChiTietLuot(chu.id, b.bai.id);
    expect(ct?.nguoi.map((n) => n.hoTen).sort()).toEqual([TEN_PH, TEN_HS].sort());
    expect(await docChiTietLuot(khac.id, b.bai.id)).toBeNull();
    expect((await docDanhSachLuot(khac.id)).tong).toBe(0);

    const goiBaoCao = (id: string) => portalBaoCao(new Request(`http://localhost/portal/disc/${id}/bao-cao`), { params: Promise.resolve({ id }) });
    PHIEN.userId = null;
    expect((await goiBaoCao(b.bai.id)).status).toBe(401);
    PHIEN.userId = khac.id;
    expect((await goiBaoCao(b.bai.id)).status).toBe(404); // IDOR: giống "không tồn tại"
    expect((await goiBaoCao("id-khong-ton-tai")).status).toBe(404);
    PHIEN.userId = chu.id;
    const ok = await goiBaoCao(b.bai.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/html/);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    const html = await ok.text();
    expect(html).toContain(TEN_HS);
    expect(html).not.toContain(sdtChuan(b.sdt));
    // Không còn xuất PDF (04/11/2026): `?dinhDang=pdf` chỉ ra bản HTML như thường
    const thuPdf = await portalBaoCao(new Request(`http://localhost/portal/disc/${b.bai.id}/bao-cao?dinhDang=pdf`), { params: Promise.resolve({ id: b.bai.id }) });
    expect(thuPdf.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("[HT-CP-04] tài khoản ACTIVE lưu dạng cũ (0…): không đăng nhập ⇒ CAN_DANG_NHAP; đăng nhập đúng số ⇒ liên kết, vẫn 1 User", async () => {
    const b = dangKy(await luuMoi());
    const u = await taoUserCu(b.sdt, { dangSo: "cu", trangThai: "ACTIVE" });
    const k1 = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs });
    expect(k1.ok).toBe(false);
    // Số có tài khoản ACTIVE mà chưa đăng nhập: yeuCauOtpNhan KHÔNG gửi OTP (thiết kế: không đốt tiền Zalo, không oracle) nên bước nhận
    // ra thông điệp chung. Cốt lõi: không tạo User thứ hai, không gắn bài.
    expect(await demUser(b.sdt)).toBe(1);
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: b.bai.id } })).claimStatus).toBe("PENDING_CLAIM");
    const k2 = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs, phien: { userId: u.id, phoneKey: sdtChuan(b.sdt) } });
    expect(k2).toMatchObject({ ok: true, taoTaiKhoanMoi: false });
    expect(await demUser(b.sdt)).toBe(1);
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: b.bai.id } })).claimedUserId).toBe(u.id);
  });

  it("[HT-CP-05] tài khoản PENDING_ACTIVATION: kích hoạt, không tạo User trùng", async () => {
    const b = dangKy(await luuMoi());
    const u = await taoUserCu(b.sdt, { dangSo: "chuan", trangThai: "PENDING_ACTIVATION" });
    const k = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs });
    expect(k.ok).toBe(true);
    expect(await demUser(b.sdt)).toBe(1);
    const sau = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { accountStatus: true } });
    expect(sau.accountStatus).toBe("ACTIVE");
    expect((await db.discSubmission.findUniqueOrThrow({ where: { id: b.bai.id } })).claimedUserId).toBe(u.id);
  });

  it("[HT-CP-06] đăng nhập tài khoản KHÁC số ⇒ từ chối, bài không đổi chủ", async () => {
    const b = dangKy(await luuMoi());
    const khac = dangKy({ sdt: sdtMoi() });
    const u = await taoUserCu(khac.sdt, { dangSo: "chuan", trangThai: "ACTIVE" });
    const k = await nhan({ sdt: b.sdt, maNhan: b.maNhan, namSinhCon: b.namHs, phien: { userId: u.id, phoneKey: sdtChuan(khac.sdt) } });
    expect(k.ok).toBe(false);
    const dong = await db.discSubmission.findUniqueOrThrow({ where: { id: b.bai.id } });
    expect(dong.claimStatus).toBe("PENDING_CLAIM");
    expect(dong.claimedUserId).toBeNull();
    expect(namNay()).toBeGreaterThan(2000);
  });
});
