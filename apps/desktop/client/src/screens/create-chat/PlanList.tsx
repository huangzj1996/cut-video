import { planStatusLabel, type PlanStep } from './view-model';

export function PlanList({
  steps,
  variant = 'aside',
}: {
  steps: readonly PlanStep[];
  variant?: 'aside' | 'inline';
}) {
  return (
    <div className={`cc-plan-block cc-plan-block--${variant}`}>
      <p className="cc-aside-title">执行要点</p>
      <ul className="cc-plan">
        {steps.map((step) => (
          <li className="cc-plan-row" key={step.id}>
            <span className={`cc-plan-dot cc-plan-dot--${step.tone}`} aria-hidden="true" />
            <span className="cc-plan-copy">
              <span className="cc-plan-title">
                {step.id} {step.title}
              </span>
              <span className="cc-plan-detail">{step.detail}</span>
            </span>
            <span className={`cc-plan-status cc-plan-status--${step.tone}`}>
              {planStatusLabel(step.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
