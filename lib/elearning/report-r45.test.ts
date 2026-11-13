// @vitest-environment node
/**
 * EL-17 — R4 (theo phòng ban) và R5 (kết quả kiểm tra + phân tích câu hỏi).
 *
 * Hai bất biến đắt nhất ở đây đều là về việc KHÔNG NÓI QUÁ:
 *  · nhóm dưới 5 người phải bị gộp — một dòng riêng cho phòng một người là nêu đích
 *    danh cá nhân trên tài liệu gửi khắp công ty;
 *  · "chưa đủ dữ liệu" phải khác "không có vấn đề" — gộp hai cái là để người soạn đề
 *    tin rằng những câu chưa ai làm đã được kiểm.
 */
import { describe, it, expect } from "vitest";
import {
  gomTheoNhom,
  gopNhomNho,
  laBoTrang,
  laDungHan,
  laKipNhip,
  NGUONG_N_TOI_THIEU,
  tiLe,
  type LuotDeGop,
} from "@/lib/elearning/report-r4";
import {
  phanTichCauHoi,
  tongHopDeThi,
  SO_LUOT_TOI_THIEU,
} from "@/lib/elearning/report-r5";

const D = (s: string) => new Date(s);
const NOW = D("2026-06-01T00:00:00Z");
const DAU = D("2026-01-01T00:00:00Z");

let demNguoi = 0;
const luot = (p: Partial<LuotDeGop>): LuotDeGop => ({
  userId: `u-${++demNguoi}`,
  nhomId: "dep-a",
  verifiedAt: null,
  dueAtOriginal: null,
  dueAt: null,
  startedAt: null,
  status: "IN_PROGRESS",
  progressPercent: 0,
  pausedAt: null,
  ...p,
});

describe("M2 — hoàn thành có kiểm chứng ĐÚNG HẠN", () => {
  it("so với `dueAtOriginal`, KHÔNG với `dueAt`", () => {
    // `dueAt` nới được (gia hạn, bù SLA); `dueAtOriginal` bất biến. Đo bằng hạn đã
    // nới là để một lượt gia hạn ba lần vẫn tính đúng hạn — chỉ số mất ý nghĩa.
    const l = luot({
      verifiedAt: D("2026-05-20T00:00:00Z"),
      dueAtOriginal: D("2026-05-10T00:00:00Z"),
      dueAt: D("2026-06-30T00:00:00Z"),
    });
    expect(laDungHan(l)).toBe(false);
  });

  it("verify đúng ngày hạn vẫn tính là đúng hạn", () => {
    const m = D("2026-05-10T00:00:00Z");
    expect(laDungHan(luot({ verifiedAt: m, dueAtOriginal: m }))).toBe(true);
  });

  it("chưa kiểm chứng ⇒ không tính đúng hạn dù đã COMPLETED", () => {
    expect(
      laDungHan(luot({ status: "COMPLETED", dueAtOriginal: D("2026-07-01") })),
    ).toBe(false);
  });

  it("không có hạn gốc ⇒ đứng NGOÀI phép đo về hạn", () => {
    expect(laDungHan(luot({ verifiedAt: NOW, dueAtOriginal: null }))).toBe(false);
  });
});

describe("M3 — BỎ TRẮNG khác 'quá hạn'", () => {
  it("quá hạn và chưa từng mở ⇒ bỏ trắng", () => {
    expect(laBoTrang(luot({ dueAt: D("2026-05-01T00:00:00Z") }), NOW)).toBe(true);
  });

  it("quá hạn nhưng ĐÃ mở bài ⇒ KHÔNG phải bỏ trắng", () => {
    // Người mở rồi bỏ dở và người chưa mở lần nào là hai vấn đề khác hẳn — một bên
    // nội dung khó, bên kia là họ chưa nhận được lời nhắc nào hoặc không vào được.
    expect(
      laBoTrang(
        luot({ dueAt: D("2026-05-01T00:00:00Z"), startedAt: D("2026-04-01"), progressPercent: 20 }),
        NOW,
      ),
    ).toBe(false);
  });

  it("đang TẠM DỪNG thì không tính", () => {
    expect(
      laBoTrang(luot({ dueAt: D("2026-05-01"), pausedAt: D("2026-04-01") }), NOW),
    ).toBe(false);
  });

  it("chưa tới hạn ⇒ chưa phải bỏ trắng", () => {
    expect(laBoTrang(luot({ dueAt: D("2026-12-01") }), NOW)).toBe(false);
  });
});

describe("M5 — kịp nhịp", () => {
  it("tiến độ theo kịp phần thời gian đã trôi ⇒ kịp", () => {
    // Nửa quãng thời gian, nửa tiến độ.
    const l = luot({
      startedAt: D("2026-05-01T00:00:00Z"),
      dueAt: D("2026-07-01T00:00:00Z"),
      progressPercent: 60,
    });
    expect(laKipNhip(l, NOW, DAU)).toBe(true);
  });

  it("tiến độ tụt sau thời gian ⇒ không kịp", () => {
    const l = luot({
      startedAt: D("2026-05-01T00:00:00Z"),
      dueAt: D("2026-07-01T00:00:00Z"),
      progressPercent: 10,
    });
    expect(laKipNhip(l, NOW, DAU)).toBe(false);
  });

  it("đã xong hoặc đã quá hạn thì đứng ngoài mẫu số", () => {
    expect(laKipNhip(luot({ verifiedAt: NOW, dueAt: D("2026-12-01") }), NOW, DAU)).toBe(
      false,
    );
    expect(laKipNhip(luot({ dueAt: D("2026-01-01") }), NOW, DAU)).toBe(false);
  });
});

describe("🔴 gộp nhóm nhỏ — ngưỡng ẩn danh, không phải thẩm mỹ", () => {
  const ds = [
    luot({ nhomId: "to" }),
    luot({ nhomId: "to" }),
    luot({ nhomId: "to" }),
    luot({ nhomId: "to" }),
    luot({ nhomId: "to" }),
    luot({ nhomId: "mot-nguoi" }),
    luot({ nhomId: "hai-nguoi" }),
    luot({ nhomId: "hai-nguoi" }),
  ];

  it("nhóm đủ ngưỡng đứng riêng, nhóm nhỏ bị gộp", () => {
    // Đo prod: ba phòng mỗi phòng ĐÚNG MỘT người. Một dòng "Marketing: 0% đúng hạn"
    // là một câu về đích danh một con người trên tài liệu gửi khắp công ty.
    const r = gopNhomNho(gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU));
    expect(r).toHaveLength(2);
    expect(r[0]!.nhanNhom).toBe("to");
    expect(r[1]!.nhanNhom).toContain("Khối hỗ trợ");
  });

  it("🔴 GỘP chứ không BỎ — tổng phải khớp", () => {
    // Bỏ đi là làm mẫu số hụt mà không ai biết hụt bao nhiêu.
    const truoc = gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU);
    const sau = gopNhomNho(truoc);
    const tong = (xs: { tong: number }[]) => xs.reduce((s, x) => s + x.tong, 0);
    expect(tong(sau)).toBe(tong(truoc));
    expect(tong(sau)).toBe(ds.length);
  });

  it("không có nhóm nhỏ thì không đẻ dòng gộp rỗng", () => {
    const chiTo = gomTheoNhom(
      ds.filter((l) => l.nhomId === "to"),
      (id) => id ?? "?",
      NOW,
      DAU,
    );
    expect(gopNhomNho(chiTo)).toHaveLength(1);
  });

  it("ngưỡng là 5", () => {
    expect(NGUONG_N_TOI_THIEU).toBe(5);
  });

  it("`null` nhóm hiện thành dòng riêng có tên, không biến mất", () => {
    const r = gomTheoNhom(
      [luot({ nhomId: null })],
      (id) => (id == null ? "Chưa gán phòng ban" : id),
      NOW,
      DAU,
    );
    expect(r[0]!.nhanNhom).toBe("Chưa gán phòng ban");
  });
});

describe("tỉ lệ", () => {
  it("mẫu số 0 ⇒ null, không phải 0%", () => {
    expect(tiLe(0, 0)).toBeNull();
    expect(tiLe(1, 2)).toBe(50);
  });
});

describe("R5 — M6 đo LẦN ĐẦU", () => {
  it("chỉ đếm `attemptNo = 1`", () => {
    // Gộp mọi lần làm là đo "cuối cùng có ai đạt không" — câu hỏi khác, và luôn cho
    // ra con số đẹp hơn vì người ta được làm lại.
    const r = tongHopDeThi([
      { attemptId: "a", userId: "u1", examId: "e1", attemptNo: 1, totalScore: 4, passed: false },
      { attemptId: "b", userId: "u1", examId: "e1", attemptNo: 2, totalScore: 9, passed: true },
    ]);
    expect(r[0]!.soLuotLanDau).toBe(1);
    expect(r[0]!.soDatLanDau).toBe(0);
    expect(r[0]!.tiLeDatLanDau).toBe(0);
    expect(r[0]!.tongLuot).toBe(2);
  });

  it("chưa có lượt lần đầu ⇒ null, không phải 0%", () => {
    const r = tongHopDeThi([
      { attemptId: "b", userId: "u1", examId: "e1", attemptNo: 2, totalScore: 9, passed: true },
    ]);
    expect(r[0]!.tiLeDatLanDau).toBeNull();
  });
});

describe("🔴 R5 — phân tích câu hỏi gắn cờ CẢ HAI đầu", () => {
  const nhieu = (n: number, dung: number, q = "q1") =>
    Array.from({ length: n }, (_, i) => ({
      attemptId: `a${i}`,
      examQuestionId: q,
      isCorrect: i < dung,
    }));

  it("quá KHÓ (≤30% đúng) ⇒ cần rà lại", () => {
    // Không chứng minh học viên kém — nhiều khả năng câu mơ hồ hoặc nội dung chưa phủ.
    const r = phanTichCauHoi(nhieu(10, 2));
    expect(r[0]!.canRaLai).toBe(true);
    expect(r[0]!.lyDo).toContain("mơ hồ");
  });

  it("quá DỄ (100% đúng) ⇒ cũng cần rà lại", () => {
    // Câu không phân loại được ai, tức chiếm chỗ trong đề mà không đo gì.
    const r = phanTichCauHoi(nhieu(10, 10));
    expect(r[0]!.canRaLai).toBe(true);
    expect(r[0]!.lyDo).toContain("không phân loại");
  });

  it("ở giữa ⇒ không gắn cờ", () => {
    expect(phanTichCauHoi(nhieu(10, 6))[0]!.canRaLai).toBe(false);
  });

  it("🔴 dưới ngưỡng lượt ⇒ `null`, KHÔNG phải `false`", () => {
    // Hai người làm sai cả hai không nói lên gì về câu hỏi. Gắn cờ ở đó là biến nhiễu
    // thành kết luận, và người soạn đề sẽ sửa một câu vốn không sao. Trả `false` thì
    // ngược lại: câu chưa ai làm trông như câu đã được kiểm và không có vấn đề.
    const r = phanTichCauHoi(nhieu(2, 0));
    expect(r[0]!.canRaLai).toBeNull();
    expect(r[0]!.lyDo).toContain("chưa đủ");
    expect(SO_LUOT_TOI_THIEU).toBe(5);
  });

  it("câu tự luận CHƯA CHẤM (`isCorrect = null`) không vào cả tử lẫn mẫu", () => {
    const r = phanTichCauHoi([
      { attemptId: "a", examQuestionId: "q1", isCorrect: null },
      { attemptId: "b", examQuestionId: "q1", isCorrect: true },
    ]);
    expect(r[0]!.soLuot).toBe(1);
  });

  it("sắp câu KHÓ NHẤT lên đầu", () => {
    const r = phanTichCauHoi([...nhieu(10, 9, "de"), ...nhieu(10, 1, "kho")]);
    expect(r[0]!.examQuestionId).toBe("kho");
  });
});

describe("🔴 ngưỡng ẩn danh đếm NGƯỜI, không đếm LƯỢT (đặc tả: nhóm dưới 5 NGƯỜI bị gộp)", () => {
  const nhom = (id: string, nguoi: string[], luotMoiNguoi = 1) =>
    nguoi.flatMap((u) =>
      Array.from({ length: luotMoiNguoi }, () => luot({ nhomId: id, userId: u })),
    );

  it("MỘT người có 5 lượt trong cùng nhóm ⇒ nhóm đó chỉ có 1 người ⇒ bị GỘP, không đứng riêng", () => {
    // Lỗi cũ: `tong` đếm lượt và ngưỡng lọc `tong >= 5` ⇒ phòng chỉ có MỘT nhân viên học 5 khoá
    // hiện thành dòng riêng — chính là câu "Marketing: 0% đúng hạn" về đích danh một con người.
    const ds = [...nhom("mot-nguoi-nam-khoa", ["solo"], 5), ...nhom("to", ["a", "b", "c", "d", "e"])];
    const r = gopNhomNho(gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU));
    expect(r.map((x) => x.nhanNhom)).not.toContain("mot-nguoi-nam-khoa");
    expect(r.find((x) => x.nhanNhom === "to")?.soNguoi).toBe(5);
    expect(r.at(-1)!.nhanNhom).toContain("Khối hỗ trợ");
  });

  it("4 người, mỗi người nhiều lượt (tổng 12 lượt) ⇒ vẫn dưới ngưỡng ⇒ GỘP", () => {
    const ds = nhom("bon-nguoi", ["a", "b", "c", "d"], 3);
    const r = gopNhomNho(gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU));
    expect(r).toHaveLength(1);
    expect(r[0]!.nhanNhom).toContain("Khối hỗ trợ");
    expect(r[0]!.tong).toBe(12);
    expect(r[0]!.soNguoi).toBe(4);
  });

  it("ĐỐI CHỨNG DƯƠNG: đúng 5 người, mỗi người 1 lượt ⇒ đứng riêng", () => {
    const ds = nhom("nam-nguoi", ["a", "b", "c", "d", "e"]);
    const r = gopNhomNho(gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU));
    expect(r).toHaveLength(1);
    expect(r[0]!.nhanNhom).toBe("nam-nguoi");
    expect(r[0]!.soNguoi).toBe(5);
    expect(r[0]!.tong).toBe(5);
  });

  it("5 người, mỗi người 2 lượt ⇒ đứng riêng; `soNguoi` = 5 còn `tong` = 10 (hai con số khác nghĩa)", () => {
    const ds = nhom("nam-nguoi-hai-luot", ["a", "b", "c", "d", "e"], 2);
    const r = gopNhomNho(gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU));
    expect(r[0]!.nhanNhom).toBe("nam-nguoi-hai-luot");
    expect(r[0]!.soNguoi).toBe(5);
    expect(r[0]!.tong).toBe(10);
  });

  it("dòng GỘP cộng `soNguoi` của các nhóm nhỏ và vẫn giữ tổng lượt (gộp chứ không bỏ)", () => {
    const ds = [...nhom("n1", ["a"], 2), ...nhom("n2", ["b", "c"], 2)];
    const r = gopNhomNho(gomTheoNhom(ds, (id) => id ?? "?", NOW, DAU));
    expect(r).toHaveLength(1);
    expect(r[0]!.soNguoi).toBe(3);
    expect(r[0]!.tong).toBe(6);
  });
});
