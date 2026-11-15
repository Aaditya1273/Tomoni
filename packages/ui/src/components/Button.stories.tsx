import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check } from 'lucide-react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Actions/Button',
  component: Button,
  args: { children: 'Approve switch' },
};
export default meta;
type S = StoryObj<typeof Button>;

export const Primary: S = {};
export const Secondary: S = { args: { variant: 'secondary', children: 'Not now' } };
export const Quiet: S = { args: { variant: 'quiet', children: 'See the evidence' } };
export const Danger: S = { args: { variant: 'danger', children: 'Withdraw consent' } };
export const WithIcon: S = {
  args: { icon: <Check aria-hidden className="size-[1.1em]" />, children: 'Sign renewal' },
};
export const Loading: S = { args: { loading: true, children: 'Sending to pharmacy' } };
export const Block: S = { args: { block: true, children: 'Switch to CVS on Oak Tree Rd' } };
