/**
 * PARITY ĐỘNG CƠ DISC — engine đã tích hợp (qua `engine-goc` trực tiếp VÀ qua adapter `engine-that`) phải bằng
 * TUYỆT ĐỐI golden vectors sinh từ engine GỐC (repo hodacphuchtc/DISC @5630a1c5) chạy thật bằng tsx.
 *
 * Golden: `tests/disc-engine/golden.json`. Cách sinh lại: `sinh-golden.mts.txt` (cùng thư mục) — chạy ngoài repo,
 * trên bản clone của repo gốc, KHÔNG mock. Sinh lại ⇒ đổi mã gốc ⇒ phải đọc diff của golden như đọc diff của mã.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NGAN_HANG, PHIEN_BAN_BO_DE } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { bamNganHang } from "@/lib/disc/engine-goc/modules/core/bo-de/bam";
import { napBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import { cham as chamGoc } from "@/lib/disc/engine-goc/modules/report/cham";
import { boDeChoKhach, datEngine, layEngine } from "@/lib/disc/engine";
import { ensureDiscEngine } from "@/lib/disc/engine-dang-ky";
import { COMMIT_DISC_GOC, PHIEN_BAN_ENGINE, engineThat } from "@/lib/disc/engine-that";

type CaGolden = { ten: string; boDe: string; giay: number | null; traLoi: Record<string, unknown>; goc: unknown };
type Golden = {
  nguon: { repo: string; commit: string; phienBanBoDe: string; bamNganHang: string };
  nganHang: Record<string, { mucToiDa: number; ids: string[]; noiDungSha: string }>;
  dinhTuyenTheoLop: Array<{ bacHoc: string; boDeTheoLop: string; giaiThich: string | null; nguoiLonTraLoiHo: boolean }>;
  cases: CaGolden[];
};

const golden = JSON.parse(readFileSync(resolve(process.cwd(), "tests/disc-engine/golden.json"), "utf8")) as Golden;
const BON_BO = ["MN", "TH", "THCS", "PH"] as const;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const trongSuot = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** Có giá trị nào KHÔNG phải số nguyên trong 1..max không (độc lập với adapter). */
function coGiaTriLa(c: CaGolden): boolean {
  const max = golden.nganHang[c.boDe].mucToiDa;
  return Object.values(c.traLoi).some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max);
}

describe("[ENG-P01] golden đúng nguồn, đủ độ phủ", () => {
  it("≥ 200 ca, phủ cả bốn bộ phát ra + QS; có ca hợp lệ lẫn ca bị chặn", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(200);
    for (const ma of [...BON_BO, "QS"]) expect(golden.cases.filter((c) => c.boDe === ma).length).toBeGreaterThanOrEqual(40);
    const hopLe = golden.cases.filter((c) => (c.goc as { hopLe: boolean }).hopLe).length;
    expect(hopLe).toBeGreaterThan(100);
    expect(golden.cases.length - hopLe).toBeGreaterThan(30);
  });
  it("golden sinh từ đúng commit + đúng phiên bản + đúng băm ngân hàng đang nằm trong repo", () => {
    expect(golden.nguon.repo).toBe("hodacphuchtc/DISC");
    expect(golden.nguon.commit).toBe(COMMIT_DISC_GOC);
    expect(golden.nguon.phienBanBoDe).toBe(PHIEN_BAN_BO_DE);
    expect(bamNganHang(NGAN_HANG, sha)).toBe(golden.nguon.bamNganHang);
  });
  it("phiên bản engine ghi cùng bài chứa phiên bản ngân hàng + commit gốc, ≤ 40 ký tự (khớp zod của đường lưu)", () => {
    expect(engineThat.phienBan).toBe(PHIEN_BAN_ENGINE);
    expect(PHIEN_BAN_ENGINE).toContain(PHIEN_BAN_BO_DE);
    expect(PHIEN_BAN_ENGINE).toContain(COMMIT_DISC_GOC.slice(0, 7));
    expect(PHIEN_BAN_ENGINE.length).toBeLessThanOrEqual(40);
  });
});

describe("[ENG-P02] engine-goc trực tiếp == golden (mọi ca, kể cả giay)", () => {
  it.each(golden.cases.map((c) => [c.ten, c] as const))("%s", (_ten, c) => {
    const kq = chamGoc(napBoDe(c.boDe as "MN"), c.traLoi as Record<string, number>, c.giay);
    expect(trongSuot(kq)).toEqual(c.goc);
  });
});

describe("[ENG-P03] adapter engine-that == golden (điểm D/I/S/C, xếp hạng, cảnh báo, mã lỗi)", () => {
  const ca = golden.cases.filter((c) => c.giay === null && (BON_BO as readonly string[]).includes(c.boDe));
  it("có ≥ 150 ca đi qua adapter", () => expect(ca.length).toBeGreaterThanOrEqual(150));
  it.each(ca.map((c) => [c.ten, c] as const))("%s", (_ten, c) => {
    const goc = c.goc as { hopLe: boolean; diem?: Record<string, number>; xepHang?: string[]; canhBao?: string[]; lyDo?: string };
    const kq = engineThat.cham(c.boDe, c.traLoi as Record<string, number>);
    // Adapter chặt hơn engine gốc ở BIÊN (cố ý, ghi ở 12-engine-tich-hop.md): giá trị lạ — ngoài 1..max / thập phân / null /
    // chuỗi — ⇒ GIA_TRI_KHONG_HOP_LE, kể cả khi engine gốc vẫn chấm được (vd 2,5 hợp lệ ở engine gốc) hoặc gộp vào "thiếu câu".
    if (coGiaTriLa(c)) {
      expect(kq).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
      return;
    }
    if (goc.hopLe) {
      expect(kq.ok).toBe(true);
      if (!kq.ok) return;
      expect(kq.ketQua.diem).toEqual(goc.diem);
      expect(kq.ketQua.xepHang).toEqual(goc.xepHang);
      expect(kq.ketQua.canhBao).toEqual(goc.canhBao);
      expect(kq.ketQua.maBoDe).toBe(c.boDe);
      expect(kq.ketQua.phienBanBoDe).toBe(golden.nguon.phienBanBoDe);
      for (const d of Object.values(kq.ketQua.diem)) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(100);
      }
      return;
    }
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    // Mọi ca lỗi còn lại ánh xạ 1-1: THIEU_CAU → THIEU_CAU_TRA_LOI, PHANG → TRA_LOI_PHANG.
    const mong = goc.lyDo === "PHANG" ? "TRA_LOI_PHANG" : "THIEU_CAU_TRA_LOI";
    expect(kq.lyDo).toBe(mong);
  });
  it("bộ QS (người lớn quan sát) và mã lạ KHÔNG chấm được qua hợp đồng", () => {
    const qs = golden.cases.find((c) => c.boDe === "QS")!;
    expect(engineThat.cham("QS", qs.traLoi as Record<string, number>)).toEqual({ ok: false, lyDo: "BO_DE_KHONG_TON_TAI" });
    expect(engineThat.cham("XX", {})).toEqual({ ok: false, lyDo: "BO_DE_KHONG_TON_TAI" });
    expect(engineThat.layBoDe("QS")).toBeNull();
  });
  it("tất định: cùng đầu vào ⇒ cùng kết quả", () => {
    const c = golden.cases.find((x) => x.ten === "THCS/ngau-nhien-3")!;
    expect(engineThat.cham(c.boDe, c.traLoi as Record<string, number>)).toEqual(engineThat.cham(c.boDe, c.traLoi as Record<string, number>));
  });
});

describe("[ENG-P04] ngân hàng câu: adapter phát đúng id + thứ tự + nội dung của engine gốc", () => {
  it.each(BON_BO.map((m) => [m] as const))("bộ %s", (ma) => {
    const bo = engineThat.layBoDe(ma)!;
    const g = golden.nganHang[ma];
    expect(bo.cauHoi.map((c) => c.id)).toEqual(g.ids);
    expect(sha(bo.cauHoi.map((c) => c.noiDung).join("\n"))).toBe(g.noiDungSha);
    expect(bo.ma).toBe(ma);
    expect(bo.doiTuong).toBe(ma);
    expect(bo.phienBan).toBe(PHIEN_BAN_BO_DE);
    expect(bo.nguoiLonTraLoiHo).toBe(ma === "MN");
  });
});

describe("[ENG-P05] chọn bộ đề: hàng rào dưới 8 tuổi / lớp 1–2 + bậc học", () => {
  const NAM = 2026;
  const chon = (vai: "PH" | "HS", bacHoc: string | undefined, tuoi: number) =>
    engineThat.chonBoDe({ vai, bacHoc, namSinh: NAM - tuoi, namNay: NAM })?.ma ?? null;

  // Bảng KỲ VỌNG VIẾT TAY theo DISC_BA §4.2 / ADR-002 (không suy từ chính adapter).
  const bang: Array<[string, number, string]> = [
    ["MN", 4, "MN"], ["MN", 9, "MN"], ["1", 6, "MN"], ["1", 7, "MN"], ["2", 8, "MN"], ["2", 12, "MN"],
    ["3", 9, "TH"], ["4", 10, "TH"], ["5", 11, "TH"], ["6", 12, "THCS"], ["7", 13, "THCS"], ["8", 14, "THCS"], ["9", 15, "THCS"],
    ["10", 16, "PH"], ["11", 17, "PH"], ["12", 18, "PH"],
    // Năm sinh khai LỆCH lớp: dưới 8 tuổi thì vẫn do người lớn quan sát (không đi vòng qua hàng rào bằng cách khai lớp cao).
    ["3", 7, "MN"], ["5", 7, "MN"], ["6", 7, "MN"], ["10", 7, "MN"], ["3", 8, "TH"],
  ];
  it.each(bang)("HS bậc %s, %i tuổi ⇒ %s", (bac, tuoi, mong) => expect(chon("HS", bac, tuoi)).toBe(mong));

  it("trẻ dưới 8 tuổi / lớp 1–2 KHÔNG BAO GIỜ ra bộ tự làm (TH/THCS/PH); luôn do người lớn trả lời hộ", () => {
    for (const bac of ["MN", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]) {
      for (let tuoi = 2; tuoi <= 20; tuoi++) {
        const bo = engineThat.chonBoDe({ vai: "HS", bacHoc: bac, namSinh: NAM - tuoi, namNay: NAM });
        if (!bo) continue;
        if (tuoi < 8 || bac === "MN" || (bac !== "MN" && Number(bac) <= 2)) {
          expect(bo.ma, `bậc ${bac} · ${tuoi} tuổi`).toBe("MN");
          expect(bo.nguoiLonTraLoiHo).toBe(true);
        }
      }
    }
  });
  it("vai PH ⇒ bộ PH (tự đánh giá người lớn), không phụ thuộc bậc học", () => {
    expect(chon("PH", undefined, 38)).toBe("PH");
    expect(chon("PH", "3", 38)).toBe("PH");
    expect(engineThat.chonBoDe({ vai: "PH", namSinh: 1988, namNay: 2026 })?.nguoiLonTraLoiHo).toBe(false);
  });
  it("thiếu / lạ bậc học, năm sinh vô lý ⇒ null (không đoán)", () => {
    expect(chon("HS", undefined, 10)).toBeNull();
    for (const bac of ["0", "13", "abc", "", "03", " 3", "3.5"]) expect(chon("HS", bac, 10), bac).toBeNull();
    expect(engineThat.chonBoDe({ vai: "HS", bacHoc: "4", namSinh: NAM + 1, namNay: NAM })).toBeNull();
    expect(engineThat.chonBoDe({ vai: "HS", bacHoc: "4", namSinh: NAM - 200, namNay: NAM })).toBeNull();
    expect(engineThat.chonBoDe({ vai: "HS", bacHoc: "4", namSinh: 2016.5, namNay: NAM })).toBeNull();
  });
  it("khớp bảng định tuyến theo lớp của engine gốc (golden) khi tuổi đủ lớn", () => {
    for (const g of golden.dinhTuyenTheoLop) {
      expect(chon("HS", g.bacHoc, 16), g.bacHoc).toBe(g.boDeTheoLop === "QS" ? null : g.boDeTheoLop);
    }
  });
});

describe("[ENG-P06] server KHÔNG tin client — điểm do client khai không có đường đi vào kết quả", () => {
  const c = golden.cases.find((x) => x.ten === "TH/ngau-nhien-5")!;
  const sach = c.traLoi as Record<string, number>;
  const goc = chamGoc(napBoDe("TH"), sach, null);

  it("chữ ký chỉ nhận (mã bộ đề, câu trả lời thô) — không có tham số nào để truyền điểm/thời gian", () => {
    expect(engineThat.cham.length).toBe(2);
  });
  it("khoá điểm giả (D/I/S/C/diem/tongDiem/tomTat) nhét vào câu trả lời ⇒ bị TỪ CHỐI, không đổi điểm", () => {
    for (const khoa of ["D", "diem", "tongDiem", "ketQua", "tomTat", "__proto__", "constructor"]) {
      const kq = engineThat.cham("TH", { ...sach, [khoa]: 100 });
      expect(kq, khoa).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    }
    const doc = JSON.parse(`{"__proto__":{"D":100,"I":100,"S":100,"C":100}}`) as Record<string, number>;
    expect(engineThat.cham("TH", { ...doc, ...sach })).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
  });
  it("giá trị lạ (thập phân, chuỗi, NaN, Infinity, ngoài thang, null) ⇒ GIA_TRI_KHONG_HOP_LE, không bao giờ ra điểm", () => {
    const id = Object.keys(sach)[0];
    for (const v of [2.5, "3", Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 99, null, true, [3], {}]) {
      const kq = engineThat.cham("TH", { ...sach, [id]: v as unknown as number });
      expect(kq, String(v)).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
    }
  });
  it("thiếu câu ⇒ THIEU_CAU_TRA_LOI; câu trả lời không phải object ⇒ GIA_TRI_KHONG_HOP_LE", () => {
    const { [Object.keys(sach)[0]]: _bo, ...thieu } = sach;
    void _bo;
    expect(engineThat.cham("TH", thieu)).toEqual({ ok: false, lyDo: "THIEU_CAU_TRA_LOI" });
    expect(engineThat.cham("TH", {})).toEqual({ ok: false, lyDo: "THIEU_CAU_TRA_LOI" });
    for (const x of [null, [], "x", 5]) expect(engineThat.cham("TH", x as unknown as Record<string, number>)).toEqual({ ok: false, lyDo: "GIA_TRI_KHONG_HOP_LE" });
  });
  it("điểm ra là hàm CHỈ của câu trả lời: bằng chính engine gốc, không phụ thuộc thứ gì khác", () => {
    const kq = engineThat.cham("TH", sach);
    expect(kq.ok).toBe(true);
    if (!kq.ok || !goc.hopLe) return;
    expect(kq.ketQua.diem).toEqual(goc.diem);
  });
  it("không bao giờ mang thời gian từ client: HL-4 (bấm bừa) không bao giờ tự bật qua adapter", () => {
    const nhanh = golden.cases.find((x) => x.ten === "TH/bam-bua-giay")!;
    const kq = engineThat.cham("TH", nhanh.traLoi as Record<string, number>);
    expect(kq.ok && kq.ketQua.canhBao?.includes("BAM_BUA")).toBeFalsy();
  });
});

describe("[ENG-P07] khoá chấm KHÔNG rò: bộ đề phát ra chỉ có id + nội dung câu", () => {
  const KHOA_CHAM = ["truc", "dao", "soiGuong", "mucToiDa", "thang", "loaiThang", "ma\":\"D", "trongSo"];
  it.each(BON_BO.map((m) => [m] as const))("bộ %s: JSON của chonBoDe/layBoDe và boDeChoKhach không chứa cột trục/đảo", (ma) => {
    const bo = engineThat.layBoDe(ma)!;
    const json = JSON.stringify(bo);
    for (const k of ["truc", "dao", "soiGuong", "trongSo", "khoaCham"]) expect(json, k).not.toContain(`"${k}"`);
    for (const c of bo.cauHoi) expect(Object.keys(c).sort()).toEqual(["id", "noiDung"]);
    // cauDan + thang là phần HIỂN THỊ (nhãn các mức) thêm ở tích hợp UI: client cần biết giá trị hợp lệ 1..N của bộ đề (bộ TH chỉ 3 mức). Không phải khoá chấm.
    expect(Object.keys(bo).sort()).toEqual(["cauDan", "cauHoi", "doiTuong", "ma", "nguoiLonTraLoiHo", "phienBan", "thang"]);
    for (const m of bo.thang ?? []) expect(Object.keys(m).every((k) => ["gia", "nhan", "mat"].includes(k))).toBe(true);
    expect(json).not.toContain("mucToiDa");
    const khach = boDeChoKhach(engineThat, { vai: ma === "PH" ? "PH" : "HS", bacHoc: ma === "MN" ? "MN" : ma === "TH" ? "4" : ma === "THCS" ? "7" : undefined, namSinh: ma === "MN" ? 2022 : ma === "TH" ? 2016 : ma === "THCS" ? 2013 : 1988, namNay: 2026 });
    expect(khach?.ma).toBe(ma);
    for (const k of KHOA_CHAM.slice(0, 4)) expect(JSON.stringify(khach), k).not.toContain(`"${k}"`);
  });
  it("object bộ đề bị đóng băng: không ai sửa được khoá chấm qua tham chiếu đã phát", () => {
    const bo = engineThat.layBoDe("TH")!;
    expect(Object.isFrozen(bo)).toBe(true);
    expect(Object.isFrozen(bo.cauHoi)).toBe(true);
    expect(() => {
      (bo.cauHoi[0] as { noiDung: string }).noiDung = "x";
    }).toThrow();
  });
});

describe("[ENG-P08] ensureDiscEngine: idempotent, gắn đúng engine thật", () => {
  it("gọi nhiều lần ⇒ layEngine() === engineThat; trước đó có thể là null", () => {
    datEngine(null);
    expect(layEngine()).toBeNull();
    ensureDiscEngine();
    expect(layEngine()).toBe(engineThat);
    ensureDiscEngine();
    ensureDiscEngine();
    expect(layEngine()).toBe(engineThat);
    datEngine(null);
    ensureDiscEngine(); // bị gỡ ⇒ gắn lại được
    expect(layEngine()).toBe(engineThat);
    datEngine(null);
  });
});

function* duyetTep(thuMuc: string): Generator<string> {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    const st = statSync(p);
    if (st.isDirectory()) yield* duyetTep(p);
    else if (/\.(ts|tsx)$/.test(ten)) yield p;
  }
}

describe("[ENG-P09] engine chấm điểm / khoá chấm KHÔNG vào bundle client", () => {
  const goc = process.cwd();
  const laClient = (nd: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(nd);
  const CAM = /engine-goc|\/engine-that|\/engine-dang-ky|\.\/engine-that|\.\/engine-dang-ky/;

  it("không file 'use client' nào (app/ + components/) import engine-goc / engine-that / engine-dang-ky", () => {
    const vi_pham: string[] = [];
    let soClient = 0;
    for (const thuMuc of ["app", "components"]) {
      for (const f of duyetTep(join(goc, thuMuc))) {
        const nd = readFileSync(f, "utf8");
        if (!laClient(nd)) continue;
        soClient++;
        if (CAM.test(nd)) vi_pham.push(f);
      }
    }
    expect(soClient).toBeGreaterThan(20); // chứng minh bộ quét có thấy file client
    expect(vi_pham).toEqual([]);
  });
  it("file client của DISC chỉ lấy KIỂU từ lib/disc/engine (import type), không lấy giá trị", () => {
    for (const f of duyetTep(join(goc, "components", "disc"))) {
      const nd = readFileSync(f, "utf8");
      if (!laClient(nd)) continue;
      for (const m of nd.matchAll(/import\s+([^;]*?)\s+from\s+["']@\/lib\/disc\/engine["']/g)) {
        expect(m[1].startsWith("type "), `${f}: ${m[0]}`).toBe(true);
      }
    }
  });
  it("engine-that.ts và engine-dang-ky.ts khai 'server-only'; engine.ts (hợp đồng) không import engine-goc/engine-that", () => {
    for (const f of ["lib/disc/engine-that.ts", "lib/disc/engine-dang-ky.ts"]) {
      expect(readFileSync(join(goc, f), "utf8"), f).toMatch(/^import "server-only";$/m);
    }
    const hopDong = readFileSync(join(goc, "lib/disc/engine.ts"), "utf8");
    expect(hopDong).not.toMatch(/engine-goc|engine-that|engine-dang-ky/);
  });
  it("ngoài engine-that / engine-dang-ky / test, không file nào trong lib/ app/ components/ import engine-goc", () => {
    const duoc = new Set(["lib/disc/engine-that.ts"]);
    // 02/11/2026 — hai thư mục MÁY CHỦ dùng engine để bốc đề / dựng báo cáo (ngân hàng 12.752 câu, sổ gia đình) được import engine-goc.
    // Cái giữ cho khoá chấm không ra trình duyệt là lưới [SG-RG-*] (lib/disc/so-gia-dinh/ranh-gioi.test.ts): file 'use client' chỉ được
    // lấy từ chúng những module KHÔNG chạm engine, và `lib/disc/ngan-hang/` thì không bao giờ.
    const TIEN_TO_MAY_CHU = ["lib/disc/ngan-hang/", "lib/disc/so-gia-dinh/"];
    const lan: string[] = [];
    for (const thuMuc of ["lib", "app", "components"]) {
      for (const f of duyetTep(join(goc, thuMuc))) {
        const rel = f.slice(goc.length + 1).replace(/\\/g, "/");
        if (rel.startsWith("lib/disc/engine-goc/") || /\.test\.tsx?$/.test(rel) || duoc.has(rel) || TIEN_TO_MAY_CHU.some((t) => rel.startsWith(t))) continue;
        if (/@\/lib\/disc\/engine-goc|["']\.\/engine-goc/.test(readFileSync(f, "utf8"))) lan.push(rel);
      }
    }
    expect(lan).toEqual([]);
  });
});

describe("[ENG-P10] dây nối: route/trang phải gọi ensureDiscEngine() (đã nối)", () => {
  // ⚠️ GHIM bằng it.fails: hôm nay các điểm vào CHƯA gọi `ensureDiscEngine()` nên `layEngine()` luôn null ngoài test.
  // Nối xong (bo-de/route.ts · luu/route.ts · (public)/disc/bat-dau/page.tsx) ca này XANH ⇒ Playwright/Vitest báo
  // "expected to fail" ⇒ buộc người nối GỠ `.fails`. Đừng đổi sang skip.
  it("ba điểm vào đều gọi ensureDiscEngine()", () => {
    for (const f of ["app/api/disc/bo-de/route.ts", "app/api/disc/luu/route.ts", "app/(public)/disc/bat-dau/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toMatch(/ensureDiscEngine\(\)/);
    }
  });
});
