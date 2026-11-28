/**
 * [QIM-07..09] QoImport — 8 dạng mở rộng (V10.0 Q5). Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG (cùng sheet, dòng hợp lệ đi qua) và câu nhập vào được CHẤM THỬ bằng đúng hàm chấm thật
 * (vòng khứ hồi: thứ nhập từ Excel là thứ người soạn định chấm; học viên không thấy đáp án).
 */
import { describe, it, expect } from "vitest";
import { MAU_THEO_LOAI, kiemBangTinh } from "./nhap-cau-hoi";
import { kiemCauHoi } from "./cham-diem";
import { chamMoRong, laLoaiMoRong, veCauMoRong } from "./dang-cau-hoi";

const mau = (l: string) => MAU_THEO_LOAI.find((m) => m.loai === l)!;
const bang = (l: string, ...kvs: Record<string, string>[]) => ({ [mau(l).sheet]: [mau(l).cot, ...kvs.map((kv) => mau(l).cot.map((c) => kv[c] ?? ""))] });

function nhap1(l: string, kv: Record<string, string>) {
  const r = kiemBangTinh(bang(l, kv));
  const d = r.chiTiet[0]!;
  const cau = d.cau;
  const luu = cau && laLoaiMoRong(cau.type) ? kiemCauHoi({ type: cau.type, stem: cau.stem, cauHinh: cau.cauHinh }) : null;
  const dung = () => {
    if (!cau || !luu || !luu.ok) throw new Error("không có câu hợp lệ: " + d.loi);
    return { id: "q1", type: cau.type as never, stem: cau.stem, options: luu.optionsJson, key: luu.answerKeyJson, points: 1 };
  };
  return { loi: d.loi, cau, r, cham: (traLoi: unknown) => chamMoRong(dung(), traLoi), veHocVien: () => veCauMoRong(dung()) };
}
const dongLoi = (l: string, kv: Record<string, string>) => nhap1(l, kv).loi;

describe("[QIM-07] điền chỗ trống · ghép cặp · sắp xếp · phân loại", () => {
  it("điền chỗ trống: [[a|b]] → ô trống nhiều đáp án; chấm đúng/sai; học viên KHÔNG thấy đáp án trong đề; đối chứng âm", () => {
    const n = nhap1("FILL_BLANK", { "Đề bài": "Robot dùng [[siêu âm|ultrasonic]] đo [[khoảng cách]].", "Từ gây nhiễu": "màu|chạm", "Cho gõ": "Có" });
    expect(n.loi).toBeUndefined();
    expect(n.cau!.cauHinh).toMatchObject({ distractors: ["màu", "chạm"], allowTyping: true });
    expect(n.cham(["ultrasonic", "khoảng cách"])).toMatchObject({ dung: true });
    expect(n.cham(["màu", "khoảng cách"])).toMatchObject({ dung: false, soDung: 1, soCau: 2 });
    expect(JSON.stringify(n.veHocVien())).not.toContain("ultrasonic");
    expect(dongLoi("FILL_BLANK", { "Đề bài": "Không có ô trống nào" })).toMatch(/\[\[ \]\]/);
    expect(dongLoi("FILL_BLANK", { "Đề bài": "A [[x]]", "Cho gõ": "Có thể" })).toBe("Cho gõ phải là Có hoặc Không");
  });
  it("ghép cặp: cặp nào cũng cần CẢ HAI bên; ≥ 2 cặp; hai bên phải khác nhau; chấm đúng theo id", () => {
    const ok = { "Đề bài": "Ghép", "Trái 1": "Siêu âm", "Phải 1": "Đo khoảng cách", "Trái 2": "Màu", "Phải 2": "Nhận màu", "Mục gây nhiễu": "Đo nhiệt độ" };
    const n = nhap1("MATCHING", ok);
    expect(n.loi).toBeUndefined();
    expect(n.cham({ l1: "r1", l2: "r2" })).toMatchObject({ dung: true });
    expect(n.cham({ l1: "r2", l2: "r1" })).toMatchObject({ dung: false, soDung: 0 });
    expect(dongLoi("MATCHING", { ...ok, "Phải 2": "" })).toMatch(/Cặp 2 thiếu một bên/);
    expect(dongLoi("MATCHING", { "Đề bài": "x", "Trái 1": "a", "Phải 1": "b" })).toMatch(/ít nhất 2 cặp/);
    expect(dongLoi("MATCHING", { ...ok, "Phải 2": "đo khoảng cách" })).toBe("Hai mục bên phải trùng nhau");
  });
  it("sắp xếp: thứ tự điền trong Excel là thứ tự ĐÚNG; học viên nhận thứ tự khác; trùng bước bị từ chối", () => {
    const n = nhap1("ORDERING", { "Đề bài": "Sắp", "Bước 1": "Một", "Bước 2": "Hai", "Bước 3": "Ba" });
    expect(n.loi).toBeUndefined();
    expect(n.cham(["s1", "s2", "s3"])).toMatchObject({ dung: true });
    expect(n.cham(["s3", "s2", "s1"])).toMatchObject({ dung: false });
    const hien = (n.veHocVien().cauHinh as { muc: { id: string }[] }).muc.map((x) => x.id);
    expect(hien).not.toEqual(["s1", "s2", "s3"]);
    expect(dongLoi("ORDERING", { "Đề bài": "x", "Bước 1": "Một" })).toMatch(/ít nhất 2 bước/);
    expect(dongLoi("ORDERING", { "Đề bài": "x", "Bước 1": "Một", "Bước 2": "một" })).toMatch(/trùng nội dung/);
  });
  it("phân loại: thẻ cách nhau bằng |; nhóm thiếu thẻ / thẻ thiếu nhóm / thẻ trùng bị từ chối", () => {
    const ok = { "Đề bài": "Phân loại", "Nhóm 1": "Cảm biến", "Thẻ nhóm 1": "Siêu âm|Màu", "Nhóm 2": "Động cơ", "Thẻ nhóm 2": "Bước|DC" };
    const n = nhap1("CLASSIFY", ok);
    expect(n.loi).toBeUndefined();
    expect(n.cham({ c1: "g1", c2: "g1", c3: "g2", c4: "g2" })).toMatchObject({ dung: true });
    expect(n.cham({ c1: "g2", c2: "g1", c3: "g2", c4: "g2" })).toMatchObject({ dung: false, soDung: 3, soCau: 4 });
    expect(dongLoi("CLASSIFY", { ...ok, "Thẻ nhóm 2": "" })).toBe("Nhóm 2 chưa có thẻ nào");
    expect(dongLoi("CLASSIFY", { ...ok, "Nhóm 2": "" })).toMatch(/chưa có tên/);
    expect(dongLoi("CLASSIFY", { ...ok, "Thẻ nhóm 2": "màu" })).toMatch(/trùng nội dung/);
  });
});

describe("[QIM-08] chọn trên hình · nhập số · nộp sản phẩm · khối lệnh", () => {
  const hinh = { "Đề bài": "Bấm vào cảm biến", "Ảnh": "https://example.com/r.png", "Rộng": "800", "Cao": "600", "Vùng đúng": "rect:100,100,200,150;circle:600,300,60", "Sai số": "10" };
  it("chọn trên hình: rect + circle; trong vùng đúng, ngoài vùng sai; cú pháp sai / ngoài ảnh / Rộng không phải số bị từ chối", () => {
    const n = nhap1("IMAGE_HOTSPOT", hinh);
    expect(n.loi).toBeUndefined();
    expect(n.cham({ x: 150, y: 150 })).toMatchObject({ dung: true });
    expect(n.cham({ x: 620, y: 310 })).toMatchObject({ dung: true });
    expect(n.cham({ x: 10, y: 10 })).toMatchObject({ dung: false });
    expect(dongLoi("IMAGE_HOTSPOT", { ...hinh, "Vùng đúng": "hinh:1,2" })).toMatch(/sai cú pháp/);
    expect(dongLoi("IMAGE_HOTSPOT", { ...hinh, "Vùng đúng": "rect:700,500,200,150" })).toBe("Có vùng đúng nằm ngoài ảnh");
    expect(dongLoi("IMAGE_HOTSPOT", { ...hinh, "Rộng": "rộng" })).toMatch(/Rộng và Cao/);
  });
  it("nhập số: dấu phẩy và dấu chấm đều được; có sai số; đáp án không phải số bị từ chối", () => {
    const n = nhap1("NUMERIC", { "Đề bài": "Quãng đường?", "Đáp án": "3,5", "Sai số": "0,1", "Đơn vị": "m" });
    expect(n.loi).toBeUndefined();
    expect(n.cham("3.55")).toMatchObject({ dung: true });
    expect(n.cham("3,7")).toMatchObject({ dung: false });
    expect(dongLoi("NUMERIC", { "Đề bài": "x", "Đáp án": "ba" })).toBe("Đáp án phải là một số");
    expect(dongLoi("NUMERIC", { "Đề bài": "x", "Đáp án": "1", "Sai số": "-1" })).toMatch(/Nhập đáp án là một số/);
  });
  it("nộp sản phẩm: KHÔNG tự chấm (dung null); loại tệp lạ, thời lượng khi không có video, dung lượng 0 bị từ chối", () => {
    const ok = { "Đề bài": "Quay video", "Loại tệp": "VIDEO;ảnh", "Dung lượng tối đa (MB)": "200", "Thời lượng video tối đa (giây)": "120" };
    const n = nhap1("PRODUCT", ok);
    expect(n.loi).toBeUndefined();
    expect(n.cau!.cauHinh).toMatchObject({ accept: ["VIDEO", "IMAGE"], maxMb: 200, maxVideoSec: 120 });
    expect(n.cham({})).toMatchObject({ dung: null });
    expect(dongLoi("PRODUCT", { ...ok, "Loại tệp": "EXE" })).toMatch(/không hợp lệ/);
    expect(dongLoi("PRODUCT", { ...ok, "Loại tệp": "PDF" })).toBe("Chỉ đặt thời lượng khi cho nộp video");
    expect(dongLoi("PRODUCT", { ...ok, "Dung lượng tối đa (MB)": "0" })).toMatch(/1–500 MB/);
  });
  it("khối lệnh: toạ độ tính từ 1; MÔ PHỎNG (không chạy mã) cho đúng khi tới đích; tường chắn kín / xe đè đích / khối lạ / hướng lạ bị từ chối", () => {
    const ok = { "Đề bài": "Đưa xe tới đích", "Số cột": "4", "Số hàng": "3", "Xe": "1,1,Đông", "Đích": "4,1", "Khối cho phép": "fwd;right;left;repeat", "Số khối tối đa": "8" };
    const n = nhap1("BLOCK_SEQUENCE", ok);
    expect(n.loi).toBeUndefined();
    expect(n.cau!.cauHinh).toMatchObject({ start: { c: 0, r: 0, dir: "E" }, goal: { c: 3, r: 0 } });
    expect(n.cham([{ b: "repeat", n: 3, body: [{ b: "fwd" }] }])).toMatchObject({ dung: true });
    expect(n.cham([{ b: "fwd" }])).toMatchObject({ dung: false });
    expect(dongLoi("BLOCK_SEQUENCE", { ...ok, "Tường": "2,1;2,2;2,3" })).toBe("Tường chắn kín — xe không tới được đích");
    expect(dongLoi("BLOCK_SEQUENCE", { ...ok, "Đích": "1,1" })).toBe("Xe và đích không được cùng một ô");
    expect(dongLoi("BLOCK_SEQUENCE", { ...ok, "Khối cho phép": "fwd;bay" })).toMatch(/Khối "bay" không hợp lệ/);
    expect(dongLoi("BLOCK_SEQUENCE", { ...ok, "Xe": "1,1,Trên" })).toMatch(/Bắc, Đông, Nam hoặc Tây/);
    expect(dongLoi("BLOCK_SEQUENCE", { ...ok, "Xe": "1,1" })).toMatch(/cột,hàng,hướng/);
  });
});

describe("[QIM-09] cột bắt buộc · điểm", () => {
  it("thiếu 'Phải 2' ở sheet Ghép cặp ⇒ MỘT lỗi cho cả sheet nêu đúng cột; đủ cột thì không lỗi header", () => {
    const m = mau("MATCHING");
    const cot = m.cot.filter((c) => c !== "Phải 2");
    const thieu = kiemBangTinh({ [m.sheet]: [cot, cot.map(() => "x")] });
    expect(thieu.loi).toBe(1);
    expect(thieu.chiTiet[0]!.loi).toMatch(/thiếu cột Phải 2/);
    expect(kiemBangTinh(bang("MATCHING", { "Đề bài": "x", "Trái 1": "a", "Phải 1": "b", "Trái 2": "c", "Phải 2": "d" })).loi).toBe(0);
  });
  it("điểm sai ở dạng mở rộng bị từ chối với đúng thông báo; điểm mặc định 1", () => {
    expect(dongLoi("NUMERIC", { "Đề bài": "x", "Đáp án": "1", "Điểm": "0" })).toBe("Điểm phải là số nguyên từ 1 đến 1000");
    expect(nhap1("NUMERIC", { "Đề bài": "x", "Đáp án": "1" }).cau!.points).toBe(1);
  });
});
