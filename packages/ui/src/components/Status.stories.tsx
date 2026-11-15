import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusPill } from './StatusPill';
import { Notice } from './Notice';

const meta: Meta = { title: 'Status/Access Score and notices' };
export default meta;

/** Never color alone: icon + words + color (DESIGN principle 1). */
export const AccessScore: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <p>
        Atorvastatin 20 mg <StatusPill status="ok">No problems in the next 60 days</StatusPill>
      </p>
      <p>
        Metformin 500 mg <StatusPill status="watch">Tier change Jan 1, Tomoni is on it</StatusPill>
      </p>
      <p>
        Clopidogrel 75 mg <StatusPill status="act">Runs out in 6 days, needs you</StatusPill>
      </p>
    </div>
  ),
};

export const Notices: StoryObj = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-3">
      <Notice title="Asha approved the pharmacy switch">CVS will have Raj's statin ready Thursday.</Notice>
      <Notice tone="ok" title="Refill picked up" />
      <Notice tone="watch" title="Inhaler moves to a higher price tier on January 1">
        Dr. Rao has a switch to review.
      </Notice>
      <Notice tone="act" title="Raj said he feels dizzy when he stands">
        The practice nurse has been told and will call him today.
      </Notice>
    </div>
  ),
};
