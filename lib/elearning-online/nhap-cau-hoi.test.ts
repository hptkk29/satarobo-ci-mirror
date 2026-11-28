/**
 * [NCH-*] Nhập câu hỏi Online từ Excel — luật kiểm từng dòng (thuần). Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: cùng sheet, dòng hợp lệ đi qua.
 */
import { describe, it, expect } from "vitest";
import { MAU_THEO_LOAI, TOI_DA_DONG, danhDauCauTrung, kiemBangTinh } from "./nhap-cau-hoi";
import { kiemCauHoi } from "./cham-diem";
import { chamMoRong, laLoaiMoRong, veCauMoRong } from "./dang-cau-hoi";

const H1 = ["Đề bài", "A", "B", "C", "D", "E", "F", "Đáp án đúng", "Điểm", "Giải thích"];
const H_DS = ["Đề bài", "Đáp án", "Điểm", "Giải thích"];

describe("[QIM-01] chọn một / chọn nhiều", () => {
  it("dòng hợp lệ → câu có options A.. và đáp án; điểm mặc định 1", () => {
    const r = kiemBangTinh({ "Chọn một đáp án": [H1, ["Hướng nào?", "Trái", "Phải", "", "", "", "", "A", "", ""]] });
    expect(r).toMatchObject({ tongDong: 1, hopLe: 1, loi: 0 });
    const c = r.chiTiet[0].cau!;
    expect(c).toMatchObject({ type: "SINGLE_CHOICE", stem: "Hướng nào?", correct: "A", points: 1 });
    expect(c.options).toEqual([{ id: "A", text: "Trái" }, { id: "B", text: "Phải" }]);
  });
  it("ÂM: một lựa chọn · đáp án trỏ vào ô trống · đáp án 2 chữ ở dạng chọn một · thiếu đề · thiếu đáp án — mỗi dòng báo ĐÚNG lỗi, kèm số dòng", () => {
    const r = kiemBangTinh({
      "Chọn một đáp án": [
        H1,
        ["Một lựa chọn", "Chỉ A", "", "", "", "", "", "A", "", ""],
        ["Đáp án ô trống", "A", "B", "", "", "", "", "C", "", ""],
        ["Hai chữ", "A", "B", "", "", "", "", "A;B", "", ""],
        ["", "A", "B", "", "", "", "", "A", "", ""],
        ["Thiếu đáp án", "A", "B", "", "", "", "", "", "", ""],
        ["Hợp lệ", "A", "B", "", "", "", "", "B", "2", "Vì B"],
      ],
    });
    expect(r.tongDong).toBe(6);
    expect(r.hopLe).toBe(1); // đối chứng dương
    expect(r.chiTiet.filter((d) => d.loi).map((d) => [d.dong, d.loi])).toEqual([
      [2, "Câu chọn một cần ít nhất 2 lựa chọn"],
      [3, "Chọn đúng MỘT đáp án thuộc các lựa chọn"],
      [4, "Đáp án đúng phải là MỘT chữ A–F"],
      [5, "Thiếu Đề bài"],
      [6, "Thiếu Đáp án đúng"],
    ]);
    expect(r.chiTiet.find((d) => d.cau)!.cau).toMatchObject({ correct: "B", points: 2, explanation: "Vì B" });
  });
  it("chọn nhiều: A;C → mảng; đáp án ngoài lựa chọn bị từ chối", () => {
    const r = kiemBangTinh({ "Chọn nhiều đáp án": [H1, ["Cảm biến?", "Siêu âm", "Hồng ngoại", "Chạm", "", "", "", "A;C", "", ""], ["Sai", "X", "Y", "", "", "", "", "A;D", "", ""]] });
    expect(r.hopLe).toBe(1);
    expect(r.chiTiet[0].cau).toMatchObject({ type: "MULTIPLE_CHOICE", correct: ["A", "C"] });
    expect(r.chiTiet[1].loi).toBe("Đáp án đúng phải thuộc các lựa chọn");
  });
});

describe("[QIM-02] đúng/sai · trả lời ngắn · tự luận", () => {
  it("Đúng/Sai nhận Đúng·Sai·True·False (không phân biệt hoa thường); giá trị lạ bị từ chối với thông báo của thiết kế", () => {
    const r = kiemBangTinh({ "Đúng sai": [H_DS, ["a", "Đúng", "", ""], ["b", "SAI", "", ""], ["c", "true", "", ""], ["d", "Có", "", ""]] });
    expect(r.chiTiet.map((d) => d.cau?.correct ?? d.loi)).toEqual([true, false, true, "Đáp án phải là Đúng hoặc Sai"]);
  });
  it("trả lời ngắn: đáp án cách nhau bằng |; rỗng bị từ chối", () => {
    const r = kiemBangTinh({ "Trả lời ngắn": [["Đề bài", "Đáp án chấp nhận", "Điểm", "Giải thích"], ["Tên?", "siêu âm | ultrasonic", "", ""], ["Rỗng", "", "", ""]] });
    expect(r.chiTiet[0].cau).toMatchObject({ type: "SHORT_TEXT", accepted: ["siêu âm", "ultrasonic"] });
    expect(r.chiTiet[1].loi).toBe("Thiếu Đáp án chấp nhận");
  });
  it("tự luận chỉ cần đề bài; điểm sai (0, 1001, chữ) bị từ chối", () => {
    const r = kiemBangTinh({ "Tự luận": [["Đề bài", "Điểm", "Giải thích"], ["Mô tả…", "5", ""], ["x", "0", ""], ["y", "1001", ""], ["z", "abc", ""]] });
    expect(r.hopLe).toBe(1);
    expect(r.chiTiet.filter((d) => d.loi).every((d) => d.loi === "Điểm phải là số nguyên từ 1 đến 1000")).toBe(true);
  });
});

describe("[QIM-03] sheet, giới hạn, ranh giới phạm vi", () => {
  it("sheet HUONG-DAN và sheet lạ bị bỏ qua, KHÔNG nhập; đối chứng: sheet đúng tên dạng (kể cả dạng mở rộng) được đọc", () => {
    const r = kiemBangTinh({ "HUONG-DAN": [["x"]], "Vế ghép linh tinh": [["Đề bài", "Vế trái 1"], ["a", "b"]], "Linh tinh": [["a"]], "Tự luận": [["Đề bài"], ["ok"]] });
    expect(r.sheetBoQua.sort()).toEqual(["HUONG-DAN", "Linh tinh", "Vế ghép linh tinh"]);
    expect(r.sheetDaDoc).toEqual(["Tự luận"]);
    expect(r.hopLe).toBe(1);
    expect(r.chiTiet.every((d) => d.sheet === "Tự luận")).toBe(true);
  });
  it("đủ 13 dạng của thiết kế, mỗi dạng một sheet riêng và một nhãn", () => {
    expect(MAU_THEO_LOAI.length).toBe(13);
    expect(new Set(MAU_THEO_LOAI.map((m) => m.sheet)).size).toBe(13);
    expect(new Set(MAU_THEO_LOAI.map((m) => m.loai)).size).toBe(13);
  });
  it("vượt 500 câu ⇒ KHÔNG kiểm dòng nào (một thông báo chung); đúng 500 thì qua (biên)", () => {
    const dong = (n: number) => [["Đề bài"], ...Array.from({ length: n }, (_, i) => [`Câu ${i}`])];
    expect(TOI_DA_DONG, "trần ghim bằng SỐ, không suy từ chính hằng").toBe(500);
    const qua = kiemBangTinh({ "Tự luận": dong(501) });
    expect(qua.loiChung).toMatch(/tối đa 500/);
    expect(qua.chiTiet).toEqual([]);
    const bien = kiemBangTinh({ "Tự luận": dong(500) });
    expect(bien.loiChung).toBeNull();
    expect(bien.hopLe).toBe(500);
  });
  it("dòng trống bị bỏ qua; số dòng tính theo tệp (dòng 1 là tiêu đề)", () => {
    const r = kiemBangTinh({ "Tự luận": [["Đề bài"], [""], ["Câu"], [""], [""]] });
    expect(r.tongDong).toBe(1);
    expect(r.chiTiet[0].dong).toBe(3);
  });
  it("thiếu cột Đề bài ⇒ một lỗi cho cả sheet, nói rõ cột nào", () => {
    const r = kiemBangTinh({ "Tự luận": [["Câu hỏi"], ["a"]] });
    expect(r.loi).toBe(1);
    expect(r.chiTiet[0].loi).toMatch(/thiếu cột Đề bài/);
  });
});

describe("[QIM-04] 'hợp lệ ở bản xem trước' ⇒ lưu được: mọi câu hợp lệ cũng qua kiemCauHoi (luật lưu thật)", () => {
  it("dùng đúng bộ mẫu — dòng ví dụ của MỖI dạng phải hợp lệ và qua kiemCauHoi", () => {
    const sheets = Object.fromEntries(MAU_THEO_LOAI.map((m) => [m.sheet, [m.cot, m.viDu]]));
    const r = kiemBangTinh(sheets);
    expect(r.loi).toBe(0);
    expect(r.hopLe).toBe(MAU_THEO_LOAI.length);
    for (const d of r.chiTiet) {
      const c = d.cau!;
      expect(kiemCauHoi({ type: c.type, stem: c.stem, options: c.options, correct: c.correct, accepted: c.accepted, cauHinh: c.cauHinh }).ok, `${d.sheet} phải qua luật lưu`).toBe(true);
    }
  });
});

describe("[QIM-05] header bắt buộc · sheet trống · câu trùng", () => {
  it("thiếu cột bắt buộc của dạng (Đáp án đúng / B) ⇒ MỘT lỗi cho cả sheet, nêu đủ tên cột; đối chứng: có đủ cột thì không lỗi header", () => {
    const thieu = kiemBangTinh({ "Chọn một đáp án": [["Đề bài", "A", "Điểm"], ["x", "1", ""]] });
    expect(thieu.loi).toBe(1);
    expect(thieu.chiTiet[0].loi).toMatch(/thiếu cột B, Đáp án đúng/);
    const du = kiemBangTinh({ "Chọn một đáp án": [H1, ["x", "a", "b", "", "", "", "", "A", "", ""]] });
    expect(du.loi).toBe(0);
  });
  it("sheet đúng dạng chỉ có tiêu đề ⇒ báo sheet trống; tệp không có câu nào ⇒ tongDong 0", () => {
    const r = kiemBangTinh({ "Tự luận": [["Đề bài", "Điểm", "Giải thích"]], "Đúng sai": [H_DS, ["", "", "", ""]] });
    expect(r.sheetRong.sort()).toEqual(["Tự luận", "Đúng sai"]);
    expect(r.tongDong).toBe(0);
  });
  it("câu trùng trong tệp: dòng sau bị đánh dấu (kèm số dòng của dòng đầu); chuẩn hoá hoa/thường/khoảng trắng; KHÁC dạng thì không trùng", () => {
    const k = kiemBangTinh({
      "Tự luận": [["Đề bài"], ["Mô tả robot"], ["  mô   tả ROBOT. "], ["Câu khác"]],
      "Trả lời ngắn": [["Đề bài", "Đáp án chấp nhận"], ["Mô tả robot", "x"]],
    });
    const r = danhDauCauTrung(k, []);
    expect(r.chiTiet.map((d) => d.loi ?? "ok")).toEqual(["ok", "Trùng với dòng 2 trong tệp", "ok", "ok"]);
    expect(r).toMatchObject({ hopLe: 3, loi: 1 });
  });
  it("câu trùng với ngân hàng ĐANG CÓ của khoá ⇒ lỗi 'đã có'; dấu tiếng Việt đổi nghĩa nên KHÔNG bị bỏ (đối chứng: khác dấu thì không trùng)", () => {
    const k = kiemBangTinh({ "Tự luận": [["Đề bài"], ["Con ma"], ["Con mả"]] });
    const r = danhDauCauTrung(k, ["con ma"]);
    expect(r.chiTiet.map((d) => d.loi ?? "ok")).toEqual(["Câu đã có trong ngân hàng câu hỏi của khoá", "ok"]);
  });
  it("hàm thuần: không đổi đầu vào", () => {
    const k = kiemBangTinh({ "Tự luận": [["Đề bài"], ["a"], ["a"]] });
    const truoc = JSON.stringify(k);
    danhDauCauTrung(k, ["a"]);
    expect(JSON.stringify(k)).toBe(truoc);
  });
});
