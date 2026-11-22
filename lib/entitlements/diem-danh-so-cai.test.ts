// lib/entitlements/diem-danh-so-cai.test.ts — LUẬT THUẦN của đồng bộ sổ cái từ điểm danh: lọc cơ sở, chọn quyền học, kế hoạch ghi/huỷ.
// Phần chạm Postgres (khoá, bằng chứng đọc từ DB, cờ tắt không truy vấn, đồng thời): tests/finance/quyen-hoc-diem-danh.test.ts.
import { describe, expect, it } from "vitest";
import {
  chonQuyenHocChoBai,
  keHoachBai,
  locTheoCoSo,
  type DongSoCaiChoBai,
  type QuyenHocChoDongBo,
  type ViecDongBo,
} from "./diem-danh-so-cai";
import type { BangChungBai } from "./dong-bo-bai";

const T0 = new Date("2026-10-01T00:00:00Z");
const q = (id: string, o: Partial<QuyenHocChoDongBo> = {}): QuyenHocChoDongBo => ({
  id,
  centerId: "cs1",
  status: "ACTIVE",
  startLessonOrder: 1,
  endLessonOrder: 12,
  graceSessionsGranted: 0,
  freeMakeupSessions: 0,
  createdAt: T0,
  ...o,
});
const KHONG: BangChungBai = { trangThaiDiemDanh: [], hocBuHoanTat: false, hocVuotHoanTat: false };
const CO_MAT: BangChungBai = { trangThaiDiemDanh: ["PRESENT"], hocBuHoanTat: false, hocVuotHoanTat: false };
const dong = (entitlementId: string, source: DongSoCaiChoBai["source"], voided = false): DongSoCaiChoBai => ({
  entitlementId,
  source,
  voidedAt: voided ? T0 : null,
});

describe("[DDS-01] locTheoCoSo — quyền học khác cơ sở KHÔNG bao giờ tới tầng ghi", () => {
  it("tách đúng theo centerId của cờ đã đọc, giữ thứ tự", () => {
    const ds = [q("a"), q("b", { centerId: "cs2" }), q("c")];
    const r = locTheoCoSo(ds, "cs1");
    expect(r.dung.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.khac.map((x) => x.id)).toEqual(["b"]);
  });
  it("cơ sở chưa có quyền học nào ⇒ dung rỗng (fail-closed, không rơi về 'tất cả')", () => {
    expect(locTheoCoSo([q("a")], "cs-la").dung).toEqual([]);
  });
});

describe("[DDS-02] chonQuyenHocChoBai", () => {
  it("bài nằm trong [start,end] ⇒ chọn quyền học đó", () => {
    expect(chonQuyenHocChoBai([q("a", { startLessonOrder: 1, endLessonOrder: 12 }), q("b", { startLessonOrder: 13, endLessonOrder: 24 })], 14)?.id).toBe("b");
  });
  it("chỉ quyền ĐANG DẠY (ACTIVE/EXHAUSTED) nhận bài mới; FROZEN / AWAITING_PLACEMENT / SEAT_HOLD / COMPLETED không", () => {
    for (const status of ["FROZEN", "AWAITING_PLACEMENT", "SEAT_HOLD", "COMPLETED", "EXPIRED", "STOPPED"] as const) {
      expect(chonQuyenHocChoBai([q("a", { status })], 5), status).toBeNull();
    }
    expect(chonQuyenHocChoBai([q("a", { status: "EXHAUSTED" })], 5)?.id).toBe("a");
  });
  it("bài ngay sau `end` trong dải ân hạn ⇒ chọn; quá dải ân hạn ⇒ null", () => {
    const ds = [q("a", { endLessonOrder: 12, graceSessionsGranted: 2, status: "EXHAUSTED" })];
    expect(chonQuyenHocChoBai(ds, 13)?.id).toBe("a");
    expect(chonQuyenHocChoBai(ds, 14)?.id).toBe("a");
    expect(chonQuyenHocChoBai(ds, 15)).toBeNull();
  });
  it("dải của quyền mới ưu tiên hơn dải ân hạn của quyền cũ (mua tiếp chồng lên ân hạn)", () => {
    const cu = q("cu", { startLessonOrder: 1, endLessonOrder: 12, graceSessionsGranted: 3, status: "EXHAUSTED" });
    const moi = q("moi", { startLessonOrder: 13, endLessonOrder: 24 });
    expect(chonQuyenHocChoBai([cu, moi], 13)?.id).toBe("moi");
  });
  it("hai quyền cùng start ⇒ chọn theo createdAt rồi id (kết quả không phụ thuộc thứ tự đọc)", () => {
    const a = q("b", { createdAt: new Date("2026-10-02T00:00:00Z") });
    const b = q("a", { createdAt: new Date("2026-10-02T00:00:00Z") });
    expect(chonQuyenHocChoBai([a, b], 3)?.id).toBe("a");
    expect(chonQuyenHocChoBai([b, a], 3)?.id).toBe("a");
  });
  it("bài ngoài phạm vi ⇒ null", () => {
    expect(chonQuyenHocChoBai([q("a")], 30)).toBeNull();
  });
});

describe("[DDS-03] keHoachBai — ghi / huỷ theo BẰNG CHỨNG, không theo sự kiện", () => {
  const viec = (r: { viec: readonly ViecDongBo[] }) => r.viec;

  it("có mặt, chưa có dòng, quyền học chứa bài ⇒ GHI nguồn CLASS", () => {
    expect(viec(keHoachBai({ quyen: [q("a")], dong: [], bangChung: CO_MAT, lessonOrder: 5 }))).toEqual([
      { viec: "GHI", entitlementId: "a", nguon: "CLASS", baiBoSung: false },
    ]);
  });
  it("trễ (LATE) cũng là có mặt", () => {
    const r = keHoachBai({ quyen: [q("a")], dong: [], bangChung: { ...KHONG, trangThaiDiemDanh: ["LATE"] }, lessonOrder: 5 });
    expect(viec(r)).toHaveLength(1);
  });
  it("vắng (mọi loại) KHÔNG phải bằng chứng ⇒ không ghi", () => {
    for (const s of ["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"]) {
      const r = keHoachBai({ quyen: [q("a")], dong: [], bangChung: { ...KHONG, trangThaiDiemDanh: [s] }, lessonOrder: 5 });
      expect(r, s).toEqual({ viec: [], khongDongBo: [] });
    }
  });
  it("sửa có mặt → vắng: dòng CLASS còn sống mà hết bằng chứng ⇒ HUY", () => {
    expect(viec(keHoachBai({ quyen: [q("a")], dong: [dong("a", "CLASS")], bangChung: KHONG, lessonOrder: 5 }))).toEqual([{ viec: "HUY", entitlementId: "a" }]);
  });
  it("sửa vắng → có mặt sau khi đã huỷ: dòng vô hiệu + có bằng chứng ⇒ GHI lại trên CHÍNH quyền học đó (bật lại, không chèn dòng khác)", () => {
    const r = keHoachBai({ quyen: [q("a"), q("b", { startLessonOrder: 1, endLessonOrder: 12 })], dong: [dong("b", "CLASS", true)], bangChung: CO_MAT, lessonOrder: 5 });
    expect(viec(r)).toEqual([{ viec: "GHI", entitlementId: "b", nguon: "CLASS", baiBoSung: false }]);
  });
  it("ĐÃ BÙ XONG rồi giáo viên lưu lại lưới (vẫn VẮNG): dòng MAKEUP còn bằng chứng bù ⇒ KHÔNG huỷ nhầm", () => {
    const r = keHoachBai({
      quyen: [q("a")],
      dong: [dong("a", "MAKEUP")],
      bangChung: { trangThaiDiemDanh: ["ABSENT"], hocBuHoanTat: true, hocVuotHoanTat: false },
      lessonOrder: 5,
    });
    expect(r).toEqual({ viec: [], khongDongBo: [] });
  });
  it("chuỗi vắng → bù → sửa có mặt → hoàn bù: bằng chứng CLASS thắng nhưng dòng cũ vẫn còn sống ⇒ không làm gì thêm", () => {
    const r = keHoachBai({ quyen: [q("a")], dong: [dong("a", "MAKEUP")], bangChung: { trangThaiDiemDanh: ["PRESENT"], hocBuHoanTat: false, hocVuotHoanTat: false }, lessonOrder: 5 });
    expect(r.viec).toEqual([]);
  });
  it("học vượt hoàn tất (không điểm danh) ⇒ GHI nguồn CATCH_UP", () => {
    const r = keHoachBai({ quyen: [q("a")], dong: [], bangChung: { ...KHONG, hocVuotHoanTat: true }, lessonOrder: 5 });
    expect(viec(r)).toEqual([{ viec: "GHI", entitlementId: "a", nguon: "CATCH_UP", baiBoSung: false }]);
  });
  it("dòng do người ghi (MANUAL) hoặc ân hạn (GRACE): hàm KHÔNG đụng dù thiếu bằng chứng", () => {
    expect(keHoachBai({ quyen: [q("a")], dong: [dong("a", "MANUAL")], bangChung: KHONG, lessonOrder: 5 }).viec).toEqual([]);
    expect(keHoachBai({ quyen: [q("a")], dong: [dong("a", "GRACE")], bangChung: KHONG, lessonOrder: 5 }).viec).toEqual([]);
    expect(keHoachBai({ quyen: [q("a")], dong: [dong("a", "MANUAL", true)], bangChung: CO_MAT, lessonOrder: 5 }).viec).toEqual([]);
  });
  it("dòng của quyền học đã bị LOẠI (khác cơ sở) không được huỷ và không chặn việc ghi vào quyền hợp lệ", () => {
    const r = keHoachBai({ quyen: [q("a")], dong: [dong("khac-co-so", "CLASS")], bangChung: KHONG, lessonOrder: 5 });
    expect(r.viec).toEqual([]);
    const r2 = keHoachBai({ quyen: [q("a")], dong: [dong("khac-co-so", "CLASS")], bangChung: CO_MAT, lessonOrder: 5 });
    expect(r2.viec).toEqual([{ viec: "GHI", entitlementId: "a", nguon: "CLASS", baiBoSung: false }]);
  });
  it("bài học bù MIỄN PHÍ (FREE_MAKEUP) ⇒ GHI đánh dấu baiBoSung để người ghi khử trùng audit", () => {
    const r = keHoachBai({ quyen: [q("a", { startLessonOrder: 4, endLessonOrder: 12, freeMakeupSessions: 3 })], dong: [], bangChung: { ...KHONG, hocBuHoanTat: true }, lessonOrder: 5 });
    expect(r.viec).toEqual([{ viec: "GHI", entitlementId: "a", nguon: "MAKEUP", baiBoSung: true }]);
    const ngoai = keHoachBai({ quyen: [q("a", { startLessonOrder: 4, endLessonOrder: 12, freeMakeupSessions: 3 })], dong: [], bangChung: CO_MAT, lessonOrder: 8 });
    expect(ngoai.viec[0]).toMatchObject({ baiBoSung: false });
  });
  it("có bằng chứng mà không quyền học nào (cùng cơ sở) chứa bài ⇒ không ghi, BÁO NGOAI_PHAM_VI", () => {
    expect(keHoachBai({ quyen: [q("a")], dong: [], bangChung: CO_MAT, lessonOrder: 30 })).toEqual({ viec: [], khongDongBo: ["NGOAI_PHAM_VI"] });
  });
  it("học viên không có quyền học nào (cũ / LEGACY) ⇒ không ghi và KHÔNG báo bất thường", () => {
    expect(keHoachBai({ quyen: [], dong: [], bangChung: CO_MAT, lessonOrder: 5 })).toEqual({ viec: [], khongDongBo: [] });
  });
  it("quyền học đang BẢO LƯU (FROZEN) không nhận bài mới: có bằng chứng cũng không chọn nó", () => {
    expect(keHoachBai({ quyen: [q("a", { status: "FROZEN" })], dong: [], bangChung: CO_MAT, lessonOrder: 5 })).toEqual({ viec: [], khongDongBo: ["NGOAI_PHAM_VI"] });
  });
  it("bài trong dải ân hạn ⇒ GHI (tầng ghi quyết ân hạn hay không)", () => {
    const r = keHoachBai({ quyen: [q("a", { endLessonOrder: 12, graceSessionsGranted: 2, status: "EXHAUSTED" })], dong: [], bangChung: CO_MAT, lessonOrder: 13 });
    expect(r.viec).toEqual([{ viec: "GHI", entitlementId: "a", nguon: "CLASS", baiBoSung: false }]);
  });
});

describe("[DDS-04] HỘI TỤ: áp kế hoạch lên sổ cái rồi lập lại kế hoạch ⇒ không còn việc gì", () => {
  /** Mô phỏng tầng ghi chỉ ở mức dòng sổ cái: GHI = có dòng sống (bật lại nếu vô hiệu), HUY = vô hiệu. */
  function ap(dongHienCo: DongSoCaiChoBai[], viec: readonly ViecDongBo[]): DongSoCaiChoBai[] {
    const ra = dongHienCo.map((d) => ({ ...d }));
    for (const v of viec) {
      const i = ra.findIndex((d) => d.entitlementId === v.entitlementId);
      if (v.viec === "GHI") {
        if (i >= 0) ra[i] = { ...ra[i]!, voidedAt: null };
        else ra.push({ entitlementId: v.entitlementId, source: v.nguon, voidedAt: null });
      } else if (i >= 0) ra[i] = { ...ra[i]!, voidedAt: T0 };
    }
    return ra;
  }
  const quyen = [q("a")];

  it("lưu cùng một trạng thái nhiều lần cho cùng kết quả (idempotent)", () => {
    let so: DongSoCaiChoBai[] = [];
    so = ap(so, keHoachBai({ quyen, dong: so, bangChung: CO_MAT, lessonOrder: 5 }).viec);
    const sau1 = JSON.stringify(so);
    for (let i = 0; i < 3; i++) {
      const kh = keHoachBai({ quyen, dong: so, bangChung: CO_MAT, lessonOrder: 5 });
      expect(kh.viec).toEqual([]);
      so = ap(so, kh.viec);
    }
    expect(JSON.stringify(so)).toBe(sau1);
  });

  it("có mặt → vắng → có mặt → vắng: số dòng sống luôn khớp bằng chứng hiện tại, không nhân đôi, không lệch", () => {
    let so: DongSoCaiChoBai[] = [];
    const chuoi: Array<[BangChungBai, number]> = [
      [CO_MAT, 1],
      [KHONG, 0],
      [CO_MAT, 1],
      [CO_MAT, 1],
      [KHONG, 0],
      [KHONG, 0],
    ];
    for (const [bc, mongDoi] of chuoi) {
      so = ap(so, keHoachBai({ quyen, dong: so, bangChung: bc, lessonOrder: 5 }).viec);
      expect(so.filter((d) => d.voidedAt === null)).toHaveLength(mongDoi);
      expect(so.length).toBeLessThanOrEqual(1);
    }
  });
});
