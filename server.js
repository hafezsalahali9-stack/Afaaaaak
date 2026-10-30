const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// المفاتيح مدمجة وجاهزة مباشرة
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY || "sk_12e052a47211e2714c013bba2ecaff4d96510b6d50639430";
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || "r8_TwEYjVBFnZJO7lELWFuvp23nEQoSOgw3AIebt";

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. توليد التعليق الصوتي البشري عبر ElevenLabs
app.post('/api/generate-voice', async (req, res) => {
  try {
    const { text, voiceId } = req.body;
    if (!text) return res.status(400).json({ error: 'نص السيناريو مطلوب' });

    const selectedVoice = voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel or chosen speaker

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.85,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({
        error: errJson.detail?.message || 'خطأ في توليد الصوت من ElevenLabs',
        details: errJson
      });
    }

    const arrayBuffer = await resp.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    res.json({ success: true, audioData: `data:audio/mp3;base64,${base64Audio}` });

  } catch (err) {
    console.error('ElevenLabs Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. توليد فيديو إعلاني تفاعلي سينمائي عبر Replicate AI
app.post('/api/generate-replicate-video', async (req, res) => {
  try {
    const { prompt, imageUrl } = req.body;
    if (!prompt) return res.status(400).json({ error: 'الوصف الإعلاني مطلوب' });

    // استخدام أحدث وأقوى نموذج لتوليد فيديو المنتجات السينمائي عبر Replicate
    // Minimax video-01 أو Luma Ray
    const startResp = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          first_frame_image: imageUrl || undefined,
          prompt_optimizer: true
        }
      })
    });

    let prediction = await startResp.json();
    if (!startResp.ok || prediction.error) {
      console.error('Replicate Init Error:', prediction);
      return res.status(startResp.status).json({
        error: prediction.error || prediction.detail || 'فشل تشغيل محرك Replicate',
        details: prediction
      });
    }

    const predictionId = prediction.id;

    // المتابعة الدورية حتى تنتهي المعالجة وتجهيز رابط الـ MP4
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 40) {
      await new Promise(r => setTimeout(r, 3000));
      attempts++;

      const checkResp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
      });
      prediction = await checkResp.json();
    }

    if (prediction.status === 'succeeded' && prediction.output) {
      const outputVideo = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return res.json({ success: true, videoUrl: outputVideo });
    } else {
      return res.status(500).json({
        error: prediction.error || 'فشلت رندرة الفيديو السينمائي في Replicate',
        details: prediction
      });
    }

  } catch (err) {
    console.error('Replicate Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. بروكسي التنزيل المباشر للملف بدون مشاكل تصاريح الروابط
app.get('/api/download-proxy', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).send('No URL provided');

    const videoResp = await fetch(url);
    if (!videoResp.ok) return res.status(videoResp.status).send('Video fetch error');

    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'Fareq_Master_Ad.mp4'}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const arrayBuffer = await videoResp.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Fareq AI Ultimate SaaS listening on port ${PORT}`);
});
