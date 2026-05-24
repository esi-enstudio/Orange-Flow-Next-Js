# OrangeFlow Telegram Mini App (TMA) Setup

এই প্রজেক্টে এখন একটি আধুনিক **Next.js** ফ্রন্টএন্ড এবং **FastAPI** ব্যাকএন্ড যুক্ত করা হয়েছে।

## ১. ব্যাকএন্ড (Python API)
আপনার বিদ্যমান ডেটাবেস থেকে ডাটা সাপ্লাই করার জন্য এটি প্রয়োজন।

**চালু করার কমান্ড:**
```bash
python api_main.py
```
এটি `http://localhost:8000` এ চলবে।

## ২. ফ্রন্টএন্ড (Next.js)
এটি আপনার টেলিগ্রাম মিনি অ্যাপের ইন্টারফেস।

**চালু করার কমান্ড:**
```bash
cd frontend
npm run dev
```
এটি `http://localhost:3000` এ চলবে।

## ৩. টেলিগ্রামে কানেক্ট করা
টেলিগ্রাম বটে এই মিনি অ্যাপটি যুক্ত করতে হলে:
1.  **BotFather** এ যান।
2.  আপনার বট সিলেক্ট করুন এবং `Menu Button` বা একটি বাটন তৈরি করুন।
3.  URL হিসেবে আপনার ফ্রন্টএন্ড ইউআরএল দিন। (লোকাল টেস্টের জন্য **ngrok** ব্যবহার করতে পারেন)।

### Ngrok দিয়ে লোকাল টেস্ট:
```bash
ngrok http 3000
```
অতঃপর ngrok এর দেওয়া `https` ইউআরএলটি BotFather এ সেট করুন।

---
**টেকনিক্যাল ডিটেইলস:**
- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS (Telegram Theme Integrated)
- **SDK:** @twa-dev/sdk
- **Backend:** FastAPI
