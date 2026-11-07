// @vitest-environment node
/**
 * [NHH-DSP-02d] / [NHH-DSP-05c] — KIỂM ĐẦU VÀO của khiếu nại (THUẦN). Lỗi trả theo TỪNG Ô (`truong`) để màn hiện cạnh ô, không một
 * câu chung ở đầu form (06 §5.2: lỗi cạnh ô).
 *
 * "Bằng chứng bắt buộc" (04 §15) được hiểu là: tối thiểu MỘT mục có nội dung ≥ 10 ký tự sau trim. Mục tệp (`fileKey`/`fileUrl`) CHƯA nhận ở
 * lượt này — đường tải tệp cho người chỉ có `commission:view-self` cần mở `/api/admin/upload-url` (quyết định bảo mật, ghi ở docs/06) — nên một
 * mục có hình dạng tệp bị TỪ CHỐI chứ không lặng lẽ nhận (một `fileUrl` tuỳ ý do client khai sẽ được vẽ thành liên kết ở màn duyệt).
 */
import { describe, it, expect } from "vitest";

import { kiemDauVaoQuyet, kiemDauVaoTao, LY_DO_KHIEU_NAI_TOI_DA, SO_TIEN_TOI_DA } from "./khieu-nai-dau-vao";

const LY_DO = "Tôi là người giới thiệu của học viên này nhưng không có dòng hoa hồng nào";
const NOTE = { ghiChu: "Tin nhắn Zalo ngày 05/10 xác nhận tôi giới thiệu phụ huynh" };
const truongCua = (r: { ok: boolean; loi?: readonly { truong: string }[] }) => (r.ok ? [] : (r.loi ?? []).map((l) => l.truong));

describe("[NHH-DSP-02d] kiemDauVaoTao", () => {
  it("đủ lý do + một bằng chứng ghi chú ⇒ ok, đã trim", () => {
    const r = kiemDauVaoTao({ dich: { loai: "DONG", id: " abc " }, lyDo: `  ${LY_DO}  `, bangChung: [NOTE] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dich).toEqual({ loai: "DONG", id: "abc" });
      expect(r.value.lyDo).toBe(LY_DO);
      expect(r.value.bangChung).toEqual([NOTE]);
    }
  });

  it("[NHH-DSP-02d] thiếu bằng chứng (mảng rỗng) ⇒ lỗi Ở Ô `bangChung`, không phải câu chung", () => {
    const r = kiemDauVaoTao({ dich: { loai: "KHOAN", id: "p1" }, lyDo: LY_DO, bangChung: [] });
    expect(r.ok).toBe(false);
    expect(truongCua(r)).toEqual(["bangChung"]);
    if (!r.ok) expect(r.loi[0]!.thongBao).toMatch(/bằng chứng/i);
  });

  it("[NHH-DSP-02d] bằng chứng toàn khoảng trắng / quá ngắn cũng là THIẾU (đối chứng của ca rỗng)", () => {
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo: LY_DO, bangChung: [{ ghiChu: "     " }] }))).toEqual(["bangChung"]);
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo: LY_DO, bangChung: [{ ghiChu: "ngắn" }] }))).toEqual(["bangChung"]);
  });

  it("lý do ngắn hơn 10 ký tự sau trim / rỗng / quá dài ⇒ lỗi ô `lyDo`", () => {
    for (const lyDo of ["", "   ", "quá ngắn", "x".repeat(LY_DO_KHIEU_NAI_TOI_DA + 1)]) {
      expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo, bangChung: [NOTE] })), JSON.stringify(lyDo.slice(0, 12))).toEqual(["lyDo"]);
    }
  });

  it("hai lỗi cùng lúc ⇒ trả CẢ HAI ô (người dùng sửa một lượt, không phải đoán lỗi thứ hai)", () => {
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo: "ngắn", bangChung: [] })).sort()).toEqual(["bangChung", "lyDo"]);
  });

  it("đích thiếu / sai loại ⇒ lỗi ô `dich`", () => {
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "" }, lyDo: LY_DO, bangChung: [NOTE] }))).toEqual(["dich"]);
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "KHAC", id: "x" }, lyDo: LY_DO, bangChung: [NOTE] }))).toEqual(["dich"]);
    expect(truongCua(kiemDauVaoTao({ lyDo: LY_DO, bangChung: [NOTE] }))).toEqual(["dich"]);
  });

  it("mục bằng chứng có hình dạng TỆP bị từ chối (chưa nhận tệp ở lượt này)", () => {
    const tep = { fileKey: "uploads/documents/2026-10/a.pdf", fileName: "a.pdf", fileUrl: "https://x.test/a.pdf" };
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo: LY_DO, bangChung: [tep] }))).toEqual(["bangChung"]);
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo: LY_DO, bangChung: [{ ...NOTE, fileUrl: "javascript:alert(1)" }] }))).toEqual(["bangChung"]);
  });

  it("tối đa 5 mục bằng chứng; đầu vào không phải object ⇒ lỗi, không ném", () => {
    expect(truongCua(kiemDauVaoTao({ dich: { loai: "DONG", id: "x" }, lyDo: LY_DO, bangChung: Array.from({ length: 6 }, () => NOTE) }))).toEqual(["bangChung"]);
    expect(kiemDauVaoTao(null).ok).toBe(false);
    expect(kiemDauVaoTao("x").ok).toBe(false);
  });
});

describe("[NHH-DSP-05c] kiemDauVaoQuyet", () => {
  it("TỪ CHỐI không lý do ⇒ lỗi ô `lyDo` (đối chứng: có lý do ≥ 10 ký tự thì ok)", () => {
    expect(truongCua(kiemDauVaoQuyet({ loai: "TU_CHOI", lyDo: "" }))).toEqual(["lyDo"]);
    expect(truongCua(kiemDauVaoQuyet({ loai: "TU_CHOI", lyDo: "không đủ" }))).toEqual(["lyDo"]);
    const ok = kiemDauVaoQuyet({ loai: "TU_CHOI", lyDo: "Không có căn cứ giới thiệu trong hồ sơ" });
    expect(ok.ok).toBe(true);
  });

  it("DUYỆT_ĐỔI_NGUỒN chỉ cần lý do", () => {
    expect(kiemDauVaoQuyet({ loai: "DUYET_DOI_NGUON", lyDo: "Nguồn ghi sai, sẽ đổi ở màn lead" }).ok).toBe(true);
    expect(truongCua(kiemDauVaoQuyet({ loai: "DUYET_DOI_NGUON", lyDo: "" }))).toEqual(["lyDo"]);
  });

  it("DUYỆT_TIỀN: số tiền phải nguyên, khác 0, trong trần; âm được (đòi lại)", () => {
    const co = (soTien: unknown) => truongCua(kiemDauVaoQuyet({ loai: "DUYET_TIEN", lyDo: "Bù phần hoa hồng giới thiệu bị sót", soTien }));
    expect(co(80_000)).toEqual([]);
    expect(co(-80_000)).toEqual([]);
    expect(co(0)).toEqual(["soTien"]);
    expect(co(12.5)).toEqual(["soTien"]);
    expect(co("80000")).toEqual(["soTien"]);
    expect(co(Number.NaN)).toEqual(["soTien"]);
    expect(co(SO_TIEN_TOI_DA + 1)).toEqual(["soTien"]);
    expect(co(undefined)).toEqual(["soTien"]);
  });

  it("DUYỆT_TIỀN mang mauDongId / roleCode tuỳ chọn, đã trim; chuỗi rỗng coi như không khai", () => {
    const r = kiemDauVaoQuyet({ loai: "DUYET_TIEN", lyDo: "Bù phần hoa hồng giới thiệu bị sót", soTien: 50_000, mauDongId: " d1 ", roleCode: " REFERRER_PARENT " });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.loai === "DUYET_TIEN") {
      expect(r.value.mauDongId).toBe("d1");
      expect(r.value.roleCode).toBe("REFERRER_PARENT");
    }
    const r2 = kiemDauVaoQuyet({ loai: "DUYET_TIEN", lyDo: "Bù phần hoa hồng giới thiệu bị sót", soTien: 50_000, mauDongId: "  ", roleCode: "" });
    expect(r2.ok).toBe(true);
    if (r2.ok && r2.value.loai === "DUYET_TIEN") expect(r2.value.mauDongId).toBeNull();
  });

  it("loại quyết định lạ / thiếu ⇒ lỗi ô `loai`", () => {
    expect(truongCua(kiemDauVaoQuyet({ loai: "XOA", lyDo: "x".repeat(20) }))).toEqual(["loai"]);
    expect(truongCua(kiemDauVaoQuyet({ lyDo: "x".repeat(20) }))).toEqual(["loai"]);
    expect(kiemDauVaoQuyet(undefined).ok).toBe(false);
  });
});
