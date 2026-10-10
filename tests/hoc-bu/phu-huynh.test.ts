// tests/hoc-bu/phu-huynh.test.ts — T11: cổng phụ huynh đọc kết quả học bù qua mô hình T08, đơn xin bù gắn đúng dòng và TỰ ĐÓNG, trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chuyenTrangThaiDong, dongYeuCauPhuHuynh } from "@/lib/hoc-bu/dong-service";
import { goKhoiCase } from "@/lib/hoc-bu/case-db";
import { portalDb } from "@/lib/portal/db";
import { kiemDongChoYeuCau } from "@/lib/portal/yeu-cau-bu";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { ADMIN, HV, buoiGoc, diemDanh, don, dung, id, mucCua, needId, tao, tatCa } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[PHY] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const PH = id("ph");
const PH_KHAC = id("ph-khac");
const pdb = (childIds: string[], parentUserId = PH) => portalDb({ parentUserId, childIds });

const yeuCau = (o: { studentId: string; needId?: string | null; sessionId?: string | null; type?: "MAKEUP" | "ABSENCE" | "OTHER"; status?: "PENDING" | "APPROVED"; parentUserId?: string }) =>
  db.parentRequest.create({
    data: {
      studentId: o.studentId,
      parentUserId: o.parentUserId ?? PH,
      type: o.type ?? "MAKEUP",
      content: "Xin học bù",
      makeupNeedId: o.needId ?? null,
      sessionId: o.sessionId ?? null,
      status: o.status ?? "PENDING",
    },
    select: { id: true },
  });
const trangThai = async (reqId: string) => db.parentRequest.findUniqueOrThrow({ where: { id: reqId } });

async function donPh() {
  await db.parentRequest.deleteMany({ where: { studentId: { in: Object.values(HV) } } });
  await don();
}

describe.skipIf(!RUN_DB_TESTS)("[PHY] cổng phụ huynh + đơn xin học bù — T11", () => {
  beforeEach(async () => {
    await donPh();
    await dung();
  });
  afterAll(donPh);

  it("[PHY-01] xếp dòng vào case ⇒ đơn xin bù GẮN dòng đó tự đóng APPROVED (do 'Hệ thống'), cùng giao dịch; đơn của dòng khác / loại khác / đã xử lý KHÔNG bị đụng", async () => {
    const dongA5 = await yeuCau({ studentId: HV.A, needId: needId("A", 5) });
    const dongA6 = await yeuCau({ studentId: HV.A, needId: needId("A", 6) });
    const baoVang = await yeuCau({ studentId: HV.A, type: "ABSENCE", sessionId: buoiGoc(5) });
    const daDuyet = await yeuCau({ studentId: HV.A, needId: needId("A", 5), status: "APPROVED" });
    await tao([needId("A", 5)]);
    const a5 = await trangThai(dongA5.id);
    expect(a5).toMatchObject({ status: "APPROVED", handledByName: "Hệ thống" });
    expect(a5.response).toContain("đã xếp lịch học bù");
    expect(a5.handledAt).not.toBeNull();
    expect((await trangThai(dongA6.id)).status).toBe("PENDING"); // dòng A6 chưa xếp
    expect((await trangThai(baoVang.id)).status).toBe("PENDING"); // loại khác
    expect(await trangThai(daDuyet.id)).toMatchObject({ status: "APPROVED", handledByName: null }); // đã xử lý trước — không ghi đè người xử lý
  });

  it("[PHY-02] đơn CŨ chưa có khoá dòng (chỉ học viên + buổi gốc) cũng đóng khi dòng được xếp; đơn của HỌC VIÊN KHÁC cùng buổi thì không", async () => {
    const cu = await yeuCau({ studentId: HV.A, sessionId: buoiGoc(6) });
    const nguoiKhac = await yeuCau({ studentId: HV.B, sessionId: buoiGoc(6), parentUserId: PH_KHAC });
    await tao([needId("A", 6)]);
    expect((await trangThai(cu.id)).status).toBe("APPROVED");
    expect((await trangThai(nguoiKhac.id)).status).toBe("PENDING"); // B6 chưa xếp
  });

  it("[PHY-03] quản lý HUỶ 'không bù nữa' ⇒ đơn REJECTED với câu nói đúng; buổi gốc sửa sang có mặt (tự thu hồi) ⇒ REJECTED với câu khác", async () => {
    const r1 = await yeuCau({ studentId: HV.C, needId: needId("C", 7) });
    await db.$transaction((tx) =>
      chuyenTrangThaiDong(tx, { ids: [needId("C", 7)], tu: "PENDING", sang: "CANCELLED", lyDo: "HUY_KHONG_BU", ngoai: { waivedAt: null }, them: { waivedAt: new Date(), waivedReason: "PH xin không bù" } }),
    );
    expect(await trangThai(r1.id)).toMatchObject({ status: "REJECTED", response: "Trung tâm không tổ chức học bù cho buổi này." });
    const r2 = await yeuCau({ studentId: HV.B, needId: needId("B", 6) });
    await db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [needId("B", 6)], tu: "PENDING", sang: "CANCELLED", lyDo: "TU_HUY_DA_CO_MAT" }));
    expect((await trangThai(r2.id)).response).toContain("đã được ghi nhận có mặt");
  });

  it("[PHY-04] đơn đã đóng KHÔNG còn chiếm trần 10 đơn mở: phụ huynh 10 đơn PENDING, xếp 3 dòng ⇒ còn 7", async () => {
    const dongs = [...tatCa("A"), needId("B", 6), needId("B", 7), needId("C", 7), needId("D", 8)];
    for (const n of dongs) {
      const sv = (await db.makeupNeed.findUniqueOrThrow({ where: { id: n }, select: { studentId: true } })).studentId;
      await yeuCau({ studentId: sv, needId: n });
    }
    for (let i = 0; i < 3; i++) await yeuCau({ studentId: HV.D, type: "OTHER" });
    expect(await db.parentRequest.count({ where: { parentUserId: PH, status: "PENDING" } })).toBe(10);
    await tao(tatCa("A")); // 3 dòng của A được xếp
    expect(await db.parentRequest.count({ where: { parentUserId: PH, status: "PENDING" } })).toBe(7);
  });

  it("[PHY-05] cổng tạo đơn: chỉ dòng CÒN CHỜ XẾP của CON MÌNH, mỗi dòng một đơn mở; đã xếp / đã bù / đã huỷ / dòng nhà khác bị từ chối với câu nói đúng", async () => {
    const con = pdb([HV.A, HV.B]);
    const ok = await kiemDongChoYeuCau(con, { studentId: HV.A, needId: needId("A", 5) });
    expect(ok).toEqual({ ok: true, sessionId: buoiGoc(5) });
    // Dòng của nhà khác (C không thuộc phụ huynh này): không khớp ⇒ "không hợp lệ" (không lộ tồn tại).
    expect(await kiemDongChoYeuCau(con, { studentId: HV.A, needId: needId("C", 7) })).toEqual({ ok: false, error: "Buổi cần bù không hợp lệ" });
    expect(await kiemDongChoYeuCau(pdb([HV.B]), { studentId: HV.A, needId: needId("A", 5) })).toEqual({ ok: false, error: "Buổi cần bù không hợp lệ" });
    // Dòng của CON KHÁC cùng nhà (B6) không gắn được vào đơn của con đang chọn (A) — kể cả khi cả hai đều thuộc phụ huynh này.
    expect(await kiemDongChoYeuCau(con, { studentId: HV.A, needId: needId("B", 6) })).toEqual({ ok: false, error: "Buổi cần bù không hợp lệ" });
    // Đơn mở trùng (khoá mới) và đơn cũ (chỉ buổi gốc).
    await yeuCau({ studentId: HV.A, needId: needId("A", 5) });
    expect(await kiemDongChoYeuCau(con, { studentId: HV.A, needId: needId("A", 5) })).toMatchObject({ ok: false, error: expect.stringContaining("đã gửi yêu cầu") });
    await yeuCau({ studentId: HV.A, sessionId: buoiGoc(6) });
    expect(await kiemDongChoYeuCau(con, { studentId: HV.A, needId: needId("A", 6) })).toMatchObject({ ok: false, error: expect.stringContaining("đã gửi yêu cầu") });
    // Đã xếp / đã bù / đã huỷ.
    await tao([needId("A", 7)]);
    expect(await kiemDongChoYeuCau(con, { studentId: HV.A, needId: needId("A", 7) })).toMatchObject({ ok: false, error: expect.stringContaining("đã được trung tâm xếp lịch") });
    await db.makeupNeed.update({ where: { id: needId("B", 6) }, data: { status: "COMPLETED" } });
    expect(await kiemDongChoYeuCau(con, { studentId: HV.B, needId: needId("B", 6) })).toMatchObject({ ok: false, error: "Buổi này đã học bù xong." });
    await db.makeupNeed.update({ where: { id: needId("B", 7) }, data: { status: "CANCELLED", waivedAt: new Date() } });
    expect(await kiemDongChoYeuCau(con, { studentId: HV.B, needId: needId("B", 7) })).toMatchObject({ ok: false, error: "Buổi này không còn cần học bù." });
  });

  it("[PHY-06] CỔNG PHỤ HUYNH đọc qua mô hình T08: đã xếp ⇒ ngày · giờ · cơ sở · phòng · giáo viên · bài; bù xong ⇒ kèm đánh giá; bài chưa xong ⇒ vẫn chờ xếp kèm lần trước; cờ đơn mở", async () => {
    await yeuCau({ studentId: HV.A, needId: needId("A", 7) }); // đơn mở cho bài 7 (chưa xếp)
    const c = await tao([needId("A", 5), needId("A", 6)]);
    const xep = await getStudentMakeup(HV.A);
    const m5 = [...xep.needList, ...xep.history].find((m) => m.id === needId("A", 5))!;
    expect(m5.status).toBe("SCHEDULED");
    expect(m5.ketQua.trangThai).toBe("DA_XEP");
    expect(m5.ketQua.hienTai).toMatchObject({ ngay: "15/10/2026", gio: "18:00–19:30", coSo: "Cơ sở T07", phong: "Phòng T07", giaoVien: "GV T07", loai: "DA_XEP" });
    expect(m5.ketQua.hienTai!.bai).toContain("5");
    expect(m5.ketQua.hienTai!.danhGia).toBeNull();

    await diemDanh(c, "A", true, { 5: "COMPLETED", 6: "NOT_COMPLETED" });
    const sau = await getStudentMakeup(HV.A);
    const tat = [...sau.needList, ...sau.history];
    const xong = tat.find((m) => m.id === needId("A", 5))!;
    expect(xong.ketQua).toMatchObject({ trangThai: "DA_BU", nhan: "Đã học bù ngày 15/10/2026" });
    expect(xong.ketQua.hienTai).toMatchObject({ loai: "DA_XONG", danhGia: "Đánh giá A5", giaoVien: "GV T07" });
    // Bài 6 chưa xong: về danh sách CẦN BÙ, kèm lần trước (có mặt nhưng chưa hoàn thành) + đánh giá.
    const chua = sau.needList.find((m) => m.id === needId("A", 6))!;
    expect(chua.ketQua.trangThai).toBe("CHO_XEP");
    expect(chua.ketQua.hienTai).toBeNull();
    expect(chua.ketQua.lichSu.map((l) => l.loai)).toEqual(["CHUA_XONG"]);
    expect(chua.ketQua.lichSu[0]!.danhGia).toBe("Đánh giá A6");
    // Bài 7: đơn mở ⇒ cờ bật; bài 6 chưa có đơn ⇒ tắt.
    expect(sau.needList.find((m) => m.id === needId("A", 7))!.yeuCauMo).toBe(true);
    expect(chua.yeuCauMo).toBe(false);
    expect(sau.doneCount).toBe(1);
  });

  it("[PHY-07] mỗi phụ huynh chỉ thấy buổi bù / đánh giá của CON MÌNH: đọc con B không lộ gì của con A trong cùng case", async () => {
    const c = await tao([needId("A", 5), needId("B", 6)]);
    await diemDanh(c, "A", true, { 5: "COMPLETED" });
    await diemDanh(c, "B", true, { 6: "COMPLETED" });
    const b = await getStudentMakeup(HV.B);
    const json = JSON.stringify(b);
    expect(json).not.toContain("Đánh giá A5");
    expect(json).not.toContain("Bé T07 A");
    expect(b.history.every((m) => m.id !== needId("A", 5))).toBe(true);
    expect([...b.needList, ...b.history].find((m) => m.id === needId("B", 6))!.ketQua.hienTai?.danhGia).toBe("Đánh giá B6");
  });
  it("[PHY-08] `dongYeuCauPhuHuynh` chỉ đóng đơn khi dòng ĐÃ Ở trạng thái đích và KHÔNG đóng khi dòng quay về PENDING; lần bị gỡ khỏi case không hiện ở cổng phụ huynh", async () => {
    const r = await yeuCau({ studentId: HV.A, needId: needId("A", 5) }); // dòng A5 còn PENDING
    // Gọi với trạng thái đích SCHEDULED nhưng dòng CHƯA ở SCHEDULED (đường `chiNeuCo` có thể truyền id chưa đổi) ⇒ không đóng.
    expect(await db.$transaction((tx) => dongYeuCauPhuHuynh(tx, [needId("A", 5)], "SCHEDULED", "XEP_CASE"))).toBe(0);
    // Về PENDING không phải một lý do đóng đơn (đơn mới của phụ huynh sau một lần bù thất bại phải sống).
    expect(await db.$transaction((tx) => dongYeuCauPhuHuynh(tx, [needId("A", 5)], "PENDING", "GO_KHOI_CASE"))).toBe(0);
    expect((await trangThai(r.id)).status).toBe("PENDING");
    // Xếp rồi GỠ: dòng về PENDING, đơn đã đóng ở lần xếp; cổng phụ huynh không bày lần bị gỡ như một lần thử.
    const c = await tao([needId("A", 5)]);
    expect((await trangThai(r.id)).status).toBe("APPROVED");
    await goKhoiCase(ADMIN, (await mucCua(c, "A", 5)).id);
    const kq = (await getStudentMakeup(HV.A)).needList.find((m) => m.id === needId("A", 5))!;
    expect(kq.ketQua).toMatchObject({ trangThai: "CHO_XEP", hienTai: null, lichSu: [] });
  });
});

