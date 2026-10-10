// lib/lead/ingest.test.ts — S8 / lô L10 (06/09/2026). Test viết TRƯỚC hiện thực
// (luật cứng #5).
//
// VÌ SAO CÓ FILE NÀY. `lib/lead/ingest.ts` là lớp bọc của 3 webhook cũ
// (facebook / zalo / google-form) và cho tới trước đợt này nó ghi **cứng**
// `consentMarketing: true` cho MỌI phiếu đi qua. Không nguồn nào trong ba nguồn
// đó có ô đồng ý: Facebook Lead Ads trả về đúng các ô của biểu mẫu quảng cáo,
// webhook Zalo OA trả nội dung tin, Google Form trả các ô của bảng hỏi — không
// đường nào mang theo một tick "tôi đồng ý nhận thông tin". Ghi `true` ở đó là
// **ghi nhận một sự đồng ý chưa ai từng cho**, và cái `true` đó không nằm yên:
//   · nó là cổng cho liên hệ MARKETING (trục gọi điện OmiCall từng dùng — đã gỡ 06/10/2026) —
//     `true` giả nghĩa là hệ thống cho phép chào hàng một người chưa đồng ý;
//   · màn chi tiết lead in ra "Consent marketing: Có" nên người trực tin theo.
//
// Đây là món nợ 9.10 của kế hoạch ZaloCRM, và là loại nợ **không tự lộ**: không
// có test nào đỏ, không có log nào cảnh báo — chỉ có một cột boolean nói sai.
//
// Ba ca dưới đây khoá đúng ba mặt của nó:
//   [ZC-CS-01] nguồn KHÔNG có ô đồng ý (mọi lời gọi webhook hiện tại) ⇒ `false`;
//   [ZC-CS-02] nguồn CÓ ô đồng ý và người ta tích ⇒ `true` đi xuống nguyên vẹn
//              (nếu không thì bản vá thành "luôn false", cũng sai — chỉ sai
//              theo chiều ngược lại, và chiều đó làm mất quyền gọi chăm sóc
//              những khách đã thực sự đồng ý);
//   [ZC-CS-03] chốt chặn NGUỒN: không đường nào trong file còn ghi cứng `true`.
//              Ca này tồn tại vì hai ca trên chỉ đi qua một lối; ai đó thêm một
//              lối thứ hai (nguồn thứ tư) và chép lại dòng cũ thì hai ca trên
//              vẫn xanh.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Lõi thật (`./intake/ingest`) chạm DB, tra cơ sở, tự chia người phụ trách —
// không dựng được trong vitest. Ở đây chỉ cần biết lớp bọc TRUYỀN XUỐNG cái gì.
const ingestIntakeLeadMock = vi.fn(async () => ({
  ok: true as const,
  leadId: "lead-1",
  duplicate: false,
}));
vi.mock("./intake/ingest", () => ({
  ingestIntakeLead: (...args: unknown[]) =>
    (ingestIntakeLeadMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { ingestLead } from "./ingest";

/** Đối số thứ nhất (`MappedLead`) của lượt gọi lõi gần nhất. */
function leadDaTruyenXuong(): Record<string, unknown> {
  expect(ingestIntakeLeadMock).toHaveBeenCalledOnce();
  const args = ingestIntakeLeadMock.mock.calls[0] as unknown as unknown[];
  return args[0] as Record<string, unknown>;
}

const WEBHOOK_INPUT = {
  parentName: "Nguyễn Văn A",
  phone: "0912345678",
  source: "facebook",
};

beforeEach(() => {
  ingestIntakeLeadMock.mockClear();
});

describe("[ZC-CS] consentMarketing của lớp bọc webhook cũ", () => {
  it("[ZC-CS-01] nguồn webhook không có ô đồng ý ⇒ consentMarketing = false", async () => {
    await ingestLead(WEBHOOK_INPUT);
    expect(leadDaTruyenXuong().consentMarketing).toBe(false);
  });

  it("[ZC-CS-01b] cả ba nguồn cũ (facebook/zalo/google-form) đều ⇒ false", async () => {
    for (const source of ["facebook", "zalo", "google-form"]) {
      ingestIntakeLeadMock.mockClear();
      await ingestLead({ ...WEBHOOK_INPUT, source });
      expect(leadDaTruyenXuong().consentMarketing, source).toBe(false);
    }
  });

  it("[ZC-CS-02] nguồn có ô đồng ý và người ta tích ⇒ consentMarketing = true", async () => {
    await ingestLead({ ...WEBHOOK_INPUT, consentMarketing: true });
    expect(leadDaTruyenXuong().consentMarketing).toBe(true);
  });

  it("[ZC-CS-02b] ô đồng ý có nhưng KHÔNG tích ⇒ false (khác hẳn 'không có ô')", async () => {
    await ingestLead({ ...WEBHOOK_INPUT, consentMarketing: false });
    expect(leadDaTruyenXuong().consentMarketing).toBe(false);
  });

  it("[ZC-CS-02c] giá trị lạ lọt qua ép kiểu (chuỗi 'true', 1) KHÔNG thành đồng ý", async () => {
    // Payload webhook là `unknown`; nơi gọi có thể ép kiểu cẩu thả. Đồng ý là
    // thứ chỉ được ghi khi có đúng `true` kiểu boolean — mọi thứ khác là chưa rõ,
    // và chưa rõ thì fail-closed.
    for (const gia of ["true", 1, "1", {}]) {
      ingestIntakeLeadMock.mockClear();
      await ingestLead({
        ...WEBHOOK_INPUT,
        consentMarketing: gia as unknown as boolean,
      });
      expect(leadDaTruyenXuong().consentMarketing, String(gia)).toBe(false);
    }
  });

  it("[ZC-CS-03] không đường nào trong lib/lead/ingest.ts còn ghi cứng consentMarketing: true", () => {
    // Bỏ chú thích trước khi soi — docblock của file nói rất nhiều về "consent"
    // và về chính cái `true` đã gỡ; soi cả chú thích thì test đỏ/xanh theo văn
    // phong chứ không theo hành vi. Bỏ chú thích DÒNG trước, chú thích KHỐI sau
    // (cùng bẫy đã ghi ở `lib/lead/lead-pii-callsites.test.ts`).
    const ma = fs
      .readFileSync(path.join("lib", "lead", "ingest.ts"), "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    expect(ma).not.toMatch(/consentMarketing\s*:\s*true/);
  });
});
