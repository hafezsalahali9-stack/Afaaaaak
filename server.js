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

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// تخزين المهام في الذاكرة لسرعة الاستجابة
const activeTasks = new Map();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. بدء المهمة فوراً (استجابة في أقل من ثانية تمنع أي خطأ اتصال)
app.post('/api/start-production', async (req, res) => {
  try {
    const { imageBase64, productName, offer, script, voiceId, customMusicBase64 } = req.body;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'يرجى إضافة REPLICATE_API_TOKEN في متغيرات Render' });
    }
    if (!imageBase64) {
      return res.status(400).json({ error: 'يرجى رفع صورة المنتج أولاً.' });
    }
    if (!script) {
      return res.status(400).json({ error: 'يرجى كتابة نص السيناريو.' });
    }

    const taskId = 'job_' + Date.now();
    
    // تسجيل المهمة مبدئياً
    activeTasks.set(taskId, {
      status: 'generating_voice_and_video',
      created: Date.now(),
      audioUrl: null,
      videoUrl: null,
      productName,
      offer,
      error: null
    });

    // الرد الفوري على المتصفح بـ JSON سليم 100%
    res.json({ success: true, taskId });

    // تشغيل التوليد في الخلفية
    runBackgroundJob(taskId, { imageBase64, productName, offer, script, voiceId, customMusicBase64 });

  } catch (err) {
    console.error('Server Start Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// توليد في الخلفية بدون حجب اتصال المستخدم
async function runBackgroundJob(taskId, data) {
  const task = activeTasks.get(taskId);
  if (!task) return;

  try {
    // 1. توليد الصوت البشري الحقيقي (ElevenLabs)
    let audioDataUri = null;
    if (ELEVEN_API_KEY) {
      try {
        const targetVoice = data.voiceId || 'nPczCjzI2devNBz1zQrb';
        const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVEN_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: data.script,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.40,
              similarity_boost: 0.88,
              style: 0.40,
              use_speaker_boost: true
            }
          })
        });

        if (ttsResp.ok) {
          const audioBuf = await ttsResp.arrayBuffer();
          audioDataUri = `data:audio/mp3;base64,${Buffer.from(audioBuf).toString('base64')}`;
          task.audioUrl = audioDataUri;
        }
      } catch (voiceErr) {
        console.warn('ElevenLabs Warning:', voiceErr.message);
      }
    }

    // 2. توليد الفيديو السينمائي عبر Replicate
    const videoPrompt = `Cinematic commercial video advertisement, professional model hands and wrist holding and displaying ${data.productName || 'luxury product'} close-up to the camera in a modern luxury studio setting, dramatic studio lighting, 4k ultra-realistic commercial, smooth motion, high-end reflections.`;

    const repResp = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          prompt: videoPrompt,
          first_frame_image: data.imageBase64,
          prompt_optimizer: true
        }
      })
    });

    let prediction = await repResp.json();
    if (!repResp.ok || prediction.error) {
      task.status = 'failed';
      task.error = prediction.detail || prediction.error || 'خطأ في سيرفر Replicate';
      return;
    }

    // انتظار اكتمال الرندرة
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 70) {
      await new Promise(r => setTimeout(r, 4000));
      attempts++;
      const checkResp = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
      });
      prediction = await checkResp.json();
    }

    if (prediction.status === 'succeeded' && prediction.output) {
      const vid = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      task.status = 'ready';
      task.videoUrl = vid;
    } else {
      task.status = 'failed';
      task.error = prediction.error || 'تعذر اكتمال معالجة المشهد في Replicate';
    }

  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
  }
}

// 2. فحص حالة المهمة
app.get('/api/check-task-status', (req, res) => {
  const { taskId } = req.query;
  const task = activeTasks.get(taskId);
  if (!task) {
    return res.status(404).json({ error: 'المهمة غير موجودة' });
  }

  res.json({
    status: task.status,
    videoUrl: task.videoUrl,
    audioUrl: task.audioUrl,
    error: task.error
  });
});

app.listen(PORT, () => {
  console.log(`Server online on port ${PORT}`);
});
