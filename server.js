const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const ELEVEN_API_KEY = (process.env.ELEVEN_API_KEY || "").trim();
const REPLICATE_API_TOKEN = (process.env.REPLICATE_API_TOKEN || "").trim();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// قاعدة بيانات الطلبات والمشتركين في الذاكرة (لوحة الإدارة)
const ordersDatabase = [
  {
    id: 'ORD-101',
    plan: 'trial_3d',
    price: '$3',
    method: 'USDT (BEP20)',
    industry: 'عقارات ومقاولات',
    target: 150,
    status: 'مفعل',
    txRef: '0x3f4a9b...c18',
    date: new Date().toISOString().split('T')[0]
  }
];

// الصفحة الرئيسية (Funnel 3aqel Experience)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// استوديو الإنتاج
app.get('/studio', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>استوديو فارق AI</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;900&display=swap" rel="stylesheet">
    </head>
    <body class="bg-[#0b0c10] text-white font-['Cairo'] p-6 text-center">
      <div class="max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl mt-10">
        <span class="text-3xl block mb-2">🎉</span>
        <h2 class="text-xl font-black text-amber-400 mb-2">مرحباً بك في استوديو فارق AI</h2>
        <p class="text-xs text-slate-300 mb-6">تم تفعيل باقتك بنجاح. استوديو توليد الفيديوهات بالصوت البشري الحقيقي متاح لك بالكامل الآن.</p>
        <a href="/" class="block bg-amber-400 hover:bg-amber-300 text-black font-black py-3 rounded-xl text-xs">العودة للرئيسية</a>
      </div>
    </body>
    </html>
  `);
});

// لوحة الإدارة (Admin Dashboard)
app.get('/admin', (req, res) => {
  let rows = ordersDatabase.map(o => `
    <tr class="border-b border-slate-800 text-xs">
      <td class="p-3 font-mono text-amber-400">${o.id}</td>
      <td class="p-3">${o.plan}</td>
      <td class="p-3 font-bold text-white">${o.price}</td>
      <td class="p-3"><span class="bg-slate-800 text-amber-300 px-2 py-0.5 rounded text-[10px]">${o.method}</span></td>
      <td class="p-3">${o.industry}</td>
      <td class="p-3 font-mono truncate max-w-[120px] text-slate-400">${o.txRef}</td>
      <td class="p-3"><span class="bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] font-bold">${o.status}</span></td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>لوحة إدارة منصة فارق AI</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;900&display=swap" rel="stylesheet">
    </head>
    <body class="bg-[#0b0c10] text-slate-200 font-['Cairo'] p-6">
      <div class="max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <div>
            <h1 class="text-xl font-black text-white">لوحة إدارة منصة فارق AI ⚡</h1>
            <p class="text-xs text-slate-400">إدارة الاشتراكات، طلبات الـ BEP20 والفيزا، والمستخدمين</p>
          </div>
          <span class="bg-amber-400 text-black font-black px-3 py-1 rounded-xl text-xs">Admin Mode</span>
        </div>

        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl overflow-x-auto">
          <table class="w-full text-right">
            <thead>
              <tr class="border-b border-slate-800 text-[11px] text-slate-400">
                <th class="p-3">رقم الطلب</th>
                <th class="p-3">الباقة</th>
                <th class="p-3">المبلغ</th>
                <th class="p-3">طريقة الدفع</th>
                <th class="p-3">المجال</th>
                <th class="p-3">المرجع / TxID</th>
                <th class="p-3">الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

// API استقبال طلبات الاشتراك وتسجيلها في لوحة الإدارة
app.post('/api/orders/create', (req, res) => {
  const { plan, price, currency, method, industry, monthlyTarget, txRef } = req.body;
  const newOrder = {
    id: 'ORD-' + (Math.floor(Math.random() * 900) + 100),
    plan: plan || 'trial_3d',
    price: `${price || 3} ${currency || 'USDT'}`,
    method: method === 'crypto' ? 'USDT (BEP20)' : 'Visa Card',
    industry: industry || 'عام',
    target: monthlyTarget || 150,
    status: 'مفعل',
    txRef: txRef || '0xVerified',
    date: new Date().toISOString().split('T')[0]
  };

  ordersDatabase.unshift(newOrder);
  res.json({ success: true, orderId: newOrder.id });
});

app.listen(PORT, () => {
  console.log(`Fareq Platform fully unified online on port ${PORT}`);
});
