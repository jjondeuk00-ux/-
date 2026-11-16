/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        green: {
          primary: '#0D5C46',
          dark: '#0A4A37',
          light: '#E9F5F0',
          chip: '#E9F5EF',
        },
        gray: {
          text: '#2C2F2A',
          secondary: '#8B938A',
          border: '#E6E7E5',
          bg: '#F4F4F0',
        },
      },
      fontFamily: {
        sans: ['Noto Sans KR', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
