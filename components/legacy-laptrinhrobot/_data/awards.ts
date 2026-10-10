export interface AwardPrize {
  rank: number | string;
  icon: string;
  name: string;
  reward: string;
  note: string;
}

export interface InternalAwards {
  totalValue: string;
  perYear: number;
  perEvent: string;
  description: string;
  prizes: AwardPrize[];
}

export const internalAwards: InternalAwards = {
  totalValue: "37.200.000đ",
  perYear: 12,
  perEvent: "3.100.000đ",
  description:
    "12 kỳ thi hằng tháng dành riêng cho học viên tại các trung tâm Sata Robo.",
  prizes: [
    { rank: 1, icon: "🥇", name: "Giải Nhất", reward: "1.200.000đ + Trophy + Chứng nhận", note: "Vinh danh trên fanpage Sata Robo" },
    { rank: 2, icon: "🥈", name: "Giải Nhì", reward: "800.000đ + Chứng nhận", note: "Ảnh lưu niệm tại Lab + gửi Zalo phụ huynh" },
    { rank: 3, icon: "🥉", name: "Giải Ba", reward: "500.000đ + Chứng nhận", note: "Cùng cơ chế vinh danh" },
    { rank: "KK", icon: "🎖️", name: "Khuyến Khích x 3", reward: "200.000đ x 3 (voucher/kit)", note: "3 học viên xuất sắc tiếp theo" },
  ],
};
