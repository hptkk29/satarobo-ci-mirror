// [DLM-*] dọn lời mời cũ 20/10/2026 (thuần). DB thật: tests/cham-cong/parttime-don-loi-moi.spec.ts ([DLMP-DB-*]).
import { describe, expect, it } from "vitest";
import { demDon, keHoachDonLoiMoi, type LoiMoiCu } from "./don-loi-moi";

const m = (id: string, ngay: string, trangThaiBuoi: string | null = "SCHEDULED"): LoiMoiCu => ({ id, userId: "u", role: "MAIN_TEACHER", sourceType: "TRIAL_SESSION", ngay, trangThaiBuoi });

describe("[DLM] keHoachDonLoiMoi", () => {
  it("[DLM-01] buổi trước hôm nay ⇒ HUỶ; hôm nay và sau ⇒ ĐÃ GÁN", () => {
    const b = keHoachDonLoiMoi([m("qua", "2026-10-17"), m("nay", "2026-10-20"), m("sau", "2026-10-25")], "2026-10-20");
    expect(b.map((x) => [x.id, x.hanhDong])).toEqual([["qua", "HUY"], ["nay", "GAN_THANG"], ["sau", "GAN_THANG"]]);
  });
  it("[DLM-02] buổi đã huỷ / không đọc được ⇒ HUỶ dù ở tương lai (không gán người vào buổi không diễn ra)", () => {
    const b = keHoachDonLoiMoi([m("huy", "2026-10-25", "CANCELLED"), m("mat", "2026-10-25", null)], "2026-10-20");
    expect(b.map((x) => x.hanhDong)).toEqual(["HUY", "HUY"]);
  });
  it("[DLM-03] đếm", () => {
    expect(demDon(keHoachDonLoiMoi([m("a", "2026-10-15"), m("b", "2026-10-21"), m("c", "2026-10-22")], "2026-10-20"))).toEqual({ huy: 1, ganThang: 2 });
  });
});
