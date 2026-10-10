// @vitest-environment node
/**
 * BÙ HẠN khi NGƯỜI CHẤM trễ.
 *
 * Hỏng ở đây không làm vỡ gì — nó chỉ khiến một người bị ghi là TRỄ trong báo cáo
 * gửi quản lý trực tiếp, vì lỗi của người khác. Đó là loại lỗi không ai đi báo, vì
 * người chịu thiệt không biết mình đang chịu thiệt.
 */
import { describe, it, expect } from "vitest";
import { tinhBuSla, hanSauKhiBu } from "@/lib/elearning/sla-bu";
import { hanCoMienTru, cuonTienDoKhoa } from "@/lib/elearning/course-completion";

// 2026-08-24 là thứ Hai (UTC).
const T2 = new Date("2026-08-24T09:00:00.000Z");
const ngay = (n: number) => new Date(T2.getTime() + n * 86_400_000);
const THU = (d: Date | null) =>
  d ? ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d.getUTCDay()]! : "—";

const so = (daBuNgayLam: number) => ({ daBuNgayLam });

describe("chấm ĐÚNG HẠN thì không bù gì", () => {
  it("chấm trước hạn ⇒ 0", () => {
    const r = tinhBuSla({
      dueGradeAt: ngay(3),
      gradedAt: ngay(2),
      now: ngay(9),
      so: so(0),
    });
    expect(r.themNgayLam).toBe(0);
  });

  it("chấm ĐÚNG khoảnh khắc hạn ⇒ 0, không bù một ngày lẻ", () => {
    const h = ngay(3);
    expect(
      tinhBuSla({ dueGradeAt: h, gradedAt: h, now: ngay(9), so: so(0) }).themNgayLam,
    ).toBe(0);
  });

  it("chưa chấm nhưng CHƯA tới hạn ⇒ 0", () => {
    expect(
      tinhBuSla({
        dueGradeAt: ngay(5),
        gradedAt: null,
        now: ngay(2),
        so: so(0),
      }).themNgayLam,
    ).toBe(0);
  });
});

describe("🔴 chấm TRỄ thì bù đúng số NGÀY LÀM VIỆC đã chờ", () => {
  it("đo tới `gradedAt` khi đã chấm", () => {
    // T2 24/8 là hạn chấm; chấm vào T5 27/8 ⇒ chờ 3 ngày làm việc.
    const r = tinhBuSla({
      dueGradeAt: T2,
      gradedAt: ngay(3),
      now: ngay(30),
      so: so(0),
    });
    expect(r.themNgayLam).toBe(3);
  });

  it("🔴 KHÔNG tiếp tục bù cho lượt đã chấm xong từ lâu", () => {
    // Đo tới `now` là bù cho một khoảng chờ KHÔNG CÒN xảy ra nữa — hạn của người
    // học sẽ trôi ra mãi sau khi bài họ đã được chấm.
    const daChamSom = tinhBuSla({
      dueGradeAt: T2,
      gradedAt: ngay(1),
      now: ngay(60),
      so: so(0),
    });
    expect(daChamSom.themNgayLam).toBe(1);
  });

  it("chưa chấm ⇒ đo tới BÂY GIỜ, và lớn dần mỗi ngày", () => {
    const a = tinhBuSla({ dueGradeAt: T2, gradedAt: null, now: ngay(3), so: so(0) });
    const b = tinhBuSla({ dueGradeAt: T2, gradedAt: null, now: ngay(4), so: so(0) });
    expect(a.themNgayLam).toBe(3);
    expect(b.themNgayLam).toBe(4);
  });

  it("cuối tuần KHÔNG tính là ngày chờ", () => {
    // Người chấm không nợ ai hai ngày nghỉ. Hạn T6 28/8, chấm T2 31/8 ⇒ 1 ngày làm.
    const r = tinhBuSla({
      dueGradeAt: ngay(4),
      gradedAt: ngay(7),
      now: ngay(30),
      so: so(0),
    });
    expect(THU(ngay(4))).toBe("T6");
    expect(THU(ngay(7))).toBe("T2");
    expect(r.themNgayLam).toBe(1);
  });
});

describe("🔴 SỔ — cron chạy mỗi đêm mà không bù chồng", () => {
  it("đã bù đủ ⇒ lần sau thêm 0", () => {
    // Không có sổ thì đêm nào cũng cộng thêm một lần cho cùng một lượt nộp, hạn
    // trôi ra vô hạn, và không ai thấy vì cron không ghi audit.
    const r = tinhBuSla({
      dueGradeAt: T2,
      gradedAt: ngay(3),
      now: ngay(9),
      so: so(3),
    });
    expect(r.tongDangLe).toBe(3);
    expect(r.themNgayLam).toBe(0);
  });

  it("bù dở dang ⇒ chỉ thêm phần CÒN THIẾU", () => {
    const r = tinhBuSla({
      dueGradeAt: T2,
      gradedAt: ngay(4),
      now: ngay(9),
      so: so(2),
    });
    expect(r.tongDangLe).toBe(4);
    expect(r.themNgayLam).toBe(2);
  });

  it("🔴 sổ ghi NHIỀU hơn thực tế ⇒ KHÔNG rút hạn về", () => {
    // Rút lại một khoản đã cho là đổi hạn của người ta theo chiều xấu đi, sau khi
    // họ đã nhìn thấy hạn mới và lên kế hoạch theo nó.
    const r = tinhBuSla({
      dueGradeAt: T2,
      gradedAt: ngay(1),
      now: ngay(9),
      so: so(10),
    });
    expect(r.themNgayLam).toBe(0);
  });
});

describe("không có hạn chấm", () => {
  it("⇒ không bù, không ném", () => {
    const r = tinhBuSla({
      dueGradeAt: null,
      gradedAt: null,
      now: ngay(30),
      so: so(0),
    });
    expect(r.themNgayLam).toBe(0);
  });
});

describe("hạn MỚI sau khi bù", () => {
  it("cộng bằng NGÀY LÀM VIỆC, không phải ngày lịch", () => {
    // Chờ 5 ngày làm việc mà bù 5 ngày lịch là bù THIẾU 2 ngày, và người học vẫn
    // chịu một phần hậu quả của việc người chấm chậm.
    const h = hanSauKhiBu(ngay(4), 3); // từ T6 28/8
    expect(THU(h)).toBe("T4");
    expect(h!.toISOString().slice(0, 10)).toBe("2026-09-02");
  });

  it("bù 0 ⇒ giữ nguyên hạn, không đụng gì", () => {
    const h = ngay(4);
    expect(hanSauKhiBu(h, 0)).toBe(h);
  });

  it("không có hạn ⇒ vẫn không có hạn", () => {
    expect(hanSauKhiBu(null, 5)).toBeNull();
  });
});

describe("🔴 vế THỨ HAI — cứu chỉ số đúng-hạn", () => {
  // Thiếu vế này thì vế nới hạn VÔ NGHĨA: `cuonTienDoKhoa` phân biệt COMPLETED với
  // COMPLETED_LATE bằng `dueAtOriginal` bất biến.
  const nen = {
    soBaiBatBuoc: 1,
    soBaiDaXong: 1,
    statusHienTai: "IN_PROGRESS",
    dueAtOriginal: T2,
  };

  it("KHÔNG có miễn trừ: học xong sau hạn gốc ⇒ TRỄ", () => {
    const r = cuonTienDoKhoa({ ...nen, now: ngay(3) });
    expect(r.status).toBe("COMPLETED_LATE");
    expect(r.isLate).toBe(true);
  });

  it("🔴 CÓ miễn trừ đủ lớn ⇒ ĐÚNG HẠN", () => {
    // Người bị người chấm bỏ quên 3 ngày làm việc, được bù, học xong — không còn
    // bị đếm là trễ trên báo cáo gửi quản lý trực tiếp.
    const r = cuonTienDoKhoa({ ...nen, now: ngay(3), slaGraceDays: 3 });
    expect(r.status).toBe("COMPLETED");
    expect(r.isLate).toBe(false);
  });

  it("miễn trừ KHÔNG đủ ⇒ vẫn trễ, không tha bổng vô điều kiện", () => {
    const r = cuonTienDoKhoa({ ...nen, now: ngay(10), slaGraceDays: 1 });
    expect(r.status).toBe("COMPLETED_LATE");
  });

  it("miễn trừ 0 hoặc bỏ trống ⇒ hành vi Y HỆT trước", () => {
    // Thêm tham số này không được đổi một con số nào của khoá không có bài chấm tay.
    const khong = cuonTienDoKhoa({ ...nen, now: ngay(3) });
    const soKhong = cuonTienDoKhoa({ ...nen, now: ngay(3), slaGraceDays: 0 });
    expect(soKhong).toEqual(khong);
  });

  it("🔴 `dueAtOriginal` KHÔNG bị ghi lại — miễn trừ là khoản CỘNG bên cạnh", () => {
    // Hàm thuần nên không ghi gì; kiểm bằng cách khẳng định phép cộng nằm ở hàm
    // riêng và mốc gốc truyền vào không đổi.
    const goc = new Date(T2.getTime());
    hanCoMienTru(goc, 5);
    expect(goc.getTime()).toBe(T2.getTime());
    expect(THU(hanCoMienTru(T2, 5))).toBe("T2");
  });

  it("đã ghi COMPLETED_LATE thì miễn trừ KHÔNG nâng ngược lên", () => {
    // "Đã trễ" là một sự thật đã ghi nhận; nâng cấp âm thầm là xoá nó.
    const r = cuonTienDoKhoa({
      ...nen,
      statusHienTai: "COMPLETED_LATE",
      now: ngay(3),
      slaGraceDays: 10,
    });
    expect(r.status).toBe("COMPLETED_LATE");
  });
});
