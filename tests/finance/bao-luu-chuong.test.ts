// tests/finance/bao-luu-chuong.test.ts — NGƯỜI NHẬN CHUÔNG BẢO LƯU chọn theo QUYỀN RBAC của đúng cơ sở, trên POSTGRES THẬT. [BLC-*]
//
// Chạy:  pnpm test:finance-db
// Sự cố 12/10/2026 (nghiệm thu R2, ô C5b): chuông "chờ duyệt" tới 5 người, trong đó có "UAT — Giáo vụ CS1" — `User.role` cũ = CENTER_MANAGER nhưng vai RBAC là
// Giáo vụ (không có `bao-luu:approve`). Nguồn: `quanLyCoSo()` chọn theo vai CŨ (`User.roles` + `User.centerId`) ∪ vai `CENTER_MANAGER` ở `UserOrgRole`.
// LUẬT: người nhận ⊆ người giữ quyền tương ứng với việc chuông đòi (xem `QUYEN_CHUONG`), neo ở cơ sở của hồ sơ hoặc đơn vị cha (HO/khối), còn hoạt động.
// Lưới này CHO ĂN bằng đường thật: gọi chính các hàm `bao*` và đọc `StaffNotification` — không gõ tay danh sách người nhận.
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import {
  baoChoDuyet,
  baoGiaHanChoDuyet,
  baoGiaHanKetQua,
  baoNhacTruocHan,
  baoNhacDungHan,
  baoQuaHan,
  baoLeoThang,
  baoChamDut,
  baoThuHoiKit,
  baoCenterQuaNgay,
  QUYEN_CHUONG,
  type HoSoChuong,
} from "@/lib/bao-luu/thong-bao";

if (!RUN_DB_TESTS) console.warn(`[BLC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-blc-";
const CS = `${T}cs`;
const CS_B = `${T}cs-b`;
const OU_HO = `${T}ou-ho`;
const OU = `${T}ou`;
const OU_B = `${T}ou-b`;
const V_QL = `${T}vai-ql`; // QLCS: approve + extend + center-pause + refund-request
const V_GV = `${T}vai-gv`; // Giáo vụ: chỉ xem
const V_DUYET = `${T}vai-duyet`; // chỉ approve
const V_GIAHAN = `${T}vai-giahan`; // chỉ extend
const V_TDL = `${T}vai-tdl`; // chỉ center-pause
const V_SALE = `${T}vai-sale`; // create

// Người dùng: id → [vai cũ (User.role), centerId, vai RBAC, đơn vị neo, đang hoạt động]
type Ng = { role: "CENTER_MANAGER" | "SALES_CSM" | "TEACHER"; centerId: string | null; vai: string | null; neo: string | null; hoatDong?: boolean };
const NG: Record<string, Ng> = {
  QL: { role: "CENTER_MANAGER", centerId: CS, vai: V_QL, neo: OU },
  QL_HO: { role: "TEACHER", centerId: null, vai: V_QL, neo: OU_HO }, // neo ở HO (đơn vị CHA) — vẫn là người duyệt hợp lệ của cơ sở con
  QL_B: { role: "CENTER_MANAGER", centerId: CS_B, vai: V_QL, neo: OU_B }, // CƠ SỞ KHÁC
  QL_TAT: { role: "CENTER_MANAGER", centerId: CS, vai: V_QL, neo: OU, hoatDong: false }, // tài khoản khoá
  GIAO_VU: { role: "CENTER_MANAGER", centerId: CS, vai: V_GV, neo: OU }, // ĐÚNG ca "UAT — Giáo vụ CS1": vai cũ CENTER_MANAGER, vai RBAC Giáo vụ
  CHI_VAI_CU: { role: "CENTER_MANAGER", centerId: CS, vai: null, neo: null }, // chỉ có vai cũ, 0 dòng UserOrgRole
  CHI_DUYET: { role: "TEACHER", centerId: CS, vai: V_DUYET, neo: OU },
  CHI_GIAHAN: { role: "TEACHER", centerId: CS, vai: V_GIAHAN, neo: OU },
  CHI_TDL: { role: "TEACHER", centerId: CS, vai: V_TDL, neo: OU },
  SALE: { role: "SALES_CSM", centerId: CS, vai: V_SALE, neo: OU }, // người lập
  DUAL: { role: "CENTER_MANAGER", centerId: CS, vai: V_QL, neo: OU }, // vừa lập vừa giữ approve
};
const id = (k: string) => `${T}u-${k.toLowerCase()}`;

const HS: HoSoChuong = { id: `${T}hs`, centerId: CS, tenHocVien: "An BLC", tenKhoa: "Khoá BLC", nguoiLapId: id("SALE") };

const nhanCua = async (hsId: string): Promise<string[]> =>
  (await db.staffNotification.findMany({ where: { dedupeKey: { contains: hsId } }, select: { userId: true } })).map((n) => n.userId).sort();

async function don() {
  await db.staffNotification.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.userOrgRole.deleteMany({ where: { userId: { startsWith: `${T}u-` } } });
  await db.user.deleteMany({ where: { id: { startsWith: `${T}u-` } } });
  await db.rolePermission.deleteMany({ where: { roleId: { startsWith: T } } });
  await db.roleDef.deleteMany({ where: { id: { startsWith: T } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU, OU_B, OU_HO] } } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS_B] } } });
}

async function dung() {
  await don();
  for (const c of [CS, CS_B]) await db.center.create({ data: { id: c, name: c, slug: c, address: "x" } });
  await db.orgUnit.create({ data: { id: OU_HO, type: "HO", code: `${T}HO`, name: "HO BLC", path: `/${T}ho/`, depth: 0 } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV BLC", centerId: CS, parentId: OU_HO, path: `/${T}ho/${T}ou/`, depth: 1 } });
  await db.orgUnit.create({ data: { id: OU_B, type: "CENTER", code: `${T}OU-B`, name: "ĐV BLC B", centerId: CS_B, parentId: OU_HO, path: `/${T}ho/${T}ou-b/`, depth: 1 } });
  const VAI: [string, string[]][] = [
    [V_QL, ["bao-luu:approve", "bao-luu:extend", "bao-luu:center-pause", "bao-luu:refund-request"]],
    [V_GV, ["bao-luu:view"]],
    [V_DUYET, ["bao-luu:approve"]],
    [V_GIAHAN, ["bao-luu:extend"]],
    [V_TDL, ["bao-luu:center-pause"]],
    [V_SALE, ["bao-luu:create"]],
  ];
  for (const [v, acts] of VAI) {
    await db.roleDef.create({ data: { id: v, code: v, name: v } });
    for (const a of acts) await db.rolePermission.create({ data: { roleId: v, action: a, scopeType: "GLOBAL" } });
  }
  for (const [k, n] of Object.entries(NG)) {
    await db.user.create({ data: { id: id(k), name: k, email: `${id(k)}@x.vn`, role: n.role, roles: [n.role], centerId: n.centerId, isActive: n.hoatDong ?? true } });
    if (n.vai && n.neo) await db.userOrgRole.create({ data: { userId: id(k), orgUnitId: n.neo, roleId: n.vai, status: "ACTIVE", grantedById: id(k), effectiveFrom: new Date("2026-01-01T00:00:00Z") } });
  }
}

describe.skipIf(!RUN_DB_TESTS)("[BLC] chuông bảo lưu — người nhận ⊆ người giữ quyền tương ứng (DB thật)", () => {
  afterAll(async () => {
    if (RUN_DB_TESTS) await don();
  });

  it("[BLC-01] chuông 'chờ duyệt': nhận = người giữ `bao-luu:approve` của cơ sở (kể cả neo ở HO), TRỪ người lập; Giáo vụ (vai cũ CENTER_MANAGER) KHÔNG nhận", async () => {
    await dung();
    expect(await baoChoDuyet(HS, id("DUAL"))).toBe(3);
    const nhan = await nhanCua(HS.id);
    expect(nhan).toEqual([id("QL"), id("QL_HO"), id("CHI_DUYET")].sort());
    expect(nhan).toContain(id("QL"));
    expect(nhan).toContain(id("QL_HO")); // leo cây tổ tiên
    expect(nhan).toContain(id("CHI_DUYET"));
    expect(nhan).not.toContain(id("GIAO_VU")); // CA TÁI HIỆN sự cố 12/10
    expect(nhan).not.toContain(id("CHI_VAI_CU")); // chỉ có vai cũ, 0 dòng UserOrgRole
    expect(nhan).not.toContain(id("QL_B")); // cơ sở khác
    expect(nhan).not.toContain(id("QL_TAT")); // tài khoản khoá
    expect(nhan).not.toContain(id("CHI_GIAHAN")); // có extend nhưng không approve
    expect(nhan).not.toContain(id("DUAL")); // người lập
    expect(nhan).not.toContain(id("SALE"));
  });

  it("[BLC-02] LƯỚI: MỌI chuông `bao*` — người nhận ⊆ người giữ đúng quyền chuông đó đòi; không chuông nào tới Giáo vụ / chỉ-vai-cũ / cơ sở khác / tài khoản khoá", async () => {
    await dung();
    const caNhan = async (ten: keyof typeof QUYEN_CHUONG, chay: (hs: HoSoChuong) => Promise<number>) => {
      const hs: HoSoChuong = { ...HS, id: `${T}hs-${ten}` };
      await chay(hs);
      const nhan = await nhanCua(hs.id);
      // "Người giữ quyền" tính ĐỘC LẬP với mã đang kiểm: đọc thẳng bảng vai → quyền, rồi lọc tài khoản đang hoạt động.
      const dongVai = await db.userOrgRole.findMany({
        where: { orgUnitId: { in: [OU, OU_HO] }, role: { permissions: { some: { action: { in: [...QUYEN_CHUONG[ten]] } } } } },
        select: { userId: true },
      });
      const conHd = await db.user.findMany({ where: { id: { in: dongVai.map((r) => r.userId) }, isActive: true }, select: { id: true } });
      const giu = new Set(conHd.map((u) => u.id));
      return { ten, nhan, giu };
    };
    const bell: [keyof typeof QUYEN_CHUONG, (hs: HoSoChuong) => Promise<number>][] = [
      ["choDuyet", (hs) => baoChoDuyet(hs, id("SALE"))],
      ["giaHanChoDuyet", (hs) => baoGiaHanChoDuyet(hs, id("SALE"))],
      ["leoThang", (hs) => baoLeoThang(hs, 3, "2026-10-12")],
      ["chamDut", (hs) => baoChamDut(hs)],
      ["thuHoiKit", (hs) => baoThuHoiKit(hs)],
      ["centerQuaNgay", (hs) => baoCenterQuaNgay(hs, 5, "2026-10-12")],
    ];
    for (const [ten, chay] of bell) {
      const { nhan, giu } = await caNhan(ten, chay);
      expect(nhan.length, `chuông ${ten} phải có người nhận`).toBeGreaterThan(0);
      for (const u of nhan) expect(giu.has(u), `chuông ${ten}: ${u} nhận nhưng KHÔNG giữ ${QUYEN_CHUONG[ten].join("|")}`).toBe(true);
      for (const x of ["GIAO_VU", "CHI_VAI_CU", "QL_B", "QL_TAT"]) expect(nhan, `chuông ${ten} không được tới ${x}`).not.toContain(id(x));
    }
  });

  it("[BLC-03] mỗi chuông đòi ĐÚNG quyền của việc nó nhắc: gia hạn ⇒ `extend`; tạm dừng lớp quá ngày ⇒ `center-pause`; chỉ-duyệt không nhận chuông gia hạn, chỉ-gia-hạn không nhận chuông chờ duyệt", async () => {
    await dung();
    await baoGiaHanChoDuyet({ ...HS, id: `${T}hs-gh` }, id("SALE"));
    const gh = await nhanCua(`${T}hs-gh`);
    expect(gh).toContain(id("CHI_GIAHAN"));
    expect(gh).not.toContain(id("CHI_DUYET"));
    expect(gh).not.toContain(id("CHI_TDL"));
    await baoChoDuyet({ ...HS, id: `${T}hs-cd` }, id("SALE"));
    const cd = await nhanCua(`${T}hs-cd`);
    expect(cd).toContain(id("CHI_DUYET"));
    expect(cd).not.toContain(id("CHI_GIAHAN"));
    await baoCenterQuaNgay({ ...HS, id: `${T}hs-tdl` }, 4, "2026-10-12");
    const tdl = await nhanCua(`${T}hs-tdl`);
    expect(tdl).toContain(id("CHI_TDL"));
    expect(tdl).not.toContain(id("CHI_DUYET"));
  });

  it("[BLC-04] chuông gửi NGƯỜI LẬP (nhắc hạn · quá hạn · kết quả gia hạn) vẫn tới đúng người lập; hồ sơ MẤT người lập ⇒ rơi về người giữ `approve`, KHÔNG rơi về vai cũ", async () => {
    await dung();
    await baoNhacTruocHan({ ...HS, id: `${T}hs-n1` }, 7, "2026-10-19");
    await baoNhacDungHan({ ...HS, id: `${T}hs-n2` }, "2026-10-19");
    await baoQuaHan({ ...HS, id: `${T}hs-n3` }, "2026-10-19");
    await baoGiaHanKetQua({ ...HS, id: `${T}hs-n4` }, true, "2026-10-12", "19/01/2027");
    for (const k of ["n1", "n2", "n3", "n4"]) expect(await nhanCua(`${T}hs-${k}`)).toEqual([id("SALE")]);
    await baoQuaHan({ ...HS, id: `${T}hs-mat`, nguoiLapId: null }, "2026-10-19");
    const mat = await nhanCua(`${T}hs-mat`);
    expect(mat).toContain(id("QL"));
    expect(mat).not.toContain(id("GIAO_VU"));
    expect(mat).not.toContain(id("CHI_VAI_CU"));
    expect(mat).not.toContain(id("SALE"));
  });
});
