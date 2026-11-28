// lib/finance/tuoi-no.test.ts — tuổi nợ /cong-no TRỪ thời gian bảo lưu (A6 vòng 2 → K19 vòng 3). THUẦN.
//
// Quy chế SR.QD.236 Phụ lục 01 Mục 15. Mã Phiên 1 đẩy đơn bảo lưu về "chưa quá hạn"; bản A6 đóng băng tại ngày bắt đầu nhưng SAU PHỤC HỌC lại chạy theo đồng hồ thật
// (hạn sổ cũ không dời). Nay một công thức (`lib/bao-luu/qua-han-tru-bao-luu.ts`): số ngày quá hạn = (hôm nay − hạn) − số ngày nằm trong khoảng bảo lưu.
// Luật 19: ngày TUYỆT ĐỐI, `now` truyền vào.
import { describe, expect, it } from "vitest";
import { gomTuoiNo, nhomTuoiNo, NHOM_TUOI_NO, type DonCoDot } from "./tuoi-no";
import type { KhoangTamDung } from "@/lib/bao-luu/qua-han-tru-bao-luu";

const ngay = (s: string) => new Date(`${s}T00:00:00+07:00`);
const cong = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const tongCacNhom = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

const HAN = ngay("2026-09-01");
const BAT_DAU = cong(HAN, 12); // quá hạn 12 ngày lúc bắt đầu bảo lưu
const PHUC_HOC = cong(BAT_DAU, 30);
const DANG_NGHI: KhoangTamDung[] = [{ tu: BAT_DAU, den: null }];
const DA_PHUC_HOC: KhoangTamDung[] = [{ tu: BAT_DAU, den: PHUC_HOC }];

const DON: DonCoDot[] = [
  { id: "bao-luu", installments: [{ amount: 3_000_000, dueDate: HAN }] },
  { id: "binh-thuong", installments: [{ amount: 2_000_000, dueDate: HAN }] },
];

describe("[TN] tuổi nợ trừ thời gian bảo lưu", () => {
  it("[TN-01] khoản quá hạn 12 ngày lúc bắt đầu bảo lưu, sau 30 ngày bảo lưu VẪN ở nhóm 8–30 ngày (đối chứng: cùng khoản không bảo lưu sau 42 ngày là >30)", () => {
    const sau30 = cong(BAT_DAU, 30);
    expect(nhomTuoiNo(HAN, BAT_DAU, DANG_NGHI)).toBe("8-30");
    expect(nhomTuoiNo(HAN, sau30, DANG_NGHI)).toBe("8-30");
    expect(nhomTuoiNo(HAN, sau30, [])).toBe(">30");
  });

  it("[TN-02] gom: đơn đang bảo lưu nằm ở nhóm 8–30 kèm nhãn; đơn thường già theo đồng hồ", () => {
    const sau30 = cong(BAT_DAU, 30);
    const r = gomTuoiNo(DON, new Map([["bao-luu", DANG_NGHI]]), new Set(["bao-luu"]), sau30);
    expect(r.tong["8-30"]).toBe(3_000_000);
    expect(r.tong[">30"]).toBe(2_000_000);
    expect(r.tong.none).toBe(0);
    expect(r.dangBaoLuu["8-30"]).toBe(3_000_000);
    expect(r.dangBaoLuu[">30"]).toBe(0);
  });

  it("[TN-03] TỔNG mọi nhóm không đổi dù có hay không bảo lưu — chỉ đổi nhóm, không đổi tiền", () => {
    const sau30 = cong(BAT_DAU, 30);
    const co = gomTuoiNo(DON, new Map([["bao-luu", DANG_NGHI]]), new Set(["bao-luu"]), sau30);
    const khong = gomTuoiNo(DON, new Map(), new Set(), sau30);
    expect(tongCacNhom(co.tong)).toBe(5_000_000);
    expect(tongCacNhom(khong.tong)).toBe(5_000_000);
    for (const nhom of NHOM_TUOI_NO) expect(co.dangBaoLuu[nhom]).toBeLessThanOrEqual(co.tong[nhom]);
  });

  it("[TN-04] SAU PHỤC HỌC (K19): hôm nay = ngày phục học ⇒ vẫn 12 ngày (8–30); sau 5 ngày ⇒ 17 (vẫn 8–30); KHÔNG còn nhãn 'đang bảo lưu'", () => {
    const m = new Map([["bao-luu", DA_PHUC_HOC]]);
    const luc = (n: number) => gomTuoiNo(DON.slice(0, 1), m, new Set(), cong(PHUC_HOC, n));
    expect(luc(0).tong["8-30"]).toBe(3_000_000);
    expect(luc(5).tong["8-30"]).toBe(3_000_000);
    expect(luc(5).dangBaoLuu["8-30"]).toBe(0);
    // Mã A6 (đóng băng rồi chạy đồng hồ thật) ra 42 / 47 ngày ⇒ nhóm >30 ngay khi phục học.
    expect(luc(0).tong[">30"]).toBe(0);
    // Hết quãng 18 ngày còn lại của nhóm 8–30 thì mới sang >30.
    expect(luc(19).tong[">30"]).toBe(3_000_000);
  });

  it("[TN-05] đợt CHƯA tới hạn lúc bắt đầu bảo lưu: suốt kỳ nghỉ vẫn 'chưa quá hạn'", () => {
    const han = cong(BAT_DAU, 10);
    expect(nhomTuoiNo(han, cong(BAT_DAU, 25), DANG_NGHI)).toBe("none");
  });

  it("[TN-06] đợt tới hạn GIỮA kỳ: lúc phục học 'chưa quá hạn'; 5 ngày sau là '1–7 ngày'", () => {
    const han = cong(BAT_DAU, 10);
    expect(nhomTuoiNo(han, PHUC_HOC, DA_PHUC_HOC)).toBe("none");
    expect(nhomTuoiNo(han, cong(PHUC_HOC, 5), DA_PHUC_HOC)).toBe("1-7");
  });

  it("[TN-07] đợt không có hạn ⇒ 'none'; đơn nhiều đợt: mỗi đợt tính theo hạn của chính nó", () => {
    expect(nhomTuoiNo(null, PHUC_HOC, DA_PHUC_HOC)).toBe("none");
    const don: DonCoDot[] = [
      { id: "x", installments: [{ amount: 1_000_000, dueDate: HAN }, { amount: 4_000_000, dueDate: cong(BAT_DAU, 20) }] },
    ];
    const r = gomTuoiNo(don, new Map([["x", DANG_NGHI]]), new Set(["x"]), cong(BAT_DAU, 30));
    expect(r.tong["8-30"]).toBe(1_000_000);
    expect(r.tong.none).toBe(4_000_000);
  });
});
