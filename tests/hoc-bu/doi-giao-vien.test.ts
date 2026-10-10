// tests/hoc-bu/doi-giao-vien.test.ts — ĐỔI GIÁO VIÊN DẠY BÙ (chủ dự án chốt 09/10/2026), trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
// Yêu cầu nghiệm thu: sửa được GIÁO VIÊN của case; giáo viên CŨ mất quyền ngay, giáo viên MỚI có quyền; công dạy đi theo người dạy thật; cổng phụ huynh
// hiện đúng người; báo cả hai giáo viên. Ca "KHÔNG" luôn đi với ca "CÓ" (đối chứng dương) — nếu chỉ khẳng định sự vắng mặt thì lỗi hỏng hẳn vẫn xanh.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { LoiHocBu, diemDanhBe, suaCase } from "@/lib/hoc-bu/case-db";
import { docChiTietCaseV2ChoGv } from "@/lib/hoc-bu/case-chi-tiet";
import { loadBuoiDay } from "@/lib/cham-cong/cong-day-db";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { ADMIN, GV, GV2, HV, NOW, beCua, don, dung, mucCua, needId, tao } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[DGV] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const TU = new Date(Date.UTC(2026, 9, 1));
const DEN = new Date(Date.UTC(2026, 9, 31));
const buoiBu = async (gv: string) => (await loadBuoiDay([gv], TU, DEN)).filter((b) => b.source === "MAKEUP");
const loi = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof LoiHocBu ? e.message : `LOI-KHAC: ${String(e)}`));

describe.skipIf(!RUN_DB_TESTS)("[DGV] đổi giáo viên dạy bù — quyền · công · thông báo · phụ huynh", () => {
  beforeEach(() => dung());
  afterAll(don);

  async function caseHaiBe() {
    const caseId = await tao([needId("B", 6), needId("B", 7)]); // giáo viên mặc định = GV
    const c = await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } });
    return { caseId, version: c.version };
  }

  it("[DGV-01] trước khi đổi: GV thấy + điểm danh được case, GV2 thì KHÔNG (null / bị từ chối) — đối chứng cho ca sau", async () => {
    const { caseId } = await caseHaiBe();
    expect((await docChiTietCaseV2ChoGv(GV, caseId))?.id).toBe(caseId);
    expect(await docChiTietCaseV2ChoGv(GV2, caseId)).toBeNull();
    const be = await beCua(caseId, "B");
    const g = await loi(diemDanhBe(null, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, chiGiaoVien: GV2, now: NOW }));
    expect(g).toContain("không phải giáo viên");
  });

  it("[DGV-02] ĐỔI GIÁO VIÊN (suaCase): giáo viên CŨ mất quyền đọc + điểm danh, giáo viên MỚI có; phiên bản tăng; nhật ký ghi cũ → mới", async () => {
    const { caseId, version } = await caseHaiBe();
    await suaCase(ADMIN, { caseId, phienBan: version, teacherId: GV2, ten: "QL", now: NOW });
    const sau = await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(sau).toMatchObject({ teacherId: GV2, version: version + 1 });

    // Giáo viên CŨ: hết thấy, hết điểm danh được.
    expect(await docChiTietCaseV2ChoGv(GV, caseId)).toBeNull();
    const be = await beCua(caseId, "B");
    expect(await loi(diemDanhBe(null, { participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null, chiGiaoVien: GV, now: NOW }))).toContain("không phải giáo viên");
    // Giáo viên MỚI: thấy và điểm danh được (có mặt, hai bài xong).
    expect((await docChiTietCaseV2ChoGv(GV2, caseId))?.id).toBe(caseId);
    const m6 = await mucCua(caseId, "B", 6);
    const m7 = await mucCua(caseId, "B", 7);
    await diemDanhBe(null, {
      participantId: be.id,
      coMat: true,
      ketQuaMuc: { [m6.id]: { ketQua: "COMPLETED", danhGia: "Tốt" }, [m7.id]: { ketQua: "COMPLETED", danhGia: "Tốt" } },
      nhanXetChung: "Con học tốt",
      chiGiaoVien: GV2,
      now: NOW,
    });
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("COMPLETED");

    const nk = await db.auditLog.findFirstOrThrow({ where: { entityType: "MakeupCase", entityId: caseId, action: "hoc-bu.sua-case" } });
    expect(JSON.stringify(nk.oldValues)).toContain(GV);
    expect(JSON.stringify(nk.newValues)).toContain(GV2);
  });

  it("[DGV-03] CÔNG dạy bù đi theo người DẠY THẬT: sau khi đổi và hoàn thành, GV2 có ĐÚNG MỘT buổi công, GV không có", async () => {
    const { caseId, version } = await caseHaiBe();
    await suaCase(ADMIN, { caseId, phienBan: version, teacherId: GV2, ten: "QL", now: NOW });
    const be = await beCua(caseId, "B");
    const m6 = await mucCua(caseId, "B", 6);
    const m7 = await mucCua(caseId, "B", 7);
    await diemDanhBe(null, {
      participantId: be.id,
      coMat: true,
      ketQuaMuc: { [m6.id]: { ketQua: "COMPLETED", danhGia: "Tốt" }, [m7.id]: { ketQua: "NOT_COMPLETED", danhGia: "Chưa xong" } },
      nhanXetChung: null,
      chiGiaoVien: GV2,
      now: NOW,
    });
    const hai = await buoiBu(GV2);
    expect(hai).toHaveLength(1);
    expect(hai[0]).toMatchObject({ id: caseId, source: "MAKEUP", userId: GV2 });
    expect(await buoiBu(GV)).toEqual([]);
  });

  it("[DGV-04] đổi giáo viên SANG người KHÔNG có ca phủ giờ ⇒ từ chối, giáo viên cũ GIỮ NGUYÊN (không ghi nửa chừng); đối chứng: GV2 có ca ⇒ đổi được", async () => {
    const { caseId, version } = await caseHaiBe();
    // Đổi sang ngày 20/10 — không ai có ca ngày đó (fixture chỉ phủ 15 và 16/10) ⇒ KHÔNG đổi được dù chọn giáo viên nào.
    const truot = await loi(suaCase(ADMIN, { caseId, phienBan: version, teacherId: GV2, ymd: "2026-10-20", ten: "QL", now: NOW }));
    expect(truot).not.toBeNull();
    expect(await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).toMatchObject({ teacherId: GV, version });
    expect(await loi(suaCase(ADMIN, { caseId, phienBan: version, teacherId: GV2, ten: "QL", now: NOW }))).toBeNull();
  });

  it("[DGV-05] đổi giáo viên phát SỰ KIỆN đổi case (báo giáo viên mới + cũ, phụ huynh); chỉ đổi ghi chú thì KHÔNG phát", async () => {
    const { caseId, version } = await caseHaiBe();
    const dem = () => db.domainEvent.count({ where: { type: "makeup.case.changed" } });
    const truoc = await dem();
    await suaCase(ADMIN, { caseId, phienBan: version, note: "chỉ ghi chú", ten: "QL", now: NOW });
    expect(await dem()).toBe(truoc); // đối chứng: không đổi giờ giấc của ai ⇒ không báo
    await suaCase(ADMIN, { caseId, phienBan: version + 1, teacherId: GV2, ten: "QL", now: NOW });
    expect(await dem()).toBe(truoc + 1);
  });

  it("[DGV-06] CỔNG PHỤ HUYNH hiện đúng giáo viên mới sau khi đổi", async () => {
    const { caseId, version } = await caseHaiBe();
    const ten = async () => {
      const x = await getStudentMakeup(HV.B);
      return [...x.needList, ...x.history].find((m) => m.id === needId("B", 6))!.ketQua.hienTai!.giaoVien;
    };
    expect(await ten()).toBe("GV T07");
    await suaCase(ADMIN, { caseId, phienBan: version, teacherId: GV2, ten: "QL", now: NOW });
    expect(await ten()).toBe("GV T07 hai");
  });
});
