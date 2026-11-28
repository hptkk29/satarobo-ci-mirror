import { describe, expect, it } from "vitest";
import { chamBai, chamCau, kiemCauHoi, ketQuaChoHocVien, veChoHocVien, type CauHoiSnapshot, type SnapshotDe } from "./cham-diem";
import { GIOI_HAN_BUOC, LOAI_MO_RONG, docSoVN, kiemCauMoRong, moPhongKhoiLenh, stemAnODapAn, tachOTrong, xaoCoDinh, type SaBan } from "./dang-cau-hoi";

// Dựng một câu qua ĐÚNG đường soạn (kiemCauHoi) rồi chụp thành snapshot — không gõ tay khuôn lưu.
function dung(type: (typeof LOAI_MO_RONG)[number], stem: string, cauHinh: Record<string, unknown>, points = 10): CauHoiSnapshot {
  const k = kiemCauHoi({ type, stem, cauHinh });
  if (!k.ok) throw new Error("fixture không hợp lệ: " + k.thongBao);
  return { id: "q-" + type, type, stem, options: [], cauHinh: k.optionsJson as Record<string, unknown>, key: k.answerKeyJson, points, explanation: "giải thích " + type };
}

const SA_BAN = { cols: 4, rows: 3, start: { c: 0, r: 0, dir: "E" as const }, goal: { c: 3, r: 0 }, walls: [{ c: 1, r: 2 }], blocks: ["fwd", "right", "left", "repeat", "ifwall", "stop"], maxBlocks: 6 };

const FILL = () => dung("FILL_BLANK", "Robot đi [[3|ba]] bước rồi [[dừng]].", { distractors: ["lùi", "quay"] });
const MATCH = () => dung("MATCHING", "Nối bộ phận với việc nó làm", { pairs: [{ left: "Động cơ", right: "Làm bánh xe quay" }, { left: "Pin", right: "Cấp điện" }, { left: "Cảm biến", right: "Đo khoảng cách" }], distractors: ["Phát nhạc"] });
const ORDER = () => dung("ORDERING", "Xếp các bước", { items: ["Đi thẳng tới cửa", "Đo khoảng cách", "Rẽ phải", "Đi qua cửa"] });
const CLASS = () => dung("CLASSIFY", "Phân loại", { groups: [{ name: "Siêu âm", cards: ["Bức tường", "Hộp giấy"] }, { name: "Màu", cards: ["Vạch đen", "Ô đỏ"] }] });
const HOT = () => dung("IMAGE_HOTSPOT", "Chạm vào cảm biến", { image: { imageUrl: "https://example.com/robot.png", width: 800, height: 600 }, regions: [{ shape: "rect", x: 100, y: 100, w: 50, h: 40 }, { shape: "circle", cx: 400, cy: 300, r: 20 }], tolerance: 5 });
const NUM = () => dung("NUMERIC", "20 cm/s trong 3 s?", { answer: 60, tolerance: 1, unit: "cm", hint: "nhân tốc độ với thời gian" });
const PROD = () => dung("PRODUCT", "Quay video robot", { accept: ["VIDEO", "IMAGE"], maxMb: 100, maxVideoSec: 60, rubricId: null });
const BLOCK = () => dung("BLOCK_SEQUENCE", "Đưa xe tới đích", SA_BAN);

const de = (...cau: CauHoiSnapshot[]): SnapshotDe => ({ assessmentId: "a1", title: "Đề", kind: "QUIZ", passPercent: 70, timeLimitMin: null, cau });

describe("[DCH-01] 13 dạng: danh sách + soạn", () => {
  it("có đúng 8 dạng mở rộng", () => expect([...LOAI_MO_RONG].sort()).toEqual(["BLOCK_SEQUENCE", "CLASSIFY", "FILL_BLANK", "IMAGE_HOTSPOT", "MATCHING", "NUMERIC", "ORDERING", "PRODUCT"]));
  it("tách ô trống + che đáp án", () => {
    expect(tachOTrong("a [[3|ba]] b [[dừng]]")).toEqual([["3", "ba"], ["dừng"]]);
    expect(stemAnODapAn("a [[3|ba]] b")).toBe("a [[]] b");
  });
  it.each([
    ["FILL_BLANK", "không có ô trống", () => kiemCauMoRong("FILL_BLANK", "không có ô", {})],
    ["FILL_BLANK", "ô trống rỗng", () => kiemCauMoRong("FILL_BLANK", "a [[]] b", {})],
    ["MATCHING", "chỉ 1 cặp", () => kiemCauMoRong("MATCHING", "x", { pairs: [{ left: "a", right: "b" }] })],
    ["MATCHING", "hai mục phải trùng", () => kiemCauMoRong("MATCHING", "x", { pairs: [{ left: "a", right: "B" }, { left: "c", right: "b" }] })],
    ["ORDERING", "hai bước trùng nội dung", () => kiemCauMoRong("ORDERING", "x", { items: ["Đi", "đi"] })],
    ["CLASSIFY", "một nhóm", () => kiemCauMoRong("CLASSIFY", "x", { groups: [{ name: "a", cards: ["1"] }] })],
    ["CLASSIFY", "thẻ trùng giữa hai nhóm", () => kiemCauMoRong("CLASSIFY", "x", { groups: [{ name: "a", cards: ["1"] }, { name: "b", cards: ["1"] }] })],
    ["IMAGE_HOTSPOT", "ảnh http (không https)", () => kiemCauMoRong("IMAGE_HOTSPOT", "x", { image: { imageUrl: "http://x/y.png", width: 100, height: 100 }, regions: [{ shape: "rect", x: 0, y: 0, w: 5, h: 5 }] })],
    ["IMAGE_HOTSPOT", "vùng ngoài ảnh", () => kiemCauMoRong("IMAGE_HOTSPOT", "x", { image: { imageUrl: "https://x/y.png", width: 100, height: 100 }, regions: [{ shape: "rect", x: 90, y: 0, w: 50, h: 5 }] })],
    ["NUMERIC", "đáp án không phải số", () => kiemCauMoRong("NUMERIC", "x", { answer: "sáu mươi" })],
    ["PRODUCT", "không chọn loại tệp", () => kiemCauMoRong("PRODUCT", "x", { accept: [], maxMb: 10 })],
    ["PRODUCT", "thời lượng video khi không cho nộp video", () => kiemCauMoRong("PRODUCT", "x", { accept: ["IMAGE"], maxMb: 10, maxVideoSec: 30 })],
    ["BLOCK_SEQUENCE", "xe trùng đích", () => kiemCauMoRong("BLOCK_SEQUENCE", "x", { ...SA_BAN, goal: { c: 0, r: 0 } })],
    ["BLOCK_SEQUENCE", "tường đè lên đích", () => kiemCauMoRong("BLOCK_SEQUENCE", "x", { ...SA_BAN, walls: [{ c: 3, r: 0 }] })],
    ["BLOCK_SEQUENCE", "tường chắn kín đích", () => kiemCauMoRong("BLOCK_SEQUENCE", "x", { ...SA_BAN, walls: [{ c: 2, r: 0 }, { c: 3, r: 1 }, { c: 2, r: 1 }, { c: 2, r: 2 }, { c: 3, r: 2 }] })],
  ])("%s: từ chối — %s", (_t, _m, f) => {
    const k = f();
    expect(k.ok).toBe(false);
  });
  it("[đối chứng dương] cấu hình hợp lệ của cả 8 dạng đều được nhận", () => {
    for (const f of [FILL, MATCH, ORDER, CLASS, HOT, NUM, PROD, BLOCK]) expect(f().type).toBeTruthy();
  });
});

describe("[DCH-02] chấm", () => {
  it("điền chỗ trống: đúng hết · một phần (làm tròn xuống) · sai kiểu · ô rỗng không tính", () => {
    const q = FILL();
    expect(chamCau(q, ["ba", "dừng"])).toMatchObject({ dung: true, diem: 10 });
    expect(chamCau(q, [" 3 ", "DỪNG"])).toMatchObject({ dung: true }); // chuẩn hoá khoảng trắng + hoa thường
    expect(chamCau(q, ["3", "lùi"])).toMatchObject({ dung: false, diem: 5, soDung: 1, soCau: 2 });
    expect(chamCau(q, ["", ""])).toMatchObject({ dung: false, diem: 0 });
    expect(chamCau(q, "ba dừng")).toMatchObject({ dung: false, diem: 0 });
    expect(chamCau(q, null)).toMatchObject({ dung: false, diem: 0 });
  });
  it("ghép cặp: từng cặp; mục nhiễu không bao giờ đúng", () => {
    const q = MATCH();
    const d = { l1: "r1", l2: "r2", l3: "r3" };
    expect(chamCau(q, d)).toMatchObject({ dung: true, diem: 10 });
    expect(chamCau(q, { ...d, l3: "d1" })).toMatchObject({ dung: false, diem: 6, soDung: 2, soCau: 3 }); // floor(10*2/3)
    expect(chamCau(q, [])).toMatchObject({ dung: false, diem: 0 });
  });
  it("sắp xếp: số bước đúng vị trí; trùng id = sai", () => {
    const q = ORDER();
    expect(chamCau(q, ["s1", "s2", "s3", "s4"])).toMatchObject({ dung: true, diem: 10 });
    expect(chamCau(q, ["s2", "s1", "s3", "s4"])).toMatchObject({ dung: false, diem: 5 });
    expect(chamCau(q, ["s1", "s1", "s1", "s1"])).toMatchObject({ dung: false, diem: 0 });
  });
  it("phân loại: từng thẻ", () => {
    const q = CLASS();
    expect(chamCau(q, { c1: "g1", c2: "g1", c3: "g2", c4: "g2" })).toMatchObject({ dung: true, diem: 10 });
    expect(chamCau(q, { c1: "g1", c2: "g2", c3: "g2", c4: "g2" })).toMatchObject({ dung: false, diem: 7 }); // floor(10*3/4)
  });
  it("chọn trên hình: trong vùng, trong sai số, ngoài vùng, kiểu sai", () => {
    const q = HOT();
    expect(chamCau(q, { x: 120, y: 120 }).dung).toBe(true);
    expect(chamCau(q, { x: 154, y: 100 }).dung).toBe(true); // ngoài 4px, trong sai số 5
    expect(chamCau(q, { x: 160, y: 100 }).dung).toBe(false);
    expect(chamCau(q, { x: 405, y: 305 }).dung).toBe(true); // vùng tròn
    expect(chamCau(q, { x: "120", y: 120 }).dung).toBe(false);
    expect(chamCau(q, { x: NaN, y: 1 }).dung).toBe(false);
  });
  it("nhập số: dấu phẩy/chấm, sai số, chuỗi lạ", () => {
    const q = NUM();
    expect(chamCau(q, "60").dung).toBe(true);
    expect(chamCau(q, "60,9").dung).toBe(true);
    expect(chamCau(q, "61.0").dung).toBe(true);
    expect(chamCau(q, 59).dung).toBe(true);
    expect(chamCau(q, "62").dung).toBe(false);
    expect(chamCau(q, "sáu mươi").dung).toBe(false);
    expect(chamCau(q, "6e1").dung).toBe(false);
    expect(docSoVN("1,5")).toBe(1.5);
    expect(docSoVN("1,2,3")).toBeNull();
  });
  it("khối lệnh: chạy mô phỏng — tới đích đúng; thiếu/thừa/không hợp lệ sai", () => {
    const q = BLOCK();
    expect(chamCau(q, [{ b: "repeat", n: 3, body: [{ b: "fwd" }] }]).dung).toBe(true); // 3 ô sang phải → (3,0)
    expect(chamCau(q, [{ b: "fwd" }, { b: "fwd" }, { b: "fwd" }, { b: "stop" }]).dung).toBe(true);
    expect(chamCau(q, [{ b: "fwd" }]).dung).toBe(false);
    expect(chamCau(q, [{ b: "repeat", n: 3, body: [{ b: "fwd" }] }, { b: "right" }, { b: "right" }, { b: "right" }, { b: "right" }, { b: "right" }]).dung).toBe(false); // 2 + 5 = 7 > maxBlocks 6 (nút lồng cũng đếm)
    expect(chamCau(q, [{ b: "hack" }]).dung).toBe(false);
    expect(chamCau(q, "while(1){}").dung).toBe(false);
    expect(chamCau(q, [{ b: "fwd", body: [{ b: "fwd" }] }]).dung).toBe(false); // body ở khối không phải lặp/nếu
  });
  it("khối lệnh: vòng lặp lồng nhau bị chặn bằng trần bước (không treo), KHÔNG tính là đúng", () => {
    const sb = { ...SA_BAN, maxBlocks: 60 } as unknown as SaBan;
    const lap = { b: "repeat" as const, n: 9, body: [{ b: "repeat" as const, n: 9, body: [{ b: "repeat" as const, n: 9, body: [{ b: "repeat" as const, n: 9, body: [{ b: "left" as const }] }] }] }] };
    const t0 = Date.now();
    const r = moPhongKhoiLenh(sb, [lap]);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.hetBuoc).toBe(true);
    expect(r.soBuoc).toBeLessThanOrEqual(GIOI_HAN_BUOC + 1); // DỪNG ngay khi vượt trần, không chạy hết 9^4 vòng
    expect(r.dung).toBe(false);
    expect(GIOI_HAN_BUOC).toBe(500);
  });
  it("khối lệnh: gặp tường đứng yên; 'nếu gặp tường' chỉ chạy thân khi có tường", () => {
    const sb = { ...SA_BAN, walls: [{ c: 1, r: 0 }], goal: { c: 0, r: 2 } } as unknown as SaBan;
    // đối diện tường (hướng Đông, tường ở (1,0)): ifwall → rẽ phải (quay Nam) rồi đi 2 ô
    const r = moPhongKhoiLenh(sb, [{ b: "ifwall", body: [{ b: "right" }] }, { b: "repeat", n: 2, body: [{ b: "fwd" }] }]);
    expect(r.dung).toBe(true);
    // không có tường phía trước ⇒ thân KHÔNG chạy
    const r2 = moPhongKhoiLenh({ ...sb, walls: [], goal: { c: 2, r: 0 } }, [{ b: "ifwall", body: [{ b: "right" }] }, { b: "repeat", n: 2, body: [{ b: "fwd" }] }]);
    expect(r2.dung).toBe(true);
  });
  it("nộp sản phẩm KHÔNG tự chấm: dung = null, điểm 0, đề chưa kết luận cho tới khi người chấm chấm", () => {
    const p = PROD();
    expect(chamCau(p, "submission-1")).toMatchObject({ dung: null, diem: 0 });
    const d = de(p, NUM());
    const truoc = chamBai(d, { [p.id]: "sub-1", [d.cau[1]!.id]: "60" });
    expect(truoc).toMatchObject({ canChamTay: true, passed: null, scorePercent: null });
    const sau = chamBai(d, { [p.id]: "sub-1", [d.cau[1]!.id]: "60" }, { [p.id]: 8 });
    expect(sau).toMatchObject({ canChamTay: false, earned: 18, total: 20, scorePercent: 90, passed: true });
    expect(chamBai(d, {}, { [p.id]: 999 }).earned).toBe(10); // kẹp về tối đa
  });
  it("snapshot CŨ (5 dạng, không có cauHinh) chấm y hệt trước", () => {
    const cu: SnapshotDe = {
      assessmentId: "x", title: "cũ", kind: "QUIZ", passPercent: 50, timeLimitMin: null,
      cau: [
        { id: "s", type: "SINGLE_CHOICE", stem: "?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], key: { correct: "a" }, points: 2, explanation: null },
        { id: "m", type: "MULTIPLE_CHOICE", stem: "?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], key: { correct: ["a", "b"] }, points: 2, explanation: null },
        { id: "t", type: "TRUE_FALSE", stem: "?", options: [], key: { correct: true }, points: 1, explanation: null },
        { id: "h", type: "SHORT_TEXT", stem: "?", options: [], key: { accepted: ["siêu âm"] }, points: 1, explanation: null },
      ],
    };
    const kq = chamBai(cu, { s: "a", m: ["b", "a"], t: true, h: " Siêu âm. " });
    expect(kq).toMatchObject({ earned: 6, total: 6, scorePercent: 100, passed: true });
    const v = veChoHocVien(cu).cau[0]!;
    expect(v).toEqual({ id: "s", type: "SINGLE_CHOICE", stem: "?", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], points: 2 });
  });
});

describe("[DCH-03] học viên KHÔNG nhận đáp án (mỗi ca âm có đối chứng dương)", () => {
  const goi = (q: CauHoiSnapshot) => JSON.stringify(veChoHocVien(de(q)).cau[0]);

  it("điền chỗ trống: đề đã che [[ ]]; đáp án chỉ còn lẫn trong kho thẻ chung với từ nhiễu", () => {
    const j = goi(FILL());
    expect(j).not.toContain("[[3|ba]]");
    expect(j).not.toContain("[[dừng]]");
    expect(j).not.toContain('"blanks"');
    expect(j).toContain("[[]]"); // dương: ô trống vẫn hiện
    expect(j).toContain("lùi"); // dương: thẻ nhiễu có mặt
  });
  it("ghép cặp: không có bảng cặp; cột phải không xếp trùng thứ tự đáp án; có mục nhiễu", () => {
    const q = MATCH();
    const j = JSON.parse(goi(q));
    expect(JSON.stringify(j)).not.toContain('"pairs"');
    expect(j.cauHinh.trai.map((x: { id: string }) => x.id)).toEqual(["l1", "l2", "l3"]); // dương
    const phai = j.cauHinh.phai.map((x: { id: string }) => x.id);
    expect(phai).toHaveLength(4);
    expect(phai.slice(0, 3)).not.toEqual(["r1", "r2", "r3"]); // đáp án theo thứ tự l1→r1… không được lộ qua vị trí
  });
  it("sắp xếp: thứ tự gửi đi KHÁC thứ tự đáp án; không có trường order", () => {
    const j = JSON.parse(goi(ORDER()));
    expect(JSON.stringify(j)).not.toContain('"order"');
    const ids = j.cauHinh.muc.map((x: { id: string }) => x.id);
    expect([...ids].sort()).toEqual(["s1", "s2", "s3", "s4"]); // dương: đủ bước
    expect(ids).not.toEqual(["s1", "s2", "s3", "s4"]);
  });
  it("phân loại: thẻ không mang nhóm đúng; có đủ nhóm", () => {
    const j = JSON.parse(goi(CLASS()));
    expect(JSON.stringify(j)).not.toContain('"map"');
    expect(j.cauHinh.nhom).toHaveLength(2); // dương
    expect(j.cauHinh.the).toHaveLength(4);
    expect(j.cauHinh.the[0]).not.toHaveProperty("group");
  });
  it("chọn trên hình: có ảnh + kích thước, KHÔNG vùng đúng, KHÔNG sai số", () => {
    const s = goi(HOT());
    expect(s).toContain("https://example.com/robot.png"); // dương
    expect(s).not.toContain("regions");
    expect(s).not.toContain("tolerance");
    expect(s).not.toContain('"cx"');
  });
  it("nhập số: có đơn vị, KHÔNG đáp án, KHÔNG gợi ý, KHÔNG sai số", () => {
    const s = goi(NUM());
    expect(s).toContain("cm"); // dương
    expect(s).not.toContain("60");
    expect(s).not.toContain("nhân tốc độ");
    expect(s).not.toContain("tolerance");
  });
  it("nộp sản phẩm: có loại tệp cho phép + dung lượng; không khoá nào khác", () => {
    const s = goi(PROD());
    expect(s).toContain("VIDEO"); // dương
    expect(s).toContain("100");
    expect(s).not.toContain("rubric");
  });
  it("khối lệnh: có sa bàn + khối cho phép (không có gì để lộ — đáp án là chương trình do học viên viết)", () => {
    const j = JSON.parse(goi(BLOCK()));
    expect(j.cauHinh.goal).toEqual({ c: 3, r: 0 }); // dương: đích hiển thị
    expect(j.cauHinh.maxBlocks).toBe(6);
    expect(JSON.stringify(j)).not.toContain("giải");
  });
  it("giải thích không có trong phần gửi khi đang làm (mọi dạng)", () => {
    for (const f of [FILL, MATCH, ORDER, CLASS, HOT, NUM, PROD, BLOCK]) expect(goi(f())).not.toContain("giải thích ");
  });
  it("sau khi nộp, theo cài đặt: dạng mở rộng chỉ lộ đáp án khi hết lượt/đạt (như dạng cũ)", () => {
    const d = de(MATCH());
    const kq = chamBai(d, {});
    const conLuot = ketQuaChoHocVien({ de: d, ketQua: kq, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT", conLuot: true });
    expect(JSON.stringify(conLuot)).not.toContain('"pairs"'); // âm: còn lượt ⇒ không lộ
    const hetLuot = ketQuaChoHocVien({ de: d, ketQua: kq, xemKetQua: "CA_DAP_AN_SAU_HET_LUOT", conLuot: false });
    expect(JSON.stringify(hetLuot)).toContain('"pairs"'); // dương: hết lượt ⇒ lộ
  });
  it("xáo cố định: ổn định theo hạt giống, và luôn khác thứ tự gốc", () => {
    const ds = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(xaoCoDinh(ds, "h")).toEqual(xaoCoDinh(ds, "h"));
    for (const h of ["1", "2", "3", "4", "5", "6", "7", "8"]) expect(xaoCoDinh(ds, h).map((x) => x.id)).not.toEqual(["a", "b", "c"]);
  });
});
