import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/app/(portal)/portal/disc/_actions-so", () => ({
  camOnViecAction: async () => ({ ok: true }),
  datPinAction: async () => ({ ok: true }),
  luuCheckinAction: async () => ({ ok: true }),
  luuNhapAction: async () => ({ ok: true }),
  luuThanhVienAction: async () => ({ ok: true }),
  nopBaiAction: async () => ({ ok: false, error: "x" }),
  phatDeAction: async () => ({ ok: false, error: "x" }),
  taoKeHoachAction: async () => ({ ok: true }),
  taoSoGiaDinhAction: async () => ({ ok: true }),
  tickViecAction: async () => ({ ok: true }),
  xacNhanPinAction: async () => ({ ok: true }),
  xoaBaiLamAction: async () => ({ ok: true }),
  xoaThanhVienAction: async () => ({ ok: true }),
}));

import { dauVaoNha } from "@/lib/disc/so-gia-dinh/fixture";
import { sinhKeHoach } from "@/lib/disc/so-gia-dinh/ke-hoach";
import { dungManCaNhan, dungManGiaDinh, dungManTheCap, dungManThanhVien, dungLichSu, dungTheThanhVien } from "@/lib/disc/so-gia-dinh/man-hinh";
import { dungManKeHoach } from "@/lib/disc/so-gia-dinh/man-hinh-ke-hoach";
import { laTreEm } from "@/lib/disc/so-gia-dinh/vai";

import { ManCaNhan } from "./man-ca-nhan";
import { ManGiaDinh } from "./man-gia-dinh";
import { ManKeHoach } from "./man-ke-hoach";
import { ManLamBai, type NguoiLamBaiVM } from "./man-lam-bai";
import { ManTheCap } from "./man-the-cap";
import { ManThanhVien } from "./man-thanh-vien";
import { TaoSo } from "./tao-so";

/** Khói dựng thật (không DOM): mọi màn dựng được với dữ liệu thật hình dạng, không «undefined» / «NaN» / placeholder trong HTML. */
function sachHtml(html: string) {
  expect(html).not.toMatch(/undefined|NaN|\[object|\{[A-Za-z]+\}/);
  expect(html.length).toBeGreaterThan(500);
}

describe("[SG-UI] khói dựng các màn DISC (renderToStaticMarkup)", () => {
  for (const kb of ["mot-tu-lam", "hai-tu-lam", "ba-ho-so-mot-uoc", "du-ca-nha"] as const) {
    it(`[SG-UI-GD-${kb}] tab Gia đình dựng được và nói đúng tầng`, () => {
      const dv = dauVaoNha(kb);
      const html = renderToStaticMarkup(<ManGiaDinh vm={dungManGiaDinh(dv)} capNhat={null} />);
      sachHtml(html);
      expect(html).toContain("Nhà mình hợp nhau thế nào?");
      expect(html).toContain("Thẻ cặp hai chiều");
      expect(html).toContain("Làm bài");
      if (kb === "du-ca-nha" || kb === "ba-ho-so-mot-uoc") {
        expect(html).toContain("Bản đồ gia đình");
        expect(html).toContain("Kiểu gia đình".toUpperCase());
        expect(html).toContain("Vai trò tự nhiên");
      } else {
        expect(html).not.toContain("Vai trò tự nhiên");
        expect(html).toContain("Bản đồ gia đình chưa mở");
      }
      if (kb === "ba-ho-so-mot-uoc") expect(html).toContain("Bản nháp");
    });
  }

  it("[SG-UI-CN] tab Cá nhân: người lớn, bé TH (hai bản), bé MN", () => {
    const dv = dauVaoNha("du-ca-nha");
    const nguoi = dv.thanhVien.map((t) => ({ id: t.id, ten: t.ten, coHoSo: true }));
    const bo = renderToStaticMarkup(<ManCaNhan vm={dungManCaNhan(dv, "bo")!} nguoi={nguoi} ban="day-du" />);
    sachHtml(bo);
    expect(bo).toContain("Báo cáo của Người lớn 1");
    const con = dungManCaNhan(dv, "con")!;
    const conCon = renderToStaticMarkup(<ManCaNhan vm={con} nguoi={nguoi} ban="con" />);
    sachHtml(conCon);
    expect(conCon).toContain("Bản cho con");
    expect(conCon).toContain(con.nhanVat);
    const conBoMe = renderToStaticMarkup(<ManCaNhan vm={con} nguoi={nguoi} ban="bome" />);
    sachHtml(conBoMe);
    expect(conBoMe).toContain("Dành cho bố mẹ đọc về");
    const be = renderToStaticMarkup(<ManCaNhan vm={dungManCaNhan(dv, "be")!} nguoi={nguoi} ban="day-du" />);
    sachHtml(be);
    expect(be).not.toContain("Bản cho con");
  });

  it("[SG-UI-TC] tab Thẻ cặp: khoá khi thiếu người; mở thì có thẻ A → B và nút chiều ngược lại", () => {
    expect(renderToStaticMarkup(<ManTheCap vm={dungManTheCap(dauVaoNha("mot-tu-lam"))} />)).toContain("Thẻ cặp chưa mở");
    const html = renderToStaticMarkup(<ManTheCap vm={dungManTheCap(dauVaoNha("du-ca-nha"), "bo", "con")} />);
    sachHtml(html);
    expect(html).toContain("Người lớn 1 → Bé lớn");
    expect(html).toContain("Xem chiều ngược lại");
    expect(html).toContain("Thoả thuận hai tuần cho cả hai");
  });

  it("[SG-UI-KH] tab Kế hoạch: tạo mới, có kế hoạch, check-in", () => {
    const dv = dauVaoNha("du-ca-nha");
    const goc = {
      tab: "NGAY_7" as const, ngayChon: null, tuanChon: null, kyCheckin: null, soTuLam: 4, soCoHoSo: 4, tongThanhVien: 4, chup: dv.chup, soBanMoiNhat: 3,
      keHoach: {}, phanTichIdMoiNhat: "pt", hoatDong: [], thanhVien: dv.thanhVien.map((t) => ({ id: t.id, ten: t.ten })), homNay: "2026-11-03",
    };
    const moi = renderToStaticMarkup(<ManKeHoach vm={dungManKeHoach(goc)} tenGiaDinh="Nhà thử" snapTen={null} />);
    sachHtml(moi);
    expect(moi).toContain("Tạo kế hoạch 7 ngày");
    const sinh = sinhKeHoach({ chup: dv.chup!, ky: "NGAY_7", batDau: "2026-11-03", doKho: 1, soViecTuan: 7, hoatDong: [] });
    const kh = { id: "k", ky: "NGAY_7" as const, batDau: "2026-11-03", doKho: 1, soViecTuan: 7, phanTichId: "pt", checkin: [], viec: sinh.map((v, i) => ({ id: `v${i}`, nguoiLamId: v.nguoiLamId, nguoiNhanId: v.nguoiNhanId, ngay: v.ngay, nguon: v.nguon, noiDung: v.noiDung, phut: v.phut, hoatDongId: v.hoatDongId, xongLuc: null, camOnLuc: null })) };
    const co = renderToStaticMarkup(<ManKeHoach vm={dungManKeHoach({ ...goc, keHoach: { NGAY_7: kh } })} tenGiaDinh="Nhà thử" snapTen={null} />);
    sachHtml(co);
    expect(co).toContain("Đánh dấu đã làm");
    expect(co).toContain("Kế hoạch tự điều chỉnh");
    const ci = renderToStaticMarkup(<ManKeHoach vm={dungManKeHoach({ ...goc, tab: "CHECKIN", keHoach: { NGAY_7: kh } })} tenGiaDinh="Nhà thử" snapTen={null} />);
    sachHtml(ci);
    expect(ci).toContain("Tuần này nhà mình hoà thuận thế nào?");
    expect(ci).toContain("gọi Tổng đài quốc gia bảo vệ trẻ em 111");
  });

  it("[SG-UI-TV] tab Thành viên & quyền", () => {
    const html = renderToStaticMarkup(<ManThanhVien vm={dungManThanhVien(dauVaoNha("du-ca-nha"), "Nhà thử", [], false, laTreEm, 8)} />);
    sachHtml(html);
    expect(html).toContain("Thêm thành viên");
    expect(html).toContain("Quan hệ giữa các cặp");
    expect(html).toContain("Ai được xem sổ này");
    expect(html).toContain("(chưa đặt)");
  });

  it("[SG-UI-LB] màn Làm bài: chọn người + cách; cách bị chặn nói lý do", () => {
    const dv = dauVaoNha("du-ca-nha");
    const { the } = dungTheThanhVien(dv);
    const nguoi: NguoiLamBaiVM[] = dv.thanhVien.map((t, i) => ({
      id: t.id, ten: t.ten, chu: the[i]!.chu, phu: the[i]!.phu, nhanTrangThai: the[i]!.nhanTrangThai, chinh: the[i]!.chinh,
      tuLam: t.id === "be" ? { duoc: false, lyDo: "TRE_NHO_KHONG_TU_LAM" } : { duoc: true, boDe: "PH" },
      gocNhin: t.id === "bo" ? { duoc: false, lyDo: "NGUOI_LON_CHUA_HO_TRO_GOC_NHIN" } : { duoc: true, boDe: "MN" },
      coNhap: { TU_LAM: false, GOC_NHIN: false },
      lichSu: dungLichSu(dv.bai.filter((b) => b.thanhVienId === t.id)),
    }));
    const html = renderToStaticMarkup(<ManLamBai nguoi={nguoi} chonId="be" chonCach={null} coPin={false} tenChuSo="Người lớn 2" />);
    sachHtml(html);
    expect(html).toContain("1. Làm cho ai?");
    expect(html).toContain("2. Ai trả lời?");
    expect(html).toContain("Bé còn nhỏ nên chưa tự làm bài");
    expect(html).toContain("Chọn người và cách làm");
  });

  it("[SG-UI-TS] màn lập sổ", () => {
    const html = renderToStaticMarkup(<TaoSo tenGoiY="Thử" soHocVien={2} />);
    expect(html).toContain("Lập sổ DISC cho cả nhà");
    expect(html).toContain("Thêm 2 học viên");
    expect(html).not.toMatch(/undefined|NaN/);
  });
});
