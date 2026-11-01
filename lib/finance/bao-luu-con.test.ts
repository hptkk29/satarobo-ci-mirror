// lib/finance/bao-luu-con.test.ts — LUẬT DỜI HẠN KHI BẢO LƯU. THUẦN, không DB.
//
// Số của bộ này lấy từ TS-39 (`docs/thanh-toan-linh-hoat/05-TestScenarios…`):
//   *"Bình bảo lưu 30 ngày khi Đợt 2 còn 10 ngày tới hạn … hạn Đợt 2 dời 30 ngày; ngày 15
//   không QUA_HAN"*.
import { describe, expect, it } from "vitest";
import {
  coViecPhaiLam,
  dongNaoDangBaoLuu,
  keHoachDoiHan,
  soNgayBaoLuu,
  type DotDeDoiHan,
} from "./bao-luu-con";

/** Mốc bảo lưu của TS-39 — giữa buổi chiều giờ VN (10:00Z = 17:00 VN). */
const BAT_DAU = new Date("2026-09-22T10:00:00Z");
/** Ngày dự kiến quay lại từ ô chọn ngày — NỬA ĐÊM. Đây là nguồn của bẫy làm tròn. */
const QUAY_LAI = new Date("2026-10-22T00:00:00Z");
const RESERVE = "res-binh-01";

const dot = (p: Partial<DotDeDoiHan> & { id: string }): DotDeDoiHan => ({
  installmentNo: 1,
  dueDate: null,
  status: "PENDING",
  pauseShiftReserveId: null,
  pauseShiftDays: null,
  ...p,
});

/** Đợt 2 còn 10 ngày tới hạn tính từ mốc bảo lưu. */
const DOT_2 = dot({
  id: "pr-2",
  installmentNo: 2,
  dueDate: new Date("2026-10-02T00:00:00Z"),
  status: "PENDING",
});

const ke = (ds: readonly DotDeDoiHan[], them: Partial<Parameters<typeof keHoachDoiHan>[0]> = {}) =>
  keHoachDoiHan({
    dot: ds,
    startedAt: BAT_DAU,
    expectedEndAt: QUAY_LAI,
    reserveId: RESERVE,
    moc: BAT_DAU,
    ...them,
  });

describe("[BLC] số ngày bảo lưu — đếm theo NGÀY LỊCH giờ VN", () => {
  it("[BLC-01] 22/09 → 22/10 ra ĐÚNG 30, bấm giờ nào trong ngày cũng vậy", () => {
    // ⚠️ Ca then chốt của cả cụm. Hiệu mili giây giữa hai mốc này là 29,58 ngày:
    // `Math.floor` ra 29, và người vận hành gõ "30 ngày" sẽ nhận 29. Đếm theo ngày lịch
    // cho ra 30 ở MỌI giờ bấm nút — đó là lý do hàm không dùng hiệu mili giây.
    for (const gio of ["00:30", "10:00", "16:59"]) {
      expect(soNgayBaoLuu(new Date(`2026-09-22T${gio}:00Z`), QUAY_LAI)).toBe(30);
    }
  });

  it("[BLC-02] lấy NGÀY VN, không ngày UTC — 17:30Z đã là hôm sau ở Việt Nam", () => {
    // 2026-09-22T17:30Z = 23/09 00:30 giờ VN ⇒ chỉ còn 29 ngày tới 22/10.
    // Đếm theo UTC sẽ ra 30 và dời hạn thừa một ngày cho mọi lượt bảo lưu buổi tối.
    expect(soNgayBaoLuu(new Date("2026-09-22T17:30:00Z"), QUAY_LAI)).toBe(29);
  });

  it("[BLC-03] không khai ngày quay lại, hoặc ngày không sau ngày bắt đầu ⇒ 0", () => {
    expect(soNgayBaoLuu(BAT_DAU, null)).toBe(0);
    expect(soNgayBaoLuu(BAT_DAU, BAT_DAU)).toBe(0);
    expect(soNgayBaoLuu(BAT_DAU, new Date("2026-09-01T00:00:00Z"))).toBe(0);
  });
});

describe("[BLC] đợt nào được dời hạn", () => {
  it("[BLC-04] TS-39: đợt 2 chưa tới hạn ⇒ dời đúng 30 ngày, GIỮ giờ-phút của hạn cũ", () => {
    const r = ke([DOT_2]);
    expect(r.soNgay).toBe(30);
    expect(r.doi).toHaveLength(1);
    expect(r.doi[0]!.hanMoi.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(r.doi[0]!.tongNgayDaDoi).toBe(30);
    expect(r.boQua).toHaveLength(0);
  });

  it("[BLC-05] đợt ĐÃ QUÁ HẠN trước lúc bảo lưu ⇒ KHÔNG dời", () => {
    // ⚠️ Quyết định, không phải sơ suất. AC2 nói "đợt CHƯA TỚI HẠN dời hạn". Bảo lưu giữ
    // đồng hồ lại từ HÔM NAY; nó không xoá việc phụ huynh đã trễ từ tuần trước. Dời cả đợt
    // đã trễ là âm thầm tha một khoản nợ trễ, và sổ không còn chỗ nào nhớ là nó từng trễ.
    const r = ke([dot({ id: "pr-1", dueDate: new Date("2026-09-10T00:00:00Z") })]);
    expect(r.doi).toHaveLength(0);
    expect(r.boQua).toEqual([{ id: "pr-1", installmentNo: 1, vi: "DA_QUA_HAN_TRUOC" }]);
  });

  it("[BLC-06] đợt PAID / VOID / không có hạn ⇒ KHÔNG dời, và nói rõ VÌ SAO", () => {
    const r = ke([
      dot({ id: "pr-paid", dueDate: new Date("2026-10-02T00:00:00Z"), status: "PAID" }),
      dot({ id: "pr-void", dueDate: new Date("2026-10-02T00:00:00Z"), status: "VOID" }),
      dot({ id: "pr-nohan", dueDate: null }),
    ]);
    expect(r.doi).toHaveLength(0);
    // Lý do phải ĐÚNG từng cái, không gộp thành một nhãn chung: màn hình và nhật ký đọc nó,
    // và "không dời" với "không có gì để dời" là hai câu trả lời khác nhau cho kế toán.
    expect(r.boQua.map((b) => b.vi)).toEqual(["DA_XONG", "DA_XONG", "KHONG_CO_HAN"]);
  });

  it("[BLC-07] đợt PARTIAL (đã rót một phần) VẪN được dời", () => {
    // Trả thiếu là đúng ca mà cron đối soát báo quá hạn, tức đúng ca AC2 sinh ra để che.
    const r = ke([dot({ ...DOT_2, id: "pr-partial", status: "PARTIAL" })]);
    expect(r.doi).toHaveLength(1);
  });

  it("[BLC-08] CHỐNG DỜI HAI LẦN: chính lượt bảo lưu này đã dời rồi ⇒ bỏ qua", () => {
    const r = ke([dot({ ...DOT_2, pauseShiftReserveId: RESERVE, pauseShiftDays: 30 })]);
    expect(r.doi).toHaveLength(0);
    expect(r.boQua[0]!.vi).toBe("DA_DOI_ROI");
  });

  it("[BLC-09] lượt bảo lưu KHÁC đã dời trước đó ⇒ dời tiếp, số ngày CỘNG DỒN", () => {
    // Bé bảo lưu lần hai. Hạn đã mang +30 của lần trước; lần này +30 nữa ⇒ đợt ghi 60.
    const r = ke([dot({ ...DOT_2, pauseShiftReserveId: "res-cu", pauseShiftDays: 30 })]);
    expect(r.doi).toHaveLength(1);
    expect(r.doi[0]!.tongNgayDaDoi).toBe(60);
  });

  it("[BLC-10] không khai ngày quay lại ⇒ soNgay 0 và KHÔNG CÓ VIỆC PHẢI LÀM", () => {
    // ⚠️ `doi` vẫn có phần tử (hạn mới = hạn cũ). Người gọi hỏi `doi.length > 0` sẽ ghi một
    // lượt UPDATE không đổi gì kèm một dòng nhật ký nói rằng có dời — sổ nói dối một chuyện
    // vô hại, đúng loại dối khó gỡ nhất về sau. `coViecPhaiLam` là câu hỏi đúng.
    const r = ke([DOT_2], { expectedEndAt: null });
    expect(r.soNgay).toBe(0);
    expect(r.doi).toHaveLength(1);
    expect(r.doi[0]!.hanMoi.getTime()).toBe(r.doi[0]!.hanCu.getTime());
    expect(coViecPhaiLam(r)).toBe(false);
  });

  it("[BLC-11] có việc phải làm khi VÀ CHỈ KHI có ngày quay lại + có đợt đủ điều kiện", () => {
    expect(coViecPhaiLam(ke([DOT_2]))).toBe(true);
    expect(coViecPhaiLam(ke([dot({ id: "x", dueDate: null })]))).toBe(false);
    expect(coViecPhaiLam(ke([]))).toBe(false);
  });
});

describe("[BLC] dòng nào thuộc con đang bảo lưu", () => {
  const DONG = [
    { orderItemId: "oi-binh-sata3", enrollmentId: "en-b3", studentId: "hv-binh" },
    { orderItemId: "oi-binh-robosim", enrollmentId: "en-b4", studentId: "hv-binh" },
    { orderItemId: "oi-an", enrollmentId: "en-a1", studentId: "hv-an" },
    { orderItemId: "oi-chua-ghi-danh", enrollmentId: null, studentId: null },
  ];
  const luot = (enrollmentId: string | null) => [
    {
      id: RESERVE,
      studentId: "hv-binh",
      enrollmentId,
      startedAt: BAT_DAU,
      expectedEndAt: QUAY_LAI,
    },
  ];

  it("[BLC-12] bảo lưu CẢ HỌC VIÊN ⇒ mọi dòng của bé đó, không chạm bé khác", () => {
    const m = dongNaoDangBaoLuu({ dong: DONG, luot: luot(null) });
    expect([...m.keys()].sort()).toEqual(["oi-binh-robosim", "oi-binh-sata3"]);
  });

  it("[BLC-13] bảo lưu MỘT GHI DANH ⇒ CHỈ dòng của ghi danh ấy", () => {
    // ⚠️ Vế dễ quên nhất của cả F2. Bỏ nó là bé học hai khoá, bảo lưu một khoá, và đợt của
    // khoá CÒN ĐANG HỌC cũng được dời hạn + được tha quá hạn. Ca thật: repo có 77/170 học
    // viên học từ 2 lớp trở lên.
    const m = dongNaoDangBaoLuu({ dong: DONG, luot: luot("en-b3") });
    expect([...m.keys()]).toEqual(["oi-binh-sata3"]);
  });

  it("[BLC-14] dòng CHƯA NỐI GHI DANH không bao giờ được coi là đang bảo lưu", () => {
    // Fail-closed theo chiều đúng: nhầm thành "đang bảo lưu" là tha quá hạn cho một khoản
    // không ai xin tha.
    const m = dongNaoDangBaoLuu({
      dong: [{ orderItemId: "oi-chua-ghi-danh", enrollmentId: null, studentId: null }],
      luot: luot(null),
    });
    expect(m.size).toBe(0);
  });

  it("[BLC-15] không có lượt bảo lưu nào ⇒ bản đồ rỗng", () => {
    expect(dongNaoDangBaoLuu({ dong: DONG, luot: [] }).size).toBe(0);
  });
});
