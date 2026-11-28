// @vitest-environment node
/**
 * [NTB-*] Nhóm mục của thanh bên quản trị (thiết kế `QtKhoaHoc.html`): chỉ SẮP XẾP lại các mục đã lọc theo quyền.
 *  · KHÔNG thêm mục người này không thấy (nếu thêm là lộ lối vào quản trị cho người không có quyền);
 *  · mọi `href` của khu quản trị đều có chỗ — mục mới quên khai ở `nhom-thanh-ben.ts` là ĐỎ (không rơi im lặng vào nhóm "Khác");
 *  · không trùng `href`, thứ tự nhóm đúng thiết kế.
 */
import { describe, expect, it } from "vitest";
import { menuElearning, moiHrefThay, type QuyenMenu } from "./menu";
import { HREF_DA_KHAI, NHOM_KHAC, nhomThanhBen, viTriTrongThanhBen } from "./nhom-thanh-ben";

const TAT_CA: QuyenMenu = { soan: true, cham: true, giao: true, baoCao: true, baoCaoDoi: false, quanLyYeuCau: true, quanLyChuongTrinh: true, evalLinkBat: true, onlineXem: true, onlineQuanLy: true };
const KHONG: QuyenMenu = { soan: false, cham: false, giao: false, baoCao: false, baoCaoDoi: false, quanLyYeuCau: false, quanLyChuongTrinh: false, evalLinkBat: false, onlineXem: false, onlineQuanLy: false };

const quanTri = (q: QuyenMenu) => menuElearning(q).filter((k) => k.id !== "hoc-tap");
const hrefCua = (q: QuyenMenu) => nhomThanhBen(quanTri(q)).flatMap((g) => g.muc.map((m) => m.href));

describe("[NTB-01] đủ mục, không thêm mục, không trùng", () => {
  it("🔴 mọi mục của khu quản trị (quyền đầy đủ) đều đã khai nhóm — không mục nào rơi vào 'Khác'", () => {
    const nhom = nhomThanhBen(quanTri(TAT_CA));
    expect(nhom.find((g) => g.nhan === NHOM_KHAC)).toBeUndefined();
    const tatCaHref = moiHrefThay(quanTri(TAT_CA));
    for (const h of tatCaHref) expect(HREF_DA_KHAI, h).toContain(h);
  });
  it("tập href ra = tập href vào (sắp xếp lại, không thêm/bớt)", () => {
    expect([...hrefCua(TAT_CA)].sort()).toEqual([...moiHrefThay(quanTri(TAT_CA))].sort());
  });
  it("🔴 người không có quyền nào ⇒ thanh bên RỖNG (không lộ mục)", () => {
    expect(nhomThanhBen(quanTri(KHONG))).toEqual([]);
  });
  it("chỉ quyền chấm ⇒ chỉ thấy nhóm Chấm bài (+ Tổng quan Đào tạo); không thấy Ngân hàng/Báo cáo/Cài đặt", () => {
    const nhom = nhomThanhBen(quanTri({ ...KHONG, cham: true }));
    expect(nhom.map((g) => g.nhan)).toEqual([null, "Chấm bài"]);
    expect(nhom[1]?.muc.map((m) => m.href)).toEqual(["/elearning/cham-bai-tap", "/elearning/cham-bai"]);
  });
  it("quản lý cơ sở (chỉ view-team) ⇒ 'Báo cáo đội' (nhóm Báo cáo) + 'Người học' (nhóm Khoá nội bộ, theo đường dẫn của thiết kế) — cùng quyền view-team, cùng phạm vi cơ sở", () => {
    const nhom = nhomThanhBen(quanTri({ ...KHONG, baoCaoDoi: true }));
    expect(nhom).toEqual([
      { nhan: "Khoá nội bộ · nhân viên", muc: [{ href: "/elearning/nguoi-hoc", nhan: "Người học", bieuTuong: "nguoi-hoc" }] },
      { nhan: "Báo cáo", muc: [{ href: "/elearning/bao-cao", nhan: "Báo cáo đội", bieuTuong: "co-so" }] },
    ]);
  });
});

describe("[NTB-02] thứ tự và nhãn theo thiết kế", () => {
  const nhom = nhomThanhBen(quanTri(TAT_CA));
  it("thứ tự nhóm: (không nhãn) · Khoá nội bộ · Khoá online · Ngân hàng · Chấm bài · Báo cáo · Cài đặt", () => {
    expect(nhom.map((g) => g.nhan)).toEqual([null, "Khoá nội bộ · nhân viên", "Khoá online · bán cho học viên", "Ngân hàng", "Chấm bài", "Báo cáo", "Cài đặt"]);
  });
  it("nhãn mục theo thiết kế", () => {
    const nhan = (n: string | null) => nhom.find((g) => g.nhan === n)?.muc.map((m) => m.nhan);
    expect(nhan(null)).toEqual(["Tổng quan"]);
    expect(nhan("Khoá nội bộ · nhân viên")).toEqual(["Chương trình", "Khoá học", "Giao khoá", "Lượt giao", "Yêu cầu đào tạo", "Ma trận đào tạo", "Người học"]);
    expect(nhan("Khoá online · bán cho học viên")).toEqual(["Khoá online", "Danh mục khoá"]);
    expect(nhan("Ngân hàng")).toEqual(["Câu hỏi", "Đề thi", "Khung chấm"]);
    expect(nhan("Chấm bài")).toEqual(["Bài tập và sản phẩm", "Bài thi tự luận"]);
    expect(nhan("Báo cáo")).toEqual(["Tuân thủ hạn chót", "Theo phòng ban", "Kết quả thi", "Hiệu quả đào tạo", "Chứng nhận"]);
    expect(nhan("Cài đặt")).toEqual(["Tự động hoá", "Mức gắn đánh giá"]);
  });
  it("🔴 'Mức gắn đánh giá' ẩn khi cờ EL-21 tắt (cờ vẫn là cổng, thanh bên không tự bày)", () => {
    expect(hrefCua({ ...TAT_CA, evalLinkBat: false })).not.toContain("/elearning/muc-danh-gia");
    expect(hrefCua(TAT_CA)).toContain("/elearning/muc-danh-gia");
  });
});

describe("[NTB-03] viTriTrongThanhBen", () => {
  const nhom = nhomThanhBen(quanTri(TAT_CA));
  it("trả nhóm + nhãn của mục; mục lạ ⇒ null", () => {
    expect(viTriTrongThanhBen(nhom, "/elearning/soan-khoa")).toEqual({ nhom: "Khoá nội bộ · nhân viên", nhan: "Khoá học" });
    expect(viTriTrongThanhBen(nhom, "/elearning/dao-tao")).toEqual({ nhom: null, nhan: "Tổng quan" });
    expect(viTriTrongThanhBen(nhom, "/elearning/khong-co")).toBeNull();
  });
});

describe("[NTB-04] mục chưa khai nhóm rơi vào 'Khác' (không biến mất)", () => {
  it("một mục lạ vẫn hiện, ở cuối", () => {
    const khu = [
      ...quanTri({ ...KHONG, cham: true }),
      { id: "quan-tri" as const, nhan: "x", moTa: "x", muc: [{ href: "/elearning/muc-moi", nhan: "Mục mới", bieuTuong: "khoa" as const }] },
    ];
    const nhom = nhomThanhBen(khu);
    expect(nhom[nhom.length - 1]).toEqual({ nhan: NHOM_KHAC, muc: [{ href: "/elearning/muc-moi", nhan: "Mục mới", bieuTuong: "khoa" }] });
  });
});
