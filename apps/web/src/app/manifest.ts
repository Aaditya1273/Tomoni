import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tomoni',
    short_name: 'Tomoni',
    description: 'Your family’s medicines, warnings and fixes in one place.',
    start_url: '/family',
    display: 'standalone',
    background_color: '#f4f6fb',
    theme_color: '#3341a8',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
