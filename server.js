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

// 1. بدء الطلب فوراً دون انتظار يقطع اتصال السيرفر (تجنب مهلة Render 100 ثانية)
app.post('/api/start-commercial-ad', async (req, res) => {
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

    // توليد الصوت البشري فائق الدقة (ElevenLabs)
    let audioDataUri = null;
    if (ELEVEN_API_KEY) {
      try {
        const targetVoice = voiceId || 'nPczCjzI2devNBz1zQrb';
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
              similarity_boost: 0.88,
              style: 0.40,
              use_speaker_boost: true
            }
          })
        });

        if (ttsResp.ok) {
          const audioBuf = await ttsResp.arrayBuffer();
          audioDataUri = `data:audio/mp3;base64,${Buffer.from(audioBuf).toString('base64')}`;
        }
      } catch (e) {
        console.warn('TTS Warning:', e.message);
      }
    }

    // إرسال طلب الفيديو إلى Replicate
    const videoPrompt = `Cinematic luxury commercial ad, professional human hands wearing and holding this ${productName || 'product'}, showcasing product details to the camera in high-end studio lighting, 4k ultra-realistic commercial footage, slow motion, crisp reflections.`;

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
        error: prediction.detail || prediction.error || 'خطأ في بدء المعالجة في Replicate'
      });
    }

    // نرجع المعرف ورابط الصوت فوراً في ثانيتين دون انتظار انتهاء الرندرة الطويلة
    return res.json({
      success: true,
      predictionId: prediction.id,
      audioUrl: audioDataUri
    });

  } catch (error) {
    console.error('Start Ad Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. التحقق من اكتمال الفيديو بشكل دوري من المتصفح (مستقر ولا ينقطع أبداً)
app.get('/api/check-ad-status', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Prediction ID required' });

    const checkResp = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    });
    const prediction = await checkResp.json();

    if (prediction.status === 'succeeded' && prediction.output) {
      const outputVideo = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      return res.json({ status: 'succeeded', videoUrl: outputVideo });
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return res.json({ status: 'failed', error: prediction.error || 'فشلت معالجة الفيديو في Replicate' });
    } else {
      return res.json({ status: prediction.status || 'processing' });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 3. بروكسي التنزيل المباشر
app.get('/api/download-proxy', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).send('No URL provided');
    const videoResp = await fetch(url);
    if (!videoResp.ok) return res.status(videoResp.status).send('Video fetch error');

    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'Product_Ad.mp4'}"`);
    res.setHeader('Content-Type', 'video/mp4');
    const arrayBuffer = await videoResp.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Fareq Studio v9 running on port ${PORT}`);
});
