// @vitest-environment node
/** [ONL-CD-*] Chấm điểm Online (hàm thuần): kiểm câu hỏi · chấm tự động · đạt/không · hiển thị cho học viên · xáo trộn. */
import { describe, expect, it } from "vitest";
import { chamBai, chamCau, chuanHoaVanBan, kiemCauHoi, ketQuaChoHocVien, veChoHocVien, xaoTron, type CauHoiSnapshot, type SnapshotDe } from "./cham-diem";

const op = (...ids: string[]) => ids.map((id) => ({ id, text: `Lựa chọn ${id}` }));
const q = (id: string, type: CauHoiSnapshot["type"], key: CauHoiSnapshot["key"], o: Partial<CauHoiSnapshot> = {}): CauHoiSnapshot => ({ id, type, stem: `Câu ${id}`, options: type.endsWith("CHOICE") ? op("a", "b", "c") : [], key, points: 1, explanation: `Giải thích ${id}`, ...o });
const de = (cau: CauHoiSnapshot[], passPercent = 70): SnapshotDe => ({ assessmentId: "as1", title: "Kiểm tra", kind: "QUIZ", passPercent, timeLimitMin: null, cau });

describe("[ONL-CD-01] kiểm câu hỏi khi soạn", () => {
  it("chọn một: cần ≥2 lựa chọn, mã không trùng, ĐÚNG MỘT đáp án thuộc lựa chọn", () => {
    expect(kiemCauHoi({ type: "SINGLE_CHOICE", options: op("a"), correct: "a" }).ok).toBe(false);
    expect(kiemCauHoi({ type: "SINGLE_CHOICE", options: [...op("a"), ...op("a")], correct: "a" }).ok).toBe(false);
    expect(kiemCauHoi({ type: "SINGLE_CHOICE", options: op("a", "b"), correct: "z" }).ok).toBe(false);
    expect(kiemCauHoi({ type: "SINGLE_CHOICE", options: op("a", "b"), correct: ["a"] }).ok).toBe(false);
    expect(kiemCauHoi({ type: "SINGLE_CHOICE", options: op("a", "b"), correct: "b" })).toMatchObject({ ok: true, answerKeyJson: { correct: "b" } });
  });

  it("chọn nhiều: ≥1 đáp án, đều thuộc lựa chọn; khử trùng + sắp xếp; đúng/sai & ngắn & tự luận", () => {
    expect(kiemCauHoi({ type: "MULTIPLE_CHOICE", options: op("a", "b", "c"), correct: [] }).ok).toBe(false);
    expect(kiemCauHoi({ type: "MULTIPLE_CHOICE", options: op("a", "b", "c"), correct: ["a", "z"] }).ok).toBe(false);
    expect(kiemCauHoi({ type: "MULTIPLE_CHOICE", options: op("a", "b", "c"), correct: ["c", "a", "c"] })).toMatchObject({ ok: true, answerKeyJson: { correct: ["a", "c"] } });
    expect(kiemCauHoi({ type: "TRUE_FALSE", correct: "true" }).ok).toBe(false);
    expect(kiemCauHoi({ type: "TRUE_FALSE", correct: false }).ok).toBe(true);
    expect(kiemCauHoi({ type: "SHORT_TEXT", accepted: ["  "] }).ok).toBe(false);
    expect(kiemCauHoi({ type: "SHORT_TEXT", accepted: ["Robot", "Robot"] })).toMatchObject({ ok: true, answerKeyJson: { accepted: ["Robot"] } });
    expect(kiemCauHoi({ type: "ESSAY" })).toMatchObject({ ok: true, answerKeyJson: {} });
  });
});

describe("[ONL-CD-02] chấm từng câu", () => {
  it("chọn một: đúng id mới đúng; sai kiểu (mảng/số/null) = sai, không ném", () => {
    const c = q("1", "SINGLE_CHOICE", { correct: "b" });
    expect(chamCau(c, "b").dung).toBe(true);
    for (const v of ["a", ["b"], 1, null, undefined, { x: 1 }]) expect(chamCau(c, v).dung, String(v)).toBe(false);
  });

  it("🔴 chọn nhiều: TẬP chọn = TẬP đáp án; thiếu / thừa / một phần đều SAI (không chấm một phần); thứ tự và trùng không ảnh hưởng", () => {
    const c = q("1", "MULTIPLE_CHOICE", { correct: ["a", "c"] });
    expect(chamCau(c, ["c", "a"]).dung).toBe(true);
    expect(chamCau(c, ["a", "a", "c"]).dung).toBe(true);
    expect(chamCau(c, ["a"]).dung).toBe(false); // thiếu
    expect(chamCau(c, ["a", "b", "c"]).dung).toBe(false); // thừa
    expect(chamCau(c, "a").dung).toBe(false); // sai kiểu
    expect(chamCau(c, ["a", 1]).dung).toBe(false);
    expect(chamCau(c, []).dung).toBe(false);
  });

  it("đúng/sai: chỉ boolean đúng giá trị (chuỗi 'true' không tính)", () => {
    const c = q("1", "TRUE_FALSE", { correct: false });
    expect(chamCau(c, false).dung).toBe(true);
    expect(chamCau(c, true).dung).toBe(false);
    expect(chamCau(c, "false").dung).toBe(false);
    expect(chamCau(c, 0).dung).toBe(false);
  });

  it("câu ngắn: không phân biệt hoa/thường, khoảng trắng, dấu câu hai đầu; KHÔNG bỏ dấu tiếng Việt; trống không bao giờ đúng", () => {
    const c = q("1", "SHORT_TEXT", { accepted: ["Cảm biến ánh sáng"] });
    expect(chamCau(c, "  cảm   BIẾN ánh sáng. ").dung).toBe(true);
    expect(chamCau(c, "cam bien anh sang").dung).toBe(false); // bỏ dấu = từ khác
    expect(chamCau(c, "").dung).toBe(false);
    expect(chamCau(c, "...").dung).toBe(false);
    expect(chamCau(q("2", "SHORT_TEXT", { accepted: [""] }), "").dung).toBe(false);
    expect(chuanHoaVanBan("  “Robot”!  ")).toBe("robot");
  });

  it("tự luận: chưa chấm ⇒ dung = null, 0 điểm", () => {
    expect(chamCau(q("1", "ESSAY", {}, { points: 5 }), "bài viết dài")).toEqual({ id: "1", dung: null, diem: 0, toiDa: 5 });
  });
});

describe("[ONL-CD-03] chấm cả bài", () => {
  const d = de([q("1", "SINGLE_CHOICE", { correct: "a" }), q("2", "SINGLE_CHOICE", { correct: "a" }), q("3", "SINGLE_CHOICE", { correct: "a" })], 66);

  it("🔴 đạt so SỐ NGUYÊN: 2/3 = 66,67% ≥ 66 ⇒ ĐẠT; ngưỡng 67 ⇒ KHÔNG đạt dù 'làm tròn' lên 67; % hiển thị làm tròn XUỐNG = 66", () => {
    const tl = { "1": "a", "2": "a", "3": "b" };
    expect(chamBai(d, tl)).toMatchObject({ earned: 2, total: 3, scorePercent: 66, passed: true });
    expect(chamBai({ ...d, passPercent: 67 }, tl)).toMatchObject({ scorePercent: 66, passed: false });
    expect(chamBai({ ...d, passPercent: 67 }, { "1": "a", "2": "a", "3": "a" })).toMatchObject({ scorePercent: 100, passed: true });
  });

  it("🔴 đề RỖNG (tổng 0 điểm) KHÔNG đạt dù ngưỡng 0; điểm từng câu theo `points`", () => {
    expect(chamBai(de([], 0), {})).toMatchObject({ total: 0, scorePercent: 0, passed: false });
    const nang = de([q("1", "SINGLE_CHOICE", { correct: "a" }, { points: 8 }), q("2", "SINGLE_CHOICE", { correct: "a" }, { points: 2 })], 80);
    expect(chamBai(nang, { "1": "a", "2": "b" })).toMatchObject({ earned: 8, total: 10, scorePercent: 80, passed: true });
    expect(chamBai(nang, { "1": "b", "2": "a" })).toMatchObject({ earned: 2, passed: false });
  });

  it("🔴 tự luận: chưa chấm ⇒ passed = null + canChamTay; chấm tay xong mới kết luận; điểm ngoài khoảng bị KẸP", () => {
    const dt = de([q("1", "SINGLE_CHOICE", { correct: "a" }, { points: 5 }), q("2", "ESSAY", {}, { points: 5 })], 70);
    expect(chamBai(dt, { "1": "a" })).toMatchObject({ earned: 5, total: 10, scorePercent: null, passed: null, canChamTay: true });
    expect(chamBai(dt, { "1": "a" }, { "2": 3 })).toMatchObject({ earned: 8, scorePercent: 80, passed: true, canChamTay: false });
    expect(chamBai(dt, { "1": "a" }, { "2": 99 })).toMatchObject({ earned: 10, scorePercent: 100 }); // kẹp về 5
    expect(chamBai(dt, { "1": "a" }, { "2": -4 })).toMatchObject({ earned: 5, scorePercent: 50, passed: false });
    expect(chamBai(dt, { "1": "a" }, { "2": Number.NaN })).toMatchObject({ canChamTay: true, passed: null, earned: 5 }); // NaN KHÔNG phải điểm: vẫn chờ chấm
  });
});

describe("[ONL-CD-04] phần học viên được xem", () => {
  const d = de([q("1", "SINGLE_CHOICE", { correct: "a" }), q("2", "SINGLE_CHOICE", { correct: "b" })], 100);
  const sai = chamBai(d, { "1": "a", "2": "a" });
  const dat = chamBai(d, { "1": "a", "2": "b" });

  it("🔴 KHI ĐANG LÀM không có đáp án nào trong dữ liệu gửi đi (kể cả giải thích)", () => {
    const s = JSON.stringify(veChoHocVien(d));
    expect(s).not.toContain("correct");
    expect(s).not.toContain("Giải thích");
    expect(s).toContain("Câu 1"); // đối chứng dương: đề vẫn có nội dung
  });

  it("CHI_DIEM: chỉ điểm + đạt; DIEM_VA_DUNG_SAI: thêm đúng/sai nhưng KHÔNG đáp án", () => {
    expect(ketQuaChoHocVien({ de: d, ketQua: sai, xemKetQua: "CHI_DIEM", conLuot: true })).toEqual({ scorePercent: 50, passed: false, daChamXong: true });
    const r = ketQuaChoHocVien({ de: d, ketQua: sai, xemKetQua: "DIEM_VA_DUNG_SAI", conLuot: false });
    expect(r.chiTiet?.map((c) => c.dung)).toEqual([true, false]);
    expect(JSON.stringify(r)).not.toContain("dapAnDung");
  });

  it("[D6-01] 🔴 chính sách hiện đáp án do Đào tạo chọn: SAU_KHI_NOP luôn lộ; KHONG_BAO_GIO không bao giờ (kể cả lượt đạt); SAU_KHI_DE_DONG chỉ từ mốc (đúng mốc ⇒ lộ; trước mốc/trống mốc ⇒ KHÔNG)", () => {
    const now = new Date("2026-12-10T10:00:00Z");
    const hien = (che: "SAU_KHI_NOP" | "SAU_KHI_DE_DONG" | "KHONG_BAO_GIO", dongLuc: Date | null, kq = sai) => JSON.stringify(ketQuaChoHocVien({ de: d, ketQua: kq, xemKetQua: "DIEM_VA_DUNG_SAI", conLuot: true, chinhSachDapAn: { che, dongLuc }, now })).includes("dapAnDung");
    expect(hien("SAU_KHI_NOP", null)).toBe(true);
    expect(hien("SAU_KHI_NOP", null, dat)).toBe(true);
    expect(hien("KHONG_BAO_GIO", null, dat)).toBe(false); // đối chứng: đã đạt vẫn không lộ khi Đào tạo chọn không bao giờ
    expect(hien("SAU_KHI_DE_DONG", null)).toBe(false); // chưa đặt mốc ⇒ đóng (fail-closed)
    expect(hien("SAU_KHI_DE_DONG", new Date(now.getTime() + 1))).toBe(false); // trước mốc 1ms
    expect(hien("SAU_KHI_DE_DONG", now)).toBe(true); // đúng mốc
    expect(hien("SAU_KHI_DE_DONG", new Date(now.getTime() - 60_000))).toBe(true);
    // CHI_DIEM thắng mọi chính sách (không có chi tiết nào)
    expect(ketQuaChoHocVien({ de: d, ketQua: sai, xemKetQua: "CHI_DIEM", conLuot: true, chinhSachDapAn: { che: "SAU_KHI_NOP", dongLuc: null }, now }).chiTiet).toBeUndefined();
  });

  it("🔴 CA_DAP_AN_SAU_HET_LUOT: còn lượt và chưa đạt ⇒ KHÔNG lộ đáp án; hết lượt HOẶC đã đạt ⇒ có đáp án + giải thích", () => {
    const con = ketQuaChoHocVien({ de: d, ketQua: sai, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT", conLuot: true });
    expect(JSON.stringify(con)).not.toContain("dapAnDung");
    const het = ketQuaChoHocVien({ de: d, ketQua: sai, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT", conLuot: false });
    expect(het.chiTiet?.[1]).toMatchObject({ dapAnDung: { correct: "b" }, giaiThich: "Giải thích 2" });
    const datR = ketQuaChoHocVien({ de: d, ketQua: dat, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT", conLuot: true });
    expect(datR.chiTiet?.[0]).toHaveProperty("dapAnDung");
  });
});

describe("[ONL-CD-05] xáo trộn", () => {
  it("hoán vị đủ phần tử, đúng với nguồn ngẫu nhiên cho trước, không đổi mảng gốc", () => {
    const goc = [1, 2, 3, 4, 5];
    const dem = (() => { let i = 0; return () => [0.1, 0.9, 0.5, 0.3][i++ % 4]!; })();
    const x = xaoTron(goc, dem);
    expect([...x].sort()).toEqual(goc);
    expect(goc).toEqual([1, 2, 3, 4, 5]);
    expect(xaoTron(goc, () => 0.9999)).toEqual(goc); // j = i ⇒ giữ nguyên
  });
});
