// @vitest-environment node
/**
 * [MDM-*] Mã đáp án MỜ của lượt làm bài (V10.2): khuôn cũ `l1→r1` / `s1..sn` / `c/g` đoán được và bị GỬI xuống học viên (Q-TYPES phát hiện) — bản vá đổi mã + xáo thứ tự trong bản chụp.
 * Mỗi ca "không lộ" kèm đối chứng "có lộ" ở dữ liệu CHƯA vá (chứng minh phép đo thật sự nhìn thấy lỗ).
 */
import { describe, expect, it } from "vitest";
import { kiemCauMoRong, chamMoRong, veCauMoRong, type LoaiMoRong } from "./dang-cau-hoi";
import { lamMoMaCau, type NguonMo } from "./ma-dap-an-mo";

/** Nguồn tất định để kiểm: mã đếm tăng, xáo = ĐẢO NGƯỢC. */
const dem = () => {
  let n = 0;
  const o: NguonMo = { sinhMa: () => "x" + (++n).toString(16).padStart(6, "0"), xao: (ds) => [...ds].reverse() };
  return o;
};
const dung = (type: LoaiMoRong, stem: string, cauHinh: object) => {
  const r = kiemCauMoRong(type, stem, cauHinh);
  if (!r.ok) throw new Error(r.thongBao);
  return { type, options: r.optionsJson, key: r.answerKeyJson };
};
const cau = {
  MATCHING: () => dung("MATCHING", "Nối", { pairs: [{ left: "Động cơ", right: "Làm bánh xe quay" }, { left: "Pin", right: "Cấp điện" }, { left: "Cảm biến", right: "Đo khoảng cách" }], distractors: ["Phát nhạc"] }),
  ORDERING: () => dung("ORDERING", "Xếp", { items: ["Đo khoảng cách", "Rẽ phải", "Đi qua cửa"] }),
  CLASSIFY: () => dung("CLASSIFY", "Phân loại", { groups: [{ name: "Siêu âm", cards: ["Tường", "Hộp"] }, { name: "Màu", cards: ["Vạch đen", "Vạch trắng"] }] }),
};
const cham = (q: { type: LoaiMoRong; options: unknown; key: unknown }, traLoi: unknown) => chamMoRong({ id: "q1", type: q.type, stem: "x", options: q.options as Record<string, unknown>, key: q.key as Record<string, unknown>, points: 10 }, traLoi);
const hoc = (q: { type: LoaiMoRong; options: unknown; key: unknown }) => JSON.stringify(veCauMoRong({ id: "q1", type: q.type, stem: "x", options: q.options as Record<string, unknown>, key: q.key as Record<string, unknown>, points: 10 }));
const KHUON_CU = /"(l\d+|r\d+|d\d+|s\d+|c\d+|g\d+)"/;

describe("[MDM] đổi mã + xáo", () => {
  it("[MDM-01] 🔴 ĐỐI CHỨNG: dữ liệu CHƯA vá gửi xuống học viên mang mã khuôn cũ (đo được lỗ); sau khi làm mờ KHÔNG còn một mã khuôn cũ nào", () => {
    for (const t of ["MATCHING", "ORDERING", "CLASSIFY"] as const) {
      const goc = cau[t]();
      expect(KHUON_CU.test(hoc(goc)), `${t}: dữ liệu chưa vá phải lộ khuôn cũ (đối chứng)`).toBe(true);
      const mo = lamMoMaCau(goc, dem());
      expect(KHUON_CU.test(hoc({ ...goc, ...mo })), `${t}: sau vá không còn khuôn cũ`).toBe(false);
    }
  });

  it("[MDM-02] 🔴 ghép cặp: mã mới, key ánh xạ theo ⇒ đáp án đúng DỰNG TỪ NỘI DUNG vẫn chấm đúng; ghép sai chấm sai; mã khuôn CŨ trong câu trả lời ⇒ sai (không lọt)", () => {
    const goc = cau.MATCHING();
    const mo = { ...goc, ...lamMoMaCau(goc, dem()) };
    const opt = mo.options as { left: { id: string; text: string }[]; right: { id: string; text: string }[] };
    const key = mo.key as { pairs: Record<string, string> };
    const phaiTheoChu = (t: string) => opt.right.find((r) => r.text === t)!.id;
    const traiTheoChu = (t: string) => opt.left.find((l) => l.text === t)!.id;
    const dungHet = { [traiTheoChu("Động cơ")]: phaiTheoChu("Làm bánh xe quay"), [traiTheoChu("Pin")]: phaiTheoChu("Cấp điện"), [traiTheoChu("Cảm biến")]: phaiTheoChu("Đo khoảng cách") };
    expect(cham(mo, dungHet)).toMatchObject({ dung: true, soDung: 3, soCau: 3 });
    expect(key.pairs).toEqual(dungHet); // key chính là bảng cặp đúng theo mã mới
    expect(cham(mo, { ...dungHet, [traiTheoChu("Pin")]: phaiTheoChu("Phát nhạc") })).toMatchObject({ dung: false });
    expect(cham(mo, { l1: "r1", l2: "r2", l3: "r3" }), "mã khuôn cũ không còn nghĩa").toMatchObject({ dung: false, soDung: 0 });
    // đối chứng: BẢN GỐC chấm đúng bằng mã khuôn cũ (chứng minh khuôn cũ từng là đáp án)
    expect(cham(goc, { l1: "r1", l2: "r2", l3: "r3" })).toMatchObject({ dung: true });
  });

  it("[MDM-03] 🔴 sắp xếp: key.order theo mã mới + danh sách bị xáo; sắp đúng theo nội dung ⇒ đúng; đảo ⇒ sai", () => {
    const goc = cau.ORDERING();
    const mo = { ...goc, ...lamMoMaCau(goc, dem()) };
    const items = (mo.options as { items: { id: string; text: string }[] }).items;
    expect(items.map((i) => i.text)).toEqual(["Đi qua cửa", "Rẽ phải", "Đo khoảng cách"]); // đã xáo (đảo) trong bản chụp
    const idCua = (t: string) => items.find((i) => i.text === t)!.id;
    const dungThuTu = ["Đo khoảng cách", "Rẽ phải", "Đi qua cửa"].map(idCua);
    expect(cham(mo, dungThuTu)).toMatchObject({ dung: true });
    expect(cham(mo, [...dungThuTu].reverse())).toMatchObject({ dung: false });
    expect(cham(mo, ["s1", "s2", "s3"]), "thứ tự suy từ khuôn cũ không còn đúng").toMatchObject({ dung: false });
  });

  it("[MDM-04] 🔴 phân loại: thẻ + nhóm đổi mã, map theo mã mới; phân đúng theo nội dung ⇒ đúng; nhiễu một thẻ ⇒ sai", () => {
    const goc = cau.CLASSIFY();
    const mo = { ...goc, ...lamMoMaCau(goc, dem()) };
    const opt = mo.options as { groups: { id: string; text: string }[]; cards: { id: string; text: string }[] };
    const g = (t: string) => opt.groups.find((x) => x.text === t)!.id;
    const c = (t: string) => opt.cards.find((x) => x.text === t)!.id;
    const dungHet = { [c("Tường")]: g("Siêu âm"), [c("Hộp")]: g("Siêu âm"), [c("Vạch đen")]: g("Màu"), [c("Vạch trắng")]: g("Màu") };
    expect(cham(mo, dungHet)).toMatchObject({ dung: true });
    expect(cham(mo, { ...dungHet, [c("Hộp")]: g("Màu") })).toMatchObject({ dung: false });
    expect(cham(mo, { c1: "g1", c2: "g1", c3: "g2", c4: "g2" })).toMatchObject({ dung: false });
  });

  it("[MDM-05] mã MỚI không trùng nhau trong câu và không mang số thứ tự gốc (nguồn thật `randomBytes`-kiểu: dài, khác nhau)", () => {
    let n = 0;
    const that: NguonMo = { sinhMa: () => "o" + Math.random().toString(16).slice(2, 14).padEnd(12, "0") + (n++).toString(16), xao: (ds) => [...ds] };
    const goc = cau.MATCHING();
    const mo = lamMoMaCau(goc, that).options as { left: { id: string }[]; right: { id: string }[] };
    const tatCa = [...mo.left, ...mo.right].map((x) => x.id);
    expect(new Set(tatCa).size).toBe(tatCa.length);
    expect(tatCa.every((id) => id.length >= 12 && !/^[lrd]\d+$/.test(id))).toBe(true);
  });

  it("[MDM-06] dạng khác / dữ liệu hỏng ⇒ trả NGUYÊN, không ném (SINGLE, NUMERIC, key lạ)", () => {
    const so = { type: "NUMERIC", options: {}, key: { answer: 60, tolerance: 1 } };
    expect(lamMoMaCau(so, dem())).toEqual({ options: so.options, key: so.key });
    const hong = { type: "MATCHING", options: { left: "không phải mảng" }, key: { pairs: 5 } };
    expect(lamMoMaCau(hong, dem())).toEqual({ options: hong.options, key: hong.key });
    expect(lamMoMaCau({ type: "ORDERING", options: null, key: null }, dem())).toEqual({ options: null, key: null });
  });

  it("[MDM-07] KHÔNG sửa đầu vào (bản chụp gốc của câu hỏi gốc còn nguyên — hàm thuần)", () => {
    const goc = cau.MATCHING();
    const sao = JSON.parse(JSON.stringify(goc));
    lamMoMaCau(goc, dem());
    expect(goc).toEqual(sao);
  });
});
