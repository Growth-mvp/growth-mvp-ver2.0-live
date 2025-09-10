/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Apple風システムフォントスタック
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'SF Pro Display',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans JP',
          'sans-serif',
        ],
      },
      colors: {
        // Appleらしいグレースケール（淡い色合い）
        zinc: {
          50: '#fafafa',
          100: '#f5f5f7',
          200: '#e5e5ea',
          300: '#d1d1d6',
          400: '#a1a1aa',
          500: '#7c7c80',
          600: '#52525b',
          700: '#3a3a3c',
          800: '#1c1c1e',
          900: '#0c0c0d',
        },
      },
      boxShadow: {
        subtle: '0 1px 3px rgba(0,0,0,0.08)', // Apple風の控えめな影
        card: '0 2px 12px rgba(0,0,0,0.06)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
    },
  },
  plugins: [],
};
