import { describe, expect, it, vi } from "vitest";
import {
  NANG_LUC,
  chayNeuDuocPhep,
  duocPhep,
  lyDoKhongDuocPhep,
  taoBanDoNangLuc,
  type KhaiNangLuc,
  type NangLuc,
  type ProviderSupports,
} from "./nang-luc";

/** Khai đủ mọi năng lực, mặc định "không có" — mỗi ca ghi đè đúng thứ nó cần. */
function khaiDayDu(ghiDe: Partial<Record<NangLuc, Partial<KhaiNangLuc>>> = {}): Record<NangLuc, KhaiNangLuc> {
  const ra = {} as Record<NangLuc, KhaiNangLuc>;
  for (const nl of NANG_LUC) {
    ra[nl] = { providerSupports: "KHONG", adapterImplements: false, ghiChu: `[A] mẫu ${nl}`, ...ghiDe[nl] };
  }
  return ra;
}

describe("[HDNCC-NL] bản đồ năng lực — hai cờ tách bạch (TD-05)", () => {
  it("[HDNCC-NL-01] duocPhep CHỈ true khi adapterImplements — providerSupports=CO mà adapter chưa nối vẫn là false", () => {
    const cacCa: ReadonlyArray<readonly [ProviderSupports, boolean, boolean]> = [
      ["CO", true, true], // đối chứng DƯƠNG: có cả hai ⇒ được
      ["CO", false, false], // nhà cung cấp có, adapter chưa nối ⇒ KHÔNG (ca nút hứa suông)
      ["CHUA_XAC_MINH", false, false],
      ["KHONG", false, false],
    ];
    for (const [ps, ai, kyVong] of cacCa) {
      const banDo = taoBanDoNangLuc(khaiDayDu({ HUY: { providerSupports: ps, adapterImplements: ai } }));
      expect(duocPhep(banDo, "HUY"), `${ps}/${ai}`).toBe(kyVong);
    }
  });

  it("[HDNCC-NL-02] adapterImplements=true mà providerSupports≠CO là mâu thuẫn ⇒ ném (adapter không thể làm thứ nhà cung cấp không có)", () => {
    for (const ps of ["KHONG", "CHUA_XAC_MINH"] as const) {
      expect(() => taoBanDoNangLuc(khaiDayDu({ THAY_THE: { providerSupports: ps, adapterImplements: true } }))).toThrow(
        /THAY_THE/,
      );
    }
  });

  it("[HDNCC-NL-03] thiếu một năng lực, hoặc ghiChu rỗng (không có mức chắc chắn) ⇒ ném", () => {
    const thieu = khaiDayDu() as Partial<Record<NangLuc, KhaiNangLuc>>;
    delete thieu.BAO_SAI_SOT;
    expect(() => taoBanDoNangLuc(thieu as Record<NangLuc, KhaiNangLuc>)).toThrow(/BAO_SAI_SOT/);
    expect(() => taoBanDoNangLuc(khaiDayDu({ GUI_EMAIL: { ghiChu: "   " } }))).toThrow(/GUI_EMAIL/);
  });

  it("[HDNCC-NL-04] bản đồ trả về bị đóng băng và tách khỏi đầu vào (sửa đầu vào sau đó không đổi bản đồ)", () => {
    const khai = khaiDayDu({ PHAT_HANH: { providerSupports: "CO", adapterImplements: true } });
    const banDo = taoBanDoNangLuc(khai);
    khai.PHAT_HANH.adapterImplements = false;
    expect(duocPhep(banDo, "PHAT_HANH")).toBe(true);
    expect(Object.isFrozen(banDo)).toBe(true);
    expect(Object.isFrozen(banDo.PHAT_HANH)).toBe(true);
  });

  it("[HDNCC-NL-05] năng lực lạ (chuỗi ngoài danh sách) ⇒ false, không ném — fail-closed", () => {
    const banDo = taoBanDoNangLuc(khaiDayDu({ PHAT_HANH: { providerSupports: "CO", adapterImplements: true } }));
    expect(duocPhep(banDo, "KHONG_CO_THAT" as NangLuc)).toBe(false);
    expect(duocPhep(banDo, "toString" as NangLuc)).toBe(false);
  });

  it("[HDNCC-NL-06] chayNeuDuocPhep: bị chặn thì KHÔNG gọi hàm, nói rõ lý do; được phép thì gọi đúng một lần", () => {
    const banDo = taoBanDoNangLuc(
      khaiDayDu({
        PHAT_HANH: { providerSupports: "CO", adapterImplements: true },
        HUY: { providerSupports: "CO", adapterImplements: false },
      }),
    );
    const chanBoi = vi.fn(() => "x");
    const bi = chayNeuDuocPhep(banDo, "HUY", chanBoi);
    expect(bi.chay).toBe(false);
    expect(chanBoi).not.toHaveBeenCalled();
    if (!bi.chay) {
      expect(bi.lyDo).toContain("HUY");
      expect(bi.lyDo).toBe(lyDoKhongDuocPhep(banDo, "HUY"));
    }

    const choQua = vi.fn(() => 42);
    const ok = chayNeuDuocPhep(banDo, "PHAT_HANH", choQua);
    expect(choQua).toHaveBeenCalledTimes(1);
    expect(ok).toEqual({ chay: true, ketQua: 42 });
  });

  it("[HDNCC-NL-07] lý do phân biệt 'nhà cung cấp có nhưng hệ thống chưa nối' với 'chưa xác minh' và 'không có'", () => {
    // CÙNG MỘT năng lực (HUY), chỉ khác providerSupports: nếu so ba năng lực khác nhau thì tên năng lực trong câu
    // đã làm ba chuỗi khác nhau và khẳng định "ba chuỗi khác nhau" xanh dù hai nhánh dùng chung một khuôn.
    const lyDo = (ps: ProviderSupports): string =>
      lyDoKhongDuocPhep(taoBanDoNangLuc(khaiDayDu({ HUY: { providerSupports: ps } })), "HUY");
    const a = lyDo("CO");
    const b = lyDo("CHUA_XAC_MINH");
    const c = lyDo("KHONG");
    expect(new Set([a, b, c]).size).toBe(3);
    // a: nhà cung cấp CÓ, hệ thống chưa nối — KHÔNG được mang giọng "chưa xác minh" hay "không hỗ trợ"
    expect(a).toMatch(/nhà cung cấp có hỗ trợ nhưng hệ thống chưa nối/);
    expect(a).not.toMatch(/chưa xác minh|không hỗ trợ/);
    // b: chưa xác minh — không được nói chắc "có hỗ trợ nhưng" hay "không hỗ trợ"
    expect(b).toMatch(/chưa xác minh/);
    expect(b).not.toMatch(/có hỗ trợ nhưng|không hỗ trợ/);
    // c: nhà cung cấp KHÔNG hỗ trợ — KHÔNG được nói "chưa nối" (sẽ hứa rằng nối là xong) hay "chưa xác minh"
    expect(c).toMatch(/nhà cung cấp không hỗ trợ/);
    expect(c).not.toMatch(/chưa nối|chưa hiện thực|chưa xác minh/);
  });

  it("[HDNCC-NL-09] năng lực LẠ: lyDoKhongDuocPhep trả câu nói rõ, chayNeuDuocPhep không ném và không gọi hàm — fail-closed", () => {
    const banDo = taoBanDoNangLuc(khaiDayDu({ PHAT_HANH: { providerSupports: "CO", adapterImplements: true } }));
    for (const lac of ["KHONG_CO_THAT", "toString", "__proto__"]) {
      const lyDo = lyDoKhongDuocPhep(banDo, lac as NangLuc);
      expect(typeof lyDo, lac).toBe("string");
      expect(lyDo, lac).toContain(lac);
      expect(lyDo, lac).toMatch(/không có trong danh sách/);

      const spy = vi.fn(() => "x");
      let kq: ReturnType<typeof chayNeuDuocPhep<string>> | undefined;
      expect(() => {
        kq = chayNeuDuocPhep(banDo, lac as NangLuc, spy);
      }, lac).not.toThrow();
      expect(spy, lac).not.toHaveBeenCalled();
      expect(kq, lac).toEqual({ chay: false, lyDo });
    }
  });

  it("[HDNCC-NL-10] lý do của năng lực ĐÃ NỐI nói 'đã được nối' — không giả làm 'chưa nối' (màn không nói sai sự thật)", () => {
    const banDo = taoBanDoNangLuc(khaiDayDu({ PHAT_HANH: { providerSupports: "CO", adapterImplements: true } }));
    const lyDo = lyDoKhongDuocPhep(banDo, "PHAT_HANH");
    expect(lyDo).toMatch(/PHAT_HANH.*đã được nối/);
    expect(lyDo).not.toMatch(/chưa nối|chưa xác minh|không hỗ trợ/);
  });

  it("[HDNCC-NL-08] danh sách năng lực ghim đúng 13 mục, không trùng (thêm/bớt phải sửa cả bản đồ ba adapter)", () => {
    expect(NANG_LUC).toHaveLength(13);
    expect(new Set(NANG_LUC).size).toBe(13);
  });
});
