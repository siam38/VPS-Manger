/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
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
        accent: {
          DEFAULT: '#14b8a6',
          hover: '#2dd4bf',
          dim: '#0d9488'
        },
        // Semantic text tokens. The raw dark-400/500 steps are surface colours;
        // used as body text they measured 1.94-4.42:1 and failed WCAG AA.
        // These keep the same teal-grey hue but clear 4.5:1 on dark-900/800/700.
        muted: '#7da19c',
        subtle: '#8fb5b1',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#06b6d4'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      }
    }
  },
  plugins: []
};
