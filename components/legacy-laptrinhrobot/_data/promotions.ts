export interface PrimaryPromotion {
  id: string;
  title: string;
  highlight: string;
  description: string;
  details: string[];
  cta: string;
  target: string;
  icon: string;
  featured?: boolean;
}

export interface SecondaryPromotion {
  id: string;
  title: string;
  highlight: string;
  description: string;
  condition: string;
  note: string;
  icon: string;
}

export interface Promotions {
  primary: PrimaryPromotion[];
  secondary: SecondaryPromotion[];
}

export const promotions: Promotions = {
  primary: [
    {
      id: "early-bird",
      title: "Ưu đãi khai giảng",
      highlight: "Giảm đến 25%",
      description:
        "Dành cho phụ huynh đăng ký trong chương trình khai giảng: Sata1/Sata2 giảm 10%, Combo giảm 15%, Sata3-Sata7 giảm 25%. Sata8 giá cố định, không áp dụng giảm giá.",
      details: [
        "Áp dụng đến hết 31/12/2026",
        "Sata1/Sata2 −10% · Combo −15% · Sata3-Sata7 −25%",
        "Không áp dụng cho Sata8 (giá cố định)",
      ],
      cta: "Đăng ký giữ ưu đãi",
      target: "registration-form",
      icon: "Sparkles",
      featured: true,
    },
    {
      id: "combo",
      title: "Combo luyện thi",
      highlight: "Giá ưu đãi",
      description:
        "Học trọn Robosim Master + Đấu trường Robot, từ mô phỏng RoboSim đến robot Beta thật, phù hợp khi bố mẹ muốn con đi đủ lộ trình luyện thi.",
      details: ["32 buổi - 90 phút/buổi", "Tổng 48 giờ luyện thi", "Tiết kiệm vượt trội"],
      cta: "Chọn gói Combo",
      target: "roadmap",
      icon: "Trophy",
    },
    {
      id: "installment",
      title: "Trả góp 0%",
      highlight: "Sata3-Sata7",
      description:
        "Áp dụng cho nhóm khóa chuyên sâu 48 buổi từ Sata3 đến Sata7. Phụ huynh có thể chia nhỏ học phí theo tháng để dễ đầu tư dài hạn cho con.",
      details: ["Áp dụng: Sata3 đến Sata7", "Chia nhỏ học phí theo từng tháng", "Chỉ cần CCCD theo chính sách trả góp"],
      cta: "Tư vấn trả góp",
      target: "registration-form",
      icon: "CreditCard",
    },
  ],
  secondary: [
    {
      id: "referral",
      title: "Referral",
      highlight: "Giới thiệu bạn bè",
      description: "Người giới thiệu nhận thưởng tiền mặt. Người được giới thiệu được giảm thêm học phí.",
      condition: "Bạn được giới thiệu đóng tiền lần đầu. Không giới hạn số lượng bạn giới thiệu.",
      note: "Chỉ áp dụng 1 trong 3 ưu đãi cộng thêm: Referral, Gói Anh/Chị/Em, Gói đội thi 2 HV.",
      icon: "Gift",
    },
    {
      id: "siblings",
      title: "Gói Anh/Chị/Em",
      highlight: "Con thứ 2 giảm thêm 15%",
      description:
        "Gia đình có 2 con đăng ký, con thứ 2 được giảm thêm 15%. Gia đình có 3 con trở lên, con thứ 3 trở đi giảm 15% và được tặng thêm khóa RoboSim Online.",
      condition: "Phù hợp cho gia đình muốn cho các con học cùng hệ sinh thái Robotics.",
      note: "Chỉ áp dụng 1 trong 3 ưu đãi cộng thêm: Referral, Gói Anh/Chị/Em, Gói đội thi 2 HV.",
      icon: "Users",
    },
    {
      id: "team",
      title: "Gói đội thi 2 HV",
      highlight: "Cả 2 giảm thêm 10%",
      description:
        "2 học viên cùng đăng ký để lập 1 đội thi theo đúng quy chế 2 thí sinh/đội sẽ được giảm thêm 10% trên mức giá đang áp dụng.",
      condition: "Áp dụng khi 2 học viên đăng ký cùng thời điểm.",
      note: "Chỉ áp dụng 1 trong 3 ưu đãi cộng thêm: Referral, Gói Anh/Chị/Em, Gói đội thi 2 HV.",
      icon: "Trophy",
    },
  ],
};
