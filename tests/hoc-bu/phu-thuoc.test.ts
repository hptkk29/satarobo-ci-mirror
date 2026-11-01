// tests/hoc-bu/phu-thuoc.test.ts — T14: CỔNG PHỤ THUỘC HỌC BÙ trên Postgres THẬT. Luật thuần: lib/hoc-bu/phu-thuoc.test.ts (PT-*).
//
// Chứng minh bằng dữ liệu thật: buổi / bài / điểm danh / đơn phí mà học bù còn trỏ tới bị CHẶN xoá (kể cả dòng đã huỷ hoặc đã bù xong — lịch sử),
// còn thứ không ai trỏ tới thì xoá được; và thứ bị chặn KHÔNG bị xoá (chưa từng có phép xoá nào chạy).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { demDongBuTroToiDon, kiemPhuThuocHocBu } from "@/lib/hoc-bu/phu-thuoc";
import { taoPhiBu } from "@/lib/hoc-bu/case-db";
import { demDauVetDon } from "@/lib/orders/xoa-don-db";
import { lyDoKhongXoaDuoc } from "@/lib/orders/xoa-don-huy";
import { ADMIN, BAI, BAI_KHAC, CS, HV, LOP, buoiGoc, diemDanh, don, dung, id, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[PTD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

describe.skipIf(!RUN_DB_TESTS)("[PTD] cổng phụ thuộc học bù — T14", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[PTD-01] BUỔI: buổi vắng gốc của dòng cần bù bị chặn; buổi không ai trỏ tới thì xoá được; dòng ĐÃ HUỶ vẫn chặn (lịch sử)", async () => {
    const chan = await kiemPhuThuocHocBu("BUOI", [buoiGoc(5)]);
    expect(chan).toContain("Không xoá được buổi học");
    expect(chan).toContain("dòng học bù");
    expect(chan).toContain("HUỶ buổi");
    // Buổi mới, không dòng nào trỏ tới ⇒ xoá được.
    await db.classSession.create({ data: { id: id("buoi-trong"), classId: LOP, date: new Date("2026-10-25T11:00:00.000Z"), lessonId: BAI[8], status: "SCHEDULED", centerId: CS } });
    expect(await kiemPhuThuocHocBu("BUOI", [id("buoi-trong")])).toBeNull();
    // Huỷ không bù (dòng CANCELLED) vẫn là lịch sử ⇒ vẫn chặn.
    await db.makeupNeed.updateMany({ where: { missedSessionId: buoiGoc(8) }, data: { status: "CANCELLED", waivedAt: new Date(), waivedReason: "Phụ huynh không bù" } });
    expect(await kiemPhuThuocHocBu("BUOI", [buoiGoc(8)])).not.toBeNull();
    // Cả lô: một buổi vướng là cả lô bị chặn.
    expect(await kiemPhuThuocHocBu("BUOI", [id("buoi-trong"), buoiGoc(6)])).not.toBeNull();
    // Chặn thì KHÔNG xoá gì: buổi còn nguyên.
    expect(await db.classSession.count({ where: { id: buoiGoc(5) } })).toBe(1);
  });

  it("[PTD-02] BUỔI: nơi một bé đã HỌC BÙ (Attendance.makeupSessionId) cũng bị chặn — buổi đó là chứng cứ của lần bù", async () => {
    const buoiBu = id("buoi-bu-cu");
    await db.classSession.create({ data: { id: buoiBu, classId: LOP, date: new Date("2026-10-26T11:00:00.000Z"), lessonId: BAI[5], status: "COMPLETED", centerId: CS } });
    expect(await kiemPhuThuocHocBu("BUOI", [buoiBu])).toBeNull();
    await db.attendance.update({ where: { id: `${buoiGoc(5)}-A` }, data: { makeupStatus: "MADE_UP", makeupSessionId: buoiBu } });
    expect(await kiemPhuThuocHocBu("BUOI", [buoiBu])).toContain('đánh dấu "đã học bù"');
  });

  it("[PTD-03] BÀI: bài vắng của dòng cần bù và bài nằm trong bộ bài của case bị chặn; bài không ai dùng thì được", async () => {
    expect(await kiemPhuThuocHocBu("BAI", [BAI[5]])).toContain("bài vắng");
    expect(await kiemPhuThuocHocBu("BAI", [BAI_KHAC])).toBeNull();
    // Bài 8 chỉ có dòng của D; sau khi D được xếp vào case bộ bài [8] thì vẫn chặn (cả hai nguồn).
    const c = await tao([needId("D", 8)]);
    expect(c).toBeTruthy();
    const r = await kiemPhuThuocHocBu("BAI", [BAI[8]]);
    expect(r).toContain("case dạy bù có bài này");
    expect(r).toContain("mục trong case");
  });

  it("[PTD-04] ĐIỂM DANH: điểm danh gốc của dòng cần bù bị chặn; điểm danh không ai trỏ tới thì được", async () => {
    expect(await kiemPhuThuocHocBu("DIEM_DANH", [`${buoiGoc(5)}-A`])).toContain("điểm danh gốc");
    await db.attendance.create({ data: { id: id("diem-danh-co-mat"), sessionId: buoiGoc(8), studentId: HV.A, status: "PRESENT", centerId: CS } });
    expect(await kiemPhuThuocHocBu("DIEM_DANH", [id("diem-danh-co-mat")])).toBeNull();
  });

  it("[PTD-05] ĐƠN PHÍ: dòng cần bù còn trỏ tới đơn phí ⇒ `demDauVetDon` đếm và `lyDoKhongXoaDuoc` chặn (kể cả đơn đã huỷ); đơn không ai trỏ tới thì không bị chặn vì vế này", async () => {
    await dung({ A: 0, B: 3, C: 3, D: 3 });
    const { orderId } = await taoPhiBu(ADMIN, needId("A", 5));
    expect(await demDongBuTroToiDon(orderId)).toBe(1);
    await db.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    const dauVet = await demDauVetDon(orderId, "CANCELLED");
    expect(dauVet.soDongHocBu).toBe(1);
    const { phieuIds: _phieu, ...chiSo } = dauVet;
    void _phieu;
    const lyDo = lyDoKhongXoaDuoc({ ...chiSo, soKhoanThu: 0, soPhanBo: 0, soMaQrConSong: 0, soPhieuGopConSong: 0, soHoaDon: 0, soXuatKho: 0, soSoDuTinDung: 0 });
    expect(lyDo).toContain("1 dòng học bù trỏ tới đơn phí này");
    // Đối chứng: gỡ con trỏ thì vế học bù hết chặn.
    await db.makeupNeed.update({ where: { id: needId("A", 5) }, data: { feeOrderItemId: null } });
    expect(await demDongBuTroToiDon(orderId)).toBe(0);
  });

  it("[PTD-06] sau khi cả case đã DẠY XONG, buổi gốc / bài / điểm danh của nó VẪN bị chặn (lịch sử bù không được mồ côi)", async () => {
    const c = await tao([needId("C", 7)]);
    await diemDanh(c, "C", true, { 7: "COMPLETED" });
    expect(await kiemPhuThuocHocBu("BUOI", [buoiGoc(7)])).not.toBeNull();
    expect(await kiemPhuThuocHocBu("BAI", [BAI[7]])).not.toBeNull();
    expect(await kiemPhuThuocHocBu("DIEM_DANH", [`${buoiGoc(7)}-C`])).not.toBeNull();
  });
});
