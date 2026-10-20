// tests/cham-cong/thiet-bi.spec.ts — P2.3 THIẾT BỊ CHẤM CÔNG trên Postgres thật. Đồng hồ đóng băng (luật 19);
// mỗi ca một người riêng (luật 18).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import * as tbt from "../../lib/cham-cong/thiet-bi-thuan";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/thiet-bi] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "cc-tb23";
const NOW = new Date("2026-10-05T01:00:00Z");
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

d("[TB-DB] thiết bị chấm công", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let tb: typeof import("../../lib/cham-cong/thiet-bi");
  const actor = { id: "", name: "QL tb23" };
  const cauHinh = (o: Partial<import("../../lib/cham-cong/thiet-bi").CauHinhThietBi> = {}) => ({
    cheDo: "OBSERVE" as const,
    toiDa: 2,
    tuTinCayDauTien: true,
    choPhepKhanCap: true,
    ...o,
  });

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const devs = await db.staffDevice.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [...devs.map((x) => x.id), ...ids] } } });
    await db.staffDevice.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  let so = 0;
  const nguoi = async () =>
    (await db.user.create({ data: { email: `nv${++so}@${TAG}.test`, name: `NV tb ${so}`, role: "TEACHER", roles: ["TEACHER"], password: "x" }, select: { id: true } })).id;
  const cham = (userId: string, khoa: string, o: Parameters<typeof cauHinh>[0] = {}) =>
    tb.kiemThietBiKhiCham({ userId, khoa, userAgent: UA_IPHONE, cauHinh: cauHinh(o), now: NOW });

  beforeAll(async () => {
    tb = await import("../../lib/cham-cong/thiet-bi");
    await cleanup();
    actor.id = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: actor.name, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x" }, select: { id: true } })).id;
  });
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it("[TB-01] máy đầu tự tin cậy, máy thứ hai chờ duyệt; cùng khoá chấm lại ⇒ cùng một máy; DB chỉ giữ BĂM", async () => {
    const nv = await nguoi();
    const k1 = tb.taoKhoaThietBi();
    const a = await cham(nv, k1);
    expect(a).toMatchObject({ trangThai: "TRUSTED", moi: true, quyetDinh: { cho: true, co: null } });
    const b = await cham(nv, tb.taoKhoaThietBi());
    expect(b).toMatchObject({ trangThai: "PENDING", moi: true, quyetDinh: { cho: true, co: "THIET_BI_CHUA_TIN_CAY" } });
    const lai = await cham(nv, k1);
    expect(lai).toMatchObject({ staffDeviceId: a.staffDeviceId, moi: false });
    const dong = await db.staffDevice.findUniqueOrThrow({ where: { id: a.staffDeviceId } });
    expect(dong.keyHash).toBe(tb.bamKhoa(k1));
    expect(dong.keyHash).not.toContain(k1);
    expect(dong.deviceName).toBe("iPhone · Safari");
  });

  it("[TB-02] đăng ký GIỮ khoá theo người: giao dịch khác đang giữ khoá thiết bị của người đó thì phải CHỜ", async () => {
    // Đua thật giữa hai máy đầu tiên có khung vài ms — bỏ khoá mà vẫn tình cờ tuần tự là ca xanh oan (đã gặp ở
    // P2.1 [SP-06b]). Đo TẤT ĐỊNH: A giữ khoá 400ms, B phải xong SAU lúc A nhả; rồi kiểm kết quả: một máy TRUSTED.
    const nv = await nguoi();
    let daGiu!: () => void;
    const aDaGiu = new Promise<void>((r) => (daGiu = r));
    let aNha = 0;
    const A = db.$transaction(
      async (tx) => {
        await tb.khoaNguoi(tx, nv);
        daGiu();
        await new Promise((r) => setTimeout(r, 400));
        aNha = performance.now();
      },
      { timeout: 20_000 },
    );
    await aDaGiu;
    const B = cham(nv, tb.taoKhoaThietBi()).then((x) => ({ x, xong: performance.now() }));
    const [, b] = await Promise.all([A, B]);
    expect(b.xong).toBeGreaterThan(aNha);
    const kq = await Promise.all([cham(nv, tb.taoKhoaThietBi()), cham(nv, tb.taoKhoaThietBi())]);
    expect([b.x.trangThai, ...kq.map((x) => x.trangThai)].filter((t) => t === "TRUSTED")).toHaveLength(1);
  });

  it("[TB-03] OBSERVE không bao giờ chặn — máy đã thu hồi vẫn chấm được, chỉ gắn cờ", async () => {
    const nv = await nguoi();
    const k = tb.taoKhoaThietBi();
    const a = await cham(nv, k);
    expect((await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "THU_HOI", lyDo: "đổi điện thoại mới", toiDa: 2, actor, now: NOW })).ok).toBe(true);
    expect((await cham(nv, k)).quyetDinh).toEqual({ cho: true, co: "THIET_BI_DA_THU_HOI" });
  });

  it("[TB-04] ENFORCE: máy thu hồi bị chặn; máy chưa duyệt theo cờ khẩn cấp", async () => {
    const nv = await nguoi();
    const k1 = tb.taoKhoaThietBi();
    const a = await cham(nv, k1, { cheDo: "ENFORCE" });
    await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "BAO_MAT", lyDo: "mất máy ở quán", toiDa: 2, actor, now: NOW });
    expect((await cham(nv, k1, { cheDo: "ENFORCE" })).quyetDinh).toMatchObject({ cho: false, loi: expect.stringMatching(/báo mất/) });
    const k2 = tb.taoKhoaThietBi();
    // Máy thứ hai: chưa có máy tin cậy nào (máy 1 đã mất) ⇒ tự tin cậy theo luật máy đầu.
    expect((await cham(nv, k2, { cheDo: "ENFORCE" })).trangThai).toBe("TRUSTED");
    const k3 = tb.taoKhoaThietBi();
    expect((await cham(nv, k3, { cheDo: "ENFORCE", choPhepKhanCap: true })).quyetDinh).toEqual({ cho: true, co: "THIET_BI_CHUA_TIN_CAY" });
    expect((await cham(nv, k3, { cheDo: "ENFORCE", choPhepKhanCap: false })).quyetDinh.cho).toBe(false);
  });

  it("[TB-05] duyệt dừng ở trần số máy; thu hồi bắt buộc lý do; mọi thao tác có audit", async () => {
    const nv = await nguoi();
    await cham(nv, tb.taoKhoaThietBi()); // TRUSTED
    const b = await cham(nv, tb.taoKhoaThietBi()); // PENDING
    const c = await cham(nv, tb.taoKhoaThietBi()); // PENDING
    expect((await tb.doiTrangThaiThietBi({ id: b.staffDeviceId, hanhDong: "TIN_CAY", lyDo: "", toiDa: 2, actor, now: NOW })).ok).toBe(true);
    expect(await tb.doiTrangThaiThietBi({ id: c.staffDeviceId, hanhDong: "TIN_CAY", lyDo: "", toiDa: 2, actor, now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/2\/2/) });
    expect(await tb.doiTrangThaiThietBi({ id: c.staffDeviceId, hanhDong: "THU_HOI", lyDo: "abc", toiDa: 2, actor, now: NOW })).toMatchObject({ ok: false });
    expect(await db.auditLog.count({ where: { entityId: b.staffDeviceId, action: "DEVICE_TIN_CAY" } })).toBe(1);
  });

  it("[TB-06] ĐẶT LẠI thu hồi mọi máy còn hiệu lực ⇒ máy chấm kế tiếp đăng ký lại và tự tin cậy", async () => {
    const nv = await nguoi();
    await cham(nv, tb.taoKhoaThietBi());
    await cham(nv, tb.taoKhoaThietBi());
    expect(await tb.datLaiThietBi({ userId: nv, lyDo: "nhân sự đổi máy", actor, now: NOW })).toEqual({ ok: true, soMay: 2, soBaoMat: 0, note: "Đã đặt lại 2 thiết bị." });
    expect(await db.staffDevice.count({ where: { userId: nv, status: { in: ["PENDING", "TRUSTED"] } } })).toBe(0);
    expect((await cham(nv, tb.taoKhoaThietBi())).trangThai).toBe("TRUSTED");
  });

  // Nghiệm thu test.satarobo.vn 11/10/2026: bản đầu đặt lại chỉ đổi trạng thái và GIỮ khoá ⇒ CHÍNH trình duyệt đang dùng
  // vẫn khớp dòng đã thu hồi ⇒ ENFORCE chặn mãi ("Thiết bị này đã bị thu hồi"). [TB-06] cũ xanh vì chỉ thử khoá MỚI.
  it("[TB-06b] ĐẶT LẠI rồi chấm bằng CHÍNH trình duyệt cũ (cùng khoá) ⇒ đăng ký như máy mới, ENFORCE cho qua", async () => {
    const nv = await nguoi();
    const k1 = tb.taoKhoaThietBi();
    const a = await cham(nv, k1, { cheDo: "ENFORCE" });
    expect(await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "THU_HOI", lyDo: "thu hồi nhầm máy", toiDa: 2, actor, now: NOW })).toEqual({ ok: true });
    expect((await cham(nv, k1, { cheDo: "ENFORCE" })).quyetDinh.cho).toBe(false); // trước đặt lại: chặn (đối chứng)
    expect(await tb.datLaiThietBi({ userId: nv, lyDo: "trả lại máy thu hồi nhầm", actor, now: NOW })).toMatchObject({ ok: true, soMay: 1 });
    const sau = await cham(nv, k1, { cheDo: "ENFORCE" });
    expect(sau).toMatchObject({ moi: true, trangThai: "TRUSTED", quyetDinh: { cho: true } });
    expect(sau.staffDeviceId).not.toBe(a.staffDeviceId);
    // Dòng cũ còn (lịch sử) nhưng không thao tác được nữa.
    expect(await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "BAO_MAT", lyDo: "thử trên dòng cũ", toiDa: 2, actor, now: NOW })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/đã được đặt lại/),
    });
  });

  it("[TB-06c] máy BÁO MẤT không bị đặt lại tháo khoá ⇒ vẫn bị chặn sau đặt lại", async () => {
    const nv = await nguoi();
    const kMat = tb.taoKhoaThietBi();
    const m = await cham(nv, kMat, { cheDo: "ENFORCE" });
    await tb.doiTrangThaiThietBi({ id: m.staffDeviceId, hanhDong: "BAO_MAT", lyDo: "mất ở quán cà phê", toiDa: 2, actor, now: NOW });
    expect(await tb.datLaiThietBi({ userId: nv, lyDo: "nhân sự mua máy mới", actor, now: NOW })).toEqual({ ok: false, error: tbt.LOI_DAT_LAI_BAO_MAT });
    expect((await cham(nv, kMat, { cheDo: "ENFORCE" })).quyetDinh).toMatchObject({ cho: false, loi: expect.stringMatching(/báo mất/) });
  });

  // ── D-04 (chủ dự án chốt 11/10/2026): REVOKED đặt lại được; LOST là khoá mạnh — đặt lại thường KHÔNG trả nó về ──
  it("[D04-01] TRUSTED → REVOKED (thu hồi có lý do) ⇒ máy đó bị chặn ở ENFORCE", async () => {
    const nv = await nguoi();
    const k = tb.taoKhoaThietBi();
    const a = await cham(nv, k, { cheDo: "ENFORCE" });
    expect(a.trangThai).toBe("TRUSTED");
    expect(await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "THU_HOI", lyDo: "nghỉ việc trả máy", toiDa: 2, actor, now: NOW })).toEqual({ ok: true });
    expect((await db.staffDevice.findUniqueOrThrow({ where: { id: a.staffDeviceId } })).status).toBe("REVOKED");
    expect((await cham(nv, k, { cheDo: "ENFORCE" })).quyetDinh).toMatchObject({ cho: false, loi: expect.stringMatching(/thu hồi/) });
  });

  it("[D04-02] REVOKED → ĐẶT LẠI ⇒ đăng ký cũ bị quên: khoá cũ không còn khớp dòng nào", async () => {
    const nv = await nguoi();
    const k = tb.taoKhoaThietBi();
    const a = await cham(nv, k);
    await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "THU_HOI", lyDo: "thu hồi để đổi máy", toiDa: 2, actor, now: NOW });
    expect(await tb.datLaiThietBi({ userId: nv, lyDo: "cho đăng ký lại", actor, now: NOW })).toEqual({
      ok: true,
      soMay: 1,
      soBaoMat: 0,
      note: "Đã đặt lại 1 thiết bị. Thiết bị sẽ cần đăng ký lại khi chấm công lần tiếp theo.",
    });
    const cu = await db.staffDevice.findUniqueOrThrow({ where: { id: a.staffDeviceId } });
    expect(tbt.daDatLai(cu.keyHash)).toBe(true);
    expect(await db.staffDevice.count({ where: { userId: nv, keyHash: tb.bamKhoa(k) } })).toBe(0);
  });

  it("[D04-03] sau khi đặt lại máy REVOKED: chính trình duyệt đó đăng ký lại được — TRUSTED nếu bật tự tin cậy máy đầu, PENDING nếu tắt", async () => {
    for (const tuTinCayDauTien of [true, false]) {
      const nv = await nguoi();
      const k = tb.taoKhoaThietBi();
      const a = await cham(nv, k, { cheDo: "ENFORCE" });
      await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "THU_HOI", lyDo: "thu hồi nhầm máy", toiDa: 2, actor, now: NOW });
      await tb.datLaiThietBi({ userId: nv, lyDo: "trả lại máy thu hồi nhầm", actor, now: NOW });
      const lai = await cham(nv, k, { cheDo: "ENFORCE", tuTinCayDauTien });
      expect(lai).toMatchObject({ moi: true, trangThai: tuTinCayDauTien ? "TRUSTED" : "PENDING" });
      expect(lai.staffDeviceId).not.toBe(a.staffDeviceId);
    }
  });

  it("[D04-04] LOST → ĐẶT LẠI thường ⇒ TỪ CHỐI, không ghi gì; máy mất vẫn bị chặn. Có máy khác thì chỉ máy khác được đặt lại", async () => {
    const nv = await nguoi();
    const kMat = tb.taoKhoaThietBi();
    const m = await cham(nv, kMat, { cheDo: "ENFORCE" });
    await tb.doiTrangThaiThietBi({ id: m.staffDeviceId, hanhDong: "THU_HOI", lyDo: "nghi bị mất", toiDa: 2, actor, now: NOW });
    await tb.doiTrangThaiThietBi({ id: m.staffDeviceId, hanhDong: "BAO_MAT", lyDo: "xác nhận đã mất", toiDa: 2, actor, now: NOW });
    const truoc = await db.staffDevice.findUniqueOrThrow({ where: { id: m.staffDeviceId } });
    expect(await tb.datLaiThietBi({ userId: nv, lyDo: "muốn khôi phục máy mất", actor, now: NOW })).toEqual({ ok: false, error: tbt.LOI_DAT_LAI_BAO_MAT });
    expect(await db.staffDevice.findUniqueOrThrow({ where: { id: m.staffDeviceId } })).toEqual(truoc);
    expect(await db.auditLog.count({ where: { entityId: nv, action: "DEVICE_RESET" } })).toBe(0);
    expect((await cham(nv, kMat, { cheDo: "ENFORCE" })).quyetDinh).toMatchObject({ cho: false, loi: expect.stringMatching(/báo mất/) });
    // Có thêm một máy thường ⇒ đặt lại chạy cho máy đó, máy mất giữ nguyên khoá và câu báo nói rõ.
    const kMoi = tb.taoKhoaThietBi();
    await cham(nv, kMoi);
    expect(await tb.datLaiThietBi({ userId: nv, lyDo: "đổi sang máy mới", actor, now: NOW })).toEqual({
      ok: true,
      soMay: 1,
      soBaoMat: 1,
      note: `Đã đặt lại 1 thiết bị. Thiết bị sẽ cần đăng ký lại khi chấm công lần tiếp theo. ${tbt.LOI_DAT_LAI_BAO_MAT}`,
    });
    expect((await db.staffDevice.findUniqueOrThrow({ where: { id: m.staffDeviceId } })).keyHash).toBe(truoc.keyHash);
    expect((await cham(nv, kMat, { cheDo: "ENFORCE" })).quyetDinh.cho).toBe(false);
  });

  it("[D04-05] audit: THU_HOI · BAO_MAT · RESET mỗi thao tác đúng một dòng, đúng action và lý do", async () => {
    const nv = await nguoi();
    const a = await cham(nv, tb.taoKhoaThietBi());
    const b = await cham(nv, tb.taoKhoaThietBi());
    await tb.doiTrangThaiThietBi({ id: a.staffDeviceId, hanhDong: "THU_HOI", lyDo: "lý do thu hồi A", toiDa: 2, actor, now: NOW });
    await tb.doiTrangThaiThietBi({ id: b.staffDeviceId, hanhDong: "BAO_MAT", lyDo: "lý do báo mất B", toiDa: 2, actor, now: NOW });
    await tb.datLaiThietBi({ userId: nv, lyDo: "lý do đặt lại", actor, now: NOW });
    const dong = await db.auditLog.findMany({
      where: { entityId: { in: [a.staffDeviceId, b.staffDeviceId, nv] } },
      select: { entityId: true, action: true, reason: true, entityType: true, newValues: true },
    });
    expect(dong.map((x) => `${x.entityId === nv ? "NV" : x.entityId === a.staffDeviceId ? "A" : "B"}:${x.action}:${x.reason}`).sort()).toEqual([
      "A:DEVICE_THU_HOI:lý do thu hồi A",
      "B:DEVICE_BAO_MAT:lý do báo mất B",
      "NV:DEVICE_RESET:lý do đặt lại",
    ]);
    expect(dong.every((x) => x.entityType === "StaffDevice")).toBe(true);
    expect(dong.find((x) => x.action === "DEVICE_RESET")?.newValues).toEqual({ soMayThaoKhoa: 1, soMayBaoMatGiuNguyen: 1 });
  });

  it("[TB-07] một trình duyệt dùng chung bởi hai người ⇒ HAI dòng thiết bị, không gộp", async () => {
    const a = await nguoi();
    const b = await nguoi();
    const k = tb.taoKhoaThietBi();
    const x = await cham(a, k);
    const y = await cham(b, k);
    expect(x.staffDeviceId).not.toBe(y.staffDeviceId);
    expect(y.trangThai).toBe("TRUSTED");
  });

  it("[TB-08] khoá cookie méo không bao giờ được coi là hợp lệ", () => {
    expect(tb.laKhoaHopLe(tb.taoKhoaThietBi())).toBe(true);
    expect(tb.laKhoaHopLe("abc")).toBe(false);
    expect(tb.laKhoaHopLe(`${"a".repeat(42)}'`)).toBe(false);
    expect(tb.laKhoaHopLe(undefined)).toBe(false);
  });
});
