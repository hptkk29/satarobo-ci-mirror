/**
 * Câu tóm tắt đơn + "Khi duyệt sẽ" — `lib/cham-cong/tom-tat-don.ts`.
 *
 * Hai thứ ghim ở đây:
 *  1. Câu đọc được như người nói (chủ dự án 06/10/2026: "làm rõ hơn cho QLCS đọc dễ hiểu hơn").
 *  2. Câu "Khi duyệt sẽ" KHÔNG hứa việc đường duyệt không làm (luật 12): người nhận/làm thay
 *     không chọn ca ⇒ lịch họ GIỮ NGUYÊN (`decideRequest` chỉ ghi khi có `targetNewTemplateId`);
 *     dạy thay thiếu người ⇒ không duyệt được (`duyetDayThay`, lib/cham-cong/don/lop-hoc.ts).
 */
import { describe, expect, it } from "vitest";
import { WORK_REQUEST_KINDS } from "@/lib/work-request";
import {
  dongDeNghi,
  khiDuyetSe,
  moTaMocNgan,
  nhanKhoangNgay,
  nhanNgay,
  noiDungXin,
  soNgayDon,
  tomTatDon,
  type DonDeTomTat,
} from "./tom-tat-don";

/** `@db.Date` thật: nửa đêm UTC. */
const D = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));

function don(over: Partial<DonDeTomTat> = {}): DonDeTomTat {
  return {
    kind: "LEAVE",
    fromDate: D(10, 12),
    toDate: null,
    startTime: null,
    endTime: null,
    className: null,
    detail: null,
    moc: [],
    leaveName: null,
    leavePaidRatio: null,
    leaveDurationType: null,
    newShiftCode: null,
    targetName: null,
    targetShiftCode: null,
    ...over,
  };
}

describe("nhãn ngày", () => {
  it("[TTD-01] @db.Date nửa đêm UTC đọc đúng ngày VN, không lệch", () => {
    expect(nhanNgay(D(10, 5))).toBe("05/10");
    expect(nhanNgay(null)).toBe("(chưa chọn ngày)");
  });

  it("[TTD-02] khoảng ngày: cùng ngày · cùng tháng · khác tháng", () => {
    expect(nhanKhoangNgay(D(10, 12), D(10, 12))).toBe("12/10");
    expect(nhanKhoangNgay(D(10, 12), null)).toBe("12/10");
    expect(nhanKhoangNgay(D(10, 12), D(10, 13))).toBe("12–13/10");
    expect(nhanKhoangNgay(D(9, 30), D(10, 2))).toBe("30/09–02/10");
    expect(soNgayDon(D(9, 30), D(10, 2))).toBe(3);
    expect(soNgayDon(D(10, 12), null)).toBe(1);
  });
});

describe("tomTatDon — câu cho người duyệt", () => {
  it("[TTD-03] nghỉ phép: tên loại viết thường, số ngày + khoảng, người làm thay kèm ca", () => {
    expect(
      tomTatDon(
        don({ leaveName: "Nghỉ phép năm", toDate: D(10, 13), targetName: "Trần B", targetShiftCode: "S" }),
        "Nguyễn A",
      ),
    ).toBe("Nguyễn A xin nghỉ phép năm 2 ngày (12–13/10), người làm thay: Trần B (ca S)");
  });

  it("[TTD-04] chỉnh công 4 mốc, ghi đè: nói số lượt quét sẽ bị thay", () => {
    const d = don({ kind: "TIMESHEET_FIX", fromDate: D(10, 5), moc: ["07:30", "11:30", "13:30", "17:30"] });
    expect(tomTatDon(d, "Nguyễn A", { cheDo: "GHI_DE", soLuotConTinh: 3 })).toBe(
      "Nguyễn A xin chỉnh công 05/10: vào 07:30 · ra 11:30 · vào 13:30 · ra 17:30 (sẽ ghi đè 3 lượt quét hiện có)",
    );
    expect(tomTatDon(d, "Nguyễn A", { cheDo: "GHI_DE", soLuotConTinh: 0 })).toContain(
      "(ngày này chưa có lượt quét nào)",
    );
  });

  it("[TTD-05] chỉnh công thiếu bộ ⇒ GHI THÊM; chưa biết ca ⇒ không đoán", () => {
    const d = don({ kind: "TIMESHEET_FIX", fromDate: D(10, 5), moc: [null, "17:30"] });
    expect(tomTatDon(d, "Nguyễn A", { cheDo: "GHI_THEM" })).toBe(
      "Nguyễn A xin chỉnh công 05/10: ra 17:30 (ghi thêm, giữ các lượt quét hiện có)",
    );
    expect(tomTatDon(d, "Nguyễn A")).toBe("Nguyễn A xin chỉnh công 05/10: ra 17:30");
  });

  it("[TTD-06] đơn của chính mình (ai = null) ⇒ 'Xin …'", () => {
    expect(tomTatDon(don({ kind: "REMOTE", toDate: D(10, 13) }), null)).toBe("Xin làm từ xa 2 ngày (12–13/10)");
  });

  it("[TTD-07] đi muộn / về sớm đọc từ `detail` của form; công tác đọc nơi đến", () => {
    expect(noiDungXin(don({ kind: "LATE_EARLY", detail: "Đi muộn", startTime: "08:30" }))).toBe(
      "đi muộn 12/10, đến lúc 08:30",
    );
    expect(noiDungXin(don({ kind: "LATE_EARLY", detail: "Về sớm", startTime: "16:00" }))).toBe(
      "về sớm 12/10, về lúc 16:00",
    );
    expect(noiDungXin(don({ kind: "BUSINESS_TRIP", detail: "Nơi đến: Cơ sở 2" }))).toBe(
      "đi công tác 1 ngày (12/10), nơi đến: Cơ sở 2",
    );
    expect(noiDungXin(don({ kind: "OT", startTime: "18:00", endTime: "20:00" }))).toBe(
      "tăng ca 12/10 từ 18:00 đến 20:00 (2 giờ)",
    );
  });

  it("[TTD-08] mọi loại đơn ra một câu sạch — không 'undefined'/'null' lọt ra chữ", () => {
    for (const kind of WORK_REQUEST_KINDS) {
      for (const d of [don({ kind }), don({ kind, fromDate: null, targetName: "  " })]) {
        const s = tomTatDon(d, "Nguyễn A");
        expect(s.startsWith("Nguyễn A xin ")).toBe(true);
        expect(s).not.toMatch(/undefined|null|NaN/);
        const k = khiDuyetSe(d, "Nguyễn A");
        expect(k.length).toBeGreaterThan(10);
        expect(k).not.toMatch(/undefined|null|NaN/);
      }
    }
  });
});

describe("khiDuyetSe — đúng việc đường duyệt làm (luật 12)", () => {
  it("[TTD-09] đổi ca: người nhận KHÔNG chọn ca ⇒ lịch họ giữ nguyên, không hứa đổi thẳng", () => {
    const k = khiDuyetSe(don({ kind: "SHIFT_SWAP", newShiftCode: "CG", targetName: "Trần B" }), "Nguyễn A");
    expect(k).toContain("ghi ca CG cho Nguyễn A");
    expect(k).toContain("lịch của Trần B giữ nguyên");
    expect(k).not.toContain("ghi ca S cho Trần B");
    const co = khiDuyetSe(
      don({ kind: "SHIFT_SWAP", newShiftCode: "CG", targetName: "Trần B", targetShiftCode: "S" }),
      "Nguyễn A",
    );
    expect(co).toContain("ghi ca S cho Trần B");
  });

  it("[TTD-10] nghỉ: mã P/X theo tỉ lệ lương — CÙNG hàm với đường duyệt", () => {
    expect(khiDuyetSe(don({ leaveName: "Nghỉ phép năm", leavePaidRatio: 1 }), "bạn")).toContain("ghi mã P");
    expect(khiDuyetSe(don({ leaveName: "Nghỉ không lương", leavePaidRatio: 0 }), "bạn")).toContain("ghi mã X");
    expect(khiDuyetSe(don({ leavePaidRatio: null }), "bạn")).toContain("ghi mã X");
    // Không có quỹ phép trong hệ thống ⇒ phải nói rõ là KHÔNG trừ.
    expect(khiDuyetSe(don({ leavePaidRatio: 1 }), "bạn")).toContain("Không trừ vào số ngày phép");
    // Người làm thay không chọn ca ⇒ không được xếp ca tự động.
    expect(khiDuyetSe(don({ leavePaidRatio: 1, targetName: "Trần B" }), "bạn")).toContain(
      "Trần B không được xếp ca tự động",
    );
  });

  it("[TTD-11] dạy thay thiếu người / đổi ca thiếu ca / chỉnh công thiếu giờ ⇒ nói thẳng 'không duyệt được'", () => {
    expect(khiDuyetSe(don({ kind: "SUB_TEACH" }), "bạn")).toMatch(/^không duyệt được/);
    expect(khiDuyetSe(don({ kind: "SHIFT_SWAP" }), "bạn")).toMatch(/^không duyệt được/);
    expect(khiDuyetSe(don({ kind: "TIMESHEET_FIX" }), "bạn")).toMatch(/^không duyệt được/);
    expect(khiDuyetSe(don({ kind: "SUB_TEACH", targetName: "Trần B", className: "Sata 3" }), "bạn")).toBe(
      "gán Trần B dạy thay buổi học lớp Sata 3 ngày 12/10",
    );
  });

  it("[TTD-12] chỉnh công: ghi đè nói lượt cũ thôi tính, ghi thêm nói lượt cũ vẫn tính", () => {
    const d = don({ kind: "TIMESHEET_FIX", moc: ["07:30", "17:30"] });
    expect(khiDuyetSe(d, "bạn", { cheDo: "GHI_DE", soLuotConTinh: 2 })).toContain(
      "2 lượt quét cũ giữ để xem nhưng thôi tính công",
    );
    expect(khiDuyetSe(d, "bạn", { cheDo: "GHI_THEM" })).toContain("các lượt quét hiện có vẫn tính");
  });

  it("[TTD-13] loại chỉ-căn-cứ không hứa đổi lịch/công", () => {
    for (const kind of ["CLASS_CHANGE"]) {
      const k = khiDuyetSe(don({ kind }), "bạn");
      expect(k).toMatch(/không tự đổi/);
    }
  });

  it("[TTD-13c] tăng ca (đợt 4): hứa đối chiếu chấm công, không hứa 'không đổi gì'", () => {
    const k = khiDuyetSe(don({ kind: "OT" }), "bạn");
    expect(k).toMatch(/đối chiếu chấm công/);
    expect(k).not.toMatch(/không tự đổi/);
  });

  it("[TTD-13b] đi muộn / về sớm (đợt 2, Q-5): hứa miễn trừ TRONG khung đã xin, không hứa 'không đổi gì'", () => {
    const k = khiDuyetSe(don({ kind: "LATE_EARLY" }), "bạn");
    expect(k).toMatch(/trong giờ đã xin/);
    expect(k).not.toMatch(/không tự đổi/);
  });
});

describe("dongDeNghi — khối 'Đơn đề nghị'", () => {
  it("[TTD-14] chỉnh công: 4 mốc ⇒ nhãn Vào 1…Ra 2; 2 mốc ⇒ Giờ vào/Giờ ra; ô giữa trống nói rõ", () => {
    expect(dongDeNghi(don({ kind: "TIMESHEET_FIX", moc: ["07:30", "11:30", "13:30", "17:30"] }))).toEqual([
      { nhan: "Vào 1", giaTri: "07:30" },
      { nhan: "Ra 1", giaTri: "11:30" },
      { nhan: "Vào 2", giaTri: "13:30" },
      { nhan: "Ra 2", giaTri: "17:30" },
    ]);
    expect(dongDeNghi(don({ kind: "TIMESHEET_FIX", moc: [null, "17:30"] }))).toEqual([
      { nhan: "Giờ vào", giaTri: "(để trống)" },
      { nhan: "Giờ ra", giaTri: "17:30" },
    ]);
  });

  it("[TTD-15] đổi ca: người nhận không chọn ca ⇒ 'giữ nguyên ca'", () => {
    expect(dongDeNghi(don({ kind: "SHIFT_SWAP", newShiftCode: "CG", targetName: "Trần B" }))).toEqual([
      { nhan: "Ca mới", giaTri: "CG" },
      { nhan: "Người nhận ca", giaTri: "Trần B — giữ nguyên ca" },
    ]);
  });

  it("[TTD-16] mô tả mốc ngắn theo VỊ TRÍ, bỏ ô trống", () => {
    expect(moTaMocNgan(["07:30", null, "13:30", "17:30"])).toBe("vào 07:30 · vào 13:30 · ra 17:30");
    expect(moTaMocNgan([])).toBe("");
  });
});
