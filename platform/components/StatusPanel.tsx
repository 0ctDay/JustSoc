export default function StatusPanel({ title, description, tone = 'neutral' }: { title: string; description: string; tone?: 'neutral' | 'error' }) {
  return (
    <section className={`card status-panel status-panel-${tone}`}>
      <h2 className="section-card-title">{title}</h2>
      <p className="section-card-description">{description}</p>
    </section>
  );
}
