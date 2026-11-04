"use client";

// Phase 4.UI.RESET.1 — HQ = 258 Lê Thanh Nghị, Hòa Cường; email = thongtin@satarobo.vn.

import { Rocket, Phone, Mail, MapPin, Clock, MessageCircle } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";

export default function FinalCTA() {
  return (
    <section id="final-cta" className="section-padding bg-gradient-to-br from-soft-cream via-white to-soft-yellow relative overflow-hidden">
      <div className="absolute top-0 right-0 w-72 h-72 bg-primary-orange/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-purple/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="container-site relative z-10">
        <div className="text-center mb-10 sm:mb-12 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-orange/10 text-primary-orange text-xs sm:text-sm font-bold uppercase tracking-wider mb-5">
            <Rocket className="w-4 h-4" />
            HÀNH ĐỘNG NGAY
          </div>

          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-text-dark leading-tight mb-4">
            Bố mẹ đã xem đến cuối — câu hỏi bây giờ{" "}
            <span className="text-gradient-orange-purple">
              không phải &ldquo;có nên hay không&rdquo;
            </span>
          </h2>

          <p className="text-base sm:text-xl text-text-dark font-bold mb-3">
            Mà là: <span className="text-primary-orange">&ldquo;Con mình bắt đầu hành trình Robotics khi nào?&rdquo;</span>
          </p>
          <p className="text-sm sm:text-base text-text-muted">Hôm nay? Tháng sau? Hay năm sau?</p>
        </div>

        <div className="max-w-2xl mx-auto bg-white border-l-4 border-primary-orange rounded-2xl p-6 sm:p-7 shadow-lg mb-10">
          <p className="text-sm sm:text-base text-text-dark leading-relaxed mb-3">
            Mỗi năm trôi qua = <strong>1 năm con bị bạn bè khác bứt tốc trước</strong>.
          </p>
          <p className="text-sm sm:text-base text-text-dark leading-relaxed">
            Robotics không đợi ai — và bố mẹ cũng đừng để con đợi.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-2xl mx-auto mb-12">
          <a
            href="#registration-form"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("registration-form")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="cta-pulse cta-shine flex-1 px-6 py-4 bg-gradient-orange-purple text-white font-black text-base sm:text-lg rounded-xl
              hover:scale-[1.03] active:scale-95 transition text-center"
          >
            🎯 ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ →
          </a>
          <a
            href={SATA_ROBO_PHONE.zalo}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-6 py-4 bg-white text-primary-purple border-2 border-primary-purple font-black text-base sm:text-lg rounded-xl
              shadow-md hover:shadow-lg hover:bg-primary-purple hover:text-white hover:scale-[1.03] active:scale-95 transition text-center
              inline-flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-5 h-5" />
            CHAT ZALO
          </a>
        </div>

        <div className="max-w-5xl mx-auto bg-text-dark text-white rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="mb-6">
            <h3 className="font-black text-xl sm:text-2xl leading-tight">Liên hệ trực tiếp Học viện Sata Robo</h3>
            <p className="text-sm text-white/70 mt-1">Và đặt buổi học thử 1-1 miễn phí cho con.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="flex items-start gap-3 p-4 rounded-xl bg-white/10 hover:bg-white/15 transition group">
              <div className="w-10 h-10 rounded-lg bg-primary-orange text-white flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition">
                <Phone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white/60 uppercase">Hotline</div>
                <div className="text-sm sm:text-base font-bold text-white whitespace-nowrap">{SATA_ROBO_PHONE.hien}</div>
              </div>
            </a>

            <a href="mailto:thongtin@satarobo.vn" className="flex items-start gap-3 p-4 rounded-xl bg-white/10 hover:bg-white/15 transition group">
              <div className="w-10 h-10 rounded-lg bg-primary-purple text-white flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition">
                <Mail className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white/60 uppercase">Email</div>
                <div className="text-sm font-bold text-white whitespace-nowrap">thongtin@satarobo.vn</div>
              </div>
            </a>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-white/10">
              <div className="w-10 h-10 rounded-lg bg-primary-orange text-white flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white/60 uppercase">Trụ sở</div>
                <div className="text-xs sm:text-sm font-bold text-white leading-snug break-words">
                  211 Nguyễn Hữu Thọ, Đà Nẵng
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-white/10">
              <div className="w-10 h-10 rounded-lg bg-primary-purple text-white flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white/60 uppercase">Giờ làm việc</div>
                <div className="text-xs sm:text-sm font-bold text-white leading-snug">T2 – T7<br />8:00 – 20:00</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
