// PORT từ repo hodacphuchtc/DISC · tests/doi-chieu.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { NHAN_MUC_LECH, VAN_BAN_LECH } from "@/lib/disc/engine-goc/config/disc-doi-chieu";
import { NGUONG_VUNG_LECH } from "@/lib/disc/engine-goc/config/disc-nguong";
import { MA_TRUC, type KetQua, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import {
  bietDanhCoBai,
  chonCapMoiNhat,
  doiChieu,
  mucLechTu,
  type BaiDeGhep,
} from "@/lib/disc/engine-goc/modules/report/doi-chieu";

const hopLe = (diem: Record<MaTruc, number>): KetQua => ({
  hopLe: true,
  diem,
  xepHang: [...MA_TRUC],
  kieu: { loai: "deu" },
  canhBao: [],
});

const bai = (
  boDe: MaBoDe,
  diem: Record<MaTruc, number>,
  ghiDe: Partial<BaiDeGhep> = {},
): BaiDeGhep => ({
  id: `${boDe}-${ghiDe.maTre ?? "Bi"}`,
  boDe,
  maTre: "Bi",
  ketThuc: "2026-08-27T06:00:00+07:00",
  ketQua: hopLe(diem),
  phienBanBoDe: "1.0",
  ...ghiDe,
});

const CON = { D: 70, I: 50, S: 40, C: 60 };
const BO_ME = { D: 40, I: 45, S: 55, C: 58 };

describe("mucLechTu — ba mức, kiểm BIÊN", () => {
  it("lệch đúng bằng 10 ⇒ vẫn là TRÙNG KHỚP (biên trên)", () => {
    expect(NGUONG_VUNG_LECH.trungKhopToiDa).toBe(10);
    expect(mucLechTu(10)).toBe("trungKhop");
    expect(mucLechTu(-10)).toBe("trungKhop");
  });

  it("lệch 10,1 ⇒ HƠI KHÁC", () => {
    expect(mucLechTu(10.1)).toBe("hoiKhac");
  });

  it("lệch đúng bằng 25 ⇒ vẫn là HƠI KHÁC (biên trên)", () => {
    expect(NGUONG_VUNG_LECH.hoiKhacToiDa).toBe(25);
    expect(mucLechTu(25)).toBe("hoiKhac");
    expect(mucLechTu(-25)).toBe("hoiKhac");
  });

  it("lệch 25,1 ⇒ KHÁC RÕ", () => {
    expect(mucLechTu(25.1)).toBe("khacRo");
    expect(mucLechTu(-40)).toBe("khacRo");
  });

  it("ba mức đều có nhãn và màu", () => {
    for (const m of ["trungKhop", "hoiKhac", "khacRo"] as const) {
      expect(NHAN_MUC_LECH[m].ten.length).toBeGreaterThan(0);
      expect(NHAN_MUC_LECH[m].mau).toMatch(/^#[0-9A-F]{6}$/iu);
    }
  });
});

describe("doiChieu — điều kiện ghép cặp", () => {
  it("chỉ có bài con ⇒ mời làm bài bố mẹ, KHÔNG trả màn hình rỗng", () => {
    const kq = doiChieu([bai("THCS", CON)], "Bi");
    expect(kq).toEqual({ ghepDuoc: false, lyDo: { ma: "THIEU_BAI_BO_ME" } });
  });

  it("chỉ có bài bố mẹ ⇒ mời con làm bài", () => {
    const kq = doiChieu([bai("QS", BO_ME)], "Bi");
    expect(kq).toEqual({ ghepDuoc: false, lyDo: { ma: "THIEU_BAI_CON" } });
  });

  it("không có bài nào ⇒ báo thiếu bài con", () => {
    expect(doiChieu([], "Bi").ghepDuoc).toBe(false);
  });

  it("🔴 KHÁC phiên bản bộ đề ⇒ TỪ CHỐI ghép", () => {
    const kq = doiChieu(
      [bai("THCS", CON), bai("QS", BO_ME, { phienBanBoDe: "1.1" })],
      "Bi",
    );
    expect(kq).toEqual({ ghepDuoc: false, lyDo: { ma: "KHAC_PHIEN_BAN" } });
  });

  it("🔴 cách nhau ĐÚNG 60 ngày ⇒ VẪN ghép (biên trên)", () => {
    expect(NGUONG_VUNG_LECH.soNgayToiDa).toBe(60);
    const kq = doiChieu(
      [
        bai("THCS", CON, { ketThuc: "2026-06-28T06:00:00Z" }),
        bai("QS", BO_ME, { ketThuc: "2026-08-27T06:00:00Z" }),
      ],
      "Bi",
    );
    expect(kq.ghepDuoc).toBe(true);
  });

  it("🔴 cách nhau 61 ngày ⇒ TỪ CHỐI ghép", () => {
    const kq = doiChieu(
      [
        bai("THCS", CON, { ketThuc: "2026-06-27T06:00:00Z" }),
        bai("QS", BO_ME, { ketThuc: "2026-08-27T06:00:00Z" }),
      ],
      "Bi",
    );
    expect(kq.ghepDuoc).toBe(false);
    if (!kq.ghepDuoc) expect(kq.lyDo.ma).toBe("QUA_HAN");
  });

  it("ngày hỏng ⇒ TỪ CHỐI ghép chứ không coi như 0 ngày", () => {
    const kq = doiChieu(
      [bai("THCS", CON, { ketThuc: "27/08/2026" }), bai("QS", BO_ME)],
      "Bi",
    );
    expect(kq.ghepDuoc).toBe(false);
  });

  it("biệt danh khác nhau ⇒ KHÔNG ghép chéo người", () => {
    const kq = doiChieu(
      [bai("THCS", CON, { maTre: "Bi" }), bai("QS", BO_ME, { maTre: "Bống" })],
      "Bi",
    );
    expect(kq).toEqual({ ghepDuoc: false, lyDo: { ma: "THIEU_BAI_BO_ME" } });
  });

  it("bài KHÔNG hợp lệ không được đem ra ghép", () => {
    const baiHong: BaiDeGhep = {
      ...bai("QS", BO_ME),
      ketQua: { hopLe: false, lyDo: "PHANG" },
    };
    expect(doiChieu([bai("THCS", CON), baiHong], "Bi").ghepDuoc).toBe(false);
  });

  it("bộ Tiểu học cũng ghép được, không riêng THCS", () => {
    expect(doiChieu([bai("TH", CON), bai("QS", BO_ME)], "Bi").ghepDuoc).toBe(true);
  });
});

describe("doiChieu — bảng và diễn giải", () => {
  const kq = doiChieu([bai("THCS", CON), bai("QS", BO_ME)], "Bi");

  it("bảng có đủ bốn trục, giữ thứ tự D-I-S-C", () => {
    if (!kq.ghepDuoc) throw new Error("phải ghép được");
    expect(kq.bang.map((x) => x.truc)).toEqual([...MA_TRUC]);
  });

  it("lệch = điểm con − điểm bố mẹ, CÓ DẤU", () => {
    if (!kq.ghepDuoc) throw new Error("phải ghép được");
    const d = kq.bang.find((x) => x.truc === "D")!;
    expect(d.lech).toBe(30);
    const s = kq.bang.find((x) => x.truc === "S")!;
    expect(s.lech).toBe(-15);
  });

  it("hướng lệch đúng: dương ⇒ con tự thấy cao hơn", () => {
    if (!kq.ghepDuoc) throw new Error("phải ghép được");
    expect(kq.bang.find((x) => x.truc === "D")!.huong).toBe("con-cao-hon");
    expect(kq.bang.find((x) => x.truc === "S")!.huong).toBe("con-thap-hon");
  });

  it("🔴 diễn giải TỐI ĐA HAI trục, dù cả bốn đều lệch", () => {
    const lechCaBon = doiChieu(
      [
        bai("THCS", { D: 90, I: 90, S: 10, C: 10 }),
        bai("QS", { D: 10, I: 10, S: 90, C: 90 }),
      ],
      "Bi",
    );
    if (!lechCaBon.ghepDuoc) throw new Error("phải ghép được");
    expect(lechCaBon.bang.every((x) => x.mucLech === "khacRo")).toBe(true);
    expect(lechCaBon.dienGiai).toHaveLength(NGUONG_VUNG_LECH.soTrucDienGiaiToiDa);
    expect(NGUONG_VUNG_LECH.soTrucDienGiaiToiDa).toBe(2);
  });

  it("diễn giải chọn đúng HAI trục lệch LỚN NHẤT", () => {
    if (!kq.ghepDuoc) throw new Error("phải ghép được");
    // D lệch 30, S lệch −15, I lệch 5, C lệch 2 ⇒ chọn D rồi S.
    expect(kq.dienGiai.map((x) => x.truc)).toEqual(["D", "S"]);
  });

  it("trục TRÙNG KHỚP không được đem ra diễn giải", () => {
    const gan = doiChieu(
      [bai("THCS", { D: 50, I: 50, S: 50, C: 50 }), bai("QS", { D: 55, I: 52, S: 48, C: 50 })],
      "Bi",
    );
    if (!gan.ghepDuoc) throw new Error("phải ghép được");
    expect(gan.dienGiai).toHaveLength(0);
  });

  it("văn bản diễn giải lấy đúng theo trục và hướng", () => {
    if (!kq.ghepDuoc) throw new Error("phải ghép được");
    expect(kq.dienGiai[0].than).toBe(VAN_BAN_LECH.D["con-cao-hon"]);
    expect(kq.dienGiai[1].than).toBe(VAN_BAN_LECH.S["con-thap-hon"]);
  });

  it("🔴 đủ 8 văn bản: bốn trục × hai hướng, không khoá nào trống", () => {
    for (const t of MA_TRUC) {
      for (const h of ["con-cao-hon", "con-thap-hon"] as const) {
        expect(VAN_BAN_LECH[t][h].trim().length, `${t}/${h}`).toBeGreaterThan(40);
      }
    }
  });
});

describe("chọn cặp và liệt kê biệt danh", () => {
  it("lấy bài MỚI NHẤT của mỗi phía", () => {
    const cap = chonCapMoiNhat(
      [
        bai("THCS", CON, { id: "cu", ketThuc: "2026-08-01T06:00:00Z" }),
        bai("THCS", CON, { id: "moi", ketThuc: "2026-08-27T06:00:00Z" }),
        bai("QS", BO_ME, { id: "qs" }),
      ],
      "Bi",
    );
    expect(cap.con?.id).toBe("moi");
    expect(cap.boMe?.id).toBe("qs");
  });

  it("liệt kê biệt danh có bài hợp lệ, sắp xếp, không trùng", () => {
    const ds = [
      bai("THCS", CON, { maTre: "Bống" }),
      bai("QS", BO_ME, { maTre: "Bi" }),
      bai("THCS", CON, { maTre: "Bi" }),
    ];
    expect(bietDanhCoBai(ds)).toEqual(["Bi", "Bống"]);
  });
});
