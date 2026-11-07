// Ca [CSDB-*] — DỊCH VỤ CHÍNH SÁCH HOÁ ĐƠN CÓ PHIÊN BẢN (lát S7, Invoice Hub) TRÊN POSTGRES THẬT.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-chinh-sach-db.test.ts
//        (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET; DB phải là `satarobo_test` / `ci_test`)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH.
//
// Luật thuần đã có test ở `lib/finance/hoa-don/chinh-sach-phien-ban.test.ts` / `chinh-sach-mo-phong.test.ts`. Thứ CHỈ đo được ở DB thật:
// khoá tư vấn theo pháp nhân (hai người duyệt cùng lúc), `updateMany` có điều kiện, cách ly cơ sở của ĐỌC lẫn GHI, AuditLog cùng transaction,
// và `docHieuLuc` đọc lại đúng cho `resolve`. Mọi ca "KHÔNG được" kèm đối chứng dương ("đúng người / đúng lúc thì ĐƯỢC").
// Đồng hồ ĐÓNG BĂNG (luật 19): mọi ngày là hằng tuyệt đối; dịch vụ không đọc đồng hồ.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  docDanhSachChinhSach,
  docHieuLuc,
  docLichSuChinhSach,
  docMoPhongChoBan,
  duyet,
  guiDuyet,
  hetHieuLuc,
  taoNhap,
  tuChoi,
  type KetQuaGhi,
} from "@/lib/finance/hoa-don/chinh-sach-db";
import { resolve } from "@/lib/finance/hoa-don/engine/chinh-sach";

if (!RUN_DB_TESTS) console.warn(`[CSDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-csdb-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const PN = `${T}pn`;
const LY_DO = "Đã soát cùng kế toán trưởng";

/** Kế toán CƠ SỞ: quyền `payments:confirm` chỉ phủ một cơ sở; không phải HO; tầm nhìn cũng chỉ cơ sở đó (+ dòng dùng chung). */
const actorCoSo = (userId: string, centerId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] }],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

/** Kế toán HỘI SỞ: `isSuperAdmin: false` (super admin đi đường bypass, không chứng minh được gì) — ALL đến từ `centerScope: "ALL"`. */
const actorHo = (userId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;

const KT_CS1 = actorCoSo(`${T}kt-cs1`, CS1);
const KT_CS2 = actorCoSo(`${T}kt-cs2`, CS2);
const HO_A = actorHo(`${T}ho-a`);
const HO_B = actorHo(`${T}ho-b`);

const dong = (loaiKhoan: string, phanTram = 8) => ({
  loaiKhoan,
  mucThue: { kieu: "SUAT", phanTram },
  kieuGia: "DA_GOM_THUE",
  donViTinh: "Lần",
  donViTinhBuoi: "Buổi",
  cachThuSoBuoi: "MOT_KHOA_MO_TA_SO_BUOI",
  mauMoTaSoBuoi: "({n} buổi)",
});
const noiDung = (phanTram = 8, loai = ["COURSE", "EXAM"]) => ({
  anhXaThue: loai.map((l) => dong(l, phanTram)),
  thoiDiemLap: "DO_KE_TOAN_CHOT",
  cheDoToiDa: "SHADOW",
  nguoiMua: { buyerInfoLevel: "NGUOI_TIEU_DUNG" },
  lamTron: "HALF_UP",
  legalBasisRef: [{ vanBan: "Văn bản thử nghiệm", doTinCay: "TRUNG", canKeToanXacNhan: false }],
});

type DauTao = { actor?: Actor; centerId: string | null; tu: string; den?: string | null; nd?: unknown; pn?: string };
const tao = (o: DauTao) =>
  taoNhap({
    actor: o.actor ?? HO_A,
    ten: "Kế toán thử",
    phapNhanMa: o.pn ?? PN,
    phapNhanHopLe: [o.pn ?? PN],
    centerId: o.centerId,
    hieuLucTu: o.tu,
    hieuLucDen: o.den ?? null,
    noiDungTho: o.nd ?? noiDung(),
    lyDo: LY_DO,
  });
const gui = (actor: Actor, id: string) => guiDuyet({ actor, ten: "Kế toán thử", id, lyDo: LY_DO });
const idCua = (r: KetQuaGhi): string => {
  if (!r.ok) throw new Error(`Dựng fixture thất bại: ${r.ma} — ${r.error}`);
  return r.id;
};
async function hashCuaBan(actor: Actor, id: string): Promise<string> {
  const mp = await docMoPhongChoBan(actor, id);
  if (!mp || !mp.ok) throw new Error("Không dựng được mô phỏng");
  return mp.hash;
}
const DUYET = async (actor: Actor, id: string, hash?: string | null) =>
  duyet({ actor, ten: "Người duyệt", id, lyDo: LY_DO, hashMoPhongUi: hash === undefined ? await hashCuaBan(actor, id) : hash });

/** NHAP → CHO_DUYET (bởi `nguoiTao`) → HIEU_LUC (bởi `nguoiDuyet`). Trả id. */
async function dungBanHieuLuc(o: DauTao & { nguoiDuyet?: Actor }): Promise<string> {
  const id = idCua(await tao({ ...o, actor: o.actor ?? HO_A }));
  idCua(await gui(o.actor ?? HO_A, id));
  idCua(await DUYET(o.nguoiDuyet ?? HO_B, id));
  return id;
}
const hang = (id: string) => db.hoaDonChinhSach.findUniqueOrThrow({ where: { id } });

async function don() {
  const ids = (await db.hoaDonChinhSach.findMany({ where: { phapNhanMa: { startsWith: T } }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { entityType: "HoaDonChinhSach", entityId: { in: ids } } });
  await db.hoaDonChinhSach.deleteMany({ where: { phapNhanMa: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

describe.skipIf(!RUN_DB_TESTS)("[CSDB] chính sách hoá đơn có phiên bản — Postgres thật", () => {
  beforeEach(async () => {
    await don();
    for (const [id, ten] of [
      [CS1, "CS1 fixture S7"],
      [CS2, "CS2 fixture S7"],
    ] as const) {
      await db.center.create({ data: { id, code: id.toUpperCase(), name: ten, slug: id, address: "địa chỉ" } });
    }
  });
  afterAll(don);

  it("[CSDB-01] vòng đời đầy đủ: nháp → chờ duyệt → hiệu lực → kết thúc; mỗi bước một dòng audit; docHieuLuc + resolve đúng ở hai đầu khoảng", async () => {
    const id = idCua(await tao({ actor: KT_CS1, centerId: CS1, tu: "2026-07-01" }));
    expect(await hang(id)).toMatchObject({ trangThai: "NHAP", phienBan: 1, centerId: CS1, phapNhanMa: PN, nguoiTaoId: KT_CS1.userId, nguoiDuyetId: null });
    expect((await gui(KT_CS1, id)).ok).toBe(true);
    expect((await hang(id)).trangThai).toBe("CHO_DUYET");

    const kq = await DUYET(HO_A, id);
    expect(kq).toMatchObject({ ok: true, trangThai: "HIEU_LUC" });
    expect(await hang(id)).toMatchObject({ trangThai: "HIEU_LUC", nguoiDuyetId: HO_A.userId });

    const quyTac = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-07-01" });
    expect(quyTac.map((q) => q.loaiKhoan).sort()).toEqual(["COURSE", "EXAM"]);
    expect(resolve(quyTac, { phapNhanMa: PN, centerId: CS1, loaiKhoan: "COURSE" }, "2026-07-01")).toMatchObject({ ok: true });

    expect(await hetHieuLuc({ actor: HO_A, ten: "HO", id, ngayKetThuc: "2026-12-31", lyDo: LY_DO })).toMatchObject({ ok: true, trangThai: "HET_HIEU_LUC" });
    const cuoi = await hang(id);
    expect(cuoi.hieuLucDen?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(cuoi.nguoiDuyetId).toBe(HO_A.userId);
    // Ngày CUỐI của khoảng vẫn có chính sách (khoảng đóng); ngày sau đó thì KHÔNG (không dùng mức cũ).
    const ngayCuoi = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-12-31" });
    expect(resolve(ngayCuoi, { phapNhanMa: PN, centerId: CS1, loaiKhoan: "COURSE" }, "2026-12-31")).toMatchObject({ ok: true });
    const sau = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2027-01-01" });
    expect(sau).toEqual([]);
    expect(resolve(sau, { phapNhanMa: PN, centerId: CS1, loaiKhoan: "COURSE" }, "2027-01-01")).toMatchObject({ ok: false, ma: "KHONG_CO" });

    const ls = await docLichSuChinhSach([id]);
    expect(ls.map((x) => x.hanhDong).sort()).toEqual(["DUYET_CHINH_SACH_HOA_DON", "GUI_DUYET_CHINH_SACH_HOA_DON", "KET_THUC_CHINH_SACH_HOA_DON", "TAO_CHINH_SACH_HOA_DON"]);
  });

  it("[CSDB-02] audit ghi cũ→mới + lý do + người thao tác trong CÙNG transaction", async () => {
    const id = await dungBanHieuLuc({ centerId: CS1, tu: "2026-07-01", actor: HO_A, nguoiDuyet: HO_B });
    const ls = await docLichSuChinhSach([id]);
    const d = ls.find((x) => x.hanhDong === "DUYET_CHINH_SACH_HOA_DON")!;
    expect(d.lyDo).toBe(LY_DO);
    expect(d.nguoiSua).toBe("Người duyệt");
    expect(d.truoc).toMatchObject({ trangThai: "CHO_DUYET", nguoiDuyetId: null });
    expect(d.sau).toMatchObject({ trangThai: "HIEU_LUC", nguoiDuyetId: HO_B.userId, nguoiTaoId: HO_A.userId });
    const t = ls.find((x) => x.hanhDong === "TAO_CHINH_SACH_HOA_DON")!;
    expect(t.truoc).toBeNull();
    expect(t.sau).toMatchObject({ trangThai: "NHAP", phienBan: 1 });
    expect((t.sau as { noiDung: { anhXaThue: unknown[] } }).noiDung.anhXaThue).toHaveLength(2);
  });

  it("[CSDB-03] KHÔNG còn maker ≠ checker (chủ dự án chốt 02/11/2026): người tạo TỰ duyệt được, nguoiDuyetId ghi đúng người; người khác duyệt cũng được", async () => {
    const id = idCua(await tao({ actor: HO_A, centerId: CS1, tu: "2026-07-01" }));
    idCua(await gui(HO_A, id));
    expect(await hang(id)).toMatchObject({ trangThai: "CHO_DUYET", nguoiDuyetId: null });
    expect(await DUYET(HO_A, id)).toMatchObject({ ok: true }); // tự duyệt
    expect(await hang(id)).toMatchObject({ trangThai: "HIEU_LUC", nguoiDuyetId: HO_A.userId });
    // đối chứng: đường «người khác duyệt» vẫn chạy, và tự TỪ CHỐI cũng được
    const id2 = idCua(await tao({ actor: HO_A, centerId: CS2, tu: "2026-07-01" }));
    idCua(await gui(HO_A, id2));
    expect(await DUYET(HO_B, id2)).toMatchObject({ ok: true });
    expect((await hang(id2)).nguoiDuyetId).toBe(HO_B.userId);
    const id3 = idCua(await tao({ actor: HO_A, centerId: CS1, tu: "2026-09-01" }));
    idCua(await gui(HO_A, id3));
    expect(await tuChoi({ actor: HO_A, ten: "A", id: id3, lyDo: LY_DO })).toMatchObject({ ok: true });
    expect(await hang(id3)).toMatchObject({ trangThai: "TU_CHOI", nguoiDuyetId: HO_A.userId });
  });

  it("[CSDB-04] thiếu mô phỏng / băm sai / băm của bản KHÁC ⇒ từ chối, không ghi; băm đúng ⇒ ĐƯỢC", async () => {
    const a = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    const b = idCua(await tao({ centerId: CS2, tu: "2026-07-01" })); // CÙNG nội dung, KHÁC cơ sở
    idCua(await gui(HO_A, a));
    idCua(await gui(HO_A, b));
    expect(await DUYET(HO_B, a, null)).toMatchObject({ ok: false, ma: "CHUA_MO_PHONG" });
    expect(await DUYET(HO_B, a, "")).toMatchObject({ ok: false, ma: "CHUA_MO_PHONG" });
    expect(await DUYET(HO_B, a, "0".repeat(64))).toMatchObject({ ok: false, ma: "MO_PHONG_LECH" });
    // Băm của bản b (nội dung y hệt, phạm vi khác) KHÔNG dùng được cho bản a.
    const hashB = await hashCuaBan(HO_B, b);
    expect(await DUYET(HO_B, a, hashB)).toMatchObject({ ok: false, ma: "MO_PHONG_LECH" });
    expect((await hang(a)).trangThai).toBe("CHO_DUYET");
    expect(await DUYET(HO_B, a)).toMatchObject({ ok: true });
  });

  it("[CSDB-05] chính sách đang hiệu lực làm mốc 'trước' đổi sau khi người duyệt xem ⇒ băm cũ bị từ chối; xem lại ⇒ ĐƯỢC", async () => {
    const rieng = idCua(await tao({ centerId: CS1, tu: "2026-07-01", nd: noiDung(10) }));
    idCua(await gui(HO_A, rieng));
    const hashCu = await hashCuaBan(HO_B, rieng); // lúc này chưa có chính sách nào làm mốc
    await dungBanHieuLuc({ centerId: null, tu: "2026-01-01", actor: HO_A, nguoiDuyet: HO_B }); // bản DÙNG CHUNG hiệu lực từ trước
    expect(await DUYET(HO_B, rieng, hashCu)).toMatchObject({ ok: false, ma: "MO_PHONG_LECH" });
    expect(await DUYET(HO_B, rieng)).toMatchObject({ ok: true });
  });

  it("[CSDB-06] chồng / hở hiệu lực CÙNG phạm vi bị từ chối (khoảng ĐÓNG); liền nhau đúng một ngày thì ĐƯỢC", async () => {
    await dungBanHieuLuc({ centerId: CS1, tu: "2026-01-01", den: "2026-06-30" });
    const chong = idCua(await tao({ centerId: CS1, tu: "2026-06-30" }));
    idCua(await gui(HO_A, chong));
    expect(await DUYET(HO_B, chong)).toMatchObject({ ok: false, ma: "CHONG_HO" });
    const ho = idCua(await tao({ centerId: CS1, tu: "2026-07-02" }));
    idCua(await gui(HO_A, ho));
    expect(await DUYET(HO_B, ho)).toMatchObject({ ok: false, ma: "CHONG_HO", error: expect.stringMatching(/Hở ngày/) });
    const lien = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    idCua(await gui(HO_A, lien));
    expect(await DUYET(HO_B, lien)).toMatchObject({ ok: true });
    expect((await hang(chong)).trangThai).toBe("CHO_DUYET");
    expect((await hang(ho)).trangThai).toBe("CHO_DUYET");
  });

  it("[CSDB-07] bản cũ còn MỞ ⇒ bản mới chồng; kết thúc bản cũ vào ngày liền trước rồi duyệt bản mới ⇒ ĐƯỢC; hai phiên bản resolve đúng ngày chuyển", async () => {
    const v1 = await dungBanHieuLuc({ centerId: CS1, tu: "2026-01-01" });
    const v2 = idCua(await tao({ centerId: CS1, tu: "2026-07-01", nd: noiDung(10) }));
    idCua(await gui(HO_A, v2));
    expect(await DUYET(HO_B, v2)).toMatchObject({ ok: false, ma: "CHONG_HO" });
    expect((await hetHieuLuc({ actor: HO_A, ten: "HO", id: v1, ngayKetThuc: "2026-06-30", lyDo: LY_DO })).ok).toBe(true);
    expect(await DUYET(HO_B, v2)).toMatchObject({ ok: true });
    const q = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-07-01" });
    const khoa = { phapNhanMa: PN, centerId: CS1, loaiKhoan: "COURSE" };
    const truoc = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-06-30" });
    expect(resolve(truoc, khoa, "2026-06-30")).toMatchObject({ ok: true, quyTac: { phienBan: 1 } });
    expect(resolve(q, khoa, "2026-07-01")).toMatchObject({ ok: true, quyTac: { phienBan: 2, thongSo: { mucThue: { kieu: "SUAT", phanTram: 10 } } } });
  });

  it("[CSDB-08] HAI người duyệt CÙNG LÚC ⇒ đúng một thành công; một dòng audit duyệt; nguoiDuyetId là người thắng", async () => {
    const id = idCua(await tao({ actor: KT_CS1, centerId: CS1, tu: "2026-07-01" }));
    idCua(await gui(KT_CS1, id));
    const hash = await hashCuaBan(HO_A, id);
    const [a, b] = await Promise.all([DUYET(HO_A, id, hash), DUYET(HO_B, id, hash)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const thua = a.ok ? b : a;
    expect(thua.ok).toBe(false);
    const h = await hang(id);
    expect(h.trangThai).toBe("HIEU_LUC");
    expect([HO_A.userId, HO_B.userId]).toContain(h.nguoiDuyetId);
    const ls = await docLichSuChinhSach([id]);
    expect(ls.filter((x) => x.hanhDong === "DUYET_CHINH_SACH_HOA_DON")).toHaveLength(1);
  });

  it("[CSDB-09] hai người TẠO NHÁP cùng lúc cùng phạm vi ⇒ hai phiên bản KHÁC nhau (1 và 2), không đụng khoá duy nhất", async () => {
    const [a, b] = await Promise.all([tao({ actor: HO_A, centerId: CS1, tu: "2026-07-01" }), tao({ actor: HO_B, centerId: CS1, tu: "2026-08-01" })]);
    expect(a.ok && b.ok).toBe(true);
    const vs = (await db.hoaDonChinhSach.findMany({ where: { centerId: CS1, phapNhanMa: PN }, select: { phienBan: true } })).map((x) => x.phienBan).sort();
    expect(vs).toEqual([1, 2]);
  });

  it("[CSDB-10] phiên bản đánh số RIÊNG theo phạm vi: dùng chung v1, CS1 v1, CS2 v1; bản thứ hai của CS1 là v2", async () => {
    const chung = idCua(await tao({ centerId: null, tu: "2026-07-01" }));
    const c1 = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    const c2 = idCua(await tao({ centerId: CS2, tu: "2026-07-01" }));
    const c1b = idCua(await tao({ centerId: CS1, tu: "2027-01-01" }));
    expect((await Promise.all([chung, c1, c2, c1b].map(hang))).map((h) => h.phienBan)).toEqual([1, 1, 1, 2]);
    expect((await hang(chung)).centerId).toBeNull(); // dùng chung = NULL, không phải chuỗi rỗng
    expect((await hang(c1)).centerId).toBe(CS1); // `create` TỰ set centerId
  });

  it("[CSDB-11] CÁCH LY: kế toán CS1 không thấy bản riêng của CS2; thấy bản của mình + dùng chung; CS2 và Hội sở thấy đúng phần của họ (đối chứng dương)", async () => {
    const c1 = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    const c2 = idCua(await tao({ centerId: CS2, tu: "2026-07-01" }));
    const chung = idCua(await tao({ centerId: null, tu: "2026-07-01" }));
    const ids = async (a: Actor, centerId: string) => (await docDanhSachChinhSach(a, { phapNhanMa: PN, centerId })).map((x) => x.id).sort();
    expect(await ids(KT_CS1, CS1)).toEqual([c1, chung].sort());
    // Hỏi thẳng cơ sở CS2 bằng người của CS1: không có dòng CS2 nào, chỉ còn dòng DÙNG CHUNG.
    expect(await ids(KT_CS1, CS2)).toEqual([chung]);
    expect(await ids(KT_CS2, CS2)).toEqual([c2, chung].sort());
    expect(await ids(HO_A, CS2)).toEqual([c2, chung].sort());
    expect(await ids(HO_A, CS1)).toEqual([c1, chung].sort());
    expect(await docMoPhongChoBan(KT_CS1, c2)).toBeNull();
    expect(await docMoPhongChoBan(KT_CS2, c2)).not.toBeNull();
  });

  it("[CSDB-12] CÁCH LY GHI: kế toán CS1 không tạo / không gửi duyệt cho CS2 (nói chung 'Không tìm thấy'), không có dòng nào đổi", async () => {
    const c2 = idCua(await tao({ actor: KT_CS2, centerId: CS2, tu: "2026-07-01" }));
    expect(await tao({ actor: KT_CS1, centerId: CS2, tu: "2026-08-01" })).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await gui(KT_CS1, c2)).toMatchObject({ ok: false, ma: "KHONG_THAY" });
    expect(await db.hoaDonChinhSach.count({ where: { centerId: CS2 } })).toBe(1);
    expect((await hang(c2)).trangThai).toBe("NHAP");
    // đối chứng dương: đúng người của CS2 gửi duyệt được
    expect((await gui(KT_CS2, c2)).ok).toBe(true);
  });

  it("[CSDB-13] kế toán CƠ SỞ không duyệt / từ chối / kết thúc được GÌ — kể cả chính sách của cơ sở mình; Hội sở thì được", async () => {
    const id = idCua(await tao({ actor: HO_A, centerId: CS1, tu: "2026-07-01" }));
    idCua(await gui(HO_A, id));
    const hash = await hashCuaBan(HO_B, id);
    expect(await duyet({ actor: KT_CS1, ten: "x", id, lyDo: LY_DO, hashMoPhongUi: hash })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await tuChoi({ actor: KT_CS1, ten: "x", id, lyDo: LY_DO })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect((await hang(id)).trangThai).toBe("CHO_DUYET");
    expect(await DUYET(HO_B, id)).toMatchObject({ ok: true });
    expect(await hetHieuLuc({ actor: KT_CS1, ten: "x", id, ngayKetThuc: "2026-12-31", lyDo: LY_DO })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect((await hang(id)).trangThai).toBe("HIEU_LUC");
  });

  it("[CSDB-14] chính sách DÙNG CHUNG: kế toán cơ sở KHÔNG tạo / không gửi duyệt (nói rõ vì sao); chỉ Hội sở tạo + duyệt được (đối chứng dương)", async () => {
    expect(await tao({ actor: KT_CS1, centerId: null, tu: "2026-07-01" })).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect(await db.hoaDonChinhSach.count({ where: { phapNhanMa: PN } })).toBe(0);
    const chung = idCua(await tao({ actor: HO_A, centerId: null, tu: "2026-07-01" }));
    expect(await gui(KT_CS1, chung)).toMatchObject({ ok: false, ma: "KHONG_CO_QUYEN" });
    expect((await hang(chung)).trangThai).toBe("NHAP");
    idCua(await gui(HO_A, chung));
    expect(await DUYET(HO_B, chung)).toMatchObject({ ok: true });
    expect((await hang(chung)).centerId).toBeNull();
    // bản dùng chung áp cho mọi cơ sở
    const q = await docHieuLuc({ phapNhanMa: PN, centerId: CS2, ngay: "2026-07-01" });
    expect(resolve(q, { phapNhanMa: PN, centerId: CS2, loaiKhoan: "EXAM" }, "2026-07-01")).toMatchObject({ ok: true });
  });

  it("[CSDB-15] docHieuLuc cho cơ sở CS1 không bao giờ trả bản riêng của CS2 (cách ly ở tầng đọc cho engine)", async () => {
    await dungBanHieuLuc({ centerId: CS2, tu: "2026-01-01", nd: noiDung(10) });
    const q = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-07-01" });
    expect(q).toEqual([]);
    expect(resolve(q, { phapNhanMa: PN, centerId: CS1, loaiKhoan: "COURSE" }, "2026-07-01")).toMatchObject({ ok: false, ma: "KHONG_CO" });
    expect((await docHieuLuc({ phapNhanMa: PN, centerId: CS2, ngay: "2026-07-01" })).length).toBe(2);
  });

  it("[CSDB-16] lý do dưới ngưỡng ⇒ TỪ CHỐI từng thao tác, không ghi gì (số dòng + audit không đổi)", async () => {
    const id = idCua(await tao({ actor: KT_CS1, centerId: CS1, tu: "2026-07-01" }));
    const ngan = "ngắn";
    const soAudit = () => db.auditLog.count({ where: { entityType: "HoaDonChinhSach" } });
    const truoc = await soAudit();
    expect(await taoNhap({ actor: HO_A, ten: "x", phapNhanMa: PN, phapNhanHopLe: [PN], centerId: CS1, hieuLucTu: "2027-01-01", hieuLucDen: null, noiDungTho: noiDung(), lyDo: ngan })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(await guiDuyet({ actor: KT_CS1, ten: "x", id, lyDo: ngan })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(await duyet({ actor: HO_B, ten: "x", id, lyDo: ngan, hashMoPhongUi: "h" })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(await tuChoi({ actor: HO_B, ten: "x", id, lyDo: ngan })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(await hetHieuLuc({ actor: HO_B, ten: "x", id, ngayKetThuc: "2026-12-31", lyDo: ngan })).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    expect(await soAudit()).toBe(truoc);
    expect(await db.hoaDonChinhSach.count({ where: { phapNhanMa: PN } })).toBe(1);
    expect((await guiDuyet({ actor: KT_CS1, ten: "x", id, lyDo: "đủ mười ký tự" })).ok).toBe(true);
  });

  it("[CSDB-17] taoNhap từ chối dữ liệu sai TRƯỚC khi ghi: pháp nhân lạ · nội dung sai · khoảng ngược · cơ sở không có", async () => {
    const dem = () => db.hoaDonChinhSach.count({ where: { phapNhanMa: { startsWith: T } } });
    expect(await taoNhap({ actor: HO_A, ten: "x", phapNhanMa: `${T}la`, phapNhanHopLe: [PN], centerId: CS1, hieuLucTu: "2026-07-01", hieuLucDen: null, noiDungTho: noiDung(), lyDo: LY_DO })).toMatchObject({ ok: false, ma: "PHAP_NHAN_LA" });
    expect(await tao({ centerId: CS1, tu: "2026-07-01", nd: { ...noiDung(), anhXaThue: [] } })).toMatchObject({ ok: false, ma: "NOI_DUNG_SAI" });
    expect(await tao({ centerId: CS1, tu: "2026-07-01", den: "2026-06-01" })).toMatchObject({ ok: false, ma: "KHOANG_SAI" });
    expect(await tao({ centerId: `${T}khong-co`, tu: "2026-07-01" })).toMatchObject({ ok: false, ma: "KHONG_THAY_CO_SO" });
    expect(await dem()).toBe(0);
    expect((await tao({ centerId: CS1, tu: "2026-07-01" })).ok).toBe(true);
  });

  it("[CSDB-18] máy trạng thái ở DB: TU_CHOI / NHAP không duyệt được; bản đang hiệu lực không gửi duyệt lại; kết thúc ngày sai bị từ chối", async () => {
    const a = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    expect(await DUYET(HO_B, a, "h")).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" }); // NHAP → HIEU_LUC
    idCua(await gui(HO_A, a));
    expect((await tuChoi({ actor: HO_B, ten: "B", id: a, lyDo: LY_DO })).ok).toBe(true);
    expect((await hang(a)).trangThai).toBe("TU_CHOI");
    expect(await gui(HO_A, a)).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
    expect(await DUYET(HO_B, a, "h")).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });

    const hl = await dungBanHieuLuc({ centerId: CS2, tu: "2026-07-01", den: "2026-12-31" });
    expect(await gui(HO_A, hl)).toMatchObject({ ok: false, ma: "DA_HIEU_LUC_KHONG_SUA" });
    expect(await hetHieuLuc({ actor: HO_B, ten: "B", id: hl, ngayKetThuc: "2027-01-01", lyDo: LY_DO })).toMatchObject({ ok: false, ma: "NGAY_SAI" });
    expect(await hetHieuLuc({ actor: HO_B, ten: "B", id: hl, ngayKetThuc: "2026-06-30", lyDo: LY_DO })).toMatchObject({ ok: false, ma: "NGAY_SAI" });
    expect((await hang(hl)).trangThai).toBe("HIEU_LUC");
    // kết thúc một bản chưa hiệu lực ⇒ không hợp lệ
    expect(await hetHieuLuc({ actor: HO_B, ten: "B", id: a, ngayKetThuc: "2026-08-01", lyDo: LY_DO })).toMatchObject({ ok: false, ma: "KHONG_HOP_LE" });
  });

  it("[CSDB-19] nội dung KHÔNG bị sửa sau khi hiệu lực: noiDung của bản HIEU_LUC giống hệt lúc duyệt; không có hàm sửa", async () => {
    const id = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    const luc = (await hang(id)).noiDung;
    idCua(await gui(HO_A, id));
    idCua(await DUYET(HO_B, id));
    expect((await hang(id)).noiDung).toEqual(luc);
    idCua(await hetHieuLuc({ actor: HO_B, ten: "B", id, ngayKetThuc: "2026-12-31", lyDo: LY_DO }));
    expect((await hang(id)).noiDung).toEqual(luc);
  });

  it("[CSDB-20] FAIL-CLOSED ở docHieuLuc: không có bản ⇒ rỗng; hai bản chồng (chèn thẳng, vượt app) ⇒ CHONG_HIEU_LUC; nội dung hỏng ⇒ NÉM", async () => {
    expect(await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-07-01" })).toEqual([]);
    expect(await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "không-phải-ngày" })).toEqual([]);
    const goc = { phapNhanMa: PN, centerId: CS1, trangThai: "HIEU_LUC" as const, hieuLucTu: new Date("2026-01-01T00:00:00Z"), nguoiTaoId: `${T}a`, nguoiDuyetId: `${T}b` };
    await db.hoaDonChinhSach.create({ data: { ...goc, phienBan: 1, noiDung: noiDung(8) } });
    await db.hoaDonChinhSach.create({ data: { ...goc, phienBan: 2, noiDung: noiDung(10) } });
    const q = await docHieuLuc({ phapNhanMa: PN, centerId: CS1, ngay: "2026-07-01" });
    expect(q).toHaveLength(4);
    expect(resolve(q, { phapNhanMa: PN, centerId: CS1, loaiKhoan: "COURSE" }, "2026-07-01")).toMatchObject({ ok: false, ma: "CHONG_HIEU_LUC" });
    await db.hoaDonChinhSach.create({ data: { ...goc, centerId: CS2, phienBan: 1, noiDung: { hong: true } } });
    await expect(docHieuLuc({ phapNhanMa: PN, centerId: CS2, ngay: "2026-07-01" })).rejects.toThrow(/nội dung hỏng/);
  });

  it("[CSDB-23] một bản đang hiệu lực HỎNG (sửa tay) không kéo sập màn: `docMoPhongChoBan` trả ok:false có lý do; `duyet` TỪ CHỐI có thông điệp (không ném thô); cơ sở khác vẫn dựng được mô phỏng", async () => {
    const goc = { phapNhanMa: PN, trangThai: "HIEU_LUC" as const, hieuLucTu: new Date("2026-01-01T00:00:00Z"), nguoiTaoId: `${T}a`, nguoiDuyetId: `${T}b` };
    await db.hoaDonChinhSach.create({ data: { ...goc, centerId: CS1, phienBan: 1, noiDung: { hong: true } } });
    const id = idCua(await tao({ centerId: CS1, tu: "2026-07-01" }));
    idCua(await gui(HO_A, id));
    const mp = await docMoPhongChoBan(HO_A, id);
    expect(mp).not.toBeNull();
    expect(mp && mp.ok).toBe(false);
    expect(mp && !mp.ok && mp.loi.join(" ")).toMatch(/Không đọc được chính sách đang hiệu lực/);
    expect(await duyet({ actor: HO_B, ten: "B", id, lyDo: LY_DO, hashMoPhongUi: "h" })).toMatchObject({ ok: false, ma: "HIEN_HANH_HONG" });
    expect((await hang(id)).trangThai).toBe("CHO_DUYET");
    const c2 = idCua(await tao({ centerId: CS2, tu: "2026-07-01" }));
    const mp2 = await docMoPhongChoBan(HO_A, c2);
    expect(mp2 && mp2.ok).toBe(true);
  });

  it("[CSDB-21] LƯỚI THỨ HAI Ở DB: bỏ qua mọi cổng app mà UPDATE thẳng HIEU_LUC KHÔNG ghi người duyệt ⇒ CHECK của DB chặn; có người duyệt (kể cả = người tạo) ⇒ được", async () => {
    const id = idCua(await tao({ actor: HO_A, centerId: CS1, tu: "2026-07-01" }));
    await expect(db.hoaDonChinhSach.update({ where: { id }, data: { trangThai: "HIEU_LUC", nguoiDuyetId: null } })).rejects.toThrow(/HoaDonChinhSach_nguoi_duyet_check/);
    expect((await hang(id)).trangThai).toBe("NHAP");
    // đối chứng dương: luật «khác người tạo» đã thả — người duyệt = người tạo qua được CHECK
    await db.hoaDonChinhSach.update({ where: { id }, data: { trangThai: "HIEU_LUC", nguoiDuyetId: HO_A.userId } });
    expect((await hang(id)).trangThai).toBe("HIEU_LUC");
  });

  it("[CSDB-22] `duyet` ghi người duyệt = NGƯỜI THAO TÁC từ phiên (actor), không nhận 'nguoiDuyetId' từ client", async () => {
    const id = idCua(await tao({ actor: HO_A, centerId: CS1, tu: "2026-07-01" }));
    idCua(await gui(HO_A, id));
    // Cố nhét thêm trường lạ vào lời gọi (cách client giả mạo): bị bỏ qua, người duyệt vẫn là actor thật.
    const kq = await duyet({ actor: HO_B, ten: "B", id, lyDo: LY_DO, hashMoPhongUi: await hashCuaBan(HO_B, id), ...({ nguoiDuyetId: "ai-do-khac" } as object) });
    expect(kq).toMatchObject({ ok: true });
    expect((await hang(id)).nguoiDuyetId).toBe(HO_B.userId);
  });
});
