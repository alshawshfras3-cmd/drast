import type { Metadata } from 'next';
import './globals.css';
import './financial-review.css';
import './research.css';
import './entity-directory.css';
import './brand.css';
export const metadata: Metadata={ title:'دراسات الشركات | مساحة البحث المالي',description:'اقرأ الأرقام وافهم الصورة. مساحة خاصة لدراسة أداء الشركات ومقارنة نتائجها مع مصادر واضحة.',icons:{icon:'/brand/drast-mark.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><head><link rel="stylesheet" href="/fonts/fonts.css"/></head><body>{children}</body></html>}
