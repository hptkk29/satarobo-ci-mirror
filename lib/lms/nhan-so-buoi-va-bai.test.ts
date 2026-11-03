/**
 * Đợt 1c — khoá 5 nơi in `"Buổi N"` TRẦN, mỗi nơi một ca dựng **hình dạng Sata6**.
 *
 * Hình dạng đó (đo prod `CS2.SATA6.26.001` ngày 08/09): lớp sinh 48 buổi toàn Thứ 7 mang bài
 * 1..48 đúng thứ tự, rồi **6 buổi mang bài 43–48 bị DỜI NGÀY** lên các Thứ 5 tháng 6–7. Bộ
 * dời ngày không đụng `lessonId`, còn "buổi thứ mấy" thì tính lại theo ngày mỗi lần render —
 * nên buổi 25/06 có **hạng theo ngày = 2** trong khi nó dạy **bài 43**.
 *
 * Mỗi ca dưới đây khẳng định HAI vế cùng lúc, vì bỏ vế nào cũng mất ý nghĩa:
 *   · số IN RA đúng theo loại mà nơi đó cần (lộ trình / theo lịch / cả hai);
 *   · VỊ TRÍ trong danh sách vẫn theo NGÀY.
 *
 * ⚠️ Không phải cả 5 nơi đều cần số lộ trình — xem bảng phân loại trong từng ca. Mặc định
 * "tất cả là lộ trình" là dựng lại đúng kiểu nhập nhằng đã đẻ ra sự cố, chỉ theo chiều ngược.
 */
import { describe, it, expect } from "vitest";

import {
  buildSessionNumberMap,
  nhanSoBuoi,
  nhanSoBuoiVaBai,
  soBuoiTheoLoTrinh,
  sortSessionsForWork,
} from "./session-order";

/** 48 buổi: bài 1..42 trên các Thứ 7; bài 43..48 bị dời lên Thứ 5 tháng 6–7. */
function dungSata6() {
  const out: { id: string; classId: string; date: Date; planOrder: number }[] = [];
  for (let i = 0; i < 42; i++) {
    out.push({
      id: `t7-${String(i).padStart(2, "0")}`,
      classId: "c1",
      date: new Date(Date.UTC(2026, 5, 20 + i * 7, 3, 0)),
      planOrder: i,
    });
  }
  for (let k = 0; k < 6; k++) {
    out.push({
      id: `t5-${k}`,
      classId: "c1",
      date: new Date(Date.UTC(2026, 5, 25 + k * 7, 3, 0)),
      planOrder: 42 + k,
    });
  }
  return out;
}

const BUOI = dungSata6();
const SO_LICH = buildSessionNumberMap(BUOI);

/** Buổi 25/06 — hạng theo ngày 2, bài 43. Đây là ca chủ dự án báo. */
const DOI_NGAY = BUOI.find((b) => b.id === "t5-0")!;
const soLich = SO_LICH.get(DOI_NGAY.id)!;
const soLoTrinh = soBuoiTheoLoTrinh({ planOrder: DOI_NGAY.planOrder })!;

describe("[1c] hình dạng Sata6 — hai con số thật sự lệch", () => {
  it("buổi 25/06: hạng theo ngày 2, bài 43", () => {
    expect(soLich).toBe(2);
    expect(soLoTrinh).toBe(43);
  });

  it("vị trí trong danh sách vẫn theo NGÀY, không theo bài", () => {
    const xep = sortSessionsForWork(
      BUOI.map((b) => ({ b })),
      (r) => ({ thoiGian: r.b.date.getTime(), complete: false }),
    ).map((r) => r.b.id);
    expect(xep[0]).toBe("t7-00"); // 20/06
    expect(xep[1]).toBe("t5-0"); // 25/06 — bài 43 nhưng ĐỨNG THỨ HAI
    expect(xep[2]).toBe("t7-01"); // 27/06
  });
});

describe("[1c-1] class-feedback-panel — cột 'Buổi (lịch)' cần số THEO LỊCH", () => {
  // Bảng này sắp theo NGÀY và có cột "Bài / chủ đề" ngay bên phải mang số LỘ TRÌNH
  // (`Bài {lesson.order}: {title}`). Hai cột trả lời hai câu khác nhau nên KHÔNG gộp —
  // nhưng cột trái phải TỰ KHAI là số theo lịch, kẻo đứng cạnh "Bài 43" đọc như lỗi.
  it("in số theo lịch VÀ nói rõ nó là số theo lịch", () => {
    expect(nhanSoBuoi({ lich: soLich, loTrinh: null })).toBe("Buổi 2 (theo lịch)");
  });

  it("KHÔNG in số lộ trình ở cột này — sẽ trùng hệt cột 'Bài' bên cạnh", () => {
    const cotTrai = nhanSoBuoi({ lich: soLich, loTrinh: null });
    const cotPhai = `Bài ${soLoTrinh}: HP4 - Chạy tổng hợp nhiệm vụ`;
    expect(cotTrai).not.toContain(String(soLoTrinh));
    expect(cotPhai).toContain(String(soLoTrinh));
  });
});

describe("[1c-2,3,4] hai ô chọn buổi + danh sách quản lý buổi — cần CẢ HAI số", () => {
  // Ba nơi này sắp theo NGÀY. In số lộ trình ở đầu dòng là danh sách nhảy cóc
  // `1, 43, 2, 44…`; chỉ in số theo lịch thì giấu mất bài đang dạy.
  it("hai số LỆCH → in cả hai", () => {
    expect(nhanSoBuoiVaBai({ lich: soLich, loTrinh: soLoTrinh })).toBe("Buổi 2 · bài 43");
  });

  it("hai số TRÙNG → nói một lần, không rác", () => {
    // In `Buổi 7 · bài 7` ở mọi dòng là rác, và rác thì người ta thôi đọc — rồi thôi đọc
    // luôn dòng thật sự lệch.
    const dau = BUOI.find((b) => b.id === "t7-00")!;
    const l = SO_LICH.get(dau.id)!;
    const b = soBuoiTheoLoTrinh({ planOrder: dau.planOrder })!;
    expect(l).toBe(b);
    expect(nhanSoBuoiVaBai({ lich: l, loTrinh: b })).toBe(`Buổi ${l}`);
  });

  it("⚠️ trong hình dạng Sata6, buổi Thứ 7 KHÔNG còn trùng số từ buổi thứ hai trở đi", () => {
    // Sáu buổi Thứ 5 (bài 43–48) xen vào giữa các Thứ 7 đầu, nên `t7-06` mang bài 7 mà
    // hạng theo ngày đã là 13. Ghi lại vì lúc viết ca trên tôi đã tưởng chúng trùng —
    // fixture mang hình dạng thật thì nó sửa mình ngay, đó là lý do không dùng dữ liệu tròn.
    const t7_06 = BUOI.find((b) => b.id === "t7-06")!;
    expect(SO_LICH.get(t7_06.id)).toBe(13);
    expect(soBuoiTheoLoTrinh({ planOrder: t7_06.planOrder })).toBe(7);
    expect(nhanSoBuoiVaBai({ lich: 13, loTrinh: 7 })).toBe("Buổi 13 · bài 7");
  });

  it("thứ tự danh sách KHÔNG đổi vì nhãn — số đầu dòng vẫn tăng đều theo ngày", () => {
    const theoNgay = BUOI.slice().sort((a, b) => a.date.getTime() - b.date.getTime());
    const soDauDong = theoNgay.map((b) => SO_LICH.get(b.id)!);
    for (let i = 1; i < soDauDong.length; i++) {
      expect(soDauDong[i]!).toBe(soDauDong[i - 1]! + 1);
    }
  });

  it("lớp chưa ghim giáo trình → chỉ có số theo lịch, và nhãn tự khai", () => {
    expect(nhanSoBuoiVaBai({ lich: 7, loTrinh: null })).toBe("Buổi 7 (theo lịch)");
  });
});

describe("[1c-5] teacher/lop — tiêu đề MỘT buổi cần số LỘ TRÌNH", () => {
  // Khác ba nơi trên: đây không phải danh sách. Giáo viên mở trang này để DẠY buổi đó,
  // nên con số phải trả lời "bài nào", không phải "buổi thứ mấy theo lịch".
  it("in bài 43, KHÔNG in buổi 2", () => {
    const nhan = nhanSoBuoi({ loTrinh: soLoTrinh, lich: soLich });
    expect(nhan).toBe("Buổi 43");
    expect(nhan).not.toContain("Buổi 2");
  });

  it("lớp chưa ghim giáo trình → lùi về số theo lịch và NÓI RÕ", () => {
    expect(nhanSoBuoi({ loTrinh: null, lich: soLich })).toBe("Buổi 2 (theo lịch)");
  });

  it("không tra được gì → trả dấu gạch để chỗ gọi tự bỏ khỏi tiêu đề", () => {
    expect(nhanSoBuoi({ loTrinh: null, lich: null })).toBe("—");
  });
});
