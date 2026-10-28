import { describe, it, expect } from "vitest";
import {
  describeEffect,
  effectHint,
  effectKey,
  effectQueryPlan,
  canhBaoNghiSatNgay,
  maCaCacNgay,
  ngayTrongKhoang,
  effectSummaries,
  leaveDayCount,
  type EffectInput,
  type EffectSummaryRow,
} from "./request-effect";
import { vnDateAt } from "@/lib/time/vn";

const D9 = vnDateAt(2026, 8, 9); // 09/09/2026 00:00 giờ VN
const D11 = vnDateAt(2026, 8, 11);

function input(over: Partial<EffectInput> = {}): EffectInput {
  return {
    kind: "SHIFT_SWAP",
    fromDate: D9,
    toDate: null,
    targetUserName: null,
    currentCode: null,
    targetCurrentCode: null,
    requesterNewCode: null,
    targetNewCode: null,
    leaveCode: null,
    currentIn: null,
    currentOut: null,
    requestedIn: null,
    requestedOut: null,
    requestedIn2: null,
    requestedOut2: null,
    soCapQuetKyVong: null,
    className: null,
    startTime: null,
    endTime: null,
    detail: null,
    leaveDurationType: null,
    ...over,
  };
}

describe("leaveDayCount", () => {
  it("tính cả hai đầu; thiếu mốc ⇒ 1 ngày", () => {
    expect(leaveDayCount(D9, D11)).toBe(3);
    expect(leaveDayCount(D9, D9)).toBe(1);
    expect(leaveDayCount(D9, null)).toBe(1);
    expect(leaveDayCount(null, null)).toBe(1);
  });
});

describe("effectHint — giữ nguyên văn 5 nhánh cũ", () => {
  it("in đúng câu của từng loại", () => {
    const base = { targetUserId: null, fromDate: D9, toDate: null };
    expect(effectHint({ ...base, kind: "CLASS_OFF" })).toBe(
      "huỷ buổi học của lớp trong ngày (sinh buổi bù theo luật lớp)",
    );
    expect(effectHint({ ...base, kind: "SUB_TEACH" })).toBe("gán giáo viên dạy thay cho buổi đó");
    expect(effectHint({ ...base, kind: "SHIFT_SWAP" })).toBe(
      "đổi mã ca trên lưới phân ca và tính lại công",
    );
    expect(effectHint({ ...base, kind: "SHIFT_SWAP", targetUserId: "u2" })).toBe(
      "đổi mã ca trên lưới phân ca cho cả hai người và tính lại công",
    );
    expect(effectHint({ ...base, kind: "LEAVE", toDate: D11 })).toBe("ghi mã nghỉ lên lưới cho 3 ngày");
    expect(effectHint({ ...base, kind: "LEAVE", toDate: D11, targetUserId: "u2" })).toBe(
      "ghi mã nghỉ lên lưới cho 3 ngày, xếp ca người làm thay",
    );
    // Câu TIMESHEET_FIX ĐỔI 06/10/2026: duyệt đơn đủ bộ mốc nay GHI ĐÈ lượt quét cũ — câu cũ
    // ("ghi mốc giờ chỉnh tay…") không nói ra điều đó, mà nó là hệ quả người duyệt cần biết.
    expect(effectHint({ ...base, kind: "TIMESHEET_FIX" })).toBe(
      "ghi mốc giờ chỉnh tay (đủ bộ mốc của ca thì thay hẳn lượt quét cũ) và tính lại công ngày đó",
    );
    expect(effectHint({ ...base, kind: "OT" })).toBeNull();
  });
});

describe("describeEffect — 5 loại có hệ quả trên lịch", () => {
  it("SHIFT_SWAP: một chiều và hai chiều", () => {
    expect(describeEffect(input({ currentCode: "S", requesterNewCode: "CG" }))).toEqual({
      text: "S → CG",
      code: "CG",
      tone: "default",
    });
    expect(
      describeEffect(
        input({ currentCode: "S", requesterNewCode: "CG", targetUserName: "Trần B", targetCurrentCode: "CG" }),
      )?.text,
    ).toBe("S → CG · Trần B: giữ CG");
    // ĐẢO 06/10/2026 (luật 12): bản cũ ghim "Trần B: CG → S" ("đổi thẳng") — nhưng `decideRequest`
    // chỉ ghi ca người nhận khi đơn có `targetNewTemplateId`. Không khai ⇒ lịch họ GIỮ NGUYÊN.
  });

  it("SHIFT_SWAP: người nhận có ca riêng thì lấy đúng ca đó", () => {
    expect(
      describeEffect(
        input({
          currentCode: "S",
          requesterNewCode: "CG",
          targetUserName: "Trần B",
          targetCurrentCode: "CG",
          targetNewCode: "D2",
        }),
      )?.text,
    ).toBe("S → CG · Trần B: CG → D2");
  });

  it("LEAVE: mã ca → mã nghỉ kèm số ngày", () => {
    expect(describeEffect(input({ kind: "LEAVE", currentCode: "S", leaveCode: "P", toDate: D11 }))).toEqual({
      text: "S → P · 3 ngày",
      code: "P",
      tone: "default",
    });
  });

  // ── TIMESHEET_FIX 4 mốc + ghi đè/ghi thêm (chủ dự án chốt 06/10/2026) ─────────────
  // Trước 06/10 mọi đơn chỉnh công đều GHI THÊM và cột chỉ in "vào→ra". Nay đơn khai đủ bộ
  // mốc của ca thì duyệt sẽ GHI ĐÈ (lượt quét cũ thôi tính công) — cột phải nói trước điều đó,
  // bằng ĐÚNG luật `requests.ts` dùng (`cheDoChoDon`).
  it("TIMESHEET_FIX: đủ 2 mốc với ca một cặp quét ⇒ báo GHI ĐÈ", () => {
    const r = describeEffect(
      input({
        kind: "TIMESHEET_FIX",
        currentIn: vnDateAt(2026, 8, 9, 7, 52),
        currentOut: null,
        requestedIn: "07:30",
        requestedOut: "17:30",
        soCapQuetKyVong: 1,
      }),
    );
    expect(r).toEqual({ text: "07:52→chưa quét ⇒ ghi đè 07:30→17:30", tone: "default" });
  });

  it("TIMESHEET_FIX: ca HAI cặp quét, đơn khai đủ 4 mốc ⇒ GHI ĐÈ, in đủ hai cặp", () => {
    const r = describeEffect(
      input({
        kind: "TIMESHEET_FIX",
        requestedIn: "07:45",
        requestedOut: "11:30",
        requestedIn2: "17:15",
        requestedOut2: "21:00",
        soCapQuetKyVong: 2,
      }),
    );
    expect(r).toEqual({ text: "chưa quét→chưa quét ⇒ ghi đè 07:45→11:30 · 17:15→21:00", tone: "default" });
  });

  it("TIMESHEET_FIX: ca HAI cặp mà đơn chỉ 2 mốc ⇒ GHI THÊM (thiếu bộ)", () => {
    const r = describeEffect(
      input({ kind: "TIMESHEET_FIX", requestedIn: "07:45", requestedOut: "11:30", soCapQuetKyVong: 2 }),
    );
    expect(r).toEqual({ text: "chưa quét→chưa quét ⇒ thêm vào 07:45, ra 11:30", tone: "default" });
  });

  it("TIMESHEET_FIX: mốc lộn thứ tự (đơn cũ) ⇒ cảnh báo + chặn, không vẽ mũi tên ngược", () => {
    const r = describeEffect(
      input({ kind: "TIMESHEET_FIX", requestedIn: "17:30", requestedOut: "08:00", soCapQuetKyVong: 1 }),
    );
    expect(r?.tone).toBe("warning");
    expect(r?.text).toBe("Mốc giờ sai thứ tự — duyệt sẽ báo lỗi");
    expect(r?.blocked).toContain("phải sau giờ vào");
  });

  it("CLASS_OFF / SUB_TEACH: nêu lớp và người", () => {
    expect(describeEffect(input({ kind: "CLASS_OFF", className: "Sata 3 · A1" }))?.text).toBe(
      "Huỷ buổi · Sata 3 · A1",
    );
    expect(
      describeEffect(input({ kind: "SUB_TEACH", targetUserName: "Trần B", className: "Sata 3 · A1" }))?.text,
    ).toBe("Dạy thay: Trần B · Sata 3 · A1");
  });

  it("loại đơn hợp lệ nhưng không đổi lịch ⇒ Chỉ đổi trạng thái (tông xám) — nay chỉ còn đổi lớp", () => {
    for (const kind of ["CLASS_CHANGE"]) {
      expect(describeEffect(input({ kind }))).toEqual({ text: "Chỉ đổi trạng thái", tone: "muted" });
    }
  });

  it("[EFF-N] loại có hệ quả từ đợt 2, 4–8 KHÔNG còn nói 'Chỉ đổi trạng thái' (luật 12)", () => {
    expect(describeEffect(input({ kind: "OT", startTime: "18:00", endTime: "21:00" }))?.text).toBe("OT 18:00–21:00 · trả theo chấm công thực tế");
    expect(describeEffect(input({ kind: "OT" }))?.tone).toBe("warning");
    expect(describeEffect(input({ kind: "LATE_EARLY", detail: "Đi muộn", startTime: "08:30" }))?.text).toMatch(/Miễn trừ đi muộn tới 08:30/);
    expect(describeEffect(input({ kind: "REMOTE", startTime: "14:00", endTime: "16:00" }))?.text).toMatch(/Làm từ xa .*\(14:00–16:00\)/);
    expect(describeEffect(input({ kind: "BUSINESS_TRIP" }))?.text).toMatch(/Lịch công tác/);
    expect(describeEffect(input({ kind: "COMP_LEAVE", leaveDurationType: "HALF_DAY_PM", currentCode: "HC" }))?.text).toBe("Trừ quỹ nghỉ bù · nửa buổi chiều · ca HC");
    expect(describeEffect(input({ kind: "LEAVE", leaveCode: "NGHI_PHEP", leaveDurationType: "HOURLY", startTime: "14:00", endTime: "16:00", currentCode: "HC" }))?.text).toBe("HC giữ nguyên · nghỉ 14:00–16:00 (NGHI_PHEP)");
  });

  it("loại lạ ⇒ null để chỗ gọi tự quyết", () => {
    expect(describeEffect(input({ kind: "KHONG_TON_TAI" }))).toBeNull();
  });
});

describe("describeEffect — phân biệt CHƯA CÓ (bình thường) với KHUYẾT (duyệt sẽ lỗi)", () => {
  // Ranh giới này là toàn bộ lý do khối test tồn tại. Ô lưới trống và lượt quét chưa có là
  // chuyện thường ngày — duyệt vẫn chạy. Còn thiếu mã ca mới / thiếu giờ đề nghị thì
  // `decide()` NÉM LỖI, nên cột phải cảnh báo trước khi người ta bấm Duyệt.
  it("thiếu mã ca mới ⇒ cảnh báo, không vẽ mũi tên rỗng", () => {
    expect(describeEffect(input({ kind: "SHIFT_SWAP" }))).toEqual({
      text: "Thiếu mã ca mới — duyệt sẽ báo lỗi",
      tone: "warning",
      blocked: "đơn không ghi mã ca mới, nên không có gì để ghi lên lưới",
    });
    // Chuỗi rỗng / toàn khoảng trắng cũng là thiếu.
    expect(describeEffect(input({ currentCode: "  ", requesterNewCode: "" }))?.tone).toBe("warning");
    expect(describeEffect(input({ currentCode: "S", requesterNewCode: " " }))?.code).toBeUndefined();
  });

  it("thiếu loại nghỉ ⇒ cảnh báo NHƯNG không chặn (duyệt được, ghi mã không lương)", () => {
    // Ranh giới `warning` vs `blocked`: nghỉ thiếu loại vẫn áp được nên KHÔNG có `blocked` —
    // đặt nhầm là panel bảo "duyệt sẽ báo lỗi" cho một đơn duyệt bình thường.
    const r = describeEffect(input({ kind: "LEAVE" }));
    expect(r).toEqual({ text: "Thiếu loại nghỉ · 1 ngày", tone: "warning" });
    expect(r?.blocked).toBeUndefined();
  });

  it("thiếu CẢ giờ vào và giờ ra ⇒ cảnh báo; còn một giờ thì vẫn ghi được", () => {
    expect(describeEffect(input({ kind: "TIMESHEET_FIX" }))).toEqual({
      text: "Thiếu giờ vào/ra — duyệt sẽ báo lỗi",
      tone: "warning",
      blocked: "đơn không ghi giờ vào lẫn giờ ra, nên không có mốc giờ nào để ghi",
    });
    // Một đầu ⇒ thiếu bộ ⇒ GHI THÊM (chốt 06/10/2026: đơn "quên quét" không xoá lượt thật).
    expect(describeEffect(input({ kind: "TIMESHEET_FIX", requestedIn: "07:30" }))).toEqual({
      text: "chưa quét→chưa quét ⇒ thêm vào 07:30",
      tone: "default",
    });
  });

  it("ô lưới trống nói bằng chữ, KHÔNG dùng dấu hỏi", () => {
    expect(describeEffect(input({ requesterNewCode: "CG" }))?.text).toBe("chưa xếp → CG");
    expect(describeEffect(input({ kind: "LEAVE", leaveCode: "P" }))?.text).toBe("chưa xếp → P · 1 ngày");
    expect(describeEffect(input({ currentCode: "S", requesterNewCode: "CG", targetUserName: "Trần B" }))?.text).toBe(
      "S → CG · Trần B: giữ chưa xếp",
    );
  });

  it("loại không đụng lưới thì thiếu dữ liệu cũng in được", () => {
    expect(describeEffect(input({ kind: "CLASS_OFF" }))?.text).toBe("Huỷ buổi dạy");
  });

  it("dạy thay thiếu người ⇒ cảnh báo + CHẶN (handler `duyetDayThay` không gán được ai)", () => {
    // 06/10/2026: bản cũ in "Dạy thay" tông thường — người duyệt bấm rồi mới ăn lỗi đỏ.
    expect(describeEffect(input({ kind: "SUB_TEACH" }))).toEqual({
      text: "Thiếu người dạy thay — duyệt sẽ báo lỗi",
      tone: "warning",
      blocked: "đơn chưa chọn người dạy thay, nên không có ai để gán vào buổi học",
    });
    expect(describeEffect(input({ kind: "SUB_TEACH", className: "Sata 3" }))?.text).toBe(
      "Thiếu người dạy thay · Sata 3",
    );
  });
});

describe("[HF] đơn nghỉ NHIỀU ngày + đơn gấp (vá 11/10/2026)", () => {
  const D15 = new Date(Date.UTC(2026, 9, 15));
  const D16 = new Date(Date.UTC(2026, 9, 16));
  const don = {
    id: "n1",
    kind: "LEAVE",
    requesterId: "u1",
    targetUserId: null,
    fromDate: D15,
    toDate: D16,
    requesterNewTemplateId: null,
    targetNewTemplateId: null,
    leaveTypeId: "lt-p",
  };

  it("[HF-01] kế hoạch đọc nạp ô ca của MỌI ngày trong khoảng nghỉ, không chỉ ngày đầu", () => {
    expect(ngayTrongKhoang(D15, D16).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-15", "2026-10-16"]);
    expect(ngayTrongKhoang(D15, null)).toHaveLength(1);
    const plan = effectQueryPlan([don]);
    expect(plan.shiftKeys.map((k) => effectKey(k.userId, k.workDate)).sort()).toEqual([
      effectKey("u1", D15),
      effectKey("u1", D16),
    ]);
  });

  it("[HF-02] cột Thay đổi nói mã ca của CẢ khoảng: ngày 16 chưa xếp ⇒ 'CT/chưa xếp', không giả là CT cả hai ngày", () => {
    const lookups = {
      userNameById: new Map(),
      templateCodeById: new Map(),
      leaveCodeById: new Map([["lt-p", "NGHI_PHEP"]]),
      shiftCodeByUserDay: new Map([[effectKey("u1", D15), "CT"]]),
      soCapByUserDay: new Map(),
      tapsByUserDay: new Map(),
    };
    expect(maCaCacNgay(don, lookups)).toBe("CT/chưa xếp");
    const sum = effectSummaries(
      [{ ...don, className: null, requestedInAt: null, requestedOutAt: null, requestedIn2At: null, requestedOut2At: null, startTime: null, endTime: null, detail: null, leaveDurationType: null }],
      lookups,
    );
    expect(sum.get("n1")?.text).toBe("CT/chưa xếp → NGHI_PHEP · 2 ngày");
    // Hai ngày cùng ca ⇒ một mã, không lặp.
    const hai = { ...lookups, shiftCodeByUserDay: new Map([[effectKey("u1", D15), "CT"], [effectKey("u1", D16), "CT"]]) };
    expect(maCaCacNgay(don, hai)).toBe("CT");
  });

  it("[HF-03] cảnh báo đỏ: chỉ khi đơn NGHỈ có hạn báo trước, nộp SÁT ngày, và KHÔNG có người làm thay", () => {
    const goc = { kind: "LEAVE", nopSat: true, noticeDays: 1, leaveName: "Nghỉ phép năm", coNguoiThay: false };
    expect(canhBaoNghiSatNgay(goc)).toMatch(/Đơn GẤP.*KHÔNG có người làm thay/);
    expect(canhBaoNghiSatNgay({ ...goc, coNguoiThay: true })).toBeNull();
    expect(canhBaoNghiSatNgay({ ...goc, nopSat: false })).toBeNull();
    expect(canhBaoNghiSatNgay({ ...goc, noticeDays: null })).toBeNull(); // ốm / ma chay: không đòi báo trước
    expect(canhBaoNghiSatNgay({ ...goc, kind: "SHIFT_SWAP" })).toBeNull();
  });
});

describe("effectQueryPlan", () => {
  const rows = [
    {
      id: "r1",
      kind: "SHIFT_SWAP",
      requesterId: "u1",
      targetUserId: "u2",
      fromDate: D9,
      toDate: null,
      requesterNewTemplateId: "t-cg",
      targetNewTemplateId: null,
      leaveTypeId: null,
    },
    {
      id: "r2",
      kind: "LEAVE",
      requesterId: "u1",
      targetUserId: null,
      fromDate: D9,
      toDate: null,
      requesterNewTemplateId: null,
      targetNewTemplateId: null,
      leaveTypeId: "lt-p",
    },
    {
      id: "r3",
      kind: "TIMESHEET_FIX",
      requesterId: "u3",
      targetUserId: null,
      fromDate: D11,
      toDate: null,
      requesterNewTemplateId: null,
      targetNewTemplateId: null,
      leaveTypeId: null,
    },
    {
      id: "r4",
      kind: "OT",
      requesterId: "u4",
      targetUserId: null,
      fromDate: D11,
      toDate: null,
      requesterNewTemplateId: null,
      targetNewTemplateId: null,
      leaveTypeId: null,
    },
  ];

  it("gộp khoá trùng và chỉ đọc thứ thật sự cần", () => {
    const plan = effectQueryPlan(rows);
    expect(plan.userIds).toEqual(["u2"]);
    expect(plan.templateIds).toEqual(["t-cg"]);
    expect(plan.leaveTypeIds).toEqual(["lt-p"]);
    // r1 (u1 + u2) và r2 (u1) cùng ngày ⇒ u1 chỉ đọc một lần; OT không cần ca. Chỉnh công (u3)
    // CẦN ca từ 06/10/2026 — số cặp quét của ca quyết ghi đè hay ghi thêm.
    expect(plan.shiftKeys.map((k) => k.userId)).toEqual(["u1", "u2", "u3"]);
    expect(plan.timeLogKeys).toEqual([{ userId: "u3", workDate: D11 }]);
  });

  it("đơn thiếu ngày áp dụng thì không sinh khoá nào", () => {
    const plan = effectQueryPlan([{ ...rows[0], fromDate: null }]);
    expect(plan.shiftKeys).toEqual([]);
    expect(plan.timeLogKeys).toEqual([]);
    expect(plan.userIds).toEqual(["u2"]);
  });
});

describe("effectSummaries", () => {
  const rows: EffectSummaryRow[] = [
    {
      id: "r1",
      kind: "SHIFT_SWAP",
      requesterId: "u1",
      targetUserId: "u2",
      fromDate: D9,
      toDate: null,
      requesterNewTemplateId: "t-cg",
      targetNewTemplateId: null,
      leaveTypeId: null,
      className: null,
      requestedInAt: null,
      requestedOutAt: null,
      requestedIn2At: null,
      requestedOut2At: null,
      startTime: null,
      endTime: null,
      detail: null,
      leaveDurationType: null,
    },
    {
      id: "r2",
      kind: "TIMESHEET_FIX",
      requesterId: "u3",
      targetUserId: null,
      fromDate: D11,
      toDate: null,
      requesterNewTemplateId: null,
      targetNewTemplateId: null,
      leaveTypeId: null,
      className: null,
      requestedInAt: "07:30",
      requestedOutAt: "17:30",
      requestedIn2At: null,
      requestedOut2At: null,
      startTime: null,
      endTime: null,
      detail: null,
      leaveDurationType: null,
    },
    {
      id: "r3",
      kind: "KHONG_TON_TAI",
      requesterId: "u4",
      targetUserId: null,
      fromDate: D11,
      toDate: null,
      requesterNewTemplateId: null,
      targetNewTemplateId: null,
      leaveTypeId: null,
      className: null,
      requestedInAt: null,
      requestedOutAt: null,
      requestedIn2At: null,
      requestedOut2At: null,
      startTime: null,
      endTime: null,
      detail: null,
      leaveDurationType: null,
    },
  ];

  it("ráp dữ liệu đã nạp về từng đơn theo khoá người × ngày", () => {
    const map = effectSummaries(rows, {
      userNameById: new Map([["u2", "Trần B"]]),
      templateCodeById: new Map([["t-cg", "CG"]]),
      leaveCodeById: new Map(),
      shiftCodeByUserDay: new Map([
        [effectKey("u1", D9), "S"],
        [effectKey("u2", D9), "CG"],
      ]),
      soCapByUserDay: new Map([[effectKey("u3", D11), 1]]),
      tapsByUserDay: new Map([[effectKey("u3", D11), { first: vnDateAt(2026, 8, 11, 7, 52), last: null }]]),
    });
    expect(map.get("r1")?.text).toBe("S → CG · Trần B: giữ CG"); // không khai ca người nhận ⇒ giữ nguyên (06/10)
    expect(map.get("r1")?.code).toBe("CG");
    expect(map.get("r2")?.text).toBe("07:52→chưa quét ⇒ ghi đè 07:30→17:30");
    // Loại lạ bị bỏ khỏi map — chỗ gọi in "—".
    expect(map.has("r3")).toBe(false);
  });

  it("bản đồ tra cứu rỗng vẫn ra dòng đọc được", () => {
    const map = effectSummaries(rows, {
      userNameById: new Map(),
      templateCodeById: new Map(),
      leaveCodeById: new Map(),
      shiftCodeByUserDay: new Map(),
      soCapByUserDay: new Map(),
      tapsByUserDay: new Map(),
    });
    // r1 mất mã ca mới ⇒ cảnh báo; r2 vẫn có giờ đề nghị nên duyệt được, chỉ là chưa quét.
    expect(map.get("r1")).toEqual({
      text: "Thiếu mã ca mới — duyệt sẽ báo lỗi",
      tone: "warning",
      blocked: "đơn không ghi mã ca mới, nên không có gì để ghi lên lưới",
    });
    // Chưa xếp ca ⇒ coi như ca một cặp ⇒ 2 mốc là đủ bộ ⇒ ghi đè.
    expect(map.get("r2")?.text).toBe("chưa quét→chưa quét ⇒ ghi đè 07:30→17:30");
  });
});

describe("[NNB-E] nghỉ nửa buổi trên ca không chia buổi ⇒ cột Thay đổi báo DUYỆT SẼ LỖI (27/10/2026)", () => {
  it("[NNB-E1] LEAVE nửa chiều trên ca T (1 cặp) ⇒ blocked, không hứa «T giữ nguyên»", () => {
    const r = describeEffect(input({ kind: "LEAVE", leaveDurationType: "HALF_DAY_PM", currentCode: "T", soCapQuetKyVong: 1, leaveCode: "KHONG_LUONG" }))!;
    expect(r.blocked).toMatch(/^Ca T không chia buổi/);
    expect(r.tone).toBe("warning");
    expect(r.text).not.toMatch(/giữ nguyên/);
  });

  it("[NNB-E2] nghỉ bù nửa sáng trên ca S ⇒ blocked", () => {
    expect(describeEffect(input({ kind: "COMP_LEAVE", leaveDurationType: "HALF_DAY_AM", currentCode: "S", soCapQuetKyVong: 1 }))?.blocked).toMatch(/^Ca S /);
  });

  it("[NNB-E3] đối chứng: ca 2 cặp (ST) · theo giờ · cả ngày · chưa xếp ca ⇒ KHÔNG blocked", () => {
    const base = { kind: "LEAVE", leaveCode: "KHONG_LUONG" } as const;
    expect(describeEffect(input({ ...base, leaveDurationType: "HALF_DAY_PM", currentCode: "ST", soCapQuetKyVong: 2 }))?.blocked).toBeUndefined();
    expect(describeEffect(input({ ...base, leaveDurationType: "HOURLY", startTime: "18:00", endTime: "19:00", currentCode: "T", soCapQuetKyVong: 1 }))?.blocked).toBeUndefined();
    expect(describeEffect(input({ ...base, leaveDurationType: "FULL_DAY", currentCode: "T", soCapQuetKyVong: 1 }))?.blocked).toBeUndefined();
    expect(describeEffect(input({ ...base, leaveDurationType: "HALF_DAY_PM", currentCode: null, soCapQuetKyVong: null }))?.blocked).toBeUndefined();
  });
});
