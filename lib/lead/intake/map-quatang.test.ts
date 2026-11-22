import { describe, it, expect } from "vitest";
import {
  mapQuatang,
  quatangClientMeta,
  quatangExternalId,
  QUATANG_FIELDS as F,
} from "./map-quatang";

/** Payload đúng như `doPost` v2.5 của quatang nhận từ trang landing. */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ho_ten_con: "Nguyễn Bá Minh Anh",
    ho_ten: "Nguyễn Bá Danh",
    sdt: "0935269128",
    email: "danh@example.com",
    truong: "Tiểu học Lê Văn Hiến",
    lop: "Lớp 1",
    co_so: "Cơ sở 1 - 211 Nguyễn Hữu Thọ, Đà Nẵng",
    tinh: "Đà Nẵng",
    source: "quatang.edu.vn",
    ip: "203.0.113.10",
    user_agent: "Mozilla/5.0 (Linux; Android 16)",
    ...over,
  };
}

function ok(p: Record<string, unknown>) {
  const r = mapQuatang(p);
  if (!r.ok) throw new Error(`mong đợi map thành công, nhận: ${r.error}`);
  return r.lead;
}

describe("mapQuatang — phiếu hợp lệ", () => {
  it("map đủ trường, SĐT về canonical", () => {
    const lead = ok(payload());
    expect(lead.parentName).toBe("Nguyễn Bá Danh");
    expect(lead.phone).toBe("84935269128");
    expect(lead.email).toBe("danh@example.com");
    expect(lead.consentMarketing).toBe(true); // PH tự điền form
    expect(lead.warnings).toEqual([]);
  });

  it("con vào LeadChild kèm trường + lớp", () => {
    expect(ok(payload()).children).toEqual([
      {
        fullName: "Nguyễn Bá Minh Anh",
        schoolName: "Tiểu học Lê Văn Hiến",
        gradeLevel: "Lớp 1",
      },
    ]);
  });

  it("cơ sở giữ chuỗi thô cho tầng ingest khớp với DB", () => {
    expect(ok(payload()).centerHint).toEqual({
      kind: "text",
      value: "Cơ sở 1 - 211 Nguyễn Hữu Thọ, Đà Nẵng",
    });
  });

  it("cơ sở kiểu CŨ của sheet cũng giữ nguyên để khớp chuỗi con", () => {
    expect(ok(payload({ co_so: "114 Hoàng Diệu" })).centerHint).toEqual({
      kind: "text",
      value: "114 Hoàng Diệu",
    });
  });
});

describe("mapQuatang — SĐT (đúng các dạng có thật trong sheet)", () => {
  it.each([
    ["0935269128", "84935269128"],
    ["935269128", "84935269128"], // sheet nuốt số 0 đầu
    ["84332869979", "84332869979"],
    ["+84 905 709 000", "84905709000"],
  ])("%s → %s", (input, expected) => {
    expect(ok(payload({ sdt: input })).phone).toBe(expected);
  });

  it("số 8 chữ số (có thật trong sheet) ⇒ TỪ CHỐI, nêu rõ số", () => {
    const r = mapQuatang(payload({ sdt: "79742424" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("79742424");
  });

  it("thiếu SĐT ⇒ từ chối", () => {
    const r = mapQuatang(payload({ sdt: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Thiếu số điện thoại");
  });
});

describe("mapQuatang — phiếu thiếu / bẩn", () => {
  it("thiếu tên PH (cả một đợt của sheet bị vậy) ⇒ fallback + cảnh báo", () => {
    const lead = ok(payload({ ho_ten: "" }));
    expect(lead.parentName).toBe("PH của Nguyễn Bá Minh Anh");
    expect(lead.warnings.join(" ")).toContain("không có tên phụ huynh");
  });

  it("email sai định dạng ⇒ bỏ qua + cảnh báo, không chặn lead", () => {
    const lead = ok(payload({ email: "abc@@x" }));
    expect(lead.email).toBeNull();
    expect(lead.warnings.join(" ")).toContain("sai định dạng");
  });

  it("trường dài quá trần ⇒ từ chối (endpoint công khai)", () => {
    expect(mapQuatang(payload({ ho_ten: "x".repeat(101) })).ok).toBe(false);
  });

  it("payload rỗng / không phải object ⇒ từ chối, không ném", () => {
    expect(mapQuatang({}).ok).toBe(false);
    expect(mapQuatang(null).ok).toBe(false);
    expect(mapQuatang("chuỗi").ok).toBe(false);
  });
});

describe("mapQuatang — attribution affiliate", () => {
  it("mã NV vào employeeCode; mã link + tên NV vào ghi chú", () => {
    const lead = ok(
      payload({
        aff_ma_nv: "CS1.TTS.001",
        aff_ten_nv: "Chị Diệu",
        aff_ma_link_cuoi: "LINK9",
        aff_ma_link_dau: "LINK1",
        aff_click_id: "clk_77",
        aff_utm: "utm_source=fb",
      }),
    );
    expect(lead.employeeCode).toBe("CS1.TTS.001");
    const note = lead.noteLines.join("\n");
    expect(note).toContain("NV giới thiệu: Chị Diệu");
    expect(note).toContain("Mã link giới thiệu: LINK9");
    expect(note).toContain("chạm đầu: LINK1");
    expect(note).toContain("clk_77");
    expect(note).toContain("utm_source=fb");
  });

  it("chạm đầu trùng chạm cuối ⇒ không lặp lại cho rối", () => {
    const lead = ok(payload({ aff_ma_link_cuoi: "LINK9", aff_ma_link_dau: "LINK9" }));
    expect(lead.noteLines.join("\n")).not.toContain("chạm đầu");
  });

  it("không có aff ⇒ không đẻ dòng ghi chú rỗng", () => {
    expect(ok(payload()).noteLines).toEqual(["Tỉnh/TP: Đà Nẵng"]);
  });
});

describe("mapQuatang — misa_status", () => {
  it("site báo lỗi MISA ⇒ cảnh báo nổi lên lead, không chỉ nằm ở sheet", () => {
    const lead = ok(payload({ misa_status: "FAIL_TIMEOUT" }));
    expect(lead.warnings.join(" ")).toContain("FAIL_TIMEOUT");
  });

  it("OK hoặc rỗng ⇒ im", () => {
    expect(ok(payload({ misa_status: "OK" })).warnings).toEqual([]);
    expect(ok(payload({ misa_status: "" })).warnings).toEqual([]);
  });
});

describe("quatangExternalId — chống chạy lại đẻ lead trùng", () => {
  it("ưu tiên event_id do script gửi", () => {
    expect(quatangExternalId(payload({ event_id: "row-99" }))).toBe("row-99");
  });

  it("không có event_id thì dựng từ mốc thời gian + SĐT canonical", () => {
    expect(quatangExternalId(payload({ ts: "2026-08-16T03:00:00Z" }))).toBe(
      "2026-08-16T03:00:00Z-84935269128",
    );
  });

  it("không đủ dữ kiện ⇒ null (đừng bịa khoá)", () => {
    expect(quatangExternalId(payload())).toBeNull();
    expect(quatangExternalId({})).toBeNull();
  });
});

describe("quatangClientMeta — IP thật nằm trong payload", () => {
  it("lấy ip/user_agent của phụ huynh, không phải của máy chủ Google", () => {
    expect(quatangClientMeta(payload())).toEqual({
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 (Linux; Android 16)",
    });
  });

  it("thiếu thì trả null chứ không trả chuỗi rỗng", () => {
    expect(quatangClientMeta({})).toEqual({ ipAddress: null, userAgent: null });
  });
});

describe("tên trường khớp doPost v2.5", () => {
  it("không đổi tên trường ngầm — đây là hợp đồng với Apps Script", () => {
    expect(F.childName).toBe("ho_ten_con");
    expect(F.parentName).toBe("ho_ten");
    expect(F.phone).toBe("sdt");
    expect(F.center).toBe("co_so");
    expect(F.affEmployeeCode).toBe("aff_ma_nv");
  });
});
