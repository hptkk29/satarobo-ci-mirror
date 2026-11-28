// @vitest-environment node
/**
 * [ONL-GD-*] P0 Mobile — Admin thu hồi quyền GIỮA LƯỢT THI: bảo toàn lượt + bồi hoàn CÓ KIỂM SOÁT (Postgres thật). Chính sách Owner = phương án A.
 * Kịch bản gốc V8.18: lượt 2/3, quiz 2 phút, thu hồi 13:01:21, cấp lại 13:02:53, dueAt 13:02:48 ⇒ trước đây MẤT một lượt.
 * Mỗi ca âm có đối chứng dương. Chỉ bảng `Onl*`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { batDauLamBai, chamTay, docKetQuaCacLuot, luuCauHoi, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { CAU_HINH_BOI_HOAN_MAC_DINH, docLichSuGianDoan, docLuotConLai, quyetBoiHoan, taoBoiHoanSauCapLai } from "../../lib/elearning-online/gian-doan-db";
import { doiSoatLuotQuaHan, docTrangThaiLuot, luuNhap } from "../../lib/elearning-online/luot-nhap-db";
import { capQuyenHoc, thuHoiQuyenHoc } from "../../lib/elearning-online/quyen-hoc-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { T0, donP0, dungKhoaP0, khoaYeuCau, sau, themHocVienP0, type KhoaP0 } from "./_onl-p0-fixture";

const luu = (k: KhoaP0, att: string, now: Date, items: { questionId: string; answer: unknown; baseRevision: number }[], over: Partial<{ requestId: string }> = {}, hv: Pick<KhoaP0, "args"> = k) =>
  luuNhap(db, { ...hv.args(now), attemptId: att, yeuCau: { requestId: over.requestId ?? khoaYeuCau("n"), items } });
const batDau = async (k: KhoaP0, now: Date, hv: Pick<KhoaP0, "args"> = k) => {
  const r = await batDauLamBai(db, hv.args(now));
  if (!r.ok) throw new Error(r.thongBao);
  return r.luot;
};
const thuHoi = (k: KhoaP0, now: Date, loai?: "ADMIN" | "HOAN_TIEN" | "BAO_MAT" | "KHAC", ten = "gd", actor = "admin-1") =>
  thuHoiQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, reason: "Thu hồi để thử nghiệm chính sách", idempotencyKey: khoaYeuCau(ten + "-th"), now, actorUserId: actor, ...(loai ? { loaiThuHoi: loai } : {}) });
const capLai = (k: KhoaP0, now: Date, key = khoaYeuCau("cl"), actor = "admin-2") => capQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, loai: "MUA", now, idempotencyKey: key, actorUserId: actor });
const capLaiCfg = (k: KhoaP0, now: Date, nguong: number) => capQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, loai: "MUA", now, idempotencyKey: khoaYeuCau("cl"), actorUserId: "admin-2", cauHinhBoiHoan: { nguongXemXet: nguong, cuaSoNgay: 30 } });
const dem = (tbl: "interruption" | "compensation", k: KhoaP0) => (tbl === "interruption" ? db.onlAttemptInterruption.count({ where: { entitlementId: k.entitlementId } }) : db.onlAttemptCompensation.count({ where: { entitlementId: k.entitlementId } }));
const nopDung = (k: KhoaP0, att: string, now: Date) => nopBai(db, { ...k.args(now), attemptId: att, traLoi: { [k.q.chonMot!]: "a", [k.q.dungSai!]: true, [k.q.ngan!]: "Hà Nội", [k.q.nhapSo!]: "5" } });

describe.skipIf(!RUN_DB_TESTS)("[ONL-GD] gián đoạn + bồi hoàn lượt (Postgres thật)", () => {
  beforeAll(donP0, 120_000);
  beforeEach(donP0, 120_000); // worker quét MỌI lượt quá hạn: mỗi ca bắt đầu từ DB sạch
  afterAll(donP0, 120_000);

  it("[ONL-GD-01] 🔴 KỊCH BẢN V8.18 (D2/D3): lượt 2 đang làm, Admin thu hồi, cấp lại SAU hạn lượt cũ ⇒ lượt cũ được GIỮ (không chấm rớt), có MỘT lượt thay thế; nháp còn nguyên", async () => {
    const k = await dungKhoaP0(); // 3 lượt, 2 phút
    const l1 = await batDau(k, T0);
    await nopDung(k, l1.attemptId, sau(10)); // lượt 1 nộp + chấm
    const l2 = await batDau(k, sau(20)); // lượt 2/3, hạn = T0+140s
    expect(l2.soLuot).toBe(2);
    expect(await luu(k, l2.attemptId, sau(30), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }])).toMatchObject({ ok: true });
    const th = await thuHoi(k, sau(81), "ADMIN"); // 13:01:21 trong kịch bản
    expect(th).toMatchObject({ ok: true });
    const luotCu = await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId }, include: { interruption: true, drafts: true } });
    expect(luotCu.status).toBe("INTERRUPTED"); // KHÔNG EXPIRED/FAILED
    expect(luotCu).toMatchObject({ scorePercent: null, passed: null, earnedPoints: null });
    expect(luotCu.interruption).toMatchObject({ status: "OPEN", reasonCode: "ADMIN", revokedByUserId: "admin-1", entitlementId: k.entitlementId, attemptId: l2.attemptId, draftCount: 1 });
    expect(luotCu.interruption!.interruptedAt.toISOString()).toBe(sau(81).toISOString());
    expect(luotCu.drafts).toHaveLength(1);
    // đang bị thu hồi: vẫn bị chặn
    expect(await batDauLamBai(db, k.args(sau(100)))).toMatchObject({ ok: false });
    expect(await luu(k, l2.attemptId, sau(100), [{ questionId: k.q.ngan!, answer: "x", baseRevision: 0 }])).toMatchObject({ ok: false });
    // cấp lại 13:02:53 — SAU hạn của lượt cũ (T0+140s)
    expect(await capLai(k, sau(173))).toMatchObject({ ok: true, hanhDong: "MO_LAI_SAU_THU_HOI" });
    expect(await dem("compensation", k)).toBe(1);
    expect((await db.onlAttemptInterruption.findUniqueOrThrow({ where: { attemptId: l2.attemptId } })).status).toBe("COMPENSATED");
    expect(await docLuotConLai(db, { entitlementId: k.entitlementId, assessmentId: k.assessmentId })).toEqual({ toiDa: null, daDung: 2, luotThayTheDangCho: 1, conLai: null }); // D2: không giới hạn; còn MỘT lượt thay thế đang chờ
    // lượt cũ vẫn INTERRUPTED sau cấp lại (thời gian KHÔNG được hồi sinh) và máy chủ không chốt nó
    expect((await doiSoatLuotQuaHan(db, { now: sau(10_000) })).daChot).toBe(0);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } })).status).toBe("INTERRUPTED");
    // D3: lượt MỚI đầu tiên là lượt THAY THẾ — dùng ĐÚNG bản chụp đề của lượt bị gián đoạn, có hạn riêng (không hồi sinh giờ cũ)
    const snapCu = (await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } })).snapshotJson;
    const l3 = await batDau(k, sau(180));
    expect(l3.attemptId).not.toBe(l2.attemptId);
    expect(l3.soLuot).toBe(3);
    const l3db = await db.onlAttempt.findUniqueOrThrow({ where: { id: l3.attemptId } });
    expect(l3db.snapshotJson).toEqual(snapCu);
    expect(l3db.dueAt!.toISOString()).toBe(sau(180 + 120).toISOString());
    await nopDung(k, l3.attemptId, sau(190));
    // D2: sau đó thi lại KHÔNG giới hạn (đề đang chạy)
    for (let i = 4; i <= 8; i++) {
      const l = await batDau(k, sau(200 + i * 10));
      expect(l.soLuot).toBe(i);
      await nopDung(k, l.attemptId, sau(205 + i * 10));
    }
    expect(await batDauLamBai(db, k.args(sau(400)))).toMatchObject({ ok: true }); // không còn HET_LUOT
    const bc = await db.onlAttemptCompensation.findFirstOrThrow({ where: { entitlementId: k.entitlementId } });
    expect(bc).toMatchObject({ status: "USED", usedAttemptId: l3.attemptId, grantedByUserId: "admin-2" }); // đúng MỘT lượt thay thế
  });

  it("[ONL-GD-02] 🔴 thu hồi TRƯỚC khi bắt đầu lượt nào ⇒ không gián đoạn, không bồi hoàn; đối chứng: thu hồi giữa lượt thì có", async () => {
    const k = await dungKhoaP0();
    await thuHoi(k, sau(5), "ADMIN");
    await capLai(k, sau(10));
    expect([await dem("interruption", k), await dem("compensation", k)]).toEqual([0, 0]);
    expect(await docLuotConLai(db, { entitlementId: k.entitlementId, assessmentId: k.assessmentId })).toMatchObject({ conLai: null, luotThayTheDangCho: 0, daDung: 0 });
    const k2 = await dungKhoaP0();
    await batDau(k2, T0);
    await thuHoi(k2, sau(5), "ADMIN");
    expect(await dem("interruption", k2)).toBe(1);
  });

  it("[ONL-GD-03/04] 🔴 thu hồi SAU KHI NỘP và SAU KHI CHẤM ⇒ không bồi hoàn; điểm cũ nguyên vẹn", async () => {
    const k = await dungKhoaP0({ tuLuan: true });
    const l1 = await batDau(k, T0);
    const nop = await nopBai(db, { ...k.args(sau(10)), attemptId: l1.attemptId, traLoi: { [k.q.chonMot!]: "a", [k.q.tuLuan!]: "Robot đi theo vạch" } });
    expect(nop).toMatchObject({ ok: true, trangThai: "SUBMITTED" }); // chờ chấm tay
    await thuHoi(k, sau(20), "ADMIN"); // thu hồi SAU NỘP (chưa chấm)
    expect(await dem("interruption", k)).toBe(0);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId } })).status).toBe("SUBMITTED");
    await capLai(k, sau(30));
    const cham = await chamTay(db, { attemptId: l1.attemptId, diem: { [k.q.tuLuan!]: 4 }, graderUserId: "g", now: sau(40) });
    expect(cham).toMatchObject({ ok: true });
    const diemCu = await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId }, select: { earnedPoints: true, scorePercent: true, passed: true, status: true } });
    await thuHoi(k, sau(50), "ADMIN"); // thu hồi SAU CHẤM
    await capLai(k, sau(60));
    expect([await dem("interruption", k), await dem("compensation", k)]).toEqual([0, 0]);
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId }, select: { earnedPoints: true, scorePercent: true, passed: true, status: true } })).toEqual(diemCu);
  });

  it("[ONL-GD-05] 🔴 thu hồi SAU HẠN của lượt ⇒ không phải do thu hồi: không gián đoạn, không bồi hoàn; máy chủ vẫn chốt lượt từ nháp", async () => {
    const k = await dungKhoaP0();
    const l = await batDau(k, T0); // hạn T0+120s
    await luu(k, l.attemptId, sau(30), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    await thuHoi(k, sau(130), "ADMIN"); // quá hạn 10s, lượt còn IN_PROGRESS (chưa ai chốt)
    expect(await dem("interruption", k)).toBe(0);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).status).toBe("IN_PROGRESS");
    expect((await doiSoatLuotQuaHan(db, { now: sau(200) })).daChot).toBe(1);
    const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } });
    expect(a).toMatchObject({ finalizeReason: "DEADLINE_AUTO" });
    expect(["GRADED", "SUBMITTED"]).toContain(a.status);
    await capLai(k, sau(210));
    expect(await dem("compensation", k)).toBe(0);
  });

  it("[ONL-GD-06] 🔴 thu hồi sát hạn và nộp bài ĐỒNG THỜI ⇒ kết quả XÁC ĐỊNH (hoặc nộp thắng ⇒ đã chấm, không gián đoạn; hoặc thu hồi thắng ⇒ gián đoạn, nộp bị chặn) — không bao giờ cả hai/không cái nào", async () => {
    let nopThang = 0, thuHoiThang = 0;
    for (let i = 0; i < 6; i++) {
      const k = await dungKhoaP0();
      const l = await batDau(k, T0);
      const [rTh, rNop] = await Promise.all([thuHoi(k, sau(119), "ADMIN", "dt" + i), nopDung(k, l.attemptId, sau(119))]);
      const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } });
      const gd = await dem("interruption", k);
      expect(rTh).toMatchObject({ ok: true });
      if (a.status === "GRADED") {
        nopThang++;
        expect(rNop).toMatchObject({ ok: true });
        expect(gd).toBe(0);
      } else {
        thuHoiThang++;
        expect(a.status).toBe("INTERRUPTED");
        expect(rNop).toMatchObject({ ok: false });
        expect(gd).toBe(1);
        expect(a.scorePercent).toBeNull(); // không có điểm rớt oan
      }
    }
    expect(nopThang + thuHoiThang).toBe(6);
  });

  it("[ONL-GD-07] 🔴 thu hồi/cấp lại LẶP LẠI ⇒ không sinh lượt vô hạn: một sự kiện gián đoạn ⇒ tối đa một bồi hoàn; gọi lại cùng khoá không nhân bản", async () => {
    const k = await dungKhoaP0();
    const l = await batDau(k, T0);
    const khoaTh = khoaYeuCau("lap-th");
    const khoaCl = khoaYeuCau("lap-cl");
    await thuHoiQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, reason: "Thu hồi lần một để thử", idempotencyKey: khoaTh, now: sau(10), actorUserId: "a1", loaiThuHoi: "ADMIN" });
    expect(await thuHoiQuyenHoc(db, { studentId: k.studentId, courseId: k.courseId, reason: "Thu hồi lần một để thử", idempotencyKey: khoaTh, now: sau(11), actorUserId: "a1", loaiThuHoi: "ADMIN" })).toMatchObject({ ok: true, daXuLyTruocDo: true });
    await capLai(k, sau(20), khoaCl);
    expect(await capLai(k, sau(21), khoaCl)).toMatchObject({ ok: true, daXuLyTruocDo: true });
    for (let i = 0; i < 4; i++) {
      await thuHoi(k, sau(30 + i * 10), "ADMIN", "lap" + i); // lượt thay thế CHƯA bắt đầu ⇒ không có gì để gián đoạn thêm
      await capLai(k, sau(35 + i * 10));
    }
    expect([await dem("interruption", k), await dem("compensation", k)]).toEqual([1, 1]);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).status).toBe("INTERRUPTED");
  });

  it("[ONL-GD-08] 🔴 HAI yêu cầu bồi hoàn ĐỒNG THỜI ⇒ chỉ MỘT quyền bồi hoàn (cấp lại song song + gọi thẳng bồi hoàn song song)", async () => {
    const k = await dungKhoaP0();
    await batDau(k, T0);
    await thuHoi(k, sau(10), "ADMIN");
    await Promise.all([capLai(k, sau(20), khoaYeuCau("s1")), capLai(k, sau(20), khoaYeuCau("s2"))]);
    expect(await dem("compensation", k)).toBe(1);
    // gọi thẳng hàm bồi hoàn song song: không tạo thêm (interruption đã COMPENSATED) và không nổ unique
    const [a, b] = await Promise.all([
      db.$transaction((tx) => taoBoiHoanSauCapLai(tx, { entitlementId: k.entitlementId, studentId: k.studentId, grantEventId: "x1", actorUserId: "w1", now: sau(30) })),
      db.$transaction((tx) => taoBoiHoanSauCapLai(tx, { entitlementId: k.entitlementId, studentId: k.studentId, grantEventId: "x2", actorUserId: "w2", now: sau(30) })),
    ]);
    expect(a.daBoiHoan + b.daBoiHoan).toBe(0);
    expect(await dem("compensation", k)).toBe(1);
    // đối chứng dương: một sự kiện gián đoạn MỚI + hai worker song song ⇒ đúng một quyền
    const k2 = await dungKhoaP0();
    await batDau(k2, T0);
    await thuHoi(k2, sau(10), "ADMIN");
    await db.onlEntitlement.update({ where: { id: k2.entitlementId }, data: { status: "ACTIVE", revokedAt: null, revokedReason: null, revokedByUserId: null } }); // chỉ để chạy hàm bồi hoàn song song trên cùng interruption OPEN
    const [c, d] = await Promise.all([
      db.$transaction((tx) => taoBoiHoanSauCapLai(tx, { entitlementId: k2.entitlementId, studentId: k2.studentId, grantEventId: "y1", actorUserId: "w1", now: sau(30) })),
      db.$transaction((tx) => taoBoiHoanSauCapLai(tx, { entitlementId: k2.entitlementId, studentId: k2.studentId, grantEventId: "y2", actorUserId: "w2", now: sau(30) })),
    ]);
    expect(c.daBoiHoan + d.daBoiHoan).toBe(1);
    expect(await dem("compensation", k2)).toBe(1);
  });

  it.each([
    ["HOAN_TIEN", "hoàn tiền"],
    ["BAO_MAT", "khoá tài khoản vì bảo mật"],
    ["KHAC", "loại khác"],
    [undefined, "không khai loại (mặc định KHÔNG bồi hoàn)"],
  ] as const)("[ONL-GD-09/11] 🔴 thu hồi %s (%s) ⇒ KHÔNG gián đoạn, KHÔNG bồi hoàn tự động", async (loai, _moTa) => {
    void _moTa;
    const k = await dungKhoaP0();
    const l = await batDau(k, T0);
    await thuHoi(k, sau(10), loai);
    await capLai(k, sau(20));
    expect([await dem("interruption", k), await dem("compensation", k)]).toEqual([0, 0]);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l.attemptId } })).status).toBe("IN_PROGRESS");
    expect((await docLuotConLai(db, { entitlementId: k.entitlementId, assessmentId: k.assessmentId })).luotThayTheDangCho).toBe(0);
  });

  it("[ONL-GD-10] 🔴 quyền HẾT HẠN TỰ NHIÊN ⇒ không gián đoạn/bồi hoàn; máy chủ vẫn chốt lượt theo hạn của lượt", async () => {
    const k = await dungKhoaP0();
    const l = await batDau(k, T0);
    await luu(k, l.attemptId, sau(20), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    await db.onlEntitlement.update({ where: { id: k.entitlementId }, data: { expiresAt: sau(50) } }); // hết hạn tự nhiên giữa lượt
    expect(await luu(k, l.attemptId, sau(60), [{ questionId: k.q.ngan!, answer: "x", baseRevision: 0 }])).toMatchObject({ ok: false }); // cổng truy cập đóng
    expect([await dem("interruption", k), await dem("compensation", k)]).toEqual([0, 0]);
    expect((await doiSoatLuotQuaHan(db, { now: sau(200) })).daChot).toBe(1);
  });

  it("[ONL-GD-12] 🔴 không có quyền học hợp lệ ⇒ KHÔNG dùng được lượt bồi hoàn (và quyền bồi hoàn không bị tiêu hao)", async () => {
    const k = await dungKhoaP0();
    await batDau(k, T0);
    await thuHoi(k, sau(10), "ADMIN");
    await capLai(k, sau(20));
    await thuHoi(k, sau(30), "ADMIN", "lan2"); // lại bị thu hồi
    expect(await batDauLamBai(db, k.args(sau(40)))).toMatchObject({ ok: false });
    const bc = await db.onlAttemptCompensation.findFirstOrThrow({ where: { entitlementId: k.entitlementId } });
    expect(bc).toMatchObject({ status: "AVAILABLE", usedAttemptId: null });
    expect(await db.onlAttempt.count({ where: { entitlementId: k.entitlementId } })).toBe(1); // không đẻ lượt nào
    const khac = await themHocVienP0(k, "ngoai"); // đối chứng: người khác có quyền vẫn bắt đầu được
    expect((await batDauLamBai(db, khac.args(sau(40)))).ok).toBe(true);
  });

  it("[ONL-GD-13/15] 🔴 bồi hoàn KHÔNG đổi điểm cũ; đổi đề SAU KHÔNG sửa lịch sử; D3: lượt THAY THẾ giữ đề bị gián đoạn, lượt kế tiếp theo đề hiện hành (không trộn snapshot)", async () => {
    const k = await dungKhoaP0();
    const l1 = await batDau(k, T0);
    await nopDung(k, l1.attemptId, sau(10));
    const diem1 = await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId }, select: { earnedPoints: true, scorePercent: true, passed: true, snapshotJson: true } });
    const l2 = await batDau(k, sau(20));
    await luu(k, l2.attemptId, sau(25), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    await thuHoi(k, sau(30), "ADMIN");
    const snap2 = (await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } })).snapshotJson;
    // người soạn đổi đáp án + nội dung câu SAU khi lượt đã bị gián đoạn
    await luuCauHoi(db, { courseId: k.courseId, id: k.q.chonMot, type: "SINGLE_CHOICE", stem: "ĐỀ ĐÃ ĐỔI: 2+2=?", options: [{ id: "a", text: "4" }, { id: "b", text: "5" }], correct: "a" } as never, "u");
    await capLai(k, sau(40));
    const l3 = await batDau(k, sau(50)); // lượt THAY THẾ (D3): giữ đề cũ
    const s3 = JSON.stringify((await db.onlAttempt.findUniqueOrThrow({ where: { id: l3.attemptId } })).snapshotJson);
    expect(s3).not.toContain("ĐỀ ĐÃ ĐỔI");
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l3.attemptId } })).snapshotJson).toEqual(snap2);
    await nopDung(k, l3.attemptId, sau(60));
    const l4 = await batDau(k, sau(70)); // lượt kế tiếp: đề HIỆN HÀNH
    expect(JSON.stringify((await db.onlAttempt.findUniqueOrThrow({ where: { id: l4.attemptId } })).snapshotJson)).toContain("ĐỀ ĐÃ ĐỔI");
    expect(await db.onlAttempt.findUniqueOrThrow({ where: { id: l1.attemptId }, select: { earnedPoints: true, scorePercent: true, passed: true, snapshotJson: true } })).toEqual(diem1);
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } })).snapshotJson).toEqual(snap2);
    expect(JSON.stringify(snap2)).not.toContain("ĐỀ ĐÃ ĐỔI");
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: l2.attemptId } })).versionNumber).toBe(1); // phiên bản gắn với lượt lịch sử
  });

  it("[ONL-GD-19] 🔴 lịch sử kết quả: lượt GIÁN ĐOẠN không có kết quả (không chấm 0, KHÔNG lộ đáp án dù học viên đã hết lượt); đối chứng dương: lượt đã chấm vẫn lộ đáp án theo cài đặt", async () => {
    const k = await dungKhoaP0();
    const l1 = await batDau(k, T0);
    await nopDung(k, l1.attemptId, sau(10));
    const l2 = await batDau(k, sau(20));
    await luu(k, l2.attemptId, sau(25), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    await thuHoi(k, sau(30), "ADMIN");
    await capLai(k, sau(40));
    const l3 = await batDau(k, sau(50));
    await nopDung(k, l3.attemptId, sau(60)); // dùng hết 3/3 (2 + 1 bồi hoàn) ⇒ cài đặt cho xem đáp án
    const r = await docKetQuaCacLuot(db, k.args(sau(70)));
    if (!r.ok) throw new Error(r.thongBao);
    const gd = r.luot.find((x) => x.soLuot === 2)!;
    expect(gd).toMatchObject({ trangThai: "INTERRUPTED", ketQua: null });
    expect(JSON.stringify(gd)).not.toMatch(/dapAnDung|giaiThich|GIAI-THICH|scorePercent/);
    expect(JSON.stringify(r.luot.find((x) => x.soLuot === 3))).toContain("dapAnDung"); // đối chứng dương
  });

  it("[ONL-GD-14] 🔴 không truy cập được lượt/nháp của học viên KHÁC (đọc + ghi + nộp); đối chứng dương: chủ lượt đọc được", async () => {
    const k = await dungKhoaP0();
    const khac = await k.themHocVien("khac");
    const l = await batDau(k, T0);
    await luu(k, l.attemptId, sau(5), [{ questionId: k.q.chonMot!, answer: "a", baseRevision: 0 }]);
    expect(await docTrangThaiLuot(db, { ...khac.args(sau(6)), attemptId: l.attemptId })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    expect(await luuNhap(db, { ...khac.args(sau(6)), attemptId: l.attemptId, yeuCau: { requestId: khoaYeuCau("x"), items: [{ questionId: k.q.chonMot!, answer: "b", baseRevision: 1 }] } })).toMatchObject({ ok: false, ma: "LUOT_KHONG_TON_TAI" });
    expect(await luuNhap(db, { ...k.args(sau(6)), parentUserId: khac.parentUserId, attemptId: l.attemptId, yeuCau: { requestId: khoaYeuCau("y"), items: [{ questionId: k.q.chonMot!, answer: "b", baseRevision: 1 }] } })).toMatchObject({ ok: false, ma: "SAI_PHU_HUYNH" });
    expect(await nopBai(db, { ...khac.args(sau(7)), attemptId: l.attemptId, traLoi: {} })).toMatchObject({ ok: false });
    expect((await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: l.attemptId } })).answerJson).toBe("a"); // không bị ghi đè
    const chu = await docTrangThaiLuot(db, { ...k.args(sau(8)), attemptId: l.attemptId });
    expect(chu).toMatchObject({ ok: true });
  });

  it("[ONL-GD-16] 🔴 worker/retry xử lý lại sự kiện cũ ⇒ idempotent: bồi hoàn chạy lại không thêm; thu hồi lặp cùng khoá không thêm gián đoạn", async () => {
    const k = await dungKhoaP0();
    await batDau(k, T0);
    await thuHoi(k, sau(10), "ADMIN");
    await capLai(k, sau(20));
    for (let i = 0; i < 3; i++) {
      const r = await db.$transaction((tx) => taoBoiHoanSauCapLai(tx, { entitlementId: k.entitlementId, studentId: k.studentId, grantEventId: "retry" + i, actorUserId: "w", now: sau(30 + i) }));
      expect(r).toEqual({ daBoiHoan: 0, choXemXet: 0, khongCan: 0 });
    }
    expect([await dem("interruption", k), await dem("compensation", k)]).toEqual([1, 1]);
  });

  it("[ONL-GD-17] 🔴 KHÔNG có trần cứng (mặc định tắt xem xét): Admin thu hồi nhiều lần ⇒ học viên không mất lượt nào ở dưới ngưỡng; vượt ngưỡng ⇒ CHỜ XEM XÉT (không từ chối); đề không giới hạn lượt ⇒ không cần bồi hoàn", async () => {
    const k = await dungKhoaP0({ maxAttempts: 10, timeLimitMin: 30 });
    const ng = 3; // ngưỡng CẤU HÌNH tường minh (mặc định kỹ thuật = không bao giờ xem xét, theo D2)
    for (let i = 0; i < ng + 1; i++) {
      await batDau(k, sau(i * 100));
      await thuHoi(k, sau(i * 100 + 10), "ADMIN", "tran" + i);
      await capLaiCfg(k, sau(i * 100 + 20), ng);
    }
    expect(await dem("interruption", k)).toBe(ng + 1);
    expect(await dem("compensation", k)).toBe(ng); // tới ngưỡng: mỗi lần Admin thu hồi đều được bồi hoàn
    const trangThai = (await db.onlAttemptInterruption.findMany({ where: { entitlementId: k.entitlementId }, orderBy: { interruptedAt: "asc" }, select: { status: true } })).map((x) => x.status);
    expect(trangThai).toEqual([...Array(ng).fill("COMPENSATED"), "PENDING_REVIEW"]); // KHÔNG còn CAP_REACHED/từ chối âm thầm
    // ngưỡng CẤU HÌNH được: ngưỡng cao hơn ⇒ lần thứ ng+1 vẫn tự động bồi hoàn
    const k3 = await dungKhoaP0({ maxAttempts: 10, timeLimitMin: 30 });
    for (let i = 0; i < ng + 1; i++) {
      await batDau(k3, sau(i * 100));
      await thuHoi(k3, sau(i * 100 + 10), "ADMIN", "cfg" + i);
      await capQuyenHoc(db, { studentId: k3.studentId, courseId: k3.courseId, loai: "MUA", now: sau(i * 100 + 20), idempotencyKey: khoaYeuCau("cfgcl"), cauHinhBoiHoan: { nguongXemXet: 99, cuaSoNgay: 30 } });
    }
    expect(await dem("compensation", k3)).toBe(ng + 1);
    // mặc định kỹ thuật = KHÔNG bao giờ xem xét (D2): không cấu hình ⇒ mọi lần Admin thu hồi đều tự bồi hoàn
    expect(CAU_HINH_BOI_HOAN_MAC_DINH.nguongXemXet).toBe(Number.POSITIVE_INFINITY);
    const k4 = await dungKhoaP0({ timeLimitMin: 30 });
    for (let i = 0; i < 6; i++) {
      await batDau(k4, sau(i * 100));
      await thuHoi(k4, sau(i * 100 + 10), "ADMIN", "mdef" + i);
      await capLai(k4, sau(i * 100 + 20));
    }
    expect(await dem("compensation", k4)).toBe(6);
  });

  it("[ONL-GD-20] 🔴 Admin xử lý ngoại lệ: duyệt ⇒ đúng MỘT bồi hoàn (idempotent, song song không nhân đôi); từ chối ⇒ DENIED; cần lý do; không quyết lại trái chiều; chỉ xử lý được sự kiện đang chờ", async () => {
    const k = await dungKhoaP0({ maxAttempts: 10, timeLimitMin: 30 });
    const ng = 3; // ngưỡng CẤU HÌNH tường minh (mặc định kỹ thuật = không bao giờ xem xét, theo D2)
    for (let i = 0; i < ng + 2; i++) {
      await batDau(k, sau(i * 100));
      await thuHoi(k, sau(i * 100 + 10), "ADMIN", "xx" + i);
      await capLaiCfg(k, sau(i * 100 + 20), ng);
    }
    const cho = await db.onlAttemptInterruption.findMany({ where: { entitlementId: k.entitlementId, status: "PENDING_REVIEW" }, orderBy: { interruptedAt: "asc" } });
    expect(cho).toHaveLength(2);
    const [g1, g2] = cho;
    expect(await dem("compensation", k)).toBe(ng); // mỗi lần bắt đầu lượt kế tiếp đã dùng lượt thay thế của lần trước
    const mk = (id: string, quyet: "DUYET" | "TU_CHOI", lyDo = "Admin xác nhận đây là thu hồi thật sự", actor = "ad-xetduyet") => quyetBoiHoan(db, { interruptionId: id, quyet, actorUserId: actor, lyDo, now: sau(5000) });
    expect(await mk(g1!.id, "DUYET", "ngắn")).toMatchObject({ ok: false, ma: "LY_DO_QUA_NGAN" });
    expect(await mk("khong-co", "DUYET")).toMatchObject({ ok: false, ma: "KHONG_TON_TAI" });
    const [a, b] = await Promise.all([mk(g1!.id, "DUYET"), mk(g1!.id, "DUYET")]); // hai Admin bấm cùng lúc
    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((x) => x.ok && !x.daXuLyTruocDo)).toHaveLength(1);
    expect(await dem("compensation", k)).toBe(ng + 1); // đúng MỘT bồi hoàn thêm
    expect(await db.onlAttemptInterruption.findUniqueOrThrow({ where: { id: g1!.id } })).toMatchObject({ status: "COMPENSATED", reviewedByUserId: "ad-xetduyet", reviewReason: "Admin xác nhận đây là thu hồi thật sự" });
    expect(await mk(g1!.id, "TU_CHOI")).toMatchObject({ ok: false, ma: "KHONG_CHO_XEM_XET" }); // đã duyệt không đảo bằng đường này
    expect(await mk(g2!.id, "TU_CHOI", "Nghi ngờ thao tác lặp, không bồi hoàn")).toMatchObject({ ok: true, trangThai: "DENIED" });
    expect(await dem("compensation", k)).toBe(ng + 1); // từ chối không tạo gì
    expect((await docLuotConLai(db, { entitlementId: k.entitlementId, assessmentId: k.assessmentId })).luotThayTheDangCho).toBe(1); // bồi hoàn vừa duyệt đang chờ dùng
    expect(JSON.stringify(await docLichSuGianDoan(db, { courseId: k.courseId }))).toContain("DENIED"); // Admin thấy lịch sử xử lý
  });

  it("[ONL-GD-18] 🔴 audit: ai thu hồi, lúc nào, quyền nào, lượt nào; ai cấp lại; không có token/bí mật; Admin xem được lịch sử", async () => {
    const k = await dungKhoaP0();
    const l = await batDau(k, T0);
    await thuHoi(k, sau(81), "ADMIN", "au", "admin-thuhoi");
    await capLai(k, sau(173), khoaYeuCau("au-cl"), "admin-capphat");
    const ds = await docLichSuGianDoan(db, { courseId: k.courseId });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ attemptId: l.attemptId, entitlementId: k.entitlementId, studentId: k.studentId, reasonCode: "ADMIN", revokedByUserId: "admin-thuhoi", status: "COMPENSATED" });
    expect(ds[0]!.interruptedAt.toISOString()).toBe(sau(81).toISOString());
    expect(ds[0]!.compensation).toMatchObject({ grantedByUserId: "admin-capphat", status: "AVAILABLE" });
    const ev = await db.onlEntitlementEvent.findMany({ where: { entitlementId: k.entitlementId, kind: { in: ["REVOKED", "REOPENED_AFTER_REVOKE"] } } });
    expect(ev.map((e) => e.actorUserId).sort()).toEqual(["admin-capphat", "admin-thuhoi"]);
    expect(ds[0]!.revokeEventId).toBe(ev.find((e) => e.kind === "REVOKED")!.id);
    const dump = JSON.stringify(ds).toLowerCase();
    for (const cam of ["token", "secret", "password", "correct", "accepted", "giai-thich"]) expect(dump.includes(cam), cam).toBe(false);
  });
});
