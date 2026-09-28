import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// `site` and `base` assume GitHub Pages under jamubc/jamcli. Change both together if the host changes.
export default defineConfig({
  site: 'https://jamubc.github.io',
  base: '/jamcli',
  integrations: [
    starlight({
      title: 'JamCLI',
      description: 'A terminal-native AI coding agent. Local-first, provider-agnostic, human-in-the-loop.',
      customCss: [
        '@fontsource/ibm-plex-sans/400.css',
        '@fontsource/ibm-plex-sans/600.css',
        '@fontsource/ibm-plex-mono/400.css',
        '@fontsource/ibm-plex-mono/500.css',
        './src/styles/theme.css',
      ],
      expressiveCode: {
        // One dark theme in both modes: code reads as code on either page colour.
        themes: ['github-dark'],
        styleOverrides: { borderRadius: '4px', codeFontFamily: 'var(--sl-font-mono)' },
      },
      sidebar: [
        { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
        { label: 'Tools', items: [{ autogenerate: { directory: 'tools' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
      lastUpdated: false,
      plugins: [starlightLlmsTxt()],
    }),
  ],
});
