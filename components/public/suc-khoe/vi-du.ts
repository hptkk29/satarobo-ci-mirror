/**
 * Ba người «ví dụ» của thiết kế (số BỊA, đánh dấu `viDu`) — hiện ở lần vào đầu tiên để người dùng thấy sổ trông thế nào; xoá được bằng nút «Xoá dữ liệu ví dụ».
 * Chép nguyên số liệu từ artifact «Sata Robo — Website mới» (SucKhoe.dc.html). KHÔNG bao giờ gửi lên máy chủ.
 */
import type { Nguoi } from "./kieu";

const boT8 = {
  can: "74.6", cao: "170", eo_muc: 1, vd_manh_ngay: 0, vd_vua_ngay: 2, vd_vua_phut: 30, vd_di_ngay: 3, vd_di_phut: 15, vd_ngoi: 8.5, an_rq: 3.5, an_ngot: 1.5, an_man: 1,
  ngu_gio: 6, ngu_khoe: 1, w1: 3, w2: 3, w3: 2, w4: 2, w5: 3, p1: 1, p2: 0, g1: 1, g2: 1, hut: 0, khoi: 0, a1: 2, a2: 1, a3: 1, do1: 0, do2: 0, r_giam: 1, r_lai: 0,
  s_gd: 2, s_ha: 1, s_bs: 0, n_ngay: 1, n_mh: 2, n_gio: 1, vd_cantro: 0, vd_cungai: 0,
};
const meT8 = {
  can: "51.5", cao: "158", eo_muc: 0, vd_manh_ngay: 0, vd_vua_ngay: 3, vd_vua_phut: 30, vd_di_ngay: 4, vd_di_phut: 15, vd_ngoi: 6.5, an_rq: 3.5, an_ngot: 1.5, an_man: 1,
  ngu_gio: 6, ngu_khoe: 1, w1: 3, w2: 2, w3: 3, w4: 2, w5: 3, p1: 1, p2: 1, g1: 1, g2: 1, hut: 0, khoi: 0, a1: 1, a2: 0, a3: 0, do1: 0, do2: 0, n_ngay: 0, n_mh: 2, n_gio: 1,
  vd_cantro: 0, vd_cungai: 0,
};
const meT11 = { ...meT8, can: "52", eo_muc: 0, vd_vua_ngay: 4, vd_di_ngay: 5, vd_di_phut: 30, an_rq: 5, ngu_gio: 7, ngu_khoe: 0, w1: 4, w2: 3, w3: 3, w4: 3, w5: 4 };
const anT8 = {
  can: "25.2", cao: "129", vd60: 3, vd_co: 2, an_sang: 6, an_rq: 3.5, an_ngot: 1.5, an_nhanh: 1.5, ngu_gio: 9, ngu_khoe: 0, mh_thuong: 1, mh_nghi: 3, tt6: 0, khoi: 0,
  do_tre1: 0, do_tre2: 0, vd_cantro: 1, vd_cungai: 0,
};

export function nguoiViDu(): Nguoi[] {
  return [
    { id: "vd-bo", ten: "Bố", vt: "Bố", ns: "1986-03-12", gt: "nam", viDu: true, daThay: ["x10", "k02", "x25"], luot: [{ id: "b1", ngay: "2026-08-03", tl: boT8, xoay: ["x10", "k02", "x25"], xtl: { x10: 2, k02: 1, x25: 1 } }] },
    {
      id: "vd-me", ten: "Mẹ", vt: "Mẹ", ns: "1989-08-02", gt: "nu", viDu: true, daThay: ["x02", "k06", "x23", "k13", "x31", "x26"],
      luot: [
        { id: "m2", ngay: "2026-11-02", tl: meT11, xoay: ["k13", "x31", "x26"], xtl: { k13: 1, x31: 0, x26: 0 } },
        { id: "m1", ngay: "2026-08-03", tl: meT8, xoay: ["x02", "k06", "x23"], xtl: { x02: 1, k06: 0, x23: 0 } },
      ],
    },
    { id: "vd-an", ten: "Bé An", vt: "Con", ns: "2017-05-20", gt: "nu", viDu: true, daThay: ["x13", "k11", "x21"], luot: [{ id: "a1", ngay: "2026-08-03", tl: anT8, xoay: ["x13", "k11", "x21"], xtl: { x13: 1, k11: 1, x21: 1 } }] },
  ];
}
