// @vitest-environment jsdom
// components/cham-cong/tu-lam-moi-khi-co-thong-bao.test.tsx — P2.7: màn chấm công tự làm mới theo chuông.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { TuLamMoiKhiCoThongBao } from "./tu-lam-moi-khi-co-thong-bao";
import type { UserChannelEvent, UserChannelHub } from "@/components/chat/user-channel";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

function hubGia() {
  const nghe = new Set<(e: UserChannelEvent) => void>();
  const hub: UserChannelHub = {
    subscribe(_u, l) {
      nghe.add(l);
      return () => nghe.delete(l);
    },
  };
  return {
    hub,
    get so() {
      return nghe.size;
    },
    phat(e: UserChannelEvent) {
      act(() => {
        for (const l of [...nghe]) l(e);
      });
    },
  };
}
const NOW = new Date("2026-10-11T03:00:00Z");
const noti: UserChannelEvent = { type: "noti", at: NOW };
const chat: UserChannelEvent = { type: "bump", bump: { conversationId: "c", messageId: "m", kind: "CHAT", at: NOW } };
const doi = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("[TLM] tự làm mới khi có thông báo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    refresh.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("[TLM-01] một cụm thông báo ⇒ ĐÚNG MỘT router.refresh() (gom cụm, không refresh mỗi tín hiệu)", () => {
    const h = hubGia();
    render(<TuLamMoiKhiCoThongBao userId="u1" hub={h.hub} />);
    h.phat(noti);
    h.phat(noti);
    h.phat({ type: "resync" });
    expect(refresh).not.toHaveBeenCalled();
    doi(1_100);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("[TLM-02] tin CHAT không làm mới màn chấm công", () => {
    const h = hubGia();
    render(<TuLamMoiKhiCoThongBao userId="u1" hub={h.hub} />);
    h.phat(chat);
    doi(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("[TLM-03] rời màn ⇒ nhả người nghe (hub sống suốt phiên, không rò listener)", () => {
    const h = hubGia();
    const { unmount } = render(<TuLamMoiKhiCoThongBao userId="u1" hub={h.hub} />);
    expect(h.so).toBe(1);
    unmount();
    expect(h.so).toBe(0);
  });

  it("[TLM-W1] gắn ĐỦ ba màn chờ việc mới: hàng chờ duyệt đơn · xác nhận công · đơn từ của GV", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of [
      "app/(admin)/admin/don-tu/page.tsx",
      "app/(admin)/admin/cham-cong/xac-nhan-cong/page.tsx",
      "app/(teacher)/teacher/don-tu/page.tsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src.match(/<TuLamMoiKhiCoThongBao userId=\{session\.user\.id\} \/>/g), f).toHaveLength(1);
    }
  });
});
