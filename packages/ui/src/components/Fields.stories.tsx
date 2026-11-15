import type { Meta, StoryObj } from '@storybook/react-vite';
import { HeartHandshake } from 'lucide-react';
import { TextField } from './TextField';
import { EmptyState } from './EmptyState';
import { SandboxBadge } from './SandboxBadge';
import { Kbd } from './Kbd';
import { Wordmark } from './Wordmark';

const meta: Meta = { title: 'Foundations/Fields and chrome' };
export default meta;

export const Fields: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-5">
      <TextField label="Email" type="email" />
      <TextField label="6-digit code" hint="From your authenticator app" inputMode="numeric" />
      <TextField label="Password" type="password" error="That email and password don't match." />
    </div>
  ),
};

export const Empty: StoryObj = {
  render: () => (
    <EmptyState icon={<HeartHandshake aria-hidden />} title="Your family card starts here">
      Once Tomoni has checked your family's medicines, each person's status shows here every morning.
    </EmptyState>
  ),
};

export const Chrome: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6">
      <SandboxBadge
        label="Sandbox"
        short="Test data only."
        detail="Test data only. Mocked: telephony, llm."
      />
      <Wordmark className="text-4xl" />
      <p>
        Press <Kbd>j</Kbd> and <Kbd>k</Kbd> to move through the queue.
      </p>
      <p lang="hi" className="text-xl">
        दवाइयाँ · <span lang="gu">દવાઓ</span> · <span lang="ta">மருந்துகள்</span>
      </p>
    </div>
  ),
};
