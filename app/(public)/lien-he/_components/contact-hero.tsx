export function ContactHero() {
  return (
    <section
      className="overflow-hidden w-full"
      style={{ background: 'linear-gradient(160deg, #fff9f5 0%, #ffffff 50%, #f5f3ff 100%)' }}
    >
      <div className="container-site py-14 md:py-18 text-center max-w-2xl mx-auto">
        <span className="badge-orange mb-4 inline-block">Liên hệ</span>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight text-text-dark mb-4">
          Chúng tôi luôn{' '}
          <span className="text-gradient-orange-purple">sẵn sàng hỗ trợ</span>
        </h1>
        <p className="text-lg text-text-muted leading-relaxed">
          Tư vấn khoá học, hợp tác B2B hay bất kỳ thắc mắc nào — đội ngũ Sata Robo phản hồi trong
          vòng 30 phút giờ hành chính.
        </p>
      </div>
    </section>
  )
}
