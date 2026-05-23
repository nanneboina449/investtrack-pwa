/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#e8eaf6',
          100: '#c5cae9',
          500: '#3949ab',
          700: '#283593',
          900: '#1a237e',
        },
        // Fintech palette per investtrack_portfolio_ui_spec.pdf — used by
        // the My Portfolio screen for hero number + asset/liability rows.
        fintech: {
          green: '#00c805',  // profit, positive cash flow, receivables
          red:   '#ff5000',  // liabilities, owed amounts, negative drift
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    }
  },
  plugins: []
}
