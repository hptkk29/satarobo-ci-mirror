import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { CO_LUOT_NGOAI } from "./cham-ngoai";
import { FLAG_LABEL, countsAsIssue, flagInfo } from "./flag-labels";

/** Đủ bộ mã mà `lib/cham-cong/engine.ts` + `timelog.ts` sinh ra (đo 06/09/2026). */
const ENGINE_FLAGS = [
  "KHONG_CO_LUOT",
  "THIEU_LUOT_RA",
  "RA_KHONG_CO_VAO",
  "THIEU_BUOI_SANG",
  "THIEU_BUOI_CHIEU",
  // 22/09/2026 — cùng đợt HC đảo sang 2 cặp quét (`cum-quet.khongQuetGiuaCa`).
  "THIEU_LUOT_GIUA_CA",
  "DI_MUON",
  "VE_SOM",
  "THIEU_GIO",
  "DEN_SAT_GIO",
  "NGOAI_VUNG",
  "THIEU_GPS",
  "CHUA_TOA_DO",
  "SAI_NOI_LAM",
  "CHAM_NGOAI_LICH",
  "TRUNG_2_PHUT",
  "VUOT_TRAN",
  "LAM_NGAY_LE",
  "GPS_KEM_CHINH_XAC",
  "CHINH_TAY",
  // Đợt 2 đơn từ (08/10/2026) — muộn/sớm TRONG khung đơn đã duyệt.
  "DI_MUON_DA_DUYET",
  "VE_SOM_DA_DUYET",
  "TANG_CA_DUYET",
  "LAM_TU_XA_DUYET",
  "CONG_TAC_DUYET",
  "CONG_TAC_DU_CONG",
  "LAM_TU_XA",
  "CONG_TAC",
  "NGHI_MOT_PHAN_DUYET",
  "NGHI_BU_DUYET",
  "NGHI_KHONG_AP_DUOC",
  "LAM_NGAY_NGHI_DUYET",
  "NGOAI_DIA_DIEM_DUYET",
  "QUY_NGHI_BU_CAN_RA_SOAT",
];

describe("FLAG_LABEL", () => {
  it("phủ đúng bộ mã engine sinh ra, không thừa không thiếu", () => {
    expect(Object.keys(FLAG_LABEL).sort()).toEqual([...ENGINE_FLAGS].sort());
  });

  it("mã nào cũng có nhãn tiếng Việt + tông hợp lệ", () => {
    for (const code of ENGINE_FLAGS) {
      const info = flagInfo(code);
      expect(info.text.length, code).toBeGreaterThan(0);
      expect(info.text, code).not.toBe(code);
      expect(["warn", "danger", "info"], code).toContain(info.tone);
    }
  });

  it("giữ nguyên phân loại nặng/nhẹ của bảng cũ", () => {
    expect(flagInfo("KHONG_CO_LUOT")).toEqual({ text: "Không có lượt", tone: "danger" });
    expect(flagInfo("NGOAI_VUNG").tone).toBe("danger");
    expect(flagInfo("SAI_NOI_LAM").tone).toBe("danger");
    expect(flagInfo("DI_MUON").tone).toBe("warn");
    expect(flagInfo("CHINH_TAY")).toEqual({ text: "Chỉnh tay (đơn duyệt)", tone: "info" });
  });
});

describe("flagInfo — mã lạ", () => {
  it("in nguyên mã với tông info", () => {
    expect(flagInfo("CO_MOI_TINH")).toEqual({ text: "CO_MOI_TINH", tone: "info" });
    expect(flagInfo("")).toEqual({ text: "", tone: "info" });
  });
});

describe("countsAsIssue", () => {
  it("chỉ warn/danger mới là việc cần rà", () => {
    expect(countsAsIssue("KHONG_CO_LUOT")).toBe(true);
    expect(countsAsIssue("THIEU_GIO")).toBe(true);
    expect(countsAsIssue("DEN_SAT_GIO")).toBe(false);
    expect(countsAsIssue("LAM_NGAY_LE")).toBe(false);
  });

  it("mã lạ VẪN tính là cần rà — cờ engine mới quên khai nhãn phải lộ ra, không im lặng", () => {
    expect(countsAsIssue("MA_MOI_CHUA_KHAI")).toBe(true);
    // nhưng nhãn vẫn là tông info để không nhuộm đỏ cả bảng
    expect(flagInfo("MA_MOI_CHUA_KHAI")).toEqual({ text: "MA_MOI_CHUA_KHAI", tone: "info" });
  });

  it("đếm được số dòng cần rà của một ngày", () => {
    const rows = [["DI_MUON", "THIEU_GPS"], ["DEN_SAT_GIO"], [], ["KHONG_CO_LUOT"]];
    expect(rows.filter((f) => f.some(countsAsIssue)).length).toBe(2);
  });
});

// [FL-SRC] Lưới đọc MÃ NGUỒN THẬT (08/10/2026). Danh sách `ENGINE_FLAGS` ở trên gõ tay — nó đã bỏ sót ba
// cờ của đợt 7–8 (nghỉ một phần / nghỉ bù) mà vẫn xanh, và cờ thiếu nhãn bị `countsAsIssue` đếm là
// "cần rà" (đỏ oan trên bảng công). Ở đây lấy mọi `flags.add("…")` (kể cả hai vế của toán tử ba ngôi)
// trong các tệp sinh cờ + mọi cờ lượt quét chấm ngoài, và đòi mỗi cái có nhãn.
describe("[FL-SRC] mọi cờ engine / lượt quét sinh ra đều có nhãn", () => {
  const TEP = ["lib/cham-cong/engine.ts", "lib/cham-cong/timelog.ts"];
  // Cờ gắn ở recompute (không qua flags.add) — khai tay vào tập đọc từ mã.
  const THEM = ["QUY_NGHI_BU_CAN_RA_SOAT"];
  const coTrongMa = new Set<string>();
  for (const tep of TEP) {
    const src = readFileSync(resolve(process.cwd(), tep), "utf8");
    for (const dong of src.split(/\r?\n/)) {
      if (!dong.includes("flags.add(")) continue;
      for (const m of dong.matchAll(/"([A-Z][A-Z0-9_]+)"/g)) coTrongMa.add(m[1]!);
    }
  }
  for (const co of Object.values(CO_LUOT_NGOAI)) if (co) coTrongMa.add(co);
  for (const co of THEM) coTrongMa.add(co);

  it("đọc được cờ từ mã (đối chứng: lưới không rỗng)", () => {
    expect(coTrongMa.size).toBeGreaterThan(20);
    expect(coTrongMa.has("DI_MUON")).toBe(true);
  });

  it("không cờ nào thiếu nhãn", () => {
    // "COMP_LEAVE" là chuỗi nguồn nghỉ trong `n.nguon === "COMP_LEAVE" ? … : …`, không phải cờ.
    const thieu = [...coTrongMa].filter((c) => c !== "COMP_LEAVE" && !(c in FLAG_LABEL)).sort();
    expect(thieu).toEqual([]);
  });
});
