// @vitest-environment node
/**
 * [ZCG-*] — ĐẶT DANH SÁCH NGƯỜI ĐƯỢC GIAO MỘT NICK, ở TẦNG DB THẬT.
 * Đối tượng đo: `datGiaoNick` (`lib/integrations/zalocrm/giao-nick.ts`).
 *
 * ── VÌ SAO PHẢI LÀ DB THẬT, KHÔNG PHẢI MOCK ──────────────────────────────────────────
 * Ba thứ ở đây chỉ lộ ra khi Postgres chạy thật, và cả ba đều là đường mất quyền:
 *
 *  ① `deleteMany({ sataUserId: { notIn: [...] } })` với mảng RỖNG. Đo 24/09 bằng phép
 *    cấy: Prisma 5.22 dịch `notIn: []` thành điều kiện LUÔN ĐÚNG, nên hôm nay cả hai
 *    cách viết đều xoá hết và `[ZCG-03]` xanh ở cả hai. Ca ấy canh một NGÀY KHÁC: bản
 *    Prisma nào đổi `notIn: []` thành "không khớp gì" thì "gỡ hết" lặng lẽ không gỡ ai.
 *    Mock không thấy được sự khác nhau — chỉ Postgres thật mới trả lời được.
 *  ② Khoá duy nhất `[nickId, sataUserId]`. Cổng chống trùng ở tầng mã phải chặn TRƯỚC,
 *    nếu không Postgres ném `P2002` giữa giao dịch và người dùng đọc một lỗi 500.
 *  ③ `$transaction` + luật "cổng đứng TRƯỚC phép ghi đầu tiên" của repo: từ chối SAU
 *    khi đã xoá là gỡ sạch quyền rồi báo "không làm được" — đúng lớp lỗi mà
 *    `lib/finance/cong-truoc-phep-ghi.test.ts` sinh ra để canh, nhưng file này không
 *    nằm trong vùng quét của lưới ấy nên phải tự đo.
 *
 * ⚠️ Bộ này TỰ SKIP khi không có Postgres local. Thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ,
 * không phải "xanh". KHÔNG `resetDb()` — dọn theo TIỀN TỐ riêng (`tests/inbox` chạy
 * tuần tự chung một DB với các file khác).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn(`[zalocrm-giao-nick] SKIP: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();

/** Bảng chưa có ⇒ SKIP kèm câu chỉ việc, đừng đổ một đống `P2021`. */
const CO_BANG =
  RUN &&
  (await db.zaloCrmNickGiao
    .count()
    .then(() => true)
    .catch(() => {
      console.warn(
        "[zalocrm-giao-nick] SKIP: chưa có bảng ZaloCrmNickGiao. Chạy `prisma migrate " +
          "deploy` trên DB test trước (migration zalocrm_giao_nick_nhieu_nguoi).",
      );
      return false;
    }));

/** Tiền tố RIÊNG — dùng lại `ZCRM_`/`ZCNA_`/`ZCCQ_` là bốn tệp dọn dữ liệu của nhau. */
const P = "ZCGN_";
const ORG = `${P}org1`;
const MA_CS = `${P}cs1`;
const MA_CS_KHAC = `${P}cs2`;
const NICK = `${P}acc-1`;

const nguoi = {
  loc: "",
  dieu: "",
  trang: "", // quản lý cơ sở
  ngoai: "", // sale của CƠ SỞ KHÁC
  ha: "", // GIÁO VIÊN của cơ sở — thêm tay được, không mặc định
  ph: "", // PHỤ HUYNH neo nhầm vào đơn vị — không bao giờ thêm được
};
let idCoSo = "";
let idCoSoKhac = "";

async function purge() {
  const dv = await db.orgUnit.findMany({
    where: { code: { startsWith: P } },
    select: { id: true },
  });
  if (dv.length) {
    await db.userOrgRole.deleteMany({ where: { orgUnitId: { in: dv.map((d) => d.id) } } });
  }
  // `ZaloCrmNickGiao` cascade theo cả nick lẫn user, nhưng xoá tường minh cho chắc:
  // một dòng sót lại làm ca sau đọc trạng thái của ca trước (luật 18).
  const nicks = await db.zaloCrmNick.findMany({
    where: { orgCode: { startsWith: P } },
    select: { id: true },
  });
  if (nicks.length) {
    await db.zaloCrmNickGiao.deleteMany({ where: { nickId: { in: nicks.map((n) => n.id) } } });
  }
  await db.zaloCrmNick.deleteMany({ where: { orgCode: { startsWith: P } } });
  await db.user.deleteMany({ where: { name: { startsWith: P } } });
  await db.orgUnit.deleteMany({ where: { code: { startsWith: P } } });
  await db.center.deleteMany({ where: { code: { startsWith: P } } });
}

beforeAll(async () => {
  if (!CO_BANG) return;
  await purge();

  // `OrgUnit.code` khớp `Center.code` — cầu nối chuẩn của repo (`lib/org/center-bridge.ts`).
  const coSoMau = (ma: string) => ({
    code: ma,
    slug: ma.toLowerCase(),
    name: `${P} ${ma}`,
    address: "—",
  });
  const cs = await db.center.create({ data: coSoMau(MA_CS) });
  const csKhac = await db.center.create({ data: coSoMau(MA_CS_KHAC) });
  idCoSo = cs.id;
  idCoSoKhac = csKhac.id;
  const dv = await db.orgUnit.create({
    data: { code: MA_CS, name: `${P} ĐV 1`, type: "CENTER", path: `/${P}cs1/` },
  });
  const dvKhac = await db.orgUnit.create({
    data: { code: MA_CS_KHAC, name: `${P} ĐV 2`, type: "CENTER", path: `/${P}cs2/` },
  });

  // Vai phải là vai THẬT trong `RoleDef`: `nguoiDuocDungNick` lọc theo `role.code`, nên
  // một dòng vai bịa ra sẽ bị loại và mọi ca dưới xanh vì lý do sai.
  const vaiSale = await db.roleDef.findFirst({ where: { code: "CENTER_SALES_CSM" } });
  const vaiQL = await db.roleDef.findFirst({ where: { code: "CENTER_MANAGER" } });
  // Giáo viên: nhân sự của cơ sở, vai NGOÀI `VAI_DUOC_CAP_NICK`. Từ 24/09 thêm tay được.
  const vaiGV = await db.roleDef.findFirst({ where: { code: "TEACHER" } });
  const vaiPH = await db.roleDef.findFirst({ where: { code: "PARENT" } });
  if (!vaiSale || !vaiQL || !vaiGV || !vaiPH) {
    throw new Error("Chưa seed RoleDef — chạy `tsx prisma/seed-roles.ts`");
  }

  // `UserOrgRole.grantedById` là NOT NULL — mọi lượt cấp vai phải chỉ ra AI cấp. Dựng
  // một tài khoản "người cấp" thay vì nhặt bừa một `User` có sẵn: bộ này chỉ được sở hữu
  // dữ liệu mang tiền tố của mình (`tests/inbox` chạy chung một DB).
  const nguoiCap = await db.user.create({
    data: { name: `${P}capvai`, email: `${P}capvai@vd.test`.toLowerCase(), role: "SUPER_ADMIN" },
  });

  // 🔴 `vaiV1` BẮT BUỘC, không mặc định. `vaiZaloCrm` gộp CẢ HAI hệ tên vai (v1
  // `User.role` ở local/dev, v2 `UserOrgRole.role.code` trên prod), nên một fixture cho
  // mọi người `role: "SALES_CSM"` biến giáo viên thành người "mở được ZaloCRM" và ca
  // `[ZCG-12]` xanh vì lý do sai. Fixture phải mang hình dạng dữ liệu THẬT.
  async function taoNguoi(
    nhan: string,
    roleId: string,
    orgUnitId: string,
    vaiV1: "SALES_CSM" | "CENTER_MANAGER" | "TEACHER" | "PARENT",
  ) {
    const u = await db.user.create({
      data: {
        name: `${P}${nhan}`,
        email: `${P}${nhan}@vd.test`.toLowerCase(),
        role: vaiV1,
        isActive: true,
      },
    });
    await db.userOrgRole.create({
      data: {
        userId: u.id,
        orgUnitId,
        roleId,
        status: "ACTIVE",
        effectiveFrom: new Date(0),
        grantedById: nguoiCap.id,
      },
    });
    return u.id;
  }

  nguoi.loc = await taoNguoi("loc", vaiSale.id, dv.id, "SALES_CSM");
  nguoi.dieu = await taoNguoi("dieu", vaiSale.id, dv.id, "SALES_CSM");
  nguoi.trang = await taoNguoi("trang", vaiQL.id, dv.id, "CENTER_MANAGER");
  nguoi.ngoai = await taoNguoi("ngoai", vaiSale.id, dvKhac.id, "SALES_CSM");
  nguoi.ha = await taoNguoi("ha", vaiGV.id, dv.id, "TEACHER");
  // 🔴 Phụ huynh neo NHẦM vào đơn vị. Trên prod chuyện này không xảy ra (phụ huynh không
  // có dòng `UserOrgRole` nào), nên đây là ca dựng RIÊNG để đo hàng rào thứ hai
  // `VAI_KHONG_THEM_DUOC_VAO_NICK` — thứ mà dữ liệu thật không bao giờ chạm tới.
  nguoi.ph = await taoNguoi("ph", vaiPH.id, dv.id, "PARENT");
});

beforeEach(async () => {
  if (!CO_BANG) return;
  const cu = await db.zaloCrmNick.findUnique({ where: { zcrmAccountId: NICK } });
  if (cu) {
    await db.zaloCrmNickGiao.deleteMany({ where: { nickId: cu.id } });
    await db.zaloCrmNick.delete({ where: { id: cu.id } });
  }
  await db.zaloCrmNick.create({
    data: { zcrmAccountId: NICK, orgCode: ORG, centerId: idCoSo, displayName: `${P} Nick` },
  });
});

afterAll(async () => {
  if (CO_BANG) await purge();
  await db.$disconnect();
});

const QLCS = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [] as string[] };
function actorThay(...ids: string[]) {
  return { ...QLCS, visibleCenterIds: ids };
}

/** Dòng giao đang lưu của nick, đã sắp theo `sataUserId` để so ổn định. */
async function dangLuu() {
  const n = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
  const ds = await db.zaloCrmNickGiao.findMany({
    where: { nickId: n.id },
    select: { sataUserId: true, mucQuyen: true },
  });
  return ds.sort((a, b) => a.sataUserId.localeCompare(b.sataUserId));
}

describe.skipIf(!CO_BANG)("datGiaoNick — đặt CẢ TẬP", () => {
  it("[ZCG-01] giao nhiều người, mỗi người một mức", async () => {
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const kq = await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [
        { sataUserId: nguoi.loc, mucQuyen: "chat" },
        { sataUserId: nguoi.dieu, mucQuyen: "read" },
      ],
    });
    expect(kq).toEqual({ ok: true, soDong: 2 });

    const luu = await dangLuu();
    expect(luu).toHaveLength(2);
    expect(luu.find((d) => d.sataUserId === nguoi.loc)?.mucQuyen).toBe("chat");
    expect(luu.find((d) => d.sataUserId === nguoi.dieu)?.mucQuyen).toBe("read");
  });

  it("[ZCG-02] lượt sau THAY cả tập — người bị bỏ ra sẽ bị GỠ", async () => {
    // Vế GỠ là vế không ai nhớ bấm và hỏng thì KHÔNG có triệu chứng: người không còn
    // phận sự vẫn đọc chat của khách. Đây là ca chính của cả tính năng.
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [
        { sataUserId: nguoi.loc, mucQuyen: "chat" },
        { sataUserId: nguoi.dieu, mucQuyen: "chat" },
      ],
    });
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "admin" }],
    });

    const luu = await dangLuu();
    expect(luu.map((d) => d.sataUserId)).toEqual([nguoi.loc]);
    // ĐỐI CHỨNG ÂM — và mức của người còn lại phải ĐỔI THEO, không giữ giá trị cũ.
    expect(luu[0]?.mucQuyen).toBe("admin");
  });

  it("[ZCG-03] mảng RỖNG ⇒ gỡ hết, nick về 'cả cơ sở dùng chung'", async () => {
    // ⚠️ Ca này KHÔNG chứng minh nhánh `if (idGui.length)` trong `datGiaoNick` đang
    // gánh việc: đo 24/09 bằng phép cấy, bỏ nhánh ấy đi thì ca này VẪN XANH, vì Prisma
    // 5.22 coi `notIn: []` là điều kiện luôn đúng. Nó canh HÀNH VI ("gỡ hết là gỡ
    // thật"), và hành vi ấy hôm nay có hai đường cùng cho kết quả đúng.
    // Ngày nào một trong hai đường đổi, ca này đỏ — và điều ĐÓ thì đã đo: cấy
    // `{ sataUserId: { in: [] } }` (khớp 0 dòng) cho nhánh rỗng ⇒ đúng ca này đỏ.
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });
    expect(await dangLuu()).toHaveLength(1);

    const kq = await datGiaoNick({ actor: actorThay(idCoSo), zcrmAccountId: NICK, giao: [] });
    expect(kq).toEqual({ ok: true, soDong: 0 });
    expect(await dangLuu(), "gỡ hết mà dòng vẫn còn").toEqual([]);
  });

  it("[ZCG-04] dòng không đổi GIỮ NGUYÊN `createdAt` — không xoá-rồi-tạo", async () => {
    // Xoá sạch rồi tạo lại để một khoảng TRONG giao dịch mà nick không có ai, và làm
    // mất mốc "giao từ bao giờ" — thứ duy nhất trả lời được "ai giữ nick này từ khi nào".
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });
    const n = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    const truoc = await db.zaloCrmNickGiao.findFirstOrThrow({
      where: { nickId: n.id, sataUserId: nguoi.loc },
    });

    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [
        { sataUserId: nguoi.loc, mucQuyen: "admin" },
        { sataUserId: nguoi.dieu, mucQuyen: "chat" },
      ],
    });
    const sau = await db.zaloCrmNickGiao.findFirstOrThrow({
      where: { nickId: n.id, sataUserId: nguoi.loc },
    });
    expect(sau.id, "dòng bị tạo lại ⇒ mất mốc giao").toBe(truoc.id);
    expect(sau.createdAt.getTime()).toBe(truoc.createdAt.getTime());
    expect(sau.mucQuyen).toBe("admin");
  });
});

describe.skipIf(!CO_BANG)("cổng — và chúng phải đứng TRƯỚC phép ghi", () => {
  it("[ZCG-05] người của CƠ SỞ KHÁC ⇒ từ chối, và KHÔNG ghi gì", async () => {
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });

    // Danh sách có MỘT người hợp lệ + MỘT người ngoài cơ sở. Lọc bớt người sai rồi ghi
    // phần còn lại là im lặng làm một việc KHÁC việc người dùng bấm.
    const kq = await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [
        { sataUserId: nguoi.dieu, mucQuyen: "chat" },
        { sataUserId: nguoi.ngoai, mucQuyen: "admin" },
      ],
    });
    expect(kq).toEqual({ ok: false, ma: "NGUOI_NGOAI_CO_SO" });

    // 🔴 VẾ QUAN TRỌNG: trạng thái CŨ còn nguyên. Từ chối sau khi đã `deleteMany` là gỡ
    // sạch quyền rồi báo "không làm được" — luật rollback của repo.
    expect(await dangLuu()).toEqual([{ sataUserId: nguoi.loc, mucQuyen: "chat" }]);
  });

  it("[ZCG-06] nick NGOÀI TẦM NHÌN ⇒ từ chối, và KHÔNG ghi gì", async () => {
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });

    const kq = await datGiaoNick({
      // Quản lý CƠ SỞ KHÁC — `zcrmAccountId` đến từ trình duyệt nên không được tin.
      actor: actorThay(idCoSoKhac),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.dieu, mucQuyen: "admin" }],
    });
    expect(kq).toEqual({ ok: false, ma: "NICK_NGOAI_TAM_NHIN" });
    expect(await dangLuu()).toEqual([{ sataUserId: nguoi.loc, mucQuyen: "chat" }]);
  });

  it("[ZCG-07] TRÙNG người trong một lượt ⇒ từ chối ở tầng mã, không để P2002 nổ", async () => {
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const kq = await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [
        { sataUserId: nguoi.loc, mucQuyen: "read" },
        { sataUserId: nguoi.loc, mucQuyen: "admin" },
      ],
    });
    expect(kq).toEqual({ ok: false, ma: "TRUNG_NGUOI" });
    expect(await dangLuu()).toEqual([]);
  });

  it("[ZCG-08] nick CHƯA GẮN CƠ SỞ ⇒ mã lỗi đúng nguyên nhân", async () => {
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const moCoi = `${P}acc-mo-coi`;
    await db.zaloCrmNick.create({
      data: { zcrmAccountId: moCoi, orgCode: ORG, centerId: null, displayName: `${P} mồ côi` },
    });
    const kq = await datGiaoNick({
      // Nick `centerId = null` nằm trong tầm nhìn của mọi actor (nhóm "chưa ánh xạ").
      actor: actorThay(idCoSo),
      zcrmAccountId: moCoi,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });
    expect(kq).toEqual({ ok: false, ma: "NICK_CHUA_CO_CO_SO" });
  });

  it("[ZCG-09] nick không tồn tại ⇒ từ chối, không tạo hộ", async () => {
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const kq = await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: `${P}khong-co`,
      giao: [],
    });
    expect(kq).toEqual({ ok: false, ma: "KHONG_THAY_NICK" });
  });
});

describe.skipIf(!CO_BANG)("cột cũ `ZaloCrmNick.sataUserId` — pha A của 2 pha", () => {
  it("[ZCG-10] một người ⇒ giữ id đó; nhiều hơn một ⇒ NULL", async () => {
    // Cột này KHÔNG còn đường nào đọc. Nó chỉ có nghĩa nếu ai đó lùi mã về bản trước
    // 24/09 — và lúc ấy "nhiều người" không diễn tả được, nên `null` ("cả cơ sở") là
    // cách nới rộng KHÔNG bỏ sót ai, còn giữ một cái tên cũ thì cắt mất những người kia.
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const doc = async () =>
      (await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } })).sataUserId;

    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });
    expect(await doc()).toBe(nguoi.loc);

    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [
        { sataUserId: nguoi.loc, mucQuyen: "chat" },
        { sataUserId: nguoi.dieu, mucQuyen: "chat" },
      ],
    });
    expect(await doc()).toBeNull();

    await datGiaoNick({ actor: actorThay(idCoSo), zcrmAccountId: NICK, giao: [] });
    expect(await doc()).toBeNull();
  });
});

describe.skipIf(!CO_BANG)("nguoiNhanDuocNick — ô chọn nhìn CÙNG sự thật với lượt đối soát", () => {
  it("[ZCG-11] trả đúng người của cơ sở, và đánh dấu QUẢN LÝ", async () => {
    // `laQuanLy` là thứ màn dùng để KHÔNG hứa một nút không tồn tại: quản lý cơ sở có
    // `admin` tự động nên không gỡ ở đó được (luật 12 — affordance).
    const { nguoiNhanDuocNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const ds = await nguoiNhanDuocNick(MA_CS);
    const theoId = new Map(ds.map((n) => [n.id, n]));

    // 24/09 (lượt sau): ô chọn nay là MỌI NHÂN SỰ của cơ sở — giáo viên CÓ mặt.
    expect([...theoId.keys()].sort()).toEqual(
      [nguoi.loc, nguoi.dieu, nguoi.trang, nguoi.ha].sort(),
    );
    expect(theoId.get(nguoi.trang)?.laQuanLy, "Trang giữ CENTER_MANAGER").toBe(true);
    // ĐỐI CHỨNG ÂM — sale KHÔNG được đánh dấu quản lý, nếu không màn khoá nhầm mọi dòng.
    expect(theoId.get(nguoi.loc)?.laQuanLy).toBe(false);
    expect(theoId.has(nguoi.ngoai), "người cơ sở khác lọt vào ô chọn").toBe(false);
    // 🔴 Phụ huynh là KHÁCH HÀNG. Neo nhầm vào đơn vị vẫn KHÔNG được lọt.
    expect(theoId.has(nguoi.ph), "phụ huynh lọt vào ô chọn nick Zalo").toBe(false);
  });

  it("[ZCG-12] màn NÓI THẬT ai chưa mở được ZaloCRM", () => {
    // Giáo viên thêm tay được, nhưng vai của họ không có vé SSO sang ZaloCRM ⇒ dòng giao
    // chưa có tác dụng. Cờ này là thứ màn dùng để nói ra, thay vì để người dùng bấm xong
    // rồi tự hỏi vì sao không có gì xảy ra (luật 12).
    return import("@/lib/integrations/zalocrm/giao-nick").then(async ({ nguoiNhanDuocNick }) => {
      const theoId = new Map((await nguoiNhanDuocNick(MA_CS)).map((n) => [n.id, n]));
      expect(theoId.get(nguoi.ha)?.dungDuocZalocrm, "giáo viên KHÔNG mở được ZaloCRM").toBe(
        false,
      );
      // ĐỐI CHỨNG DƯƠNG — thiếu vế này thì một hàm luôn trả `false` vẫn xanh.
      expect(theoId.get(nguoi.loc)?.dungDuocZalocrm, "tư vấn viên PHẢI mở được").toBe(true);
      expect(theoId.get(nguoi.trang)?.dungDuocZalocrm, "quản lý cơ sở PHẢI mở được").toBe(true);
    });
  });

  it("[ZCG-13] giáo viên GIAO TAY được — cổng KHÔNG từ chối", () => {
    // Trước 24/09 (lượt sau) ca này trả `NGUOI_NGOAI_CO_SO`: cổng hỏi `tatCa` mà `tatCa`
    // lúc ấy chỉ gồm tư vấn viên + quản lý.
    return import("@/lib/integrations/zalocrm/giao-nick").then(async ({ datGiaoNick }) => {
      const kq = await datGiaoNick({
        actor: actorThay(idCoSo),
        zcrmAccountId: NICK,
        giao: [{ sataUserId: nguoi.ha, mucQuyen: "read" }],
      });
      expect(kq).toEqual({ ok: true, soDong: 1 });
      expect(await dangLuu()).toEqual([{ sataUserId: nguoi.ha, mucQuyen: "read" }]);
    });
  });

  it("[ZCG-14] phụ huynh KHÔNG giao tay được, dù neo đúng đơn vị", () => {
    return import("@/lib/integrations/zalocrm/giao-nick").then(async ({ datGiaoNick }) => {
      const kq = await datGiaoNick({
        actor: actorThay(idCoSo),
        zcrmAccountId: NICK,
        giao: [{ sataUserId: nguoi.ph, mucQuyen: "read" }],
      });
      expect(kq).toEqual({ ok: false, ma: "NGUOI_NGOAI_CO_SO" });
      expect(await dangLuu(), "phụ huynh đọc được chat của khách khác").toEqual([]);
    });
  });
});

describe.skipIf(!CO_BANG)("quản lý cơ sở — KHÔNG còn quyền tự động (đảo 24/09)", () => {
  it("[ZCG-15] nick ĐÃ giao mà quản lý không có tên ⇒ quản lý KHÔNG có quyền", async () => {
    // Chủ dự án chốt: *"quản lý phân quyền của QLCS ở đây luôn"*. Hệ quả có thật và đã
    // được cân nhắc — gỡ quản lý khỏi một nick là họ mất tầm nhìn nick đó.
    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    const { nguoiDuocDungMotNick } = await import("@/lib/integrations/zalocrm/pham-vi-nick");
    const { nguoiDuocDungNick } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");

    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });

    const { tatCa, macDinh } = await nguoiDuocDungNick(MA_CS);
    const ra = nguoiDuocDungMotNick({
      giaoTay: (await dangLuu()).map((g) => ({
        sataUserId: g.sataUserId,
        mucQuyen: g.mucQuyen as "read" | "chat" | "admin",
      })),
      nguoiCuaCoSo: tatCa,
      macDinhDungDuoc: macDinh,
    });
    expect(ra.map((x) => x.sataUserId)).toEqual([nguoi.loc]);
    expect(ra.map((x) => x.sataUserId), "nhánh admin-tự-động quay lại").not.toContain(
      nguoi.trang,
    );
  });

  it("[ZCG-16] migration cutover thêm đúng quản lý cho nick ĐÃ giao — và KHÔNG chạm nick chưa giao", async () => {
    // 🔴 Chạy CHÍNH TỆP migration, không phải một bản chép. Thứ dễ sai nhất trong đó là
    // chuỗi join `Center.code = OrgUnit.code`: sai một mắt thì câu INSERT chạy êm, thêm
    // 0 dòng, và lượt triển khai vẫn âm thầm cắt quyền của quản lý cơ sở — đúng thứ
    // migration ấy sinh ra để chặn. Không ca nào khác chạm tới nó.
    //
    // `$executeRawUnsafe` ở đây là cố ý và an toàn: đầu vào là một TỆP TĨNH trong repo,
    // không có dữ liệu người dùng. Lệnh cấm trong CLAUDE.md nhắm đường app nhận đầu vào
    // từ ngoài; `tests/e2e/_helpers/seed.ts` và `lib/finance/*.test.ts` đã dùng lối này.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260924160000_zalocrm_giao_nick_quan_ly_tuong_minh/migration.sql",
      ),
      "utf8",
    );

    const { datGiaoNick } = await import("@/lib/integrations/zalocrm/giao-nick");
    // Nick A: ĐÃ giao cho Lộc. Nick B: chưa giao ai.
    await datGiaoNick({
      actor: actorThay(idCoSo),
      zcrmAccountId: NICK,
      giao: [{ sataUserId: nguoi.loc, mucQuyen: "chat" }],
    });
    const nickB = `${P}acc-chua-giao`;
    await db.zaloCrmNick.deleteMany({ where: { zcrmAccountId: nickB } });
    await db.zaloCrmNick.create({
      data: { zcrmAccountId: nickB, orgCode: ORG, centerId: idCoSo, displayName: `${P} B` },
    });

    await db.$executeRawUnsafe(sql);

    const a = await dangLuu();
    expect(
      a.map((g) => g.sataUserId).sort(),
      "migration KHÔNG thêm được quản lý — chuỗi join hỏng",
    ).toEqual([nguoi.loc, nguoi.trang].sort());
    expect(a.find((g) => g.sataUserId === nguoi.trang)?.mucQuyen).toBe("admin");

    // ĐỐI CHỨNG ÂM — nick CHƯA giao ai phải còn nguyên rỗng. Thêm dòng vào đó là biến
    // "cả cơ sở dùng chung" thành "chỉ quản lý", tức CẮT quyền của tư vấn viên.
    const b = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: nickB } });
    expect(
      await db.zaloCrmNickGiao.count({ where: { nickId: b.id } }),
      "migration chạm cả nick chưa giao",
    ).toBe(0);

    // Chạy LẠI không đẻ dòng trùng — migration phải lặp lại được (ON CONFLICT DO NOTHING).
    await db.$executeRawUnsafe(sql);
    expect((await dangLuu()).length).toBe(2);

    await db.zaloCrmNick.deleteMany({ where: { zcrmAccountId: nickB } });
  });
});

describe.skipIf(!CO_BANG)("🔴 sự cố prod 24/09 — cột do ĐỒNG BỘ ghi KHÔNG phải một lượt phân công", () => {
  // `dongBoNick` tự ghi `ZaloCrmNick.sataUserId` = chủ nick do ZaloCRM ghi nhận. Đọc nó
  // như "nick đã giao cho ai" là mượn một giá trị MÁY ĐOÁN để cắt quyền người thật:
  // trên prod mỗi nick cắt còn một người, và Cô Diệu (CS1) mở hộp thư ra TRỐNG.

  it("[ZCG-17] `dongBoNick` KHÔNG được ghi `sataUserId`", async () => {
    // Lưới ghim mã nguồn: thứ cần khẳng định là "đường đồng bộ không chạm cột phân
    // công". Không đầu vào nào chứng minh được — `dongBoNick` gọi mạng, và ca hành vi
    // của nó sẽ xanh dù cột bị ghi hay không.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "lib/integrations/zalocrm/nick-admin.ts"),
      "utf8",
    );
    const dau = src.indexOf("export async function dongBoNick(");
    expect(dau, "không thấy `dongBoNick` — lưới mất neo").toBeGreaterThan(-1);
    // Bóc chú thích: khối 🔴 ngay trên hàm CÓ nhắc `sataUserId` để kể lại sự cố, và
    // không bóc thì lưới đỏ vì lời kể chứ không vì mã (luật 11).
    const than = src
      .slice(dau)
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/.*$/, ""))
      .join("\n");

    // Hai đường ghi, hai phép đo RIÊNG — neo hẹp vào đúng dạng của từng đường.
    //
    // ⚠️ Bản đầu của ca này dùng `sataUserId:\s*(?!null)[A-Za-z_$]` và ĐỎ NGAY vì bắt
    // trúng dòng `select: { sataUserId: true }` — một phép ĐỌC, hoàn toàn hợp lệ. Lưới
    // grep rộng là lưới báo động giả; luật 11 bảo neo chuỗi HẸP NHẤT.
    const ganUpdate = [...than.matchAll(/data\.sataUserId\s*=/g)].map((m) => m[0]);
    expect(
      ganUpdate,
      `nhánh cập nhật đang ghi cột phân công: ${ganUpdate.join(", ")}`,
    ).toEqual([]);

    // Nhánh tạo mới: phải đặt thẳng `null`, không phải một biến.
    const ganCreate = [...than.matchAll(/sataUserId:\s*(?!null\b|true\b|false\b)\S/g)].map(
      (m) => m[0],
    );
    expect(ganCreate, `nhánh tạo mới đang ghi cột phân công: ${ganCreate.join(", ")}`).toEqual(
      [],
    );
    expect(than, "nhánh tạo mới phải đặt `sataUserId: null` tường minh").toMatch(
      /sataUserId:\s*null/,
    );
    // Đối chứng: lưới còn neo đúng chỗ (bóc chú thích không làm rỗng thân hàm).
    expect(than).toContain("zaloCrmNick.update");
  });

  it("[ZCG-18] migration gỡ ĐÚNG dòng do backfill, KHÔNG đụng dòng người đã sửa", async () => {
    // 🔴 Chạy CHÍNH TỆP migration. Điều kiện quan trọng nhất là "nick chỉ có MỘT dòng
    // giao": gỡ bừa là xoá một quyết định của con người để chữa một lỗi của máy — đúng
    // cái sai mà sự cố này là ví dụ.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260924180000_zalocrm_go_dong_giao_do_dong_bo/migration.sql",
      ),
      "utf8",
    );
    /**
     * Chạy từng câu lệnh một.
     *
     * ⚠️ `$executeRawUnsafe` KHÔNG nhận nhiều câu trong một lượt ("cannot insert multiple
     * commands into a prepared statement") — còn `prisma migrate deploy` thì nhận. Đây là
     * chi tiết của BỘ TEST, không phải của migration: tệp vẫn chạy nguyên khối trên thật.
     */
    const chayMigration = async () => {
      const cau = sql
        .split(/\r?\n/)
        .map((d) => d.replace(/^\s*--.*$/, ""))
        .join("\n")
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      expect(cau.length, "migration phải có đúng hai câu lệnh").toBe(2);
      for (const c of cau) await db.$executeRawUnsafe(c);
    };

    const nickA = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    // ── Nick A: đúng dấu vân tay của backfill (1 dòng, mức `chat`, trùng cột cũ).
    await db.zaloCrmNickGiao.deleteMany({ where: { nickId: nickA.id } });
    await db.zaloCrmNick.update({
      where: { id: nickA.id },
      data: { sataUserId: nguoi.loc },
    });
    await db.zaloCrmNickGiao.create({
      data: { nickId: nickA.id, sataUserId: nguoi.loc, mucQuyen: "chat" },
    });

    // ── Nick B: người vận hành ĐÃ sửa (hai dòng) ⇒ phải còn nguyên.
    const nickB = `${P}acc-da-sua`;
    await db.zaloCrmNick.deleteMany({ where: { zcrmAccountId: nickB } });
    const b = await db.zaloCrmNick.create({
      data: {
        zcrmAccountId: nickB,
        orgCode: ORG,
        centerId: idCoSo,
        displayName: `${P} B`,
        sataUserId: nguoi.loc,
      },
    });
    await db.zaloCrmNickGiao.createMany({
      data: [
        { nickId: b.id, sataUserId: nguoi.loc, mucQuyen: "chat" },
        { nickId: b.id, sataUserId: nguoi.dieu, mucQuyen: "read" },
      ],
    });

    await chayMigration();

    expect(
      await db.zaloCrmNickGiao.count({ where: { nickId: nickA.id } }),
      "dòng do backfill sinh ra vẫn còn ⇒ cả cơ sở vẫn bị cắt",
    ).toBe(0);
    // Và cột cũ được dọn theo — để người sau không đọc nhầm nó lần nữa.
    expect(
      (await db.zaloCrmNick.findUniqueOrThrow({ where: { id: nickA.id } })).sataUserId,
    ).toBeNull();

    // ĐỐI CHỨNG DƯƠNG — thiếu vế này thì một câu `DELETE` trần cũng xanh.
    const conLai = await db.zaloCrmNickGiao.findMany({
      where: { nickId: b.id },
      select: { sataUserId: true, mucQuyen: true },
    });
    expect(
      conLai.map((g) => g.sataUserId).sort(),
      "migration xoá mất quyết định của người vận hành",
    ).toEqual([nguoi.loc, nguoi.dieu].sort());

    // Chạy LẠI không đổi gì thêm.
    await chayMigration();
    expect(await db.zaloCrmNickGiao.count({ where: { nickId: b.id } })).toBe(2);

    await db.zaloCrmNickGiao.deleteMany({ where: { nickId: b.id } });
    await db.zaloCrmNick.deleteMany({ where: { zcrmAccountId: nickB } });
  });
});
