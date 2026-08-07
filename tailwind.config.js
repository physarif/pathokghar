/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  // যেসব ফাইলে Tailwind ক্লাস ব্যবহার হয়েছে সেগুলো স্ক্যান করে শুধু
  // ব্যবহৃত ক্লাসের CSS জেনারেট হবে (JIT purge) — পুরো Tailwind না।
  content: [
    './components/**/*.html',
    './*.html',
    './scripts/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff5f5',
          100: '#fde8e6',
          500: '#c0392b',
          600: '#a93226',
        },
      },
    },
  },
  plugins: [],
};
