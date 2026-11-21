/**
 * Lưới của ngân hàng câu mở rộng + bốc đề + chấm.
 *
 * Mã ca: [NH-*] ngân hàng · [BD-*] bốc đề · [CD-*] chấm đúng · [VE-*] vé đề · [HC-*] hiệu chỉnh.
 * Không chạm DB, không đọc đồng hồ thật (mọi `bayGio` là ngày tuyệt đối — luật 19).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { THU_TU } from "@/lib/disc/engine-goc/config/disc-thu-tu";
import { MA_BO_DE, MA_TRUC, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { napBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import { cham } from "@/lib/disc/engine-goc/modules/report/cham";

import { bamNganHangMoRong } from "./bam";
import { bocDe, deChoKhach, dungBoDe, kiemKhung, LoiDe, type DeDaBoc } from "./boc-de";
import { docVe, kyDe, nopBai, phatDe } from "./de-ky";
import { hieuChinh, SO_BAI_TOI_THIEU, type BaiDeTinh } from "./hieu-chinh";
import { HO, O_KHUNG, PHIEN_BAN_KHUNG } from "./khung";
import { MAU_HANH_VI } from "./mau-hanh-vi";
import { cauThayChoO, napNganHang, timCauNganHang } from "./nap";
import { khoaSoTrung, nhomHieuLuc, tachMau } from "./sinh";

const KHOA = "khoa-test-khong-phai-bi-mat-32-ky-tu-xx";
const NGAY = new Date("2026-11-05T19:00:00+07:00");

/* ── Ngân hàng ─────────────────────────────────────────────────────────────── */

describe("[NH] ngân hàng câu", () => {
  const { tatCa } = napNganHang();

  it("[NH-01] có ít nhất 10.000 câu, mã không trùng", () => {
    expect(tatCa.length).toBeGreaterThanOrEqual(10_000);
    expect(new Set(tatCa.map((c) => c.ma)).size).toBe(tatCa.length);
  });

  it("[NH-02] trong MỘT bộ đề không có hai câu trùng chữ (bỏ qua dấu câu, hoa thường)", () => {
    for (const bo of MA_BO_DE) {
      const khoa = tatCa.filter((c) => c.boDe === bo).map((c) => khoaSoTrung(c.noiDung));
      expect(new Set(khoa).size, bo).toBe(khoa.length);
    }
  });

  it("[NH-03] mọi câu cùng trục + cùng chiều với câu gốc của ô; mọi ô có ≥ 90 câu", () => {
    for (const bo of MA_BO_DE) {
      for (const o of THU_TU[bo]) {
        const goc = NGAN_HANG[bo].cau.find((c) => c.ma === o);
        const ds = cauThayChoO(bo, o);
        expect(ds.length, o).toBeGreaterThanOrEqual(90);
        for (const c of ds) {
          expect([c.truc, c.dao], c.ma).toEqual([goc?.truc, goc?.dao]);
        }
      }
    }
  });

  it("[NH-04] không mẫu nào chết: mỗi mẫu còn ≥ 1 nhóm bối cảnh sau hàng rào từ vựng", () => {
    for (const [tang, bang] of Object.entries(MAU_HANH_VI)) {
      for (const [ho, ds] of Object.entries(bang)) {
        for (const m of ds ?? []) {
          const { viNgu, nhom } = tachMau(m);
          expect(nhomHieuLuc(viNgu, nhom).length, `${tang}/${ho}: ${m}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("[NH-05] mỗi bộ đề dùng mỗi họ hành vi tối đa một lần, họ khớp trục/chiều câu gốc", () => {
    for (const bo of MA_BO_DE) {
      const ho = THU_TU[bo].map((o) => O_KHUNG[o]);
      expect(new Set(ho).size, bo).toBe(ho.length);
      for (const o of THU_TU[bo]) {
        const goc = NGAN_HANG[bo].cau.find((c) => c.ma === o);
        expect([HO[O_KHUNG[o]].truc, HO[O_KHUNG[o]].dao], o).toEqual([goc?.truc, goc?.dao]);
      }
    }
  });

  it("[NH-06] 104 câu gốc nằm nguyên văn trong ngân hàng", () => {
    for (const bo of MA_BO_DE) {
      for (const c of NGAN_HANG[bo].cau) expect(timCauNganHang(c.ma)?.noiDung).toBe(c.noiDung);
    }
  });

  it("[NH-07] băm khớp checksum.json — sửa câu thì phải chạy lại script VÀ tăng PHIEN_BAN_KHUNG", () => {
    const luu = JSON.parse(readFileSync(resolve(process.cwd(), "lib/disc/ngan-hang/checksum.json"), "utf8")) as {
      phienBanKhung: string;
      soCau: number;
      bam: string;
    };
    const bam = bamNganHangMoRong(tatCa, (s) => createHash("sha256").update(s, "utf8").digest("hex"));
    expect(luu.phienBanKhung, "checksum sinh ở phiên bản khung khác — tăng PHIEN_BAN_KHUNG rồi chạy lại script").toBe(PHIEN_BAN_KHUNG);
    expect({ soCau: tatCa.length, bam }).toEqual({ soCau: luu.soCau, bam: luu.bam });
  });

  it("[NH-08] câu bộ QS chỉ dùng bối cảnh bố mẹ nhìn thấy được (không có lớp, giờ ra chơi)", () => {
    const qs = tatCa.filter((c) => c.boDe === "QS" && c.nguon === "sinh");
    expect(qs.length).toBeGreaterThan(0);
    for (const c of qs) expect(c.noiDung, c.ma).not.toMatch(/^(Ở lớp|Giờ ra chơi|Ở trường|Trên lớp)/);
  });
});

/* ── Bốc đề ────────────────────────────────────────────────────────────────── */

/** Làm liên tiếp `soLan` lần cho một người, nối lịch sử như máy chủ sẽ làm. */
function lamLienTiep(bo: MaBoDe, soLan: number, hat = "nguoi-1"): DeDaBoc[] {
  const daThay: string[] = [];
  const ra: DeDaBoc[] = [];
  for (let i = 0; i < soLan; i++) {
    const de = bocDe({ boDe: bo, daThay, hat: `${hat}-${i}` });
    ra.push(de);
    daThay.push(...de.maCau);
  }
  return ra;
}

describe("[BD] bốc đề", () => {
  it("[BD-01] đề bốc ra luôn đúng khung (100 đề mỗi bộ)", () => {
    for (const bo of MA_BO_DE) {
      for (let i = 0; i < 100; i++) {
        const de = bocDe({ boDe: bo, daThay: [], hat: `h${i}` });
        expect(kiemKhung(de), `${bo} #${i}`).toEqual([]);
      }
    }
  });

  it("[BD-02] tất định: cùng hạt + cùng lịch sử ⇒ cùng đề; khác hạt ⇒ khác đề", () => {
    const a = bocDe({ boDe: "THCS", daThay: [], hat: "x" });
    const b = bocDe({ boDe: "THCS", daThay: [], hat: "x" });
    const c = bocDe({ boDe: "THCS", daThay: [], hat: "y" });
    expect(a).toEqual(b);
    expect(a.maCau).not.toEqual(c.maCau);
  });

  it("[BD-03] 6 lần làm đầu tiên KHÔNG gặp lại hành vi nào ở cùng ô", () => {
    for (const bo of MA_BO_DE) {
      const cacDe = lamLienTiep(bo, 6);
      for (let viTri = 0; viTri < THU_TU[bo].length; viTri++) {
        const hanhVi = cacDe.map((d) => timCauNganHang(d.maCau[viTri])?.mau ?? "goc");
        expect(new Set(hanhVi).size, `${bo} ô ${THU_TU[bo][viTri]}: ${hanhVi.join(",")}`).toBe(6);
      }
    }
  });

  it("[BD-04] không trùng một câu nào cho tới khi ô cạn câu (90 lần liên tiếp)", () => {
    for (const bo of ["TH", "PH"] as const) {
      const cacDe = lamLienTiep(bo, 90);
      const tatCa = cacDe.flatMap((d) => d.maCau);
      expect(new Set(tatCa).size, bo).toBe(tatCa.length);
    }
  });

  it("[BD-05] cạn ô thì quay vòng câu CŨ NHẤT, không kẹt và vẫn đúng khung", () => {
    const o = THU_TU.MN[0];
    const soCau = cauThayChoO("MN", o).length;
    const cacDe = lamLienTiep("MN", soCau + 2);
    const viTri0 = cacDe.map((d) => d.maCau[0]);
    expect(new Set(viTri0.slice(0, soCau)).size).toBe(soCau);
    expect(viTri0[soCau]).toBe(viTri0[0]);
    for (const d of cacDe) expect(kiemKhung(d)).toEqual([]);
  });

  /**
   * Đo ở các LẦN LÀM LẠI chứ không chỉ lần đầu: lần đầu rổ câu rộng nên luật "chưa dùng
   * bối cảnh này trong đề" đã che luật "khác câu ngay trước" — cấy gỡ luật sau mà chỉ đo
   * lần đầu thì lưới XANH (đo 0/237.600 cặp ở lần đầu, 2.025 cặp khi làm lại).
   */
  it("[BD-06] trong một đề không có hai câu liền nhau cùng bối cảnh, kể cả khi làm lại", () => {
    for (const bo of MA_BO_DE) {
      for (let i = 0; i < 20; i++) {
        for (const [k, de] of lamLienTiep(bo, 8, `bc${i}`).entries()) {
          const bc = de.maCau.map((m) => timCauNganHang(m)?.boiCanh);
          for (let j = 1; j < bc.length; j++) {
            if (bc[j] && bc[j - 1]) expect(bc[j], `${bo} #${i} lần ${k + 1} vị trí ${j}`).not.toBe(bc[j - 1]);
          }
        }
      }
    }
  });

  it("[BD-07] phần gửi trình duyệt KHÔNG mang mã câu, trục hay chiều", () => {
    const de = bocDe({ boDe: "TH", daThay: [], hat: "k" });
    const json = JSON.stringify(deChoKhach(de));
    expect(json).not.toMatch(/"(ma|truc|dao|oKhung|ho)"/);
    for (const ma of de.maCau) expect(json).not.toContain(ma);
  });

  it("[BD-08] dungBoDe TỪ CHỐI đề sai khung (đảo hai câu khác trục)", () => {
    const de = bocDe({ boDe: "PH", daThay: [], hat: "z" });
    const dao = [...de.maCau];
    [dao[0], dao[1]] = [dao[1], dao[0]];
    expect(() => dungBoDe({ ...de, maCau: dao })).toThrow(LoiDe);
    expect(kiemKhung({ ...de, maCau: dao }).map((l) => l.ma)).toContain("SAI_O");
  });
});

/* ── Chấm đúng ─────────────────────────────────────────────────────────────── */

/**
 * Người trả lời "lý tưởng": giá trị chỉ phụ thuộc trục + chiều của câu. Hai đề cùng khung
 * phải cho ĐÚNG cùng điểm với người này — nếu lệch, khung đã vỡ ở đâu đó.
 */
function traLoiLyTuong(bo: { cau: readonly { ma: string; truc: MaTruc; dao: boolean }[]; mucToiDa: number }, muc: Record<MaTruc, number>) {
  const ra: Record<string, number> = {};
  for (const c of bo.cau) ra[c.ma] = c.dao ? bo.mucToiDa + 1 - muc[c.truc] : muc[c.truc];
  return ra;
}

describe("[CD] chấm đúng", () => {
  const MUC: Record<MaBoDe, Record<MaTruc, number>> = {
    MN: { D: 5, I: 2, S: 3, C: 4 },
    TH: { D: 1, I: 3, S: 2, C: 3 },
    THCS: { D: 2, I: 5, S: 4, C: 1 },
    PH: { D: 4, I: 1, S: 5, C: 2 },
    QS: { D: 3, I: 4, S: 1, C: 5 },
  };

  it("[CD-01] mọi đề bốc ra cho CÙNG điểm với đề gốc khi người trả lời nhất quán", () => {
    for (const bo of MA_BO_DE) {
      const goc = napBoDe(bo);
      const kqGoc = cham(goc, traLoiLyTuong(goc, MUC[bo]), null);
      expect(kqGoc.hopLe, bo).toBe(true);
      for (let i = 0; i < 40; i++) {
        const boMoi = dungBoDe(bocDe({ boDe: bo, daThay: [], hat: `cd${i}` }));
        const kq = cham(boMoi, traLoiLyTuong(boMoi, MUC[bo]), null);
        expect(kq, `${bo} #${i}`).toEqual(kqGoc);
      }
    }
  });

  it("[CD-02] số câu mỗi trục và số câu đảo mỗi trục của đề mới = đề gốc", () => {
    for (const bo of MA_BO_DE) {
      const dem = (cau: readonly { truc: MaTruc; dao: boolean }[]) =>
        MA_TRUC.map((t) => [cau.filter((c) => c.truc === t).length, cau.filter((c) => c.truc === t && c.dao).length]);
      const goc = dem(napBoDe(bo).cau);
      for (let i = 0; i < 20; i++) expect(dem(dungBoDe(bocDe({ boDe: bo, daThay: [], hat: `dem${i}` })).cau)).toEqual(goc);
    }
  });

  it("[CD-03] thứ tự trục trên màn = đề gốc (luật xếp thứ tự giữ nguyên)", () => {
    for (const bo of MA_BO_DE) {
      const goc = napBoDe(bo).cau.map((c) => `${c.truc}${c.dao ? "!" : ""}`);
      const moi = dungBoDe(bocDe({ boDe: bo, daThay: [], hat: "tt" })).cau.map((c) => `${c.truc}${c.dao ? "!" : ""}`);
      expect(moi, bo).toEqual(goc);
    }
  });
});

/* ── Vé đề ─────────────────────────────────────────────────────────────────── */

describe("[VE] vé đề + nộp bài", () => {
  const phat = () => phatDe({ boDe: "TH", nguoiLam: "tv-1", daThay: [], hat: "ve", khoa: KHOA, bayGio: NGAY });
  const traLoiDu = (n: number, v = 2) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), v]));

  it("[VE-01] phát rồi nộp đúng ⇒ ra điểm, kèm danh sách mã câu để ghi lịch sử", () => {
    const de = phat();
    const tl = Object.fromEntries(de.cau.map((c, i) => [String(c.viTri), (i % 3) + 1]));
    const kq = nopBai({ ve: de.ve, theoViTri: tl, nguoiLam: "tv-1", khoa: KHOA, bayGio: NGAY });
    expect(kq.ok).toBe(true);
    if (kq.ok) {
      expect(kq.maCau).toHaveLength(de.cau.length);
      expect(kq.phienBanBoDe).toBe(`nh:${PHIEN_BAN_KHUNG}`);
    }
  });

  it("[VE-02] vé không đọc được nội dung từ phía khách (không lộ mã câu)", () => {
    const de = phat();
    const tho = Buffer.from(de.ve.split(".")[1], "base64url").toString("utf8");
    expect(tho).not.toMatch(/TH-[DISC]\d/);
  });

  it("[VE-03] sửa một byte của vé ⇒ VE_HONG", () => {
    const de = phat();
    const [a, b, c] = de.ve.split(".");
    const sua = Buffer.from(b, "base64url");
    sua[0] ^= 1;
    expect(docVe([a, sua.toString("base64url"), c].join("."), KHOA, "tv-1", NGAY)).toEqual({ ok: false, lyDo: "VE_HONG" });
  });

  it("[VE-04] vé của người này không nộp được cho người khác; sai khoá ⇒ VE_HONG", () => {
    const de = phat();
    expect(docVe(de.ve, KHOA, "tv-2", NGAY)).toEqual({ ok: false, lyDo: "SAI_NGUOI_LAM" });
    expect(docVe(de.ve, `${KHOA}-khac`, "tv-1", NGAY)).toEqual({ ok: false, lyDo: "VE_HONG" });
  });

  it("[VE-05] quá hạn ⇒ HET_HAN (đúng mốc vẫn nhận)", () => {
    const de = phat();
    const hetHan = new Date(NGAY.getTime() + 24 * 60 * 60_000);
    expect(docVe(de.ve, KHOA, "tv-1", hetHan).ok).toBe(true);
    expect(docVe(de.ve, KHOA, "tv-1", new Date(hetHan.getTime() + 1))).toEqual({ ok: false, lyDo: "HET_HAN" });
  });

  it("[VE-06] vé phát ở khung khác ⇒ SAI_KHUNG, không chấm", () => {
    const de = bocDe({ boDe: "TH", daThay: [], hat: "k" });
    const ve = kyDe({ ...de, phienBanKhung: "nh0" }, KHOA, "tv-1", new Date(NGAY.getTime() + 60_000));
    expect(docVe(ve, KHOA, "tv-1", NGAY)).toEqual({ ok: false, lyDo: "SAI_KHUNG" });
  });

  it("[VE-07] thiếu câu ⇒ THIEU_CAU_TRA_LOI; giá trị lạ / vị trí lạ ⇒ GIA_TRI_KHONG_HOP_LE", () => {
    const de = phat();
    const n = de.cau.length;
    const base = { ve: de.ve, nguoiLam: "tv-1", khoa: KHOA, bayGio: NGAY };
    const thieu = traLoiDu(n);
    delete thieu["0"];
    expect(nopBai({ ...base, theoViTri: thieu })).toEqual({ ok: false, lyDo: "THIEU_CAU_TRA_LOI" });
    expect(nopBai({ ...base, theoViTri: { ...traLoiDu(n), "0": 2.5 } })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    expect(nopBai({ ...base, theoViTri: { ...traLoiDu(n), "0": 9 } })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    expect(nopBai({ ...base, theoViTri: { ...traLoiDu(n), [String(n)]: 2 } })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
  });

  it("[VE-08] trả lời phẳng (mọi câu một mức) ⇒ TRA_LOI_PHANG, không ra điểm", () => {
    const de = phat();
    expect(nopBai({ ve: de.ve, theoViTri: traLoiDu(de.cau.length, 2), nguoiLam: "tv-1", khoa: KHOA, bayGio: NGAY })).toEqual({
      ok: false,
      lyDo: "TRA_LOI_PHANG",
    });
  });
});

/* ── Hiệu chỉnh ────────────────────────────────────────────────────────────── */

describe("[HC] hiệu chỉnh câu", () => {
  /** Mô phỏng bài thật: mỗi người có mức thật mỗi trục; câu "lạc" trả lời ngẫu nhiên. */
  function moPhong(soBai: number, cauLac: string | null): BaiDeTinh[] {
    let x = 12345;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const goc = napBoDe("TH");
    return Array.from({ length: soBai }, () => {
      const muc = Object.fromEntries(MA_TRUC.map((t) => [t, 1 + Math.floor(rnd() * 3)])) as Record<MaTruc, number>;
      return {
        mucToiDa: goc.mucToiDa,
        cau: goc.cau.map((c) => {
          const that = c.ma === cauLac ? 1 + Math.floor(rnd() * 3) : muc[c.truc];
          return { ma: c.ma, truc: c.truc, dao: c.dao, giaTri: c.dao ? goc.mucToiDa + 1 - that : that };
        }),
      };
    });
  }

  it("[HC-01] câu lạc trục bị đề xuất loại; câu đúng trục được gắn ỔN ĐỊNH", () => {
    const the = hieuChinh(moPhong(SO_BAI_TOI_THIEU, "TH-D2"));
    expect(the.find((t) => t.ma === "TH-D2")?.the).toBe("DE_XUAT_LOAI");
    expect(the.find((t) => t.ma === "TH-D1")?.the).toBe("ON_DINH");
  });

  it("[HC-02] chưa đủ mẫu ⇒ CHUA_DU_MAU, kể cả câu lạc", () => {
    const the = hieuChinh(moPhong(SO_BAI_TOI_THIEU - 1, "TH-D2"));
    expect(new Set(the.map((t) => t.the))).toEqual(new Set(["CHUA_DU_MAU"]));
  });
});
