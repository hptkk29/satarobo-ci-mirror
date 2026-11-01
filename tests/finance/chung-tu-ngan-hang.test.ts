// Ca [CTD-*] — CHỨNG TỪ NGÂN HÀNG CỦA KHOẢN THU trên Postgres THẬT (P7-E, 06/11/2026).
//
// Luật trạng thái đã có test thuần ở `lib/finance/hoa-don/chung-tu-ngan-hang.test.ts`. Thứ CHỈ đo được trên DB thật:
//   · khoá duy nhất `paymentId` chặn hai kế toán đánh dấu cùng một khoản; cập nhật CÓ ĐIỀU KIỆN trạng thái chặn hai kế toán bấm cùng lúc;
//   · phạm vi cơ sở của GHI (scopedDb không che write): kế toán cơ sở B không đánh dấu / tải / kiểm tra được hồ sơ của cơ sở A;
//   · AuditLog ghi CÙNG transaction — audit hỏng thì phép ghi lùi theo (rollback);
//   · TẢI CHỨNG TỪ KHÔNG BAO GIỜ ĐỔI `Payment` (số tiền, trạng thái kế toán, `evidenceUrl`, ngày xác nhận) và không sinh Receipt / hoá đơn;
//   · CHECK của SQL: trạng thái «đã có tệp» bắt buộc có khoá tệp.
// Bộ này KHÔNG gọi `resetDb()`: dùng tiền tố cố định + dọn đúng dòng của mình.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  LoiChungTu,
  danhDauCanChungTu,
  danhDauDaKiemTra,
  docDanhSachChungTu,
  ghiTepChungTu,
  huyDanhDau,
  timKhoanTheoMaDon,
  yeuCauBoSungLai,
  type TepDaXacMinh,
} from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";

if (!RUN_DB_TESTS) console.warn(`[CTD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ctd-";
const CS_A = `${T}cs-a`;
const CS_B = `${T}cs-b`;
const DON_A = `${T}don-a`;
const DON_B = `${T}don-b`;
const DON_C = `${T}don-c`; // đơn CÓ học viên (để đo che tên phụ huynh)
const HV_C = `${T}hv-c`;
const P = {
  pending: `${T}p-pending`, // khoản nguồn LỊCH SỬ đang chờ kế toán — ca đầu tiên cần màn này
  confirmed: `${T}p-confirmed`,
  daXoa: `${T}p-da-xoa`,
  biTuChoi: `${T}p-bi-tu-choi`,
  hoanTien: `${T}p-hoan-tien`,
  coSoB: `${T}p-co-so-b`,
  coHocVien: `${T}p-co-hoc-vien`,
};
const NGUOI = { id: `${T}ke-toan`, ten: "Kế toán fixture" };
const NGUOI_KHAC = { id: `${T}ke-toan-2`, ten: "Kế toán hai" };
const NOW = new Date("2026-11-06T03:00:00.000Z");

const kt = (centerScope: string[] | "ALL", userId = NGUOI.id) =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    grantsAllow: new Set<string>(),
    visibleCenterIds: centerScope === "ALL" ? [] : centerScope,
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
  }) as unknown as Actor;

const ketToanA = kt([CS_A]);
const ketToanB = kt([CS_B]);

const LY_DO = "Cần sao kê MB ngày 04/10 để đối chiếu";
const tep = (so: number, loai: TepDaXacMinh["loai"] = "pdf"): TepDaXacMinh => ({
  khoa: `chung-tu-ngan-hang/${T}A/2026/${P.pending}/f${so}.${loai}`,
  ten: `sao-ke-${so}.${loai}`,
  loai,
  co: 1000 + so,
  sha256: String(so).repeat(64).slice(0, 64),
});

async function don() {
  const ids = Object.values(P);
  const hs = (await db.chungTuNganHang.findMany({ where: { paymentId: { in: ids } }, select: { id: true } })).map((x) => x.id);
  await db.auditLog.deleteMany({ where: { entityType: "ChungTuNganHang", entityId: { in: hs } } });
  await db.chungTuNganHang.deleteMany({ where: { paymentId: { in: ids } } });
  await db.receipt.deleteMany({ where: { paymentId: { in: ids } } });
  await db.payment.deleteMany({ where: { id: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: [DON_A, DON_B, DON_C] } } });
  await db.student.deleteMany({ where: { id: HV_C } });
  await db.center.deleteMany({ where: { id: { in: [CS_A, CS_B] } } });
}

async function taoFixture() {
  await db.center.create({ data: { id: CS_A, code: `${T}A`, name: "Cơ sở A", slug: `${T}a`, address: "a" } });
  await db.center.create({ data: { id: CS_B, code: `${T}B`, name: "Cơ sở B", slug: `${T}b`, address: "b" } });
  const donBase = { type: "COURSE" as const, status: "CONFIRMED" as const, customerName: "Học viên fixture", customerPhone: "0999000111", totalAmount: 9_000_000 };
  await db.order.create({ data: { id: DON_A, code: "ORD-269926-000901", centerId: CS_A, ...donBase } });
  await db.order.create({ data: { id: DON_B, code: "ORD-269926-000902", centerId: CS_B, ...donBase } });
  const pay = (id: string, orderId: string, centerId: string, o: Record<string, unknown> = {}) =>
    db.payment.create({
      data: { id, orderId, centerId, amount: 3_920_000, method: "backfill", paidDate: new Date("2026-10-04T05:00:00.000Z"), ...o } as never,
    });
  await pay(P.pending, DON_A, CS_A, { accountantStatus: "PENDING", note: "[backfill-import] nhập lịch sử" });
  await pay(P.confirmed, DON_A, CS_A, { accountantStatus: "CONFIRMED", confirmedAt: new Date("2026-10-05T01:00:00.000Z"), evidenceUrl: "https://example.test/bang-chung" });
  await pay(P.daXoa, DON_A, CS_A, { deletedAt: new Date("2026-10-06T00:00:00.000Z") });
  await pay(P.biTuChoi, DON_A, CS_A, { accountantStatus: "REJECTED", rejectReason: "trùng" });
  await pay(P.hoanTien, DON_A, CS_A, { paymentType: "ADJUSTMENT", amount: -100_000 });
  await pay(P.coSoB, DON_B, CS_B);
  await db.student.create({ data: { id: HV_C, name: "Bé fixture", parentName: "Phụ huynh fixture", parentPhone: "0999000222", centerId: CS_A } as never });
  await db.order.create({ data: { id: DON_C, code: "ORD-269926-000903", centerId: CS_A, studentId: HV_C, ...donBase } });
  await pay(P.coHocVien, DON_C, CS_A);
}

const bat = (e: unknown) => (e instanceof LoiChungTu ? e.ma : `LOI_LA:${e instanceof Error ? e.message : String(e)}`);
async function loi(f: () => Promise<unknown>): Promise<string> {
  try {
    await f();
    return "KHONG_LOI";
  } catch (e) {
    return bat(e);
  }
}
const danhDau = (id = P.pending, actor = ketToanA, nguoi = NGUOI) => danhDauCanChungTu({ actor, nguoi, paymentId: id, lyDo: LY_DO });
const taiLen = (so = 1, actor = ketToanA, id = P.pending) =>
  ghiTepChungTu({ actor, nguoi: NGUOI, paymentId: id, tep: tep(so), ghiChu: "bản chụp app MB", now: NOW });
const hoSo = (id = P.pending) => db.chungTuNganHang.findUniqueOrThrow({ where: { paymentId: id } });
const nhatKy = async (id: string) =>
  (await db.auditLog.findMany({ where: { entityType: "ChungTuNganHang", entityId: id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);

describe.skipIf(!RUN_DB_TESTS)("[CTD] chứng từ ngân hàng của khoản thu — Postgres thật", () => {
  beforeEach(async () => {
    await don();
    await taoFixture();
  });
  afterAll(don);

  it("[CTD-01] đối chứng DƯƠNG: khoản nguồn LỊCH SỬ đang PENDING đánh dấu được ⇒ CHO_BO_SUNG, centerId = cơ sở của KHOẢN, có AuditLog", async () => {
    const r = await danhDau();
    const h = await hoSo();
    expect(h).toMatchObject({ id: r.id, trangThai: "CHO_BO_SUNG", centerId: CS_A, lyDoDanhDau: LY_DO, danhDauBoiId: NGUOI.id, tepKhoa: null, tepTen: null });
    expect(await nhatKy(h.id)).toEqual(["DANH_DAU_CAN_CHUNG_TU"]);
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityType: "ChungTuNganHang", entityId: h.id } });
    expect(nk).toMatchObject({ actorId: NGUOI.id, actorName: NGUOI.ten, reason: LY_DO, module: "finance" });
  });

  it("[CTD-02] CẢ VÒNG ĐỜI không đổi `Payment` một byte, không sinh Receipt / hoá đơn: đánh dấu → tải → kiểm tra → bổ sung lại → thay tệp → kiểm tra", async () => {
    const truoc = await db.payment.findMany({ orderBy: { id: "asc" }, where: { id: { in: Object.values(P) } } });
    await danhDau();
    await taiLen(1);
    await danhDauDaKiemTra({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, ghiChu: "khớp 3.920.000", now: NOW });
    await yeuCauBoSungLai({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "Ảnh bị cắt mất số tài khoản", now: NOW });
    await taiLen(2, ketToanA);
    await danhDauDaKiemTra({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, now: NOW });
    const sau = await db.payment.findMany({ orderBy: { id: "asc" }, where: { id: { in: Object.values(P) } } });
    expect(sau).toEqual(truoc); // gồm updatedAt, accountantStatus, confirmedAt, evidenceUrl, amount, note…
    expect(await db.receipt.count({ where: { paymentId: { in: Object.values(P) } } })).toBe(0);
    expect(await db.hoaDonDienTu.count({ where: { orderId: { in: [DON_A, DON_B] } } })).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P.pending } })).accountantStatus).toBe("PENDING"); // tải chứng từ KHÔNG xác nhận khoản
  });

  it("[CTD-03] khoản không đánh dấu được: đã xoá · hoàn tiền · bị từ chối · khoản không tồn tại ⇒ lỗi có mã, KHÔNG tạo hồ sơ", async () => {
    for (const id of [P.hoanTien, P.biTuChoi]) expect(await loi(() => danhDau(id)), id).toBe("KHONG_DANH_DAU_DUOC");
    // khoản đã xoá mềm: lớp xoá mềm của `db` che nó khỏi mọi lượt đọc ⇒ "không thấy" (lớp dự phòng `lyDoKhongDanhDau` có ca thuần [DCT-03])
    expect(await loi(() => danhDau(P.daXoa))).toBe("KHONG_THAY");
    expect(await loi(() => danhDau(`${T}khong-ton-tai`))).toBe("KHONG_THAY");
    expect(await db.chungTuNganHang.count({ where: { payment: { orderId: DON_A } } })).toBe(0);
    // khoản đã CONFIRMED thì đánh dấu được (cần chứng từ để đối chiếu)
    expect((await danhDau(P.confirmed)).id).toBeTruthy();
  });

  it("[CTD-04] PHẠM VI CƠ SỞ khi GHI: kế toán CS-B không đánh dấu khoản CS-A (và không biết nó có tồn tại); kế toán ALL thì được", async () => {
    expect(await loi(() => danhDau(P.pending, ketToanB))).toBe("KHONG_THAY");
    expect(await db.chungTuNganHang.count({ where: { paymentId: P.pending } })).toBe(0);
    expect((await danhDau(P.pending, kt("ALL"))).id).toBeTruthy();
    // khoản của CS-B: kế toán CS-A bị chặn
    expect(await loi(() => danhDau(P.coSoB, ketToanA))).toBe("KHONG_THAY");
  });

  it("[CTD-05] mọi thao tác GHI trên hồ sơ của cơ sở KHÁC đều bị chặn, hồ sơ KHÔNG đổi", async () => {
    await danhDau();
    await taiLen(1);
    const truoc = await hoSo();
    expect(await loi(() => taiLen(2, ketToanB))).toBe("KHONG_THAY");
    expect(await loi(() => danhDauDaKiemTra({ actor: ketToanB, nguoi: NGUOI, paymentId: P.pending, now: NOW }))).toBe("KHONG_THAY");
    expect(await loi(() => yeuCauBoSungLai({ actor: ketToanB, nguoi: NGUOI, paymentId: P.pending, lyDo: "Không phải việc của tôi", now: NOW }))).toBe("KHONG_THAY");
    expect(await loi(() => huyDanhDau({ actor: ketToanB, nguoi: NGUOI, paymentId: P.pending, lyDo: "Không phải việc của tôi" }))).toBe("KHONG_THAY");
    expect(await hoSo()).toEqual(truoc);
  });

  it("[CTD-06] đánh dấu lần hai ⇒ DA_DANH_DAU; HAI kế toán đánh dấu CÙNG LÚC ⇒ đúng một hồ sơ, một bên bị từ chối", async () => {
    await danhDau();
    expect(await loi(() => danhDau())).toBe("DA_DANH_DAU");
    await db.chungTuNganHang.deleteMany({ where: { paymentId: P.pending } });
    const kq = await Promise.allSettled([danhDau(P.pending, ketToanA, NGUOI), danhDau(P.pending, kt([CS_A], NGUOI_KHAC.id), NGUOI_KHAC)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const bi = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(bat(bi.reason)).toBe("DA_DANH_DAU");
    expect(await db.chungTuNganHang.count({ where: { paymentId: P.pending } })).toBe(1);
  });

  it("[CTD-07] máy trạng thái trên DB: tải → DA_TAI_LEN (đủ trường) · kiểm tra → DA_KIEM_TRA · KHÔNG thay tệp khi đã kiểm · bổ sung lại → tải lại xoá dấu kiểm tra", async () => {
    await danhDau();
    // kiểm tra / bổ sung lại khi CHƯA có tệp ⇒ từ chối
    expect(await loi(() => danhDauDaKiemTra({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, now: NOW }))).toBe("SAI_TRANG_THAI");
    expect(await loi(() => yeuCauBoSungLai({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "Chưa có tệp nào cả", now: NOW }))).toBe("SAI_TRANG_THAI");
    expect((await hoSo()).trangThai).toBe("CHO_BO_SUNG");

    await taiLen(1);
    expect(await hoSo()).toMatchObject({ trangThai: "DA_TAI_LEN", tepKhoa: tep(1).khoa, tepTen: "sao-ke-1.pdf", tepLoai: "pdf", tepCo: 1001, taiLenBoiId: NGUOI.id, ghiChu: "bản chụp app MB" });
    expect((await hoSo()).taiLenLuc?.toISOString()).toBe(NOW.toISOString());

    await danhDauDaKiemTra({ actor: ketToanA, nguoi: NGUOI_KHAC, paymentId: P.pending, now: NOW });
    expect(await hoSo()).toMatchObject({ trangThai: "DA_KIEM_TRA", kiemTraBoiId: NGUOI_KHAC.id });
    expect(await loi(() => taiLen(2))).toBe("SAI_TRANG_THAI"); // đã kiểm tra ⇒ không thay tệp trực tiếp
    expect((await hoSo()).tepKhoa).toBe(tep(1).khoa);

    await yeuCauBoSungLai({ actor: ketToanA, nguoi: NGUOI_KHAC, paymentId: P.pending, lyDo: "Ảnh mờ, không đọc được số tiền", now: NOW });
    expect(await hoSo()).toMatchObject({ trangThai: "CAN_BO_SUNG_LAI", canBoSungLyDo: "Ảnh mờ, không đọc được số tiền", canBoSungBoiId: NGUOI_KHAC.id, kiemTraBoiId: null, kiemTraLuc: null });

    await taiLen(2);
    expect(await hoSo()).toMatchObject({ trangThai: "DA_TAI_LEN", tepKhoa: tep(2).khoa, kiemTraBoiId: null });
    expect(await nhatKy((await hoSo()).id)).toEqual([
      "DANH_DAU_CAN_CHUNG_TU",
      "TAI_LEN_CHUNG_TU",
      "KIEM_TRA_CHUNG_TU",
      "YEU_CAU_BO_SUNG_LAI_CHUNG_TU",
      "THAY_TEP_CHUNG_TU",
    ]);
  });

  it("[CTD-08] lý do bắt buộc (≥ 10 ký tự) cho đánh dấu · bổ sung lại · huỷ; thiếu ⇒ THIEU_LY_DO và KHÔNG đổi gì", async () => {
    expect(await loi(() => danhDauCanChungTu({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "ngắn" }))).toBe("THIEU_LY_DO");
    expect(await db.chungTuNganHang.count()).toBe(0);
    await danhDau();
    await taiLen(1);
    expect(await loi(() => yeuCauBoSungLai({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "  ngắn  ", now: NOW }))).toBe("THIEU_LY_DO");
    expect((await hoSo()).trangThai).toBe("DA_TAI_LEN");
    await db.chungTuNganHang.update({ where: { paymentId: P.pending }, data: { trangThai: "CHO_BO_SUNG", tepKhoa: null } });
    expect(await loi(() => huyDanhDau({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "x" }))).toBe("THIEU_LY_DO");
    expect(await db.chungTuNganHang.count({ where: { paymentId: P.pending } })).toBe(1);
  });

  it("[CTD-09] huỷ đánh dấu: chỉ khi CHƯA từng có tệp; hồ sơ bị xoá, dấu vết còn trong AuditLog; đã có tệp ⇒ SAI_TRANG_THAI, hồ sơ còn nguyên", async () => {
    const { id } = await danhDau();
    await huyDanhDau({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "Đánh dấu nhầm khoản" });
    expect(await db.chungTuNganHang.count({ where: { paymentId: P.pending } })).toBe(0);
    expect(await nhatKy(id)).toEqual(["DANH_DAU_CAN_CHUNG_TU", "HUY_DANH_DAU_CHUNG_TU"]);
    // đánh dấu lại + có tệp ⇒ không huỷ được
    await danhDau();
    await taiLen(1);
    expect(await loi(() => huyDanhDau({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, lyDo: "Đánh dấu nhầm khoản" }))).toBe("SAI_TRANG_THAI");
    expect(await db.chungTuNganHang.count({ where: { paymentId: P.pending } })).toBe(1);
  });

  it("[CTD-10] HAI kế toán bấm «đã kiểm tra» CÙNG LÚC ⇒ đúng một bên thành công (cập nhật có điều kiện trạng thái), không ghi đè im lặng", async () => {
    await danhDau();
    await taiLen(1);
    const kq = await Promise.allSettled([
      danhDauDaKiemTra({ actor: ketToanA, nguoi: NGUOI, paymentId: P.pending, now: NOW }),
      danhDauDaKiemTra({ actor: kt([CS_A], NGUOI_KHAC.id), nguoi: NGUOI_KHAC, paymentId: P.pending, now: NOW }),
    ]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const bi = kq.find((k) => k.status === "rejected") as PromiseRejectedResult;
    expect(["DA_DOI", "SAI_TRANG_THAI"]).toContain(bat(bi.reason));
    expect((await nhatKy((await hoSo()).id)).filter((a) => a === "KIEM_TRA_CHUNG_TU")).toHaveLength(1); // đúng một dòng audit
  });

  it("[CTD-11] ROLLBACK: audit hỏng ⇒ phép ghi lùi theo (không có thay đổi chứng từ nào mà không có dấu vết)", async () => {
    const hong = { id: NGUOI.id, ten: undefined as unknown as string };
    expect(await loi(() => danhDauCanChungTu({ actor: ketToanA, nguoi: hong, paymentId: P.pending, lyDo: LY_DO }))).toMatch(/^LOI_LA:/);
    expect(await db.chungTuNganHang.count({ where: { paymentId: P.pending } })).toBe(0);

    await danhDau();
    const truoc = await hoSo();
    expect(await loi(() => ghiTepChungTu({ actor: ketToanA, nguoi: hong, paymentId: P.pending, tep: tep(1), now: NOW }))).toMatch(/^LOI_LA:/);
    expect(await hoSo()).toEqual(truoc); // vẫn CHO_BO_SUNG, không tệp
    expect(await nhatKy(truoc.id)).toEqual(["DANH_DAU_CAN_CHUNG_TU"]);
  });

  it("[CTD-12] AuditLog KHÔNG chép khoá tệp / URL; chép tên tệp, loại, cỡ, sha256 và lý do", async () => {
    await danhDau();
    await taiLen(1);
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityType: "ChungTuNganHang", entityId: (await hoSo()).id, action: "TAI_LEN_CHUNG_TU" } });
    const tho = JSON.stringify({ o: nk.oldValues, n: nk.newValues });
    expect(tho).not.toContain("chung-tu-ngan-hang/");
    expect(tho).not.toContain("/f1.pdf"); // phần cuối của khoá tệp
    expect(nk.newValues).toMatchObject({ tepTen: "sao-ke-1.pdf", tepLoai: "pdf", tepCo: 1001, trangThai: "DA_TAI_LEN" });
  });

  it("[CTD-13] CHECK của SQL: trạng thái «đã có tệp» mà thiếu khoá tệp bị DB từ chối; hai trạng thái chờ thì không cần tệp", async () => {
    await danhDau();
    for (const t of ["DA_TAI_LEN", "DA_KIEM_TRA"] as const) {
      await expect(db.chungTuNganHang.update({ where: { paymentId: P.pending }, data: { trangThai: t, tepKhoa: null } }), t).rejects.toThrow();
    }
    await expect(db.chungTuNganHang.update({ where: { paymentId: P.pending }, data: { trangThai: "CAN_BO_SUNG_LAI", tepKhoa: null } })).resolves.toBeTruthy();
  });

  it("[CTD-14] ĐỌC: danh sách chỉ có hồ sơ của cơ sở được xem; khoản nhập lịch sử được gắn cờ; tên phụ huynh bị che khi thiếu quyền xem PII", async () => {
    await danhDau(P.pending, ketToanA);
    await danhDau(P.coSoB, ketToanB);
    const a = await docDanhSachChungTu(ketToanA, { coSoId: CS_A, xemPii: false });
    expect(a.map((d) => d.paymentId)).toEqual([P.pending]);
    expect(a[0]).toMatchObject({ maDon: "ORD-269926-000901", soTien: 3_920_000, nhapLichSu: true, trangThaiKhoan: "PENDING", trangThai: "CHO_BO_SUNG", hoaDon: null, phuHuynh: null });
    expect(a[0]!.nut).toEqual({ taiLen: true, taiVe: false, kiemTra: false, yeuCauBoSungLai: false, huyDanhDau: true });
    // đơn không có học viên ⇒ `customerName` là tên NGƯỜI ĐẶT: che khi thiếu quyền PII, hiện khi có (đối chứng dương)
    expect(a[0]!.hocVien).toBeNull();
    expect((await docDanhSachChungTu(ketToanA, { coSoId: CS_A, xemPii: true }))[0]!.hocVien).toBe("Học viên fixture");
    // đơn CÓ học viên: tên bé luôn hiện; tên PHỤ HUYNH chỉ khi có quyền xem PII (đối chứng dương + âm trên cùng một khoản)
    await danhDau(P.coHocVien, ketToanA);
    const khongPii = (await docDanhSachChungTu(ketToanA, { coSoId: CS_A, xemPii: false })).find((d) => d.paymentId === P.coHocVien)!;
    const coPii = (await docDanhSachChungTu(ketToanA, { coSoId: CS_A, xemPii: true })).find((d) => d.paymentId === P.coHocVien)!;
    expect(khongPii).toMatchObject({ hocVien: "Bé fixture", phuHuynh: null });
    expect(coPii).toMatchObject({ hocVien: "Bé fixture", phuHuynh: "Phụ huynh fixture" });
    // kế toán A hỏi cơ sở B ⇒ scopedDb lọc, không rò
    expect(await docDanhSachChungTu(ketToanA, { coSoId: CS_B, xemPii: true })).toEqual([]);
    expect((await docDanhSachChungTu(ketToanB, { coSoId: CS_B, xemPii: true })).map((d) => d.paymentId)).toEqual([P.coSoB]);
  });

  it("[CTD-15] TÌM KHOẢN theo mã đơn: trả cả khoản lịch sử + PENDING (đánh dấu được) và lý do cho khoản không đánh dấu được; đơn cơ sở khác ⇒ null", async () => {
    const r = await timKhoanTheoMaDon(ketToanA, { coSoId: CS_A, maDon: " ord-269926-000901 " });
    expect(r?.maDon).toBe("ORD-269926-000901");
    const theoId = new Map(r!.khoan.map((k) => [k.paymentId, k]));
    expect(theoId.get(P.pending)).toMatchObject({ nhapLichSu: true, trangThaiKhoan: "PENDING", daDanhDau: false, lyDoKhong: null });
    expect(theoId.get(P.confirmed)).toMatchObject({ lyDoKhong: null });
    expect(theoId.get(P.biTuChoi)?.lyDoKhong).toMatch(/từ chối/);
    expect(theoId.get(P.hoanTien)?.lyDoKhong).toMatch(/hoàn tiền/);
    expect(theoId.has(P.daXoa)).toBe(false); // khoản đã xoá không được liệt kê
    await danhDau();
    expect((await timKhoanTheoMaDon(ketToanA, { coSoId: CS_A, maDon: "ORD-269926-000901" }))!.khoan.find((k) => k.paymentId === P.pending)).toMatchObject({ daDanhDau: true, lyDoKhong: expect.stringMatching(/đã có hồ sơ/) });
    // phạm vi: đơn CS-B qua cơ sở A, hoặc kế toán A hỏi cơ sở B ⇒ null
    expect(await timKhoanTheoMaDon(ketToanA, { coSoId: CS_A, maDon: "ORD-269926-000902" })).toBeNull();
    expect(await timKhoanTheoMaDon(ketToanA, { coSoId: CS_B, maDon: "ORD-269926-000902" })).toBeNull();
    expect(await timKhoanTheoMaDon(ketToanA, { coSoId: CS_A, maDon: "x'; drop" })).toBeNull();
  });
});
