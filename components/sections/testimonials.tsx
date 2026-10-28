"use client";

import { FadeIn } from "@/components/motion/fade-in";
import { Marquee } from "@/components/magic/marquee";
import { cn } from "@/lib/utils";

// F-UI-3 — 8 PH reviews chia 2 hàng marquee ngược chiều. Hard-coded
// hiện tại; future pull từ DB/CMS khi có testimonial admin module.
const FALLBACK_TESTIMONIALS = [
  {
    name: "Chị Nguyễn Thị Hà",
    role: "PH bé Tom (8 tuổi)",
    body: "Con học SP1 Robosim được 3 tháng. Từ ghét toán giờ con say mê logic, tự code đèn nháy. Tuyệt vời!",
    location: "Hải Châu, Đà Nẵng",
  },
  {
    name: "Anh Trần Văn Đức",
    role: "PH bé Bin (10 tuổi)",
    body: "Lớp 1:8 tại cơ sở Hoà Khánh, GV nhiệt tình. Con đã đoạt giải Robothon cấp tỉnh tháng trước.",
    location: "Liên Chiểu, Đà Nẵng",
  },
  {
    name: "Cô Lê Hoài Anh",
    role: "Hiệu trưởng TH ABC",
    body: "Sata Robo triển khai Lab STEM cho trường rất chuyên nghiệp. GV được training kỹ, HS rất hào hứng.",
    location: "Sơn Trà, Đà Nẵng",
  },
  {
    name: "Chị Phạm Mai Linh",
    role: "PH bé Mít (7 tuổi)",
    body: "Học online qua Robosim tiện cực kỳ! Không phải đưa con đi đâu, GV vẫn theo sát con từng buổi.",
    location: "Cẩm Lệ, Đà Nẵng",
  },
  {
    name: "Anh Hoàng Quốc Bảo",
    role: "PH bé Bống (12 tuổi)",
    body: "Con đậu vòng quốc gia WRO 2025! Cảm ơn các thầy cô đã định hướng đúng đắn cho con.",
    location: "Thanh Khê, Đà Nẵng",
  },
  {
    name: "Chị Vũ Thuỳ Dương",
    role: "PH bé An (9 tuổi)",
    body: "Giá hợp lý, con vui mỗi buổi. Khoá K2 con đã làm được robot nhặt rác hoàn chỉnh!",
    location: "Ngũ Hành Sơn, Đà Nẵng",
  },
  {
    name: "Anh Đỗ Văn Hùng",
    role: "PH bé Khánh (11 tuổi)",
    body: "Đã thử 2 trung tâm khác trước khi tìm Sata Robo. Đây là nơi duy nhất con không bỏ giữa chừng.",
    location: "Hải Châu, Đà Nẵng",
  },
  {
    name: "Chị Bùi Thị Lan",
    role: "PH bé Khoa (8 tuổi)",
    body: "Cô Trang tư vấn rất tâm huyết, đúng nhu cầu của con. Đăng ký 12 tháng luôn không hối hận.",
    location: "Hoà Vang, Đà Nẵng",
  },
];

type Testimonial = (typeof FALLBACK_TESTIMONIALS)[number];

function initialOf(name: string) {
  const last = name.split(" ").slice(-1)[0];
  return last ? last.charAt(0) : "S";
}

function TestimonialCard({ body, name, role, location }: Testimonial) {
  return (
    <figure
      className={cn(
        "relative mx-2 w-72 cursor-pointer overflow-hidden rounded-2xl border p-5 sm:w-80",
        "border-gray-200 bg-white hover:bg-orange-50/50",
        "shadow-sm transition-all hover:shadow-md",
      )}
    >
      <div className="mb-2 flex text-sm text-yellow-400">★★★★★</div>

      <blockquote className="mb-4 line-clamp-4 text-sm leading-relaxed text-gray-700">
        &ldquo;{body}&rdquo;
      </blockquote>

      <figcaption className="flex flex-col">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-purple-500 text-sm font-bold text-white">
            {initialOf(name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900">
              {name}
            </div>
            <div className="truncate text-xs text-gray-500">{role}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-400">📍 {location}</div>
      </figcaption>
    </figure>
  );
}

export function Testimonials({
  testimonials = FALLBACK_TESTIMONIALS,
}: {
  testimonials?: typeof FALLBACK_TESTIMONIALS;
}) {
  const firstRow = testimonials.slice(0, 4);
  const secondRow = testimonials.slice(4);

  return (
    <section className="overflow-hidden bg-gradient-to-b from-gray-50 to-white py-16">
      <div className="mx-auto mb-8 max-w-6xl px-4 sm:mb-12 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-orange-100 px-4 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                Phụ huynh nói gì
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl md:text-5xl">
              <span className="text-gradient-warm">2,000+ phụ huynh</span> tin
              tưởng
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-gray-600 sm:text-lg">
              Những phản hồi thật từ PH đã cho con học tại Sata Robo.
            </p>
          </div>
        </FadeIn>
      </div>

      <div className="relative flex flex-col gap-4">
        <Marquee pauseOnHover className="[--duration:50s]">
          {firstRow.map((t) => (
            <TestimonialCard key={t.name} {...t} />
          ))}
        </Marquee>
        <Marquee pauseOnHover reverse className="[--duration:50s]">
          {secondRow.map((t) => (
            <TestimonialCard key={t.name} {...t} />
          ))}
        </Marquee>

        {/* Side fade masks — giữ marquee không cụt cạnh khi loop */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/6 bg-gradient-to-r from-gray-50 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/6 bg-gradient-to-l from-white to-transparent" />
      </div>
    </section>
  );
}
