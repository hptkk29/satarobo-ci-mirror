// Ca [CHD-*] — CẤU HÌNH HOÁ ĐƠN THEO CƠ SỞ trên Postgres THẬT (PR2, docs/ke-toan-hoa-don/NANG-CAP-2026-10.md).
//
// Luật thuần đã có test ở `lib/finance/hoa-don/cau-hinh-co-so.test.ts`. Thứ CHỈ đo được trên DB thật:
//   · khoá tư vấn theo cơ sở: hai kế toán thêm dòng chồng ngày CÙNG LÚC ⇒ đúng một dòng sống;
//   · truy vấn "đã có hoá đơn trong khoảng" của `luuCauHinh` đếm đúng (khoá sửa);
//   · AuditLog ghi cùng transaction (lịch sử); đọc qua `scopedDb` đúng phạm vi cơ sở.
// Bộ này KHÔNG gọi `resetDb()`: dùng tiền tố cố định + dọn đúng dòng của mình.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docCauHinhCoSo, docCauHinhDangBat, docLichSuCauHinh, luuCauHinh } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";

if (!RUN_DB_TESTS) console.warn(`[CHD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-chd-";
const CS_A = `${T}cs-a`;
const CS_B = `${T}cs-b`;
const DON = `${T}don`;
const NGUOI = { id: `${T}ke-toan`, name: "Kế toán fixture" };

const kt = (centerScope: string[]) =>
  ({
    userId: NGUOI.id,
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
  }) as unknown as Actor;

const du = (o: Partial<Parameters<typeof luuCauHinh>[0]["du"]> = {}) => ({
  centerId: CS_A,
  phapNhanMa: "SATA_ROBO",
  kyHieu: "1C26MAI",
  hieuLucTu: "2026-01-01",
  hieuLucDen: "2026-12-31",
  dangBat: true,
  ...o,
});
const luu = (d = du(), extra: Partial<Parameters<typeof luuCauHinh>[0]> = {}) =>
  luuCauHinh({ nguoi: NGUOI, du: d, ghiChu: null, lyDo: null, ...extra });

async function don() {
  const ids = (await db.cauHinhHoaDonCoSo.findMany({ where: { centerId: { in: [CS_A, CS_B] } }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { entityType: "CauHinhHoaDonCoSo", entityId: { in: ids } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: { in: [CS_A, CS_B] } } });
  await db.center.deleteMany({ where: { id: { in: [CS_A, CS_B] } } });
}

describe.skipIf(!RUN_DB_TESTS)("[CHD] cấu hình hoá đơn theo cơ sở — Postgres thật", () => {
  beforeEach(async () => {
    await don();
    await db.center.create({ data: { id: CS_A, code: `${T}A`, name: "Cơ sở A", slug: `${T}a`, address: "a" } });
    await db.center.create({ data: { id: CS_B, code: `${T}B`, name: "Cơ sở B", slug: `${T}b`, address: "b" } });
  });
  afterAll(don);

  it("[CHD-01] tạo hợp lệ ⇒ có dòng + AuditLog (TAO_CAU_HINH_HOA_DON) cùng transaction; ký hiệu chuẩn hoá in hoa", async () => {
    const r = await luu(du({ kyHieu: " 1c26mai " }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hang = await db.cauHinhHoaDonCoSo.findUniqueOrThrow({ where: { id: r.id } });
    expect(hang).toMatchObject({ centerId: CS_A, kyHieu: "1C26MAI", phapNhanMa: "SATA_ROBO", dangBat: true, taoBoiId: NGUOI.id });
    expect(hang.hieuLucTu.toISOString().slice(0, 10)).toBe("2026-01-01");
    const ls = await docLichSuCauHinh([r.id]);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ hanhDong: "TAO_CAU_HINH_HOA_DON", nguoiSua: NGUOI.name, cauHinhId: r.id });
  });

  it("[CHD-02] dòng thứ hai bật chồng ngày cùng cơ sở ⇒ TỪ CHỐI, không thêm dòng", async () => {
    expect((await luu()).ok).toBe(true);
    const r = await luu(du({ kyHieu: "1C26XYZ", hieuLucTu: "2026-06-01" }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Trùng khoảng ngày/) });
    expect(await db.cauHinhHoaDonCoSo.count({ where: { centerId: CS_A } })).toBe(1);
  });

  it("[CHD-03] HAI kế toán thêm dòng chồng ngày CÙNG LÚC ⇒ đúng một dòng bật, một bên bị từ chối", async () => {
    const [a, b] = await Promise.all([luu(du({ kyHieu: "1C26MAI" })), luu(du({ kyHieu: "1C26XYZ" }))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.cauHinhHoaDonCoSo.count({ where: { centerId: CS_A, dangBat: true } })).toBe(1);
    const bi = a.ok ? b : a;
    expect(bi.ok).toBe(false);
    expect(!bi.ok && bi.error).toMatch(/Trùng khoảng ngày/);
  });

  it("[CHD-04] hai cơ sở CÙNG (pháp nhân, ký hiệu) = dãy dùng chung ⇒ cả hai được khai (không có khoá duy nhất xuyên cơ sở)", async () => {
    expect((await luu(du({ centerId: CS_A }))).ok).toBe(true);
    expect((await luu(du({ centerId: CS_B }))).ok).toBe(true);
    expect(await db.cauHinhHoaDonCoSo.count({ where: { kyHieu: "1C26MAI", centerId: { in: [CS_A, CS_B] } } })).toBe(2);
  });

  it("[CHD-05] ĐỔI NĂM: dòng năm sau thêm được cạnh dòng năm trước; cùng năm khác ký hiệu giữa năm cần rút ngắn dòng cũ trước", async () => {
    expect((await luu()).ok).toBe(true);
    expect((await luu(du({ kyHieu: "1C27MAI", hieuLucTu: "2027-01-01", hieuLucDen: "2027-12-31" }))).ok).toBe(true);
    const cu = await db.cauHinhHoaDonCoSo.findFirstOrThrow({ where: { centerId: CS_A, kyHieu: "1C26MAI" } });
    const rut = await luu(du({ hieuLucDen: "2026-10-31" }), { id: cu.id, lyDo: "Đổi ký hiệu từ tháng 11" });
    expect(rut.ok).toBe(true);
    expect((await luu(du({ kyHieu: "1C26MAX", hieuLucTu: "2026-11-01", hieuLucDen: "2026-12-31" }))).ok).toBe(true);
  });

  it("[CHD-06] sửa dòng ĐÃ CÓ hoá đơn trong khoảng: đổi ký hiệu/pháp nhân bị chặn, tắt thì được; hoá đơn cũ KHÔNG đổi", async () => {
    const r = await luu();
    if (!r.ok) throw new Error("fixture");
    await db.order.create({
      data: { id: DON, code: "ORD-269926-000777", type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0999000777", totalAmount: 1000, centerId: CS_A },
    });
    await db.hoaDonDienTu.create({
      data: {
        orderId: DON,
        centerId: CS_A,
        trangThai: "DA_XAC_NHAN",
        kyHieu: "1C26MAI",
        soHoaDon: "5",
        ngayPhatHanh: new Date("2026-10-06T00:00:00Z"),
        phapNhanMa: "SATA_ROBO",
        phapNhanMst: "0402301783",
        tongTien: 1000,
        taoBoiId: NGUOI.id,
      },
    });
    const doiKy = await luu(du({ kyHieu: "1C26NEW" }), { id: r.id, lyDo: "Sửa cho đúng thực tế" });
    expect(doiKy).toEqual({ ok: false, error: expect.stringMatching(/không đổi ký hiệu/) });
    const doiPn = await luu(du({ phapNhanMa: "NEW_VISION" }), { id: r.id, lyDo: "Sửa cho đúng thực tế" });
    expect(doiPn).toEqual({ ok: false, error: expect.stringMatching(/không đổi pháp nhân/) });
    const coLai = await luu(du({ hieuLucDen: "2026-09-30" }), { id: r.id, lyDo: "Co khoảng khỏi ngày đã dùng" });
    expect(coLai).toEqual({ ok: false, error: expect.stringMatching(/không được trước 2026-10-06/) });
    const khongLyDo = await luu(du({ dangBat: false }), { id: r.id, lyDo: "ngắn" });
    expect(khongLyDo).toEqual({ ok: false, error: expect.stringMatching(/lý do/) });

    const tat = await luu(du({ dangBat: false }), { id: r.id, lyDo: "Ngừng dùng ký hiệu này" });
    expect(tat.ok).toBe(true);
    const ls = await docLichSuCauHinh([r.id]);
    expect(ls.map((x) => x.hanhDong)).toEqual(["TAT_CAU_HINH_HOA_DON", "TAO_CAU_HINH_HOA_DON"]);
    expect(ls[0]!.lyDo).toBe("Ngừng dùng ký hiệu này");
    // Hoá đơn đã lưu giữ nguyên ký hiệu + pháp nhân chụp lúc tạo.
    const hd = await db.hoaDonDienTu.findFirstOrThrow({ where: { orderId: DON } });
    expect(hd).toMatchObject({ kyHieu: "1C26MAI", phapNhanMa: "SATA_ROBO", phapNhanMst: "0402301783" });
  });

  it("[CHD-07] đọc qua scopedDb: kế toán CS A chỉ thấy cấu hình CS A; kế toán cả hai thấy cả hai; không scope ⇒ rỗng", async () => {
    await luu(du({ centerId: CS_A }));
    await luu(du({ centerId: CS_B, kyHieu: "1C26MNV", phapNhanMa: "NEW_VISION" }));
    const a = await docCauHinhCoSo(kt([CS_A]), [CS_A, CS_B]);
    expect(a.map((x) => x.centerId)).toEqual([CS_A]);
    const ca = await docCauHinhCoSo(kt([CS_A, CS_B]), [CS_A, CS_B]);
    expect(ca.map((x) => x.centerId).sort()).toEqual([CS_A, CS_B]);
    expect(await docCauHinhCoSo(kt([]), [CS_A, CS_B])).toEqual([]);
    // Cấu hình ĐANG BẬT cho hàng chờ: dòng đã tắt không lọt vào.
    const cb = await db.cauHinhHoaDonCoSo.findFirstOrThrow({ where: { centerId: CS_B } });
    await luu(du({ centerId: CS_B, kyHieu: "1C26MNV", phapNhanMa: "NEW_VISION", dangBat: false }), { id: cb.id, lyDo: "Tạm tắt để thử" });
    expect(await docCauHinhDangBat(kt([CS_A, CS_B]), [CS_A, CS_B])).toHaveLength(1);
  });

  it("[CHD-08] sửa dòng của cơ sở khác qua id ⇒ 'Không tìm thấy' (không sửa chéo cơ sở)", async () => {
    const b = await luu(du({ centerId: CS_B }));
    if (!b.ok) throw new Error("fixture");
    const r = await luu(du({ centerId: CS_A, kyHieu: "1C26XYZ" }), { id: b.id, lyDo: "Thử sửa chéo cơ sở" });
    expect(r).toEqual({ ok: false, error: "Không tìm thấy cấu hình" });
    expect((await db.cauHinhHoaDonCoSo.findUniqueOrThrow({ where: { id: b.id } })).kyHieu).toBe("1C26MAI");
  });

  it("[CHD-09] CHECK ở DB: hieuLucDen < hieuLucTu bị DB từ chối dù đi tắt qua Prisma", async () => {
    await expect(
      db.cauHinhHoaDonCoSo.create({
        data: { centerId: CS_A, phapNhanMa: "SATA_ROBO", kyHieu: "1C26MAI", hieuLucTu: new Date("2026-06-01T00:00:00Z"), hieuLucDen: new Date("2026-05-01T00:00:00Z"), taoBoiId: "x", capNhatBoiId: "x" },
      }),
    ).rejects.toThrow();
  });
});
