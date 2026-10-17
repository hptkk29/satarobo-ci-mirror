// [DT-*] — máy trạng thái của MỘT dòng cần bù (T05). THUẦN. Bảng cạnh là luật; mỗi cặp không có trong bảng là một câu "KHÔNG ĐƯỢC".
import { describe, expect, it } from "vitest";
import { CANH_DONG, TRANG_THAI_DONG, laCanhHopLe, laDongDangMo, type LyDoChuyen } from "@/lib/hoc-bu/dong-trang-thai";

const TAT_CA_LY_DO: LyDoChuyen[] = [
  "XEP_CASE",
  "GO_KHOI_CASE",
  "HUY_CASE",
  "BE_VANG_CASE",
  "BE_CO_MAT_HOAN_THANH",
  "HUY_KHONG_BU",
  "TU_HUY_DA_CO_MAT",
  "KHOI_PHUC",
  "HOI_SINH_VANG_LAI",
  "SUA_DIEM_DANH_DAO_NGUOC",
  "BAO_LUU_LUI_NGAY",
  "SUA_DIEM_DANH_HOAN_THANH",
];

describe("[DT] dong-trang-thai", () => {
  it("[DT-01] bảng có đúng 12 cạnh, mỗi LÝ DO xuất hiện đúng MỘT lần (lý do là khoá — dùng cạnh của việc này cho việc khác là sai)", () => {
    expect(CANH_DONG).toHaveLength(12);
    expect(CANH_DONG.map((c) => c.lyDo).sort()).toEqual([...TAT_CA_LY_DO].sort());
  });

  it("[DT-02] cạnh hợp lệ: đúng ma trận audit mục 14", () => {
    const mong: [string, string, LyDoChuyen][] = [
      ["PENDING", "SCHEDULED", "XEP_CASE"],
      ["SCHEDULED", "PENDING", "GO_KHOI_CASE"],
      ["SCHEDULED", "PENDING", "HUY_CASE"],
      ["SCHEDULED", "PENDING", "BE_VANG_CASE"],
      ["SCHEDULED", "COMPLETED", "BE_CO_MAT_HOAN_THANH"],
      ["PENDING", "CANCELLED", "HUY_KHONG_BU"],
      ["PENDING", "CANCELLED", "TU_HUY_DA_CO_MAT"],
      ["CANCELLED", "PENDING", "KHOI_PHUC"],
      ["CANCELLED", "PENDING", "HOI_SINH_VANG_LAI"],
      ["COMPLETED", "PENDING", "SUA_DIEM_DANH_DAO_NGUOC"],
      ["PENDING", "CANCELLED", "BAO_LUU_LUI_NGAY"],
      ["PENDING", "COMPLETED", "SUA_DIEM_DANH_HOAN_THANH"], // T07
    ];
    for (const [tu, sang, lyDo] of mong) expect(laCanhHopLe(tu as never, sang as never, lyDo), `${tu}→${sang} ${lyDo}`).toBe(true);
  });

  it("[DT-03] MỌI bộ ba (từ, sang, lý do) ngoài bảng đều bị từ chối — duyệt cả 4×4×12", () => {
    const hopLe = new Set(CANH_DONG.map((c) => `${c.tu}|${c.sang}|${c.lyDo}`));
    let tuChoi = 0;
    for (const tu of TRANG_THAI_DONG)
      for (const sang of TRANG_THAI_DONG)
        for (const lyDo of TAT_CA_LY_DO) {
          const kq = laCanhHopLe(tu, sang, lyDo);
          expect(kq, `${tu}→${sang} ${lyDo}`).toBe(hopLe.has(`${tu}|${sang}|${lyDo}`));
          if (!kq) tuChoi++;
        }
    expect(tuChoi).toBe(4 * 4 * 12 - 12);
  });

  it("[DT-04] KHÔNG có cạnh SCHEDULED → CANCELLED (huỷ lớp từng cascade như vậy — quyết định 10 bỏ nó) và KHÔNG có cạnh ra khỏi COMPLETED trừ sửa điểm danh có đảo ngược", () => {
    expect(CANH_DONG.some((c) => c.tu === "SCHEDULED" && c.sang === "CANCELLED")).toBe(false);
    expect(CANH_DONG.filter((c) => c.tu === "COMPLETED").map((c) => c.lyDo)).toEqual(["SUA_DIEM_DANH_DAO_NGUOC"]);
    // Chỉ HAI cạnh đi tới COMPLETED: "bé có mặt ở buổi bù" và (T07) sửa điểm danh — bài từng ghi chưa xong thực ra đã xong.
    expect(CANH_DONG.filter((c) => c.sang === "COMPLETED").map((c) => c.lyDo).sort()).toEqual(
      ["BE_CO_MAT_HOAN_THANH", "SUA_DIEM_DANH_HOAN_THANH"].sort(),
    );
  });

  it("[DT-05] lý do không đổi được cạnh: dùng lý do của cạnh khác cho cặp (từ, sang) đúng vẫn bị từ chối", () => {
    expect(laCanhHopLe("PENDING", "CANCELLED", "KHOI_PHUC")).toBe(false);
    expect(laCanhHopLe("SCHEDULED", "PENDING", "HUY_KHONG_BU")).toBe(false);
    expect(laCanhHopLe("CANCELLED", "PENDING", "GO_KHOI_CASE")).toBe(false);
  });

  it("[DT-06] 'đang mở' = PENDING hoặc SCHEDULED — nơi DUY NHẤT định nghĩa", () => {
    expect(TRANG_THAI_DONG.filter(laDongDangMo)).toEqual(["PENDING", "SCHEDULED"]);
  });
});
