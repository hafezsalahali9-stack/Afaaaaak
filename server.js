const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const ELEVEN_API_KEY = (process.env.ELEVEN_API_KEY || "").trim();
const REPLICATE_API_TOKEN = (process.env.REPLICATE_API_TOKEN || "").trim();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate-commercial-ad', async (req, res) => {
  try {
    const { imageBase64, productName, offer, script, voiceId } = req.body;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'يرجى إضافة REPLICATE_API_TOKEN في إعدادات Render' });
    }
    if (!imageBase64) {
      return res.status(400).json({ error: 'يرجى رفع صورة المنتج أولاً.' });
    }
    if (!script) {
      return res.status(400).json({ error: 'يرجى كتابة نص السيناريو.' });
    }

    // 1. توليد الصوت البشري فائق الواقعية عبر ElevenLabs
    let audioDataUri = null;
    if (ELEVEN_API_KEY) {
      try {
        // نستخدم أفضل الأصوات البشرية الداعمة للعربية بطبيعية مطلقة
        const targetVoice = voiceId || 'nPczCjzI2devNBz1zQrb'; // صوت مذيع فخم
        const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVEN_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: script,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.40,
              similarity_boost: 0.90,
              style: 0.45,
              use_speaker_boost: true
            }
          })
        });

        if (ttsResp.ok) {
          const audioBuf = await ttsResp.arrayBuffer();
          audioDataUri = `data:audio/mp3;base64,${Buffer.from(audioBuf).toString('base64')}`;
        } else {
          const errDetail = await ttsResp.json().catch(() => ({}));
          console.warn('ElevenLabs Error:', errDetail);
        }
      } catch (e) {
        console.warn('TTS Warning:', e.message);
      }
    }

    // 2. توليد فيديو الموديل والمنتج عبر Replicate
    const videoPrompt = `High-end commercial advertisement video, realistic human model elegantly presenting and showcasing ${productName || 'luxury product'} close-up to the camera, wearing it, smooth wrist rotation showing luxury reflections, modern cinematic lighting, 4k ultra-realistic studio commercial footage.`;

    const repResp = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          prompt: videoPrompt,
          first_frame_image: imageBase64,
          prompt_optimizer: true
        }
      })
    });

    let prediction = await repResp.json();
    if (!repResp.ok || prediction.error) {
      return res.status(repResp.status || 500).json({
        error: prediction.detail || prediction.error || 'خطأ في توليد فيديو Replicate',
        details: prediction
      });
    }

    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 60) {
      await new Promise(r => setTimeout(r, 4000));
      attempts++;
      const checkResp = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
      });
      prediction = await checkResp.json();
    }

    if (prediction.status === 'succeeded' && prediction.output) {
      const generatedVideoUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return res.json({
        success: true,
        videoUrl: generatedVideoUrl,
        audioUrl: audioDataUri,
        productName: productName,
        offer: offer
      });
    } else {
      return res.status(500).json({ error: 'تعذر اكتمال رندرة الفيديو، يرجى المحاولة بصورة أخرى.' });
    }

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/download-proxy', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).send('No URL provided');
    const videoResp = await fetch(url);
    if (!videoResp.ok) return res.status(videoResp.status).send('Video fetch error');

    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'Fareq_Ad.mp4'}"`);
    res.setHeader('Content-Type', 'video/mp4');
    const arrayBuffer = await videoResp.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Fareq Studio listening on port ${PORT}`);
});
