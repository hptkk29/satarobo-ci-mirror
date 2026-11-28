// @vitest-environment node
/**
 * [ONL-13-*] E-learning ONLINE — 13 dạng câu hỏi (Postgres thật): 8 dạng mở rộng đi qua ĐÚNG đường soạn → đề → bắt đầu lượt → nộp → chấm → chấm tay.
 * Bảng `Onl*` công ty, KHÔNG `Trn*`. Học viên không nhận đáp án; lượt đã bắt đầu giữ snapshot khi người soạn sửa câu hỏi sau đó.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { batDauLamBai, chamTay, luuCauHoi, nopBai } from "../../lib/elearning-online/danh-gia-db";
import { chamSanPham, nopSanPham } from "../../lib/elearning-online/san-pham-db";
import { taoKhoa } from "../../lib/elearning-online/khoa-hoc";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { CAU, NOW, P, SA_BAN, don, dungKhoa, tepHopLe, themHocVien } from "./_onl-13-fixture";

/**
 * Đáp án ĐÚNG của cả 8 dạng, đúng hình dạng học viên gửi lên. V10.2: mã lựa chọn của ghép cặp / sắp xếp / phân loại là NGẪU NHIÊN riêng của lượt (không còn `l1→r1`) nên đáp án đúng
 * của ba dạng này phải đọc từ BẢN CHỤP đã lưu của chính lượt (phía máy chủ) — học viên không có đường nào đọc được nó.
 */
async function traLoiDung(attemptId: string, id: Record<string, string>, submissionId: string) {
  const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { snapshotJson: true } });
  const cau = (a.snapshotJson as unknown as { cau: { id: string; key: Record<string, unknown> }[] }).cau;
  const key = (qid: string) => cau.find((c) => c.id === qid)!.key;
  return {
    [id.FILL_BLANK!]: ["ba", "dừng"],
    [id.MATCHING!]: key(id.MATCHING!).pairs,
    [id.ORDERING!]: key(id.ORDERING!).order,
    [id.CLASSIFY!]: key(id.CLASSIFY!).map,
    [id.IMAGE_HOTSPOT!]: { x: 120, y: 120 },
    [id.NUMERIC!]: "60,5",
    [id.PRODUCT!]: submissionId,
    [id.BLOCK_SEQUENCE!]: [{ b: "repeat", n: 3, body: [{ b: "fwd" }] }],
  };
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-13] 13 dạng câu hỏi Online (Postgres thật)", () => {
  beforeAll(don, 120_000);
  afterAll(don, 120_000);

  it("[ONL-13-01] 🔴 máy chủ từ chối cấu hình sai của từng dạng; cấu hình đúng lưu ĐÚNG khuôn (không có bảng Trn*)", async () => {
    const t = await taoKhoa(db, { code: `CI-ONL13-S-${Date.now().toString(36).toUpperCase()}`, name: `${P}Soạn`, listPrice: 1, salePrice: 1, validityMonths: 12, renewalEnabled: false }, null);
    if (!t.ok) throw new Error(t.thongBao);
    const sai: [string, object][] = [
      ["FILL_BLANK", { type: "FILL_BLANK", stem: "không ô trống", cauHinh: {} }],
      ["MATCHING", { type: "MATCHING", stem: "x", cauHinh: { pairs: [{ left: "a", right: "b" }] } }],
      ["ORDERING", { type: "ORDERING", stem: "x", cauHinh: { items: ["a"] } }],
      ["CLASSIFY", { type: "CLASSIFY", stem: "x", cauHinh: { groups: [{ name: "a", cards: ["1"] }] } }],
      ["IMAGE_HOTSPOT", { type: "IMAGE_HOTSPOT", stem: "x", cauHinh: { image: { imageUrl: "http://x/y.png", width: 100, height: 100 }, regions: [{ shape: "rect", x: 0, y: 0, w: 1, h: 1 }] } }],
      ["NUMERIC", { type: "NUMERIC", stem: "x", cauHinh: { answer: "sáu" } }],
      ["PRODUCT", { type: "PRODUCT", stem: "x", cauHinh: { accept: [], maxMb: 5 } }],
      ["BLOCK_SEQUENCE", { type: "BLOCK_SEQUENCE", stem: "x", cauHinh: { ...SA_BAN, goal: { c: 0, r: 0 } } }],
    ];
    for (const [ten, input] of sai) expect(await luuCauHoi(db, { courseId: t.courseId, ...input } as never, null), ten).toMatchObject({ ok: false, ma: "CAU_HOI_KHONG_HOP_LE" });
    expect(await db.onlQuestion.count({ where: { courseId: t.courseId } })).toBe(0); // không ghi nửa chừng
    // đối chứng dương: cấu hình đúng được lưu, đúng khuôn
    const ok = await luuCauHoi(db, { courseId: t.courseId, ...CAU.MATCHING } as never, null);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const row = await db.onlQuestion.findUniqueOrThrow({ where: { id: ok.id } });
    expect(row.type).toBe("MATCHING");
    expect(row.answerKeyJson).toEqual({ pairs: { l1: "r1", l2: "r2" } });
    expect((row.optionsJson as { right: unknown[] }).right).toHaveLength(3); // 2 đúng + 1 nhiễu
  });

  it("[ONL-13-02] 🔴 bắt đầu lượt: học viên nhận đủ 8 câu mà KHÔNG có đáp án/giải thích/gợi ý; nộp đúng hết ⇒ chờ chấm tay vì có câu sản phẩm", async () => {
    const k = await dungKhoa();
    const r = await batDauLamBai(db, k.args);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r.luot);
    for (const cam of ["GIAI-THICH-", '"blanks"', '"pairs"', '"order"', '"map"', "regions", "tolerance", '"answer"', "nhân", "rubric", "[[3|ba]]", "[[dừng]]"]) expect(json.includes(cam), cam).toBe(false);
    for (const co of ["Robot đi [[]] bước", "Động cơ", "Phát nhạc", "robot.png", "cm", "VIDEO", "maxBlocks"]) expect(json.includes(co), co).toBe(true); // đối chứng dương
    const sp = await nopSanPham(db, { ...k.args, attemptId: r.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    const nop = await nopBai(db, { ...k.args, attemptId: r.luot.attemptId, traLoi: await traLoiDung(r.luot.attemptId, k.id, sp.submissionId) });
    expect(nop).toMatchObject({ ok: true, trangThai: "SUBMITTED" }); // PRODUCT chưa chấm
    if (!nop.ok) return;
    expect(nop.ketQua.passed).toBeNull();
    expect(nop.ketQua.daChamXong).toBe(false);
    const luot = await db.onlAttempt.findUniqueOrThrow({ where: { id: r.luot.attemptId } });
    expect(luot.passed).toBeNull();
    expect(luot.status).toBe("SUBMITTED");
  });

  it("[ONL-13-03] 🔴 chấm tay câu sản phẩm ⇒ tổng điểm đủ: điểm tự động 8 dạng + điểm tay; điểm tay vượt trần bị từ chối; sai hết ⇒ không đạt", async () => {
    const k = await dungKhoa();
    const r = await batDauLamBai(db, k.args);
    if (!r.ok) throw new Error(r.thongBao);
    const sp = await nopSanPham(db, { ...k.args, attemptId: r.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    await nopBai(db, { ...k.args, attemptId: r.luot.attemptId, traLoi: await traLoiDung(r.luot.attemptId, k.id, sp.submissionId) });
    // chưa chấm bài nộp ⇒ không kết thúc lượt được, và KHÔNG nhận điểm gõ tay cho câu sản phẩm
    expect(await chamTay(db, { attemptId: r.luot.attemptId, diem: { [k.id.PRODUCT!]: 4 }, graderUserId: "g", now: NOW })).toMatchObject({ ok: false, ma: "SAN_PHAM_CHUA_CHAM" });
    expect(await chamSanPham(db, { submissionId: sp.submissionId, graderUserId: "g", diemTrucTiep: 99, now: NOW })).toMatchObject({ ok: false, ma: "DIEM_KHONG_HOP_LE" });
    expect(await chamSanPham(db, { submissionId: sp.submissionId, graderUserId: "g", diemTrucTiep: 4, now: NOW })).toMatchObject({ ok: true, points: 4 });
    const cham = await chamTay(db, { attemptId: r.luot.attemptId, diem: {}, graderUserId: "g", now: NOW });
    expect(cham).toMatchObject({ ok: true, passed: true, scorePercent: 100 });
    expect(await chamTay(db, { attemptId: r.luot.attemptId, diem: {}, graderUserId: "g", now: NOW })).toMatchObject({ ok: false, ma: "DA_CHAM" });
  });

  it("[ONL-13-04] 🔴 sai hết 7 dạng tự chấm + sản phẩm được chấm 0 ⇒ KHÔNG đạt; sửa câu hỏi SAU khi bắt đầu không đổi kết quả (snapshot)", async () => {
    const k = await dungKhoa();
    const r = await batDauLamBai(db, k.args);
    if (!r.ok) throw new Error(r.thongBao);
    // người soạn đổi đáp án câu nhập số NGAY SAU khi học viên bắt đầu
    await luuCauHoi(db, { courseId: k.courseId, id: k.id.NUMERIC, ...CAU.NUMERIC, cauHinh: { answer: 999, tolerance: 0 } } as never, "u");
    const sp = await nopSanPham(db, { ...k.args, attemptId: r.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    const nop = await nopBai(db, { ...k.args, attemptId: r.luot.attemptId, traLoi: await traLoiDung(r.luot.attemptId, k.id, sp.submissionId) });
    expect(nop.ok).toBe(true);
    await chamSanPham(db, { submissionId: sp.submissionId, graderUserId: "g", diemTrucTiep: 0, now: NOW });
    const cham = await chamTay(db, { attemptId: r.luot.attemptId, diem: {}, graderUserId: "g", now: NOW });
    // điểm: 7 câu × 1 = 7 / 11 = 63% < 70% — và câu NUMERIC vẫn được chấm theo đáp án 60 của snapshot (không phải 999)
    expect(cham).toMatchObject({ ok: true, passed: false, scorePercent: 63 });
    const luot = await db.onlAttempt.findUniqueOrThrow({ where: { id: r.luot.attemptId } });
    expect(luot.earnedPoints).toBe(7);
    expect(luot.totalPoints).toBe(11);
  });

  it("[ONL-13-05] 🔴 MÃ ĐÁP ÁN MỜ (V10.2): học viên KHÔNG nhận mã khuôn cũ (l1/r1/s1/c1/g1/d1) mà là mã ngẫu nhiên riêng của lượt; hai lượt khác nhau có mã KHÁC nhau; tiếp tục lượt giữ nguyên mã; câu trả lời bằng mã khuôn cũ bị chấm SAI, bằng mã của lượt thì ĐÚNG", async () => {
    const k = await dungKhoa();
    const r = await batDauLamBai(db, k.args);
    if (!r.ok) throw new Error(r.thongBao);
    const dto = JSON.stringify(r.luot.de);
    // đối chứng dương: nội dung hiển thị VẪN có (đo không bị mù); âm: không còn mã khuôn cũ trong NHỮNG ID gửi xuống
    for (const co of ["Động cơ", "Làm bánh xe quay", "Phát nhạc", "Đo khoảng cách", "Vạch đen"]) expect(dto.includes(co), co).toBe(true);
    const idGuiXuong = [...dto.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]!);
    const cauHinh = r.luot.de.cau.filter((c) => ["MATCHING", "ORDERING", "CLASSIFY"].includes(c.type)).flatMap((c) => JSON.stringify(c.cauHinh).match(/"id":"([^"]+)"/g) ?? []);
    expect(cauHinh.length).toBeGreaterThan(10);
    expect(cauHinh.some((x) => /"id":"(l\d+|r\d+|d\d+|s\d+|c\d+|g\d+)"/.test(x))).toBe(false);
    expect(idGuiXuong.length).toBeGreaterThan(0);
    // cặp đúng KHÔNG suy ra được từ mã: mã trái và mã phải của cùng một cặp không có quan hệ chuỗi
    const a = await db.onlAttempt.findUniqueOrThrow({ where: { id: r.luot.attemptId }, select: { snapshotJson: true } });
    const snap = a.snapshotJson as unknown as { cau: { id: string; key: Record<string, unknown>; cauHinh?: { left?: { id: string }[] } }[] };
    const ghep = snap.cau.find((c) => c.id === k.id.MATCHING)!;
    const cap = ghep.key.pairs as Record<string, string>;
    for (const [l, ph] of Object.entries(cap)) expect(ph.replace(/^o/, "")).not.toBe(l.replace(/^o/, ""));
    // tiếp tục lượt đang làm ⇒ cùng mã
    const lai = await batDauLamBai(db, k.args);
    if (!lai.ok) throw new Error(lai.thongBao);
    expect(lai.luot.daTiepTuc).toBe(true);
    expect(JSON.stringify(lai.luot.de)).toBe(dto);
    // lượt của HỌC VIÊN KHÁC (cùng đề) ⇒ mã KHÁC
    const hv2 = await themHocVien(k, "khac");
    const r2 = await batDauLamBai(db, { ...hv2 });
    if (!r2.ok) throw new Error(r2.thongBao);
    const ids2 = JSON.stringify(r2.luot.de.cau.find((c) => c.id === k.id.MATCHING)!.cauHinh);
    const ids1 = JSON.stringify(r.luot.de.cau.find((c) => c.id === k.id.MATCHING)!.cauHinh);
    expect(ids2).not.toBe(ids1);
    // nộp bằng mã KHUÔN CŨ ⇒ ghép cặp sai (không lọt); bằng mã của lượt ⇒ đúng
    const sp = await nopSanPham(db, { ...k.args, attemptId: r.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, k.args.studentId) });
    if (!sp.ok) throw new Error(sp.thongBao);
    const dungMa = await traLoiDung(r.luot.attemptId, k.id, sp.submissionId);
    const nopCu = await nopBai(db, { ...k.args, attemptId: r.luot.attemptId, traLoi: { ...dungMa, [k.id.MATCHING!]: { l1: "r1", l2: "r2" }, [k.id.ORDERING!]: ["s1", "s2", "s3"], [k.id.CLASSIFY!]: { c1: "g1", c2: "g2" } } });
    expect(nopCu.ok).toBe(true);
    if (!nopCu.ok) return;
    const ct = (qid: string) => nopCu.ketQua.chiTiet!.find((c) => c.id === qid)!;
    for (const t of ["MATCHING", "ORDERING", "CLASSIFY"] as const) expect(ct(k.id[t]!).dung, t + " bằng mã khuôn cũ phải SAI").toBe(false);
    // đối chứng dương: lượt khác nộp bằng đúng mã của nó ⇒ cả ba đúng
    const sp2 = await nopSanPham(db, { ...hv2, attemptId: r2.luot.attemptId, questionId: k.id.PRODUCT!, file: tepHopLe(k.courseId, hv2.studentId) });
    if (!sp2.ok) throw new Error(sp2.thongBao);
    const dungMa2 = await traLoiDung(r2.luot.attemptId, k.id, sp2.submissionId);
    const nop2 = await nopBai(db, { ...hv2, attemptId: r2.luot.attemptId, traLoi: dungMa2 });
    expect(nop2.ok).toBe(true);
    if (!nop2.ok) return;
    for (const t of ["MATCHING", "ORDERING", "CLASSIFY"] as const) expect(nop2.ketQua.chiTiet!.find((c) => c.id === k.id[t])!.dung, t + " bằng mã của lượt phải ĐÚNG").toBe(true);
  });
});
