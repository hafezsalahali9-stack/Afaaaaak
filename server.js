const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DID_AUTH = process.env.DID_AUTH || "WjI5dloyeGxMVzloZFhSb01ud3hNREF5TlRjd05UZzFNVGN6TVRnMk5EYzNNemhBWVd0ZlFuSkhWWEZKYkVSMU5FUkVXa0ppV0dnek1XODM6YnBzX3hBb0QyUlVTQ3NVVGJTMHJs";

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// نقطة نهاية توليد فيديو الموديل البشري عبر D-ID
app.post('/api/generate-video', async (req, res) => {
  try {
    const { avatarUrl, script, voiceId } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'نص السيناريو مطلوب' });
    }

    const didHeaders = {
      'Authorization': `Basic ${DID_AUTH}`,
      'Content-Type': 'application/json'
    };

    const payload = {
      source_url: avatarUrl || 'https://create-images-results.d-id.com/DefaultPresenters/Emma_f/image.jpeg',
      script: {
        type: 'text',
        subtitles: false,
        provider: {
          type: 'microsoft',
          voice_id: voiceId || 'ar-SA-HamedNeural'
        },
        input: script
      },
      config: {
        fluent: true,
        pad_audio: 0.0
      }
    };

    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: didHeaders,
      body: JSON.stringify(payload)
    });

    const createData = await createRes.json();

    if (!createRes.ok || !createData.id) {
      return res.status(createRes.status).json({ 
        error: createData.description || createData.message || 'فشل في الاتصال بمحرك D-ID',
        details: createData 
      });
    }

    const talkId = createData.id;

    // فحص اكتمال المعالجة السحابية
    let videoUrl = null;
    let attempts = 0;

    while (attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      attempts++;

      const pollRes = await fetch(`https://api.d-id.com/talks/${talkId}`, {
        headers: didHeaders
      });

      const pollData = await pollRes.json();

      if (pollData.status === 'done' && pollData.result_url) {
        videoUrl = pollData.result_url;
        break;
      }

      if (pollData.status === 'error') {
        return res.status(500).json({ error: 'فشلت معالجة الفيديو في سيرفرات D-ID', details: pollData });
      }
    }

    if (!videoUrl) {
      return res.status(504).json({ error: 'استغرقت الرندرة وقتاً أطول من المتوقع' });
    }

    return res.json({ success: true, videoUrl });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// بروكسي التنزيل المباشر لمنع أخطاء الصلاحيات
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
  console.log(`Server is running on port ${PORT}`);
});
