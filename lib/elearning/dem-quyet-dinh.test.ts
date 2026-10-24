// @vitest-environment node
/**
 * EL-06 — quyết định thuần của cron đêm.
 *
 * Cron chạy 00:47, không ai ngồi xem. Một luật sai ở đây đổi trạng thái hàng
 * loạt mỗi đêm và triệu chứng chỉ hiện ra ở báo cáo cuối tháng — nên case nào
 * cũng hỏi: nếu luật này sai, ai là người chịu và bao giờ mới có người biết?
 */
import { describe, it, expect } from "vitest";
import {
  chonQuaHan,
  chonThuLaiChoDuLieu,
  mocDonTang2,
  mocDonTaiDo,
  chonTaiDoDeHuy,
  type DongQuaHan,
} from "@/lib/elearning/dem-quyet-dinh";

const NOW = new Date("2026-08-23T00:47:00.000Z");
const ngay = (s: string) => new Date(`${s}T00:00:00.000Z`);

const dong = (o: Partial<DongQuaHan> = {}): DongQuaHan => ({
  id: "en1",
  status: "IN_PROGRESS",
  dueAt: ngay("2026-08-01"),
  pausedAt: null,
  ...o,
});

describe("việc (1) — chuyển sang OVERDUE", () => {
  it("chưa bắt đầu / đang học mà quá hạn ⇒ đánh dấu", () => {
    for (const st of ["NOT_STARTED", "IN_PROGRESS"] as const) {
      expect(chonQuaHan([dong({ status: st })], NOW), st).toEqual(["en1"]);
    }
  });

  it("người ĐANG TẠM DỪNG ĐỒNG HỒ không bao giờ quá hạn", () => {
    // Bỏ sót điều kiện này là đánh quá hạn cho người đang nghỉ thai sản hoặc
    // nghỉ ốm dài — họ vào báo cáo tuân thủ như người trốn học, và không ai đối
    // chiếu lại.
    expect(chonQuaHan([dong({ pausedAt: ngay("2026-07-01") })], NOW)).toEqual([]);
  });

  it("bài không có hạn thì không quá hạn", () => {
    expect(chonQuaHan([dong({ dueAt: null })], NOW)).toEqual([]);
  });

  it("hạn còn ở tương lai thì chưa quá hạn", () => {
    expect(chonQuaHan([dong({ dueAt: ngay("2026-12-01") })], NOW)).toEqual([]);
  });

  it("đã xong / đã thu hồi / đã OVERDUE ⇒ không đụng lại", () => {
    // Đánh lại mỗi đêm là ghi một dòng update vô nghĩa cho mỗi người, mỗi ngày.
    for (const st of ["COMPLETED", "COMPLETED_LATE", "REVOKED", "OVERDUE"] as const) {
      expect(chonQuaHan([dong({ status: st })], NOW), st).toEqual([]);
    }
  });

  it("hạn ĐÚNG BẰNG bây giờ thì CHƯA quá hạn", () => {
    // Biên phải nghiêng về phía người học: 17:00:00 là còn hạn, 17:00:01 mới trễ.
    expect(chonQuaHan([dong({ dueAt: NOW })], NOW)).toEqual([]);
  });
});

describe("việc (5) — thử lại hàng đợi chờ dữ liệu Nhân sự", () => {
  const ung = (o: Record<string, unknown> = {}) => ({
    userId: "u1",
    centerId: "cs1",
    existedAt: ngay("2026-01-01"),
    ...o,
  });
  const chay = (o: Record<string, unknown> = {}) =>
    chonThuLaiChoDuLieu({
      ungVien: [ung()],
      daCoGhiDanh: new Set<string>(),
      themDichDanh: new Set<string>(),
      assignmentCreatedAt: ngay("2026-06-01"),
      isStatic: true,
      ...o,
    });

  it("nay đã có cơ sở ⇒ tạo lượt ghi danh", () => {
    expect(chay().taoMoi).toHaveLength(1);
  });

  it("vẫn thiếu cơ sở ⇒ vào nhóm ĐẾM ĐƯỢC, không im lặng bỏ qua", () => {
    // Im lặng bỏ qua nghĩa là người này vắng mặt khỏi mọi báo cáo hết đêm này
    // sang đêm khác mà không có dấu vết nào.
    const r = chay({ ungVien: [ung({ centerId: null })] });
    expect(r.taoMoi).toHaveLength(0);
    expect(r.vanKet).toHaveLength(1);
  });

  it("đã có ghi danh rồi ⇒ bỏ qua hẳn, không kể vào nhóm nào", () => {
    const r = chay({ daCoGhiDanh: new Set(["u1"]) });
    expect(r.taoMoi).toHaveLength(0);
    expect(r.vanKet).toHaveLength(0);
  });

  it("lượt TĨNH: người vào làm SAU ngày tạo lượt giao KHÔNG được kéo vào", () => {
    // Đây là ranh giới giữa TĨNH và ĐỘNG. Chạy lại luật thô mỗi đêm sẽ biến lượt
    // giao đã chốt thành lượt động mà không ai bấm nút.
    const r = chay({ ungVien: [ung({ existedAt: ngay("2026-08-01") })] });
    expect(r.taoMoi).toHaveLength(0);
    expect(r.vanKet).toHaveLength(0);
  });

  it("lượt TĨNH: người được thêm ĐÍCH DANH thì không bị điều kiện đó chặn", () => {
    // Họ được chọn tay nên ý định đã rõ, không cần tái dựng gì.
    const r = chay({
      ungVien: [ung({ existedAt: ngay("2026-08-01") })],
      themDichDanh: new Set(["u1"]),
    });
    expect(r.taoMoi).toHaveLength(1);
  });

  it("lượt ĐỘNG: người mới vào làm được kéo vào bình thường", () => {
    const r = chay({ ungVien: [ung({ existedAt: ngay("2026-08-01") })], isStatic: false });
    expect(r.taoMoi).toHaveLength(1);
  });

  it("không rõ ngày vào làm + lượt TĨNH ⇒ KHÔNG đoán, bỏ qua", () => {
    const r = chay({ ungVien: [ung({ existedAt: null })] });
    expect(r.taoMoi).toHaveLength(0);
  });

  it("chưa có tài khoản cũng vào nhóm đếm được", () => {
    const r = chay({ ungVien: [ung({ userId: null })] });
    expect(r.vanKet).toHaveLength(1);
  });
});

describe("việc (4) — mốc dọn dữ liệu tầng 2", () => {
  it("bản đồ đoạn xem giữ 90 ngày kể từ lần hoạt động cuối", () => {
    expect(mocDonTang2(NOW).bitmapLastActivityTruoc.toISOString()).toBe(
      "2026-05-25T00:47:00.000Z",
    );
  });

  it("nhịp xem dọn theo `purgeAfter` của chính dòng đó, mốc là BÂY GIỜ", () => {
    expect(mocDonTang2(NOW).videoSessionTruoc).toEqual(NOW);
  });

  it("số ngày giữ đổi được, mặc định 90", () => {
    expect(mocDonTang2(NOW, 30).bitmapLastActivityTruoc.toISOString()).toBe(
      "2026-07-24T00:47:00.000Z",
    );
  });
});

describe("EL-10 việc (6) — dọn lượt tải dở", () => {
  const u = (o: Record<string, unknown> = {}) => ({
    key: "elearning/master/l1/x.mp4",
    initiated: ngay("2026-08-01"),
    ...o,
  });

  it("mốc mặc định là 24 giờ trước", () => {
    // Ngắn hơn thì huỷ nhầm lượt đang chạy: người soạn tải 200MB qua mạng chậm
    // có thể mất cả buổi, và huỷ giữa chừng là bắt họ làm lại từ đầu.
    expect(mocDonTaiDo(NOW).toISOString()).toBe("2026-08-22T00:47:00.000Z");
  });

  it("lượt cũ hơn mốc ⇒ huỷ; mới hơn ⇒ giữ", () => {
    const r = chonTaiDoDeHuy(
      [u({ key: "elearning/master/a/1.mp4" }), u({ key: "elearning/master/b/2.mp4", initiated: NOW })],
      mocDonTaiDo(NOW),
    );
    expect(r.huy).toHaveLength(1);
    expect(r.giu).toHaveLength(1);
  });

  it("KHÔNG rõ mốc bắt đầu ⇒ GIỮ, không huỷ liều", () => {
    // Huỷ một lượt có thể đang chạy là làm mất công người soạn; giữ thêm một hôm
    // chỉ tốn vài xu lưu trữ.
    const r = chonTaiDoDeHuy([u({ initiated: null })], mocDonTaiDo(NOW));
    expect(r.huy).toHaveLength(0);
  });

  it("tệp NGOÀI tiền tố `elearning/` không bị đụng tới", () => {
    // Bucket có thể còn tiền tố khác; dọn quá tay là xoá tệp của module khác.
    const r = chonTaiDoDeHuy(
      [u({ key: "uploads/videos/x.mp4" }), u({ key: "scorm/p1/x.zip" })],
      mocDonTaiDo(NOW),
    );
    expect(r.huy).toHaveLength(0);
    expect(r.giu).toHaveLength(2);
  });

  it("danh sách rỗng không lỗi", () => {
    expect(chonTaiDoDeHuy([], mocDonTaiDo(NOW)).huy).toEqual([]);
  });
});
