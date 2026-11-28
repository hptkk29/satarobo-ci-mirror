/** [TKP-*] Tìm kiếm của người học — phần thuần. */
import { describe, expect, it } from "vitest";
import { coTheTim, danhDauKhop, demTheoTab, lamSachTuKhoa, locKetQua, theoTab, type KetQuaTim } from "./tim-kiem-pure";

const kq = (loai: KetQuaTim["loai"], tieuDe: string): KetQuaTim => ({ loai, id: `${loai}-${tieuDe}`, tieuDe, nguCanh: "", href: "/x" });
const DS = [kq("khoa", "An toàn điện"), kq("bai", "Quy trình an toàn"), kq("bai", "Sơ cứu"), kq("chung-nhan", "An toàn điện")];

describe("[TKP-01] lọc + đếm", () => {
  it("bỏ dấu, không phân biệt hoa thường", () => {
    expect(locKetQua(DS, "AN TOAN").map((k) => k.tieuDe)).toEqual(["An toàn điện", "Quy trình an toàn", "An toàn điện"]);
  });
  it("từ khoá quá ngắn hoặc rỗng ⇒ không tìm (không trả cả kho)", () => {
    expect(locKetQua(DS, "a")).toEqual([]);
    expect(locKetQua(DS, "   ")).toEqual([]);
    expect(coTheTim("a")).toBe(false);
    expect(coTheTim("an")).toBe(true);
  });
  it("đếm theo tab và lọc theo tab khớp nhau", () => {
    const ds = locKetQua(DS, "an toan");
    const dem = demTheoTab(ds);
    expect(dem).toEqual({ "tat-ca": 3, khoa: 1, bai: 1, "chung-nhan": 1 });
    expect(theoTab(ds, "bai")).toHaveLength(dem.bai);
    expect(theoTab(ds, "tat-ca")).toHaveLength(dem["tat-ca"]);
  });
  it("lamSachTuKhoa: gộp khoảng trắng, cắt 100 ký tự", () => {
    expect(lamSachTuKhoa("  an   toàn ")).toBe("an toàn");
    expect(lamSachTuKhoa("x".repeat(500))).toHaveLength(100);
    expect(lamSachTuKhoa(undefined)).toBe("");
  });
});

describe("[TKP-02] danhDauKhop — tô đúng chữ GỐC có dấu", () => {
  const ghep = (d: ReturnType<typeof danhDauKhop>) => d.map((x) => (x.khop ? `[${x.chu}]` : x.chu)).join("");
  it("từ khoá không dấu tô được chữ có dấu", () => {
    expect(ghep(danhDauKhop("Quy trình an toàn điện", "an toan"))).toBe("Quy trình [an toàn] điện");
  });
  it("nhiều chỗ khớp; không phân biệt hoa thường", () => {
    expect(ghep(danhDauKhop("Điện áp, điện trở", "dien"))).toBe("[Điện] áp, [điện] trở");
  });
  it("không khớp ⇒ một đoạn nguyên; ghép lại luôn ra đúng chuỗi gốc", () => {
    const t = "Sơ cứu — đặc biệt";
    expect(danhDauKhop(t, "xyz")).toEqual([{ chu: t, khop: false }]);
    expect(danhDauKhop(t, "dac biet").map((x) => x.chu).join("")).toBe(t);
  });
  it("từ khoá ngắn quá ⇒ không tô", () => {
    expect(danhDauKhop("An toàn", "a")).toEqual([{ chu: "An toàn", khop: false }]);
  });
});
