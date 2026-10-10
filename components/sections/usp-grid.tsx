"use client";

import type { LucideIcon } from "lucide-react";
import { ShieldCheck, Users, Target, Presentation, Gift } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";

// F-UI-2.5 — "5 Cam kết của Sata Robo với Phụ huynh".
// Layout 3–2 căn giữa trên desktop (grid 6 cột), 2 cột trên tablet
// (ô thứ 5 căn giữa), 1 cột xếp dọc trên mobile. Các card cùng width,
// cùng chiều cao trong mỗi hàng (items-stretch + h-full + flex-col).
interface CamKet {
  num: number;
  Icon: LucideIcon;
  title: string;
  paragraphs: string[];
  highlights: string[];
}

const CAM_KET: CamKet[] = [
  {
    num: 1,
    Icon: ShieldCheck,
    title: "Hoàn tiền 100% nếu KHÔNG ĐẠT CAM KẾT",
    paragraphs: [
      "Buổi học đầu tiên 90 phút, nếu con không thích → hoàn tiền 100% học phí đã đóng, không câu hỏi (hoàn lại sau 3 ngày làm việc).",
      "Chương trình áp dụng cho gói Sata8 → VÉ VÀNG CHUNG KẾT KHU VỰC MIỀN TRUNG. Yêu cầu test đầu vào và tuân thủ các quy định trong học tập. Sata Robo hoàn tiền 100% nếu thí sinh không vượt qua vòng loại để tham gia chung kết Miền Trung tại Nghệ An vào tháng 9/2026.",
    ],
    highlights: [
      "nếu con không thích → hoàn tiền 100%",
      "VÉ VÀNG CHUNG KẾT KHU VỰC MIỀN TRUNG",
    ],
  },
  {
    num: 2,
    Icon: Users,
    title: "Lớp nhỏ ≤12 học viên",
    paragraphs: [
      'GV kèm cặp cá nhân hoá cho mỗi học sinh, con không bị bỏ lại phía sau. Chất lượng giảng dạy được đảm bảo. "HỌC KÈM CÔNG NGHỆ".',
    ],
    highlights: ["HỌC KÈM CÔNG NGHỆ"],
  },
  {
    num: 3,
    Icon: Target,
    title: "Học đúng và thi đúng",
    paragraphs: [
      "Robosim là phần mềm bắt buộc trong cuộc thi Sáng tạo Robotics 2026 của Thành Đoàn Đà Nẵng. Chỉ Sata Robo đào tạo phần mềm này và hướng đến giúp các đội thi TRANG BỊ KIẾN THỨC VÀ BẢN LĨNH THI ĐẤU.",
    ],
    highlights: ["TRANG BỊ KIẾN THỨC VÀ BẢN LĨNH THI ĐẤU"],
  },
  {
    num: 4,
    Icon: Presentation,
    title: "Thuyết trình cuối mỗi học phần",
    paragraphs: [
      "Cuối mỗi 12 buổi: 1 buổi thuyết trình trước phụ huynh, ghi hình kỷ niệm. PH thấy kết quả thực tế — minh bạch hoàn toàn. Các học sinh được bảo vệ đề án như 1 KỸ SƯ NHÍ.",
    ],
    highlights: ["KỸ SƯ NHÍ"],
  },
  {
    num: 5,
    Icon: Gift,
    title: "Hỗ trợ lệ phí thi Quốc gia 3 triệu",
    paragraphs: [
      "HV hoàn thành khóa học và tham gia cuộc thi cấp Quốc gia tại HCM trong năm 2026 → HỖ TRỢ 3.000.000Đ/HV/NĂM. Áp dụng cho học viên còn tham gia học đến thời điểm thi.",
    ],
    highlights: ["HỖ TRỢ 3.000.000Đ/HV/NĂM"],
  },
];

// Bọc các cụm `highlights` trong đoạn văn thành <strong> cam brand.
// Split theo cụm dài trước để tránh match lồng nhau.
function renderWithHighlights(
  text: string,
  highlights: string[],
): React.ReactNode {
  if (!highlights.length) return text;
  const sorted = [...highlights].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  return text.split(re).map((part, i) =>
    highlights.includes(part) ? (
      <strong key={i} className="font-bold text-orange-600">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// Vị trí trên grid 6 cột (chỉ áp ở lg). Tablet/mobile dùng auto-flow của grid.
// Card 4 & 5 căn giữa hàng 2 bằng col-start tường minh (không lệ thuộc auto-pack).
// Card 5 (ô lẻ) trên tablet căn giữa để không mồ côi; reset ở lg.
const LG_COL: Record<number, string> = {
  0: "lg:col-span-2",
  1: "lg:col-span-2",
  2: "lg:col-span-2",
  3: "lg:col-start-2 lg:col-span-2",
  4: "md:col-span-2 md:mx-auto md:max-w-[calc(50%-0.75rem)] lg:col-start-4 lg:col-span-2 lg:mx-0 lg:max-w-none",
};

export function UspGrid() {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <div className="mb-12 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-orange-100 px-4 py-1.5">
              <ShieldCheck className="h-4 w-4 text-orange-700" />
              <span className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                Cam kết với phụ huynh
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl md:text-5xl">
              5 Cam kết của{" "}
              <span className="text-gradient-warm">Sata Robo</span> với Phụ huynh
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-gray-600 sm:text-lg">
              Những cam kết rõ ràng, minh bạch — đặt quyền lợi và sự tiến bộ của
              con bạn lên hàng đầu.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-6">
          {CAM_KET.map((c, i) => {
            const { Icon } = c;
            return (
              <RevealOnScroll
                key={c.num}
                direction="up"
                distance={20}
                delay={i * 0.06}
                className={`h-full ${LG_COL[i]}`}
              >
                <article className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-shadow hover:border-orange-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-purple-600 text-base font-black text-white shadow-md shadow-orange-500/25">
                      {c.num}
                    </span>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                      <Icon className="h-5 w-5" />
                    </span>
                  </div>
                  <h3 className="text-lg font-bold leading-snug text-neutral-900">
                    {c.title}
                  </h3>
                  <div className="mt-3 flex-1 space-y-2.5">
                    {c.paragraphs.map((para, pi) => (
                      <p
                        key={pi}
                        className="text-sm leading-relaxed text-neutral-600"
                      >
                        {c.paragraphs.length > 1 && (
                          <span className="mr-1.5 font-bold text-orange-500">
                            •
                          </span>
                        )}
                        {renderWithHighlights(para, c.highlights)}
                      </p>
                    ))}
                  </div>
                </article>
              </RevealOnScroll>
            );
          })}
        </div>
      </div>
    </section>
  );
}
