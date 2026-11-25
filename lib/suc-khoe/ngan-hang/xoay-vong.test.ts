/**
 * [SK-XV-*] Ngân hàng «xoay vòng» 1000 câu + luật chọn câu.
 *   [SK-XV-01] ĐÚNG 1000 câu, id duy nhất, không trùng chữ trong CÙNG nhóm đối tượng
 *   [SK-XV-02] hình dạng từng câu: nhóm/lĩnh vực/loại hợp lệ, 2–3 lựa chọn, kt có đáp án trong khoảng + lời giải, tq KHÔNG đáp án
 *   [SK-XV-03] phân bố: đủ 6 lĩnh vực × 3 nhóm; đáp án đúng không dồn một vị trí; mọi nhóm đủ câu để quay ≥ 100 lượt không lặp
 *   [SK-XV-04] nội dung: không có từ cấm (chẩn đoán/thuốc/thực phẩm chức năng); placeholder chỉ {ai}/{Ai}; câu hỏi ≤ 150 ký tự
 *   [SK-XV-05] chọn câu: đúng nhóm tuổi, bỏ câu đã thấy, tối đa 3 câu, lĩnh vực khác nhau, có đúng một câu kiến thức đầu tiên nếu còn
 *   [SK-XV-06] không lặp: quay liên tục tới khi cạn — không câu nào xuất hiện hai lần cho cùng một người; cạn thì trả ít/không còn câu
 *   [SK-XV-07] thayTen và phản hồi câu kiến thức
 */
import { describe, expect, it } from "vitest";
import { cauConLai, chonXoayVong, NGAN_HANG_XOAY_VONG, phanHoiCauKienThuc, thayTen, type CauXoayVong } from "./xoay-vong";

const bo = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Bộ ngẫu nhiên tất định (mulberry32) — test không dùng Math.random. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("[SK-XV-01] kích thước và tính duy nhất", () => {
  it("đúng 1000 câu, id duy nhất", () => {
    expect(NGAN_HANG_XOAY_VONG).toHaveLength(1000);
    expect(new Set(NGAN_HANG_XOAY_VONG.map((c) => c.id)).size).toBe(1000);
  });
  it("không có hai câu trùng chữ trong cùng nhóm đối tượng", () => {
    const thay = new Map<string, string>();
    const trung: string[] = [];
    for (const c of NGAN_HANG_XOAY_VONG) {
      const k = `${c.nhom}|${bo(c.cau)}`;
      if (thay.has(k)) trung.push(`${c.id}=${thay.get(k)}`);
      thay.set(k, c.id);
    }
    expect(trung).toEqual([]);
  });
});

describe("[SK-XV-02] hình dạng từng câu", () => {
  it("mọi câu hợp lệ", () => {
    const hong: string[] = [];
    for (const c of NGAN_HANG_XOAY_VONG) {
      const e: string[] = [];
      if (!["tre", "nl", "all"].includes(c.nhom)) e.push("nhom");
      if (!["an", "vd", "ngu", "mh", "tt", "th"].includes(c.linhVuc)) e.push("linhVuc");
      if (!["tq", "kt"].includes(c.loai)) e.push("loai");
      if (c.cau.length < 8 || c.cau.length > 150) e.push("dai");
      if (c.luaChon.length < 2 || c.luaChon.length > 3 || c.luaChon.some((o) => !o || o.length > 60)) e.push("luaChon");
      if (new Set(c.luaChon.map((o) => o.toLowerCase())).size !== c.luaChon.length) e.push("luaChon-trung");
      if (c.loai === "kt" && (c.dapAn === null || c.dapAn < 0 || c.dapAn >= c.luaChon.length || c.giaiThich.length < 10)) e.push("kt");
      if (c.loai === "tq" && (c.dapAn !== null || c.giaiThich !== "")) e.push("tq");
      if (!c.nguon) e.push("nguon");
      if (e.length) hong.push(`${c.id}:${e.join(",")}`);
    }
    expect(hong).toEqual([]);
  });
});

describe("[SK-XV-03] phân bố", () => {
  it("đủ 6 lĩnh vực ở mỗi nhóm, mỗi ô ≥ 10 câu", () => {
    for (const nhom of ["tre", "nl", "all"] as const) {
      for (const lv of ["an", "vd", "ngu", "mh", "tt", "th"] as const) {
        const n = NGAN_HANG_XOAY_VONG.filter((c) => c.nhom === nhom && c.linhVuc === lv).length;
        expect(n, `${nhom}/${lv}`).toBeGreaterThanOrEqual(10);
      }
    }
  });
  it("đáp án đúng của câu kiến thức không dồn một vị trí (mỗi vị trí ≥ 25%)", () => {
    const kt = NGAN_HANG_XOAY_VONG.filter((c) => c.loai === "kt" && c.luaChon.length === 3);
    for (const v of [0, 1, 2]) expect(kt.filter((c) => c.dapAn === v).length / kt.length, `vị trí ${v}`).toBeGreaterThan(0.25);
  });
  it("mỗi nhóm tuổi (trẻ / người lớn) có ≥ 300 câu để quay không lặp ≥ 100 lượt", () => {
    expect(cauConLai(true, [])).toHaveLength(NGAN_HANG_XOAY_VONG.filter((c) => c.nhom !== "nl").length);
    expect(cauConLai(true, []).length).toBeGreaterThanOrEqual(300);
    expect(cauConLai(false, []).length).toBeGreaterThanOrEqual(300);
  });
});

describe("[SK-XV-04] nội dung an toàn", () => {
  const TOAN_BO = (c: CauXoayVong) => [c.cau, ...c.luaChon, c.giaiThich].join(" ");
  it("không có từ cấm: chẩn đoán / liều thuốc / thực phẩm chức năng / bài thuốc", () => {
    const CAM = /(chẩn đoán|kê đơn|liều (dùng|lượng)|thực phẩm chức năng|vitamin (bổ sung|tổng hợp)|thuốc (bổ|kháng sinh|ngủ)\b|bài thuốc|melatonin|thuốc an thần)/i;
    expect(NGAN_HANG_XOAY_VONG.filter((c) => CAM.test(TOAN_BO(c))).map((c) => c.id)).toEqual([]);
  });
  it("placeholder chỉ {ai} / {Ai}; không có ký tự điều khiển; không có markdown", () => {
    const coKyTuDieuKhien = (s: string) => Array.from(s).some((ch) => ch.charCodeAt(0) < 32);
    const hong = NGAN_HANG_XOAY_VONG.filter((c) => /\{(?![aA]i\})/.test(TOAN_BO(c)) || coKyTuDieuKhien(TOAN_BO(c)) || /[*_`#]{2,}|\[.*\]\(.*\)/.test(TOAN_BO(c)));
    expect(hong.map((c) => c.id)).toEqual([]);
  });
  it("giọng nhóm người lớn: «anh chị», không còn «bạn» đại từ", () => {
    const con = NGAN_HANG_XOAY_VONG.filter((c) => c.nhom === "nl" && /(?<![\p{L}])[Bb]ạn(?![\p{L}])(?!\s+(bè|cùng|học|thân|trong|của con|tốt|xấu))/u.test(TOAN_BO(c)));
    expect(con.map((c) => c.id)).toEqual([]);
  });
  it("câu nhóm trẻ về một người có {ai} (hỏi PHỤ HUYNH về bé), không hỏi bằng ngôi «bạn»", () => {
    const sai = NGAN_HANG_XOAY_VONG.filter((c) => c.nhom === "tre" && c.loai === "tq" && !/\{[aA]i\}/.test(c.cau) && !/\b(nhà mình|ba mẹ|gia đình|cả nhà)\b/i.test(c.cau));
    expect(sai.length).toBeLessThanOrEqual(25); // một số câu tre là hỏi về môi trường nhà — cho phép, nhưng không được tràn
  });
});

describe("[SK-XV-05] chọn câu", () => {
  it.each([[true], [false]])("laTre=%s ⇒ đúng nhóm tuổi, tối đa 3, lĩnh vực khác nhau, có kt", (laTre) => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = chonXoayVong({ laTre, daThay: [], ngauNhien: rng(seed) });
      expect(r).toHaveLength(3);
      expect(new Set(r.map((c) => c.linhVuc)).size).toBe(3);
      expect(r[0]!.loai).toBe("kt");
      for (const c of r) expect(c.nhom === "all" || (c.nhom === "tre") === laTre).toBe(true);
    }
  });
  it("bỏ câu đã thấy", () => {
    const dau = chonXoayVong({ laTre: true, daThay: [], ngauNhien: rng(7) });
    const sau = chonXoayVong({ laTre: true, daThay: dau.map((c) => c.id), ngauNhien: rng(7) });
    expect(sau.map((c) => c.id).filter((id) => dau.some((d) => d.id === id))).toEqual([]);
  });
  it("tất định khi cùng bộ ngẫu nhiên; khác hạt giống ⇒ thường khác bộ câu", () => {
    const a = chonXoayVong({ laTre: false, daThay: [], ngauNhien: rng(3) }).map((c) => c.id).join();
    expect(chonXoayVong({ laTre: false, daThay: [], ngauNhien: rng(3) }).map((c) => c.id).join()).toBe(a);
    const khac = new Set(Array.from({ length: 30 }, (_, i) => chonXoayVong({ laTre: false, daThay: [], ngauNhien: rng(100 + i) }).map((c) => c.id).join()));
    expect(khac.size).toBeGreaterThan(20);
  });
  it("soCau tuỳ chỉnh; 0 ⇒ rỗng", () => {
    expect(chonXoayVong({ laTre: true, daThay: [], soCau: 0, ngauNhien: rng(1) })).toEqual([]);
    expect(chonXoayVong({ laTre: true, daThay: [], soCau: 2, ngauNhien: rng(1) })).toHaveLength(2);
  });
});

describe("[SK-XV-06] không lặp tới khi cạn", () => {
  it.each([[true], [false]])("laTre=%s: quay liên tục — không câu nào xuất hiện hai lần; số lượt ≥ 100", (laTre) => {
    const daThay: string[] = [];
    const ngau = rng(2026);
    let luot = 0;
    for (;;) {
      const r = chonXoayVong({ laTre, daThay, ngauNhien: ngau });
      if (r.length === 0) break;
      for (const c of r) {
        expect(daThay.includes(c.id), `câu ${c.id} lặp`).toBe(false);
        daThay.push(c.id);
      }
      luot += 1;
      if (luot > 1000) throw new Error("không dừng");
    }
    expect(luot).toBeGreaterThanOrEqual(100);
    // cạn: phần còn lại không đủ một lượt «đủ ba lĩnh vực» thì chỉ trả ít câu — nhưng KHÔNG bao giờ trả câu đã thấy
    expect(cauConLai(laTre, daThay).length).toBeLessThan(cauConLai(laTre, []).length);
  });
});

describe("[SK-XV-07] thayTen và phản hồi", () => {
  it("trẻ ⇒ bé/Bé; người lớn ⇒ anh chị/Anh chị", () => {
    expect(thayTen("{Ai} có ăn sáng không? Hôm nay {ai} ăn gì?", true)).toBe("Bé có ăn sáng không? Hôm nay bé ăn gì?");
    expect(thayTen("{Ai} có ăn sáng không? Hôm nay {ai} ăn gì?", false)).toBe("Anh chị có ăn sáng không? Hôm nay anh chị ăn gì?");
  });
  it("kt đúng/sai có lời giải; tq ⇒ null", () => {
    const kt = NGAN_HANG_XOAY_VONG.find((c) => c.id === "k01")!;
    expect(phanHoiCauKienThuc(kt, kt.dapAn!)).toEqual({ dung: true, loiGiai: "Đúng rồi! " + kt.giaiThich });
    expect(phanHoiCauKienThuc(kt, (kt.dapAn! + 1) % 3)).toEqual({ dung: false, loiGiai: "Chưa đúng. " + kt.giaiThich });
    expect(phanHoiCauKienThuc(NGAN_HANG_XOAY_VONG.find((c) => c.loai === "tq")!, 0)).toBeNull();
  });
});
