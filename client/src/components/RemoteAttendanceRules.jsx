import './RemoteAttendanceRules.css';

export default function RemoteAttendanceRules({ flexibleHours = false }) {
  const flexible = Boolean(flexibleHours);

  return (
    <section className="att-rules" aria-label="Remote attendance rules">
      <header className="att-rules-head">
        <h2>How each check-in is marked</h2>
        <p>
          The clock starts when a check opens. Complete it in the window below.
        </p>
      </header>
      {flexible ? (
        <article className="att-rules-card att-rules-card-flex is-active">
          <p className="att-rules-lead">
            Open the portal and check in when you start work (no first check-in email). You only get
            email for random check-ins during assigned hours, then check out when you finish.
          </p>
          <ul>
            <li>
              <span>First check-in</span>
              <strong>No email — start yourself</strong>
            </li>
            <li>
              <span>Random check-in</span>
              <strong>Email during assigned hours</strong>
            </li>
            <li>
              <span>Late</span>
              <strong>After 15 minutes</strong>
            </li>
            <li>
              <span>Absent</span>
              <strong>After 40 minutes</strong>
            </li>
          </ul>
        </article>
      ) : (
        <article className="att-rules-card is-active">
          <p className="att-rules-lead">
            First check-in at shift start, then random checks during working hours.
          </p>
          <ul>
            <li>
              <span>On time</span>
              <strong>Within 15 minutes</strong>
            </li>
            <li>
              <span>Late</span>
              <strong>After 15 minutes</strong>
            </li>
            <li>
              <span>Absent</span>
              <strong>After 40 minutes</strong>
            </li>
          </ul>
        </article>
      )}
    </section>
  );
}
