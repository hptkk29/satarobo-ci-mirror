"use client";

// Phase 4.UI.FIX.3 PART E — UPDATED centers array 4→2 cơ sở, label "4 trung tâm" → "2 cơ sở"

import Image from "next/image";
import { ArrowRight, Building2, MapPin, type LucideIcon } from "lucide-react";
import { trackPixelEvent, trackGA4Event } from "./_utils/tracking";

interface Center {
  icon: LucideIcon;
  name: string;
  address: string;
}

const centers: Center[] = [
  { icon: Building2, name: "Cơ sở Nguyễn Hữu Thọ", address: "211 Nguyễn Hữu Thọ, Đà Nẵng" },
  { icon: MapPin, name: "Cơ sở Hoàng Diệu", address: "114 Hoàng Diệu, Đà Nẵng" },
];

function Highlight({ children, tone = "orange" }: { children: React.ReactNode; tone?: "orange" | "purple" }) {
  return (
    <span className={tone === "purple" ? "font-bold text-primary-purple" : "font-bold text-primary-orange"}>
      {children}
    </span>
  );
}

export default function Hero() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    trackPixelEvent("HeroCTAClick", { target: id });
    trackGA4Event("hero_cta_click", { target: id });
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-white to-purple-50 py-16">
      <div className="container-site">
        <div className="grid max-w-full gap-7 lg:grid-cols-[1fr_0.92fr] lg:items-center xl:gap-10">
          <div className="min-w-0 text-center lg:text-left">
            <div className="mb-4 inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2 shadow-card">
              <span className="text-xl">🏆</span>
              <span className="text-xs font-black uppercase leading-tight text-primary-purple sm:text-sm">
                Học viện Robotics tại Đà Nẵng
              </span>
            </div>

            <h1 className="mx-auto mb-4 max-w-[21rem] break-words text-[1.75rem] font-black leading-[1.14] text-text-dark sm:max-w-3xl sm:text-5xl lg:mx-0">
              Bố mẹ Đà Nẵng đang tìm chỗ học{" "}
              <span className="text-gradient-orange-purple">Robotics</span> chất lượng cho con?
            </h1>

            <p className="mx-auto mb-5 max-w-[21rem] break-words text-sm font-semibold leading-relaxed text-text-dark sm:max-w-2xl sm:text-base lg:mx-0">
              Còn <span className="text-primary-orange">Robotics</span> - ngành sẽ định hình tương lai 10 năm tới -{" "}
              <span className="underline decoration-primary-purple decoration-2">bố mẹ đang gửi con ở đâu?</span>
            </p>

            <div className="mx-auto mb-5 max-w-full rounded-3xl border border-primary-orange/25 bg-white/95 p-4 text-left shadow-card sm:max-w-2xl sm:p-5 lg:mx-0">
              <div className="space-y-3 text-sm leading-relaxed text-text-dark sm:text-base">
                <p>
                  <Highlight>10 năm</Highlight> xây một hệ sinh thái Giáo dục giúp phát triển tư duy cho thế hệ trẻ Việt Nam.
                  Hành trình bắt đầu từ <Highlight>Satamath</Highlight>, nơi hàng nghìn trẻ em Đà Nẵng học cách tư duy toán học.
                </p>
                <p>
                  Hôm nay, <Highlight>Sata Robo</Highlight> tiếp nối mạch tư duy đó với{" "}
                  <Highlight tone="purple">tư duy công nghệ</Highlight>: <Highlight>lập trình, robotics</Highlight>.
                </p>
                <div className="rounded-2xl border border-primary-purple/20 bg-soft-purple/70 px-4 py-3 text-sm font-black text-primary-purple sm:text-base">
                  Toán học rèn tư duy. Công nghệ mở thế giới.
                </div>
                <p>
                  <Highlight tone="purple">Với lộ trình 5 năm</Highlight> bài bản
                  cho con từ <Highlight>lớp 1 đến lớp 8</Highlight>. Bố mẹ hãy cho con bắt đầu{" "}
                  <Highlight tone="purple">HỌC NGAY - TỪ HÔM NAY</Highlight> ở <Highlight>các trung tâm</Highlight> tại Đà Nẵng,
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <button onClick={() => scrollTo("registration-form")} className="btn-primary cta-pulse cta-shine group w-full text-sm sm:w-auto sm:text-base">
                Đặt buổi học thử 1-1 miễn phí
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </button>
              <button onClick={() => scrollTo("roadmap")} className="btn-outline w-full text-sm sm:w-auto sm:text-base">
                Xem lộ trình học
              </button>
            </div>
          </div>

          <div className="min-w-0">
            <div className="overflow-hidden rounded-[1.75rem] bg-gradient-orange-purple px-5 pt-5 shadow-2xl sm:px-8 sm:pt-7">
              <div className="relative flex min-h-[210px] items-end justify-center sm:min-h-[280px] lg:min-h-[320px]">
                <div className="absolute left-4 top-4 z-20 rounded-2xl bg-white/15 px-4 py-3 text-white backdrop-blur">
                  <div className="text-xs font-bold uppercase text-white/75">Sata Robo</div>
                  <div className="text-lg font-black">Robotics AI</div>
                </div>
                <Image
                  src="/laptrinhrobot/LinhVat.png"
                  alt="Linh vật Sata Robo"
                  className="relative z-10 w-[68%] max-w-[310px] h-auto object-contain drop-shadow-2xl animate-float"
                  width={310}
                  height={310}
                  priority
                />
              </div>
            </div>

            <div className="relative z-20 mx-2 -mt-5 rounded-[1.35rem] border border-primary-orange/20 bg-white/95 p-4 shadow-xl backdrop-blur sm:mx-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-primary-orange">2 cơ sở tại Đà Nẵng</div>
                  <div className="text-sm font-semibold text-text-muted">Chọn cơ sở thuận tiện cho lịch học của con</div>
                </div>
                <MapPin className="h-5 w-5 flex-shrink-0 text-primary-purple" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {centers.map(({ icon: Icon, name, address }) => (
                  <div key={name} className="rounded-2xl border border-primary-orange/20 bg-orange-50/45 p-3 shadow-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-white text-primary-orange shadow-sm">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-black leading-tight text-text-dark">{name}</span>
                    </div>
                    <p className="pl-10 text-xs font-semibold leading-relaxed text-text-muted">{address}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
