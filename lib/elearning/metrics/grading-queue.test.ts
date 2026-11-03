// @vitest-environment node
/**
 * EL-15d — chỉ số hàng đợi chấm (M9, M10).
 *
 * Hai chỉ số này là DẤU HIỆU SỚM của quá tải ở phòng Đào tạo (QĐ-CDA-15) — phòng
 * 4/15 nhân sự gánh cả ba vai. Chúng xuất hiện TRƯỚC khi hệ thống có vẻ hỏng, nên
 * một chỉ số nói dối ở đây không làm ai kêu; nó chỉ khiến không ai kêu đúng lúc.
 */
import { describe, it, expect } from "vitest";
import {
  tinhM9,
  tinhM10,
  trungVi,
  hopKhoangCho,
} from "@/lib/elearning/metrics/grading-queue";
import { CANH_BAO_TUOI_CHO_NGAY_LAM } from "@/lib/elearning/metrics/constants";

// 2026-08-24 là thứ Hai (UTC).
const T2 = new Date("2026-08-24T09:00:00.000Z");
const ngay = (n: number) => new Date(T2.getTime() + n * 86_400_000);

describe("M9 — tuân thủ SLA chấm", () => {
  it("đếm bài chấm ĐÚNG HẠN trên tổng đã chấm", () => {
    const r = tinhM9([
      { dueGradeAt: ngay(3), gradedAt: ngay(2) },
      { dueGradeAt: ngay(3), gradedAt: ngay(5) },
    ]);
    expect(r.dungHan).toBe(1);
    expect(r.tong).toBe(2);
    expect(r.tiLe).toBe(0.5);
  });

  it("chấm ĐÚNG khoảnh khắc hạn vẫn tính là đúng hạn", () => {
    const h = ngay(3);
    expect(tinhM9([{ dueGradeAt: h, gradedAt: h }]).tiLe).toBe(1);
  });

  it("🔴 CHƯA CÓ bài nào ⇒ tỉ lệ `null`, KHÔNG phải 0%", () => {
    // Một phòng chưa nhận bài nào mà bảng chỉ số báo "0% tuân thủ" là lời buộc tội
    // sai — và nó nằm trên cùng báo cáo với những con số thật.
    const r = tinhM9([]);
    expect(r.tiLe).toBeNull();
    expect(r.canhBao).toBe(false);
  });

  it("bài CHƯA chấm không vào mẫu số", () => {
    // Mẫu số là "bài đã chấm trong kỳ"; nhét bài đang chờ vào là dìm chỉ số bằng
    // chính việc chưa làm xong, và nó tự sửa khi chấm — tức một con số nhấp nháy.
    const r = tinhM9([
      { dueGradeAt: ngay(3), gradedAt: ngay(2) },
      { dueGradeAt: ngay(3), gradedAt: null },
    ]);
    expect(r.tong).toBe(1);
    expect(r.tiLe).toBe(1);
  });

  it("không có hạn chấm ⇒ tính là đúng hạn, không dìm chỉ số vì dữ liệu cũ", () => {
    // Lượt nộp trước khi có cột `dueGradeAt` không phải lỗi của ai.
    expect(tinhM9([{ dueGradeAt: null, gradedAt: ngay(9) }]).tiLe).toBe(1);
  });

  it("dưới 70% ⇒ bật cảnh báo", () => {
    const ds = [
      { dueGradeAt: ngay(3), gradedAt: ngay(2) },
      { dueGradeAt: ngay(3), gradedAt: ngay(9) },
      { dueGradeAt: ngay(3), gradedAt: ngay(9) },
      { dueGradeAt: ngay(3), gradedAt: ngay(9) },
    ];
    expect(tinhM9(ds).canhBao).toBe(true);
  });
});

describe("M10 — tồn đọng hàng đợi", () => {
  it("đếm số bài đang chờ và số bài QUÁ hạn", () => {
    const r = tinhM10(
      [{ dueGradeAt: ngay(-3) }, { dueGradeAt: ngay(-1) }, { dueGradeAt: ngay(5) }],
      T2,
    );
    expect(r.dangCho).toBe(3);
    expect(r.quaHan).toBe(2);
  });

  it("🔴 công bố KÈM tuổi bài chờ lâu nhất", () => {
    // Mười bài trễ một ngày và một bài trễ ba tuần là hai tình huống khác hẳn nhau,
    // mà phép đếm trần cho ra con số nhỏ hơn ở cái thứ hai.
    const r = tinhM10([{ dueGradeAt: ngay(-30) }, { dueGradeAt: ngay(-1) }], T2);
    expect(r.tuoiLonNhat).toBeGreaterThan(20);
  });

  it("dùng TRUNG VỊ, không phải trung bình", () => {
    // Một bài bị bỏ quên ba tuần kéo trung bình lên và làm cả hàng đợi trông tệ hơn
    // thực tế; hoặc ngược lại, chín bài chấm ngay sẽ giấu mất một bài bị quên.
    const r = tinhM10(
      [{ dueGradeAt: ngay(-1) }, { dueGradeAt: ngay(-1) }, { dueGradeAt: ngay(-40) }],
      T2,
    );
    expect(r.trungViQuaHan).toBe(1);
  });

  it("không bài nào quá hạn ⇒ trung vị 0, không cảnh báo", () => {
    const r = tinhM10([{ dueGradeAt: ngay(5) }], T2);
    expect(r.quaHan).toBe(0);
    expect(r.trungViQuaHan).toBe(0);
    expect(r.canhBao).toBe(false);
  });

  it("🔴 3 bài quá hạn ⇒ cảnh báo", () => {
    const r = tinhM10(
      [{ dueGradeAt: ngay(-1) }, { dueGradeAt: ngay(-1) }, { dueGradeAt: ngay(-1) }],
      T2,
    );
    expect(r.canhBao).toBe(true);
  });

  it("🔴 MỘT bài quá 2× SLA cũng đủ cảnh báo", () => {
    // Một người bị bỏ quên rất lâu là tín hiệu khác với ba người bị bỏ quên một
    // ngày — cả hai đều phải kêu.
    const r = tinhM10([{ dueGradeAt: ngay(-30) }], T2);
    expect(r.tuoiLonNhat).toBeGreaterThan(CANH_BAO_TUOI_CHO_NGAY_LAM);
    expect(r.canhBao).toBe(true);
  });

  it("thiếu hạn chấm ⇒ không tính là quá hạn, nhưng VẪN đếm là đang chờ", () => {
    const r = tinhM10([{ dueGradeAt: null }], T2);
    expect(r.dangCho).toBe(1);
    expect(r.quaHan).toBe(0);
  });
});

describe("trung vị", () => {
  it("mảng lẻ lấy phần tử giữa", () => {
    expect(trungVi([1, 3, 9])).toBe(3);
  });
  it("mảng chẵn lấy trung bình hai phần tử giữa", () => {
    expect(trungVi([1, 2, 4, 9])).toBe(3);
  });
  it("mảng rỗng ⇒ 0, không NaN", () => {
    expect(trungVi([])).toBe(0);
  });
});

describe("🔴 HỢP khoảng chờ — trả nợ bù THỪA", () => {
  it("hai khoảng CHỒNG nhau ⇒ đếm MỘT lần", () => {
    // Hai bài tập cùng nộp một ngày, cùng bị chấm trễ 4 ngày: người học chỉ thực
    // sự mất 4 ngày. Cộng 4 + 4 là nới cả `slaGraceDays`, tức nới luôn phép so
    // đúng-hạn, và một người trễ THẬT có thể thành "đúng hạn".
    const k = { tu: T2, den: ngay(4) };
    expect(hopKhoangCho([k, { ...k }])).toBe(hopKhoangCho([k]));
  });

  it("khoảng chồng MỘT PHẦN ⇒ gộp thành một quãng dài hơn", () => {
    const a = hopKhoangCho([
      { tu: T2, den: ngay(3) },
      { tu: ngay(2), den: ngay(5) },
    ]);
    const b = hopKhoangCho([{ tu: T2, den: ngay(5) }]);
    expect(a).toBe(b);
  });

  it("hai khoảng RỜI nhau ⇒ cộng lại", () => {
    // Chồng nhau mới gộp; rời nhau là hai lần chờ thật.
    const a = hopKhoangCho([
      { tu: T2, den: ngay(2) },
      { tu: ngay(7), den: ngay(9) },
    ]);
    expect(a).toBe(
      hopKhoangCho([{ tu: T2, den: ngay(2) }]) +
        hopKhoangCho([{ tu: ngay(7), den: ngay(9) }]),
    );
  });

  it("khoảng LỒNG trong khoảng khác ⇒ chỉ tính khoảng ngoài", () => {
    const a = hopKhoangCho([
      { tu: T2, den: ngay(10) },
      { tu: ngay(2), den: ngay(4) },
    ]);
    expect(a).toBe(hopKhoangCho([{ tu: T2, den: ngay(10) }]));
  });

  it("thứ tự đầu vào KHÔNG đổi kết quả", () => {
    const x = [
      { tu: ngay(7), den: ngay(9) },
      { tu: T2, den: ngay(2) },
    ];
    expect(hopKhoangCho(x)).toBe(hopKhoangCho([...x].reverse()));
  });

  it("khoảng rỗng hoặc ngược ⇒ bỏ qua, không ra số âm", () => {
    expect(hopKhoangCho([])).toBe(0);
    expect(hopKhoangCho([{ tu: ngay(5), den: T2 }])).toBe(0);
  });

  it("KHÔNG sửa mảng truyền vào", () => {
    const x = [
      { tu: ngay(7), den: ngay(9) },
      { tu: T2, den: ngay(2) },
    ];
    const truoc = JSON.stringify(x);
    hopKhoangCho(x);
    expect(JSON.stringify(x)).toBe(truoc);
  });
});
