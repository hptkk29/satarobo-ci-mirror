/**
 * Khoá bằng test cái gốc của sự cố "lệch tên bài" (`docs/dieu-tra-lech-bai-hoc.md`):
 * `session-order.ts` từng trả lời HAI câu hỏi bằng MỘT con số.
 *
 *   · thứ tự LỘ TRÌNH  → in nhãn   (bài thứ mấy của giáo trình)
 *   · thứ tự THỜI GIAN → sắp xếp   (buổi thứ mấy theo ngày)
 *
 * Ca [S6] dựng đúng hình dạng đo được trên prod ngày 08/09 ở lớp `CS2.SATA6.26.001`:
 * 48 buổi sinh toàn Thứ 7 (bài 1..48 đúng thứ tự), rồi 6 buổi mang bài 43–48 bị DỜI NGÀY
 * lên các Thứ 5 tháng 6–7. Bộ dời ngày không đụng `lessonId`, còn số buổi thì tính lại
 * theo ngày mỗi lần render — nên nhãn đọc ra "Buổi 2 — bài 43".
 */
import { describe, it, expect } from "vitest";
import {
  soBuoiTheoLoTrinh,
  soBuoiTheoLich,
  nhanSoBuoi,
  sortSessionsForWork,
} from "./session-order";

describe("soBuoiTheoLoTrinh — thang fallback", () => {
  it("có plan.order → dùng nó, +1 vì plan.order là 0-based", () => {
    expect(soBuoiTheoLoTrinh({ planOrder: 0, lessonOrder: 99 })).toBe(1);
    expect(soBuoiTheoLoTrinh({ planOrder: 42, lessonOrder: 99 })).toBe(43);
  });

  it("KHÔNG có plan → lùi về Lesson.order (đã là 1-based, KHÔNG +1)", () => {
    // Đây là nấc cứu lớp chưa ghim giáo trình: `generate.ts` vẫn gán `lessonId`
    // theo `curriculum.lessons` sắp `order asc`, nên `Lesson.order` là nguồn hợp lệ.
    expect(soBuoiTheoLoTrinh({ planOrder: null, lessonOrder: 7 })).toBe(7);
    expect(soBuoiTheoLoTrinh({ lessonOrder: 1 })).toBe(1);
  });

  it("không có nguồn nào → null, KHÔNG tự lùi về hạng-theo-ngày", () => {
    // Hạng-theo-ngày là số THỜI GIAN. Trộn nó vào đây là dựng lại đúng lỗi vừa sửa.
    expect(soBuoiTheoLoTrinh({})).toBeNull();
    expect(soBuoiTheoLoTrinh({ planOrder: null, lessonOrder: null })).toBeNull();
  });

  it("giá trị vô lý không lọt: planOrder âm, lessonOrder 0", () => {
    expect(soBuoiTheoLoTrinh({ planOrder: -1 })).toBeNull();
    expect(soBuoiTheoLoTrinh({ lessonOrder: 0 })).toBeNull();
  });
});

describe("nhanSoBuoi — nấc cuối phải NÓI RÕ là số theo lịch", () => {
  it("có số lộ trình → in trần", () => {
    expect(nhanSoBuoi({ loTrinh: 43, lich: 2 })).toBe("Buổi 43");
  });

  it("chỉ có số theo lịch → phải kèm chú thích", () => {
    // In trần "Buổi 7" ở nấc này là để người đọc tưởng đó là BÀI số 7 của giáo trình,
    // trong khi nó chỉ là buổi thứ 7 tính theo ngày. Chính chỗ nhập nhằng đó đẻ ra sự cố.
    expect(nhanSoBuoi({ loTrinh: null, lich: 7 })).toBe("Buổi 7 (theo lịch)");
  });

  it("không có gì → dấu gạch, không ném", () => {
    expect(nhanSoBuoi({ loTrinh: null, lich: null })).toBe("—");
  });
});

describe("[S6] hình dạng THẬT của CS2.SATA6.26.001 (đo prod 08/09)", () => {
  /** 48 buổi: bài 1..42 nằm trên các Thứ 7; bài 43..48 bị dời lên Thứ 5 tháng 6–7. */
  const buoi = (() => {
    const out: { id: string; classId: string; date: Date; planOrder: number }[] = [];
    // bài 1..42 — Thứ 7 hằng tuần từ 20/06/2026
    for (let i = 0; i < 42; i++) {
      out.push({
        id: `t7-${String(i).padStart(2, "0")}`,
        classId: "c1",
        date: new Date(Date.UTC(2026, 5, 20 + i * 7, 3, 0)),
        planOrder: i,
      });
    }
    // bài 43..48 — Thứ 5, 25/06 → 30/07/2026 (DỜI NGÀY, lessonId giữ nguyên)
    for (let k = 0; k < 6; k++) {
      out.push({
        id: `t5-${k}`,
        classId: "c1",
        date: new Date(Date.UTC(2026, 5, 25 + k * 7, 3, 0)),
        planOrder: 42 + k,
      });
    }
    return out;
  })();

  const soLich = soBuoiTheoLich(buoi);

  it("buổi ngày 25/06 mang NHÃN 'Buổi 43' — đúng sự thật: bài 43 dạy sớm", () => {
    const s = buoi.find((b) => b.id === "t5-0")!;
    const nhan = nhanSoBuoi({
      loTrinh: soBuoiTheoLoTrinh({ planOrder: s.planOrder }),
      lich: soLich.get(s.id) ?? null,
    });
    expect(nhan).toBe("Buổi 43");
    // Và số THEO LỊCH của nó là 2 — hai con số này KHÁC nhau, đó là cả vấn đề.
    expect(soLich.get(s.id)).toBe(2);
  });

  it("VỊ TRÍ trong danh sách vẫn theo NGÀY, không theo nhãn", () => {
    // Nếu sắp theo nhãn thì buổi 25/06 ("Buổi 43") rơi xuống gần cuối, sau buổi 12/09
    // ("Buổi 19") — danh sách việc còn nợ của giáo viên thôi theo thứ tự thời gian.
    const xep = sortSessionsForWork(
      buoi.map((b) => ({ b })),
      (r) => ({ thoiGian: r.b.date.getTime(), complete: false }),
    ).map((r) => r.b.id);

    expect(xep[0]).toBe("t7-00"); // 20/06
    expect(xep[1]).toBe("t5-0"); // 25/06 — nhãn "Buổi 43" nhưng ĐỨNG THỨ HAI
    expect(xep[2]).toBe("t7-01"); // 27/06

    // Bất biến: mọi ngày tăng dần.
    const ngay = sortSessionsForWork(
      buoi.map((b) => ({ b })),
      (r) => ({ thoiGian: r.b.date.getTime(), complete: false }),
    ).map((r) => r.b.date.getTime());
    for (let i = 1; i < ngay.length; i++) expect(ngay[i]!).toBeGreaterThan(ngay[i - 1]!);
  });

  it("buổi ĐÃ XONG VIỆC vẫn lùi xuống dưới, bất kể ngày", () => {
    const xep = sortSessionsForWork(
      buoi.map((b) => ({ b, done: b.id === "t7-00" })),
      (r) => ({ thoiGian: r.b.date.getTime(), complete: r.done }),
    ).map((r) => r.b.id);
    expect(xep[xep.length - 1]).toBe("t7-00"); // 20/06 nhưng đã xong → xuống cuối
  });
});

describe("[KHÔNG PLAN] lớp chưa ghim giáo trình — fallback phải chạy", () => {
  // `generate.ts:169-199` còn sống: lớp chưa ghim vẫn sinh buổi KHÔNG có plan, nhưng
  // CÓ `lessonId`. Đo prod 08/09 là 0 lớp như vậy — nhưng đường ghi còn sống nên
  // fallback bắt buộc phải có (Luật 1: "đường ghi SỐNG + 0 dòng" = bom hẹn giờ).
  const buoi = [
    { id: "a", classId: "c2", date: new Date(Date.UTC(2026, 8, 5, 3, 0)), lessonOrder: 1 },
    { id: "b", classId: "c2", date: new Date(Date.UTC(2026, 8, 12, 3, 0)), lessonOrder: 2 },
  ];
  const soLich = soBuoiTheoLich(buoi);

  it("không có plan → nhãn vẫn ra số bài, lấy từ Lesson.order", () => {
    for (const s of buoi) {
      const nhan = nhanSoBuoi({
        loTrinh: soBuoiTheoLoTrinh({ planOrder: null, lessonOrder: s.lessonOrder }),
        lich: soLich.get(s.id) ?? null,
      });
      expect(nhan).toBe(`Buổi ${s.lessonOrder}`);
    }
  });

  it("không plan VÀ không lesson → rơi nấc cuối, nhãn tự khai là số theo lịch", () => {
    const nhan = nhanSoBuoi({
      loTrinh: soBuoiTheoLoTrinh({}),
      lich: soLich.get("b") ?? null,
    });
    expect(nhan).toBe("Buổi 2 (theo lịch)");
  });
});

describe("[1b] deriveSessionLabel — ĐẢO ưu tiên: số LỘ TRÌNH thắng hạng-theo-ngày", () => {
  it("buổi Sata6 ngày 25/06 in 'Buổi 43', KHÔNG phải 'Buổi 2'", async () => {
    const { deriveSessionLabel } = await import("./session-project-name");
    // Đây chính là ca chủ dự án báo: hạng theo ngày = 2, nhưng bài là 43.
    expect(
      deriveSessionLabel({
        sessionNumber: 2, // hạng theo NGÀY
        planOrder: 42, // plan.order 0-based ⇒ bài 43
        lessonTitle: "HP4 - Chạy tổng hợp nhiệm vụ",
        lessonOrder: 43,
        moduleCode: "HP4",
      }),
    ).toBe("Buổi 43 - HP4 - Chạy tổng hợp nhiệm vụ");
  });

  it("không có plan → lùi về Lesson.order, vẫn thắng hạng-theo-ngày", async () => {
    const { deriveSessionLabel } = await import("./session-project-name");
    expect(
      deriveSessionLabel({ sessionNumber: 2, lessonOrder: 43, lessonTitle: "Bài X" }),
    ).toBe("Buổi 43 - Bài X");
  });

  it("KHÔNG có nguồn lộ trình nào → mới dùng hạng-theo-ngày", async () => {
    const { deriveSessionLabel } = await import("./session-project-name");
    expect(deriveSessionLabel({ sessionNumber: 2, topic: "Chủ đề tự nhập" })).toBe(
      "Buổi 2 - Chủ đề tự nhập",
    );
  });

  it("tên bài gõ THỪA DẤU CÁCH → gộp lại, không lọt ra tới phụ huynh", async () => {
    const { deriveSessionLabel, deriveSessionTitle } = await import("./session-project-name");
    // Hình dạng THẬT đo trên prod 08/09 — `Lesson.title` của giáo trình đang chạy.
    expect(
      deriveSessionLabel({ sessionNumber: 1, lessonOrder: 4, lessonTitle: "HP1 -   Chiến Xa Tốc Độ" }),
    ).toBe("Buổi 4 - HP1 - Chiến Xa Tốc Độ");
    expect(deriveSessionTitle({ lessonTitle: "HP1 -  Ôn tập kiến thức" })).toBe("Ôn tập kiến thức");
    // Xuống dòng / tab cũng là khoảng trắng — gộp luôn, đừng để rơi vào nhãn.
    expect(deriveSessionTitle({ lessonTitle: "  Robot\tXin\n\nChào  " })).toBe("Robot Xin Chào");
  });

  it("hai tên chỉ khác số dấu cách phải được coi là MỘT", async () => {
    const { meaningfulSessionTitle } = await import("./session-project-name");
    // Quan trọng cho việc ĐẾM lệch: chúng in ra giống hệt nhau, coi là khác là đếm nhầm.
    expect(meaningfulSessionTitle("HP1 -   Chiến Xa Tốc Độ")).toBe(
      meaningfulSessionTitle("HP1 - Chiến Xa Tốc Độ"),
    );
  });

  it("nhãn ghép KHÔNG kèm '(theo lịch)' — sẽ làm vỡ stripSessionNumberPrefix", async () => {
    const { deriveSessionLabel, meaningfulSessionTitle } = await import(
      "./session-project-name"
    );
    const nhan = deriveSessionLabel({ sessionNumber: 7, lessonTitle: "Bài Y" });
    expect(nhan).not.toContain("theo lịch");
    // Và tiền tố vẫn cắt được — đây là điều kiện của cổng phụ huynh.
    expect(meaningfulSessionTitle("Buổi 7 - Bài Y")).toBe("Bài Y");
  });
});
