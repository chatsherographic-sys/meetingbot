"use client";

type FeatureDisabledPageProps = {
  title: string;
};

export function FeatureDisabledPage({ title }: FeatureDisabledPageProps) {
  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="section-kicker">Disabled</p>
          <h2>{title}</h2>
          <p className="muted">
            This feature has been disabled for the simplified live chat version.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card-body">
          <p className="muted">
            The app now focuses on sessions, bot creation, scheduled bot joins,
            and live Zoom chat templates.
          </p>
        </div>
      </section>
    </div>
  );
}
