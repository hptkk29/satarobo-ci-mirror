// Ca [HDE-*] — GỬI HOÁ ĐƠN ĐIỆN TỬ CHO KHÁCH trên Postgres THẬT (docs/ke-toan-hoa-don/PLAN.md §7).
//
//   chốt (tx) ─► HoaDonGuiEmail CHO + sự kiện `hoa-don.gui` │ không email ⇒ `hoa-don.khong-email`
//   handler   ─► giành CHO→DANG_GUI + xếp EmailQueue trong MỘT transaction (xếp lỗi ⇒ cả hai lùi)
//   worker    ─► đọc LẠI hoá đơn: chỉ bản DA_XAC_NHAN mới gửi; đính kèm URL ký; khoá chống gửi đôi
//   đối soát  ─► lượt còn CHO quá 10 phút ⇒ xếp lại
//
// Ký URL tệp (R2) được giả — DB test không có kho; thứ cần đo là LUẬT đọc lại hoá đơn, không phải S3.
// Bộ này KHÔNG gọi `resetDb()` và KHÔNG chạy `processEmailQueue` (nó quét MỌI dòng hàng đợi của DB
// dùng chung) — nhánh worker đo ở `lib/email/queue.hoa-don.test.ts` bằng mock.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  kyUrlTaiVeHoaDon: async (khoa: string, ten: string, ttl: number) => `https://r2.test/${khoa}?ten=${encodeURIComponent(ten)}&ttl=${ttl}`,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import {
  baoGuiLoi,
  baoKhongEmail,
  doiSoatGuiHoaDon,
  giuLuotGuiHoaDon,
  LoiGuiLai,
  taoLuotGuiLai,
} from "@/lib/finance/hoa-don/gui-email";
import { chuanBiGuiHoaDon, ghiKetQuaGuiHoaDon, NGU_CANH_EMAIL_HOA_DON } from "@/lib/finance/hoa-don/dinh-kem-email";
import { cauLayHangDoi } from "@/lib/email/queue";

if (!RUN_DB_TESTS) console.warn(`[HDE] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hde-";
const CS = `${T}center`;
const DON = `${T}don`;
const HD = `${T}hd`;
const P1 = `${T}p1`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SALE = `${T}sale`;
const NGUOI_LAP = `${T}nguoi-lap`;
const QL = `${T}ql`;
const LEAD = `${T}lead`;
// Quản lý cơ sở theo RBAC v2 — nguồn quyền thật là `UserOrgRole`, không phải `User.roles` / `User.centerId`.
const CS2 = `${T}center-2`;
const OU = `${T}ou`;
const OU2 = `${T}ou-2`;
const QL_VAI = `${T}ql-vai`;
const QL_KHAC = `${T}ql-khac`;
const QL_HET = `${T}ql-het`;
const QL_KHOA = `${T}ql-khoa`;
const NV_VAI_KHAC = `${T}nv-vai-khac`;
/** RoleDef `CENTER_MANAGER` do bộ này tự dựng khi DB chưa seed vai (DB cục bộ) — CI đã seed thì dùng lại. */
const VAI_TU_DUNG = `${T}vai-qlcs`;
/** Một vai KHÁC neo cùng đơn vị — đối chứng cho phép lọc theo mã vai. */
const VAI_KHAC = `${T}vai-khac`;

/** Kế toán của cơ sở giữ đơn (`payments:confirm` neo tại CS) — đúng người cổng action cho qua. */
const KT_CS = {
  userId: KT.id,
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
} as unknown as Actor;

async function don() {
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: DON }, select: { id: true } });
  const gui = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId: { in: hd.map((h) => h.id) } }, select: { id: true } });
  await db.emailQueue.deleteMany({ where: { contextId: { in: gui.map((g) => g.id) } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.domainEvent.deleteMany({
    where: { dedupeKey: { in: gui.flatMap((g) => [`hoa-don.gui:${g.id}`, `hoa-don.gui-loi:${g.id}`]) } },
  });
  await db.staffNotification.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.lead.deleteMany({ where: { id: LEAD } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: [QL, QL_VAI, QL_KHAC, QL_HET, QL_KHOA, NV_VAI_KHAC] } } });
  await db.roleDef.deleteMany({ where: { id: { in: [VAI_TU_DUNG, VAI_KHAC] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU, OU2] } } });
  await db.user.deleteMany({ where: { id: { in: [SALE, NGUOI_LAP, QL, QL_VAI, QL_KHAC, QL_HET, QL_KHOA, NV_VAI_KHAC] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dungFixture(o: { leadCoSale?: boolean; nguoiLap?: boolean } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDE", slug: `${T}co-so`, address: "211 Nguyễn Hữu Thọ" } });
  for (const [id, role] of [
    [SALE, "SALES_CSM"],
    [NGUOI_LAP, "SALES_CSM"],
    [QL, "CENTER_MANAGER"],
  ] as const) {
    await db.user.create({ data: { id, name: id, email: `${id}@test.local`, role, roles: [role], centerId: CS } });
  }
  if (o.leadCoSale) {
    await db.lead.create({ data: { id: LEAD, parentName: "PH HDE", phone: "0999000666", assignedToId: SALE } });
  }
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269926-000301",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH HDE",
      customerPhone: "0999000666",
      totalAmount: 3_000_000,
      centerId: CS,
      leadId: o.leadCoSale ? LEAD : null,
      createdById: o.nguoiLap ? NGUOI_LAP : null,
    },
  });
  await db.payment.create({
    data: {
      id: P1,
      orderId: DON,
      amount: 3_000_000,
      method: "BANK_TRANSFER",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: "RECORDED",
      accountantStatus: "CONFIRMED",
      centerId: CS,
    },
  });
}

/** GĐ 8: email là email HIỆN TẠI của ĐƠN lúc chốt ⇒ đặt `emailNhan` của fixture lên cả ĐƠN lẫn bản chụp. */
const hoaDon = async (o: Partial<{ emailNhan: string | null; guiEmailKhach: boolean; trangThai: "NHAP" | "DA_XAC_NHAN" }> = {}) => {
  await db.order.update({ where: { id: DON }, data: { invoiceEmail: o.emailNhan === undefined ? "ph@example.com" : o.emailNhan } });
  return db.hoaDonDienTu.create({
    data: {
      id: HD,
      orderId: DON,
      centerId: CS,
      trangThai: o.trangThai ?? "NHAP",
      kyHieu: "1C26TSR",
      soHoaDon: "555",
      ngayPhatHanh: new Date("2026-09-20T00:00:00Z"),
      tepPdfKey: `hoa-don/CS1/2026/${DON}/u.pdf`,
      tepPdfTen: "hoa-don-555.pdf",
      nguoiMuaTen: "Nguyễn <b>An</b>",
      phapNhanTen: "Công ty CP Sata Robo",
      emailNhan: o.emailNhan === undefined ? "ph@example.com" : o.emailNhan,
      guiEmailKhach: o.guiEmailKhach ?? true,
      tongTien: 3_000_000,
      taoBoiId: KT.id,
      khoan: { create: [{ paymentId: P1, soTien: 3_000_000 }] },
    },
  });
};

/** Như action thật: phiên bản bản nháp + email hiện tại của đơn đọc ngay trước khi bấm. */
async function chot() {
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: HD }, select: { updatedAt: true } });
  const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
  return chotHoaDon({
    nguoiChot: KT,
    actor: KT_CS,
    orderId: DON,
    hoaDonId: HD,
    now: new Date("2699-09-26T08:00:00Z"),
    phienBan: hd?.updatedAt ?? new Date(0),
    emailDuKien: nguoiMuaChoDon(donHt).email,
  });
}
const luotGui = () => db.hoaDonGuiEmail.findFirstOrThrow({ where: { hoaDonId: HD } });

describe.skipIf(!RUN_DB_TESTS)("[HDE] gửi hoá đơn cho khách — Postgres thật", () => {
  beforeEach(() => dungFixture());
  afterAll(don);

  it("[HDE-01] chốt có email ⇒ lượt CHO + sự kiện `hoa-don.gui` mang ĐÚNG lượt, trong CÙNG lượt chốt", async () => {
    await hoaDon();
    await chot();
    const g = await luotGui();
    expect(g).toMatchObject({ lanGui: 1, toi: "ph@example.com", trangThai: "CHO" });
    const ev = await db.domainEvent.findUniqueOrThrow({ where: { dedupeKey: `hoa-don.gui:${g.id}` } });
    expect(ev.type).toBe("hoa-don.gui");
    expect(ev.payloadJson).toEqual({ guiId: g.id });
  });

  it("[HDE-02] không email ⇒ sự kiện `hoa-don.khong-email`; bỏ tick gửi ⇒ KHÔNG sự kiện nào", async () => {
    await hoaDon({ emailNhan: null });
    await chot();
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.khong-email:${HD}` } })).toBe(1);

    await dungFixture();
    await hoaDon({ emailNhan: null, guiEmailKhach: false });
    await chot();
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.khong-email:${HD}` } })).toBe(0);
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } })).toBe(0);
  });

  it("[HDE-03] handler: giành + xếp hàng NGUYÊN TỬ; chạy lại ⇒ bỏ qua, vẫn MỘT dòng hàng đợi", async () => {
    await hoaDon();
    await chot();
    const g = await luotGui();
    expect(await giuLuotGuiHoaDon(g.id, { hoaDonBat: true })).toBe("da-xep");
    expect(await giuLuotGuiHoaDon(g.id, { hoaDonBat: true })).toBe("bo-qua");

    const sau = await luotGui();
    expect(sau.trangThai).toBe("DANG_GUI");
    const q = await db.emailQueue.findMany({ where: { contextType: NGU_CANH_EMAIL_HOA_DON, contextId: g.id } });
    expect(q).toHaveLength(1);
    expect(q[0]!.id).toBe(sau.emailQueueId);
    expect(q[0]!.toEmail).toBe("ph@example.com");
    // Tên người mua là chữ NGƯỜI GÕ ⇒ phải được escape trong HTML.
    expect(q[0]!.bodyHtml).toContain("Nguyễn &lt;b&gt;An&lt;/b&gt;");
    expect(q[0]!.bodyHtml).not.toContain("<b>An</b>");
  });

  it("[HDE-04] xếp hàng LỖI ⇒ giành chỗ LÙI theo: lượt vẫn CHO, 0 dòng hàng đợi (lượt sau gửi được)", async () => {
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    // Địa chỉ chỉ có khoảng trắng ⇒ `enqueueEmail` trả { ok:false } ⇒ handler NÉM.
    const g = await db.hoaDonGuiEmail.create({ data: { hoaDonId: HD, lanGui: 1, toi: "   ", trangThai: "CHO" } });
    await expect(giuLuotGuiHoaDon(g.id, { hoaDonBat: true })).rejects.toThrow(/Không xếp được/);
    expect((await luotGui()).trangThai).toBe("CHO");
    expect(await db.emailQueue.count({ where: { contextId: g.id } })).toBe(0);
  });

  it("[HDE-05] hoá đơn KHÔNG còn DA_XAC_NHAN lúc handler chạy ⇒ đóng lượt LOI, không xếp hàng", async () => {
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await db.hoaDonGuiEmail.create({ data: { hoaDonId: HD, lanGui: 1, toi: "ph@example.com", trangThai: "CHO" } });
    await db.hoaDonDienTu.update({ where: { id: HD }, data: { trangThai: "THAY_THE", huyLyDo: "Kế toán huỷ để xuất lại", huyBoiId: KT.id, huyLuc: new Date("2699-09-26T09:00:00Z") } });
    expect(await giuLuotGuiHoaDon(g.id, { hoaDonBat: true })).toBe("bo-qua");
    expect((await luotGui()).trangThai).toBe("LOI");
    expect(await db.emailQueue.count({ where: { contextId: g.id } })).toBe(0);
  });

  it("[HDE-06] worker: bản DA_XAC_NHAN ⇒ đính kèm URL ký 300s + khoá chống gửi đôi; bản bị THAY ⇒ CHẶN hẳn", async () => {
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await db.hoaDonGuiEmail.create({ data: { hoaDonId: HD, lanGui: 1, toi: "ph@example.com", trangThai: "DANG_GUI" } });
    const ok = await chuanBiGuiHoaDon(g.id);
    expect(ok).toMatchObject({ ok: true, idempotencyKey: `hoa-don:${g.id}` });
    expect(ok.ok && ok.attachments).toEqual([
      { filename: "hoa-don-555.pdf", path: `https://r2.test/hoa-don/CS1/2026/${DON}/u.pdf?ten=hoa-don-555.pdf&ttl=300` },
    ]);

    await db.hoaDonDienTu.update({ where: { id: HD }, data: { trangThai: "THAY_THE", huyLyDo: "Kế toán huỷ để xuất lại", huyBoiId: KT.id, huyLuc: new Date("2699-09-26T09:00:00Z") } });
    expect(await chuanBiGuiHoaDon(g.id)).toMatchObject({ ok: false, chan: true });
  });

  it("[HDE-07] đối soát: lượt CHO quá 10 phút ⇒ xếp lại; lượt CHO mới ⇒ để yên", async () => {
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await db.hoaDonGuiEmail.create({ data: { hoaDonId: HD, lanGui: 1, toi: "ph@example.com", trangThai: "CHO" } });
    const bayGio = new Date(g.createdAt.getTime() + 5 * 60_000);
    expect(await doiSoatGuiHoaDon(bayGio, { hoaDonBat: true })).toBe(0);
    expect((await luotGui()).trangThai).toBe("CHO");
    expect(await doiSoatGuiHoaDon(new Date(g.createdAt.getTime() + 11 * 60_000), { hoaDonBat: true })).toBeGreaterThanOrEqual(1);
    expect((await luotGui()).trangThai).toBe("DANG_GUI");
  });

  it("[HDE-08] cờ TẮT ⇒ handler 'tat-co': lượt nằm nguyên CHO, 0 dòng hàng đợi; đối chứng BẬT ⇒ xếp", async () => {
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await db.hoaDonGuiEmail.create({ data: { hoaDonId: HD, lanGui: 1, toi: "ph@example.com", trangThai: "CHO" } });
    expect(await giuLuotGuiHoaDon(g.id, { hoaDonBat: false })).toBe("tat-co");
    expect((await luotGui()).trangThai).toBe("CHO");
    expect(await db.emailQueue.count({ where: { contextId: g.id } })).toBe(0);
    expect(await giuLuotGuiHoaDon(g.id, { hoaDonBat: true })).toBe("da-xep");
    expect(await db.emailQueue.count({ where: { contextId: g.id } })).toBe(1);
  });

  it("[HDE-09] cờ TẮT ⇒ đối soát không quét (lượt CHO tồn vẫn CHO); bật lại ⇒ gửi tiếp", async () => {
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await db.hoaDonGuiEmail.create({ data: { hoaDonId: HD, lanGui: 1, toi: "ph@example.com", trangThai: "CHO" } });
    const sau11 = new Date(g.createdAt.getTime() + 11 * 60_000);
    expect(await doiSoatGuiHoaDon(sau11, { hoaDonBat: false })).toBe(0);
    expect((await luotGui()).trangThai).toBe("CHO");
    expect(await doiSoatGuiHoaDon(sau11, { hoaDonBat: true })).toBeGreaterThanOrEqual(1);
    expect((await luotGui()).trangThai).toBe("DANG_GUI");
  });

  it("[HDE-10] câu lấy lô chạy SQL THẬT: TẮT loại đúng dòng hoá đơn, giữ dòng NULL; 30 dòng hoá đơn cũ không bỏ đói dòng thường", async () => {
    // Chỉ ĐỌC qua câu của worker (lọc theo id fixture) — KHÔNG chạy `processEmailQueue` trên DB dùng chung.
    const Q = `${T}q-`;
    const xoa = () => db.emailQueue.deleteMany({ where: { id: { startsWith: Q } } });
    const cu = (i: number) => new Date(Date.UTC(2000, 0, 1, 0, i));
    const hang = (id: string, contextType: string | null, i: number) => ({
      id: `${Q}${id}`,
      toEmail: "fixture@example.invalid",
      subject: "fixture",
      bodyText: "fixture",
      payload: {},
      contextType,
      contextId: contextType ? `${T}ctx-${id}` : null,
      scheduledAt: cu(i),
    });
    const lay = async (guiHoaDon: boolean, ids: string[]) => {
      const cau = cauLayHangDoi(new Date(Date.UTC(2001, 0, 1)), 25, { guiHoaDon });
      const rows = await db.emailQueue.findMany({ ...cau, where: { AND: [cau.where!, { id: { in: ids.map((x) => `${Q}${x}`) } }] }, select: { id: true } });
      return rows.map((r) => r.id.slice(Q.length)).sort();
    };
    await xoa();
    try {
      await db.emailQueue.createMany({ data: [hang("null", null, 1), hang("lead", "Lead", 2), hang("hd", NGU_CANH_EMAIL_HOA_DON, 3)] });
      expect(await lay(false, ["null", "lead", "hd"])).toEqual(["lead", "null"]);
      expect(await lay(true, ["null", "lead", "hd"])).toEqual(["hd", "lead", "null"]);

      // 30 dòng hoá đơn CŨ HƠN + 1 dòng thường mới hơn, lô 25: lấy-rồi-bỏ thì dòng thường không bao giờ tới lượt.
      const ton = Array.from({ length: 30 }, (_, i) => `ton${String(i).padStart(2, "0")}`);
      await db.emailQueue.createMany({ data: [...ton.map((id, i) => hang(id, NGU_CANH_EMAIL_HOA_DON, 10 + i)), hang("thuong", null, 50)] });
      expect(await lay(false, [...ton, "thuong"])).toEqual(["thuong"]);
      expect(await lay(true, [...ton, "thuong"])).toHaveLength(25);
    } finally {
      await xoa();
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDE-K] khách không có email ⇒ báo đúng người gửi Zalo", () => {
  afterAll(don);
  const nguoiNhan = async () =>
    (await db.staffNotification.findMany({ where: { dedupeKey: `hoa-don.khong-email:${HD}` }, select: { userId: true } })).map((n) => n.userId).sort();

  it("[HDE-K1] ưu tiên SALE phụ trách lead (hơn người lập đơn)", async () => {
    await dungFixture({ leadCoSale: true, nguoiLap: true });
    await hoaDon({ trangThai: "DA_XAC_NHAN", emailNhan: null });
    await baoKhongEmail(HD);
    expect(await nguoiNhan()).toEqual([SALE]);
  });

  it("[HDE-K2] không có lead ⇒ người LẬP đơn; không có cả hai ⇒ Quản lý cơ sở", async () => {
    await dungFixture({ nguoiLap: true });
    await hoaDon({ trangThai: "DA_XAC_NHAN", emailNhan: null });
    await baoKhongEmail(HD);
    expect(await nguoiNhan()).toEqual([NGUOI_LAP]);

    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN", emailNhan: null });
    await baoKhongEmail(HD);
    expect(await nguoiNhan()).toEqual([QL]);
  });

  it("[HDE-K3] không có ai nhận ⇒ ghi nhật ký, KHÔNG im lặng", async () => {
    await dungFixture();
    await db.user.delete({ where: { id: QL } });
    await hoaDon({ trangThai: "DA_XAC_NHAN", emailNhan: null });
    expect(await baoKhongEmail(HD)).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: HD, action: "KHONG_CO_NGUOI_NHAN_BAO" } })).toBe(1);
  });

  it("[HDE-K4] QLCS theo RBAC v2 (CHỈ có UserOrgRole tại đơn vị của cơ sở) cũng nhận — HỢP với tập cũ, không trùng; QLCS cơ sở khác / vai hết hạn / tài khoản khoá / vai khác ⇒ không", async () => {
    await dungFixture();
    const vai =
      (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))?.id ??
      (await db.roleDef.create({ data: { id: VAI_TU_DUNG, code: "CENTER_MANAGER", name: "Quản lý cơ sở (fixture)" }, select: { id: true } })).id;
    await db.roleDef.create({ data: { id: VAI_KHAC, code: `${T}VAI_KHAC`, name: "Vai khác (fixture)" } });
    await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "Đơn vị fixture HDE", centerId: CS } });
    await db.orgUnit.create({ data: { id: OU2, type: "CENTER", code: `${T}OU2`, name: "Đơn vị fixture HDE 2", centerId: CS2 } });
    // `User.roles` KHÔNG có CENTER_MANAGER, `User.centerId` trống — tập cũ không bao giờ thấy những người này.
    for (const id of [QL_VAI, QL_KHAC, QL_HET, QL_KHOA, NV_VAI_KHAC]) {
      await db.user.create({
        data: { id, name: id, email: `${id}@test.local`, role: "TEACHER", roles: ["TEACHER"], isActive: id !== QL_KHOA },
      });
    }
    // Mốc hiệu lực TUYỆT ĐỐI, không để `now()` của DB so với `new Date()` của Node (lệch vài ms là đỏ oan).
    const tu = new Date("2020-01-01T00:00:00Z");
    await db.userOrgRole.createMany({
      data: [
        { userId: QL_VAI, orgUnitId: OU, roleId: vai, grantedById: KT.id, effectiveFrom: tu },
        { userId: QL_KHAC, orgUnitId: OU2, roleId: vai, grantedById: KT.id, effectiveFrom: tu },
        // Mốc tuyệt đối xa trong QUÁ KHỨ — hết hạn bất kể hôm nay là ngày nào.
        { userId: QL_HET, orgUnitId: OU, roleId: vai, grantedById: KT.id, effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2000-12-31T00:00:00Z") },
        { userId: QL_KHOA, orgUnitId: OU, roleId: vai, grantedById: KT.id, effectiveFrom: tu },
        { userId: NV_VAI_KHAC, orgUnitId: OU, roleId: VAI_KHAC, grantedById: KT.id, effectiveFrom: tu },
        // Người của tập CŨ cũng giữ vai tại đơn vị ⇒ vẫn chỉ MỘT thông báo.
        { userId: QL, orgUnitId: OU, roleId: vai, grantedById: KT.id, effectiveFrom: tu },
      ],
    });
    await hoaDon({ trangThai: "DA_XAC_NHAN", emailNhan: null });
    expect(await baoKhongEmail(HD)).toBe(2);
    expect(await nguoiNhan()).toEqual([QL, QL_VAI].sort());
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDE-11/12] GĐ 8 — email hỏng HẲN ⇒ LOI + sự kiện + báo đúng người", () => {
  afterAll(don);
  // Lượt gửi mang id có tiền tố fixture ⇒ khoá sự kiện / thông báo chứa `T` ⇒ `don()` dọn được.
  const luot = (id: string, o: Partial<{ trangThai: "CHO" | "DANG_GUI" | "DA_GUI" | "LOI"; lanGui: number; guiBoiId: string | null }> = {}) =>
    db.hoaDonGuiEmail.create({
      data: {
        id: `${T}g-${id}`,
        hoaDonId: HD,
        lanGui: o.lanGui ?? 1,
        toi: "phuhuynh.hde@example.com",
        trangThai: o.trangThai ?? "DANG_GUI",
        guiBoiId: o.guiBoiId === undefined ? NGUOI_LAP : o.guiBoiId,
      },
    });
  const suKien = (guiId: string) => db.domainEvent.count({ where: { type: "hoa-don.gui-loi", dedupeKey: `hoa-don.gui-loi:${guiId}` } });

  it("[HDE-11] hỏng cuối cùng ⇒ LOI + ĐÚNG MỘT sự kiện; gọi lại ⇒ vẫn một, không ném; chưa cuối / đã gửi ⇒ 0", async () => {
    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await luot("a");
    await ghiKetQuaGuiHoaDon(g.id, { daGui: false, loi: "Resend: hộp thư không tồn tại", cuoiCung: true });
    expect((await db.hoaDonGuiEmail.findUniqueOrThrow({ where: { id: g.id } })).trangThai).toBe("LOI");
    expect(await suKien(g.id)).toBe(1);
    await expect(ghiKetQuaGuiHoaDon(g.id, { daGui: false, loi: "lần hai", cuoiCung: true })).resolves.toBeUndefined();
    expect(await suKien(g.id)).toBe(1);

    const tam = await luot("b", { lanGui: 2 });
    await ghiKetQuaGuiHoaDon(tam.id, { daGui: false, loi: "rate limited", cuoiCung: false });
    expect(await suKien(tam.id)).toBe(0);
    expect((await db.hoaDonGuiEmail.findUniqueOrThrow({ where: { id: tam.id } })).trangThai).toBe("DANG_GUI");
    await ghiKetQuaGuiHoaDon(tam.id, { daGui: true });
    expect(await suKien(tam.id)).toBe(0);
  });

  describe("[HDE-12] baoGuiLoi", () => {
    const bao = (guiId: string) =>
      db.staffNotification.findMany({
        where: { dedupeKey: { startsWith: `hoa-don.gui-loi:${guiId}` } },
        select: { userId: true, dedupeKey: true, href: true, body: true },
        orderBy: { dedupeKey: "asc" },
      });

    it("sale phụ trách lead + kế toán đã bấm gửi ⇒ HAI thông báo, mỗi bên khoá + đường dẫn riêng; không tiền, không SĐT", async () => {
      await dungFixture({ leadCoSale: true });
      await hoaDon({ trangThai: "DA_XAC_NHAN" });
      const g = await luot("c", { trangThai: "LOI" });
      expect(await baoGuiLoi(g.id)).toBe(2);
      const ds = await bao(g.id);
      expect(ds.map(({ userId, dedupeKey, href }) => ({ userId, dedupeKey, href }))).toEqual([
        { userId: SALE, dedupeKey: `hoa-don.gui-loi:${g.id}`, href: `/orders/${DON}#hoa-don` },
        { userId: NGUOI_LAP, dedupeKey: `hoa-don.gui-loi:${g.id}:ke-toan`, href: `/payments/hoa-don?hoaDon=${HD}` },
      ]);
      for (const d of ds) {
        expect(d.body).not.toContain("phuhuynh.hde@example.com");
        expect(d.body).not.toMatch(/0999000666|3\.000\.000/);
      }
    });

    it("hoá đơn đã HUỶ / đã có lượt MỚI hơn / lượt không LOI ⇒ 0, không thông báo", async () => {
      await dungFixture({ leadCoSale: true });
      await hoaDon({ trangThai: "DA_XAC_NHAN" });
      const cu = await luot("d", { trangThai: "LOI" });
      await luot("e", { lanGui: 2, trangThai: "CHO" });
      expect(await baoGuiLoi(cu.id)).toBe(0);
      expect(await bao(cu.id)).toEqual([]);

      await dungFixture({ leadCoSale: true });
      await hoaDon({ trangThai: "DA_XAC_NHAN" });
      const dangGui = await luot("f", { trangThai: "DANG_GUI" });
      expect(await baoGuiLoi(dangGui.id)).toBe(0);

      await dungFixture({ leadCoSale: true });
      await hoaDon({ trangThai: "DA_XAC_NHAN" });
      const g = await luot("g", { trangThai: "LOI" });
      await db.hoaDonDienTu.update({
        where: { id: HD },
        data: { trangThai: "THAY_THE", huyLyDo: "Kế toán huỷ để xuất lại", huyBoiId: KT.id, huyLuc: new Date("2699-09-26T09:00:00Z") },
      });
      expect(await baoGuiLoi(g.id)).toBe(0);
      expect(await bao(g.id)).toEqual([]);
    });

    it("không ai phía sale + kế toán đã nghỉ ⇒ ghi nhật ký, KHÔNG im lặng", async () => {
      await dungFixture();
      await db.user.delete({ where: { id: QL } });
      await db.user.update({ where: { id: NGUOI_LAP }, data: { isActive: false } });
      await hoaDon({ trangThai: "DA_XAC_NHAN" });
      const g = await luot("h", { trangThai: "LOI" });
      expect(await baoGuiLoi(g.id)).toBe(0);
      expect(await db.auditLog.count({ where: { entityId: HD, action: "KHONG_CO_NGUOI_NHAN_BAO" } })).toBe(1);
    });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDE-13..17] GĐ 8 — gửi lại email: lượt MỚI, khoá chống gửi đôi MỚI, cổng trước phép ghi", () => {
  afterAll(don);
  const luot = (id: string, o: Partial<{ trangThai: "CHO" | "DANG_GUI" | "DA_GUI" | "LOI"; lanGui: number; emailQueueId: string | null }> = {}) =>
    db.hoaDonGuiEmail.create({
      data: {
        id: `${T}g-${id}`,
        hoaDonId: HD,
        lanGui: o.lanGui ?? 1,
        toi: "ph@example.com",
        trangThai: o.trangThai ?? "DA_GUI",
        emailQueueId: o.emailQueueId ?? null,
      },
    });
  const hangDoi = (guiId: string, status: "PENDING" | "FAILED" | "SENT") =>
    db.emailQueue.create({
      data: {
        id: `${T}q-${guiId}`,
        toEmail: "ph@example.com",
        subject: "fixture",
        bodyText: "fixture",
        payload: {},
        status,
        contextType: NGU_CANH_EMAIL_HOA_DON,
        contextId: guiId,
        // Tương lai xa — không worker nào của DB dùng chung lỡ nhặt lên.
        scheduledAt: new Date("2699-12-31T00:00:00Z"),
      },
    });
  const gui = (o: Partial<Parameters<typeof taoLuotGuiLai>[0]> = {}) =>
    taoLuotGuiLai({ nguoiGui: KT, orderId: DON, hoaDonId: HD, toi: "ph@example.com", nguon: "HOA_DON", ...o });
  const soLuot = () => db.hoaDonGuiEmail.count({ where: { hoaDonId: HD } });
  const soAudit = () => db.auditLog.count({ where: { entityId: HD, action: "GUI_LAI_EMAIL_HOA_DON" } });
  const maLoi = async (p: Promise<unknown>) => {
    try {
      await p;
      return "KHONG_NEM";
    } catch (e) {
      return e instanceof LoiGuiLai ? e.ma : `LA:${String(e)}`;
    }
  };

  it("[HDE-13] lượt trước ĐÃ GỬI ⇒ lượt 2 CHO + sự kiện + nhật ký; handler xếp được; khoá chống gửi đôi MỚI; emailNhan giữ nguyên", async () => {
    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const cu = await luot("cu");
    const kq = await gui();
    expect(kq.lanGui).toBe(2);
    const moi = await db.hoaDonGuiEmail.findUniqueOrThrow({ where: { id: kq.guiId } });
    expect(moi).toMatchObject({ lanGui: 2, trangThai: "CHO", toi: "ph@example.com", guiBoiId: KT.id });
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.gui:${kq.guiId}` } })).toBe(1);
    expect(await soAudit()).toBe(1);

    expect(await giuLuotGuiHoaDon(kq.guiId, { hoaDonBat: true })).toBe("da-xep");
    const cb = await chuanBiGuiHoaDon(kq.guiId);
    expect(cb).toMatchObject({ ok: true, idempotencyKey: `hoa-don:${kq.guiId}` });
    expect(cb.ok && cb.idempotencyKey).not.toBe(`hoa-don:${cu.id}`);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).emailNhan).toBe("ph@example.com");
  });

  it("[HDE-14] lượt mới nhất còn CHO ⇒ DANG_GUI, KHÔNG ghi gì", async () => {
    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    await luot("cho", { trangThai: "CHO" });
    expect(await maLoi(gui())).toBe("DANG_GUI");
    expect(await soLuot()).toBe(1);
    expect(await soAudit()).toBe(0);
  });

  it("[HDE-15] DANG_GUI + hàng đợi PENDING ⇒ chặn; DANG_GUI + hàng đợi FAILED ⇒ cho gửi lại", async () => {
    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    const g = await luot("dg", { trangThai: "DANG_GUI" });
    await hangDoi(g.id, "PENDING");
    await db.hoaDonGuiEmail.update({ where: { id: g.id }, data: { emailQueueId: `${T}q-${g.id}` } });
    expect(await maLoi(gui())).toBe("DANG_GUI");
    expect(await soLuot()).toBe(1);

    await db.emailQueue.update({ where: { id: `${T}q-${g.id}` }, data: { status: "FAILED" } });
    expect((await gui()).lanGui).toBe(2);
  });

  it("[HDE-16] hoá đơn NHÁP / ĐÃ HUỶ / KHÔNG XUẤT ⇒ DA_DOI, 0 ghi; đối chứng ĐÃ XÁC NHẬN ⇒ qua", async () => {
    for (const trangThai of ["NHAP", "KHONG_XUAT"] as const) {
      await dungFixture();
      await hoaDon({ trangThai: trangThai === "NHAP" ? "NHAP" : "DA_XAC_NHAN" });
      if (trangThai === "KHONG_XUAT") await db.hoaDonDienTu.update({ where: { id: HD }, data: { trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" } });
      expect(await maLoi(gui())).toBe("DA_DOI");
      expect(await soLuot()).toBe(0);
    }
    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    await db.hoaDonDienTu.update({
      where: { id: HD },
      data: { trangThai: "THAY_THE", huyLyDo: "Kế toán huỷ để xuất lại", huyBoiId: KT.id, huyLuc: new Date("2699-09-26T09:00:00Z") },
    });
    expect(await maLoi(gui())).toBe("DA_DOI");
    expect(await soAudit()).toBe(0);

    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    expect(await maLoi(gui())).toBe("KHONG_NEM");
  });

  it("[HDE-17] bấm đồng thời ⇒ đúng MỘT lượt mới; email đơn: gửi tới địa chỉ HIỆN TẠI kèm lý do, địa chỉ đổi ⇒ EMAIL_DA_DOI", async () => {
    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    await luot("song-song");
    const kq = await Promise.allSettled([gui(), gui()]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const bi = kq.find((k): k is PromiseRejectedResult => k.status === "rejected")!;
    expect(bi.reason).toBeInstanceOf(LoiGuiLai);
    expect(["DANG_GUI", "DA_CO_NGUOI_GUI"]).toContain((bi.reason as LoiGuiLai).ma);
    expect(await soLuot()).toBe(2);

    await dungFixture();
    await hoaDon({ trangThai: "DA_XAC_NHAN" });
    await luot("don");
    await db.order.update({ where: { id: DON }, data: { invoiceEmail: "ketoan.cty@example.com" } });
    // Địa chỉ của hoá đơn KHÔNG còn là email của đơn — đường HOA_DON vẫn gửi đúng bản chụp.
    expect(await maLoi(gui({ toi: "ketoan.cty@example.com" }))).toBe("DA_DOI");
    expect(await maLoi(gui({ nguon: "DON_HIEN_TAI", toi: "cu@example.com" }))).toBe("EMAIL_DA_DOI");
    expect(await soLuot()).toBe(1);
    const moi = await gui({ nguon: "DON_HIEN_TAI", toi: " KeToan.Cty@example.com " });
    expect((await db.hoaDonGuiEmail.findUniqueOrThrow({ where: { id: moi.guiId } })).toi).toBe("KeToan.Cty@example.com");
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: HD, action: "GUI_LAI_EMAIL_HOA_DON" } });
    expect(nk.reason).toMatch(/HIỆN TẠI của đơn/);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).emailNhan).toBe("ph@example.com");
  });
});
