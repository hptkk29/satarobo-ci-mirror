// @vitest-environment jsdom
/**
 * [HN2-MP-O*] — ô "Chưa khai máy POS" trên dòng đợt: `title` chỉ đường tới mục "Máy POS quẹt thẻ" của màn Cơ sở, và thành LINK chỉ khi
 * người xem ghi được (docs/pos-hai-nut-khai-may.md §2, V37). Dựng THẬT trong `PaymentRequestsSection`.
 *
 * Luật 12: một link mà người bấm vào chỉ để đọc "Bạn chỉ xem" là lời hứa suông. Quyết định "có link không" do SERVER tính bằng
 * `lienKetKhaiMay` (cùng hàm `duocKhaiMayPos` với mục máy POS); component chỉ vẽ đúng thứ nhận được — nên ca này khoá chiều
 * VẼ: có `href` ⇒ có link tới đúng chỗ, `href: null` ⇒ không có link nào (và đối chứng dương ngay cạnh).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
  taoPhieuPosAction: vi.fn(),
  kiemTraPhieuPosAction: vi.fn(),
  baoAdminPhieuPosAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_actions", () => ({
  taoPhieuGopAction: h.taoPhieuGopAction,
  huyPhieuGopAction: h.huyPhieuGopAction,
  dongPhieuGopAction: h.dongPhieuGopAction,
  taoPhieuPosAction: h.taoPhieuPosAction,
  kiemTraPhieuPosAction: h.kiemTraPhieuPosAction,
  baoAdminPhieuPosAction: h.baoAdminPhieuPosAction,
}));
vi.mock("../_qr-actions", () => ({ issueQrForRequest: vi.fn(), regenerateQr: vi.fn() }));
// Việc 3: `hop-phieu-pos.tsx` nay import action "tôi nhập sai mã" (kéo `@/lib/auth` thật nếu không mock).
vi.mock("../_pos-sai-ma-actions", () => ({ guiSaiMaAction: vi.fn(), timUngVienSaiMaAction: vi.fn() }));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

const DOT: PaymentRequestRow = {
  id: "pr3",
  orderItemId: null,
  installmentNo: 3,
  amountDue: 800_000,
  allocated: 0,
  dueDate: null,
  status: "PENDING",
  matchKey: null,
};

const TITLE = "Khai máy ở Cơ sở → CS2 - 114 Hoàng Diệu → Máy POS quẹt thẻ";

type Props = Parameters<typeof PaymentRequestsSection>[0];

function props(p: Partial<Props> = {}): Props {
  return {
    orderId: "o1",
    requests: [DOT],
    initialSessions: {},
    canManage: false,
    duocPhatPhieu: true,
    duocDongPhieu: false,
    batThuTheoCon: true,
    phieuGop: null,
    duocThuThePos: true,
    phieuPos: null,
    mayPos: [],
    khaiMay: { title: TITLE, href: "/centers/cs2/edit#may-pos" },
    ...p,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("[HN2-MP-O01] cơ sở chưa khai máy, người xem GHI ĐƯỢC ⇒ 'Chưa khai máy POS' là link tới đúng mục", () => {
  it("link có `title` đúng nguyên văn đặc tả và href tới #may-pos của cơ sở giữ đơn", () => {
    render(<PaymentRequestsSection {...props()} />);
    const lk = screen.getByRole("link", { name: "Chưa khai máy POS" });
    expect(lk).toHaveAttribute("href", "/centers/cs2/edit#may-pos");
    expect(lk).toHaveAttribute("title", TITLE);
  });
});

describe("[HN2-MP-O02] người xem KHÔNG ghi được ⇒ cùng chữ, cùng title, KHÔNG có link (luật 12)", () => {
  it("không link nào cho 'Chưa khai máy POS'; title vẫn chỉ đường (để biết nhờ ai, ở đâu)", () => {
    render(<PaymentRequestsSection {...props({ khaiMay: { title: TITLE, href: null } })} />);
    expect(screen.queryByRole("link", { name: "Chưa khai máy POS" })).toBeNull();
    const chu = screen.getByText("Chưa khai máy POS");
    expect(chu).toHaveAttribute("title", TITLE);
    expect(chu.closest("a")).toBeNull();
  });
});

describe("[HN2-MP-O03] đối chứng: ô này chỉ xuất hiện khi THẬT SỰ chưa khai máy và người xem có quyền thu thẻ", () => {
  it("có máy ⇒ không có 'Chưa khai máy POS' (đó là nút Thẻ POS)", () => {
    render(<PaymentRequestsSection {...props({ mayPos: [{ id: "m1", nhan: "QTTFBKATK" }] })} />);
    expect(screen.queryByText("Chưa khai máy POS")).toBeNull();
    expect(screen.getByRole("button", { name: /^Thẻ POS$/ })).toBeTruthy();
  });

  it("không có `payments:pos-check` ⇒ không thấy ô này dù cơ sở chưa khai máy", () => {
    render(<PaymentRequestsSection {...props({ duocThuThePos: false })} />);
    expect(screen.queryByText("Chưa khai máy POS")).toBeNull();
    expect(screen.queryByRole("link", { name: "Chưa khai máy POS" })).toBeNull();
  });
});
