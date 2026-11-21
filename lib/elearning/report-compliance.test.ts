// @vitest-environment node
/**
 * EL-06 — báo cáo R1, tuân thủ hạn chót.
 *
 * Báo cáo này đi thẳng lên BGĐ, nên sai ở đây không phải sai một màn hình mà là
 * sai một con số người ta dùng để kết luận về nhân sự.
 *
 * Chỗ dễ sai nhất: năm nhóm của báo cáo KHÔNG trùng một-một với sáu giá trị của
 * `TrnEnrollmentStatus`. Ai đọc nhanh sẽ ánh xạ thẳng và tính nhầm cả hai đầu.
 */
import { describe, it, expect } from "vitest";
import {
  nhanNhom,
  phanNhom,
  tongHopTuanThu,
  soNgayTre,
  buildR1Rows,
  R1_COLUMNS,
  type DongBaoCao,
} from "@/lib/elearning/report-compliance";

const NOW = new Date("2026-08-23T00:00:00.000Z");
const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);

const d = (o: Partial<DongBaoCao> = {}): DongBaoCao => ({
  userId: "u1",
  fullName: "Nguyễn Văn A",
  employeeCode: "NV1",
  departmentName: "Đào tạo",
  managerName: "Trần B",
  status: "IN_PROGRESS",
  source: "ASSIGNMENT",
  progressPercent: 40,
  dueAtOriginal: ngay("2026-09-01"),
  completedAt: null,
  pausedAt: null,
  startedAt: ngay("2026-08-10"),
  ...o,
});

describe("phân nhóm — không ánh xạ thẳng từ `status`", () => {
  it("hoàn thành đúng hạn / trễ theo đúng trạng thái", () => {
    expect(phanNhom(d({ status: "COMPLETED" }))).toBe("DUNG_HAN");
    expect(phanNhom(d({ status: "COMPLETED_LATE" }))).toBe("TRE");
  });

  it("QUÁ HẠN mà đã mở bài ⇒ ĐANG HỌC, không phải CHƯA HỌC", () => {
    // Gộp họ vào "chưa học" là xoá mất khác biệt giữa người đã bắt đầu và người
    // chưa mở lần nào — hai nhóm cần hai cách xử lý khác hẳn.
    expect(phanNhom(d({ status: "OVERDUE", progressPercent: 30 }))).toBe("DANG_HOC");
  });

  it("QUÁ HẠN mà chưa mở bài nào ⇒ CHƯA HỌC", () => {
    expect(
      phanNhom(d({ status: "OVERDUE", progressPercent: 0, startedAt: null })),
    ).toBe("CHUA_HOC");
  });

  it("thu hồi và tạm dừng là hai nhóm RIÊNG", () => {
    expect(phanNhom(d({ status: "REVOKED" }))).toBe("THU_HOI");
    expect(phanNhom(d({ pausedAt: ngay("2026-08-01") }))).toBe("TAM_DUNG");
  });

  it("thu hồi thắng cả tạm dừng", () => {
    expect(phanNhom(d({ status: "REVOKED", pausedAt: ngay("2026-08-01") }))).toBe(
      "THU_HOI",
    );
  });
});

describe("tỉ lệ đúng hạn — mẫu số loại ai", () => {
  it("người bị THU HỒI ra khỏi mẫu số", () => {
    // Tính họ là "chưa hoàn thành" là bịa ra một tỉ lệ tuân thủ tệ hơn sự thật,
    // và người đọc báo cáo sẽ đi hỏi tội nhầm người.
    const t = tongHopTuanThu([
      d({ status: "COMPLETED" }),
      d({ status: "REVOKED" }),
    ]);
    expect(t.daGiao).toBe(2);
    expect(t.tyLeDungHan).toBe(100);
  });

  it("người ĐANG TẠM DỪNG ĐỒNG HỒ cũng ra khỏi mẫu số", () => {
    // Họ đang nghỉ dài, không phải đang trốn học (C4).
    const t = tongHopTuanThu([
      d({ status: "COMPLETED" }),
      d({ pausedAt: ngay("2026-08-01") }),
    ]);
    expect(t.tyLeDungHan).toBe(100);
  });

  it("hoàn thành TRỄ KHÔNG tính vào tử số nhưng VẪN ở mẫu số", () => {
    const t = tongHopTuanThu([d({ status: "COMPLETED" }), d({ status: "COMPLETED_LATE" })]);
    expect(t.tyLeDungHan).toBe(50);
  });

  it("mẫu số bằng 0 ⇒ `null`, KHÔNG phải 0%", () => {
    // "0% tuân thủ" đọc thành thảm hoạ, còn sự thật là chưa có ai để đo.
    const t = tongHopTuanThu([d({ status: "REVOKED" })]);
    expect(t.tyLeDungHan).toBeNull();
  });

  it("danh sách rỗng cũng ra `null`, không chia cho 0", () => {
    expect(tongHopTuanThu([]).tyLeDungHan).toBeNull();
  });

  it("mọi người đều được kể đúng MỘT nhóm", () => {
    const ds = [
      d({ status: "COMPLETED" }),
      d({ status: "COMPLETED_LATE" }),
      d({ status: "OVERDUE", progressPercent: 0, startedAt: null }),
      d({ status: "IN_PROGRESS" }),
      d({ status: "REVOKED" }),
      d({ pausedAt: ngay("2026-08-01") }),
      d({ status: "COMPLETED", source: "EQUIVALENCE" }),
    ];
    const t = tongHopTuanThu(ds);
    const tong =
      t.dungHan + t.tre + t.dangHoc + t.chuaHoc + t.thuHoi + t.tamDung + t.tuongDuong;
    expect(tong).toBe(t.daGiao);
  });
});

describe("EL-09 — công nhận tương đương là nhãn RIÊNG", () => {
  it("`source = EQUIVALENCE` KHÔNG gộp vào Hoàn thành đúng hạn", () => {
    // Lượt này mang `status = COMPLETED`. Gộp vào "đúng hạn" là thổi phồng tỉ lệ
    // tuân thủ bằng những người chưa từng học trong hệ thống này.
    expect(phanNhom(d({ status: "COMPLETED", source: "EQUIVALENCE" }))).toBe("TUONG_DUONG");
  });

  it("ra khỏi MẪU SỐ của tỉ lệ đúng hạn", () => {
    // Luật 3: lượt này không có `dueAtOriginal` nên nó đứng NGOÀI phân hoạch
    // đúng-hạn/trễ. Để trong mẫu số là kéo nó vào một phép đo nó không thuộc về.
    const t = tongHopTuanThu([
      d({ status: "COMPLETED" }),
      d({ status: "COMPLETED", source: "EQUIVALENCE" }),
    ]);
    expect(t.tuongDuong).toBe(1);
    expect(t.tyLeDungHan).toBe(100);
  });

  it("nhãn hiển thị bằng tiếng Việt, tách bạch", () => {
    expect(nhanNhom("TUONG_DUONG")).toBe("Công nhận tương đương");
    expect(nhanNhom("TUONG_DUONG")).not.toContain("Hoàn thành");
  });

  it("thu hồi vẫn thắng, kể cả với lượt tương đương", () => {
    expect(phanNhom(d({ status: "REVOKED", source: "EQUIVALENCE" }))).toBe("THU_HOI");
  });
});

describe("số ngày trễ đo trên hạn GỐC", () => {
  it("chưa xong và đã quá hạn ⇒ đếm tới bây giờ", () => {
    expect(soNgayTre(d({ dueAtOriginal: ngay("2026-08-20") }), NOW)).toBe(3);
  });

  it("đã xong ⇒ đếm tới lúc hoàn thành, không tới bây giờ", () => {
    // Đếm tới bây giờ thì số ngày trễ của một việc đã xong cứ tăng mãi.
    const r = soNgayTre(
      d({ dueAtOriginal: ngay("2026-08-01"), completedAt: ngay("2026-08-05") }),
      NOW,
    );
    expect(r).toBe(4);
  });

  it("đúng hạn hoặc không hạn ⇒ `null`, không phải 0", () => {
    expect(soNgayTre(d({ dueAtOriginal: ngay("2026-12-01") }), NOW)).toBeNull();
    expect(soNgayTre(d({ dueAtOriginal: null }), NOW)).toBeNull();
  });
});

describe("dòng xuất Excel", () => {
  it("dòng đầu là tiêu đề, đủ 9 cột", () => {
    const rows = buildR1Rows([d()], NOW);
    expect(rows[0]).toEqual([...R1_COLUMNS]);
    expect(rows[1]).toHaveLength(9);
  });

  it("ô thiếu dữ liệu để TRỐNG, không ghi chữ `null`", () => {
    // Người đọc Excel lọc theo ô trống; "null" thành một giá trị giả trong bộ lọc.
    const rows = buildR1Rows([d({ departmentName: null, managerName: null })], NOW);
    expect(rows[1]?.[2]).toBe("");
    expect(rows[1]?.[3]).toBe("");
    expect(JSON.stringify(rows)).not.toContain("null");
  });

  it("trạng thái ghi bằng tiếng Việt, không phải mã enum", () => {
    const rows = buildR1Rows([d({ status: "COMPLETED_LATE" })], NOW);
    expect(rows[1]?.[4]).toBe("Hoàn thành trễ");
  });
});
