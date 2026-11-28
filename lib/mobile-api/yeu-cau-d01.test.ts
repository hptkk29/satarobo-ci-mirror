import { describe, expect, it } from "vitest";

import { NGAY_TRONG_TUAN_MONG_MUON, guiYeuCauSchema } from "./schema/yeu-cau";
import { ghepDoiCoSo, ghepDoiLop } from "./yeu-cau-d01";

/**
 * [D01] Chuyển lớp / chuyển cơ sở — ghép nội dung + ngày mong muốn (chủ dự án chốt 19/11/2026). THUẦN, không DB; `homNay` truyền vào (luật 19: không đọc đồng hồ thật).
 *   [D01-01] chuyển lớp nhiều ngày + khung giờ + ngày bắt đầu + ghi chú ⇒ nội dung đủ bốn phần, `preferredDate` = đầu ngày VN của ngày muốn bắt đầu
 *   [D01-02] chuyển lớp: không chọn gì và ghi chú < 5 ký tự ⇒ từ chối; chỉ chọn khung giờ (kiểu cũ) ⇒ nội dung GIỮ NGUYÊN khuôn cũ (tương thích)
 *   [D01-03] ngày bắt đầu ở quá khứ / sai dạng ⇒ từ chối; đúng ngày hôm nay ⇒ được
 *   [D01-04] chuyển cơ sở: cơ sở đích + ngày + khung giờ + ngày bắt đầu + ghi chú; khuôn cũ (chỉ cơ sở + ghi chú) giữ nguyên
 *   [D01-05] lược đồ: ngày ngoài danh sách (Thứ Hai!) · ngày lặp · khung giờ lạ ⇒ từ chối; danh sách ngày của thiết kế là Thứ Ba … Chủ nhật
 */
const HOM_NAY = "2026-11-19";

describe("[D01] ghép chuyển lớp / chuyển cơ sở", () => {
  it("[D01-01] chuyển lớp: nhiều ngày + khung giờ + ngày bắt đầu + ghi chú", () => {
    const r = ghepDoiLop({ ngayMongMuon: ["Thứ Tư", "Thứ Sáu"], khungGio: ["Chiều"], tuNgay: "2026-11-28", ghiChu: "Con thi vào thứ Bảy" }, HOM_NAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe("Xin chuyển lớp. Ngày mong muốn: Thứ Tư, Thứ Sáu. Khung giờ mong muốn: Chiều. Muốn chuyển từ ngày 28/11/2026. Ghi chú: Con thi vào thứ Bảy");
    expect(r.preferredDate?.toISOString()).toBe("2026-11-27T17:00:00.000Z"); // 00:00 ngày 28/11 giờ VN (UTC+7)
  });

  it("[D01-02] chuyển lớp: thiếu lựa chọn ⇒ từ chối; chỉ khung giờ ⇒ khuôn cũ", () => {
    expect(ghepDoiLop({}, HOM_NAY)).toEqual({ ok: false, loi: expect.stringMatching(/chọn ngày|ghi chú/) });
    expect(ghepDoiLop({ ghiChu: "ít" }, HOM_NAY).ok).toBe(false);
    const cu = ghepDoiLop({ khungGio: ["Sáng", "Cuối tuần"] }, HOM_NAY);
    expect(cu.ok && cu.content).toBe("Xin chuyển lớp. Khung giờ mong muốn: Sáng, Cuối tuần.");
    expect(cu.ok && cu.preferredDate).toBeNull();
  });

  it("[D01-03] ngày bắt đầu: quá khứ / sai dạng bị từ chối, hôm nay được", () => {
    expect(ghepDoiLop({ khungGio: ["Sáng"], tuNgay: "2026-11-18" }, HOM_NAY)).toEqual({ ok: false, loi: expect.stringContaining("đã qua") });
    expect(ghepDoiLop({ khungGio: ["Sáng"], tuNgay: "2026-13-45" }, HOM_NAY).ok).toBe(false);
    expect(ghepDoiLop({ khungGio: ["Sáng"], tuNgay: HOM_NAY }, HOM_NAY).ok).toBe(true);
  });

  it("[D01-04] chuyển cơ sở: đủ trường; khuôn cũ giữ nguyên", () => {
    const r = ghepDoiCoSo({ tenCoSo: "CS1 Hoà Cường", diaChiCoSo: "211 Nguyễn Hữu Thọ", ngayMongMuon: ["Thứ Sáu", "Chủ nhật"], khungGio: ["Sáng"], tuNgay: "2026-11-21", ghiChu: "Gần nhà" }, HOM_NAY);
    expect(r.ok && r.content).toBe(
      "Xin chuyển sang cơ sở CS1 Hoà Cường (211 Nguyễn Hữu Thọ). Ngày học mong muốn ở cơ sở mới: Thứ Sáu, Chủ nhật. Khung giờ mong muốn: Sáng. Muốn chuyển từ ngày 21/11/2026. Ghi chú: Gần nhà",
    );
    const cu = ghepDoiCoSo({ tenCoSo: "CS2", diaChiCoSo: "114 Hoàng Diệu", ghiChu: "Chuyển nhà" }, HOM_NAY);
    expect(cu.ok && cu.content).toBe("Xin chuyển sang cơ sở CS2 (114 Hoàng Diệu). Ghi chú: Chuyển nhà");
    expect(ghepDoiCoSo({ tenCoSo: "CS2", diaChiCoSo: "x", tuNgay: "2026-01-01" }, HOM_NAY).ok).toBe(false);
  });

  it("[D01-05] lược đồ: danh sách ngày là Thứ Ba…Chủ nhật; ngoài danh sách / lặp / khung giờ lạ bị từ chối", () => {
    expect([...NGAY_TRONG_TUAN_MONG_MUON]).toEqual(["Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"]);
    const ok = guiYeuCauSchema.safeParse({ loai: "doi-lop", ngayMongMuon: ["Thứ Ba", "Thứ Bảy"], khungGio: ["Sáng"], tuNgay: "2026-11-25" });
    expect(ok.success).toBe(true);
    expect(guiYeuCauSchema.safeParse({ loai: "doi-lop", ngayMongMuon: ["Thứ Hai"] }).success).toBe(false);
    expect(guiYeuCauSchema.safeParse({ loai: "doi-lop", ngayMongMuon: ["Thứ Ba", "Thứ Ba"] }).success).toBe(false);
    expect(guiYeuCauSchema.safeParse({ loai: "doi-co-so", coSoId: "x", khungGio: ["Nửa đêm"] }).success).toBe(false);
    expect(guiYeuCauSchema.safeParse({ loai: "doi-co-so", coSoId: "x", ngayMongMuon: ["Thứ Sáu"], tuNgay: "2026-11-21" }).success).toBe(true);
  });
});
