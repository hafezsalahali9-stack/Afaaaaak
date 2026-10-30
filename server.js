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

const tasks = new Map();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// نقطة فحص سريعة لسلامة السيرفر
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, status: 'online' });
});

app.post('/api/start-production', async (req, res) => {
  try {
    const { imageBase64, productName, offer, script, voiceId } = req.body;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'مفتاح REPLICATE_API_TOKEN غير موجود في إعدادات Render' });
    }
    if (!imageBase64) {
      return res.status(400).json({ error: 'يرجى اختيار صورة المنتج' });
    }
    if (!script) {
      return res.status(400).json({ error: 'يرجى إدخال نص السيناريو' });
    }

    const taskId = 'task_' + Date.now();
    tasks.set(taskId, {
      status: 'processing',
      audioUrl: null,
      videoUrl: null,
      error: null
    });

    res.json({ success: true, taskId });

    // تشغيل التوليد بالخلفية
    (async () => {
      const currentTask = tasks.get(taskId);
      try {
        // 1. توليد الصوت البشري (ElevenLabs)
        if (ELEVEN_API_KEY) {
          try {
            const vId = voiceId || 'nPczCjzI2devNBz1zQrb';
            const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vId}`, {
              method: 'POST',
              headers: {
                'xi-api-key': ELEVEN_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                text: script,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                  stability: 0.45,
                  similarity_boost: 0.88,
                  style: 0.40,
                  use_speaker_boost: true
                }
              })
            });

            if (ttsRes.ok) {
              const buf = await ttsRes.arrayBuffer();
              currentTask.audioUrl = `data:audio/mp3;base64,${Buffer.from(buf).toString('base64')}`;
            }
          } catch(e) {
            console.warn('Voice error:', e.message);
          }
        }

        // 2. توليد الفيديو السينمائي (Replicate)
        const videoPrompt = `Cinematic commercial video showcase, high-end professional human model gracefully wearing and holding ${productName || 'luxury product'} close-up to camera, modern luxury studio lighting, 4k ultra-detailed, slow motion, crisp reflections, realistic textures.`;

        const repRes = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
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

        let pred = await repRes.json();
        if (!repRes.ok || pred.error) {
          currentTask.status = 'failed';
          currentTask.error = pred.detail || pred.error || 'خطأ في استجابة Replicate';
          return;
        }

        let checks = 0;
        while (pred.status !== 'succeeded' && pred.status !== 'failed' && checks < 80) {
          await new Promise(r => setTimeout(r, 4000));
          checks++;
          const chk = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
            headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
          });
          pred = await chk.json();
        }

        if (pred.status === 'succeeded' && pred.output) {
          currentTask.videoUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
          currentTask.status = 'ready';
        } else {
          currentTask.status = 'failed';
          currentTask.error = pred.error || 'فشلت رندرة الفيديو في Replicate';
        }

      } catch(err) {
        currentTask.status = 'failed';
        currentTask.error = err.message;
      }
    })();

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/check-task-status', (req, res) => {
  const { taskId } = req.query;
  const task = tasks.get(taskId);
  if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
  res.json(task);
});

app.listen(PORT, () => {
  console.log(`Server online on port ${PORT}`);
});
