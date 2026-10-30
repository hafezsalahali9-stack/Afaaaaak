const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// المفاتيح مع المعالجة الدقيقة لتجنب أخطاء المسافات أو حالة الأحرف
const ELEVEN_API_KEY = (process.env.ELEVEN_API_KEY || "sk_12e052a47211e2714c013bba2ecaff4d96510b6d50639430").trim();
let rawReplicate = (process.env.REPLICATE_API_TOKEN || "r8_TwEYjVBFnZJO7lELWFuvp23nEQoSOgw3AIebt").trim();

// تصحيح الحرف الأول تلقائياً في حال تحول إلى كابيتال
if (rawReplicate.startsWith('R8_')) {
  rawReplicate = 'r8_' + rawReplicate.slice(3);
}
const REPLICATE_API_TOKEN = rawReplicate;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// المسار الشامل لإنتاج الإعلان الحقيقي بالذكاء الاصطناعي
app.post('/api/generate-commercial-ad', async (req, res) => {
  try {
    const { imageBase64, productName, offer, script, voiceId } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'يرجى رفع صورة المنتج أولاً.' });
    }
    if (!script) {
      return res.status(400).json({ error: 'يرجى كتابة نص السيناريو.' });
    }

    console.log(`[1/3] توليد الصوت البشري للمنتج: ${productName}...`);
    
    // 1. توليد الصوت البشري عبر ElevenLabs
    let audioDataUri = null;
    try {
      const selectedVoice = voiceId || '21m00Tcm4TlvDq8ikWAM';
      const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVEN_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: script,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.85,
            style: 0.25,
            use_speaker_boost: true
          }
        })
      });

      if (ttsResp.ok) {
        const audioBuf = await ttsResp.arrayBuffer();
        audioDataUri = `data:audio/mp3;base64,${Buffer.from(audioBuf).toString('base64')}`;
      } else {
        const errDetail = await ttsResp.json().catch(() => ({}));
        console.warn('ElevenLabs API warning:', errDetail);
      }
    } catch (ttsErr) {
      console.warn('TTS fetch failed:', ttsErr.message);
    }

    console.log(`[2/3] إرسال صورة المنتج إلى Replicate...`);

    // 2. أمر التوليد السينمائي الحقيقي
    const videoPrompt = `Cinematic commercial video advertisement, professional model hands and person holding and showcasing this ${productName || 'luxury product'} directly to the camera, showcasing its high-end details in a luxury studio setting, soft dramatic lighting, smooth slow motion 4k commercial camera movement, realistic, lifelike, highly detailed.`;

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
      console.error('Replicate error:', prediction);
      const errorMsg = prediction.detail || prediction.error || 'خطأ في التحقق من توكن Replicate';
      return res.status(repResp.status || 500).json({
        error: errorMsg,
        details: prediction
      });
    }

    console.log(`[3/3] جاري المعالجة (ID: ${prediction.id})...`);

    // المتابعة حتى اكتمال الفيديو
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 3500));
      attempts++;

      const checkResp = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
      });
      prediction = await checkResp.json();
      console.log(`Status attempt ${attempts}: ${prediction.status}`);
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
      return res.status(500).json({
        error: prediction.error || 'فشلت معالجة الفيديو في Replicate.',
        details: prediction
      });
    }

  } catch (error) {
    console.error('Master Server Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// بروكسي التنزيل المباشر
app.get('/api/download-proxy', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).send('No URL provided');

    const videoResp = await fetch(url);
    if (!videoResp.ok) return res.status(videoResp.status).send('Video fetch error');

    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'Product_Commercial_Ad.mp4'}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const arrayBuffer = await videoResp.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Fareq AI Production Engine online on port ${PORT}`);
});
