/**
 * F2 (19/10/2026) — `source` của `POST /api/leads` công khai là KHOÁ ĐỊNH TUYẾN, không phải chữ tự do.
 *
 * Trước đó schema chỉ có `z.string().min(1)`: ai gọi thẳng API cũng ghi được chuỗi dài tuỳ ý (kể cả SĐT/tên người) vào `Lead.source`.
 * Ca HÀNH VI (chạy schema thật). `[LSRC-01]` tập giá trị THẬT mà các biểu mẫu công khai đang gửi PHẢI vẫn qua — chặn quá tay là mất lead.
 */
import { describe, expect, it } from "vitest";
import { leadCreateSchema, NGUON_CONG_KHAI_TOI_DA } from "./lead";

const goc = {
  parentName: "Nguyễn Văn A",
  phone: "0912345678",
  eventId: "evt-12345678",
  dongYChinhSachBaoMat: true as const,
};

describe("[LSRC] giới hạn + chuẩn hoá `source` của /api/leads công khai", () => {
  it("[LSRC-01] giá trị thật các biểu mẫu công khai gửi (lien-he · consult-modal · laptrinhrobot-landing · slug khoá học) vẫn QUA", () => {
    for (const source of ["lien-he", "consult-modal", "laptrinhrobot-landing", "registration-form", "luyenthirobosim", "laptrinhrobot"]) {
      expect(leadCreateSchema.safeParse({ ...goc, source }).success, source).toBe(true);
    }
  });

  it("[LSRC-02] đúng trần thì QUA, vượt trần 1 ký tự thì BỊ TỪ CHỐI (và lỗi nằm ở trường `source`)", () => {
    expect(leadCreateSchema.safeParse({ ...goc, source: "a".repeat(NGUON_CONG_KHAI_TOI_DA) }).success).toBe(true);
    const res = leadCreateSchema.safeParse({ ...goc, source: "a".repeat(NGUON_CONG_KHAI_TOI_DA + 1) });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.path).toEqual(["source"]);
  });

  it("[LSRC-03] chuẩn hoá: khoảng trắng hai đầu bị cắt (cùng một khoá), chuỗi toàn khoảng trắng bị từ chối", () => {
    const ok = leadCreateSchema.safeParse({ ...goc, source: "  lien-he  " });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.source).toBe("lien-he");
    expect(leadCreateSchema.safeParse({ ...goc, source: "   " }).success).toBe(false);
  });

  it("[LSRC-04] trần tính SAU khi cắt khoảng trắng (đệm khoảng trắng không làm một khoá hợp lệ bị từ chối oan)", () => {
    const res = leadCreateSchema.safeParse({ ...goc, source: ` ${"a".repeat(NGUON_CONG_KHAI_TOI_DA)} ` });
    expect(res.success).toBe(true);
  });
});
