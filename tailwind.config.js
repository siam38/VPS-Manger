/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Surfaces ────────────────────────────────────────────────
        // A real elevation model. Previously every card shared one fill
        // and one border, so nothing receded and nothing lifted.
        canvas: '#070d0d',   // page background
        surface: '#0e1614',  // cards / sidebar
        raised: '#16211f',   // nested elements inside cards
        line: '#1e2c2a',     // default border
        'line-strong': '#2c3d3a',

        dark: {
          50: '#f0fdfa',
          100: '#d6e7e5',
          200: '#b0ccc9',
          300: '#82a8a4',
          400: '#5a7f7b',
          500: '#3d5955',
          600: '#2a3f3d',
          700: '#1a2b2a',
          800: '#0d1917',
          900: '#060e0d',
          950: '#030706'
        },

        // ── Text (all clear WCAG AA on canvas/surface/raised) ────────
        ink: '#e8f2f0',      // primary text
        muted: '#7da19c',    // secondary
        subtle: '#8fb5b1',   // tertiary

        // ── Accent: one brand colour, used for interaction only ──────
        accent: {
          DEFAULT: '#14b8a6',
          hover: '#2dd4bf',
          dim: '#0d9488'
        },

        // ── Semantic: reserved for state. Never decorative. ──────────
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#06b6d4'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Machine data (hostnames, IPs, load averages, sizes) gets
        // tabular figures so columns actually align.
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      fontSize: {
        // Deliberate ramp. Previously ~3 arbitrary sizes with the
        // smallest label carrying the most emphasis.
        'label': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em' }],
        'meta': ['0.75rem', { lineHeight: '1.1rem' }],
        'body': ['0.875rem', { lineHeight: '1.35rem' }],
        'title': ['1rem', { lineHeight: '1.4rem', letterSpacing: '-0.01em' }],
        'page': ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.02em' }],
        'metric': ['1.75rem', { lineHeight: '2rem', letterSpacing: '-0.03em' }]
      },
      borderRadius: {
        // One radius language: 6 controls / 10 cards / 14 modals.
        'control': '6px',
        'card': '10px',
        'modal': '14px'
      }
    }
  },
  plugins: []
};
