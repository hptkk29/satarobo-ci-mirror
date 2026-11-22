// PORT từ repo hodacphuchtc/DISC · tests/nap-bo-de.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
import { describe, expect, it } from "vitest";

import { NGAN_HANG } from "@/lib/disc/engine-goc/config/disc-cau-hoi";
import { THU_TU } from "@/lib/disc/engine-goc/config/disc-thu-tu";
import {
  LoiBoDe,
  danhSachBoDe,
  laMaBoDe,
  napBoDe,
  napBoDeAnToan,
  timCau,
} from "@/lib/disc/engine-goc/modules/core/bo-de/nap";
import { MA_BO_DE } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

describe("napBoDe", () => {
  it("nạp đủ 5 bộ đề", () => {
    expect(danhSachBoDe()).toHaveLength(5);
    expect(danhSachBoDe().map((b) => b.ma)).toEqual([...MA_BO_DE]);
  });

  it("trả câu theo ĐÚNG thứ tự hiển thị, không phải thứ tự trong bảng", () => {
    for (const ma of MA_BO_DE) {
      expect(napBoDe(ma).cau.map((c) => c.ma)).toEqual([...THU_TU[ma]]);
    }
  });

  it("thứ tự hiển thị KHÁC thứ tự khai trong ngân hàng — nếu không thì luật trộn vô nghĩa", () => {
    const goc = NGAN_HANG.THCS.cau.map((c) => c.ma);
    expect(napBoDe("THCS").cau.map((c) => c.ma)).not.toEqual(goc);
  });

  it("giữ nguyên nội dung câu, chỉ đổi thứ tự", () => {
    const bo = napBoDe("QS");
    expect([...bo.cau].map((c) => c.ma).sort()).toEqual(
      [...NGAN_HANG.QS.cau].map((c) => c.ma).sort(),
    );
    expect(bo.cau.every((c) => c.soiGuong && c.soiGuong.length > 0)).toBe(true);
  });

  it("mã lạ thì NÉM lỗi có thông điệp đọc được, không trả undefined", () => {
    // @ts-expect-error — cố tình truyền mã sai để kiểm hành vi ở biên.
    expect(() => napBoDe("KHONG-CO")).toThrow(LoiBoDe);
    // @ts-expect-error — cố tình truyền mã sai để kiểm hành vi ở biên.
    expect(() => napBoDe("KHONG-CO")).toThrow(/Không có bộ đề mã/u);
  });

  it("napBoDeAnToan nuốt mã lạ và trả null — dùng ở biên", () => {
    expect(napBoDeAnToan("THCS")?.ma).toBe("THCS");
    for (const rac of ["", "thcs", null, undefined, 5, {}]) {
      expect(napBoDeAnToan(rac)).toBeNull();
    }
  });

  it("laMaBoDe phân biệt đúng hoa thường", () => {
    expect(laMaBoDe("MN")).toBe(true);
    expect(laMaBoDe("mn")).toBe(false);
  });

  it("timCau tra được câu ở mọi bộ, mã lạ trả null", () => {
    expect(timCau("THCS-D1")).toMatchObject({ boDe: "THCS" });
    expect(timCau("QS-C4")).toMatchObject({ boDe: "QS" });
    expect(timCau("KHONG-CO-1")).toBeNull();
  });
});
