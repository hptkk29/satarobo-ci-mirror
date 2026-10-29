// @vitest-environment node
/**
 * NGÂN SÁCH THỜI GIAN THẬT — hàm thuần, không DB.
 *
 * Mỗi ca có một câu hỏi: nó chặn đúng thứ phải chặn, hay chặn NHẦM người xem trung thực? Hai chiều đều phải có
 * ca — bản chỉ có ca chặn cho phép "chặn tất cả" xanh.
 *
 * `mo hinh` ở dưới ghép ba hàm thuần ĐÚNG như `ghiNhipXem` ghép (nganGiay → khopNganSach(gopNhipXem) → tatSauKhiGhi).
 * Lưới ghim mã nguồn `[VNX-W1]` canh việc đường ghi thật dùng đúng ba hàm đó; test Postgres `[VNX-*]` chạy chính đường thật.
 * Mô hình nằm ở đây để chạy được hàng nghìn tình huống ngẫu nhiên và kịch bản tấn công mà không cần DB.
 */
import { describe, it, expect } from "vitest";
import {
  CUA_SO_GIAY,
  DUNG_SAI_GIAY,
  dungSaiNoiDung,
  khopNganSach,
  nganGiay,
  tatSauKhiGhi,
} from "@/lib/elearning/video-time-budget";
import { DOAN_GIAY, TRAN_DELTA_GIAY, gopNhipXem, soDoanCua } from "@/lib/elearning/segment-bitmap";
import { TOC_DO_TOI_DA } from "@/lib/elearning/video-heartbeat-contract";

const T0 = new Date("2026-10-28T08:00:00.000Z");
const sau = (giay: number) => new Date(T0.getTime() + giay * 1000);

describe("[VTB-01] hằng số và dung sai", () => {
  it("trần mỗi nhịp là 25 (owner duyệt 20 → 25) và bao được 15 giây × 1.5x = 22.5", () => {
    expect(TRAN_DELTA_GIAY).toBe(25);
    expect(TRAN_DELTA_GIAY).toBeGreaterThanOrEqual(15 * TOC_DO_TOI_DA);
  });

  it("dung sai = độ chênh trễ mạng × tốc độ tối đa: 3 giây nội dung ở 1.5x, 2 ở 1x", () => {
    expect(DUNG_SAI_GIAY).toBe(2);
    expect(dungSaiNoiDung(1.5)).toBe(3);
    expect(dungSaiNoiDung(1)).toBe(2);
  });

  it("cửa sổ tích im lặng bao được một nhịp trọn ở 1.5x (15 giây × 1.5 = 22.5 ≤ 20 × 1.5)", () => {
    expect(CUA_SO_GIAY * TOC_DO_TOI_DA).toBeGreaterThanOrEqual(15 * TOC_DO_TOI_DA);
  });
});

describe("[VTB-02] nganGiay — số giây NỘI DUNG còn được ghi nhận", () => {
  const ve = (giayTruoc: number) => sau(-giayTruoc).getTime();

  it("vé vừa phát (nhịp tới ngay) ⇒ chỉ có dung sai — KHÔNG có khoản tặng nào cho 'nhịp đầu'", () => {
    expect(nganGiay({ now: T0, tat: null, phatVeMs: ve(0), tocDoToiDa: 1.5 }).ngan).toBe(3);
    expect(nganGiay({ now: T0, tat: null, phatVeMs: ve(0), tocDoToiDa: 1 }).ngan).toBe(2);
  });

  it("vé phát 15 giây trước ⇒ tốc độ × 15 + dung sai", () => {
    expect(nganGiay({ now: T0, tat: null, phatVeMs: ve(15), tocDoToiDa: 1.5 }).ngan).toBeCloseTo(25.5, 9);
    expect(nganGiay({ now: T0, tat: null, phatVeMs: ve(15), tocDoToiDa: 1 }).ngan).toBeCloseTo(17, 9);
  });

  it("vé CŨ (mở trang 10 phút trước, rồi mới xem) ⇒ ngân sách bị cửa sổ chặn: không tích 10 phút", () => {
    const { ngan } = nganGiay({ now: T0, tat: null, phatVeMs: ve(600), tocDoToiDa: 1.5 });
    expect(ngan).toBeCloseTo(1.5 * CUA_SO_GIAY + 3, 9);
  });

  it("`tat` cũ hơn cửa sổ không cho thêm gì: im lặng 4 phút rồi mới tới thì ngân sách = cửa sổ, không phải 4 phút", () => {
    const { ngan } = nganGiay({ now: sau(300), tat: sau(60), phatVeMs: ve(1000), tocDoToiDa: 1.5 });
    expect(ngan).toBeCloseTo(1.5 * CUA_SO_GIAY + 3, 9);
  });

  it("`tat` NHỈNH hơn `now` (đã tiêu trước) ⇒ ngân sách THẤP hơn dung sai, và không bao giờ âm", () => {
    const a = nganGiay({ now: T0, tat: sau(1), phatVeMs: ve(100), tocDoToiDa: 1.5 }).ngan;
    expect(a).toBeCloseTo(1.5 * -1 + 3, 9);
    expect(nganGiay({ now: T0, tat: sau(10), phatVeMs: ve(100), tocDoToiDa: 1.5 }).ngan).toBe(0);
  });

  it("vé của TƯƠNG LAI (lệch đồng hồ) bị kẹp ở `now`: không âm, không cho thêm", () => {
    const { ngan } = nganGiay({ now: T0, tat: null, phatVeMs: sau(30).getTime(), tocDoToiDa: 1.5 });
    expect(ngan).toBe(3);
  });

  it("dùng tốc độ tối đa của LƯỢT GIAO: lượt khoá 1x chặt hơn lượt 1.5x", () => {
    const a = nganGiay({ now: T0, tat: null, phatVeMs: ve(10), tocDoToiDa: 1 }).ngan;
    const b = nganGiay({ now: T0, tat: null, phatVeMs: ve(10), tocDoToiDa: 1.5 }).ngan;
    expect(a).toBeCloseTo(12, 9);
    expect(b).toBeCloseTo(18, 9);
  });

  it("tiêu ngân sách đúng 1/tốc độ giây của mốc: ghi c giây ⇒ `tat` = base + c / tốc độ, và ngân sách còn lại giảm đúng c", () => {
    const truoc = nganGiay({ now: sau(15), tat: null, phatVeMs: sau(0).getTime(), tocDoToiDa: 1.5 });
    const tat = tatSauKhiGhi({ base: truoc.base, giayMoi: 20, tocDoToiDa: 1.5 });
    const sauKhi = nganGiay({ now: sau(15), tat, phatVeMs: sau(0).getTime(), tocDoToiDa: 1.5 });
    expect(truoc.ngan - sauKhi.ngan).toBeCloseTo(20, 2); // `tat` là Date (mili giây)
  });
});

describe("[VTB-03] khopNganSach — số giây ĐOẠN MỚI không bao giờ vượt ngân sách", () => {
  const thu = (tu: number, noDung: number) => (den: number) =>
    gopNhipXem({ bitmapCu: null, soDoan: soDoanCua(noDung), tuSec: tu, denSec: den, tranDeltaGiay: TRAN_DELTA_GIAY, contentSec: noDung });

  it("vừa ngân sách ⇒ nhận nguyên điểm kết thúc", () => {
    const r = khopNganSach({ tuSec: 0, denSec: 15, ngan: 20, doanGiay: DOAN_GIAY, tranNhip: TRAN_DELTA_GIAY, thu: thu(0, 600) });
    expect(r.denNhan).toBe(15);
    expect(r.gop.giayMoi).toBe(15);
  });

  it("vượt ngân sách ⇒ lùi về RANH GIỚI đoạn gần nhất vừa ngân sách (đoạn bắt đầu luôn được bật nên nhịp sau không mất đoạn nào)", () => {
    // Khoảng [4.9, 5.1] bật cả đoạn 0 (5 giây) dù chỉ khai 0.2 giây — ngân sách 3 không đủ ⇒ không ghi gì.
    const r = khopNganSach({ tuSec: 4.9, denSec: 5.1, ngan: 3, doanGiay: DOAN_GIAY, tranNhip: TRAN_DELTA_GIAY, thu: thu(4.9, 600) });
    expect(r.gop.giayMoi).toBe(0);
    expect(r.denNhan).toBe(4.9);
  });

  it("nhịp 22.5 giây với ngân sách 12 ⇒ lùi về ranh giới 10 (giây 0→10 ghi 10 ≤ 12); đoạn kế tiếp được bật ở nhịp sau vì nó bắt đầu từ đó", () => {
    const r = khopNganSach({ tuSec: 0, denSec: 22.5, ngan: 12, doanGiay: DOAN_GIAY, tranNhip: TRAN_DELTA_GIAY, thu: thu(0, 600) });
    expect(r.denNhan).toBe(10);
    expect(r.gop.giayMoi).toBe(10);
    expect(r.haVeNgan).toBe(true);
  });

  it("khoảng dài hơn trần mỗi nhịp mà ngân sách còn dư ⇒ nhận tới trần nhịp, KHÔNG phải vì ngân sách (haVeNgan = false)", () => {
    const r = khopNganSach({ tuSec: 0, denSec: 300, ngan: 900, doanGiay: DOAN_GIAY, tranNhip: TRAN_DELTA_GIAY, thu: thu(0, 600) });
    expect(r.denNhan).toBe(TRAN_DELTA_GIAY);
    expect(r.haVeNgan).toBe(false);
  });

  it("đi lại khoảng ĐÃ GHI không tốn ngân sách: ngân sách 0 vẫn nhận trọn khoảng đã có trong bitmap (đúng ca nhịp mang câu trả lời)", () => {
    const daCo = gopNhipXem({ bitmapCu: null, soDoan: 120, tuSec: 0, denSec: 25, contentSec: 600 }).bitmap;
    const r = khopNganSach({
      tuSec: 0,
      denSec: 22.5,
      ngan: 0,
      doanGiay: DOAN_GIAY,
      tranNhip: TRAN_DELTA_GIAY,
      thu: (den) => gopNhipXem({ bitmapCu: daCo, soDoan: 120, tuSec: 0, denSec: den, contentSec: 600 }),
    });
    expect(r.gop.giayMoi).toBe(0);
    expect(r.denNhan).toBe(22.5);
    expect(r.haVeNgan).toBe(false);
  });

  it("đoạn bắt đầu bị bật dù chỉ đi qua một phần ⇒ phải lùi về ranh giới đoạn vừa ngân sách", () => {
    // Bắt đầu ở giây 3 (đoạn 0 bật cả 5 giây), khai tới 22.5: ngân sách 12 chỉ đủ 2 đoạn (10 giây) ⇒ ghi tới ranh giới 10.
    const r = khopNganSach({ tuSec: 3, denSec: 22.5, ngan: 12, doanGiay: DOAN_GIAY, tranNhip: TRAN_DELTA_GIAY, thu: thu(3, 600) });
    expect(r.gop.giayMoi).toBeLessThanOrEqual(12);
    expect(r.denNhan % DOAN_GIAY).toBe(0);
    expect(r.denNhan).toBeLessThan(22.5);
  });

  it("ngân sách 0 ⇒ không ghi gì và điểm nhận = điểm bắt đầu (phần khai được XIN LẠI ở nhịp sau)", () => {
    const r = khopNganSach({ tuSec: 30, denSec: 52.5, ngan: 0, doanGiay: DOAN_GIAY, tranNhip: TRAN_DELTA_GIAY, thu: thu(30, 600) });
    expect(r.gop.giayMoi).toBe(0);
    expect(r.denNhan).toBe(30);
    expect(r.haVeNgan).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// MÔ HÌNH: ghép ba hàm thuần như đường ghi thật. Một người, một bài, một vé.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
type Trang = { bitmap: Uint8Array | null; tat: Date | null; covered: number; xong: boolean };
const moi = (): Trang => ({ bitmap: null, tat: null, covered: 0, xong: false });

function nhipMoHinh(
  t: Trang,
  b: { now: Date; tu: number; den: number; phatVeMs: number; tocDo: number; noDung: number },
) {
  const ns = nganGiay({ now: b.now, tat: t.tat, phatVeMs: b.phatVeMs, tocDoToiDa: b.tocDo });
  const soDoan = soDoanCua(b.noDung);
  const { gop, denNhan } = khopNganSach({
    tuSec: b.tu,
    denSec: b.den,
    ngan: ns.ngan,
    doanGiay: DOAN_GIAY,
    tranNhip: TRAN_DELTA_GIAY,
    thu: (den) =>
      gopNhipXem({ bitmapCu: t.bitmap, soDoan, tuSec: b.tu, denSec: den, tranDeltaGiay: TRAN_DELTA_GIAY, contentSec: b.noDung }),
  });
  const denHieuLuc = denNhan;
  t.bitmap = gop.bitmap;
  t.covered = gop.coveredSec;
  t.xong = gop.coveragePercent >= 95;
  if (gop.giayMoi > 0) t.tat = tatSauKhiGhi({ base: ns.base, giayMoi: gop.giayMoi, tocDoToiDa: b.tocDo });
  return { gop, denNhan: denHieuLuc, ngan: ns.ngan };
}

describe("[VTB-04] người xem TRUNG THỰC ở đúng 1.5x không bao giờ bị mất thời gian hợp lệ", () => {
  // Trình phát: nhịp mỗi 15 giây, mang mọi nội dung từ MỐC (mốc theo `denNhan` của server). Độ trễ mạng của từng nhịp
  // do `lat(k)` cho. Khẳng định chính: tổng nội dung được ghi nhận bám sát nội dung thật đã phát — kể cả khi nhịp
  // tới sớm/muộn hơn lịch — vì phần bị giữ lại được xin lại ở nhịp sau.
  // `f` = đồng hồ media chạy NHANH hơn đồng hồ server bao nhiêu lần (1 = khớp tuyệt đối). Người xem thật không có
  // "nhịp tới sớm hơn lịch" — nhịp chỉ có thể tới MUỘN — nên cách duy nhất để một nhịp tới "sớm" so với nội dung đã
  // phát là đồng hồ media nhanh hơn đồng hồ máy chủ (lệch tinh thể thạch anh, vài phần nghìn).
  const chay = (soNhip: number, lat: (k: number) => number, moVeGiayTruoc = 0, f = 1) => {
    const t = moi();
    const noDung = 15 * 1.5 * soNhip * 1.2 + 600;
    let marker = 0;
    let biGiu = 0;
    let lagMax = 0;
    for (let k = 0; k < soNhip; k += 1) {
      const gui = 15 * (k + 1);
      const den = 22.5 * f * (k + 1); // nội dung đã phát khi gửi
      const r = nhipMoHinh(t, {
        now: sau(gui + lat(k)),
        tu: marker,
        den,
        phatVeMs: sau(-moVeGiayTruoc).getTime(),
        tocDo: TOC_DO_TOI_DA,
        noDung,
      });
      if (r.denNhan < den - 1e-6) biGiu += 1;
      marker = r.denNhan;
      lagMax = Math.max(lagMax, den - marker);
    }
    const daPhat = 22.5 * f * soNhip;
    return { t, marker, biGiu, lagMax, lagCuoi: daPhat - marker, daPhat };
  };

  it("20 phút liền, độ trễ ổn định ⇒ KHÔNG nhịp nào bị giữ lại, ghi nhận đủ", () => {
    const r = chay(80, () => 0.3);
    expect(r.biGiu).toBe(0);
    expect(r.marker).toBeCloseTo(r.daPhat, 6);
  });

  it("độ trễ nhảy 0–2 giây (bằng dung sai) ⇒ không nhịp nào bị giữ lại", () => {
    const lech = [2, 0, 1.5, 0.2, 2, 0, 1, 0.5, 2, 0];
    const r = chay(80, (k) => lech[k % lech.length]!);
    expect(r.biGiu).toBe(0);
  });

  it("mạng KẸT 8 giây rồi nhịp sau tới đúng giờ (cứ 12 nhịp một lần, trong 80 nhịp) ⇒ KHÔNG nhịp nào bị giữ lại: cửa sổ bao được độ kẹt tới 15 giây", () => {
    const lech = [2, 0, 1.5, 0.2, 2, 0, 1, 0.5, 2, 0, 8, 0];
    const r = chay(80, (k) => lech[k % lech.length]!);
    expect(r.biGiu).toBe(0);
    expect(r.lagMax).toBe(0);
  });

  it("mạng KẸT 40 giây (quá cửa sổ) MỘT lần ⇒ mất tối đa tốc độ × (kẹt − 15) giây nội dung, và độ trễ KHÔNG tăng thêm sau đó", () => {
    const r = chay(80, (k) => (k === 10 ? 40 : 0));
    const toiDa = TOC_DO_TOI_DA * (40 - 15) + DOAN_GIAY; // + một đoạn làm tròn ranh giới
    expect(r.lagMax).toBeLessThanOrEqual(toiDa);
    expect(r.lagCuoi).toBeLessThanOrEqual(toiDa);
  });

  it("đồng hồ media nhanh hơn máy chủ 0.1% (mức lệch thật của thiết bị) trong 2 giờ ⇒ độ trễ ghi nhận cuối ≤ 0.2% nội dung đã phát — không mất gì đáng kể", () => {
    const r = chay(480, () => 0.3, 0, 1.001);
    expect(r.lagCuoi).toBeLessThanOrEqual(0.002 * r.daPhat);
  });

  it("đồng hồ media nhanh 3% (CỐ Ý quá mức dung sai) ⇒ có nhịp bị giữ lại — dung sai là ranh giới thật, không phải trang trí — nhưng phần giữ lại được xin lại: cuối cùng bám sát ≥ 95% nội dung đã phát", () => {
    const r = chay(80, () => 0.3, 0, 1.03);
    expect(r.biGiu).toBeGreaterThan(0);
    expect(r.marker / r.daPhat).toBeGreaterThanOrEqual(0.95);
  });

  it("mở trang từ lâu rồi mới bấm phát (vé cũ 10 phút) ⇒ vẫn không bị cắt: cửa sổ bao nhịp đầu", () => {
    const r = chay(40, () => 0.3, 600);
    expect(r.biGiu).toBe(0);
  });
});

describe("[VTB-05] dung sai KHÔNG khai thác được để hoàn thành video NGẮN sớm hơn thời gian thật", () => {
  // Thời điểm SỚM NHẤT video `noDung` giây thành DONE khi tấn công bằng chiến lược `chienLuoc`, tính từ lúc PHÁT VÉ.
  // Bước 0.25 giây; mỗi bước kẻ tấn công gửi một nhịp theo chiến lược. Trả về `Infinity` nếu không xong trong `toiDa` giây.
  const somNhat = (
    noDung: number,
    tocDo: number,
    chienLuoc: (b: { buoc: number; marker: number; noDung: number }) => { tu: number; den: number },
    toiDa = 120,
    veCuGiay = 0,
  ) => {
    const t = moi();
    let marker = 0;
    for (let buoc = 0; buoc * 0.25 <= toiDa; buoc += 1) {
      const { tu, den } = chienLuoc({ buoc, marker, noDung });
      const r = nhipMoHinh(t, {
        now: sau(buoc * 0.25),
        tu,
        den,
        phatVeMs: sau(-veCuGiay).getTime(),
        tocDo,
        noDung,
      });
      marker = Math.max(marker, r.denNhan);
      if (t.xong) return buoc * 0.25;
    }
    return Number.POSITIVE_INFINITY;
  };

  const thamLam = ({ marker, noDung }: { marker: number; noDung: number }) => ({ tu: marker, den: noDung });
  /** "Nhịp bụi": khoảng 0.02 giây vắt qua từng ranh giới đoạn — bật cả đoạn 5 giây cho mỗi nhịp. */
  const bui = ({ buoc, noDung }: { buoc: number; noDung: number }) => {
    const ranh = DOAN_GIAY * (1 + (buoc % Math.max(1, Math.floor(noDung / DOAN_GIAY))));
    return { tu: ranh - 0.01, den: ranh + 0.01 };
  };
  /** Lần lượt từng ranh giới, mỗi bước nhiều nhịp. */
  const quet = ({ buoc, noDung }: { buoc: number; noDung: number }) => {
    const ranh = Math.min(noDung, DOAN_GIAY * (1 + Math.floor(buoc / 2)));
    return { tu: Math.max(0, ranh - 0.01), den: Math.min(noDung, ranh + 0.01) };
  };

  for (const [noDung, tocDo] of [
    [19, 1.5],
    [19, 1],
    [35, 1.5],
    [60, 1.5],
  ] as const) {
    const gioiHan = (noDung - dungSaiNoiDung(tocDo)) / tocDo;
    for (const [ten, cl] of [
      ["tham lam: mỗi 0.25 giây xin cả bài", thamLam],
      ["nhịp bụi qua từng ranh giới", bui],
      ["quét từng ranh giới", quet],
    ] as const) {
      it(`video ${noDung}s, lượt giao ${tocDo}x, ${ten}: không DONE sớm hơn (độ dài − dung sai) / tốc độ = ${gioiHan.toFixed(2)}s kể từ lúc phát vé`, () => {
        const t = somNhat(noDung, tocDo, cl);
        // Thời điểm DONE tính theo bước 0.25 giây: cho phép lệch đúng một bước.
        expect(t).toBeGreaterThanOrEqual(gioiHan - 0.25);
      });
    }
  }

  it("ĐỐI CHỨNG: cùng chiến lược tham lam, người xem thật (đợi đủ thời gian) vẫn hoàn thành được — không phải 'chặn tất cả'", () => {
    const t = somNhat(19, 1.5, thamLam);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeLessThan(40);
  });

  it("vé CŨ (mở trang trước đó 10 phút) mua được đúng MỘT cửa sổ: tối đa tốc độ × 20 + dung sai = 33 giây nội dung — rồi lại phải chờ thời gian thật", () => {
    // Một bài 60 giây: dù mở trang từ lâu, nhịp tham lam đầu tiên chỉ được ghi tới 33 giây; phần còn lại phải đợi.
    const t = moi();
    const r = nhipMoHinh(t, { now: T0, tu: 0, den: 60, phatVeMs: sau(-600).getTime(), tocDo: 1.5, noDung: 60 });
    expect(r.gop.giayMoi).toBeLessThanOrEqual(1.5 * CUA_SO_GIAY + dungSaiNoiDung(1.5));
    expect(t.xong).toBe(false);
  });
});

describe("[VTB-06] bất biến tích luỹ — thử ngẫu nhiên có hạt giống", () => {
  // mulberry32: dãy giả ngẫu nhiên tất định để ca đỏ tái hiện được.
  const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (const tocDo of [1, 1.5]) {
    it(`${tocDo}x: sau MỌI nhịp, tiến độ ghi nhận ≤ tốc độ × (now − phát vé) + dung sai, và không bao giờ lùi (300 chuỗi × 60 nhịp)`, () => {
      for (let hat = 1; hat <= 300; hat += 1) {
        const rnd = prng(hat * 7919);
        const noDung = [19, 35, 120, 600][Math.floor(rnd() * 4)]!;
        const t = moi();
        let now = 0;
        let truoc = 0;
        const phatVe = -Math.floor(rnd() * 3) * 5; // mở trang trước 0 / 5 / 10 giây
        for (let k = 0; k < 60; k += 1) {
          // 30% nhịp dồn cùng giây, còn lại cách 0–20 giây.
          now += rnd() < 0.3 ? 0 : rnd() * 20;
          const tu = rnd() < 0.5 ? Math.floor(rnd() * noDung) : Math.max(0, t.covered - rnd() * 10);
          const den = tu + rnd() * 90;
          nhipMoHinh(t, { now: sau(now), tu, den, phatVeMs: sau(phatVe).getTime(), tocDo, noDung });
          const tran = tocDo * (now - phatVe) + dungSaiNoiDung(tocDo);
          expect(t.covered, `hạt ${hat} nhịp ${k}`).toBeLessThanOrEqual(tran + 1e-6);
          expect(t.covered, `hạt ${hat} nhịp ${k}`).toBeGreaterThanOrEqual(truoc);
          truoc = t.covered;
        }
      }
    });
  }
});
