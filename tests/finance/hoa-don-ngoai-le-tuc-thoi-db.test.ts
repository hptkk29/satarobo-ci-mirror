// Ca [NLT-*] — BÁO NGOẠI LỆ HOÁ ĐƠN TỨC THỜI (Invoice Hub §6) TRÊN POSTGRES THẬT.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-ngoai-le-tuc-thoi-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Mọi ca "KHÔNG được" kèm đối chứng dương.
// Đồng hồ ĐÓNG BĂNG (luật 19): `now` được truyền vào.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notify: vi.fn(async (_p: { userIds: readonly string[]; dedupeKey: string; title: string; body: string; href?: string | null }) => 1) }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { seedUser } from "../e2e/_helpers/seed";
import { baoNgoaiLeTucThoi } from "@/lib/finance/hoa-don/ngoai-le-tuc-thoi-db";
import { khoaNgoaiLeTucThoi, khoaThongBaoTucThoi } from "@/lib/finance/hoa-don/ngoai-le-tuc-thoi";

if (!RUN_DB_TESTS) console.warn(`[NLT] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-nlt-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU_HO = `${T}ou-ho`;
const OU1 = `${T}ou1`;
const OU2 = `${T}ou2`;
const DON1 = `${T}don1`; // CS1
const DON2 = `${T}don2`; // CS2
const HD1 = `${T}hd1`; // CS1
const HD2 = `${T}hd2`; // CS2
const VAI = `${T}vai`;
const NOW = new Date("2026-11-02T03:00:00Z");
const TEN_PHU_HUYNH = "Nguyễn Thị Phụ Huynh QNT";
const SDT = "0328545331";

async function don() {
  await db.hoaDonNgoaiLe.deleteMany({ where: { OR: [{ orderId: { startsWith: T } }, { centerId: { in: [CS1, CS2] } }] } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  const nguoi = await db.user.findMany({ where: { email: { endsWith: `@${T}test` } }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { OR: [{ userId: { in: nguoi.map((u) => u.id) } }, { roleId: VAI }] } });
  await db.rolePermission.deleteMany({ where: { roleId: VAI } });
  await db.roleDef.deleteMany({ where: { id: VAI } });
  await db.user.deleteMany({ where: { id: { in: nguoi.map((u) => u.id) } } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU_HO } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"] } } });
}

/** `thiDiem` = mức TOÀN HỆ THỐNG của `hoaDon.hubThiDiem` (true ⇒ mọi cơ sở tham gia; ca [NLT-07] đặt false rồi bật RIÊNG từng cơ sở). */
async function batCo(man: boolean, quet: boolean, thiDiem = true) {
  for (const [key, v] of [["billing.hoaDonEnabled", man], ["hoaDon.hubQuet", quet], ["hoaDon.hubThiDiem", thiDiem]] as const) {
    await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
  }
}

async function lapNguoi(ten: string, orgUnitId: string) {
  const u = await seedUser({ email: `${ten}@${T}test`, role: "TEACHER", name: ten });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId, roleId: VAI, grantedById: u.id } });
  return u.id;
}

async function dungFixture() {
  await don();
  await batCo(true, true);
  for (const [id, ten] of [[CS1, "CS1 QNT"], [CS2, "CS2 QNT"]] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  }
  await db.orgUnit.create({ data: { id: OU_HO, type: "HO", code: `${T}HO`, name: "HO QNT", path: `/${T}ho/`, depth: 0 } });
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "ĐV CS1 QNT", centerId: CS1, parentId: OU_HO, path: `/${T}ho/${T}ou1/`, depth: 1 } });
  await db.orgUnit.create({ data: { id: OU2, type: "CENTER", code: `${T}OU2`, name: "ĐV CS2 QNT", centerId: CS2, parentId: OU_HO, path: `/${T}ho/${T}ou2/`, depth: 1 } });
  for (const [id, coSo, ma] of [[DON1, CS1, "ORD-269973-000001"], [DON2, CS2, "ORD-269973-000002"]] as const) {
    await db.order.create({ data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: TEN_PHU_HUYNH, customerPhone: SDT, totalAmount: 5_000_000, centerId: coSo } });
  }
  for (const [id, don, coSo] of [[HD1, DON1, CS1], [HD2, DON2, CS2]] as const) {
    await db.hoaDonDienTu.create({ data: { id, orderId: don, centerId: coSo, trangThai: "LOI_PHAT_HANH", tongTien: 5_000_000, taoBoiId: `${T}kt` } });
  }
  await db.roleDef.create({ data: { id: VAI, code: `${T}vai`, name: "Kế toán QNT" } });
  await db.rolePermission.create({ data: { roleId: VAI, action: "payments:confirm", scopeType: "GLOBAL" } });
}

const ngoaiLe = () => db.hoaDonNgoaiLe.findMany({ where: { OR: [{ orderId: { startsWith: T } }, { centerId: { in: [CS1, CS2] } }] }, orderBy: { dedupeKey: "asc" } });
const bao = (o: Partial<Parameters<typeof baoNgoaiLeTucThoi>[0]> = {}) =>
  baoNgoaiLeTucThoi({ hoaDonId: HD1, loai: "TU_CHOI_NHA_CUNG_CAP", khoa: "ref-1", now: NOW, ...o });
// Khoá chuông tức thời mang id ngoại lệ (UUID), không mang tiền tố fixture ⇒ lọc theo tiền tố khoá; mock đã được dọn mỗi ca nên không lẫn chuông của ca khác.
const goiCuaBoNay = () => h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.startsWith("hoa-don.ngoai-le:tuc-thoi:"));

beforeEach(async () => {
  if (!RUN_DB_TESTS) return;
  h.notify.mockClear();
  await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[NLT-01] tạo ngoại lệ ngay tại thời điểm lỗi, đúng cơ sở, kèm chuông cho đúng người", () => {
  it("TỪ CHỐI của nhà cung cấp ở CS1 ⇒ 1 ngoại lệ CS1 (CAN_XU_LY) gắn hoá đơn + đơn; chuông chỉ tới người giữ quyền ở CS1 (và Hội sở cha), KHÔNG tới kế toán CS2", async () => {
    const ktCs1 = await lapNguoi("kt-cs1", OU1);
    const ktCs2 = await lapNguoi("kt-cs2", OU2);
    const ktHo = await lapNguoi("kt-ho", OU_HO);
    const kq = await bao();
    expect(kq).toMatchObject({ ket: "TAO", thongBao: 1, loiThongBao: 0 });
    const nl = await ngoaiLe();
    expect(nl).toHaveLength(1);
    expect(nl[0]).toMatchObject({
      centerId: CS1,
      loai: "TU_CHOI_NHA_CUNG_CAP",
      muc: "CAN_XU_LY",
      hoaDonId: HD1,
      orderId: DON1,
      trangThai: "MO",
      dedupeKey: khoaNgoaiLeTucThoi("TU_CHOI_NHA_CUNG_CAP", HD1, "ref-1"),
    });
    const goi = goiCuaBoNay();
    expect(goi).toHaveLength(1);
    expect([...goi[0]!.userIds].sort()).toEqual([ktCs1, ktHo].sort());
    expect(goi[0]!.userIds).not.toContain(ktCs2);
    expect(goi[0]!.href).toBe("/payments/hoa-don/canh-bao");
    expect(goi[0]!.dedupeKey).toBe(khoaThongBaoTucThoi(nl[0]!.id)); // khoá RIÊNG theo ngoại lệ, không phải khoá theo ngày của scanner
    // Đối chứng dương: lỗi ở CS2 ⇒ kế toán CS2 nhận, kế toán CS1 không.
    h.notify.mockClear();
    await bao({ hoaDonId: HD2, khoa: "ref-9" });
    const cs2 = goiCuaBoNay();
    expect(cs2).toHaveLength(1);
    expect([...cs2[0]!.userIds].sort()).toEqual([ktCs2, ktHo].sort());
    expect(cs2[0]!.userIds).not.toContain(ktCs1);
  });

  it("lỗi THỨ HAI trong cùng ngày ở cùng cơ sở có chuông RIÊNG (khoá khác): khoá theo ngày sẽ nuốt nó vì hệ thông báo không rung lại khi khoá đã có", async () => {
    await lapNguoi("kt-cs1", OU1);
    await bao({ khoa: "ref-1" });
    await bao({ khoa: "ref-2" });
    const goi = goiCuaBoNay();
    expect(goi).toHaveLength(2);
    expect(new Set(goi.map((p) => p.dedupeKey)).size).toBe(2);
    const nl = await ngoaiLe();
    expect(new Set(goi.map((p) => p.dedupeKey))).toEqual(new Set(nl.map((x) => khoaThongBaoTucThoi(x.id))));
  });

  it("KHÔNG RÕ quá hạn ⇒ mức KHẨN (đối chứng của mức: TỪ CHỐI là CAN_XU_LY)", async () => {
    await lapNguoi("kt-cs1", OU1);
    await bao({ loai: "KHONG_RO_QUA_HAN", khoa: "ref-1" });
    const nl = await ngoaiLe();
    expect(nl).toHaveLength(1);
    expect(nl[0]).toMatchObject({ loai: "KHONG_RO_QUA_HAN", muc: "KHAN", centerId: CS1 });
    expect(`${goiCuaBoNay()[0]!.title} ${goiCuaBoNay()[0]!.body}`).toMatch(/khẩn/i);
  });

  it("chuông KHÔNG mang PII: không tên phụ huynh, không SĐT, không mã đơn, không chuỗi thông điệp của nhà cung cấp", async () => {
    await lapNguoi("kt-cs1", OU1);
    await bao();
    const p = goiCuaBoNay()[0]!;
    const noiDung = `${p.title} ${p.body} ${p.href ?? ""}`;
    expect(noiDung).not.toContain(TEN_PHU_HUYNH);
    expect(noiDung).not.toContain(SDT);
    expect(noiDung).not.toMatch(/ORD-|\d{6,}|@/);
    expect(goiCuaBoNay()).toHaveLength(1);
  });
});

chay("[NLT-02] chạy lại / chạy chồng: chỉ MỘT ngoại lệ và MỘT chuông cho cùng một lần lỗi", () => {
  it("cùng khoá gọi lần hai ⇒ DA_CO, không thêm dòng, không chuông thứ hai; đối chứng: khoá lượt khác (phát hành lại rồi lại bị từ chối) ⇒ dòng mới + chuông mới", async () => {
    await lapNguoi("kt-cs1", OU1);
    expect((await bao()).ket).toBe("TAO");
    h.notify.mockClear();
    const lai = await bao();
    expect(lai).toMatchObject({ ket: "DA_CO", thongBao: 0 });
    expect(await ngoaiLe()).toHaveLength(1);
    expect(goiCuaBoNay()).toHaveLength(0);
    expect((await bao({ khoa: "ref-2" })).ket).toBe("TAO");
    expect(await ngoaiLe()).toHaveLength(2);
    expect(goiCuaBoNay()).toHaveLength(1);
  });

  it("hai lượt chạy ĐỒNG THỜI cùng khoá hội tụ về đúng MỘT dòng (chỉ mục từng phần + skipDuplicates)", async () => {
    await lapNguoi("kt-cs1", OU1);
    const kq = await Promise.all([bao(), bao(), bao()]);
    expect(kq.filter((k) => k.ket === "TAO")).toHaveLength(1);
    expect(kq.filter((k) => k.ket === "DA_CO")).toHaveLength(2);
    expect(await ngoaiLe()).toHaveLength(1);
  });

  it("ngoại lệ cùng khoá đã ĐÓNG (DA_XU_LY) cũng không bị mở lại bởi lượt gọi trùng", async () => {
    await lapNguoi("kt-cs1", OU1);
    await bao();
    await db.hoaDonNgoaiLe.updateMany({ where: { centerId: CS1 }, data: { trangThai: "DA_XU_LY", lyDoXuLy: "Đã soát cùng kế toán trưởng" } });
    h.notify.mockClear();
    expect((await bao()).ket).toBe("DA_CO");
    expect(await db.hoaDonNgoaiLe.count({ where: { centerId: CS1, trangThai: "MO" } })).toBe(0);
    expect(goiCuaBoNay()).toHaveLength(0);
  });
});

chay("[NLT-03] kế toán đã BỎ QUA có lý do thì không mở lại, không chuông", () => {
  it("khoá đã BO_QUA_CO_LY_DO ⇒ BO_QUA_CO_LY_DO; đối chứng: khoá khác của cùng hoá đơn vẫn tạo", async () => {
    await lapNguoi("kt-cs1", OU1);
    await db.hoaDonNgoaiLe.create({
      data: {
        id: `${T}nl-boqua`,
        centerId: CS1,
        orderId: DON1,
        hoaDonId: HD1,
        loai: "TU_CHOI_NHA_CUNG_CAP",
        muc: "CAN_XU_LY",
        trangThai: "BO_QUA_CO_LY_DO",
        lyDoXuLy: "Khách đã tự xử lý ngoài hệ thống",
        dedupeKey: khoaNgoaiLeTucThoi("TU_CHOI_NHA_CUNG_CAP", HD1, "ref-1"),
      },
    });
    expect((await bao()).ket).toBe("BO_QUA_CO_LY_DO");
    expect(await db.hoaDonNgoaiLe.count({ where: { centerId: CS1, trangThai: "MO" } })).toBe(0);
    expect(goiCuaBoNay()).toHaveLength(0);
    expect((await bao({ khoa: "ref-2" })).ket).toBe("TAO");
    expect(goiCuaBoNay()).toHaveLength(1);
  });
});

chay("[NLT-04] cờ TẮT ⇒ không chạm bảng nào, không chuông", () => {
  it.each([
    ["công tắc con hubQuet TẮT", false, true] as const,
    ["màn Hoá đơn điện tử TẮT", true, false] as const,
  ])("%s", async (_ten, quet, man) => {
    await lapNguoi("kt-cs1", OU1);
    await batCo(man, quet);
    const kq = await bao();
    expect(kq).toMatchObject({ ket: "CO_TAT", thongBao: 0 });
    expect(await ngoaiLe()).toHaveLength(0);
    expect(goiCuaBoNay()).toHaveLength(0);
  });

  it("đối chứng dương: bật cả hai ⇒ tạo", async () => {
    await lapNguoi("kt-cs1", OU1);
    expect((await bao()).ket).toBe("TAO");
  });
});

chay("[NLT-05] không bao giờ ném lỗi ra đường phát hành", () => {
  it("hoá đơn không tồn tại ⇒ KHONG_TIM_THAY, không ghi gì, không ném", async () => {
    await lapNguoi("kt-cs1", OU1);
    await expect(bao({ hoaDonId: `${T}khong-co` })).resolves.toMatchObject({ ket: "KHONG_TIM_THAY" });
    expect(await ngoaiLe()).toHaveLength(0);
    expect(goiCuaBoNay()).toHaveLength(0);
  });

  it("hệ thông báo chết ⇒ ngoại lệ VẪN được ghi, kết quả báo loiThongBao, không ném", async () => {
    await lapNguoi("kt-cs1", OU1);
    h.notify.mockRejectedValueOnce(new Error("hệ thông báo chết"));
    const kq = await bao();
    expect(kq).toMatchObject({ ket: "TAO", thongBao: 0, loiThongBao: 1 });
    expect(await ngoaiLe()).toHaveLength(1);
  });

  it("bước gửi chuông ném (không phải notifyStaff mà là truy vấn dựng chuông) ⇒ ngoại lệ VẪN ở lại, kết quả TAO + loiThongBao, không ném và KHÔNG báo LOI", async () => {
    await lapNguoi("kt-cs1", OU1);
    const spy = vi.spyOn(db.center, "findUnique").mockRejectedValueOnce(new Error("mất kết nối giữa chừng") as never);
    try {
      await expect(bao()).resolves.toMatchObject({ ket: "TAO", thongBao: 0, loiThongBao: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(await ngoaiLe()).toHaveLength(1);
    // Đối chứng dương: lượt gọi trùng sau đó là DA_CO (dòng thật sự đã được ghi), không tạo thêm.
    expect((await bao()).ket).toBe("DA_CO");
  });

  it("DB lỗi giữa chừng ⇒ LOI, không ném (đường phát hành đã ghi trạng thái trước đó và không bị cuốn theo)", async () => {
    const spy = vi.spyOn(db.hoaDonDienTu, "findFirst").mockRejectedValueOnce(new Error("mất kết nối"));
    try {
      await expect(bao()).resolves.toMatchObject({ ket: "LOI" });
    } finally {
      spy.mockRestore();
    }
    // Đối chứng dương: hết lỗi ⇒ chạy lại tạo bình thường (không để lại trạng thái nửa vời).
    await lapNguoi("kt-cs1", OU1);
    expect((await bao()).ket).toBe("TAO");
  });
});

chay("[NLT-06] không làm gì ngoài phạm vi: không đụng hoá đơn, đơn, tiền", () => {
  it("trạng thái hoá đơn + đơn trước/sau giống hệt nhau", async () => {
    await lapNguoi("kt-cs1", OU1);
    const truoc = JSON.stringify([await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD1 } }), await db.order.findUniqueOrThrow({ where: { id: DON1 } })]);
    await bao();
    const sau = JSON.stringify([await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD1 } }), await db.order.findUniqueOrThrow({ where: { id: DON1 } })]);
    expect(sau).toBe(truoc);
  });
});

chay("[NLT-07] thí điểm THEO CƠ SỞ: cơ sở nào được bật thì cơ sở đó mới có ngoại lệ + chuông", () => {
  const batRieng = (orgUnitId: string, value = true) =>
    db.centerSetting.upsert({ where: { orgUnitId_key: { orgUnitId, key: "hoaDon.hubThiDiem" } }, create: { orgUnitId, key: "hoaDon.hubThiDiem", valueJson: value }, update: { valueJson: value } });

  it("mức toàn hệ TẮT + chỉ CS1 bật riêng ⇒ lỗi ở CS1 có ngoại lệ + chuông; lỗi ở CS2 KHÔNG ghi gì, KHÔNG chuông; đối chứng: bật thêm CS2 thì CS2 có", async () => {
    const ktCs1 = await lapNguoi("kt-cs1", OU1);
    const ktCs2 = await lapNguoi("kt-cs2", OU2);
    await batCo(true, true, false);
    await batRieng(OU1);
    expect((await bao()).ket).toBe("TAO");
    const cs2 = await bao({ hoaDonId: HD2, khoa: "ref-9" });
    expect(cs2).toMatchObject({ ket: "CO_TAT", thongBao: 0 });
    const nl = await ngoaiLe();
    expect(nl.map((x) => x.centerId)).toEqual([CS1]);
    const goi = goiCuaBoNay();
    expect(goi).toHaveLength(1);
    expect(goi[0]!.userIds).toContain(ktCs1);
    expect(goi[0]!.userIds).not.toContain(ktCs2);
    await batRieng(OU2);
    expect((await bao({ hoaDonId: HD2, khoa: "ref-9" })).ket).toBe("TAO");
    expect((await ngoaiLe()).map((x) => x.centerId).sort()).toEqual([CS1, CS2]);
  });

  it("mức toàn hệ BẬT nhưng CS2 bị TẮT riêng ⇒ CS2 không có gì (cài riêng thắng mức chung); công tắc tổng TẮT thì cả CS1 bật riêng cũng không chạy", async () => {
    await lapNguoi("kt-cs1", OU1);
    await batCo(true, true, true);
    await batRieng(OU2, false);
    expect((await bao({ hoaDonId: HD2, khoa: "ref-9" })).ket).toBe("CO_TAT");
    expect((await bao()).ket).toBe("TAO");
    await batCo(true, false, true);
    await batRieng(OU1);
    expect((await bao({ khoa: "ref-2" })).ket).toBe("CO_TAT");
  });

  it("cơ sở KHÔNG có đơn vị tổ chức ⇒ không đặt riêng được ⇒ coi như TẮT dù mức toàn hệ bật (fail-closed)", async () => {
    await batCo(true, true, true);
    await db.orgUnit.deleteMany({ where: { id: OU1 } });
    expect((await bao()).ket).toBe("CO_TAT");
    expect(await ngoaiLe()).toHaveLength(0);
  });
});
