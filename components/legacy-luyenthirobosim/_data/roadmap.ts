export interface RoadmapStage {
  id: number;
  colorKey: string;
  dot: string;
  sessions: string;
  title: string;
  intro: string;
  points: string[];
  summary: string;
}

const roadmap: RoadmapStage[] = [
  {
    id: 1,
    colorKey: "green",
    dot: "🟢",
    sessions: "Buổi 1 → 5",
    title: "CHẶNG 1 — LÀM QUEN & ÔN NỀN",
    intro: "Trước khi giải đề, con cần ôn lại nền tảng:",
    points: [
      "Kiến thức quan trọng đã học trước đó",
      "Cách dùng RoboSim — sa bàn ảo, mô phỏng đề thi thật",
      "Phân tích cấu trúc đề thi vòng loại RBT2026 (luật chấm — vật cản — cách tính điểm)",
    ],
    summary:
      'Đầu chặng: Con bỡ ngỡ. Cuối chặng: Con đã hiểu rõ "đề trông ra sao" và "thi như thế nào".',
  },
  {
    id: 2,
    colorKey: "yellow",
    dot: "🟡",
    sessions: "Buổi 6 → 14",
    title: "CHẶNG 2 — THỰC HÀNH GIẢI ĐỀ THẬT",
    intro:
      "Đây là chặng DÀI NHẤT — và cũng là chặng CỐT LÕI nhất. Con thực hành trực tiếp với chính đề thi vòng loại đã mở:",
    points: [
      "Giải từng câu, từng phần",
      "Kiểu THƯỜNG: ai cũng làm được, nhưng tốn thời gian",
      "Kiểu TỐI ƯU: nhanh hơn, chính xác hơn — chỉ giảng viên Sata Robo có",
    ],
    summary: "Cuối chặng: Con không còn lúng túng với bất kỳ dạng câu nào.",
  },
  {
    id: 3,
    colorKey: "red",
    dot: "🔴",
    sessions: "Buổi 15 → 18",
    title: "CHẶNG 3 — TỐI ƯU ROBOT & PHẢN XẠ 180 PHÚT",
    intro: "Đây là chặng QUYẾT ĐỊNH. Mình cùng con:",
    points: [
      "TỐI ƯU robot — cách di chuyển nhanh và chính xác hơn",
      "TỐI ƯU phần lập trình — gọn hơn, ít bug hơn",
      "TỰ THỰC HÀNH lại đề thi trong đúng 180 phút",
    ],
    summary: "Cuối chặng: Con SẴN SÀNG cho 180 phút thi thật.",
  },
];

export default roadmap;
