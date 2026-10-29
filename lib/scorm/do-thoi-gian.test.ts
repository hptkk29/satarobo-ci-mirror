import { beforeEach, describe, expect, it } from "vitest";
import { _datLaiDemRender, dongHoSsr, tinhServerTiming } from "./do-thoi-gian";

describe("[DTG] tinhServerTiming", () => {
  it("[DOTG-01] đủ trường ⇒ đúng khuôn, làm tròn 1 chữ số thập phân", () => {
    expect(tinhServerTiming({ nguon: "disk", msTruoc: 1.234, msNguon: 0.56 }, 2.349)).toBe("cache;desc=disk, pre;dur=1.2, src;dur=0.6, total;dur=2.3");
  });

  it("[DOTG-02] chưa biết nguồn (phản hồi lỗi/chặn) ⇒ null, KHÔNG có header dù đã có thời gian", () => {
    expect(tinhServerTiming({ msTruoc: 5 }, 10)).toBeNull();
  });

  it("[DOTG-03] trường thiếu hoặc không hợp lệ (NaN, âm) bị bỏ chứ không in rác; nhãn nguồn vẫn có", () => {
    expect(tinhServerTiming({ nguon: "r2-stream", msTruoc: Number.NaN, msNguon: -1 }, 3)).toBe("cache;desc=r2-stream, total;dur=3");
  });
});

describe("[DTG] dongHoSsr", () => {
  beforeEach(() => _datLaiDemRender());

  it("[DOTG-04] mỗi chặng tính từ mốc trước; total tính từ đầu; n đếm lần render của tiến trình; up làm tròn giây", () => {
    let t = 1000;
    const dh = dongHoSsr(() => t, () => 18123.7);
    t += 12;
    dh.moc("auth");
    t += 30;
    dh.moc("actor");
    t += 45;
    dh.moc("batch");
    t += 4;
    dh.moc("gate");
    t += 1;
    expect(dh.chot()).toBe("auth=12;actor=30;batch=45;gate=4;total=92;n=1;up=18124");
    const dh2 = dongHoSsr(() => t, () => 5);
    expect(dh2.chot()).toBe("auth=-;actor=-;batch=-;gate=-;total=0;n=2;up=5");
  });

  it("[DOTG-05] chuỗi chỉ gồm khoá=số và dấu ; — không chữ tự do (không thể mang tên người/mã gói)", () => {
    const dh = dongHoSsr();
    dh.moc("auth");
    expect(dh.chot()).toMatch(/^(auth|actor|batch|gate|total|n|up)=(-|\d+)(;(auth|actor|batch|gate|total|n|up)=(-|\d+))*$/);
  });
});
