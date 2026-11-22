// @vitest-environment node
// [QDD] Cổng «Quy định đào tạo» (SR.VH.205) — ai phải đồng ý, và nó là cổng THẬT ở server.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enrollmentFindFirst = vi.fn();
const acceptanceFindUnique = vi.fn();
const acceptanceUpsert = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    enrollment: { findFirst: (...a: unknown[]) => enrollmentFindFirst(...a) },
    sitePolicyAcceptance: {
      findUnique: (...a: unknown[]) => acceptanceFindUnique(...a),
      upsert: (...a: unknown[]) => acceptanceUpsert(...a),
    },
  },
}));

import { canChanQuyDinh, ghiDongYQuyDinh } from "./quy-dinh-dao-tao";
import { QUY_DINH_KEY, QUY_DINH_MUC, QUY_DINH_PHIEN_BAN } from "./quy-dinh-dao-tao-content";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  enrollmentFindFirst.mockReset();
  acceptanceFindUnique.mockReset();
  acceptanceUpsert.mockReset();
});

describe("[QDD] ai phải đồng ý quy định", () => {
  // Mỗi ca dùng userId RIÊNG: `cache` của React giữ kết quả theo đối số trong cùng tiến trình test.
  it("[QDD-01] phụ huynh CÓ con đã đăng ký và CHƯA đồng ý ⇒ bị chặn", async () => {
    acceptanceFindUnique.mockResolvedValue(null);
    enrollmentFindFirst.mockResolvedValue({ id: "e1" });
    expect(await canChanQuyDinh("u-chan")).toBe(true);
  });

  it("[QDD-02] tài khoản MIỄN PHÍ (không có ghi danh) ⇒ KHÔNG bị chặn", async () => {
    acceptanceFindUnique.mockResolvedValue(null);
    enrollmentFindFirst.mockResolvedValue(null);
    expect(await canChanQuyDinh("u-free")).toBe(false);
  });

  it("[QDD-03] đã đồng ý bản hiện hành ⇒ không chặn, và khỏi đi hỏi ghi danh", async () => {
    acceptanceFindUnique.mockResolvedValue({ acceptedAt: new Date() });
    expect(await canChanQuyDinh("u-da")).toBe(false);
    expect(enrollmentFindFirst).not.toHaveBeenCalled();
    // Sổ tra đúng khoá + đúng PHIÊN BẢN hiện hành (nâng version ⇒ mọi người đồng ý lại).
    expect(acceptanceFindUnique.mock.calls[0]![0]).toMatchObject({
      where: { userId_policyKey_version: { userId: "u-da", policyKey: QUY_DINH_KEY, version: QUY_DINH_PHIEN_BAN } },
    });
  });

  it("[QDD-04] ghi đồng ý idempotent: upsert với update RỖNG (không dời mốc lần đầu)", async () => {
    await ghiDongYQuyDinh("u-ghi", { ip: "1.2.3.4", userAgent: "ua" });
    const arg = acceptanceUpsert.mock.calls[0]![0] as { update: unknown; create: Record<string, unknown> };
    expect(arg.update).toEqual({});
    expect(arg.create).toMatchObject({ userId: "u-ghi", policyKey: QUY_DINH_KEY, version: QUY_DINH_PHIEN_BAN });
  });

  it("[QDD-05] nội dung đủ 5 điều và không rỗng (version đi cùng chữ)", () => {
    expect(QUY_DINH_MUC).toHaveLength(5);
    for (const m of QUY_DINH_MUC) expect(m.dong.length).toBeGreaterThan(0);
  });
});

describe("[QDD-W] dây nối — cổng ở SERVER, không có đường thoát", () => {
  it("[QDD-W1] layout portal trả màn đồng ý THAY children, đặt sau nhánh học sinh và trước mọi shell", () => {
    const s = doc("app/(portal)/portal/layout.tsx");
    const gate = s.indexOf("canChanQuyDinh(session.user.id)");
    expect(gate).toBeGreaterThan(0);
    expect(s).toMatch(/if \(children_\.length > 0 && \(await canChanQuyDinh\(session\.user\.id\)\)\) \{/);
    // Sau nhánh học sinh, trước nhánh v2 (nơi `children` được đưa vào cây).
    expect(gate).toBeGreaterThan(s.indexOf('ctx?.cheDo === "hoc-sinh"'));
    expect(gate).toBeLessThan(s.indexOf("if (isPortalV2Enabled())"));
    // Khối trả màn cổng KHÔNG chứa {children}.
    const khoi = s.slice(gate, s.indexOf("</PortalAppearanceProvider>", gate));
    expect(khoi).toContain("<QuyDinhGate />");
    expect(khoi).not.toContain("{children}");
  });

  it("[QDD-W2] màn cổng không có nút đóng / không có 'Để sau' và chỉ cho đồng ý khi đã cuộn hết", () => {
    const s = doc("app/(portal)/portal/quy-dinh/_components/quy-dinh-gate.tsx");
    expect(s).not.toMatch(/Để sau|Bỏ qua|Đóng/);
    expect(s).toContain("phanTram >= 100");
    expect(s).toContain("disabled={pending}");
  });

  it("[QDD-W3] action đồng ý: chỉ PARENT, không nhận version từ client, revalidate mức layout", () => {
    const s = doc("app/(portal)/portal/quy-dinh/actions.ts");
    expect(s).toContain('session.user.role !== "PARENT"');
    expect(s).toMatch(/dongYQuyDinhAction\(\)/); // không có tham số ⇒ không nhận version
    expect(s).toContain('revalidatePath("/portal", "layout")');
  });
});
