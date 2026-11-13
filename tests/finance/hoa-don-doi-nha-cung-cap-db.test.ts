// Ca [DNC-DB-*] — ĐỔI NHÀ CUNG CẤP của pháp nhân (MISA ⇄ VIN-HOADON) trên Postgres THẬT. 05/11/2026.
//
// Anh chốt: «lỡ trong thời gian sử dụng HO không dùng MISA mà chuyển sang VIN-HOADON thì sao, dev phải code cứng?» ⇒ Quản trị tối cao tự đổi ở «Kết nối & ký».
// Thứ CHỈ đo được trên DB thật: (1) cổng từ chối nằm TRƯỚC phép ghi đầu tiên (return không rollback — nên mỗi ca từ chối kiểm DÒNG KHÔNG ĐỔI + không vết);
// (2) tài khoản cũ bị XOÁ thật trong cột (mật khẩu cũ vẫn giải mã được nếu giữ cùng id dòng ⇒ sẽ bị gửi tới nhà cung cấp mới);
// (3) cổng lấy theo pháp nhân đọc ĐÚNG dòng và trả đúng nhà cung cấp; (4) `batDauPhatHanh` đối chiếu lại dưới khoá và KHÔNG tạo hoá đơn khi lệch.
// Pháp nhân thử = SATA_ROBO (mặc định trong mã = MISA) — đúng ca «HO chuyển sang VIN».
// Bộ này KHÔNG gọi `resetDb()`: dọn đúng dữ liệu của mình.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docNhaCungCapDaChon, luuKetNoi, type DauVaoLuuKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { layCongHsmChoPhapNhan } from "@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan";
import { batLaiKy, tamDungKy } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { TAI_KHOAN_VIN_GIA } from "@/lib/vin-hoadon/may-chu-vin-gia";

if (!RUN_DB_TESTS) console.warn(`[DNC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-dnc-";
const CS = `${T}cs`;
const DON = `${T}don`;
const HD = `${T}hd`;
const PN = "SATA_ROBO";
const MST = "0402301783";
const KHOA = "khoa-doi-ncc-0123456789-abcdefghijklmnopqrstuv";
const ENV = { HOA_DON_KHOA_BI_MAT: KHOA };
const NGUOI = { id: `${T}admin`, name: "Quản trị tối cao fixture" };
const CIPHER_MISA_CU = "v1.00000000.AAAA.BBBB.CCCC"; // chuỗi mã hoá GIẢ của mật khẩu MISA cũ — chỉ để thấy nó bị xoá

const QT = { userId: NGUOI.id, isSuperAdmin: true, grantsAllow: new Set<string>(), permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: "ALL" }] } as unknown as Actor;
const KT_HO = { ...QT, isSuperAdmin: false } as unknown as Actor;

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function don() {
  const lenh = await db.hoaDonLenhKy.findMany({ where: { hoaDonId: HD }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "HoaDonKetNoiNhaCungCap" }, { entityType: "HoaDonKyChinhSach" }, { entityId: { in: [HD, ...lenh.map((l) => l.id)] } }] } });
  await db.hoaDonLenhKy.deleteMany({ where: { hoaDonId: HD } });
  await db.hoaDonDienTu.deleteMany({ where: { id: HD } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.hoaDonKyChinhSach.deleteMany({ where: { phapNhanMa: PN } });
  await db.hoaDonKetNoiNhaCungCap.deleteMany({ where: { phapNhanMa: PN } });
}

/** Dòng MISA đã khai ĐỦ (có mật khẩu mã hoá) — đúng hình dạng của HO hôm nay sau khi khai ở «Kết nối & ký». */
async function dungDongMisa() {
  const h = await db.hoaDonKetNoiNhaCungCap.create({
    data: {
      phapNhanMa: PN,
      moiTruong: "SANDBOX",
      nhaCungCapMa: "MISA_MEINVOICE",
      dangBat: true,
      baseUrl: "https://testapi.meinvoice.vn/api/v3",
      mst: MST,
      tenDangNhap: "ketoan-misa",
      matKhauMaHoa: CIPHER_MISA_CU,
      matKhauCapNhatLuc: new Date(),
      phuongThucKy: "HSM_NHA_CUNG_CAP",
      cheDoKy: "LO",
      misaAppId: "app-cu",
      misaLoaiHoaDon: "co-ma",
      capNhatBoiId: NGUOI.id,
    },
  });
  return h.id;
}

/** Hoá đơn của SATA_ROBO ở trạng thái đang đi qua nhà cung cấp (cần Center + Order thật). */
async function dungHoaDon(trangThai: "DANG_PHAT_HANH" | "LOI_PHAT_HANH" | "DA_XAC_NHAN") {
  await db.center.create({ data: { id: CS, name: "CS DNC", slug: CS, address: "x" } });
  await db.order.create({ data: { id: DON, code: "ORD-269976-000001", type: "COURSE", status: "CONFIRMED", customerName: "Phụ huynh", customerPhone: "0328545552", totalAmount: 5_000_000, centerId: CS } });
  await db.hoaDonDienTu.create({ data: { id: HD, orderId: DON, centerId: CS, trangThai, tongTien: 5_000_000, taoBoiId: `${T}kt`, phapNhanMa: PN, phapNhanMst: MST, nhaCungCapMa: "MISA_MEINVOICE" } });
}

const pause = () => tamDungKy({ actor: QT, nguoi: NGUOI, phapNhanMa: PN, lyDo: "Chuyển nhà cung cấp hoá đơn của HO sang VIN", suCo: false, now: new Date() });

const duVin = (o: Partial<DauVaoLuuKetNoi> = {}): DauVaoLuuKetNoi => ({
  phapNhanMa: PN,
  moiTruong: "SANDBOX",
  nhaCungCapMa: "VIN_HOADON",
  dangBat: true,
  baseUrl: "https://vin-thu.example.test",
  mst: MST,
  tenDangNhap: TAI_KHOAN_VIN_GIA.username,
  phuongThucKy: "HSM_NHA_CUNG_CAP",
  cheDoKy: "LO",
  chungThuSerial: null,
  chungThuHetHan: null,
  ...o,
});
const luu = (d = duVin(), o: Partial<Parameters<typeof luuKetNoi>[0]> = {}) =>
  luuKetNoi({ actor: QT, nguoi: NGUOI, du: d, matKhauMoi: TAI_KHOAN_VIN_GIA.password, lyDo: "HO chuyển từ MISA sang VIN-HOADON theo quyết định", env: ENV, ...o });

const dongGoc = (id: string) => db.hoaDonKetNoiNhaCungCap.findUniqueOrThrow({ where: { id } });

describe.skipIf(!RUN_DB_TESTS)("[DNC-DB] đổi nhà cung cấp của pháp nhân — Postgres thật", () => {
  beforeEach(don);
  afterAll(don);

  it("[DNC-DB-01] CHƯA tạm dừng ký ⇒ từ chối, dòng + mật khẩu cũ NGUYÊN VẸN, không vết «đổi»", async () => {
    const id = await dungDongMisa();
    const truoc = JSON.stringify(await dongGoc(id));
    const r = await luu();
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/TẠM DỪNG KÝ/);
    expect(JSON.stringify(await dongGoc(id))).toBe(truoc);
    expect(await db.auditLog.count({ where: { entityType: "HoaDonKetNoiNhaCungCap", action: "DOI_NHA_CUNG_CAP" } })).toBe(0);
  });

  it("[DNC-DB-02] đã tạm dừng NHƯNG còn hoá đơn đang phát hành dở / phát hành lỗi ⇒ từ chối, dòng nguyên vẹn", async () => {
    const id = await dungDongMisa();
    expect((await pause()).ok).toBe(true);
    for (const tt of ["DANG_PHAT_HANH", "LOI_PHAT_HANH"] as const) {
      await db.hoaDonDienTu.deleteMany({ where: { id: HD } });
      await db.order.deleteMany({ where: { id: DON } });
      await db.center.deleteMany({ where: { id: CS } });
      await dungHoaDon(tt);
      const truoc = JSON.stringify(await dongGoc(id));
      const r = await luu();
      expect(r.ok, tt).toBe(false);
      expect(r.ok ? "" : r.error, tt).toMatch(/đang phát hành dở|phát hành lỗi/);
      expect(JSON.stringify(await dongGoc(id)), tt).toBe(truoc);
    }
  });

  it("[DNC-DB-03] đã tạm dừng NHƯNG còn lệnh ký đang chờ ⇒ từ chối (lệnh ký gọi lại nhà cung cấp cũ)", async () => {
    const id = await dungDongMisa();
    expect((await pause()).ok).toBe(true);
    await dungHoaDon("DA_XAC_NHAN"); // chính hoá đơn không chặn…
    await db.hoaDonLenhKy.create({ data: { hoaDonId: HD, centerId: CS, phuongThuc: "USB_TOKEN", trangThai: "CHO_KY", nguoiYeuCauId: NGUOI.id, duLieuCanKyHash: "h" } }); // …lệnh chờ thì chặn
    const truoc = JSON.stringify(await dongGoc(id));
    const r = await luu();
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/lệnh ký đang chờ/);
    expect(JSON.stringify(await dongGoc(id))).toBe(truoc);
  });

  it("[DNC-DB-04] ĐỐI CHỨNG DƯƠNG: đã tạm dừng + hoá đơn đã CHỐT (không còn gọi nhà cung cấp) ⇒ đổi được; dòng sang VIN, mật khẩu MISA CŨ ĐÃ BỊ XOÁ, ghi nhật ký «đổi»", async () => {
    const id = await dungDongMisa();
    expect((await pause()).ok).toBe(true);
    await dungHoaDon("DA_XAC_NHAN");
    const r = await luu(duVin(), { matKhauMoi: null, du: duVin({ dangBat: false }) }); // không nhập mật khẩu mới, để kiểm mật khẩu cũ bị xoá chứ không bị mang sang
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const sau = await dongGoc(id);
    expect(sau).toMatchObject({ nhaCungCapMa: "VIN_HOADON", misaAppId: null, misaLoaiHoaDon: null, matKhauMaHoa: null, matKhauCapNhatLuc: null, dangBat: false });
    expect(JSON.stringify(sau)).not.toContain(CIPHER_MISA_CU);
    expect(await docNhaCungCapDaChon(PN, ENV)).toBe("VIN_HOADON");
    const vet = await db.auditLog.findFirstOrThrow({ where: { entityType: "HoaDonKetNoiNhaCungCap", entityId: id, action: "DOI_NHA_CUNG_CAP" } });
    expect(JSON.stringify(vet.newValues)).toContain("MISA_MEINVOICE");
    expect(JSON.stringify(vet.newValues)).toContain("taiKhoanCuDaXoa");
    expect(JSON.stringify(vet)).not.toContain(CIPHER_MISA_CU);
  });

  it("[DNC-DB-05] đổi sang VIN mà BẬT kết nối thì phải khai ĐỦ tài khoản VIN mới (mật khẩu cũ không tính) — thiếu ⇒ từ chối trước mọi phép ghi", async () => {
    const id = await dungDongMisa();
    expect((await pause()).ok).toBe(true);
    const truoc = JSON.stringify(await dongGoc(id));
    const r = await luu(duVin({ dangBat: true }), { matKhauMoi: null });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/mật khẩu/i);
    expect(JSON.stringify(await dongGoc(id))).toBe(truoc);
  });

  it("[DNC-DB-06] chỉ QUẢN TRỊ TỐI CAO đổi được: kế toán Hội sở bị từ chối dù đã tạm dừng + sạch", async () => {
    const id = await dungDongMisa();
    expect((await pause()).ok).toBe(true);
    const truoc = JSON.stringify(await dongGoc(id));
    const r = await luu(duVin(), { actor: KT_HO });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(await dongGoc(id))).toBe(truoc);
  });

  it("[DNC-DB-07] pháp nhân CHƯA có dòng nào (prod hôm nay) vẫn đổi được lần đầu: dòng tạo MỚI mang VIN; trước đó mặc định trong mã là MISA", async () => {
    expect(await docNhaCungCapDaChon(PN, ENV)).toBeNull(); // chưa có dòng ⇒ không ghi đè gì
    expect((await pause()).ok).toBe(true);
    const r = await luu();
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(await docNhaCungCapDaChon(PN, ENV)).toBe("VIN_HOADON");
  });

  it("[DNC-DB-08] KHÔNG đổi nhà cung cấp (sửa tài khoản MISA như cũ) ⇒ KHÔNG cần tạm dừng, không đụng cổng đổi", async () => {
    await dungDongMisa();
    const r = await luu(duVin({ nhaCungCapMa: "MISA_MEINVOICE", baseUrl: "https://testapi.meinvoice.vn/api/v3", tenDangNhap: "ketoan-misa", misaAppId: "app-cu", misaLoaiHoaDon: "co-ma" }), {
      matKhauMoi: "mat-khau-misa-moi",
      lyDo: "Đổi mật khẩu MISA định kỳ theo quy định",
    });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(await db.auditLog.count({ where: { entityType: "HoaDonKetNoiNhaCungCap", action: "DOI_NHA_CUNG_CAP" } })).toBe(0);
  });

  it("[DNC-DB-09] sau khi đổi, CỔNG theo pháp nhân trả đúng nhà cung cấp mới (và hỏi lại nhà cung cấp CŨ là không còn); trước đó là MISA", async () => {
    // Trước: dòng MISA chỉ ghi phương thức ký, cổng env không có ⇒ không dùng được nhưng nhà cung cấp hiệu lực vẫn là MISA.
    const truoc = await layCongHsmChoPhapNhan(PN, "TRA_CUU", { env: ENV });
    expect(truoc.ok ? truoc.nhaCungCap : null).not.toBe("VIN_HOADON");
    expect((await pause()).ok).toBe(true);
    expect((await luu()).ok).toBe(true);
    expect((await batLaiKy({ actor: QT, nguoi: NGUOI, phapNhanMa: PN, lyDo: "Đã đổi sang VIN, bật lại ký", xacNhanSuCo: false })).ok).toBe(true);
    const sau = await layCongHsmChoPhapNhan(PN, "GUI", { env: ENV });
    expect(sau, JSON.stringify(sau)).toMatchObject({ ok: true, nhaCungCap: "VIN_HOADON", nguon: "BANG" });
  });
});

describe("[DNC-W] dây nối — thứ tự khoá và dùng chung một hàm (thuần, đọc mã nguồn đã bỏ chú thích)", () => {
  const luuSrc = bo(doc("lib/finance/hoa-don/ket-noi/ket-noi-db.ts"));
  const phSrc = bo(doc("lib/finance/hoa-don/phat-hanh-misa.ts"));

  it("[DNC-W1] đổi nhà cung cấp: khoá ĐỘC QUYỀN trước, rồi mới đọc lại + kiểm tạm dừng + đếm hoá đơn/lệnh; mọi cổng đứng TRƯỚC `update`/`create` của dòng", () => {
    const k = luuSrc.indexOf("khoaNhaCungCapDocQuyen(tx, du.phapNhanMa)");
    const docLai = luuSrc.indexOf("tx.hoaDonKetNoiNhaCungCap.findUnique", k);
    const tamDung = luuSrc.indexOf("tx.hoaDonKyChinhSach.findUnique", k);
    const dem = luuSrc.indexOf("tx.hoaDonDienTu.count", k);
    const ghi = luuSrc.indexOf("tx.hoaDonKetNoiNhaCungCap.update(", k);
    expect(k).toBeGreaterThan(0);
    expect([docLai, tamDung, dem, ghi].every((v) => v > k)).toBe(true);
    expect(docLai).toBeLessThan(tamDung);
    expect(tamDung).toBeLessThan(dem);
    expect(dem).toBeLessThan(ghi);
    expect((luuSrc.match(/khoaNhaCungCapDocQuyen\(tx, /g) ?? []).length).toBe(1);
  });

  it("[DNC-W2] `batDauPhatHanh` VÀ `phatHanhLai` cùng đi qua MỘT hàm (khoá dùng chung → đọc lại → so với cổng); hàm đó khoá TRƯỚC khi đọc", () => {
    expect((phSrc.match(/await pnVoiNhaCungCapHienTai\(tx, /g) ?? []).length).toBe(2);
    const i = phSrc.indexOf("async function pnVoiNhaCungCapHienTai");
    const thanHam = phSrc.slice(i, phSrc.indexOf("\n}\n", i));
    expect(thanHam.indexOf("khoaNhaCungCapDungChung(tx")).toBeGreaterThan(0);
    expect(thanHam.indexOf("khoaNhaCungCapDungChung(tx")).toBeLessThan(thanHam.indexOf("docNhaCungCapDaChon("));
    expect(thanHam).toMatch(/throw new LoiPhatHanh\("NHA_CUNG_CAP_DA_DOI"\)/);
  });

  it("[DNC-W3] ĐỐI CHỨNG ÂM: `banChup` không còn tự suy nhà cung cấp từ `phanMem` của bản chưa qua hàm trên (`pnPhatHanh` luôn là bản đã hiệu lực)", () => {
    expect(phSrc).not.toMatch(/phapNhan:\s*pnGoc\.phapNhan/);
    expect((phSrc.match(/phapNhanPhatHanhTrongTx\(tx, [^)]*\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    for (const m of phSrc.matchAll(/const pnPhatHanh = ([^\n]+)/g)) expect(m[1]).toContain("pnVoiNhaCungCapHienTai(");
  });
});
