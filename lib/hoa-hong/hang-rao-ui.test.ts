// @vitest-environment node
// [NHH-FE-07*] — THANH HÀNG RÀO của builder: guardrail máy chủ (`kiemKichHoat`) → bảy dòng ✓/✕ cho người đọc, và quyết
// định nút Kích hoạt. Cổng thật vẫn ở máy chủ; ở đây chỉ DỊCH, nên điều đáng canh là: không mã lỗi nào rơi mất, không
// "đạt" khi chưa kiểm, và nút không bao giờ sáng khi còn một dòng ✕.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LY_DO_XAC_NHAN_TOI_THIEU } from "./chinh-sach-service";
import { dungHangRao, quyetDinhNutKichHoat, SO_KY_TU_LY_DO_XAC_NHAN, viHoaThongBao, type KetQuaKiemHangRao } from "./hang-rao-ui";

// `somNhat` mặc định CÓ giá trị: mốc công bố của một văn bản đã gắn. `null` = chưa gắn văn bản (ca [NHH-FE-07n] khai tường minh).
const kq = (loi: { ma: string; thongBao: string }[] = [], canhBao: { ma: string; thongBao: string }[] = [], somNhat: string | null = "2026-03-23"): KetQuaKiemHangRao => ({
  loi,
  canhBao,
  somNhat,
});
const MA_LOI_BIET = [
  "VAN_BAN_THIEU",
  "VAN_BAN_DA_THU_HOI",
  "HIEU_LUC_SOM",
  "KHONG_CO_RULE",
  "PHAM_VI_CHUA_HO_TRO",
  "LOAI_GD_TAT",
  "KIEU_TINH_CHUA_HO_TRO",
  "VAI_KHONG_HOAT_DONG",
  "PERSON_VAI_NHIEU_NGUOI",
  "NGUON_KHONG_HOAT_DONG",
  "NGUON_KHONG_THAM_GIA_HOA_HONG",
  "NGUON_CHUA_CO_NGUOI_PHU_TRACH",
  "NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU",
  "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH",
  "THIEU_NGUOI_PHU_TRACH",
  "CHONG_LAN_HIEU_LUC",
  "LUI_HIEU_LUC_BAN_DA_DUNG",
  "LUOI_QUA_LON",
  "CHONG_LAN_RULE",
  "VUOT_TRAN",
] as const;

describe("[NHH-FE-07] dungHangRao — bảy dòng cố định", () => {
  it("[NHH-FE-07a] chưa kiểm (null) ⇒ bảy dòng 'chưa kiểm', KHÔNG dòng nào đạt, không được kích hoạt", () => {
    const h = dungHangRao(null, { tran: 0.09 });
    expect(h.dong.map((d) => d.ma)).toEqual(["tran", "van-ban", "hieu-luc", "nguoi-huong", "nguon", "chong-lan", "loai-gd"]);
    expect(h.dong.every((d) => d.trangThai === "chua-kiem")).toBe(true);
    expect(h.datTatCa).toBe(false);
    expect(h.chuaKiem).toBe(true);
  });

  it("[NHH-FE-07b] đã kiểm, không lỗi ⇒ bảy dòng đạt, datTatCa", () => {
    const h = dungHangRao(kq(), { tran: 0.09 });
    expect(h.dong.every((d) => d.trangThai === "dat")).toBe(true);
    expect(h.datTatCa).toBe(true);
    expect(h.chuaKiem).toBe(false);
  });

  it("[NHH-FE-07c] nhãn dòng trần đọc từ tham số (không viết cứng 9%)", () => {
    expect(dungHangRao(kq(), { tran: 0.09 }).dong[0]!.nhan).toMatch(/9%/);
    expect(dungHangRao(kq(), { tran: 0.1 }).dong[0]!.nhan).toMatch(/10%/);
    expect(dungHangRao(kq(), { tran: 0.085 }).dong[0]!.nhan).toMatch(/8,5%/);
    expect(dungHangRao(kq(), { tran: null }).dong[0]!.nhan).not.toMatch(/\d%/);
  });

  it("[NHH-FE-07d] mỗi mã lỗi vào ĐÚNG dòng của nó; dòng khác vẫn đạt", () => {
    const dich: Record<string, string> = {
      VUOT_TRAN: "tran",
      VAN_BAN_THIEU: "van-ban",
      VAN_BAN_DA_THU_HOI: "van-ban",
      HIEU_LUC_SOM: "hieu-luc",
      THIEU_NGUOI_PHU_TRACH: "nguoi-huong",
      VAI_KHONG_HOAT_DONG: "nguoi-huong",
      PERSON_VAI_NHIEU_NGUOI: "nguoi-huong",
      NGUON_KHONG_HOAT_DONG: "nguon",
      // Ba mã của NGUỒN từng rơi vào «Điều kiện khác» khi dòng «Nhóm nguồn đang hoạt động» vẫn ✓ (res3 MEDIUM-6, luật 12)
      NGUON_KHONG_THAM_GIA_HOA_HONG: "nguon",
      NGUON_CHUA_CO_NGUOI_PHU_TRACH: "nguon",
      NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU: "nguon",
      NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH: "nguon",
      CHONG_LAN_HIEU_LUC: "chong-lan",
      CHONG_LAN_RULE: "chong-lan",
      LUI_HIEU_LUC_BAN_DA_DUNG: "chong-lan",
      LOAI_GD_TAT: "loai-gd",
    };
    for (const [ma, dong] of Object.entries(dich)) {
      const h = dungHangRao(kq([{ ma, thongBao: `msg ${ma}` }]), { tran: 0.09 });
      const dongLoi = h.dong.filter((d) => d.trangThai === "khong-dat");
      expect(dongLoi.map((d) => d.ma), ma).toEqual([dong]);
      // Lý do đầu là NGUYÊN VĂN máy chủ; riêng dòng hiệu lực được nối thêm một câu "Ngày sớm nhất hợp lệ" (ca 07g).
      expect(dongLoi[0]!.lyDo[0], ma).toBe(`msg ${ma}`);
      expect(dongLoi[0]!.lyDo.length, ma).toBe(ma === "HIEU_LUC_SOM" ? 2 : 1);
      expect(h.datTatCa, ma).toBe(false);
    }
  });

  it("[NHH-FE-07e] KHÔNG mã lỗi nào rơi mất: mã chưa có dòng riêng vào dòng 'Bộ rule dùng được'; mã lạ vào 'Khác' — và vẫn chặn", () => {
    for (const ma of MA_LOI_BIET) {
      const h = dungHangRao(kq([{ ma, thongBao: "x" }]), { tran: 0.09 });
      expect(h.datTatCa, ma).toBe(false);
      expect(h.dong.some((d) => d.trangThai === "khong-dat"), ma).toBe(true);
    }
    for (const ma of ["KHONG_CO_RULE", "PHAM_VI_CHUA_HO_TRO", "KIEU_TINH_CHUA_HO_TRO", "LUOI_QUA_LON"]) {
      const h = dungHangRao(kq([{ ma, thongBao: "x" }]), { tran: 0.09 });
      expect(h.dong.find((d) => d.trangThai === "khong-dat")?.ma, ma).toBe("quy-tac");
    }
    const la = dungHangRao(kq([{ ma: "MA_MOI_CHUA_AI_BIET", thongBao: "lạ" }]), { tran: 0.09 });
    expect(la.dong.find((d) => d.trangThai === "khong-dat")?.ma).toBe("khac");
    expect(la.datTatCa).toBe(false);
  });

  it("[NHH-FE-07e2] MỌI mã lỗi mà guardrail PHÁT RA (đọc từ mã nguồn của guardrail) đều có dòng riêng — không mã nào rơi vào «Điều kiện khác» (E2a: NGUON_TOAN_CUC_... từng rơi)", () => {
    const nguon = readFileSync(resolve(process.cwd(), "lib/hoa-hong/guardrail-kich-hoat.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const ma = new Set<string>([...nguon.matchAll(/\bbao\(\s*"([A-Z_]+)"/g)].map((m) => m[1]!));
    for (const m of nguon.matchAll(/\bloi\.push\(\{\s*ma:\s*"([A-Z_]+)"/g)) ma.add(m[1]!);
    for (const m of nguon.matchAll(/\bma:\s*"([A-Z_]+)"/g)) ma.add(m[1]!);
    // canhBao (không chặn) có đường riêng; hai mã ở đây không phải lỗi
    ma.delete("UNKNOWN_TANG");
    expect(ma.size).toBeGreaterThanOrEqual(15); // lưới không được quét rỗng
    const rơi: string[] = [];
    for (const m of ma) {
      const h = dungHangRao(kq([{ ma: m, thongBao: "x" }]), { tran: 0.09 });
      if (h.dong.find((d) => d.trangThai === "khong-dat")?.ma === "khac") rơi.push(m);
    }
    expect(rơi).toEqual([]);
  });

  it("[NHH-FE-07f] dòng 'Bộ rule dùng được' và 'Khác' CHỈ xuất hiện khi có lỗi thuộc chúng", () => {
    expect(dungHangRao(kq(), { tran: 0.09 }).dong.map((d) => d.ma)).not.toContain("quy-tac");
    expect(dungHangRao(kq(), { tran: 0.09 }).dong.map((d) => d.ma)).not.toContain("khac");
    expect(dungHangRao(kq([{ ma: "KHONG_CO_RULE", thongBao: "x" }]), { tran: 0.09 }).dong.map((d) => d.ma)).toContain("quy-tac");
  });

  it("[NHH-FE-07g] hiệu lực sớm: in NGÀY SỚM NHẤT hợp lệ (dd/mm/yyyy) vào lý do", () => {
    const h = dungHangRao(kq([{ ma: "HIEU_LUC_SOM", thongBao: "Hiệu lực ... sớm nhất là 2026-11-23." }], [], "2026-11-23"), { tran: 0.09 });
    const d = h.dong.find((x) => x.ma === "hieu-luc")!;
    expect(d.lyDo.join(" ")).toMatch(/23\/11\/2026/);
  });

  it("[NHH-FE-07h] hiệu lực đạt thì cũng in mốc sớm nhất khi biết (người soạn thấy còn dư bao nhiêu)", () => {
    const d = dungHangRao(kq([], [], "2026-11-23"), { tran: 0.09 }).dong.find((x) => x.ma === "hieu-luc")!;
    expect(d.trangThai).toBe("dat");
    expect(d.ghiChu).toMatch(/23\/11\/2026/);
  });

  it("[NHH-FE-07i] cảnh báo (UNKNOWN tăng) KHÔNG chặn nhưng đòi xác nhận; đi vào mảng riêng", () => {
    const h = dungHangRao(kq([], [{ ma: "UNKNOWN_TANG", thongBao: "Mức cho nguồn KHÔNG RÕ sẽ TĂNG" }]), { tran: 0.09 });
    expect(h.datTatCa).toBe(true);
    expect(h.canhBao).toEqual([{ ma: "UNKNOWN_TANG", thongBao: "Mức cho nguồn KHÔNG RÕ sẽ TĂNG" }]);
    expect(h.canXacNhan).toBe(true);
    expect(dungHangRao(kq(), { tran: 0.09 }).canXacNhan).toBe(false);
  });
});

describe("[NHH-FE-07] quyetDinhNutKichHoat — nút chỉ sáng khi đủ MỌI điều kiện", () => {
  const dat = dungHangRao(kq(), { tran: 0.09 });
  const khongDat = dungHangRao(kq([{ ma: "VAN_BAN_THIEU", thongBao: "x" }]), { tran: 0.09 });
  const chua = dungHangRao(null, { tran: 0.09 });
  const goc = { coQuyenKichHoat: true, laBanNhap: true, daLuu: true, coThayDoiChuaLuu: false, hangRao: dat };

  it("[NHH-FE-07j] đủ: nhập · đã lưu · không sửa dở · hàng rào đạt · có quyền ⇒ ve + bamDuoc", () => {
    expect(quyetDinhNutKichHoat(goc)).toEqual({ ve: true, bamDuoc: true, lyDo: null });
  });

  it("[NHH-FE-07k] KHÔNG quyền ⇒ không vẽ nút (lời hứa suông), nêu lý do", () => {
    const r = quyetDinhNutKichHoat({ ...goc, coQuyenKichHoat: false });
    expect(r.ve).toBe(false);
    expect(r.bamDuoc).toBe(false);
    expect(r.lyDo).toMatch(/commission_policies:activate/);
  });

  it("[NHH-FE-07l] có quyền nhưng hàng rào ✕ / chưa kiểm / chưa lưu / sửa dở / không phải nháp ⇒ nút TẮT kèm lý do riêng", () => {
    const ca = [
      { ...goc, hangRao: khongDat },
      { ...goc, hangRao: chua },
      { ...goc, daLuu: false, hangRao: chua },
      { ...goc, coThayDoiChuaLuu: true },
      { ...goc, laBanNhap: false },
    ];
    const lyDo = new Set<string>();
    for (const c of ca) {
      const r = quyetDinhNutKichHoat(c);
      expect(r.ve).toBe(true);
      expect(r.bamDuoc).toBe(false);
      expect(r.lyDo).toBeTruthy();
      lyDo.add(r.lyDo!);
    }
    expect(lyDo.size).toBe(5);
  });
});

describe("[NHH-FE-07m] hằng phía client khớp cổng phía máy chủ", () => {
  it("số ký tự tối thiểu của lý do xác nhận cảnh báo ở client = ở service (lệch ⇒ hộp thoại cho bấm mà máy chủ từ chối)", () => {
    expect(SO_KY_TU_LY_DO_XAC_NHAN).toBe(LY_DO_XAC_NHAN_TOI_THIEU);
  });
});

describe("[NHH-FE-07n] dòng 'Hiệu lực' không hiện ✓ khi chưa có văn bản để so", () => {
  it("không có mốc công bố (somNhat null) và không lỗi hiệu lực ⇒ dòng ở 'chưa kiểm' kèm lý do; datTatCa = false", () => {
    const h = dungHangRao(kq([{ ma: "VAN_BAN_THIEU", thongBao: "Chưa gắn văn bản" }], [], null), { tran: 0.09 });
    const d = h.dong.find((x) => x.ma === "hieu-luc")!;
    expect(d.trangThai).toBe("chua-kiem");
    expect(d.ghiChu).toMatch(/gắn văn bản/);
    expect(h.datTatCa).toBe(false);
    // ngay cả khi KHÔNG còn lỗi nào khác, thiếu mốc công bố vẫn không cho "đạt tất cả"
    expect(dungHangRao(kq([], [], null), { tran: 0.09 }).datTatCa).toBe(false);
  });

  it("đối chứng: có mốc (somNhat) ⇒ dòng đạt; có lỗi HIEU_LUC_SOM ⇒ chưa đạt (đã kiểm), không phải chưa kiểm", () => {
    expect(dungHangRao(kq([], [], "2026-03-23"), { tran: 0.09 }).dong.find((x) => x.ma === "hieu-luc")!.trangThai).toBe("dat");
    const som = dungHangRao(kq([{ ma: "HIEU_LUC_SOM", thongBao: "sớm" }], [], "2026-03-23"), { tran: 0.09 });
    expect(som.dong.find((x) => x.ma === "hieu-luc")!.trangThai).toBe("khong-dat");
  });
});

describe("[NHH-FE-07o] lý do nút tắt nói đúng khi chỉ còn dòng 'chưa kiểm' (không có dòng ✕)", () => {
  it("không ✕ nhưng có dòng chưa kiểm ⇒ KHÔNG nói 'Còn 0 điều kiện chưa đạt'", () => {
    const h = dungHangRao(kq([], [], null), { tran: 0.09 });
    const r = quyetDinhNutKichHoat({ coQuyenKichHoat: true, laBanNhap: true, daLuu: true, coThayDoiChuaLuu: false, hangRao: h });
    expect(r).toMatchObject({ ve: true, bamDuoc: false });
    expect(r.lyDo).not.toMatch(/Còn 0/);
    expect(r.lyDo).toMatch(/chưa kiểm được/);
  });
});

describe("[NHH-FE-07p] viHoaThongBao — người đọc không thấy tên trường / mã vai / ngày ISO", () => {
  const tenVai = new Map([["SALE", "Sale (người chốt đơn)"], ["SALE_ADMIN", "Sale Admin (Hội sở)"]]);

  it("tên trường văn bản → tiếng Việt; ngày ISO → dd/mm/yyyy", () => {
    expect(viHoaThongBao("Văn bản thiếu: documentCode, coTep.")).toBe("Văn bản thiếu: số hiệu, tệp đính kèm.");
    expect(viHoaThongBao("Hiệu lực 2026-09-10 sớm hơn công bố 2026-09-02 + 15 ngày làm việc — sớm nhất là 2026-09-23.")).toBe(
      "Hiệu lực 10/09/2026 sớm hơn công bố 02/09/2026 + 15 ngày làm việc — sớm nhất là 23/09/2026.",
    );
  });

  it("mã vai → tên vai (mã dài thắng mã ngắn: SALE_ADMIN không bị cắt thành SALE_ADMIN → 'Sale (…)_ADMIN'); loại GD → chữ thường dùng", () => {
    expect(viHoaThongBao("Vai SALE_ADMIN · NEW; vai SALE · RENEWAL", { tenVai })).toBe("Vai Sale Admin (Hội sở) · Khách mới; vai Sale (người chốt đơn) · Tái tục");
  });

  it("mã vai lạ giữ nguyên; không có bảng tên vai thì không đụng vào mã vai", () => {
    expect(viHoaThongBao("Vai MA_LA", { tenVai })).toBe("Vai MA_LA");
    expect(viHoaThongBao("Vai SALE")).toBe("Vai SALE");
  });

  it("dungHangRao dịch lý do VÀ cảnh báo; mã lỗi và thứ tự không đổi", () => {
    const h = dungHangRao(
      { loi: [{ ma: "VAN_BAN_THIEU", thongBao: "Văn bản thiếu: coTep." }], canhBao: [{ ma: "UNKNOWN_TANG", thongBao: "SALE·NEW: 0 → 100.000 đ" }], somNhat: "2026-03-23" },
      { tran: 0.09, tenVai },
    );
    expect(h.dong.find((d) => d.ma === "van-ban")!.lyDo).toEqual(["Văn bản thiếu: tệp đính kèm."]);
    expect(h.canhBao).toEqual([{ ma: "UNKNOWN_TANG", thongBao: "Sale (người chốt đơn)·Khách mới: 0 → 100.000 đ" }]);
  });
});
