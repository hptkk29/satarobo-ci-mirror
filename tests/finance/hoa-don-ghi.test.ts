// Ca [HDG-*] — GHI trên bảng hoá đơn (lưu nháp · không xuất · sửa nháp · gỡ) trên Postgres THẬT.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §4. Thứ phải đo ở DB chứ không đo bằng mock được:
//   · hai kế toán cùng bấm MỘT lần thu ⇒ đúng MỘT hoá đơn, bên thua nhận câu người đọc được, và
//     KHÔNG còn dòng hoá đơn mồ côi (transaction rollback thật);
//   · trùng số hoá đơn ⇒ câu riêng, không lẫn với "người khác đã xử lý";
//   · sửa / gỡ có điều kiện `updatedAt` — ghi chồng thì ném, không ghi nửa vời.
//
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  capNhatHoaDonNhap,
  ghiKhongTrung,
  goHoaDonChuaChot,
  huyHoaDonDaXacNhan,
  LoiGhiHoaDon,
  taoHoaDonChoLanThu,
} from "@/lib/finance/hoa-don/ghi-hoa-don";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon } from "@/lib/finance/hoa-don/phap-nhan";
import { bamNguoiMua } from "@/lib/finance/hoa-don/bam-nguoi-mua";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";

if (!RUN_DB_TESTS) console.warn(`[HDG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdg-";
const DON = `${T}don`;
const DON2 = `${T}don2`;
const P1 = `${T}p1`;
const P2 = `${T}p2`;
const P3 = `${T}p3`;
const CS = `${T}center`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const PN = phapNhanChoDon("CS1", CAU_HINH_HOA_DON_MAC_DINH)!;
const KEY = "dot:fx-dot1";

async function don() {
  const orderIds = [DON, DON2];
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await db.auditLog.deleteMany({
    where: { OR: [{ entityType: "Order", entityId: { in: orderIds } }, { entityId: { in: hd.map((h) => h.id) } }] },
  });
  await db.hoaDonKhoan.deleteMany({ where: { hoaDon: { orderId: { in: orderIds } } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
}

async function dungFixture() {
  await don();
  for (const [id, code] of [
    [DON, "ORD-269909-000011"],
    [DON2, "ORD-269909-000012"],
  ] as const) {
    await db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "Phụ huynh fixture",
        customerPhone: "0999000444",
        customerAddress: "12 Lê Lợi",
        customerCity: "Đà Nẵng",
        invoiceEmail: "ph@example.com",
        totalAmount: 6_000_000,
      },
    });
  }
  for (const [id, orderId] of [
    [P1, DON],
    [P2, DON],
    [P3, DON2],
  ] as const) {
    await db.payment.create({
      data: { id, orderId, amount: 3_000_000, method: "BANK_TRANSFER", paidDate: new Date("2699-09-01T03:00:00Z") },
    });
  }
}

// GĐ 8 bước 13 — mỗi tệp một SHA-256 như dữ liệu thật (trước đây mọi tệp chung "a"×64: hình dạng không
// tồn tại ngoài đời, và nay cổng "một tờ một hoá đơn" đọc đúng cột ấy).
const TEP = (ten: string) => ({
  khoa: `hoa-don/CS1/2026/${DON}/${ten}.pdf`,
  ten: `${ten}.pdf`,
  co: 1234,
  sha256: createHash("sha256").update(`fixture:${ten}`).digest("hex"),
});
const SO = (soHoaDon: string | null) => ({
  kyHieu: "1C26TSR",
  soHoaDon,
  ngayPhatHanh: soHoaDon ? new Date("2026-09-12T00:00:00Z") : null,
});

const taoNhap = (o: { orderId?: string; khoan?: string[]; so?: string | null; pdf?: string; tienTha?: number } = {}) =>
  taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: o.orderId ?? DON,
    centerId: CS,
    lanThuKey: KEY,
    khoan: (o.khoan ?? [P1]).map((id) => ({ id, soTien: 3_000_000 })),
    loai: {
      trangThai: "NHAP",
      phapNhan: PN,
      so: SO(o.so === undefined ? "127" : o.so),
      guiEmailKhach: true,
      pdf: TEP(o.pdf ?? "u1"),
      xml: null,
      theoSoDaThu: null,
      tienTha: o.tienTha ?? 0,
    },
  });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiGhiHoaDon ? e.ma : String(e);
  }
}

describe.skipIf(!RUN_DB_TESTS)("[HDG] ghi bảng hoá đơn — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDG-01] lưu nháp: bản chụp pháp nhân + người mua, khoá khoản, tổng = Σ khoản", async () => {
    const { id } = await taoNhap({ khoan: [P1, P2] });
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id }, include: { khoan: true } });
    expect(hd).toMatchObject({
      trangThai: "NHAP",
      centerId: CS,
      tongTien: 6_000_000,
      kyHieu: "1C26TSR",
      soHoaDon: "127",
      phapNhanMst: PN.maSoThue,
      nguoiMuaTen: "Phụ huynh fixture",
      emailNhan: "ph@example.com",
      tepPdfKey: TEP("u1").khoa,
      taoBoiId: KT.id,
    });
    expect(hd.khoan.map((k) => [k.paymentId, k.soTien, k.hieuLuc]).sort()).toEqual([
      [P1, 3_000_000, true],
      [P2, 3_000_000, true],
    ]);
    expect(await db.auditLog.count({ where: { entityId: id, action: "TAO_HOA_DON_NHAP" } })).toBe(1);
  });

  it("[HDG-02] dấu người mua lấy từ LẦN TẢI PHIẾU CHỜ nếu có; không có ⇒ dấu hiện tại", async () => {
    await db.auditLog.create({
      data: {
        actorName: "x",
        module: "finance",
        entityType: "Order",
        entityId: DON,
        action: "TAI_PHIEU_CHO",
        newValues: { lanThuKey: KEY, nguoiMuaHash: "dau-luc-in-cu" },
        changedFields: [],
      },
    });
    const a = await taoNhap();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: a.id } })).nguoiMuaHashLucIn).toBe("dau-luc-in-cu");

    const don2 = await db.order.findUniqueOrThrow({ where: { id: DON2 } });
    const b = await taoNhap({ orderId: DON2, khoan: [P3], so: "128", pdf: "u2" });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b.id } })).nguoiMuaHashLucIn).toBe(
      bamNguoiMua(nguoiMuaChoDon(don2)),
    );
  });

  it("[HDG-03] hai kế toán cùng bấm MỘT lần thu ⇒ đúng một hoá đơn, bên thua DA_CO_NGUOI_XU_LY, không mồ côi", async () => {
    const kq = await Promise.allSettled([taoNhap({ so: null, pdf: "a" }), taoNhap({ so: null, pdf: "b" })]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((k): k is PromiseRejectedResult => k.status === "rejected")!;
    expect(thua.reason).toBeInstanceOf(LoiGhiHoaDon);
    expect((thua.reason as LoiGhiHoaDon).ma).toBe("DA_CO_NGUOI_XU_LY");
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[HDG-04] trùng số hoá đơn (cùng pháp nhân + ký hiệu) ⇒ TRUNG_SO, không tạo gì", async () => {
    await taoNhap({ so: "127" });
    expect(await maLoi(taoNhap({ orderId: DON2, khoan: [P3], so: "127", pdf: "u9" }))).toBe("TRUNG_SO");
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON2 } })).toBe(0);
    expect(await db.hoaDonKhoan.count({ where: { paymentId: P3 } })).toBe(0);
  });

  it("[HDG-05] không xuất: lưu lý do, khoá khoản, nhật ký mang lý do", async () => {
    const { id } = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: KEY,
      khoan: [{ id: P1, soTien: 3_000_000 }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" },
    });
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } });
    expect(hd).toMatchObject({ trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống", tepPdfKey: null, soHoaDon: null });
    expect(await maLoi(taoNhap())).toBe("DA_CO_NGUOI_XU_LY");
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: id } });
    expect(nk).toMatchObject({ action: "DANH_DAU_KHONG_XUAT", reason: "Đã xuất ngoài hệ thống" });
  });

  it("[HDG-06] sửa nháp: đổi PDF trả khoá cũ để dọn; gỡ XML; trùng số ⇒ TRUNG_SO và KHÔNG đổi gì", async () => {
    const { id } = await taoNhap({ so: null });
    const r = await capNhatHoaDonNhap({
      nguoiGhi: KT,
      orderId: DON,
      hoaDonId: id,
      so: SO("200"),
      guiEmailKhach: false,
      pdf: TEP("u2"),
      xml: null,
      theoSoDaThu: null,
      tienTha: 0,
    });
    expect(r.tepCanXoa).toEqual([TEP("u1").khoa]);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({
      soHoaDon: "200",
      tepPdfKey: TEP("u2").khoa,
      guiEmailKhach: false,
    });

    await taoNhap({ orderId: DON2, khoan: [P3], so: "300" });
    expect(await maLoi(capNhatHoaDonNhap({ nguoiGhi: KT, orderId: DON, hoaDonId: id, so: SO("300"), guiEmailKhach: true, theoSoDaThu: null, tienTha: 0 }))).toBe(
      "TRUNG_SO",
    );
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).soHoaDon).toBe("200");
  });

  it("[HDG-07] sửa / gỡ bản KHÔNG phải nháp ⇒ DA_DOI; sai đơn ⇒ DA_DOI (không sửa chéo đơn)", async () => {
    const { id } = await taoNhap();
    expect(await maLoi(capNhatHoaDonNhap({ nguoiGhi: KT, orderId: DON2, hoaDonId: id, so: SO("1"), guiEmailKhach: true, theoSoDaThu: null, tienTha: 0 }))).toBe(
      "DA_DOI",
    );
    await db.hoaDonDienTu.update({ where: { id }, data: { trangThai: "DA_XAC_NHAN" } });
    expect(await maLoi(capNhatHoaDonNhap({ nguoiGhi: KT, orderId: DON, hoaDonId: id, so: SO("1"), guiEmailKhach: true, theoSoDaThu: null, tienTha: 0 }))).toBe(
      "DA_DOI",
    );
    expect(await maLoi(goHoaDonChuaChot({ nguoiGhi: KT, orderId: DON, hoaDonId: id }))).toBe("DA_DOI");
    expect(await db.hoaDonDienTu.count({ where: { id } })).toBe(1);
  });

  it("[HDG-08] gỡ nháp: xoá hoá đơn + nhả khoản về hàng chờ, trả tệp để dọn, nhật ký còn lại", async () => {
    const { id } = await taoNhap();
    const r = await goHoaDonChuaChot({ nguoiGhi: KT, orderId: DON, hoaDonId: id });
    expect(r.tepCanXoa).toEqual([TEP("u1").khoa]);
    expect(await db.hoaDonDienTu.count({ where: { id } })).toBe(0);
    expect(await db.hoaDonKhoan.count({ where: { paymentId: P1 } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: id, action: "GO_HOA_DON_NHAP" } })).toBe(1);
    // Khoản đã nhả ⇒ lưu nháp lại được.
    expect(await maLoi(taoNhap())).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDG-09..12] GĐ 8 — xuất theo số đã thu · không trùng · tiền tha", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const LY_DO_THEO_SO = "Phụ huynh không đóng nốt đợt 1";

  it("[HDG-09] tạo nháp 'theo số đã thu' ⇒ hai cột + nhật ký mang lý do; đối chứng null ⇒ false/null", async () => {
    const { id } = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: KEY,
      khoan: [{ id: P1, soTien: 3_000_000 }],
      loai: {
        trangThai: "NHAP",
        phapNhan: PN,
        so: SO("127"),
        guiEmailKhach: true,
        pdf: TEP("u1"),
        xml: null,
        theoSoDaThu: { lyDo: LY_DO_THEO_SO, thieu: 1_000_000, nhanDot: "Đợt 1/2" },
        tienTha: 0,
      },
    });
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({
      xuatTheoSoDaThu: true,
      xuatTheoSoDaThuLyDo: LY_DO_THEO_SO,
    });
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "TAO_HOA_DON_NHAP" } });
    expect(nk.reason).toBe(LY_DO_THEO_SO);
    expect(nk.newValues).toMatchObject({ xuatTheoSoDaThu: true, thieu: 1_000_000, nhanDot: "Đợt 1/2" });

    const { id: id2 } = await taoNhap({ orderId: DON2, khoan: [P3], so: "300", pdf: "u2" });
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: id2 } })).toMatchObject({
      xuatTheoSoDaThu: false,
      xuatTheoSoDaThuLyDo: null,
    });
  });

  it("[HDG-10] sửa nháp: bật → tắt 'theo số đã thu', nhật ký có giá trị cũ / mới", async () => {
    const { id } = await taoNhap();
    const sua = (theoSoDaThu: { lyDo: string } | null) =>
      capNhatHoaDonNhap({ nguoiGhi: KT, orderId: DON, hoaDonId: id, so: SO("127"), guiEmailKhach: true, theoSoDaThu, tienTha: 0 });
    await sua({ lyDo: LY_DO_THEO_SO });
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ xuatTheoSoDaThu: true, xuatTheoSoDaThuLyDo: LY_DO_THEO_SO });
    await sua(null);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ xuatTheoSoDaThu: false, xuatTheoSoDaThuLyDo: null });
    const nk = await db.auditLog.findMany({ where: { entityId: id, action: "SUA_HOA_DON_NHAP" }, orderBy: { createdAt: "asc" } });
    expect(nk.map((x) => [(x.oldValues as { xuatTheoSoDaThu: boolean }).xuatTheoSoDaThu, (x.newValues as { xuatTheoSoDaThu: boolean }).xuatTheoSoDaThu])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it("[HDG-11] ghi 'không trùng': đúng phiên bản ⇒ ba cột + nhật ký; cũ / đã ghi / đã xác nhận / sai đơn ⇒ DA_DOI, không ghi gì", async () => {
    const { id } = await taoNhap();
    const pb = (await db.hoaDonDienTu.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt;
    const ghi = (o: Partial<Parameters<typeof ghiKhongTrung>[0]> = {}) =>
      ghiKhongTrung({
        nguoiGhi: KT,
        orderId: DON,
        hoaDonId: id,
        phienBan: pb,
        lyDo: "Đối chiếu sao kê: khai tay là tiền mặt đợt 1",
        nhatKy: { lanThuKey: KEY, khoanIds: [P1], soTien: 3_000_000, bangChung: "cùng đơn có khoản chuyển khoản" },
        now: new Date("2699-09-26T09:00:00Z"),
        ...o,
      });
    // Phiên bản CŨ (người khác vừa sửa) ⇒ từ chối, không cột nào đổi.
    expect(await maLoi(ghi({ phienBan: new Date(pb.getTime() - 1000) }))).toBe("DA_DOI");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).khongTrungLyDo).toBeNull();
    expect(await maLoi(ghi({ orderId: DON2 }))).toBe("DA_DOI");
    expect(await maLoi(ghi({ lyDo: "ngắn" }))).toBe("THIEU_LY_DO");

    await ghi();
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({
      khongTrungLyDo: "Đối chiếu sao kê: khai tay là tiền mặt đợt 1",
      khongTrungBoiId: KT.id,
      khongTrungLuc: new Date("2699-09-26T09:00:00Z"),
    });
    const nk = await db.auditLog.findMany({ where: { entityId: id, action: "XAC_NHAN_KHONG_TRUNG" } });
    expect(nk).toHaveLength(1);
    expect(nk[0]!.newValues).toMatchObject({ bangChung: "cùng đơn có khoản chuyển khoản", khoanIds: [P1] });

    // Ghi lần hai (bấm đôi) ⇒ từ chối; bản đã xác nhận ⇒ từ chối.
    const pb2 = (await db.hoaDonDienTu.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt;
    expect(await maLoi(ghi({ phienBan: pb2 }))).toBe("DA_DOI");
    await db.hoaDonDienTu.update({ where: { id }, data: { trangThai: "DA_XAC_NHAN" } });
    const pb3 = (await db.hoaDonDienTu.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } })).updatedAt;
    expect(await maLoi(ghi({ phienBan: pb3 }))).toBe("DA_DOI");
    expect(await db.auditLog.count({ where: { entityId: id, action: "XAC_NHAN_KHONG_TRUNG" } })).toBe(1);
  });

  it("[HDG-12] tiền tha làm tròn (Q-mở 4 — hiện RIÊNG): lưu nháp ghi cột, sửa nháp ghi số mới, tổng KHÔNG cộng phần tha; không xuất ⇒ 0", async () => {
    const { id } = await taoNhap({ tienTha: 3_000 });
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ tienThaLamTron: 3_000, tongTien: 3_000_000 });
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "TAO_HOA_DON_NHAP" } });
    expect(nk.newValues).toMatchObject({ tienThaLamTron: 3_000 });

    await capNhatHoaDonNhap({ nguoiGhi: KT, orderId: DON, hoaDonId: id, so: SO("127"), guiEmailKhach: true, theoSoDaThu: null, tienTha: 5_000 });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).tienThaLamTron).toBe(5_000);

    const kx = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON2,
      centerId: CS,
      lanThuKey: KEY,
      khoan: [{ id: P3, soTien: 3_000_000 }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" },
    });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: kx.id } })).tienThaLamTron).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[SHA-01..07] GĐ 8 — một tờ hoá đơn (một tệp PDF) chỉ gắn cho MỘT hoá đơn còn sống", () => {
  beforeEach(dungFixture);
  afterAll(don);
  const loiTep = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return e instanceof LoiGhiHoaDon ? { ma: e.ma, orderId: e.chiTiet?.orderId ?? null } : { ma: String(e), orderId: null };
    }
  };
  const nkTao = (orderId: string) =>
    db.auditLog.count({ where: { action: "TAO_HOA_DON_NHAP", newValues: { path: ["orderId"], equals: orderId } } });

  it("[SHA-01] tờ đã gắn cho đơn A ⇒ đơn B bị chặn TEP_TRUNG, KHÔNG ghi gì cho B; đối chứng tệp khác ⇒ qua", async () => {
    await taoNhap({ pdf: "S" });
    // Đếm CHÊNH LỆCH: vết của hoá đơn đã gỡ ở ca trước không dọn được theo id (hoá đơn không còn).
    const nkTruoc = await nkTao(DON2);
    expect(await loiTep(taoNhap({ orderId: DON2, khoan: [P3], so: "128", pdf: "S" }))).toEqual({ ma: "TEP_TRUNG", orderId: DON });
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON2 } })).toBe(0);
    expect(await db.hoaDonKhoan.count({ where: { paymentId: P3 } })).toBe(0);
    expect(await nkTao(DON2)).toBe(nkTruoc);
    expect(await loiTep(taoNhap({ orderId: DON2, khoan: [P3], so: "128", pdf: "S2" }))).toBeNull();
  });

  it("[SHA-02] CÙNG đơn, lần thu KHÁC ⇒ vẫn chặn", async () => {
    await taoNhap({ khoan: [P1], pdf: "S" });
    expect(await loiTep(taoNhap({ khoan: [P2], so: "128", pdf: "S" }))).toEqual({ ma: "TEP_TRUNG", orderId: DON });
  });

  it("[SHA-03] bản giữ tờ đã HUỶ (qua đường huỷ thật) hoặc bản nháp đã GỠ ⇒ tải lại đúng tờ ấy được", async () => {
    const { id } = await taoNhap({ khoan: [P1], pdf: "S" });
    await db.hoaDonDienTu.update({ where: { id }, data: { trangThai: "DA_XAC_NHAN" } });
    await huyHoaDonDaXacNhan({ nguoiHuy: KT, orderId: DON, hoaDonId: id, lyDo: "Tải nhầm số hoá đơn", now: new Date("2699-09-20T03:00:00Z") });
    expect(await loiTep(taoNhap({ khoan: [P1], so: "129", pdf: "S" }))).toBeNull();

    const b = await taoNhap({ orderId: DON2, khoan: [P3], so: "130", pdf: "G" });
    await goHoaDonChuaChot({ nguoiGhi: KT, orderId: DON2, hoaDonId: b.id });
    expect(await loiTep(taoNhap({ khoan: [P2], so: "131", pdf: "G" }))).toBeNull();
  });

  it("[SHA-04] bản giữ tờ ĐÃ XÁC NHẬN ⇒ chặn", async () => {
    const { id } = await taoNhap({ pdf: "S" });
    await db.hoaDonDienTu.update({ where: { id }, data: { trangThai: "DA_XAC_NHAN" } });
    expect(await loiTep(taoNhap({ orderId: DON2, khoan: [P3], so: "128", pdf: "S" }))).toEqual({ ma: "TEP_TRUNG", orderId: DON });
  });

  it("[SHA-05] SỬA nháp sang tờ của đơn khác ⇒ chặn, không đổi gì; tải lại CHÍNH tờ của mình ⇒ qua", async () => {
    const a = await taoNhap({ pdf: "S" });
    const b = await taoNhap({ orderId: DON2, khoan: [P3], so: "300", pdf: "T" });
    const truoc = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b.id } });
    const sua = (hoaDonId: string, orderId: string, pdf: string, so: string) =>
      capNhatHoaDonNhap({ nguoiGhi: KT, orderId, hoaDonId, so: SO(so), guiEmailKhach: true, pdf: TEP(pdf), theoSoDaThu: null, tienTha: 0 });
    expect(await loiTep(sua(b.id, DON2, "S", "300"))).toEqual({ ma: "TEP_TRUNG", orderId: DON });
    const sau = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b.id } });
    expect(sau.updatedAt).toEqual(truoc.updatedAt);
    expect(sau.tepPdfKey).toBe(truoc.tepPdfKey);
    expect(await loiTep(sua(a.id, DON, "S", "127"))).toBeNull();
  });

  it("[SHA-06] hai đơn lưu CÙNG một tờ đồng thời ⇒ đúng MỘT qua (khoá vân tay xếp hàng)", async () => {
    const kq = await Promise.allSettled([
      taoNhap({ pdf: "S" }),
      taoNhap({ orderId: DON2, khoan: [P3], so: "128", pdf: "S" }),
    ]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((k): k is PromiseRejectedResult => k.status === "rejected")!;
    expect((thua.reason as LoiGhiHoaDon).ma).toBe("TEP_TRUNG");
  });

  it("[SHA-07] hai kế toán tải CÙNG tờ cho CÙNG lần thu ⇒ bên thua 'người khác vừa xử lý', không phải 'lần thu khác'", async () => {
    const kq = await Promise.allSettled([taoNhap({ so: null, pdf: "S" }), taoNhap({ so: null, pdf: "S" })]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((k): k is PromiseRejectedResult => k.status === "rejected")!;
    expect((thua.reason as LoiGhiHoaDon).ma).toBe("DA_CO_NGUOI_XU_LY");
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON } })).toBe(1);
  });
});
