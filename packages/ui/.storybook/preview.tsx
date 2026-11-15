import type { Preview } from '@storybook/react-vite';
import './storybook.css';

/** Toolbar switches for the three axes the tokens respond to: theme, surface, text size. */
const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: { icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
    surface: {
      description: 'Surface',
      toolbar: { icon: 'browser', items: ['family', 'desk', 'sponsor'], dynamicTitle: true },
    },
    text: {
      description: 'Text size',
      toolbar: { icon: 'zoom', items: ['normal', 'large'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light', surface: 'family', text: 'normal' },
  decorators: [
    (Story, ctx) => {
      document.documentElement.dataset.theme = ctx.globals.theme;
      return (
        <div
          data-surface={ctx.globals.surface}
          {...(ctx.globals.text === 'large' ? { 'data-text': 'large' } : {})}
          className="bg-paper p-6 text-ink"
        >
          <Story />
        </div>
      );
    },
  ],
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
};
export default preview;
