// Ca [KND-*] — «KẾT NỐI & KÝ» trên Postgres THẬT (hub/13): kế toán Hội sở tự khai tài khoản nhà cung cấp + cách ký cho từng PHÁP NHÂN.
//
// Thứ CHỈ đo được trên DB thật: ràng buộc UNIQUE/CHECK của migration, AuditLog cùng transaction, mật khẩu thực sự nằm trong cột dưới dạng chuỗi mã hoá
// (không phải bản rõ), hai người lưu lần đầu cùng lúc, và cổng lấy theo pháp nhân đọc đúng dòng. Bảng này KHÔNG có centerId ⇒ `scopedDb` không che gì:
// kiểm soát truy cập là của `ket-noi-db.ts` — ca [KND-02] canh đúng chỗ đó, kèm đối chứng dương.
// Bộ này KHÔNG gọi `resetDb()`: dọn đúng bảng của mình.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docCacKetNoi, docLichSuKetNoi, docTaiKhoanKetNoi, ghiKetQuaKiemTra, luuKetNoi, type DauVaoLuuKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { batLaiKy, tamDungKy } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { layCongHsmChoPhapNhan, layCongUsbChoPhapNhan, moiTruongSanSangHsm } from "@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan";
import { TAI_KHOAN_VIN_GIA, taoMayChuVinGia } from "@/lib/vin-hoadon/may-chu-vin-gia";

if (!RUN_DB_TESTS) console.warn(`[KND] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const KHOA = "khoa-hop-bi-mat-test-0123456789-abcdefghij"; // ≥ 32 ký tự — chuỗi TEST
const KHOA_MOI = "khoa-hop-bi-mat-MOI-9876543210-zyxwvutsrq";
const ENV = { HOA_DON_KHOA_BI_MAT: KHOA };
const NGUOI = { id: "fx-knd-ke-toan", name: "Kế toán Hội sở fixture" };
const MAT_KHAU = TAI_KHOAN_VIN_GIA.password;
const MST_VIN = "0402341070";

const actor = (centerScope: "ALL" | string[], quanTri = false) =>
  ({
    userId: NGUOI.id,
    isSuperAdmin: quanTri,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
  }) as unknown as Actor;
/** Quản trị tối cao (BGĐ 04/11/2026: CHỈ họ thay đổi cấu hình). Phạm vi kế toán của họ là ALL (`actionCenterScope`). */
const HO = actor("ALL", true);
/** Kế toán Hội sở (phạm vi ALL) — XEM được, KHÔNG ghi được. */
const KT_HO = actor("ALL");
const CS1 = actor(["cs1"]);

const du = (o: Partial<DauVaoLuuKetNoi> = {}): DauVaoLuuKetNoi => ({
  phapNhanMa: "NEW_VISION",
  moiTruong: "SANDBOX",
  nhaCungCapMa: "VIN_HOADON",
  dangBat: true,
  baseUrl: "https://vin-thu.example.test",
  mst: MST_VIN,
  tenDangNhap: TAI_KHOAN_VIN_GIA.username,
  phuongThucKy: "USB_TOKEN",
  cheDoKy: "LO",
  chungThuSerial: "5400FA1B2C3D",
  chungThuHetHan: "2027-05-01",
  ...o,
});
const luu = (d = du(), o: Partial<Parameters<typeof luuKetNoi>[0]> = {}) =>
  luuKetNoi({ actor: HO, nguoi: NGUOI, du: d, matKhauMoi: MAT_KHAU, lyDo: "Khai kết nối VIN lần đầu cho CS2", env: ENV, ...o });

async function don() {
  const ids = (await db.hoaDonKetNoiNhaCungCap.findMany({ select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { entityType: { in: ["HoaDonKetNoiNhaCungCap", "HoaDonKyChinhSach"] } } });
  await db.hoaDonKyChinhSach.deleteMany({ where: { capNhatBoiId: NGUOI.id } });
  await db.hoaDonKetNoiNhaCungCap.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[KND] kết nối nhà cung cấp theo pháp nhân — Postgres thật", () => {
  beforeEach(don);
  afterAll(don);

  it("[KND-01] lưu mới ⇒ dòng + AuditLog cùng transaction; cột mật khẩu là chuỗi mã hoá, KHÔNG phải bản rõ; không bản rõ ở đâu trong DB", async () => {
    const r = await luu();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doiMatKhau).toBe(true);
    const hang = await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } });
    expect(hang).toMatchObject({ phapNhanMa: "NEW_VISION", moiTruong: "SANDBOX", nhaCungCapMa: "VIN_HOADON", phuongThucKy: "USB_TOKEN", cheDoKy: "LO", capNhatBoiId: NGUOI.id });
    expect(hang.matKhauMaHoa).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(hang)).not.toContain(MAT_KHAU);
    const ls = await db.auditLog.findMany({ where: { entityType: "HoaDonKetNoiNhaCungCap", entityId: r.id } });
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ action: "TAO_KET_NOI_NHA_CUNG_CAP", actorName: NGUOI.name, reason: "Khai kết nối VIN lần đầu cho CS2" });
    expect(JSON.stringify(ls[0])).not.toContain(MAT_KHAU);
    expect(JSON.stringify(ls[0])).not.toContain(hang.matKhauMaHoa!);
  });

  it("[KND-02] ĐỌC: kế toán Hội sở + Quản trị tối cao; kế toán cơ sở KHÔNG. GHI: CHỈ Quản trị tối cao — kế toán Hội sở cũng bị từ chối (BGĐ 04/11/2026). Đối chứng dương: Quản trị tối cao làm được cùng thao tác", async () => {
    expect((await luu(du(), { actor: CS1 })).ok).toBe(false);
    const ktHo = await luu(du(), { actor: KT_HO });
    expect(ktHo).toMatchObject({ ok: false });
    expect(ktHo.ok ? "" : ktHo.error).toMatch(/Quản trị tối cao/);
    expect(await db.hoaDonKetNoiNhaCungCap.count()).toBe(0);
    const ok = await luu();
    expect(ok.ok).toBe(true);
    expect(await docCacKetNoi(CS1)).toEqual([]);
    expect(await docCacKetNoi(HO)).toHaveLength(1);
    expect(await docCacKetNoi(KT_HO)).toHaveLength(1); // kế toán Hội sở vẫn XEM
    expect(await docLichSuKetNoi(CS1, ok.ok ? [ok.id] : [])).toEqual([]);
    expect(await docLichSuKetNoi(HO, ok.ok ? [ok.id] : [])).toHaveLength(1);
    // sửa bằng kế toán cơ sở cũng bị từ chối, dòng giữ nguyên
    const sua = await luu(du({ dangBat: false }), { actor: CS1, matKhauMoi: null, lyDo: "Cơ sở thử tắt kết nối của Hội sở" });
    expect(sua.ok).toBe(false);
    expect((await db.hoaDonKetNoiNhaCungCap.findFirstOrThrow()).dangBat).toBe(true);
  });

  it("[KND-03] giao diện KHÔNG bao giờ nhận mật khẩu hay chuỗi mã hoá: kết quả đọc chỉ có `coMatKhau`", async () => {
    const r = await luu();
    if (!r.ok) throw new Error("kỳ vọng ok");
    const cot = (await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } })).matKhauMaHoa!;
    const ds = await docCacKetNoi(HO);
    expect(ds[0]!.coMatKhau).toBe(true);
    const json = JSON.stringify(ds);
    expect(json).not.toContain(MAT_KHAU);
    expect(json).not.toContain(cot);
    expect(Object.keys(ds[0]!)).not.toContain("matKhauMaHoa");
  });

  it("[KND-04] đổi địa chỉ / MST / tên đăng nhập mà KHÔNG nhập lại mật khẩu ⇒ TỪ CHỐI; nhập lại thì được; sửa trường khác giữ nguyên mật khẩu cũ", async () => {
    const r = await luu();
    if (!r.ok) throw new Error("kỳ vọng ok");
    const truoc = (await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } })).matKhauMaHoa;
    const lyDo = "Đổi máy chủ VIN theo thông báo của nhà cung cấp";
    for (const doi of [{ baseUrl: "https://may-chu-khac.example.test" }, { mst: "0402341056" }, { tenDangNhap: "nguoi-khac" }]) {
      const x = await luu(du(doi), { matKhauMoi: null, lyDo });
      expect(x.ok, JSON.stringify(doi)).toBe(false);
      expect(x.ok ? "" : x.error).toMatch(/nhập lại mật khẩu/);
    }
    expect((await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } })).matKhauMaHoa).toBe(truoc);
    // đối chứng dương: nhập lại mật khẩu thì đổi được
    const ok = await luu(du({ baseUrl: "https://may-chu-khac.example.test" }), { matKhauMoi: "mat-khau-moi-nhap-lai", lyDo });
    expect(ok.ok).toBe(true);
    // sửa trường KHÁC (chế độ ký) không cần mật khẩu và KHÔNG đổi chuỗi mã hoá
    const giu = (await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } })).matKhauMaHoa;
    const khac = await luu(du({ baseUrl: "https://may-chu-khac.example.test", cheDoKy: "TUNG_LENH" }), { matKhauMoi: null, lyDo: "Chuyển sang ký từng hoá đơn" });
    expect(khac.ok).toBe(true);
    if (khac.ok) expect(khac).toMatchObject({ doiMatKhau: false, truongDoi: ["cheDoKy"] });
    expect((await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } })).matKhauMaHoa).toBe(giu);
  });

  it("[KND-05] khoá mã hoá của máy chủ thiếu / ngắn ⇒ KHÔNG lưu (fail-closed), không dòng nào được tạo, không rơi về lưu thô", async () => {
    for (const env of [{}, { HOA_DON_KHOA_BI_MAT: "ngan" }]) {
      const x = await luu(du(), { env });
      expect(x.ok).toBe(false);
      expect(x.ok ? "" : x.error).toMatch(/HOA_DON_KHOA_BI_MAT/);
    }
    expect(await db.hoaDonKetNoiNhaCungCap.count()).toBe(0);
    expect((await luu()).ok).toBe(true); // đối chứng dương: có khoá thì lưu được
  });

  it("[KND-06] nhật ký chỉ ghi TÊN trường đã đổi + giá trị không nhạy cảm; mật khẩu chỉ là cờ `matKhauDoi`", async () => {
    const r = await luu();
    if (!r.ok) throw new Error("kỳ vọng ok");
    await luu(du({ chungThuSerial: "AABBCCDD", cheDoKy: "TUNG_LENH" }), { matKhauMoi: null, lyDo: "Đổi chứng thư sau khi gia hạn token" });
    const ls = await docLichSuKetNoi(HO, [r.id]);
    expect(ls).toHaveLength(2);
    const moiNhat = ls[0]!;
    expect(moiNhat.action).toBe("SUA_KET_NOI_NHA_CUNG_CAP");
    expect([...moiNhat.truongDoi].sort()).toEqual(["cheDoKy", "chungThuSerial"]);
    expect(moiNhat.matKhauDoi).toBe(false);
    expect(ls[1]!.matKhauDoi).toBe(true);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityType: "HoaDonKetNoiNhaCungCap" } }))).not.toContain(MAT_KHAU);
  });

  it("[KND-07] đọc cho phát hành: giải mã đúng; xoay khoá — khoá mới thiếu khoá cũ ⇒ KHONG_GIAI_MA_DUOC, có khoá cũ ⇒ giải được; thiếu khoá ⇒ KHOA_THIEU", async () => {
    await luu();
    const tk = await docTaiKhoanKetNoi("NEW_VISION", "SANDBOX", ENV);
    expect(tk.cauHinhVin).toEqual({ cheDo: "sandbox", baseUrl: "https://vin-thu.example.test", username: TAI_KHOAN_VIN_GIA.username, password: MAT_KHAU });
    expect(tk.loi).toBeNull();
    const moi = await docTaiKhoanKetNoi("NEW_VISION", "SANDBOX", { HOA_DON_KHOA_BI_MAT: KHOA_MOI });
    expect(moi.cauHinhVin).toBeNull();
    expect(moi.loi).toBe("KHONG_GIAI_MA_DUOC");
    const xoay = await docTaiKhoanKetNoi("NEW_VISION", "SANDBOX", { HOA_DON_KHOA_BI_MAT: KHOA_MOI, HOA_DON_KHOA_BI_MAT_CU: KHOA });
    expect(xoay.cauHinhVin?.password).toBe(MAT_KHAU);
    expect((await docTaiKhoanKetNoi("NEW_VISION", "SANDBOX", {})).loi).toBe("KHOA_THIEU");
    expect((await docTaiKhoanKetNoi("NEW_VISION", "PROD", ENV)).hang).toBeNull(); // môi trường khác ⇒ dòng khác
  });

  it("[KND-08] chuỗi mã hoá chép sang DÒNG KHÁC không giải được (AAD = id dòng)", async () => {
    await luu();
    await luu(du({ phapNhanMa: "STEM_ROBOTICS_AI", mst: "0402341056" }), { lyDo: "Khai kết nối VIN lần đầu cho CS1" });
    const [a, b] = await db.hoaDonKetNoiNhaCungCap.findMany({ orderBy: { phapNhanMa: "asc" } });
    await db.hoaDonKetNoiNhaCungCap.update({ where: { id: b!.id }, data: { matKhauMaHoa: a!.matKhauMaHoa } });
    expect((await docTaiKhoanKetNoi(b!.phapNhanMa, "SANDBOX", ENV)).loi).toBe("KHONG_GIAI_MA_DUOC");
    expect((await docTaiKhoanKetNoi(a!.phapNhanMa, "SANDBOX", ENV)).loi).toBeNull(); // đối chứng: dòng gốc vẫn giải được
  });

  it("[KND-09] ràng buộc DB: UNIQUE (pháp nhân, môi trường); CHECK từ chối mật khẩu KHÔNG phải chuỗi mã hoá", async () => {
    await luu();
    await expect(
      db.hoaDonKetNoiNhaCungCap.create({ data: { phapNhanMa: "NEW_VISION", moiTruong: "SANDBOX", nhaCungCapMa: "VIN_HOADON", capNhatBoiId: "x" } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      db.hoaDonKetNoiNhaCungCap.create({ data: { phapNhanMa: "SATA_ROBO", moiTruong: "SANDBOX", nhaCungCapMa: "MISA_MEINVOICE", capNhatBoiId: "x", matKhauMaHoa: MAT_KHAU } }),
    ).rejects.toBeTruthy(); // bản rõ bị CHECK chặn
    await expect(
      db.hoaDonKetNoiNhaCungCap.create({ data: { phapNhanMa: "SATA_ROBO", moiTruong: "SANDBOX", nhaCungCapMa: "KHAC", capNhatBoiId: "x" } }),
    ).rejects.toBeTruthy();
    expect(await db.hoaDonKetNoiNhaCungCap.count()).toBe(1);
  });

  it("[KND-10] HAI người lưu lần đầu CÙNG LÚC ⇒ đúng một dòng, bên kia nhận câu cố định (không lỗi thô)", async () => {
    const [a, b] = await Promise.all([luu(), luu()]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const bai = [a, b].find((x) => !x.ok);
    expect(bai && !bai.ok ? bai.error : "").toMatch(/vừa lưu/);
    expect(await db.hoaDonKetNoiNhaCungCap.count()).toBe(1);
  });

  it("[KND-11] cổng HSM theo pháp nhân: dòng VIN+HSM ⇒ cổng THẬT dùng đúng tài khoản trong bảng (gửi tới máy chủ giả); USB ⇒ KHÔNG nhận cổng HSM", async () => {
    const may = taoMayChuVinGia();
    await luu(du({ phuongThucKy: "HSM_NHA_CUNG_CAP", chungThuSerial: null, chungThuHetHan: null }));
    const hsm = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV, fetchImpl: may.fetchImpl });
    expect(hsm.ok).toBe(true);
    if (!hsm.ok) return;
    expect(hsm.nguon).toBe("BANG");
    // gọi thật qua cổng: GetToken phải mang tài khoản/mật khẩu giải mã từ bảng
    const kq = await hsm.cong.traCuu("khong-co-hoa-don-nay", MST_VIN);
    expect(kq.loai).toBe("CHUA_CO");
    expect(may.cuocGoi[0]!.body).toMatchObject({ username: TAI_KHOAN_VIN_GIA.username, password: MAT_KHAU, doanhnghiep_mst: MST_VIN });

    await luu(du({ phuongThucKy: "USB_TOKEN" }), { matKhauMoi: null, lyDo: "Chuyển sang ký bằng USB token" });
    const usb = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV, fetchImpl: may.fetchImpl });
    expect(usb).toMatchObject({ ok: false, usb: true });
    const duongUsb = await layCongUsbChoPhapNhan("NEW_VISION", "GUI", { env: ENV, fetchImpl: may.fetchImpl });
    expect(duongUsb.ok).toBe(true);
    if (duongUsb.ok) expect(duongUsb).toMatchObject({ cheDoKy: "LO", mst: MST_VIN });
  });

  it("[KND-12] đường USB chỉ mở khi dòng BẬT + VIN + USB; dòng HSM, dòng TẮT, pháp nhân lạ ⇒ không", async () => {
    await luu(du({ phuongThucKy: "HSM_NHA_CUNG_CAP", chungThuSerial: null, chungThuHetHan: null }));
    expect((await layCongUsbChoPhapNhan("NEW_VISION", "GUI", { env: ENV })).ok).toBe(false);
    await luu(du({ phuongThucKy: "USB_TOKEN" }), { matKhauMoi: null, lyDo: "Chuyển sang ký bằng USB token" });
    expect((await layCongUsbChoPhapNhan("NEW_VISION", "GUI", { env: ENV })).ok).toBe(true); // đối chứng dương
    await luu(du({ phuongThucKy: "USB_TOKEN", dangBat: false }), { matKhauMoi: null, lyDo: "Tạm tắt kết nối trong lúc đổi token" });
    const tat = await layCongUsbChoPhapNhan("NEW_VISION", "GUI", { env: ENV });
    expect(tat.ok).toBe(false);
    expect((await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV })).ok).toBe(false); // TẮT ⇒ không phát hành, không rơi về env
    expect((await layCongUsbChoPhapNhan("PHAP_NHAN_LA", "GUI", { env: ENV })).ok).toBe(false);
  });

  it("[KND-13] không có dòng và không có env ⇒ KHÔNG có cổng (và KHÔNG ném lỗi); câu lỗi chỉ đường tới «Kết nối & ký»", async () => {
    const r = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV });
    expect(r).toMatchObject({ ok: false, usb: false });
    expect(r.ok ? "" : r.lyDo).toMatch(/Kết nối & ký/);
  });

  it("[KND-14] khoá env bị đổi sau khi lưu ⇒ cổng nói rõ «không giải mã được», KHÔNG ném, KHÔNG lộ chuỗi mã hoá", async () => {
    await luu(du({ phuongThucKy: "HSM_NHA_CUNG_CAP", chungThuSerial: null, chungThuHetHan: null }));
    const cot = (await db.hoaDonKetNoiNhaCungCap.findFirstOrThrow()).matKhauMaHoa!;
    const r = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: { HOA_DON_KHOA_BI_MAT: KHOA_MOI } });
    expect(r.ok).toBe(false);
    const tb = r.ok ? "" : r.lyDo;
    expect(tb).toMatch(/giải mã/);
    expect(tb).not.toContain(cot);
    expect(tb).not.toContain(MAT_KHAU);
  });

  it("[KND-15] kiểm tra kết nối: ghi MÃ cố định + lúc kiểm; đổi tài khoản thì kết quả cũ bị xoá", async () => {
    const r = await luu();
    if (!r.ok) throw new Error("kỳ vọng ok");
    await ghiKetQuaKiemTra({ phapNhanMa: "NEW_VISION", moiTruong: "SANDBOX", ketQua: "OK", now: new Date("2026-11-04T03:00:00.000Z") });
    let d = (await docCacKetNoi(HO))[0]!;
    expect(d).toMatchObject({ kiemTraKetQua: "OK", kiemTraLuc: "2026-11-04T03:00:00.000Z" });
    await luu(du(), { matKhauMoi: null, lyDo: "Sửa chứng thư, không đổi tài khoản" });
    d = (await docCacKetNoi(HO))[0]!;
    expect(d.kiemTraKetQua).toBe("OK"); // chỉ đổi chứng thư ⇒ giữ
    await luu(du({ tenDangNhap: "tai-khoan-moi" }), { matKhauMoi: "mat-khau-moi-tai-khoan-moi", lyDo: "Đổi sang tài khoản VIN mới" });
    d = (await docCacKetNoi(HO))[0]!;
    expect(d.kiemTraKetQua).toBeNull();
    expect(d.kiemTraLuc).toBeNull();
  });

  it("[KND-16] điều kiện HIỆN nút theo nhà cung cấp: có dòng VIN+HSM đủ thông tin ⇒ sẵn sàng; USB ⇒ không; MISA chỉ sẵn sàng khi dòng mang ĐỦ tài khoản MISA", async () => {
    expect(await moiTruongSanSangHsm("VIN_HOADON", { env: ENV })).toBeNull();
    await luu(du({ phuongThucKy: "USB_TOKEN" }));
    expect(await moiTruongSanSangHsm("VIN_HOADON", { env: ENV })).toBeNull(); // USB không phải đường HSM
    await luu(du({ phuongThucKy: "HSM_NHA_CUNG_CAP", chungThuSerial: null, chungThuHetHan: null }), { matKhauMoi: null, lyDo: "Chuyển sang HSM của nhà cung cấp" });
    expect(await moiTruongSanSangHsm("VIN_HOADON", { env: ENV })).toBe("sandbox");
    expect(await moiTruongSanSangHsm("MISA_MEINVOICE", { env: ENV })).toBeNull(); // dòng MISA chỉ ghi phương thức ký KHÔNG làm MISA «sẵn sàng»
  });

  it("[KND-17] dòng TẮT ⇒ KHÔNG rơi về biến môi trường dù env đủ (kế toán tắt có chủ đích); đối chứng dương: chưa có dòng ⇒ env được dùng", async () => {
    const BIEN = ["VIN_EINVOICE_MODE", "VIN_EINVOICE_BASE_URL", "VIN_EINVOICE_USERNAME", "VIN_EINVOICE_PASSWORD"] as const;
    const cu = Object.fromEntries(BIEN.map((k) => [k, process.env[k]]));
    Object.assign(process.env, { VIN_EINVOICE_MODE: "sandbox", VIN_EINVOICE_BASE_URL: "https://env-vin.example.test", VIN_EINVOICE_USERNAME: "u-env", VIN_EINVOICE_PASSWORD: "p-env" });
    try {
      const khongDong = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV });
      expect(khongDong).toMatchObject({ ok: true, nguon: "ENV" });
      await luu(du({ phuongThucKy: "HSM_NHA_CUNG_CAP", dangBat: false, chungThuSerial: null, chungThuHetHan: null }));
      const tat = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV });
      expect(tat).toMatchObject({ ok: false, usb: false });
      expect(tat.ok ? "" : tat.lyDo).toMatch(/Kết nối & ký/);
    } finally {
      for (const k of BIEN) {
        if (cu[k] === undefined) delete process.env[k];
        else process.env[k] = cu[k];
      }
    }
  });

  // ── MISA THEO PHÁP NHÂN (BGĐ 04/11/2026) ─────────────────────────────────────────────────────────────────────────────────

  const duMisa = (o: Partial<DauVaoLuuKetNoi> = {}): DauVaoLuuKetNoi => ({
    phapNhanMa: "SATA_ROBO",
    moiTruong: "SANDBOX",
    nhaCungCapMa: "MISA_MEINVOICE",
    dangBat: true,
    baseUrl: "https://testapi.meinvoice.vn/api/v3",
    mst: "0402341070",
    tenDangNhap: "misa-user",
    phuongThucKy: "HSM_NHA_CUNG_CAP",
    cheDoKy: "LO",
    chungThuSerial: null,
    chungThuHetHan: null,
    misaAppId: "app-id-thu",
    misaLoaiHoaDon: "co-ma",
    ...o,
  });
  const luuMisa = (d = duMisa(), o: Partial<Parameters<typeof luuKetNoi>[0]> = {}) => luuKetNoi({ actor: HO, nguoi: NGUOI, du: d, matKhauMoi: "Mat-Khau-MISA-thu-1", lyDo: "Chuyển tài khoản MISA sang lưu mã hoá theo pháp nhân", env: ENV, ...o });

  function fetchGhi() {
    const urls: string[] = [];
    return { urls, fetchImpl: async (u: string) => { urls.push(u); throw new Error("mạng giả: không gọi ra ngoài"); } };
  }
  const phieuMst = (mst: string) =>
    ({
      refId: "r1",
      kyHieu: "1C26TSR",
      mstNguoiBan: mst,
      ngayHoaDon: new Date("2026-11-04T00:00:00Z"),
      nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null },
      hinhThucThanhToan: "Chuyển khoản",
      dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 }],
      tongTruocThue: 5_000_000,
      tongThue: 0,
      tongThanhToan: 5_000_000,
      soTienBangChu: "Năm triệu đồng.",
    }) as never;

  it("[KND-18] MISA theo pháp nhân: lưu đủ tài khoản ⇒ mật khẩu MÃ HOÁ, cổng dựng từ DÒNG (host MISA đúng, không phải biến môi trường); nhật ký không chứa mật khẩu và ghi AppID đã đổi", async () => {
    const r = await luuMisa();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hang = await db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id: r.id } });
    expect(hang).toMatchObject({ misaAppId: "app-id-thu", misaLoaiHoaDon: "co-ma" });
    expect(hang.matKhauMaHoa).toMatch(/^v1\./);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: r.id } }))).not.toContain("Mat-Khau-MISA-thu-1");
    const may = fetchGhi();
    const g = await layCongHsmChoPhapNhan("SATA_ROBO", "GUI", { env: ENV, fetchImpl: may.fetchImpl });
    expect(g).toMatchObject({ ok: true, nguon: "BANG" });
    if (!g.ok) return;
    expect(["KHONG_RO", "CHUA_CO"]).toContain((await g.cong.traCuu("r1", "0402341070")).loai);
    expect(may.urls[0]).toBe("https://testapi.meinvoice.vn/api/v3/auth/token");
    expect(await moiTruongSanSangHsm("MISA_MEINVOICE", { env: ENV })).toBe("sandbox");
  });

  it("[KND-19] MISA: host sai môi trường bị chặn LÚC LƯU (sandbox chỉ testapi.meinvoice.vn); dòng lỡ chèn host lạ vẫn bị chặn LÚC DÙNG (CAU_HINH_SAI) và KHÔNG rơi về env", async () => {
    const loi = await luuMisa(duMisa({ baseUrl: "https://evil.example.com/api/v3" }));
    expect(loi.ok).toBe(false);
    expect(loi.ok ? "" : loi.error).toMatch(/testapi\.meinvoice\.vn/);
    expect(await db.hoaDonKetNoiNhaCungCap.count()).toBe(0);
    const ok = await luuMisa();
    if (!ok.ok) throw new Error("kỳ vọng ok");
    await db.hoaDonKetNoiNhaCungCap.update({ where: { id: ok.id }, data: { baseUrl: "https://evil.example.com/api/v3" } }); // ghi thẳng, lách lớp lưu
    const tk = await docTaiKhoanKetNoi("SATA_ROBO", "SANDBOX", ENV);
    expect(tk).toMatchObject({ cauHinhMisa: null, loi: "CAU_HINH_SAI" });
    const may = fetchGhi();
    const g = await layCongHsmChoPhapNhan("SATA_ROBO", "GUI", { env: ENV, fetchImpl: may.fetchImpl });
    expect(g.ok).toBe(false);
    expect(g.ok ? "" : g.lyDo).toMatch(/luật chống trỏ nhầm/);
    expect(may.urls).toHaveLength(0);
  });

  it("[KND-20] CẤU HÌNH CŨ KHÔNG VỠ: dòng MISA chỉ ghi phương thức ký (không tài khoản) ⇒ cổng vẫn lấy từ BIẾN MÔI TRƯỜNG; đủ tài khoản ⇒ lấy từ dòng", async () => {
    const BIEN = { MISA_EINVOICE_MODE: "gia-lap" } as const;
    const cu = process.env.MISA_EINVOICE_MODE;
    Object.assign(process.env, BIEN);
    try {
      const cuMisa = duMisa({ baseUrl: null, mst: null, tenDangNhap: null, misaAppId: null, misaLoaiHoaDon: null });
      const r = await luuMisa(cuMisa, { matKhauMoi: null });
      expect(r.ok).toBe(true);
      const envG = await layCongHsmChoPhapNhan("SATA_ROBO", "GUI", { env: ENV });
      expect(envG).toMatchObject({ ok: true, nguon: "BANG" });
      expect(envG.ok && envG.cong.cheDo).toBe("GIA_LAP"); // cổng env (giả lập), không phải HSM thật từ dòng
      const day = await luuMisa(duMisa());
      expect(day.ok).toBe(true);
      const bang = await layCongHsmChoPhapNhan("SATA_ROBO", "GUI", { env: ENV, fetchImpl: fetchGhi().fetchImpl });
      expect(bang.ok && bang.cong.cheDo).toBe("HSM");
    } finally {
      if (cu === undefined) delete process.env.MISA_EINVOICE_MODE;
      else process.env.MISA_EINVOICE_MODE = cu;
    }
  });

  it("[KND-21] KHOÁ MST: cổng từ BẢNG chỉ phát hành phiếu có MST người bán đúng MST của dòng; MST lạ ⇒ TU_CHOI SAI_MST_CAU_HINH, KHÔNG gọi nhà cung cấp (đối chứng dương: MST đúng thì đi tới tầng mạng)", async () => {
    await luuMisa();
    const may = fetchGhi();
    const g = await layCongHsmChoPhapNhan("SATA_ROBO", "GUI", { env: ENV, fetchImpl: may.fetchImpl });
    if (!g.ok) throw new Error("kỳ vọng cổng");
    const sai = await g.cong.phatHanh(phieuMst("0999999999"));
    expect(sai).toMatchObject({ loai: "TU_CHOI", ma: "SAI_MST_CAU_HINH" });
    expect(may.urls).toHaveLength(0);
    await g.cong.phatHanh(phieuMst("0402341070")); // đúng MST ⇒ chạm tầng mạng (giả, ném) ⇒ KHONG_RO
    expect(may.urls.length).toBeGreaterThan(0);
  });

  it("[KND-22] TẠM DỪNG KÝ: mức GUI bị chặn ở CẢ cổng HSM lẫn cổng USB (tamDung: true); mức TRA_CUU KHÔNG bị chặn; bật lại ⇒ GUI lại được", async () => {
    await luu(du({ phuongThucKy: "HSM_NHA_CUNG_CAP", chungThuSerial: null, chungThuHetHan: null }));
    const dung = await tamDungKy({ actor: HO, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Nghi lộ khoá API VIN", suCo: true, now: new Date() });
    expect(dung).toEqual({ ok: true });
    const hsm = await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV });
    expect(hsm).toMatchObject({ ok: false, tamDung: true });
    expect(await layCongUsbChoPhapNhan("NEW_VISION", "GUI", { env: ENV })).toMatchObject({ ok: false, tamDung: true });
    expect(await layCongHsmChoPhapNhan("NEW_VISION", "TRA_CUU", { env: ENV })).toMatchObject({ ok: true });
    const bat = await batLaiKy({ actor: HO, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Đã đổi khoá, rà soát xong", xacNhanSuCo: true });
    expect(bat).toEqual({ ok: true });
    expect(await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV })).toMatchObject({ ok: true });
  });
});
