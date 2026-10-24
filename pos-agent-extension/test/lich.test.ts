/**
 * Nhịp hỏi (hợp đồng §5): nhận `nextPollMs: 2000` ⇒ chế độ NHANH 120 giây tính từ lần nhận
 * 2000 GẦN NHẤT (hỏi `GET /jobs` mỗi 2 giây); hết 120 giây ⇒ về alarm 1 phút. Không bao giờ
 * hỏi nhanh hơn `nextPollMs`.
 */
import { describe, expect, it } from "vitest";
import { capNhatNhanh, henHoiNhanh } from "../src/lib/lich";
import { T0 } from "./ho-tro/du-lieu";

describe("Chế độ hỏi nhanh", () => {
  it("[EXT-LI-01] nhận 2000 ⇒ nhanh tới now + 120s; nhận 2000 lần nữa ⇒ GIA HẠN từ lần mới", () => {
    let d = capNhatNhanh(null, 2000, T0);
    expect(d).toBe(T0 + 120_000);
    d = capNhatNhanh(d, 2000, T0 + 90_000);
    expect(d).toBe(T0 + 210_000);
    // 60000 không gia hạn, không cắt ngang
    expect(capNhatNhanh(d, 60000, T0 + 100_000)).toBe(T0 + 210_000);
    // rác ⇒ giữ nguyên
    expect(capNhatNhanh(d, "2000", T0 + 100_000)).toBe(T0 + 210_000);
    expect(capNhatNhanh(null, undefined, T0)).toBeNull();
  });

  it("[EXT-LI-02] trong cửa sổ nhanh và lần trả lời gần nhất là 2000 ⇒ hẹn sau 2 giây; hết cửa sổ ⇒ không hẹn (alarm lo)", () => {
    const den = T0 + 120_000;
    expect(henHoiNhanh(den, 2000, T0)).toBe(2000);
    expect(henHoiNhanh(den, 2000, den - 1)).toBe(2000);
    expect(henHoiNhanh(den, 2000, den)).toBeNull();
    expect(henHoiNhanh(null, 2000, T0)).toBeNull();
  });

  it("[EXT-LI-03] lần trả lời gần nhất là 60000 ⇒ KHÔNG hỏi nhanh dù còn trong cửa sổ (không nhanh hơn nextPollMs)", () => {
    expect(henHoiNhanh(T0 + 120_000, 60_000, T0)).toBeNull();
  });

  it("[EXT-LI-04] máy chủ trả số nhỏ hơn 2000 (lỗi) ⇒ vẫn không hỏi dày hơn 2 giây; mất trả lời (lỗi mạng) ⇒ 2 giây trong cửa sổ", () => {
    expect(henHoiNhanh(T0 + 120_000, 500, T0)).toBe(2000);
    expect(henHoiNhanh(T0 + 120_000, null, T0)).toBe(2000);
    expect(capNhatNhanh(null, 500, T0)).toBe(T0 + 120_000);
  });
});
