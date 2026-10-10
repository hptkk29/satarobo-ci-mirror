// 2 cơ sở Sata Robo: 211 NHT (CS1) + 114 Hoàng Diệu (CS2).
//
// ⚠️ Số điện thoại và Zalo KHÔNG còn theo từng cơ sở [24/09/2026]. Số duy nhất của công ty
// nằm ở `SATA_ROBO_PHONE` (`lib/locations.ts`); ba trường cũ ở đây đã được GỠ chứ không
// gán cùng một giá trị, để `tsc` liệt kê đủ chỗ phải sửa.

export interface Location {
  id: number;
  code: "CS1" | "CS2";
  name: string;
  address: string;
  workingHours: string;
  mapEmbed: string;
  mapLat: number;
  mapLng: number;
  isHQ: boolean;
  isUpcoming?: boolean;
  note: string;
}

export const locations: Location[] = [
  {
    id: 1,
    code: "CS1",
    name: "Cơ sở 1 - Nguyễn Hữu Thọ",
    address: "211 Nguyễn Hữu Thọ, Đà Nẵng",
    workingHours: "T2 - T7: 8:00 - 20:00",
    mapEmbed:
      "https://www.google.com/maps?q=211+Nguyễn+Hữu+Thọ,+Đà+Nẵng&z=16&output=embed&hl=vi",
    mapLat: 16.045,
    mapLng: 108.22,
    isHQ: true,
    note: "Phòng Lab lớn, đầy đủ trang thiết bị",
  },
  {
    id: 2,
    code: "CS2",
    name: "Cơ sở 2 - Hoàng Diệu",
    address: "114 Hoàng Diệu, Đà Nẵng",
    workingHours: "T2 - T7: 8:00 - 20:00",
    mapEmbed:
      "https://www.google.com/maps?q=114+Hoàng+Diệu,+Đà+Nẵng&z=16&output=embed&hl=vi",
    mapLat: 16.06,
    mapLng: 108.215,
    isHQ: false,
    note: "Phục vụ khu vực Hải Châu",
  },
];
