// @vitest-environment node
/**
 * D-06 — bóc mã cơ sở từ tiền tố tên campaign, theo quy ước `SR.QD.232`.
 *
 * Vì sao bộ này gắt hơn vẻ ngoài của nó: đoán sai MỘT campaign là gán nhầm **toàn bộ**
 * chi tiêu quảng cáo của campaign đó sang cơ sở khác — và không ai phát hiện được, vì
 * con số vẫn ra một con số trông hợp lý. Nên mọi trường hợp không chắc chắn phải rơi
 * vào `UNKNOWN` (nhóm "CHƯA PHÂN BỔ"), tuyệt đối không khớp mờ, không rơi về một cơ
 * sở mặc định.
 *
 * Bảng ca kiểm lấy nguyên từ PRD `CDB-dashboard.md` §D.6.5.
 */
import { describe, it, expect } from "vitest";
import {
  parseCenterCodeFromCampaignName,
  checkCampaignNameForLead,
  MULTI_CENTER_CODE,
  UNALLOCATED_LABEL,
} from "@/lib/ads/campaign-code";

/** Danh mục mã cơ sở — nguồn thật là `Center.code`, truyền vào chứ không hardcode. */
const BIET = new Set(["CS1", "CS2"]);
const doc = (s: string | null | undefined) => parseCenterCodeFromCampaignName(s, BIET);

describe("[D-06] tên đúng quy ước", () => {
  it("ví dụ chuẩn của quy ước → ra đúng mã cơ sở", () => {
    expect(doc("CS1_LEAD_ROBOTICS-L1_VIDEO_0826_A03")).toEqual({
      kind: "CENTER",
      centerCode: "CS1",
    });
  });

  it("cơ sở khác cũng nhận", () => {
    expect(doc("CS2_MESS_COMBO12_IMAGE_0826_B07")).toEqual({
      kind: "CENTER",
      centerCode: "CS2",
    });
  });

  it("chỉ có mã cơ sở, không có phần còn lại → vẫn phân bổ được", () => {
    // Phần đuôi là kỷ luật đặt tên của Marketing, không phải việc của hàm này.
    expect(doc("CS1")).toEqual({ kind: "CENTER", centerCode: "CS1" });
  });

  it("mã đúng nhưng đuôi rỗng (`CS1_`) → vẫn nhận", () => {
    expect(doc("CS1_")).toEqual({ kind: "CENTER", centerCode: "CS1" });
  });
});

describe("[D-06] campaign chạy chung nhiều cơ sở", () => {
  it("`MULTI` → không quy về cơ sở nào, chờ khai tỷ lệ ở D-07", () => {
    expect(doc("MULTI_LEAD_ROBOSIM_VIDEO_0926_C01")).toEqual({ kind: "MULTI" });
  });

  it("chỉ mỗi chữ MULTI cũng vậy", () => {
    expect(doc("MULTI")).toEqual({ kind: "MULTI" });
  });

  it("viết thường vẫn nhận", () => {
    expect(doc("multi_lead_robosim_0826")).toEqual({ kind: "MULTI" });
  });
});

describe("[D-06] rộng lượng đúng chỗ — hoa/thường và khoảng trắng", () => {
  it("viết thường → nhận", () => {
    expect(doc("cs1_lead_robotics_video_0826_a03")).toEqual({
      kind: "CENTER",
      centerCode: "CS1",
    });
  });

  it("thừa khoảng trắng hai đầu chuỗi → cắt", () => {
    expect(doc("  CS1_LEAD_ROBOTICS_VIDEO_0826_A03  ")).toEqual({
      kind: "CENTER",
      centerCode: "CS1",
    });
  });

  it("thừa khoảng trắng ngay sau mã → cắt", () => {
    expect(doc("CS1 _LEAD_ROBOTICS_VIDEO_0826_A03")).toEqual({
      kind: "CENTER",
      centerCode: "CS1",
    });
  });
});

describe("[D-06] 🔴 không đoán — mọi ca mập mờ đều về CHƯA PHÂN BỔ", () => {
  it("mã cơ sở CHƯA MỞ (CS3) → không đoán, không rơi về CS1", () => {
    // Mở CS3 trong bảng Center là hàm này tự nhận, không phải sửa mã.
    expect(doc("CS3_LEAD_ROBOTICS_VIDEO_0826_A03")).toEqual({
      kind: "UNKNOWN",
      reason: "CODE_NOT_FOUND",
      token: "CS3",
    });
  });

  it("🔴 mã cơ sở KHÔNG đứng đầu → không nhặt ở giữa chuỗi", () => {
    // Đây là ca đắt nhất: "LEAD_CS1_..." có chứa CS1, và một hàm dễ dãi sẽ tìm thấy
    // nó rồi gán sai. Quy ước bắt buộc mã đứng ĐẦU.
    expect(doc("LEAD_CS1_ROBOTICS_VIDEO_0826_A03")).toEqual({
      kind: "UNKNOWN",
      reason: "CODE_NOT_FOUND",
      token: "LEAD",
    });
  });

  it("dùng `-` thay `_` → KHÔNG nhận, dù nhìn như đúng khuôn", () => {
    // Cố ý: `-` được dùng BÊN TRONG một trường theo chính ví dụ chuẩn
    // ("ROBOTICS-L1"), nên tách thêm `-` sẽ bẻ gãy đúng khuôn quy ước đòi hỏi.
    expect(doc("CS1-LEAD-ROBOTICS-VIDEO-0826-A03")).toEqual({
      kind: "UNKNOWN",
      reason: "NO_PREFIX",
      token: "CS1-LEAD-ROBOTICS-VIDEO-0826-A03",
    });
  });

  it("có dấu tiếng Việt → không nhận (quy ước cấm dấu)", () => {
    expect(doc("Cơ sở 1_LEAD_ROBOTICS_VIDEO_0826_A03")).toEqual({
      kind: "UNKNOWN",
      reason: "CODE_NOT_FOUND",
      token: "CƠ SỞ 1",
    });
  });

  it("bắt đầu bằng dấu ngăn cách → không nhận", () => {
    expect(doc("_CS1_LEAD_ROBOTICS")).toEqual({
      kind: "UNKNOWN",
      reason: "CODE_NOT_FOUND",
      token: "",
    });
  });
});

describe("[D-06] đầu vào rỗng — Meta có thể không trả tên campaign", () => {
  it("chuỗi rỗng · toàn khoảng trắng · null · undefined đều là EMPTY", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(doc(v), JSON.stringify(v)).toEqual({
        kind: "UNKNOWN",
        reason: "EMPTY",
        token: "",
      });
    }
  });
});

describe("[D-06] danh mục cơ sở truyền vào, không chôn trong mã", () => {
  it("mở cơ sở mới = thêm dữ liệu, KHÔNG sửa hàm này", () => {
    // Luật của kho: "mở CS mới = thêm data, không sửa code".
    const rong = new Set(["CS1", "CS2", "CS3"]);
    expect(parseCenterCodeFromCampaignName("CS3_LEAD_X_VIDEO_0826_A1", rong)).toEqual({
      kind: "CENTER",
      centerCode: "CS3",
    });
  });

  it("danh mục RỖNG → không mã nào lọt (fail-closed), nhưng MULTI vẫn là MULTI", () => {
    const rong = new Set<string>();
    expect(parseCenterCodeFromCampaignName("CS1_LEAD", rong)).toEqual({
      kind: "UNKNOWN",
      reason: "CODE_NOT_FOUND",
      token: "CS1",
    });
    expect(parseCenterCodeFromCampaignName("MULTI_LEAD", rong)).toEqual({ kind: "MULTI" });
  });
});

describe("[D-06] hằng số dùng chung", () => {
  it("mã campaign chung và nhãn nhóm chưa phân bổ đúng như quy ước", () => {
    expect(MULTI_CENTER_CODE).toBe("MULTI");
    expect(UNALLOCATED_LABEL).toBe("CHƯA PHÂN BỔ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-06 (26/08/2026) — ô "mã campaign" trên PHIẾU KHÁCH
// ─────────────────────────────────────────────────────────────────────────────
// Lead phải mang mã campaign để D-04/D-05 bóc CPL/CPA theo campaign. Mã đó là
// CÙNG MỘT khuôn với tên campaign bên Meta (SR.QD.232) — nên nó đi qua chính
// `parseCenterCodeFromCampaignName` ở trên, KHÔNG có khuôn thứ hai. Hai khuôn
// song song là hai luật sẽ trôi lệch, và lúc đó chi tiêu quy về một cơ sở còn
// lead quy về cơ sở khác mà cả hai màn đều trông bình thường.
describe("[G-06] checkCampaignNameForLead — ô nhập trên phiếu khách", () => {
  const check = (s: string | null | undefined) => checkCampaignNameForLead(s, BIET);

  it("để trống → null, KHÔNG phải lỗi (ô này không bắt buộc)", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(check(v), JSON.stringify(v)).toEqual({ ok: true, value: null });
    }
  });

  it("đúng khuôn → lưu NGUYÊN VĂN (đã cắt khoảng trắng hai đầu)", () => {
    // Không viết hoa, không đụng dấu: giá trị này phải khớp từng ký tự với tên
    // campaign bên Meta thì mới đối chiếu được với bảng chi tiêu của D-01.
    expect(check("  CS1_LEAD_ROBOTICS-L1_VIDEO_0826_A03  ")).toEqual({
      ok: true,
      value: "CS1_LEAD_ROBOTICS-L1_VIDEO_0826_A03",
    });
  });

  it("campaign chạy chung nhiều cơ sở (`MULTI`) → nhận", () => {
    expect(check("MULTI_LEAD_ROBOSIM_VIDEO_0926_C01")).toEqual({
      ok: true,
      value: "MULTI_LEAD_ROBOSIM_VIDEO_0926_C01",
    });
  });

  it("chỉ mỗi mã cơ sở → nhận (đuôi là kỷ luật đặt tên, không phải điều kiện)", () => {
    expect(check("CS1")).toEqual({ ok: true, value: "CS1" });
  });

  it("ĐÚNG khuôn nhưng mã cơ sở LẠ → vẫn nhận", () => {
    // Cố ý không chặn: mở cơ sở mới là thêm dữ liệu, và campaign của cơ sở sắp
    // khai báo không đáng bị chặn cả lượt lưu phiếu. Chỗ nói ra chuyện này là
    // cảnh báo "CHƯA PHÂN BỔ" của D-08, không phải ô nhập.
    expect(check("CS9_LEAD_X_VIDEO_0826_A1")).toEqual({
      ok: true,
      value: "CS9_LEAD_X_VIDEO_0826_A1",
    });
  });

  it("KHÔNG theo khuôn chút nào (không có dấu `_`, không phải mã cơ sở) → từ chối", () => {
    const r = check("chien dich he 2026");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("SR.QD.232");
  });

  it("câu từ chối phải chỉ ra khuôn đúng, không chỉ nói 'không hợp lệ'", () => {
    const r = check("khuyenmai");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("_");
  });
});
