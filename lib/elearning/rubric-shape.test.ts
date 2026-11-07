// @vitest-environment node
/**
 * EL-15 — hình dạng khung chấm.
 *
 * Khung chấm là THƯỚC ĐO của một bài thực hành đi vào hồ sơ nhân sự. Một cái thước
 * sai không kêu: nó chỉ cho ra những con số trông hợp lý.
 */
import { describe, it, expect } from "vitest";
import {
  dsMucSchema,
  kiemKhung,
  tinhDiemBaiNop,
  tongDiemToiDa,
  type Muc,
} from "@/lib/elearning/rubric-shape";

const MUC = (...diem: number[]): Muc[] =>
  diem.map((p, i) => ({ label: `Mức ${i + 1}`, points: p }));

describe("mức của một tiêu chí", () => {
  it("🔴 phải có ít nhất HAI mức", () => {
    // Một tiêu chí một mức là điểm cộng vô điều kiện: bài nào cũng được, và thang
    // điểm nói dối đúng bằng số điểm đó.
    expect(dsMucSchema.safeParse(MUC(10)).success).toBe(false);
    expect(dsMucSchema.safeParse(MUC(0, 10)).success).toBe(true);
  });

  it("🔴 điểm các mức phải TĂNG DẦN", () => {
    // Người chấm đọc từ trên xuống và hiểu "càng xuống càng tốt". Xếp lộn thì họ
    // chọn nhầm mức mà không nhận ra.
    expect(dsMucSchema.safeParse(MUC(0, 5, 10)).success).toBe(true);
    expect(dsMucSchema.safeParse(MUC(0, 10, 5)).success).toBe(false);
    // Hai mức BẰNG điểm cũng không được: chọn mức nào cũng thế thì mức là trang trí.
    expect(dsMucSchema.safeParse(MUC(0, 5, 5)).success).toBe(false);
  });

  it("mức không tên ⇒ từ chối", () => {
    const r = dsMucSchema.safeParse([
      { label: "  ", points: 0 },
      { label: "Tốt", points: 10 },
    ]);
    expect(r.success).toBe(false);
  });
});

describe("tổng điểm tối đa = tổng mức CAO NHẤT từng tiêu chí", () => {
  it("cộng đúng", () => {
    expect(
      tongDiemToiDa([{ levels: MUC(0, 30) }, { levels: MUC(0, 20, 40) }]),
    ).toBe(70);
  });

  it("không phụ thuộc THỨ TỰ mức trong mảng", () => {
    // Dựa vào "phần tử cuối là cao nhất" là dựa vào một luật khác (thứ tự tăng dần)
    // để tính một con số — hai luật buộc vào nhau, và luật kia sửa được ở chỗ khác.
    expect(tongDiemToiDa([{ levels: MUC(40, 10) }])).toBe(40);
  });
});

describe("🔴 kiểm khung TRƯỚC khi kích hoạt", () => {
  const OK = {
    totalPoints: 100,
    passPoints: 80,
    tieuChi: [{ levels: MUC(0, 30, 60) }, { levels: MUC(0, 20, 40) }],
  };

  it("khung hợp lệ ⇒ không lỗi nào", () => {
    expect(kiemKhung(OK)).toEqual([]);
  });

  it("🔴 tổng điểm tiêu chí LỆCH thang của khung ⇒ báo, kèm cả hai con số", () => {
    // Khung ghi "trên 100" nhưng làm hết sức chỉ được 85 thì ngưỡng đạt 80 thành
    // gần-như-tuyệt-đối, mà không ai cố ý đặt ra thế.
    const loi = kiemKhung({ ...OK, totalPoints: 120 });
    expect(loi[0]!.ma).toBe("TONG_DIEM_LECH");
    expect(loi[0]!.noi).toContain("100");
    expect(loi[0]!.noi).toContain("120");
  });

  it("🔴 ngưỡng đạt VƯỢT thang ⇒ báo — không ai qua được", () => {
    const loi = kiemKhung({ ...OK, passPoints: 200 });
    expect(loi.some((l) => l.ma === "NGUONG_VUOT_THANG")).toBe(true);
  });

  it("khung RỖNG ⇒ báo đúng một lỗi, không kèm lỗi rác", () => {
    // Mọi con số khác đều vô nghĩa khi chưa có tiêu chí nào; liệt kê thêm chỉ làm
    // người soạn đi sửa những chỗ không phải nguyên nhân.
    const loi = kiemKhung({ totalPoints: 100, passPoints: 80, tieuChi: [] });
    expect(loi).toHaveLength(1);
    expect(loi[0]!.ma).toBe("KHONG_CO_TIEU_CHI");
  });

  it("nhiều lỗi ⇒ trả HẾT trong một lượt", () => {
    // Bấm lưu năm lần để lộ ra năm lỗi là cách chắc chắn khiến người ta bỏ dở.
    const loi = kiemKhung({ ...OK, totalPoints: 120, passPoints: 200 });
    expect(loi.map((l) => l.ma).sort()).toEqual([
      "NGUONG_VUOT_THANG",
      "TONG_DIEM_LECH",
    ]);
  });

  it("ngưỡng BẰNG thang thì cho qua — khắt khe nhưng có chủ đích", () => {
    expect(kiemKhung({ ...OK, passPoints: 100 })).toEqual([]);
  });
});

describe("🔴 cộng điểm một lượt nộp", () => {
  it("chấm đủ ⇒ ra tổng và kết luận đạt/không", () => {
    expect(tinhDiemBaiNop({ diem: [60, 25], passPoints: 80 })).toEqual({
      tong: 85,
      dat: true,
      conThieu: 0,
    });
    expect(tinhDiemBaiNop({ diem: [30, 25], passPoints: 80 }).dat).toBe(false);
  });

  it("🔴 còn MỘT tiêu chí chưa chấm ⇒ tổng và kết luận đều `null`", () => {
    // Cộng tạm phần đã chấm rồi so ngưỡng là chốt TRƯỢT cho người mà một phần bài
    // của họ chưa ai đọc — và con số đó hiện trên báo cáo tuân thủ như một sự thật.
    const r = tinhDiemBaiNop({ diem: [60, null], passPoints: 80 });
    expect(r.tong).toBeNull();
    expect(r.dat).toBeNull();
    expect(r.conThieu).toBe(1);
  });

  it("điểm 0 KHÁC chưa chấm", () => {
    // `0` = đã đọc và không cho điểm; `null` = chưa ai đọc. Gộp là đóng sổ trượt
    // cho người chưa được chấm.
    const r = tinhDiemBaiNop({ diem: [0, 0], passPoints: 80 });
    expect(r.tong).toBe(0);
    expect(r.dat).toBe(false);
    expect(r.conThieu).toBe(0);
  });

  it("đúng BẰNG ngưỡng là ĐẠT", () => {
    expect(tinhDiemBaiNop({ diem: [80], passPoints: 80 }).dat).toBe(true);
    expect(tinhDiemBaiNop({ diem: [79], passPoints: 80 }).dat).toBe(false);
  });

  it("không tiêu chí nào ⇒ tổng 0, KHÔNG ném", () => {
    // Không nên xảy ra (cổng kích hoạt đã chặn), nhưng ném ở đây là làm chết màn
    // chấm vì một khung hỏng, thay vì cho người chấm thấy và báo lại.
    expect(tinhDiemBaiNop({ diem: [], passPoints: 80 }).tong).toBe(0);
  });
});
