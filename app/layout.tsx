import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={ title:'دراسات الشركات | مساحة البحث المالي',description:'اقرأ الأرقام وافهم الصورة. مساحة خاصة لدراسة أداء الشركات ومقارنة نتائجها مع مصادر واضحة.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><head><link rel="stylesheet" href="/fonts/fonts.css"/></head><body>{children}</body></html>}
