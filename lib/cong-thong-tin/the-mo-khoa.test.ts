/**
 * [CTT-TK-*] Thẻ mở khoá (cookie `sr_ctt`) — ký HMAC, hết hạn, chống giả. Khoá và đồng hồ được TIÊM (không đọc giờ thật).
 *   [CTT-TK-01] thẻ vừa ký hợp lệ; mang nguồn lần đầu; hết hạn đúng mốc
 *   [CTT-TK-02] sửa một chữ ở payload hoặc chữ ký ⇒ SAI_CHU_KY; ký bằng khoá khác ⇒ SAI_CHU_KY
 *   [CTT-TK-03] rác/thiếu/quá dài ⇒ từ chối, không ném
 *   [CTT-TK-04] thẻ không chở dữ liệu cá nhân
 */
import { describe, expect, it } from "vitest";
import { kiemTheMoKhoa, kyTheMoKhoa, TUOI_THE_MO_KHOA_GIAY } from "./the-mo-khoa";

const KHOA = "k".repeat(40);
const KHOA_KHAC = "z".repeat(40);
const T0 = new Date("2026-11-07T03:00:00Z");
const sau = (giay: number) => new Date(T0.getTime() + giay * 1000);

describe("[CTT-TK-01] ký và kiểm", () => {
  it("hợp lệ ngay sau khi ký; mang nguồn", () => {
    const the = kyTheMoKhoa({ nguon: "tu-sach", bayGio: T0, khoa: KHOA });
    expect(kiemTheMoKhoa(the, { bayGio: sau(60), khoa: KHOA })).toEqual({ ok: true, nguon: "tu-sach", hetHanLuc: Math.floor(T0.getTime() / 1000) + TUOI_THE_MO_KHOA_GIAY });
  });
  it("hết hạn đúng mốc: trước mốc 1 giây còn hiệu lực, đúng mốc thì HẾT", () => {
    const the = kyTheMoKhoa({ nguon: "suc-khoe", bayGio: T0, khoa: KHOA, tuoiGiay: 100 });
    expect(kiemTheMoKhoa(the, { bayGio: sau(99), khoa: KHOA }).ok).toBe(true);
    expect(kiemTheMoKhoa(the, { bayGio: sau(100), khoa: KHOA })).toEqual({ ok: false, lyDo: "HET_HAN" });
    expect(kiemTheMoKhoa(the, { bayGio: sau(1000), khoa: KHOA })).toEqual({ ok: false, lyDo: "HET_HAN" });
  });
});

describe("[CTT-TK-02] chống giả", () => {
  const the = kyTheMoKhoa({ nguon: "tu-sach", bayGio: T0, khoa: KHOA });
  const [p, s] = the.split(".") as [string, string];
  const doiMotChu = (x: string) => x.slice(0, 3) + (x[3] === "A" ? "B" : "A") + x.slice(4);
  it("sửa payload hoặc chữ ký ⇒ SAI_CHU_KY", () => {
    expect(kiemTheMoKhoa(`${doiMotChu(p)}.${s}`, { bayGio: T0, khoa: KHOA })).toEqual({ ok: false, lyDo: "SAI_CHU_KY" });
    expect(kiemTheMoKhoa(`${p}.${doiMotChu(s)}`, { bayGio: T0, khoa: KHOA })).toEqual({ ok: false, lyDo: "SAI_CHU_KY" });
  });
  it("kéo dài hạn bằng cách tự viết payload mới kèm chữ ký cũ ⇒ SAI_CHU_KY", () => {
    const payloadMoi = Buffer.from(JSON.stringify({ v: 1, e: 9_999_999_999, n: "tu-sach" })).toString("base64url");
    expect(kiemTheMoKhoa(`${payloadMoi}.${s}`, { bayGio: T0, khoa: KHOA })).toEqual({ ok: false, lyDo: "SAI_CHU_KY" });
  });
  it("ký bằng khoá khác ⇒ SAI_CHU_KY", () => {
    expect(kiemTheMoKhoa(kyTheMoKhoa({ nguon: "tu-sach", bayGio: T0, khoa: KHOA_KHAC }), { bayGio: T0, khoa: KHOA })).toEqual({ ok: false, lyDo: "SAI_CHU_KY" });
  });
});

describe("[CTT-TK-03] đầu vào rác", () => {
  it.each([[undefined], [null], [""], ["abc"], ["a.b.c"], ["."], ["a."], [".b"], ["x".repeat(500)]])("%j ⇒ từ chối, không ném", (the) => {
    expect(kiemTheMoKhoa(the as string | null | undefined, { bayGio: T0, khoa: KHOA }).ok).toBe(false);
  });
});

describe("[CTT-TK-04] thẻ không chở dữ liệu cá nhân", () => {
  it("payload chỉ gồm v · e · n", () => {
    const the = kyTheMoKhoa({ nguon: "tu-sach", bayGio: T0, khoa: KHOA });
    const noi = JSON.parse(Buffer.from(the.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(Object.keys(noi).sort()).toEqual(["e", "n", "v"]);
  });
});
