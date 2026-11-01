"use client";

import MobileCarousel from "./MobileCarousel";

interface CardData {
  icon: string;
  title: string;
  body: string;
}

const CARDS: CardData[] = [
  {
    icon: "🏆",
    title: "Giải thưởng lớn",
    body: "Hàng chục triệu đồng và bằng khen cấp Trung ương Đoàn cho các đội xuất sắc nhất",
  },
  {
    icon: "💡",
    title: "Định hướng tương lai công nghệ",
    body: "Được tiếp cận sớm với lập trình và giải quyết vấn đề — nền tảng cho các ngành công nghệ trong tương lai.",
  },
  {
    icon: "🌍",
    title: "Sân chơi quốc tế",
    body: "Cơ hội đại diện Việt Nam tham dự WRC – World Robot Championship toàn cầu",
  },
  {
    icon: "🧠",
    title: "Kỹ năng thế kỷ 21",
    body: "Rèn tư duy logic, kỹ năng lập trình và giải quyết vấn đề – nền tảng STEM vững chắc",
  },
  {
    icon: "🤖",
    title: "Thi trực tuyến qua RoboSim",
    body: "Vòng loại thi qua phần mềm RoboSim – học sinh luyện bài bản sẽ có lợi thế vượt trội",
  },
  {
    icon: "⏰",
    title: "Hạn đăng ký 19/07/2026",
    body: "Cần ít nhất 4–6 tuần chuẩn bị – bắt đầu học ngay hôm nay để không bị động",
  },
];

const SLIDES = [CARDS.slice(0, 3), CARDS.slice(3, 6)];

function Card({ card }: { card: CardData }) {
  return (
    <article className="lp-contest__card">
      <span className="lp-contest__card-icon" aria-hidden="true">{card.icon}</span>
      <h3 className="lp-contest__card-title">{card.title}</h3>
      <p className="lp-contest__card-body">{card.body}</p>
    </article>
  );
}

function MiniCard({ card }: { card: CardData }) {
  return (
    <div className="lp-contest__mini-card">
      <span className="lp-contest__mini-icon" aria-hidden="true">{card.icon}</span>
      <p className="lp-contest__mini-title">{card.title}</p>
    </div>
  );
}

export default function ContestInfo() {
  return (
    <section className="lp-contest section" id="contest-info" aria-labelledby="contest-heading">
      <div className="container">
        <div className="text-center">
          <span className="lp-contest__badge">🏆 Tầm quan trọng của cuộc thi</span>
        </div>

        <h2 id="contest-heading" className="lp-contest__title text-center">
          Cuộc thi Sáng tạo Robotics 2026
          <br />
          <span className="lp-contest__title-accent">Cơ hội vàng không thể bỏ lỡ</span>
        </h2>

        <p className="lp-contest__subtitle text-center">
          Do Trung ương Đoàn TNCS Hồ Chí Minh tổ chức — uy tín quốc gia, tầm vóc quốc tế
        </p>

        <div className="lp-contest__grid lp-contest__desktop">
          {CARDS.map((card) => (
            <Card key={card.title} card={card} />
          ))}
        </div>

        <div className="lp-contest__mobile">
          <MobileCarousel autoInterval={3200} accentColor="#c084fc">
            {SLIDES.map((group, i) => (
              <div key={i} className="lp-contest__slide-row">
                {group.map((card) => (
                  <MiniCard key={card.title} card={card} />
                ))}
              </div>
            ))}
          </MobileCarousel>
        </div>

        <div className="text-center" style={{ marginTop: "32px" }}>
          <a
            href="https://drive.google.com/file/d/1fE3ALCboUanJlLxFb6Uq7iiJqYu7y4mC/view?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-contest__cta-btn"
          >
            📋 Xem thể lệ cuộc thi Sáng tạo Robotics 2026 đầy đủ →
          </a>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .lp-contest {
              background: linear-gradient(160deg, #0f0529 0%, #1a0845 50%, #0a1535 100%);
              color: #fff;
            }
            .lp-contest__badge {
              display: inline-flex; align-items: center; gap: 6px;
              background: rgba(155, 109, 212, 0.18);
              border: 1px solid rgba(155, 109, 212, 0.5);
              color: #c4a0f0; font-size: 12px; font-weight: 700;
              letter-spacing: .6px; padding: 6px 16px; border-radius: 100px;
              text-transform: uppercase; margin-bottom: 20px;
            }
            .lp-contest__title {
              font-size: clamp(26px, 4.5vw, 42px); font-weight: 800;
              line-height: 1.25; color: #fff; margin-bottom: 12px;
            }
            .lp-contest__title-accent {
              background: linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #7c3aed 100%);
              -webkit-background-clip: text; -webkit-text-fill-color: transparent;
              background-clip: text;
            }
            .lp-contest__subtitle {
              color: rgba(255, 255, 255, 0.65); font-size: 16px;
              max-width: 600px; margin: 0 auto 48px;
            }
            .lp-contest__grid {
              display: grid; grid-template-columns: repeat(3, 1fr);
              gap: 20px; margin-bottom: 40px;
            }
            @media (max-width: 860px) {
              .lp-contest__grid { grid-template-columns: 1fr 1fr; gap: 16px; }
            }
            .lp-contest__card {
              background: rgba(255, 255, 255, 0.05);
              border: 1px solid rgba(155, 109, 212, 0.25);
              border-radius: 16px; padding: 28px 24px; text-align: center;
              transition: border-color .2s, background .2s;
            }
            .lp-contest__card:hover {
              border-color: rgba(155, 109, 212, 0.55);
              background: rgba(155, 109, 212, 0.1);
            }
            .lp-contest__card-icon { display: block; font-size: 32px; margin-bottom: 14px; }
            .lp-contest__card-title {
              font-size: 15px; font-weight: 700; color: #fff;
              margin-bottom: 10px; line-height: 1.4;
            }
            .lp-contest__card-body {
              font-size: 14px; color: rgba(255, 255, 255, 0.65); line-height: 1.6;
            }
            .lp-contest__desktop { display: grid; }
            .lp-contest__mobile  { display: none; }
            @media (max-width: 600px) {
              .lp-contest__desktop { display: none !important; }
              .lp-contest__mobile  { display: block; margin-bottom: 32px; }
            }
            .lp-contest__slide-row {
              display: grid; grid-template-columns: repeat(3, 1fr);
              gap: 8px; padding: 4px 2px 8px;
            }
            .lp-contest__mini-card {
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(155, 109, 212, 0.3);
              border-radius: 14px; padding: 16px 8px 14px; text-align: center;
              display: flex; flex-direction: column; align-items: center;
              gap: 8px; min-height: 110px; justify-content: center;
            }
            .lp-contest__mini-icon { font-size: 26px; line-height: 1; }
            .lp-contest__mini-title {
              font-size: 11px; font-weight: 700; color: #e9d5ff;
              line-height: 1.4; margin: 0;
            }
            .lp-contest__mobile .mc-dots { background: rgba(255,255,255,0.06) !important; }
            .lp-contest__mobile .mc-dot { background: rgba(255,255,255,0.2) !important; }
            .lp-contest__cta-btn {
              display: inline-flex; align-items: center; gap: 8px;
              padding: 15px 32px; border-radius: 12px;
              border: 2px solid #2dd4bf; color: #2dd4bf; background: transparent;
              font-family: 'Be Vietnam Pro', sans-serif;
              font-weight: 700; font-size: 15px; text-decoration: none;
              transition: background .2s, color .2s, box-shadow .2s;
            }
            .lp-contest__cta-btn:hover {
              background: rgba(45, 212, 191, 0.12);
              box-shadow: 0 0 24px rgba(45, 212, 191, 0.25);
            }
            @media (max-width: 540px) {
              .lp-contest__cta-btn { font-size: 13px; padding: 13px 22px; }
            }
          `,
        }}
      />
    </section>
  );
}
