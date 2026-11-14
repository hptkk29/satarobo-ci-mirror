// @vitest-environment jsdom
/**
 * [CBP-*] Đang chat với chatbot thì popup học thử 1-1 KHÔNG được bật đè [chủ dự án 07/11/2026: "khó chịu"].
 * Popup THẬT + tín hiệu THẬT (`tin-hieu.ts`), đồng hồ giả. Luôn kèm đối chứng dương: không có chat thì popup vẫn bật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a> }));

import { PopupHocThu11 } from "../popup-hoc-thu-1-1";
import { ChatbotWidget } from "./chatbot-widget";
import { SU_KIEN_CHATBOT, phatTinHieuChatbot, type TinHieuChatbot } from "./tin-hieu";

const popup = () => document.querySelector('[aria-labelledby="popup-hoc-thu-title"]');
const tua = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const phat = (t: Parameters<typeof phatTinHieuChatbot>[0]) => act(() => phatTinHieuChatbot(t));

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("[CBP] popup học thử × khung chat", () => {
  it("[CBP-00] đối chứng: không chat ⇒ popup bật sau 20 giây như cũ", () => {
    render(<PopupHocThu11 />);
    tua(21_000);
    expect(popup()).not.toBeNull();
  });

  it("[CBP-01] mở chat trước mốc 20 giây ⇒ popup KHÔNG bật, dù chat lâu bao nhiêu", () => {
    render(<PopupHocThu11 />);
    tua(5_000);
    phat({ mo: true });
    tua(10 * 60_000);
    expect(popup()).toBeNull();
  });

  it("[CBP-02] đóng chat ⇒ hẹn lại như bấm 'Để sau' (60 giây), không bật ngay", () => {
    render(<PopupHocThu11 />);
    phat({ mo: true });
    tua(30_000);
    phat({ mo: false });
    tua(59_000);
    expect(popup()).toBeNull();
    tua(2_000);
    expect(popup()).not.toBeNull();
  });

  it("[CBP-03] popup đang mở mà khách mở chat ⇒ popup đóng", () => {
    render(<PopupHocThu11 />);
    tua(21_000);
    expect(popup()).not.toBeNull();
    phat({ mo: true });
    expect(popup()).toBeNull();
  });

  it("[CBP-04] đã để lại thông tin qua chatbot ⇒ popup không bật nữa, kể cả sau khi đóng chat", () => {
    render(<PopupHocThu11 />);
    phat({ mo: true });
    phat({ daGui: true });
    phat({ mo: false });
    tua(10 * 60_000);
    expect(popup()).toBeNull();
  });
});

describe("[CBP-W] khung chat phát tín hiệu", () => {
  const DU = { coSo: [{ code: "CS1", name: "Cơ sở 1", address: "211 Nguyễn Hữu Thọ" }], khoaQuanTam: ["Sata3"] };
  it("[CBP-05] lúc tải trang (chat đóng) KHÔNG phát gì; mở ⇒ {mo:true}; đóng ⇒ {mo:false}", () => {
    const nhan: TinHieuChatbot[] = [];
    const nghe = (e: Event) => nhan.push((e as CustomEvent<TinHieuChatbot>).detail);
    window.addEventListener(SU_KIEN_CHATBOT, nghe);
    try {
      const { rerender } = render(<ChatbotWidget du={DU} mo={false} onDong={() => {}} />);
      expect(nhan).toEqual([]);
      rerender(<ChatbotWidget du={DU} mo onDong={() => {}} />);
      expect(nhan).toEqual([{ mo: true }]);
      rerender(<ChatbotWidget du={DU} mo={false} onDong={() => {}} />);
      expect(nhan).toEqual([{ mo: true }, { mo: false }]);
    } finally {
      window.removeEventListener(SU_KIEN_CHATBOT, nghe);
    }
  });
});
