// @vitest-environment node
/**
 * [OCK-DB-*] WORKSTREAM A — luồng mua khoá ONLINE trên Postgres thật: học viên chỉ-online (mã SR) · giỏ hàng theo cặp (khoá × con) · tạo đơn với giá ở máy chủ ·
 * khuyến mãi theo kênh · cầu nối thanh toán → quyền học (idempotent, retry, đối soát) · chống truy cập chéo phụ huynh · tách bạch Online/Offline.
 *
 * AN TOÀN DB: dọn bằng `donBangOnl` (cổng theo TÊN database) + xoá theo tiền tố `CI_OCK_`/`INV-ONL-`. KHÔNG dùng `session_replication_role`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { docChungNhanCuaHocVien } from "../../lib/elearning-online/chung-nhan";
import { batDauLamBai, docKetQuaCacLuot, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { docKhoaOnlineCuaHocVien, docMucLucKhoaCuaHocVien, ghiTienDoBai, kiemTraTruyCapChoPhuHuynh } from "../../lib/elearning-online/hoc-tap";
import { datTienQuyet, doiTrangThaiBan, taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { themBai, themChuong } from "../../lib/elearning-online/noi-dung";
import { luuCaiDat, phatHanh, xemTruocPhatHanh } from "../../lib/elearning-online/phien-ban";
import { capQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { capVeMedia } from "../../lib/elearning-online/ve-media";
import { hichCapQuyenHocChoDon } from "../../lib/entitlements/hich";
import { sauKhiDonThuDu } from "../../lib/payments/don-thu-du";
import { ingestPayosWebhook } from "../../lib/payments/payos-ingest";
import { TOI_DA_LAN_THU, capQuyenOnlineChoDon, docHangDoiCapQuyenOnline, doiSoatCapQuyenOnline, hanThuLai } from "../../lib/online-checkout/cap-quyen-sau-thanh-toan";
import { taoHocVienChiOnline } from "../../lib/online-checkout/hoc-vien-chi-online";
import { docConCuaPhuHuynh, docDanhSachDonOnline, docDonOnlineCuaPhuHuynh, docKhoaMuaDuocChoCon, huyDonOnlineChuaThanhToan } from "../../lib/online-checkout/phu-huynh";
import { taoDonOnline } from "../../lib/online-checkout/tao-don";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_OCK_";
const NOW = new Date(Date.UTC(2026, 10, 20, 5, 0, 0));
let n = 0;

async function don() {
  await donBangOnl(db);
  const orders = await db.order.findMany({ where: { code: { startsWith: "INV-ONL-" } }, select: { id: true } });
  const oid = orders.map((o) => o.id);
  if (oid.length) {
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderOnlineGrant.deleteMany({ where: { orderId: { in: oid } } });
    await db.payment.deleteMany({ where: { orderId: { in: oid } } });
    await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: oid } } } });
    await db.paymentRequest.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderStatusHistory.deleteMany({ where: { orderId: { in: oid } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: oid } } });
    await db.order.deleteMany({ where: { id: { in: oid } } });
  }
  await db.voucher.deleteMany({ where: { code: { startsWith: P } } });
  await db.promotionPolicy.deleteMany({ where: { documentCode: { startsWith: P } } });
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: "ci-ock-" } } });
  await db.counter.deleteMany({ where: { key: { startsWith: "invoice:ONL:" } } });
}

async function phuHuynh(ten: string, o: { phone?: string | null; name?: string | null; role?: "PARENT" | "SALES_CSM" } = {}) {
  const i = ++n;
  return db.user.create({
    data: {
      name: o.name === undefined ? `${P}${ten}` : o.name,
      email: `ci-ock-${ten}-${Date.now()}-${i}@example.test`,
      phone: o.phone === undefined ? `09${String(Date.now()).slice(-7)}${i % 10}${i % 7}`.slice(0, 11) : o.phone,
      role: o.role ?? "PARENT",
    },
    select: { id: true, phone: true },
  });
}
async function con(parentUserId: string | null, ten: string) {
  return db.student.create({ data: { name: `${P}${ten}-${++n}`, parentUserId }, select: { id: true, name: true } });
}

async function dungKhoa(o: { gia?: number; thang?: number | null; giaHan?: number | null; banNgay?: boolean; chuaPhatHanh?: boolean } = {}) {
  const thang = o.thang === undefined ? 6 : o.thang;
  const gia = o.gia ?? 500_000;
  const t = await taoKhoa(
    db,
    {
      code: `CI-OCK-${Date.now().toString(36).toUpperCase()}-${++n}`,
      name: `${P}Khoá ${n}`,
      listPrice: gia,
      salePrice: gia,
      validityMonths: thang,
      renewalEnabled: o.giaHan != null,
      ...(o.giaHan != null ? { renewalPrice: o.giaHan } : {}),
    },
    null,
  );
  if (!t.ok) throw new Error(t.thongBao);
  if (!o.chuaPhatHanh) {
    const ch = await themChuong(db, { versionId: t.draftVersionId, title: "C1" });
    if (!ch.ok) throw new Error("chuong");
    const b = await themBai(db, { versionId: t.draftVersionId, chapterId: ch.chapterId, kind: "READ", title: "B1", contentJson: { body: "nội dung" } });
    if (!b.ok) throw new Error(b.thongBao);
    const l = await luuCaiDat(db, { versionId: t.draftVersionId, caiDat: caiDatKhoiDauChoBanNhap() });
    if (!l.ok) throw new Error(l.thongBao);
    const xt = await xemTruocPhatHanh(db, t.courseId, null);
    if (!xt.ok) throw new Error(xt.thongBao);
    const ph = await phatHanh(db, { courseId: t.courseId, dauVet: xt.xemTruoc.dauVet, xacNhan: "PHAT HANH" }, null, NOW);
    if (!ph.ok) throw new Error(ph.thongBao);
    if (o.banNgay !== false) await doiTrangThaiBan(db, { courseId: t.courseId, saleStatus: "ON_SALE" });
  }
  return { courseId: t.courseId, ten: `${P}Khoá ${n}`, gia };
}

async function thu(orderId: string, amount: number) {
  return db.payment.create({ data: { orderId, amount, method: "BANK_TRANSFER", paidDate: NOW } });
}
const gio = (...d: { courseId: string; studentId: string; voucherId?: string }[]) => d;
async function datDon(parentUserId: string, g: unknown) {
  const r = await taoDonOnline(db, { parentUserId, gioHang: g, now: NOW });
  if (!r.ok) throw new Error(`${r.ma}: ${r.thongBao}`);
  return r;
}

describe.skipIf(!RUN_DB_TESTS)("[OCK-DB] luồng mua khoá Online — Workstream A (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);
  afterEach(() => vi.restoreAllMocks());

  // ───────────── Học viên chỉ học Online ─────────────
  describe("[OHV] học viên chỉ-online", () => {
    it("[OHV-DB-01] 🔴 tạo con với mã SR-YY-XXXXXX, KHÔNG thuộc cơ sở nào, nối đúng phụ huynh — trigger mã học viên NGUYÊN VẸN", async () => {
      const ph = await phuHuynh("hv1");
      const r = await taoHocVienChiOnline(db, { parentUserId: ph.id, name: `${P}Bé SR`, now: NOW });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.studentCode).toMatch(/^SR-26-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      const sv = await db.student.findUniqueOrThrow({ where: { id: r.studentId }, select: { centerId: true, orgUnitId: true, parentUserId: true, parentPhone: true, studentCode: true } });
      expect(sv).toMatchObject({ centerId: null, orgUnitId: null, parentUserId: ph.id, parentPhone: ph.phone, studentCode: r.studentCode });
      // Trigger còn sống và còn đúng việc: mã sai HÌNH DẠNG (chứa số 0) vẫn bị từ chối ở DB — chứng minh ta KHÔNG sửa/tắt nó.
      const [{ dem }] = await db.$queryRaw<{ dem: bigint }[]>`select count(*) as dem from pg_trigger where tgname = 'Student_studentCode_dang_trg' and tgenabled <> 'D'`;
      expect(Number(dem)).toBe(1);
      await expect(db.student.update({ where: { id: r.studentId }, data: { studentCode: "SR-26-AB0000" } })).rejects.toThrow(/sai dạng/);
    });

    it("[OHV-DB-02] idempotent theo tên (bấm đúp / 6 lượt song song ⇒ đúng MỘT học viên) + đối chứng: tên khác ⇒ học viên mới", async () => {
      const ph = await phuHuynh("hv2");
      const kq = await Promise.all(Array.from({ length: 6 }, () => taoHocVienChiOnline(db, { parentUserId: ph.id, name: `  ${P}Bé  Song Song `, now: NOW })));
      expect(kq.every((k) => k.ok)).toBe(true);
      expect(new Set(kq.map((k) => (k.ok ? k.studentId : ""))).size).toBe(1);
      expect(await db.student.count({ where: { parentUserId: ph.id, deletedAt: null } })).toBe(1);
      const khac = await taoHocVienChiOnline(db, { parentUserId: ph.id, name: `${P}Bé Khác`, now: NOW });
      expect(khac.ok && !khac.daCo).toBe(true);
      expect(await db.student.count({ where: { parentUserId: ph.id, deletedAt: null } })).toBe(2);
    });

    it("[OHV-DB-03] từ chối: hồ sơ phụ huynh thiếu SĐT/tên · không phải PARENT · tên con trống", async () => {
      const thieuSdt = await phuHuynh("thieusdt", { phone: null });
      expect(await taoHocVienChiOnline(db, { parentUserId: thieuSdt.id, name: `${P}X`, now: NOW })).toMatchObject({ ok: false, ma: "THIEU_HO_SO_PHU_HUYNH" });
      const nv = await phuHuynh("nv", { role: "SALES_CSM" });
      expect(await taoHocVienChiOnline(db, { parentUserId: nv.id, name: `${P}X`, now: NOW })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      const ph = await phuHuynh("hv3");
      expect(await taoHocVienChiOnline(db, { parentUserId: ph.id, name: "   ", now: NOW })).toMatchObject({ ok: false, ma: "THIEU_HO_SO_HOC_VIEN" });
      expect(await taoHocVienChiOnline(db, { parentUserId: "khong-co", name: `${P}X`, now: NOW })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      // đối chứng dương: cùng phụ huynh đủ hồ sơ tạo được
      expect((await taoHocVienChiOnline(db, { parentUserId: ph.id, name: `${P}Hợp lệ`, now: NOW })).ok).toBe(true);
    });

    it("[OHV-DB-04] học viên TRUNG TÂM không bị chạm: con có cơ sở vẫn nguyên, hiện cạnh con online với cờ chiHocOnline đúng", async () => {
      const ph = await phuHuynh("hv4");
      const cs = await db.center.create({ data: { code: `CIOCK${n}`, name: `${P}Cơ sở`, slug: `ci-ock-${Date.now()}-${n}` } as never, select: { id: true } }).catch(() => null);
      const congTrungTam = await db.student.create({ data: { name: `${P}Trung tâm`, parentUserId: ph.id, ...(cs ? { centerId: cs.id } : {}) }, select: { id: true } });
      const online = await taoHocVienChiOnline(db, { parentUserId: ph.id, name: `${P}Online`, now: NOW });
      expect(online.ok).toBe(true);
      const ds = await docConCuaPhuHuynh(db, { parentUserId: ph.id, now: NOW });
      expect(ds).toHaveLength(2);
      const tt = ds.find((d) => d.studentId === congTrungTam.id)!;
      const ol = ds.find((d) => online.ok && d.studentId === online.studentId)!;
      expect(ol.chiHocOnline).toBe(true);
      if (cs) expect(tt.chiHocOnline).toBe(false); // đối chứng ÂM: con có cơ sở không bị coi là chỉ-online
      expect((await db.student.findUniqueOrThrow({ where: { id: congTrungTam.id }, select: { studentCode: true, centerId: true } })).studentCode).toBeNull(); // không bị sinh/ghi mã
      if (cs) await db.student.deleteMany({ where: { id: congTrungTam.id } }).then(() => db.center.delete({ where: { id: cs.id } }).catch(() => null));
    });
  });

  // ───────────── Tạo đơn ─────────────
  describe("[OTD] tạo đơn từ giỏ hàng", () => {
    it("[OTD-DB-01] 🔴 một đơn cho NHIỀU con × nhiều khoá: giá ở MÁY CHỦ, đơn ONLINE không cơ sở, mỗi dòng có chờ cấp, một phiếu thu toàn đơn", async () => {
      const ph = await phuHuynh("d1");
      const [a, b] = [await con(ph.id, "a"), await con(ph.id, "b")];
      const [k1, k2] = [await dungKhoa({ gia: 300_000 }), await dungKhoa({ gia: 450_000 })];
      const r = await datDon(ph.id, gio({ courseId: k1.courseId, studentId: a.id }, { courseId: k1.courseId, studentId: b.id }, { courseId: k2.courseId, studentId: a.id }));
      expect(r.tongTien).toBe(300_000 + 300_000 + 450_000);
      expect(r.dong.map((d) => d.donGia).sort()).toEqual([300_000, 300_000, 450_000]);
      const o = await db.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true } });
      expect(o).toMatchObject({ type: "ONLINE", status: "PENDING_PAYMENT", centerId: null, totalAmount: 1_050_000, createdById: ph.id, customerPhone: ph.phone });
      expect(o.items.every((i) => i.type === "ONLINE_COURSE" && i.onlineCourseId && i.studentId)).toBe(true);
      expect(await db.orderOnlineGrant.count({ where: { orderId: r.orderId, status: "PENDING" } })).toBe(3);
      const pr = await db.paymentRequest.findMany({ where: { orderId: r.orderId } });
      expect(pr).toHaveLength(1);
      expect(pr[0]).toMatchObject({ amountDue: 1_050_000, status: "PENDING", centerId: null });
      expect(o.code).toMatch(/^INV-ONL-2026-\d{4}$/);
      // đơn mua KHÔNG tạo ghi danh/lớp
      expect(await db.enrollment.count({ where: { studentId: { in: [a.id, b.id] } } })).toBe(0);
    });

    it("[OTD-DB-02] client KHÔNG cầm số tiền: trường lạ trong giỏ bị từ chối, thiếu con/khoá báo ĐÚNG dòng, trùng cặp bị chặn", async () => {
      const ph = await phuHuynh("d2");
      const a = await con(ph.id, "a");
      const k = await dungKhoa();
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: [{ courseId: k.courseId, studentId: a.id, price: 1 }] })).toMatchObject({ ok: false, ma: "DU_LIEU_SAI" });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: [{ courseId: k.courseId, studentId: a.id }, { courseId: k.courseId }] })).toMatchObject({ ok: false, ma: "THIEU_HOC_VIEN", viTri: 1 });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: [{ studentId: a.id }] })).toMatchObject({ ok: false, ma: "THIEU_KHOA", viTri: 0 });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: [] })).toMatchObject({ ok: false, ma: "GIO_RONG" });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: [{ courseId: k.courseId, studentId: a.id }, { courseId: k.courseId, studentId: a.id }] })).toMatchObject({ ok: false, ma: "TRUNG_CAP_KHOA_HOC_VIEN", viTri: 1 });
      expect(await db.order.count({ where: { createdById: ph.id } })).toBe(0);
    });

    it("[OTD-DB-03] 🔴 con của phụ huynh KHÁC ⇒ SAI_PHU_HUYNH và KHÔNG có đơn; đối chứng dương: con của chính mình đặt được", async () => {
      const ph1 = await phuHuynh("d3a");
      const ph2 = await phuHuynh("d3b");
      const conCuaPh2 = await con(ph2.id, "x");
      const conCuaPh1 = await con(ph1.id, "y");
      const k = await dungKhoa();
      expect(await taoDonOnline(db, { parentUserId: ph1.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: conCuaPh2.id }) })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await db.order.count({ where: { createdById: ph1.id } })).toBe(0);
      expect((await taoDonOnline(db, { parentUserId: ph1.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: conCuaPh1.id }) })).ok).toBe(true);
    });

    it("[OTD-DB-04] hồ sơ chưa đủ ⇒ chặn TRƯỚC khi có đơn (phụ huynh thiếu SĐT; học viên tên trắng)", async () => {
      const k = await dungKhoa();
      const thieu = await phuHuynh("d4a", { phone: null });
      const c1 = await con(thieu.id, "a");
      expect(await taoDonOnline(db, { parentUserId: thieu.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: c1.id }) })).toMatchObject({ ok: false, ma: "THIEU_HO_SO_PHU_HUYNH" });
      const ph = await phuHuynh("d4b");
      const blank = await db.student.create({ data: { name: "  ", parentUserId: ph.id }, select: { id: true } });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: blank.id }) })).toMatchObject({ ok: false, ma: "THIEU_HO_SO_HOC_VIEN" });
      await db.student.delete({ where: { id: blank.id } });
    });

    it("[OTD-DB-05] khoá không tồn tại / chưa phát hành / không mở bán ⇒ từ chối; đối chứng dương: khoá đang bán", async () => {
      const ph = await phuHuynh("d5");
      const a = await con(ph.id, "a");
      const chuaPh = await dungKhoa({ chuaPhatHanh: true });
      const khongBan = await dungKhoa({ banNgay: false });
      const ban = await dungKhoa();
      const thu1 = (courseId: string) => taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId, studentId: a.id }) });
      expect(await thu1("khong-co")).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
      expect(await thu1(chuaPh.courseId)).toMatchObject({ ok: false, ma: "KHOA_CHUA_PHAT_HANH" });
      expect(await thu1(khongBan.courseId)).toMatchObject({ ok: false, ma: "KHOA_KHONG_DANG_BAN" });
      expect((await thu1(ban.courseId)).ok).toBe(true);
    });

    it("[OTD-DB-06] 🔴 luật cấp chạy TRƯỚC khi thu tiền: trọn đời đang có ⇒ DA_TRON_DOI; còn hạn mà khoá không cho gia hạn ⇒ KHOA_KHONG_CHO_GIA_HAN; cho gia hạn ⇒ GIA_HAN theo giá gia hạn", async () => {
      const ph = await phuHuynh("d6");
      const a = await con(ph.id, "a");
      const tronDoi = await dungKhoa({ thang: null });
      const khongGiaHan = await dungKhoa({ thang: 6 });
      const giaHan = await dungKhoa({ thang: 6, gia: 500_000, giaHan: 200_000 });
      for (const k of [tronDoi, khongGiaHan, giaHan]) {
        const c = await capQuyenHoc(db, { studentId: a.id, courseId: k.courseId, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: `ci-ock-seed-${k.courseId}` });
        expect(c.ok).toBe(true);
      }
      const dat = (courseId: string) => taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId, studentId: a.id }) });
      expect(await dat(tronDoi.courseId)).toMatchObject({ ok: false, ma: "DA_TRON_DOI" });
      expect(await dat(khongGiaHan.courseId)).toMatchObject({ ok: false, ma: "KHOA_KHONG_CHO_GIA_HAN" });
      const gh = await dat(giaHan.courseId);
      expect(gh.ok).toBe(true);
      if (gh.ok) expect(gh.dong[0]).toMatchObject({ loaiMua: "GIA_HAN", donGia: 200_000 });
    });

    it("[OTD-DB-07] 🔴 tiên quyết REQUIRED: chưa hoàn thành ⇒ CHUA_DU_TIEN_QUYET; có chứng nhận khoá tiên quyết ⇒ mua được; RECOMMENDED không chặn", async () => {
      const ph = await phuHuynh("d7");
      const a = await con(ph.id, "a");
      const truoc = await dungKhoa();
      const sau = await dungKhoa();
      const khuyen = await dungKhoa();
      expect((await datTienQuyet(db, { courseId: sau.courseId, mode: "REQUIRED", prerequisiteCourseId: truoc.courseId })).ok).toBe(true);
      expect((await datTienQuyet(db, { courseId: khuyen.courseId, mode: "RECOMMENDED", prerequisiteCourseId: truoc.courseId })).ok).toBe(true);
      const dat = (courseId: string) => taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId, studentId: a.id }) });
      expect(await dat(sau.courseId)).toMatchObject({ ok: false, ma: "CHUA_DU_TIEN_QUYET" });
      expect((await dat(khuyen.courseId)).ok).toBe(true); // RECOMMENDED: không chặn
      // hoàn thành khoá tiên quyết = có chứng nhận ISSUED
      const c = await capQuyenHoc(db, { studentId: a.id, courseId: truoc.courseId, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: `ci-ock-tq-${truoc.courseId}` });
      if (!c.ok) throw new Error(c.thongBao);
      await db.onlCertificate.create({ data: { studentId: a.id, courseId: truoc.courseId, entitlementId: c.entitlementId, code: `CIOCK${Date.now()}`, studentName: a.name, courseName: truoc.ten, courseCode: "X", versionNumber: 1, issuedAt: NOW } });
      expect((await dat(sau.courseId)).ok).toBe(true);
    });

    it("[OTD-DB-08] 🔴 idempotent: cùng giỏ ⇒ TRẢ LẠI đơn cũ (6 lượt song song = 1 đơn); trùng MỘT PHẦN ⇒ DA_CO_DON_DANG_CHO; huỷ rồi đặt lại được", async () => {
      const ph = await phuHuynh("d8");
      const [a, b] = [await con(ph.id, "a"), await con(ph.id, "b")];
      const k = await dungKhoa();
      const g = gio({ courseId: k.courseId, studentId: a.id }, { courseId: k.courseId, studentId: b.id });
      const song = await Promise.all(Array.from({ length: 6 }, () => taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: g })));
      expect(song.every((s) => s.ok)).toBe(true);
      expect(new Set(song.map((s) => (s.ok ? s.orderId : ""))).size).toBe(1);
      expect(song.filter((s) => s.ok && !s.daCo)).toHaveLength(1);
      expect(await db.order.count({ where: { createdById: ph.id } })).toBe(1);
      expect(await db.orderOnlineGrant.count({ where: { studentId: { in: [a.id, b.id] } } })).toBe(2);
      const dau = song.find((s) => s.ok)!;
      if (!dau.ok) throw new Error("x");
      // một phần trùng
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: a.id }) })).toMatchObject({ ok: false, ma: "DA_CO_DON_DANG_CHO" });
      // huỷ ⇒ đặt lại được
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: dau.orderId, now: NOW })).toEqual({ ok: true, daHuyTruocDo: false });
      expect((await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: a.id }) })).ok).toBe(true);
    });

    it("[OTD-DB-09] đơn 0 đồng không đi giỏ hàng (mã giảm 100%)", async () => {
      const ph = await phuHuynh("d9");
      const a = await con(ph.id, "a");
      const k = await dungKhoa({ gia: 100_000 });
      const v = await dungMa({ kenh: "ONLINE", khoaOnline: [], phanTram: 100 });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: a.id, voucherId: v.voucherId }) })).toMatchObject({ ok: false, ma: "DON_0_DONG" });
      expect(await db.order.count({ where: { createdById: ph.id } })).toBe(0);
    });
  });

  // ───────────── Khuyến mãi theo kênh ─────────────
  async function dungMa(o: { kenh: "OFFLINE" | "ONLINE" | "BOTH"; khoaOnline: string[]; phanTram?: number; soTien?: number; soLuong?: number | null; gioiHanMoiCon?: number }) {
    const i = ++n;
    const cs = await db.promotionPolicy.create({
      data: { documentCode: `${P}VB${i}-${Date.now() % 100000}`, name: `${P}CT${i}`, benefitText: "Ưu đãi thử nghiệm online", validFrom: new Date("2026-01-01"), validUntil: new Date("2027-12-31"), channel: o.kenh, onlineCourseIds: o.khoaOnline },
      select: { id: true },
    });
    const v = await db.voucher.create({
      data: {
        code: `${P}MA${i}-${Date.now() % 100000}`,
        name: `${P}Mã ${i}`,
        type: "ALL",
        discountKind: o.soTien ? "FIXED" : "PERCENT",
        discountPercent: o.soTien ? null : (o.phanTram ?? 10),
        discountAmount: o.soTien ?? null,
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2027-12-31T00:00:00Z"),
        quantity: o.soLuong === undefined ? null : o.soLuong,
        usageLimitPerUser: o.gioiHanMoiCon ?? 1,
        policyId: cs.id,
      },
      select: { id: true, code: true },
    });
    return { voucherId: v.id, ma: v.code, policyId: cs.id };
  }

  describe("[OKM] khuyến mãi theo kênh ONLINE/OFFLINE", () => {
    it("[OKM-DB-01] 🔴 mã kênh ONLINE giảm đúng, ghi lượt dùng + usedCount; mã kênh OFFLINE (mặc định cũ) BỊ TỪ CHỐI cho dòng online", async () => {
      const ph = await phuHuynh("km1");
      const a = await con(ph.id, "a");
      const k = await dungKhoa({ gia: 1_000_000 });
      const on = await dungMa({ kenh: "ONLINE", khoaOnline: [k.courseId], phanTram: 20 });
      const off = await dungMa({ kenh: "OFFLINE", khoaOnline: [] });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: a.id, voucherId: off.voucherId }) })).toMatchObject({ ok: false, ma: "MA_KHONG_DUNG_DUOC" });
      expect(await db.order.count({ where: { createdById: ph.id } })).toBe(0);
      const r = await datDon(ph.id, gio({ courseId: k.courseId, studentId: a.id, voucherId: on.voucherId }));
      expect(r).toMatchObject({ tongTien: 800_000, giamTong: 200_000 });
      expect(r.dong[0]).toMatchObject({ donGia: 1_000_000, giam: 200_000, thanhTien: 800_000 });
      expect(await db.voucherRedemption.count({ where: { orderId: r.orderId, voucherId: on.voucherId, discountApplied: 200_000 } })).toBe(1);
      expect((await db.voucher.findUniqueOrThrow({ where: { id: on.voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
      expect((await db.paymentRequest.findFirstOrThrow({ where: { orderId: r.orderId } })).amountDue).toBe(800_000); // phiếu thu theo số SAU giảm
    });

    it("[OKM-DB-02] chọn khoá được áp dụng: mã chỉ cho khoá A ⇒ dòng khoá B bị từ chối; kênh BOTH áp cho online theo `khoaOnline`", async () => {
      const ph = await phuHuynh("km2");
      const a = await con(ph.id, "a");
      const [ka, kb] = [await dungKhoa(), await dungKhoa()];
      const m = await dungMa({ kenh: "BOTH", khoaOnline: [ka.courseId] });
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: kb.courseId, studentId: a.id, voucherId: m.voucherId }) })).toMatchObject({ ok: false, ma: "MA_KHONG_DUNG_DUOC" });
      expect((await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: ka.courseId, studentId: a.id, voucherId: m.voucherId }) })).ok).toBe(true);
    });

    it("[OKM-DB-03] 🔴 trần lượt theo CON: cùng mã dùng cho hai con khác nhau được; cùng con lần hai ⇒ MA_HET_LUOT_CUA_CON; huỷ đơn trả lượt", async () => {
      const ph = await phuHuynh("km3");
      const [a, b] = [await con(ph.id, "a"), await con(ph.id, "b")];
      const [k1, k2] = [await dungKhoa(), await dungKhoa()];
      const m = await dungMa({ kenh: "ONLINE", khoaOnline: [], phanTram: 10, gioiHanMoiCon: 1 });
      const d1 = await datDon(ph.id, gio({ courseId: k1.courseId, studentId: a.id, voucherId: m.voucherId }, { courseId: k1.courseId, studentId: b.id, voucherId: m.voucherId }));
      expect(d1.giamTong).toBe(100_000); // hai con, mỗi con một lượt
      expect(await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k2.courseId, studentId: a.id, voucherId: m.voucherId }) })).toMatchObject({ ok: false, ma: "MA_HET_LUOT_CUA_CON" });
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: d1.orderId, now: NOW })).toMatchObject({ ok: true });
      expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(0);
      expect((await taoDonOnline(db, { parentUserId: ph.id, now: NOW, gioHang: gio({ courseId: k2.courseId, studentId: a.id, voucherId: m.voucherId }) })).ok).toBe(true); // lượt đã được trả
    });

    it("[OKM-DB-04] 🔴 hết suất đua nhau: mã còn 1 suất, hai phụ huynh cùng đặt ⇒ ĐÚNG MỘT đơn thắng; kẻ thua KHÔNG để lại đơn/phiếu/lượt dùng", async () => {
      const [p1, p2] = [await phuHuynh("km4a"), await phuHuynh("km4b")];
      const [c1, c2] = [await con(p1.id, "a"), await con(p2.id, "b")];
      const k = await dungKhoa();
      const m = await dungMa({ kenh: "ONLINE", khoaOnline: [], soLuong: 1 });
      const kq = await Promise.all([
        taoDonOnline(db, { parentUserId: p1.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: c1.id, voucherId: m.voucherId }) }),
        taoDonOnline(db, { parentUserId: p2.id, now: NOW, gioHang: gio({ courseId: k.courseId, studentId: c2.id, voucherId: m.voucherId }) }),
      ]);
      expect(kq.filter((x) => x.ok)).toHaveLength(1);
      expect(kq.filter((x) => !x.ok).every((x) => !x.ok && ["MA_HET_SUAT", "MA_KHONG_DUNG_DUOC"].includes(x.ma))).toBe(true);
      expect(await db.order.count({ where: { createdById: { in: [p1.id, p2.id] } } })).toBe(1);
      expect(await db.voucherRedemption.count({ where: { voucherId: m.voucherId } })).toBe(1);
      expect((await db.voucher.findUniqueOrThrow({ where: { id: m.voucherId }, select: { usedCount: true } })).usedCount).toBe(1);
    });
  });

  // ───────────── Thanh toán → quyền học ─────────────
  describe("[OCQ] cầu nối thanh toán → quyền học", () => {
    async function donDaDat(gia = 500_000) {
      const ph = await phuHuynh("q");
      const a = await con(ph.id, "a");
      const k = await dungKhoa({ gia });
      const r = await datDon(ph.id, gio({ courseId: k.courseId, studentId: a.id }));
      return { ph, a, k, r, itemId: r.dong[0]!.orderItemId };
    }

    it("[OCQ-DB-01] 🔴 chưa thu / thu MỘT PHẦN ⇒ KHÔNG cấp; thu ĐỦ ⇒ cấp NGAY và khoá hiện trong danh sách học, không tạo ghi danh offline", async () => {
      const { ph, a, k, r } = await donDaDat(500_000);
      expect((await capQuyenOnlineChoDon(db, r.orderId, NOW)).dong.map((d) => d.ketQua)).toEqual(["CHO_THANH_TOAN"]);
      await thu(r.orderId, 200_000);
      expect((await capQuyenOnlineChoDon(db, r.orderId, NOW)).dong.map((d) => d.ketQua)).toEqual(["CHO_THANH_TOAN"]);
      expect(await db.onlEntitlement.count({ where: { studentId: a.id } })).toBe(0);
      expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: ph.id, studentId: a.id, now: NOW })).toEqual([]);
      await thu(r.orderId, 300_000);
      const kq = await capQuyenOnlineChoDon(db, r.orderId, NOW);
      expect(kq).toMatchObject({ coDongOnline: true, daThuDu: true });
      expect(kq.dong.map((d) => d.ketQua)).toEqual(["DA_CAP"]);
      const ds = await docKhoaOnlineCuaHocVien(db, { parentUserId: ph.id, studentId: a.id, now: NOW });
      expect(ds?.map((d) => d.courseId)).toEqual([k.courseId]); // học được NGAY
      const g = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: r.orderId } });
      expect(g).toMatchObject({ status: "GRANTED" });
      expect(g.entitlementId).toBeTruthy();
      const q = await db.onlEntitlement.findUniqueOrThrow({ where: { id: g.entitlementId! } });
      expect(q).toMatchObject({ studentId: a.id, courseId: k.courseId, source: "PURCHASE", status: "ACTIVE" });
      expect(await db.onlEntitlementEvent.findFirst({ where: { entitlementId: q.id }, select: { orderId: true, orderItemId: true, idempotencyKey: true } })).toEqual({ orderId: r.orderId, orderItemId: r.dong[0]!.orderItemId, idempotencyKey: `onl-order:${r.dong[0]!.orderItemId}` });
      // TÁCH BẠCH: không ghi danh/lớp, không động vào bảng quyền học offline
      expect(await db.enrollment.count({ where: { studentId: a.id } })).toBe(0);
    });

    it("[OCQ-DB-02] 🔴 idempotent: gọi lại + 6 lượt song song ⇒ MỘT quyền, MỘT sự kiện; gọi sau khi đã cấp không đổi hạn", async () => {
      const { a, k, r } = await donDaDat();
      await thu(r.orderId, 500_000);
      const song = await Promise.all(Array.from({ length: 6 }, () => capQuyenOnlineChoDon(db, r.orderId, NOW)));
      expect(song.every((s) => s.dong.every((d) => d.ketQua === "DA_CAP" || d.ketQua === "DA_CAP_TRUOC_DO"))).toBe(true);
      const q = await db.onlEntitlement.findMany({ where: { studentId: a.id, courseId: k.courseId } });
      expect(q).toHaveLength(1);
      expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q[0]!.id } })).toBe(1);
      const han = q[0]!.expiresAt?.getTime();
      const sau = await capQuyenOnlineChoDon(db, r.orderId, new Date(NOW.getTime() + 86_400_000 * 40));
      expect(sau.coDongOnline).toBe(false); // đã GRANTED — không còn dòng chờ
      expect((await db.onlEntitlement.findUniqueOrThrow({ where: { id: q[0]!.id } })).expiresAt?.getTime()).toBe(han);
    });

    it("[OCQ-DB-03a] 🔴 CR-01: khoá bị gỡ khỏi bán SAU KHI đã đặt đơn (cổng đã kiểm lúc đặt) ⇒ thu đủ VẪN CẤP quyền; sổ ghi lý do kiểm toán; không vào hàng đợi từ chối", async () => {
      const { k, r, itemId } = await donDaDat();
      await thu(r.orderId, 500_000);
      await doiTrangThaiBan(db, { courseId: k.courseId, saleStatus: "NOT_ON_SALE" });
      const kq = await capQuyenOnlineChoDon(db, r.orderId, NOW);
      expect(kq.dong).toEqual([{ orderItemId: itemId, ketQua: "DA_CAP" }]);
      expect(await db.onlEntitlement.count({ where: { courseId: k.courseId } })).toBe(1);
      const ev = await db.onlEntitlementEvent.findFirstOrThrow({ where: { idempotencyKey: `onl-order:${itemId}` } });
      expect(ev.reason ?? "").toMatch(/Đã kiểm cổng đang-bán lúc đặt đơn/);
      expect((await docHangDoiCapQuyenOnline(db, { gioiHan: 50 })).biTuChoi.map((x) => x.orderItemId)).not.toContain(itemId);
    });

    it("[OCQ-DB-03] 🔴 lỗi LUẬT sau khi đã thu (khoá bị XOÁ giữa lúc đặt và trả — CR-01 KHÔNG miễn) ⇒ REJECTED, KHÔNG thử lại, hiện ở hàng đợi cho người xử lý tiền", async () => {
      const { k, r, itemId } = await donDaDat();
      await thu(r.orderId, 500_000);
      await db.onlCourse.update({ where: { id: k.courseId }, data: { deletedAt: new Date() } });
      const kq = await capQuyenOnlineChoDon(db, r.orderId, NOW);
      expect(kq.dong).toEqual([{ orderItemId: itemId, ketQua: "TU_CHOI_LUAT", ma: "KHOA_KHONG_TON_TAI" }]);
      expect(await db.onlEntitlement.count({ where: { courseId: k.courseId } })).toBe(0);
      const g = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: r.orderId } });
      expect(g).toMatchObject({ status: "REJECTED", lastErrorCode: "KHOA_KHONG_TON_TAI", attempts: 1 });
      expect((await capQuyenOnlineChoDon(db, r.orderId, NOW)).coDongOnline).toBe(false); // không nhặt lại
      const hd = await docHangDoiCapQuyenOnline(db, { gioiHan: 50 });
      expect(hd.biTuChoi.map((x) => x.orderItemId)).toContain(itemId);
    });

    it("[OCQ-DB-04] 🔴 lỗi HẠ TẦNG ⇒ không ném ra, ghi lỗi + hẹn thử lại (backoff); lần sau thành công ⇒ cấp; quá số lần ⇒ NEEDS_REVIEW", async () => {
      const { r, itemId, a, k } = await donDaDat();
      await thu(r.orderId, 500_000);
      const goc = db.$transaction.bind(db);
      const spy = vi.spyOn(db, "$transaction").mockImplementationOnce((() => Promise.reject(new Error("mất kết nối giả"))) as never);
      const loi = await capQuyenOnlineChoDon(db, r.orderId, NOW);
      expect(loi.dong).toEqual([{ orderItemId: itemId, ketQua: "LOI_HA_TANG", ma: "LOI_HA_TANG" }]);
      const g1 = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: r.orderId } });
      expect(g1).toMatchObject({ status: "PENDING", attempts: 1, lastErrorCode: "LOI_HA_TANG" });
      expect(g1.nextRetryAt?.getTime()).toBe(hanThuLai(NOW, 1).getTime());
      spy.mockRestore();
      void goc;
      expect((await capQuyenOnlineChoDon(db, r.orderId, NOW)).dong.map((d) => d.ketQua)).toEqual(["DA_CAP"]);
      expect(await db.onlEntitlement.count({ where: { studentId: a.id, courseId: k.courseId } })).toBe(1);

      // quá số lần
      const o2 = await donDaDat();
      await thu(o2.r.orderId, 500_000);
      vi.spyOn(db, "$transaction").mockImplementation((() => Promise.reject(new Error("hạ tầng chết"))) as never);
      for (let i = 0; i < TOI_DA_LAN_THU; i++) await capQuyenOnlineChoDon(db, o2.r.orderId, NOW);
      vi.restoreAllMocks();
      const g2 = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: o2.r.orderId } });
      expect(g2).toMatchObject({ status: "NEEDS_REVIEW", attempts: TOI_DA_LAN_THU });
      expect((await docHangDoiCapQuyenOnline(db, { gioiHan: 50 })).canXemTay.map((x) => x.orderItemId)).toContain(o2.itemId);
    });

    it("[OCQ-DB-10] 🔴 CR-02 (lỗi của `capQuyenHoc` khi hai lượt cùng khoá chạy chồng): lượt THUA không thấy sự kiện của lượt THẮNG lúc kiểm khoá ⇒ trả lỗi luật, nhưng cầu nối hỏi SỔ và ghi ĐÚNG là đã cấp — không REJECTED oan", async () => {
      const { a, k, r, itemId } = await donDaDat();
      await thu(r.orderId, 500_000);
      // Lượt THẮNG: cấp bằng ĐÚNG khoá của dòng đơn (như một lượt webhook chạy trước, đã commit).
      const thang = await capQuyenHoc(db, { studentId: a.id, courseId: k.courseId, loai: "MUA", idempotencyKey: `onl-order:${itemId}`, now: NOW, orderId: r.orderId, orderItemId: itemId });
      expect(thang.ok).toBe(true);
      // Lượt THUA: kiểm khoá idempotency (câu đầu của giao dịch) mô phỏng thấy snapshot cũ ⇒ không thấy sự kiện ⇒ rơi vào luật ⇒ KHOA_KHONG_CHO_GIA_HAN.
      const that = db.$transaction.bind(db);
      vi.spyOn(db, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => unknown, opts?: unknown) =>
        (that as unknown as (f: unknown, o?: unknown) => unknown)(async (tx: Record<string, unknown>) => {
          const sev = tx.onlEntitlementEvent as Record<string, unknown>;
          const tx2 = new Proxy(tx, { get: (t, p, rc) => (p === "onlEntitlementEvent" ? new Proxy(sev, { get: (tt, pp, r2) => (pp === "findUnique" ? async () => null : Reflect.get(tt, pp, r2)) }) : Reflect.get(t, p, rc)) });
          return fn(tx2);
        }, opts)) as never);
      const kq = await capQuyenOnlineChoDon(db, r.orderId, NOW);
      expect(kq.dong).toEqual([{ orderItemId: itemId, ketQua: "DA_CAP_TRUOC_DO" }]);
      const g = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: r.orderId } });
      expect(g).toMatchObject({ status: "GRANTED", entitlementId: thang.ok ? thang.entitlementId : "?" });
      expect(await db.onlEntitlementEvent.count({ where: { entitlementId: thang.ok ? thang.entitlementId : "?" } })).toBe(1); // không cấp đôi
    });

    it("[OCQ-DB-11] 🔴 đường tiền THẬT: `sauKhiDonThuDu` (chốt đơn + cấp tài khoản + biên nhận) chạy được trên đơn ONLINE không cơ sở — không ném, không tạo tài khoản phụ huynh thừa, đơn CONFIRMED, và cầu nối vẫn cấp quyền", async () => {
      const { ph, a, k, r } = await donDaDat();
      await thu(r.orderId, 500_000);
      const truoc = await db.user.count({ where: { OR: [{ phone: ph.phone }, { role: "PARENT" }] } });
      const chot = await sauKhiDonThuDu({ orderId: r.orderId, soTien: 500_000, providerTxnId: `CIOCK-${Date.now()}`, nguoiChot: "Cổng thanh toán (thử)", nhanDonChotNgam: false, nhanPhuongThuc: null });
      expect(chot).toBe(true);
      expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe("CONFIRMED");
      expect(await db.user.count({ where: { OR: [{ phone: ph.phone }, { role: "PARENT" }] } })).toBe(truoc); // không đẻ tài khoản
      await hichCapQuyenHocChoDon(r.orderId, "WEBHOOK_CU", NOW);
      expect(await db.onlEntitlement.count({ where: { studentId: a.id, courseId: k.courseId, status: "ACTIVE" } })).toBe(1);
      // lượt chốt thứ hai không chốt lại (idempotent), quyền không cấp đôi
      expect(await sauKhiDonThuDu({ orderId: r.orderId, soTien: 500_000, providerTxnId: `CIOCK-${Date.now()}b`, nguoiChot: "Cổng thanh toán (thử)", nhanDonChotNgam: false, nhanPhuongThuc: null })).toBe(false);
      await hichCapQuyenHocChoDon(r.orderId, "WEBHOOK_CU", NOW);
      expect(await db.onlEntitlementEvent.count({ where: { entitlement: { studentId: a.id } } })).toBe(1);
    });

    it("[OCQ-DB-12] 🔴 ĐẦU–CUỐI qua webhook ngân hàng THẬT (`ingestPayosWebhook`): giỏ → đơn → tiền về khớp phiếu → quyền học cấp NGAY và hiện trong danh sách học; webhook gửi lại không cấp đôi; tiền THIẾU không cấp", async () => {
      const ph = await phuHuynh("q12");
      const a = await con(ph.id, "a");
      const k = await dungKhoa({ gia: 500_000 });
      const r = await datDon(ph.id, gio({ courseId: k.courseId, studentId: a.id }));
      const phieu = await db.paymentRequest.findFirstOrThrow({ where: { orderId: r.orderId }, select: { matchKey: true } });
      expect(phieu.matchKey).toBeTruthy();
      const veTien = (reference: string, amount: number) => ({ reference, description: `${phieu.matchKey} HOC PHI ONLINE`, amount, transactionDateTime: "2026-11-20 12:00:00", accountNumber: "9999000000001" });
      // thiếu tiền: không được cấp quyền
      const thieu = await ingestPayosWebhook(veTien(`CIOCK12A${Date.now()}`, 300_000), "SEPAY");
      expect(["MATCHED", "UNMATCHED"]).toContain(thieu.status);
      expect(await db.onlEntitlement.count({ where: { studentId: a.id } })).toBe(0);
      expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: ph.id, studentId: a.id, now: new Date() })).toEqual([]);
      // đủ tiền (phần còn lại) ⇒ webhook tự cấp quyền, KHÔNG chờ hoá đơn/kế toán
      const refDu = `CIOCK12B${Date.now()}`;
      const du = await ingestPayosWebhook(veTien(refDu, 500_000 - (thieu.status === "MATCHED" ? 300_000 : 0)), "SEPAY");
      expect(["MATCHED", "UNMATCHED"]).toContain(du.status);
      const g = await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: r.orderId } });
      if (du.status === "MATCHED") {
        expect(g.status).toBe("GRANTED");
        const ds = await docKhoaOnlineCuaHocVien(db, { parentUserId: ph.id, studentId: a.id, now: new Date() });
        expect(ds?.map((d) => d.courseId)).toEqual([k.courseId]);
        expect(await db.onlEntitlementEvent.count({ where: { entitlement: { studentId: a.id } } })).toBe(1);
      }
      // webhook GỬI LẠI cùng mã giao dịch ⇒ không rót/cấp đôi
      const lai = await ingestPayosWebhook(veTien(refDu, 200_000), "SEPAY");
      expect(lai.status).not.toBe("MATCHED");
      expect(await db.onlEntitlementEvent.count({ where: { entitlement: { studentId: a.id } } })).toBe(1);
      expect(await db.payment.count({ where: { orderId: r.orderId, deletedAt: null } })).toBeLessThanOrEqual(2);
      expect({ thieu: thieu.status, du: du.status, grant: g.status }).toEqual({ thieu: "MATCHED", du: "MATCHED", grant: "GRANTED" });
    });

    it("[OCQ-DB-05] gia hạn qua đơn: quyền còn hạn + khoá cho gia hạn ⇒ cộng hạn ĐÚNG MỘT LẦN, sự kiện RENEWED, lượt thứ hai không cộng thêm", async () => {
      const ph = await phuHuynh("q5");
      const a = await con(ph.id, "a");
      const k = await dungKhoa({ thang: 6, gia: 500_000, giaHan: 200_000 });
      const c = await capQuyenHoc(db, { studentId: a.id, courseId: k.courseId, loai: "MUA", now: NOW, idempotencyKey: `ci-ock-q5-${k.courseId}` });
      if (!c.ok) throw new Error(c.thongBao);
      const r = await datDon(ph.id, gio({ courseId: k.courseId, studentId: a.id }));
      expect(r.dong[0]).toMatchObject({ loaiMua: "GIA_HAN", thanhTien: 200_000 });
      await thu(r.orderId, 200_000);
      await capQuyenOnlineChoDon(db, r.orderId, NOW);
      await capQuyenOnlineChoDon(db, r.orderId, NOW);
      const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: a.id, courseId: k.courseId } });
      expect(q.expiresAt!.getTime()).toBeGreaterThan(c.hetHan!.getTime());
      const ev = await db.onlEntitlementEvent.findMany({ where: { entitlementId: q.id }, orderBy: { createdAt: "asc" }, select: { kind: true } });
      expect(ev.map((e) => e.kind)).toEqual(["GRANTED", "RENEWED"]);
    });

    it("[OCQ-DB-06] 🔴 hích thật của đường tiền (`hichCapQuyenHocChoDon`): nguồn thuận cấp; nguồn CHIỀU NGƯỢC không cấp; đơn không phải online không ném", async () => {
      const { a, k, r } = await donDaDat();
      await thu(r.orderId, 500_000);
      await hichCapQuyenHocChoDon(r.orderId, "TIEN_BI_HOAN", NOW);
      expect(await db.onlEntitlement.count({ where: { studentId: a.id, courseId: k.courseId } })).toBe(0); // chiều ngược KHÔNG cấp
      await hichCapQuyenHocChoDon(r.orderId, "WEBHOOK_CU", NOW);
      expect(await db.onlEntitlement.count({ where: { studentId: a.id, courseId: k.courseId, status: "ACTIVE" } })).toBe(1);
      await expect(hichCapQuyenHocChoDon("don-khong-ton-tai", "WEBHOOK_CU", NOW)).resolves.toBeUndefined();
      // hích lỗi hạ tầng không làm ném ra đường tiền
      vi.spyOn(db.orderOnlineGrant, "findMany").mockRejectedValueOnce(new Error("giả lập"));
      await expect(hichCapQuyenHocChoDon(r.orderId, "WEBHOOK_CU", NOW)).resolves.toBeUndefined();
    });

    it("[OCQ-DB-07] đối soát (cron): nhặt đơn đã thu mà hích bị mất; tôn trọng hạn thử lại; đơn HUỶ rơi khỏi hàng đợi, nếu có tiền về thì hiện để người quyết", async () => {
      const o1 = await donDaDat();
      await thu(o1.r.orderId, 500_000); // hích bị mất: không ai gọi capQuyenOnlineChoDon
      const o2 = await donDaDat(); // chưa thu
      const o3 = await donDaDat();
      await huyDonOnlineChuaThanhToan(db, { parentUserId: o3.ph.id, orderId: o3.r.orderId, now: NOW });
      await thu(o3.r.orderId, 500_000); // khách chuyển khoản muộn vào đơn đã huỷ
      await db.orderOnlineGrant.updateMany({ where: { orderId: o2.r.orderId }, data: { nextRetryAt: new Date(NOW.getTime() + 3_600_000) } }); // chưa tới hạn
      const kq = await doiSoatCapQuyenOnline(db, NOW, { gioiHan: 100 });
      expect(kq.daCap).toBeGreaterThanOrEqual(1);
      expect((await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: o1.r.orderId } })).status).toBe("GRANTED");
      expect((await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: o2.r.orderId } })).status).toBe("PENDING"); // chưa tới hạn ⇒ không đụng
      expect((await db.orderOnlineGrant.findFirstOrThrow({ where: { orderId: o3.r.orderId } })).status).toBe("PENDING"); // đơn huỷ ⇒ không cấp
      const hd = await docHangDoiCapQuyenOnline(db, { gioiHan: 100 });
      expect(hd.daHuyNhungCoTien.map((x) => x.orderId)).toContain(o3.r.orderId);
      expect(await db.onlEntitlement.count({ where: { studentId: o3.a.id } })).toBe(0);
    });

    it("[OCQ-DB-08] hoàn/huỷ SAU khi đã cấp: KHÔNG tự thu hồi (chính sách chưa chốt) — nhưng hiện ở hàng đợi", async () => {
      const { a, k, r, itemId } = await donDaDat();
      await thu(r.orderId, 500_000);
      await capQuyenOnlineChoDon(db, r.orderId, NOW);
      await db.order.update({ where: { id: r.orderId }, data: { status: "REFUNDED" } });
      await doiSoatCapQuyenOnline(db, NOW, { gioiHan: 100 });
      expect(await db.onlEntitlement.count({ where: { studentId: a.id, courseId: k.courseId, status: "ACTIVE" } })).toBe(1);
      expect((await docHangDoiCapQuyenOnline(db, { gioiHan: 100 })).hoanNhungConQuyen.map((x) => x.orderItemId)).toContain(itemId);
    });

    it("[OCQ-DB-09] 🔴 phụ huynh thấy trạng thái cấp ĐÚNG sau thanh toán (làm mới): chờ ⇒ đã cấp (kèm hạn); lỗi luật ⇒ CAN_NHAN_VIEN_XU_LY; người khác ⇒ null", async () => {
      const { ph, r } = await donDaDat();
      const khac = await phuHuynh("q9x");
      expect((await docDonOnlineCuaPhuHuynh(db, { parentUserId: ph.id, orderId: r.orderId }))?.dong.map((d) => d.trangThai)).toEqual(["DANG_CHO_THANH_TOAN"]);
      await thu(r.orderId, 500_000);
      await capQuyenOnlineChoDon(db, r.orderId, NOW);
      const sau = await docDonOnlineCuaPhuHuynh(db, { parentUserId: ph.id, orderId: r.orderId });
      expect(sau).toMatchObject({ daThu: 500_000, tongTien: 500_000 });
      expect(sau?.dong[0]).toMatchObject({ trangThai: "DA_CAP_QUYEN" });
      expect(sau?.dong[0]!.hetHan).toBeInstanceOf(Date);
      expect(await docDonOnlineCuaPhuHuynh(db, { parentUserId: khac.id, orderId: r.orderId })).toBeNull();
      expect((await docDanhSachDonOnline(db, { parentUserId: ph.id })).map((o) => o.orderId)).toEqual([r.orderId]);
      expect(await docDanhSachDonOnline(db, { parentUserId: khac.id })).toEqual([]);
    });
  });

  // ───────────── Chống truy cập chéo + tách bạch ─────────────
  describe("[OXC] chống truy cập chéo phụ huynh/học viên", () => {
    it("[OXC-DB-01] 🔴 MỌI hàm mặt phụ huynh từ chối phụ huynh KHÁC (cùng khoá, cùng bài) — kèm đối chứng dương cho chính chủ", async () => {
      const chu = await phuHuynh("x1");
      const ke = await phuHuynh("x2");
      const a = await con(chu.id, "a");
      const k = await dungKhoa();
      const c = await capQuyenHoc(db, { studentId: a.id, courseId: k.courseId, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: `ci-ock-x-${k.courseId}` });
      if (!c.ok) throw new Error(c.thongBao);
      const bai = await db.onlLesson.findFirstOrThrow({ where: { version: { courseId: k.courseId } }, select: { stableId: true } });
      const goc = { studentId: a.id, courseId: k.courseId, lessonStableId: bai.stableId, now: NOW };

      // ── chính chủ (đối chứng dương) ──
      expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: chu.id, studentId: a.id, now: NOW })).toHaveLength(1);
      expect((await docMucLucKhoaCuaHocVien(db, { parentUserId: chu.id, studentId: a.id, courseId: k.courseId, now: NOW })).ok).toBe(true);
      expect((await kiemTraTruyCapChoPhuHuynh(db, { parentUserId: chu.id, ...goc })).ok).toBe(true);
      expect(await docChungNhanCuaHocVien(db, { parentUserId: chu.id, studentId: a.id })).toEqual([]);
      expect((await docKhoaMuaDuocChoCon(db, { parentUserId: chu.id, studentId: a.id, now: NOW }))?.length).toBeGreaterThan(0);

      // ── phụ huynh khác: mọi đường đều bị chặn, không phân biệt "không có" / "không phải của bạn" ──
      expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: ke.id, studentId: a.id, now: NOW })).toBeNull();
      expect(await docMucLucKhoaCuaHocVien(db, { parentUserId: ke.id, studentId: a.id, courseId: k.courseId, now: NOW })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await kiemTraTruyCapChoPhuHuynh(db, { parentUserId: ke.id, ...goc })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await ghiTienDoBai(db, { parentUserId: ke.id, ...goc, percent: 100 } as never)).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await capVeMedia(db, { parentUserId: ke.id, ...goc })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await batDauLamBai(db, { parentUserId: ke.id, ...goc })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await nopBai(db, { parentUserId: ke.id, ...goc, attemptId: "x", traLoi: {} })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await docKetQuaCacLuot(db, { parentUserId: ke.id, ...goc })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
      expect(await docChungNhanCuaHocVien(db, { parentUserId: ke.id, studentId: a.id })).toBeNull();
      expect(await docKhoaMuaDuocChoCon(db, { parentUserId: ke.id, studentId: a.id, now: NOW })).toBeNull();
      // không phải phụ huynh nào / học viên mồ côi
      const moCoi = await con(null, "mo-coi");
      expect(await docKhoaOnlineCuaHocVien(db, { parentUserId: chu.id, studentId: moCoi.id, now: NOW })).toBeNull();
    });

    it("[OXC-DB-02] 🔴 huỷ/đọc đơn của người khác ⇒ KHÔNG tìm thấy và đơn NGUYÊN VẸN; chính chủ huỷ được", async () => {
      const chu = await phuHuynh("x3");
      const ke = await phuHuynh("x4");
      const a = await con(chu.id, "a");
      const k = await dungKhoa();
      const r = await datDon(chu.id, gio({ courseId: k.courseId, studentId: a.id }));
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ke.id, orderId: r.orderId, now: NOW })).toMatchObject({ ok: false, ma: "KHONG_TIM_THAY" });
      expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe("PENDING_PAYMENT");
      expect(await docDonOnlineCuaPhuHuynh(db, { parentUserId: ke.id, orderId: r.orderId })).toBeNull();
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: chu.id, orderId: r.orderId, now: NOW })).toMatchObject({ ok: true });
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: chu.id, orderId: r.orderId, now: NOW })).toEqual({ ok: true, daHuyTruocDo: true }); // idempotent
    });

    it("[OXC-DB-03] huỷ đơn đã có tiền / đã cấp quyền bị từ chối (tiền đã vào thì không tự huỷ)", async () => {
      const ph = await phuHuynh("x5");
      const a = await con(ph.id, "a");
      const k = await dungKhoa();
      const r = await datDon(ph.id, gio({ courseId: k.courseId, studentId: a.id }));
      await thu(r.orderId, 100_000);
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: r.orderId, now: NOW })).toMatchObject({ ok: false, ma: "DA_CO_TIEN" });
      await thu(r.orderId, 400_000);
      await capQuyenOnlineChoDon(db, r.orderId, NOW);
      expect(await huyDonOnlineChuaThanhToan(db, { parentUserId: ph.id, orderId: r.orderId, now: NOW })).toMatchObject({ ok: false, ma: "DA_CAP_QUYEN" });
    });

    it("[OXC-DB-04] gợi ý mua cho con: ĐÚNG luật của tạo đơn (đang học còn hạn không gia hạn ⇒ không mua; trọn đời ⇒ TRON_DOI; chưa có ⇒ MUA_DUOC kèm giá)", async () => {
      const ph = await phuHuynh("x6");
      const a = await con(ph.id, "a");
      const [moi, khongGh, tron] = [await dungKhoa({ gia: 111_000 }), await dungKhoa({ thang: 6 }), await dungKhoa({ thang: null })];
      for (const k of [khongGh, tron]) await capQuyenHoc(db, { studentId: a.id, courseId: k.courseId, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: `ci-ock-x6-${k.courseId}` });
      const ds = (await docKhoaMuaDuocChoCon(db, { parentUserId: ph.id, studentId: a.id, now: NOW }))!;
      const tt = (id: string) => ds.find((d) => d.courseId === id)!;
      expect(tt(moi.courseId)).toMatchObject({ trangThai: "MUA_DUOC", gia: 111_000 });
      expect(tt(khongGh.courseId)).toMatchObject({ trangThai: "DANG_HOC_KHONG_GIA_HAN", gia: null });
      expect(tt(tron.courseId)).toMatchObject({ trangThai: "TRON_DOI", gia: null });
    });
  });
});
