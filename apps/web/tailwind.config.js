/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // World canvas / panel glass base — the deep space the sim renders on.
        void: '#03040c',
        // Interactive accent: brush ring, tool highlights, designer affordances.
        life: '#4dffd0',
      },
    },
  },
  plugins: [],
};
