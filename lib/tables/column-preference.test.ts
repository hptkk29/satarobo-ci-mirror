// G-04 — lõi THUẦN của "tuỳ chọn cột": ghép cấu hình đã lưu của một người với
// danh mục cột của tầng mã.
//
// Thứ đáng khoá ở đây không phải hình dạng dữ liệu mà là bốn ca hỏng CÂM:
//  1. Cột bị gỡ khỏi hệ thống trong khi có người đã lưu nó → phải bỏ qua im lặng,
//     KHÔNG ném lỗi và KHÔNG tự dọn bản ghi (cột có thể quay lại sau cờ tính năng).
//  2. Cột MỚI thêm vào danh mục sau khi người ta đã lưu → nếu chỉ nhớ `visible`
//     thì cột mới KHÔNG BAO GIỜ hiện với người đã lưu cấu hình, và không ai báo.
//  3. Một dòng JSON hỏng không được làm chết trang danh sách lead.
//  4. Lọc xong còn 0 cột → bảng trắng, không một dòng lỗi.
import { describe, it, expect } from "vitest";
import {
  defaultColumnLayout,
  normalizeColumnsForSave,
  resolveColumnLayout,
  type TableColumnDef,
} from "./column-preference";

const CATALOG: readonly TableColumnDef[] = [
  { key: "a", label: "A", group: "G1", defaultVisible: true, defaultOrder: 10 },
  { key: "b", label: "B", group: "G1", defaultVisible: true, defaultOrder: 20 },
  { key: "c", label: "C", group: "G2", defaultVisible: false, defaultOrder: 30 },
];

const keys = (defs: readonly TableColumnDef[]) => defs.map((d) => d.key);

describe("[G-04] resolveColumnLayout — chưa có cấu hình", () => {
  it("null/undefined → đúng bộ mặc định của danh mục", () => {
    for (const raw of [null, undefined]) {
      const l = resolveColumnLayout(CATALOG, raw);
      expect(keys(l.visible)).toEqual(["a", "b"]);
      expect(keys(l.hidden)).toEqual(["c"]);
    }
  });

  it("mặc định xếp theo defaultOrder chứ không theo thứ tự khai báo", () => {
    const xao: readonly TableColumnDef[] = [
      { key: "z", label: "Z", group: "G", defaultVisible: true, defaultOrder: 99 },
      { key: "y", label: "Y", group: "G", defaultVisible: true, defaultOrder: 1 },
    ];
    expect(keys(defaultColumnLayout(xao).visible)).toEqual(["y", "z"]);
  });
});

describe("[G-04] resolveColumnLayout — cấu hình đã lưu", () => {
  it("giữ ĐÚNG thứ tự người dùng đã kéo, không xếp lại theo defaultOrder", () => {
    const l = resolveColumnLayout(CATALOG, { v: 1, visible: ["c", "a"], hidden: ["b"] });
    expect(keys(l.visible)).toEqual(["c", "a"]);
    expect(keys(l.hidden)).toEqual(["b"]);
  });

  it("khoá LẠC (cột đã gỡ khỏi hệ thống) bị bỏ qua im lặng, không ném lỗi", () => {
    const l = resolveColumnLayout(CATALOG, {
      v: 1,
      visible: ["a", "cot-da-go", "b"],
      hidden: ["cot-cu-khac"],
    });
    expect(keys(l.visible)).toEqual(["a", "b"]);
    expect(keys(l.hidden)).toEqual(["c"]);
  });

  it("khoá trùng trong `visible` chỉ được tính một lần", () => {
    const l = resolveColumnLayout(CATALOG, { v: 1, visible: ["a", "a", "b"], hidden: [] });
    expect(keys(l.visible)).toEqual(["a", "b"]);
  });

  it("cột MỚI (chưa có trong cả visible lẫn hidden) chèn theo defaultVisible + defaultOrder", () => {
    // Người này lưu cấu hình từ hồi danh mục chỉ có "a" và "c".
    const l = resolveColumnLayout(CATALOG, { v: 1, visible: ["a", "c"], hidden: [] });
    // "b" là cột mới, defaultVisible=true, defaultOrder=20 → chèn TRƯỚC "c" (30),
    // SAU "a" (10). Nối vào cuối là cột mới rơi tuốt bên phải, người ta không thấy.
    expect(keys(l.visible)).toEqual(["a", "b", "c"]);
  });

  it("cột MỚI mà defaultVisible=false thì nằm im ở danh sách ẩn", () => {
    const l = resolveColumnLayout(CATALOG, { v: 1, visible: ["a", "b"], hidden: [] });
    expect(keys(l.visible)).toEqual(["a", "b"]);
    expect(keys(l.hidden)).toEqual(["c"]);
  });

  it("cột người ta CHỦ Ý tắt thì không bị chèn lại — đó là điểm khác nhau giữa `hidden` và 'chưa biết'", () => {
    const l = resolveColumnLayout(CATALOG, { v: 1, visible: ["a"], hidden: ["b", "c"] });
    expect(keys(l.visible)).toEqual(["a"]);
    expect(keys(l.hidden)).toEqual(["b", "c"]);
  });
});

describe("[G-04] resolveColumnLayout — dữ liệu hỏng KHÔNG được làm chết trang", () => {
  it.each([
    ["chuỗi rác", "khong-phai-json"],
    ["số", 42],
    ["mảng", [1, 2, 3]],
    ["thiếu v", { visible: ["a"] }],
    ["v lạ", { v: 99, visible: ["a"] }],
    ["visible không phải mảng", { v: 1, visible: "a" }],
    ["phần tử không phải chuỗi", { v: 1, visible: [1, 2] }],
  ])("%s → rơi về mặc định, không throw", (_ten, raw) => {
    expect(() => resolveColumnLayout(CATALOG, raw)).not.toThrow();
    expect(keys(resolveColumnLayout(CATALOG, raw).visible)).toEqual(["a", "b"]);
  });

  it("nhận cả JSON dạng CHUỖI (cột Json trả về chuỗi ở một số đường đọc)", () => {
    const l = resolveColumnLayout(CATALOG, JSON.stringify({ v: 1, visible: ["b"], hidden: ["a", "c"] }));
    expect(keys(l.visible)).toEqual(["b"]);
  });

  it("lọc xong còn 0 cột → dùng nguyên bộ mặc định, KHÔNG render bảng trắng", () => {
    const l = resolveColumnLayout(CATALOG, { v: 1, visible: ["chi-toan-khoa-lac"], hidden: [] });
    expect(keys(l.visible)).toEqual(["a", "b"]);
  });
});

describe("[G-04] normalizeColumnsForSave — lưu là dịp tự dọn khoá lạc", () => {
  it("loại khoá lạc khỏi bản ghi mới và điền `hidden` đủ phần còn lại", () => {
    expect(normalizeColumnsForSave(CATALOG, ["b", "khong-ton-tai", "a"])).toEqual({
      v: 1,
      visible: ["b", "a"],
      hidden: ["c"],
    });
  });

  it("khoá trùng chỉ giữ lần xuất hiện đầu", () => {
    expect(normalizeColumnsForSave(CATALOG, ["a", "a", "b"]).visible).toEqual(["a", "b"]);
  });

  it("ghi rồi đọc lại ra đúng thứ tự đã ghi (vòng khép kín)", () => {
    const luu = normalizeColumnsForSave(CATALOG, ["c", "b"]);
    expect(keys(resolveColumnLayout(CATALOG, luu).visible)).toEqual(["c", "b"]);
    // và cột đã tắt KHÔNG tự quay lại ở lần đọc sau.
    expect(keys(resolveColumnLayout(CATALOG, luu).hidden)).toEqual(["a"]);
  });
});
