"use client";

import { useState, useEffect } from "react";
import MobileCarousel from "./MobileCarousel";

interface TestiItem {
  id: string;
  initials: string;
  name: string;
  role: string;
  quote: string;
  videoId: string;
  avatarBg: string;
}

const FALLBACK_ITEMS: TestiItem[] = [
  { id: "t1", initials: "NA", name: "Anh Ngọc Anh", role: "Phụ huynh bạn Duy Tùng · Đà Nẵng",
    quote: '"Con học 3 tuần, từ chỗ không biết bắt đầu từ đâu đến khi thi thử đạt 85% điểm. Điều tôi thích nhất là AI chấm bài ngay — tôi biết chắc con hiểu bài trước khi học tiếp, khác hoàn toàn so với xem YouTube."',
    videoId: "anInoYFGrF0", avatarBg: "#5B2D8E" },
  { id: "t2", initials: "TS", name: "Anh Trường Sơn", role: "Phụ huynh bạn Minh Châu · Đà Nẵng",
    quote: '"Ban đầu lo con học Robotics sẽ khó theo. Nhưng sau vài buổi con đã hiểu cách robot nhận lệnh, biết sửa lỗi từng bước và hào hứng kể lại sản phẩm sau mỗi buổi học."',
    videoId: "bqB2c7AlSfE", avatarBg: "#7C3AED" },
  { id: "t3", initials: "MT", name: "Chị Mỹ Trang", role: "Phụ huynh bạn Gia Hân · Đà Nẵng",
    quote: '"Con thi Robotics năm ngoái không vào được vòng chung kết vì không có chiến lược. Năm nay học khóa này, con tự làm được bài tập và hiểu rõ cách sắp xếp thứ tự nhiệm vụ. Tự tin hơn hẳn khi bước vào phòng thi!"',
    videoId: "9MJFC4v8cbU", avatarBg: "#3D1A6E" },
];

function TestiCard({ item, onPlay }: { item: TestiItem; onPlay: (videoId: string) => void }) {
  return (
    <article className="lp-testi__card" aria-label={`Đánh giá từ ${item.name}`}>
      <div className="lp-testi__stars" aria-label="5 sao">★★★★★</div>
      <p className="lp-testi__quote">{item.quote}</p>
      <div className="lp-testi__author">
        <div className="lp-testi__avatar" style={{ background: item.avatarBg }} aria-hidden="true">{item.initials}</div>
        <div>
          <div className="lp-testi__name">{item.name}</div>
          <div className="lp-testi__role">{item.role}</div>
        </div>
      </div>
      <button type="button" className="lp-testi__video" onClick={() => onPlay(item.videoId)} aria-label={`Phát video cảm nhận của ${item.name}`}>
        <img
          src={`https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`}
          alt={`Ảnh thumbnail video của ${item.name}`}
          className="lp-testi__thumb"
          loading="lazy"
          width={480}
          height={360}
        />
        <div className="lp-testi__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M8 5v14l11-7z" /></svg>
        </div>
        <span className="lp-testi__video-caption">Bấm để xem</span>
      </button>
    </article>
  );
}

function VideoModal({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lp-testi-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Video cảm nhận học viên">
      <div className="lp-testi-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lp-testi-modal__close" onClick={onClose} aria-label="Đóng video">×</button>
        <div className="lp-testi-modal__ratio">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
            title="Video cảm nhận học viên Sata Robo"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}

export default function Testimonials({ items = FALLBACK_ITEMS }: { items?: TestiItem[] }) {
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const openVideo = (videoId: string) => setActiveVideo(videoId);
  const closeVideo = () => setActiveVideo(null);

  return (
    <section className="lp-testi" id="testimonials" aria-labelledby="testi-heading">
      <div className="container">
        <div className="lp-testi__badge" aria-hidden="true">
          <span className="lp-testi__badge-dot" />
          PHỤ HUYNH VÀ HỌC SINH NÓI GÌ
        </div>

        <h2 id="testi-heading" className="lp-testi__heading">
          Hàng trăm học sinh đã tham gia khóa học<br />
          <span>và hào hứng làm được bài tập thực tế</span>
        </h2>

        <p className="lp-testi__sub">
          Cảm nhận thực tế từ phụ huynh và học sinh đã trải qua hành trình luyện thi cùng Sata Robo
        </p>

        <div className="lp-testi__grid">
          {items.map((item) => <TestiCard key={item.id} item={item} onPlay={openVideo} />)}
        </div>

        <div className="lp-testi__carousel">
          <MobileCarousel autoInterval={4500} accentColor="#9B6DD4" isPaused={activeVideo !== null}>
            {items.map((item) => <TestiCard key={item.id} item={item} onPlay={openVideo} />)}
          </MobileCarousel>
        </div>
      </div>

      {activeVideo && <VideoModal videoId={activeVideo} onClose={closeVideo} />}
    </section>
  );
}
