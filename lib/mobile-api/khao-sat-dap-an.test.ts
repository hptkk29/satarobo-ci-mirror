import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { kiemDapAnKhaoSat, type CauKhaoSat } from "./khao-sat-dap-an";

/**
 * [KS] Khảo sát tháng — OD-16 (chủ dự án chốt 19/11/2026: thang 0–10, KHÔNG ẩn danh). THUẦN, không DB.
 *   [KS-01] đủ NPS 0–10 + 4 mặt chấm 1–5 + chữ ⇒ hợp lệ, `npsScore` lấy từ câu NPS đầu tiên
 *   [KS-02] ranh giới NPS: 0 và 10 hợp lệ; −1, 11, 7.5, chuỗi ⇒ từ chối; RATING: 1 và 5 hợp lệ; 0, 6 ⇒ từ chối
 *   [KS-03] thiếu câu bắt buộc (NPS / RATING) ⇒ từ chối; thiếu câu TEXT ⇒ vẫn hợp lệ (tuỳ chọn); TEXT rỗng không lưu
 *   [KS-04] đáp án ngoài khảo sát / trả lời hai lần một câu / TEXT là số / khảo sát không có câu hỏi ⇒ từ chối
 *   [KS-ANON-01] LƯỚI GHIM MÃ NGUỒN: đường khảo sát di động KHÔNG có tham số/cột/biến ẩn danh (bỏ chú thích rồi mới đếm — chú thích giải thích bản vá chứa đúng chữ «ẩn danh»)
 */
const CAU: CauKhaoSat[] = [
  { id: "q-nps", text: "Ba mẹ sẵn lòng giới thiệu Sata Robo ở mức nào?", type: "NPS" },
  { id: "q-gv", text: "Thầy cô giảng dạy", type: "RATING" },
  { id: "q-cs", text: "Phòng học, thiết bị", type: "RATING" },
  { id: "q-lh", text: "Liên lạc với ba mẹ", type: "RATING" },
  { id: "q-cp", text: "Cổng phụ huynh này", type: "RATING" },
  { id: "q-txt", text: "Điều ba mẹ muốn trung tâm làm tốt hơn", type: "TEXT" },
];
const DU = [
  { questionId: "q-nps", value: 9 },
  { questionId: "q-gv", value: 5 },
  { questionId: "q-cs", value: 4 },
  { questionId: "q-lh", value: 3 },
  { questionId: "q-cp", value: 4 },
  { questionId: "q-txt", value: "  Máy lạnh phòng 302  " },
];

describe("[KS] kiểm đáp án khảo sát", () => {
  it("[KS-01] đủ đáp án ⇒ hợp lệ; npsScore từ câu NPS đầu tiên", () => {
    const r = kiemDapAnKhaoSat(CAU, DU);
    expect(r).toEqual({ ok: true, npsScore: 9, answers: { "q-nps": 9, "q-gv": 5, "q-cs": 4, "q-lh": 3, "q-cp": 4, "q-txt": "Máy lạnh phòng 302" } });
  });

  it("[KS-02] ranh giới NPS 0–10 và RATING 1–5", () => {
    const thay = (q: string, v: unknown) => DU.map((d) => (d.questionId === q ? { ...d, value: v as number } : d));
    expect(kiemDapAnKhaoSat(CAU, thay("q-nps", 0)).ok).toBe(true);
    expect(kiemDapAnKhaoSat(CAU, thay("q-nps", 10)).ok).toBe(true);
    for (const v of [-1, 11, 7.5, "9", Number.NaN]) expect([v, kiemDapAnKhaoSat(CAU, thay("q-nps", v)).ok]).toEqual([v, false]);
    expect(kiemDapAnKhaoSat(CAU, thay("q-gv", 1)).ok).toBe(true);
    for (const v of [0, 6, 2.5]) expect([v, kiemDapAnKhaoSat(CAU, thay("q-gv", v)).ok]).toEqual([v, false]);
  });

  it("[KS-03] câu bắt buộc phải có; TEXT tuỳ chọn; TEXT rỗng không lưu", () => {
    const thieuNps = kiemDapAnKhaoSat(CAU, DU.filter((d) => d.questionId !== "q-nps"));
    expect(thieuNps).toEqual({ ok: false, loi: expect.stringContaining("Vui lòng trả lời") });
    expect(kiemDapAnKhaoSat(CAU, DU.filter((d) => d.questionId !== "q-cs")).ok).toBe(false);
    const khongText = kiemDapAnKhaoSat(CAU, DU.filter((d) => d.questionId !== "q-txt"));
    expect(khongText.ok && "q-txt" in khongText.answers).toBe(false);
    const rong = kiemDapAnKhaoSat(CAU, DU.map((d) => (d.questionId === "q-txt" ? { ...d, value: "   " } : d)));
    expect(rong.ok && "q-txt" in rong.answers).toBe(false);
  });

  it("[KS-04] đáp án ngoài khảo sát, trả lời hai lần, sai loại, khảo sát rỗng ⇒ từ chối", () => {
    expect(kiemDapAnKhaoSat(CAU, [...DU, { questionId: "khong-co", value: 1 }])).toEqual({ ok: false, loi: expect.stringContaining("không thuộc khảo sát") });
    expect(kiemDapAnKhaoSat(CAU, [...DU, { questionId: "q-gv", value: 5 }])).toEqual({ ok: false, loi: expect.stringContaining("hai lần") });
    expect(kiemDapAnKhaoSat(CAU, DU.map((d) => (d.questionId === "q-txt" ? { ...d, value: 5 } : d))).ok).toBe(false);
    expect(kiemDapAnKhaoSat([], DU).ok).toBe(false);
  });

  it("[KS-ANON-01] đường khảo sát di động không có ẩn danh (bỏ chú thích rồi mới soi)", () => {
    const bo = (p: string) =>
      readFileSync(resolve(process.cwd(), p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((d) => d.replace(/\/\/.*$/, ""))
        .join("\n");
    const tep = [
      "lib/mobile-api/khao-sat-dap-an.ts",
      "lib/mobile-api/dich-vu/khao-sat.ts",
      "app/api/mobile/v1/students/[studentId]/surveys/route.ts",
      "app/api/mobile/v1/students/[studentId]/surveys/[surveyId]/responses/route.ts",
    ];
    for (const t of tep) expect([t, /an[_ -]?danh|anonymous|\banon\b|nacDanh|nặc danh|ẩn danh/i.test(bo(t))]).toEqual([t, false]);
    // và `parentUserId` CHỈ đến từ phiên (đối số của hàm), không từ thân yêu cầu.
    expect(bo("lib/mobile-api/dich-vu/khao-sat.ts")).toMatch(/parentUserId, \/\/|parentUserId,\s*\n/);
    expect(bo("lib/mobile-api/dich-vu/khao-sat.ts")).not.toMatch(/input\.parentUserId/);
  });
});
