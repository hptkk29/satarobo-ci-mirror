// @vitest-environment node
/**
 * [ONL-CC-*] E-learning ONLINE — CẠNH TRANH GIAO DỊCH của `capQuyenHoc` / `thuHoiQuyenHoc` (Postgres thật). Đóng CR-01 + CR-02 của Workstream A.
 *
 * CR-02 (đã TÁI HIỆN): kiểm khoá idempotency ở câu ĐẦU giao dịch, TRƯỚC khi khoá dòng quyền, và `SELECT … FOR UPDATE` trả rỗng khi dòng chưa tồn tại ⇒ lượt
 * THUA đua cùng khoá thấy quyền do lượt THẮNG vừa tạo (câu đọc sau) và rơi vào luật ⇒ trả LỖI LUẬT oan (`KHOA_KHONG_CHO_GIA_HAN`/`DA_TRON_DOI`) dù sự kiện của
 * CHÍNH khoá này đã được ghi. Đường tiền (webhook gửi trùng) đánh dấu đơn đã trả tiền là "bị từ chối" ⇒ MẤT quyền đã mua.
 * Vá: khoá tư vấn theo (học viên × khoá) ĐẦU giao dịch, rồi mới kiểm khoá idempotency.
 *
 * ⚠️ Cố ý chạy nhiều VÒNG × nhiều LƯỢT SONG SONG: lỗi cạnh tranh là xác suất — một lượt đơn lẻ xanh không chứng minh gì (ca cũ `[ONL-DB-03]` dùng 2 lượt và
 * khoá `choGiaHan: true` nên che mất lỗi).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { caiDatKhoiDauChoBanNhap } from "../../lib/elearning-online/cai-dat-hoc-tap";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { donBangOnl } from "./_onl-don";

const P = "CI_ONLCC_";
const NOW = new Date(Date.UTC(2026, 10, 20, 5, 0, 0));
let n = 0;
const khoaKey = (t: string) => `${P}${t}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function don() {
  await donBangOnl(db);
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
}
async function dungKhoa(o: { thang: number | null; choGiaHan: boolean; ban?: "ON_SALE" | "NOT_ON_SALE"; moBanLuc?: Date | null; trangThaiBan?: "SCHEDULED" }) {
  const i = ++n;
  const code = `CI-ONLCC-${Date.now().toString(36).toUpperCase()}-${i}`;
  const khoa = await db.onlCourse.create({
    data: {
      code, slug: code.toLowerCase(), name: `${P}Khoá ${i}`, validityMonths: o.thang, renewalEnabled: o.choGiaHan,
      ...(o.choGiaHan ? { renewalPrice: 100_000 } : {}), saleStatus: o.trangThaiBan ?? o.ban ?? "ON_SALE", saleOpensAt: o.moBanLuc ?? null, listPrice: 500_000, salePrice: 500_000,
    },
    select: { id: true },
  });
  const ban = await db.onlCourseVersion.create({ data: { courseId: khoa.id, number: 1, status: "PUBLISHED", publishedAt: NOW, settingsJson: { ...caiDatKhoiDauChoBanNhap(), moBaiTiepTheo: "MO_HET" } as object }, select: { id: true } });
  await db.onlCourse.update({ where: { id: khoa.id }, data: { publishedVersionId: ban.id } });
  return khoa.id;
}
const hocVien = (t: string) => db.student.create({ data: { name: `${P}${t}-${++n}` }, select: { id: true } });
const SONG = 12;
const VONG = 8;

describe.skipIf(!RUN_DB_TESTS)("[ONL-CC] cạnh tranh giao dịch quyền học (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it(`🔴 [ONL-CC-01] ${SONG} lượt MUA song song CÙNG khoá idempotency × ${VONG} vòng (khoá KHÔNG cho gia hạn): MỌI lượt ok, đúng MỘT lượt thật sự cấp, một quyền, một sự kiện`, async () => {
    const k = await dungKhoa({ thang: 6, choGiaHan: false });
    for (let v = 0; v < VONG; v++) {
      const hv = await hocVien("cc01");
      const key = khoaKey("webhook");
      const kq = await Promise.all(Array.from({ length: SONG }, () => capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "MUA", now: NOW, idempotencyKey: key })));
      const hong = kq.filter((x) => !x.ok);
      expect(hong, `vòng ${v}: lượt bị từ chối oan: ${JSON.stringify(hong)}`).toEqual([]);
      expect(kq.filter((x) => x.ok && !x.daXuLyTruocDo)).toHaveLength(1);
      const q = await db.onlEntitlement.findMany({ where: { studentId: hv.id, courseId: k }, select: { id: true } });
      expect(q).toHaveLength(1);
      expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q[0]!.id } })).toBe(1);
    }
  }, 120_000);

  it(`🔴 [ONL-CC-02] khoá CHO gia hạn: ${SONG} lượt song song cùng khoá ⇒ hạn cộng ĐÚNG MỘT lần (không gia hạn đôi), một sự kiện`, async () => {
    const k = await dungKhoa({ thang: 6, choGiaHan: true });
    for (let v = 0; v < VONG; v++) {
      const hv = await hocVien("cc02");
      const dau = await capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: khoaKey("dau") });
      expect(dau.ok).toBe(true);
      const key = khoaKey("giahan");
      const kq = await Promise.all(Array.from({ length: SONG }, () => capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "MUA", now: NOW, idempotencyKey: key })));
      expect(kq.filter((x) => !x.ok), `vòng ${v}`).toEqual([]);
      const han = new Set(kq.map((x) => (x.ok ? x.hetHan?.getTime() : null)));
      expect(han.size, "mọi lượt phải trả CÙNG một hạn").toBe(1);
      const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId: k }, select: { id: true, expiresAt: true } });
      expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q.id } })).toBe(2); // GRANTED + đúng MỘT RENEWED
      expect(q.expiresAt!.getTime()).toBe([...han][0]);
    }
  }, 120_000);

  it(`🔴 [ONL-CC-03] ${SONG} lượt THU HỒI song song CÙNG khoá ⇒ MỌI lượt ok, đúng một sự kiện REVOKED`, async () => {
    const k = await dungKhoa({ thang: 6, choGiaHan: false });
    for (let v = 0; v < VONG; v++) {
      const hv = await hocVien("cc03");
      await capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: khoaKey("dau") });
      const key = khoaKey("thu");
      const kq = await Promise.all(Array.from({ length: SONG }, () => thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k, reason: "thu hồi thử nghiệm cạnh tranh", idempotencyKey: key, now: NOW })));
      expect(kq.filter((x) => !x.ok), `vòng ${v}`).toEqual([]);
      expect(kq.filter((x) => x.ok && !x.daXuLyTruocDo)).toHaveLength(1);
      const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId: k }, select: { id: true, status: true } });
      expect(q.status).toBe("REVOKED");
      expect(await db.onlEntitlementEvent.count({ where: { entitlementId: q.id, kind: "REVOKED" } })).toBe(1);
    }
  }, 120_000);

  it("[ONL-CC-04] cấp (khoá A) đua thu hồi (khoá B) trên cùng quyền: không ném, sổ nhất quán — trạng thái cuối khớp sự kiện CUỐI trong sổ", async () => {
    const k = await dungKhoa({ thang: 6, choGiaHan: true });
    for (let v = 0; v < VONG; v++) {
      const hv = await hocVien("cc04");
      await capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "CAP_MIEN_PHI", now: NOW, idempotencyKey: khoaKey("dau") });
      const [a, b] = await Promise.all([
        capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "MUA", now: NOW, idempotencyKey: khoaKey("gh") }),
        thuHoiQuyenHoc(db, { studentId: hv.id, courseId: k, reason: "thu hồi đua với gia hạn", idempotencyKey: khoaKey("th"), now: NOW }),
      ]);
      expect(a.ok && b.ok).toBe(true);
      const q = await db.onlEntitlement.findFirstOrThrow({ where: { studentId: hv.id, courseId: k }, select: { id: true, status: true } });
      const ev = await db.onlEntitlementEvent.findMany({ where: { entitlementId: q.id }, orderBy: { createdAt: "asc" }, select: { kind: true } });
      expect(ev).toHaveLength(3);
      const cuoi = ev[ev.length - 1]!.kind;
      // thu hồi cuối cùng ⇒ REVOKED; gia hạn/mở lại cuối cùng ⇒ ACTIVE (mở lại sau thu hồi cũng ghi ACTIVE)
      expect(q.status).toBe(cuoi === "REVOKED" ? "REVOKED" : "ACTIVE");
    }
  }, 120_000);

  it("🔴 [ONL-CC-05] CR-01: đơn ĐẶT lúc khoá đang bán, tiền về sau khi khoá bị gỡ khỏi bán ⇒ cấp được khi truyền `banLucDatDon`; không truyền ⇒ vẫn từ chối (hành vi cũ)", async () => {
    const k = await dungKhoa({ thang: 6, choGiaHan: false });
    const datDon = new Date(NOW.getTime() - 3_600_000);
    await db.onlCourse.update({ where: { id: k }, data: { saleStatus: "NOT_ON_SALE" } }); // gỡ khỏi bán SAU khi đặt đơn
    const hv = await hocVien("cc05");
    const cu = await capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "MUA", now: NOW, idempotencyKey: khoaKey("cu") });
    expect(cu).toMatchObject({ ok: false, ma: "KHOA_KHONG_DANG_BAN" }); // đối chứng ÂM: hành vi cũ nguyên vẹn
    // Cờ chỉ hợp lệ KÈM đơn hàng tham chiếu (dấu vết kiểm toán): thiếu `orderId` ⇒ từ chối rõ ràng, không lặng lẽ bỏ qua cờ.
    expect(await capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "MUA", now: NOW, idempotencyKey: khoaKey("thieu"), daKiemCongBanLucDatDon: datDon })).toMatchObject({ ok: false, ma: "THIEU_THAM_CHIEU_DON" });
    expect(await db.onlEntitlement.count({ where: { studentId: hv.id, courseId: k } })).toBe(0);
    const moi = await capQuyenHoc(db, { studentId: hv.id, courseId: k, loai: "MUA", now: NOW, idempotencyKey: khoaKey("moi"), orderId: "don-thu-cc05", daKiemCongBanLucDatDon: datDon });
    expect(moi.ok).toBe(true);
    const ev = await db.onlEntitlementEvent.findFirstOrThrow({ where: { entitlement: { studentId: hv.id } }, select: { reason: true, orderId: true } });
    expect(ev.orderId).toBe("don-thu-cc05");
    expect(ev.reason).toContain("Đã kiểm cổng đang-bán lúc đặt đơn"); // kiểm toán thấy cổng đã được miễn
    expect(await db.onlEntitlement.count({ where: { studentId: hv.id, courseId: k, status: "ACTIVE" } })).toBe(1);
    // đối chứng ÂM thứ hai: khoá đã XOÁ MỀM thì vẫn không cấp dù có cờ
    const k2 = await dungKhoa({ thang: 6, choGiaHan: false });
    await db.onlCourse.update({ where: { id: k2 }, data: { deletedAt: NOW } });
    expect(await capQuyenHoc(db, { studentId: hv.id, courseId: k2, loai: "MUA", now: NOW, idempotencyKey: khoaKey("xoa"), orderId: "don-thu-cc05b", daKiemCongBanLucDatDon: datDon })).toMatchObject({ ok: false, ma: "KHOA_KHONG_TON_TAI" });
  });
});
