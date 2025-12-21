/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,jsx,js}'],
  theme: {
    extend: {
      colors: {
        bull: '#16a34a',
        bear: '#ef4444',
        panel: '#0f172a'
      }
    }
  },
  plugins: []
};
